#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { appendFile, copyFile, mkdir, open, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { decideReleaseObservation, validateClosedObservationAttempt, OBSERVATION_BUDGET_MS, OBSERVATION_DURATION_MS } from "./release-observation-policy.mjs";
import { writeAggregateAtomically } from "./tail-aggregate.mjs";

const ATTEMPT_SCRIPT = fileURLToPath(new URL("./observe-release-attempt.sh", import.meta.url));
const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const EVIDENCE_LIMIT = 65_536;

async function readBounded(file) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    assert.ok((await handle.stat()).isFile());
    const buffer = Buffer.alloc(EVIDENCE_LIMIT + 1);
    let size = 0;
    while (size < buffer.length) {
      const part = await handle.read(buffer, size, buffer.length - size, size);
      if (!part.bytesRead) break;
      size += part.bytesRead;
    }
    assert.ok(size <= EVIDENCE_LIMIT);
    return new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
  } finally { await handle.close(); }
}

// Preserve confirmed regressions even if another evidence file is malformed.
// All reads are bounded and none of their contents enters an error message.
export async function readRegressionSignals(directory) {
  let publicRegression = false, tailRegression = false;
  try {
    const status = await readBounded(join(directory, "monitor-status.txt"));
    publicRegression = /^public_regression=true$/mu.test(status);
    tailRegression = /^tail_regression=true$/mu.test(status);
  } catch { /* Missing evidence remains terminal in the controller. */ }
  try {
    const monitor = JSON.parse(await readBounded(join(directory, "monitor.json")));
    publicRegression ||= monitor?.status === "failed" && monitor?.failureType === "public_regression";
  } catch { /* A public failure written before the status file is still sticky. */ }
  for (const name of ["invocation-tail-aggregate.json", "server-tail-aggregate.json"]) {
    try {
      const value = JSON.parse(await readBounded(join(directory, name)));
      if (Number.isSafeInteger(value.eventCount) && value.eventCount > 0) tailRegression = true;
    } catch { /* The strict closed-record policy rejects malformed evidence. */ }
  }
  return { publicRegression, tailRegression };
}

export function runObservationAttempt({ origin, releaseId, directory, attempt, timeoutMs, signal }) {
  return new Promise((resolveAttempt, reject) => {
    const child = spawn("bash", [ATTEMPT_SCRIPT, origin, releaseId, directory, String(attempt)], {
      detached: true,
      // Credentials remain environment-only, and only this trusted runner gets
      // them. Its aggregate/public-monitor children explicitly remove them.
      env: { ...process.env, GRIHAGRID_MONITOR_DURATION_MS: String(OBSERVATION_DURATION_MS) },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let timedOut = false, stopped = false, forceTimer;
    let diagnosticBytes = 0;
    child.stderr.on("data", chunk => { diagnosticBytes = Math.min(EVIDENCE_LIMIT + 1, diagnosticBytes + chunk.length); });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try { process.kill(-child.pid, "SIGTERM"); } catch { /* Already stopped. */ }
      forceTimer = setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already stopped. */ }
      }, 5_000);
      forceTimer.unref();
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const abort = () => stop();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) stop();
    const cleanup = () => {
      clearTimeout(timer); clearTimeout(forceTimer);
      signal?.removeEventListener("abort", abort);
    };
    child.once("error", () => { cleanup(); reject(new Error("observation runner unavailable")); });
    child.once("close", (code, exitSignal) => {
      cleanup();
      resolveAttempt({ code, signal: exitSignal, timedOut, interrupted: signal?.aborted === true, diagnosticBytes });
    });
  });
}

async function validateAttemptArtifacts(directory, record, expectedOrigin) {
  const { unlink } = await import("node:fs/promises");
  const progressKeys = ["configuredDurationMs", "observedDurationMs", "completedFullDuration", "finalFencePassed", "finalFenceReleaseId"];
  const exactKeys = (value, keys) => {
    assert.ok(value && typeof value === "object" && !Array.isArray(value));
    assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
  };
  const count = value => Number.isSafeInteger(value) && value >= 0;
  const timestamp = value => {
    assert.equal(typeof value, "string");
    assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u);
    const parsed = Date.parse(value);
    assert.ok(Number.isFinite(parsed));
    assert.equal(new Date(parsed).toISOString(), value.includes(".") ? value : value.replace("Z", ".000Z"));
    return parsed;
  };
  let invalid = false;
  const rejectArtifact = async (name, reason) => {
    invalid = true;
    const file = join(directory, name);
    try {
      await writeAggregateAtomically(file, { status: "rejected", reason });
    } catch {
      // A rejected diagnostic must not survive for upload if an evidence write
      // fails. Delete only this attempt's exact generated artifact.
      await unlink(file).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
  };
  let monitor, monitorStarted, monitorFinished;
  try {
    monitor = JSON.parse(await readBounded(join(directory, "monitor.json")));
    const successful = record.monitorStatus === 0;
    exactKeys(monitor, successful
      ? ["origin", "releaseId", "startedAt", "finishedAt", "samples", "successfulChecks", "requests", "latencyMs", ...progressKeys]
      : ["status", "failureType", "finishedAt", ...progressKeys]);
    for (const key of progressKeys) assert.equal(monitor[key], record[key]);
    monitorFinished = timestamp(monitor.finishedAt);
    if (successful) {
      assert.equal(monitor.origin, expectedOrigin);
      assert.equal(monitor.releaseId, record.exactVersion);
      monitorStarted = timestamp(monitor.startedAt);
      assert.ok(monitorFinished >= monitorStarted);
      // Monotonic progress enforces the full window. Allow ordinary wall-clock
      // adjustment/rounding while rejecting unrelated or zero-length intervals.
      assert.ok(Math.abs(monitorFinished - monitorStarted - record.observedDurationMs) <= 5_000);
      assert.ok(count(monitor.samples) && monitor.samples >= 2);
      assert.ok(count(monitor.successfulChecks) && monitor.successfulChecks === monitor.samples * 11);
      assert.ok(count(monitor.requests) && monitor.requests >= monitor.successfulChecks
        && monitor.requests <= monitor.successfulChecks * 2);
      exactKeys(monitor.latencyMs, ["minimum", "maximum", "average"]);
      assert.ok(Object.values(monitor.latencyMs).every(value => count(value) && value <= record.observedDurationMs));
      assert.ok(monitor.latencyMs.minimum <= monitor.latencyMs.average
        && monitor.latencyMs.average <= monitor.latencyMs.maximum);
    } else {
      assert.equal(monitor.status, "failed");
      assert.equal(monitor.failureType, record.monitorStatus === 1 ? "public_regression" : "tail_coverage");
    }
  } catch {
    monitor = undefined;
    await rejectArtifact("monitor.json", "invalid_monitor_evidence");
  }
  for (const [name, events, bytes, reason] of [
    ["invocation-tail-aggregate.json", record.invocationEvents, record.invocationBytes, "invalid_invocation_aggregate"],
    ["server-tail-aggregate.json", record.handledServerErrorEvents, record.handledServerErrorBytes, "invalid_server_aggregate"],
  ]) {
    try {
      const aggregate = JSON.parse(await readBounded(join(directory, name)));
      exactKeys(aggregate, ["byteCount", "eventCount", "finishedAt", "startedAt"]);
      assert.ok(count(aggregate.eventCount) && count(aggregate.byteCount));
      assert.equal(aggregate.eventCount, events);
      assert.equal(aggregate.byteCount, bytes);
      const started = timestamp(aggregate.startedAt), finished = timestamp(aggregate.finishedAt);
      assert.ok(finished >= started);
      if (monitor) {
        assert.ok(finished >= monitorFinished);
        if (record.monitorStatus === 0) assert.ok(started <= monitorStarted);
        else assert.ok(started <= monitorFinished - record.observedDurationMs + 5_000);
      }
    } catch {
      await rejectArtifact(name, reason);
    }
  }
  assert.ok(!invalid, "invalid observation artifacts");
}

function compatibilityHealth(record, attemptCount) {
  return {
    ...record,
    acceptedAttempt: record.attempt,
    attemptCount,
    invocationStderrBytes: record.invocationStderr.byteCount,
    serverStderrBytes: record.serverStderr.byteCount,
    invocationProxyWarningIgnored: record.invocationStderr.ignoredProxyWarning,
    serverProxyWarningIgnored: record.serverStderr.ignoredProxyWarning,
    invocationUnexpectedStderr: record.invocationStderr.unexpected,
    serverUnexpectedStderr: record.serverStderr.unexpected,
  };
}

/** Every retry launches new tails and a new full monitor. The injectable runner
 * and monotonic clock support deterministic policy-boundary tests; the CLI
 * always uses the real protected subprocess and fixed production duration. */
export async function observeRelease(origin, releaseId, rawDirectory, options = {}) {
  const url = new URL(origin);
  assert.ok(url.protocol === "https:" && url.origin === origin && !url.username && !url.password);
  assert.match(releaseId, VERSION);
  const directory = resolve(rawDirectory);
  const now = options.now || (() => performance.now());
  const runAttempt = options.runAttempt || runObservationAttempt;
  const start = now(), startedAt = new Date().toISOString();
  const history = { attempts: [] };
  let publicRegression = false, tailRegression = false, aggregateRegression = false;
  let decision = { decision: "failure", reason: "observation_runner_failure" };
  let lastDirectory, executedAttempts = 0, evidenceOwned = false;
  const elapsed = () => Math.max(0, Math.floor(now() - start));

  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    // A stale observation cannot be mistaken for new evidence or overwritten.
    const reserved = new Set(["attempts", "observation-history.json", "observation-summary.json",
      "tail-health.json", "monitor.json", "invocation-tail-aggregate.json", "server-tail-aggregate.json"]);
    assert.ok(!(await readdir(directory)).some(name => reserved.has(name)));
    await mkdir(join(directory, "attempts"), { mode: 0o700 });
    evidenceOwned = true;
    for (;;) {
      decision = decideReleaseObservation(history, { expectedReleaseId: releaseId, elapsedMs: elapsed() });
      if (decision.decision !== "retry") break;
      if (options.signal?.aborted) { decision = { decision: "failure", reason: "observation_interrupted" }; break; }
      lastDirectory = join(directory, "attempts", String(decision.nextAttempt).padStart(2, "0"));
      await mkdir(lastDirectory, { mode: 0o700 });
      executedAttempts += 1;
      const result = await runAttempt({ origin, releaseId, directory: lastDirectory, attempt: decision.nextAttempt,
        timeoutMs: Math.max(1, OBSERVATION_BUDGET_MS - elapsed() - 10_000), signal: options.signal });
      const signals = await readRegressionSignals(lastDirectory);
      publicRegression ||= signals.publicRegression;
      tailRegression ||= signals.tailRegression;
      await writeAggregateAtomically(join(lastDirectory, "runner-result.json"), {
        code: Number.isInteger(result.code) && result.code >= 0 && result.code <= 255 ? result.code : null,
        signalled: Boolean(result.signal), timedOut: result.timedOut === true, interrupted: result.interrupted === true,
        diagnosticBytes: Number.isSafeInteger(result.diagnosticBytes) && result.diagnosticBytes >= 0
          ? Math.min(EVIDENCE_LIMIT + 1, result.diagnosticBytes) : null,
      });
      let record;
      try {
        record = JSON.parse(await readBounded(join(lastDirectory, "tail-health.json")));
        aggregateRegression ||= record?.regression === true;
        publicRegression ||= record?.publicRegression === true || record?.monitorStatus === 1;
        tailRegression ||= record?.tailRegression === true
          || (Number.isSafeInteger(record?.invocationEvents) && record.invocationEvents > 0)
          || (Number.isSafeInteger(record?.handledServerErrorEvents) && record.handledServerErrorEvents > 0);
        assert.ok(validateClosedObservationAttempt(record, { attemptIndex: executedAttempts, expectedReleaseId: releaseId }));
      } catch {
        // Upload finite rejection evidence, never malformed or private fields.
        await writeAggregateAtomically(join(lastDirectory, "tail-health.json"), {
          status: "rejected", reason: "invalid_attempt_evidence", publicRegression, tailRegression,
        });
        throw new Error("invalid attempt evidence");
      }
      history.attempts.push(record);
      await validateAttemptArtifacts(lastDirectory, record, origin);
      if (result.timedOut || result.interrupted || result.signal || ![0, 1].includes(result.code) || result.diagnosticBytes !== 0) {
        decision = { decision: "failure", reason: "observation_runner_failure" }; break;
      }
      await writeAggregateAtomically(join(directory, "observation-history.json"), history);
      if (publicRegression || tailRegression || aggregateRegression) { decision = { decision: "failure", reason: "application_regression" }; break; }
      decision = decideReleaseObservation(history, { expectedReleaseId: releaseId, elapsedMs: elapsed() });
      if ((result.code === 0) !== (decision.decision === "success")) {
        // A valid failed attempt exits1 and may request a fresh window; a clean
        // record from a failed supervisor can never establish release success.
        if (result.code === 0 || decision.decision === "success") {
          decision = { decision: "failure", reason: "inconsistent_runner_result" }; break;
        }
      }
      if (decision.decision !== "retry") break;
      process.stdout.write(`${JSON.stringify({ status: "retrying", attempt: record.attempt,
        reason: decision.reason, nextAttempt: decision.nextAttempt })}\n`);
    }
  } catch {
    if (lastDirectory) {
      const signals = await readRegressionSignals(lastDirectory);
      publicRegression ||= signals.publicRegression;
      tailRegression ||= signals.tailRegression;
    }
    decision = { decision: "failure", reason: publicRegression || tailRegression || aggregateRegression ? "application_regression" : "invalid_attempt_evidence" };
  }

  const passed = decision.decision === "success" && !publicRegression && !tailRegression && !aggregateRegression;
  const summary = {
    status: passed ? "passed" : "failed", origin, releaseId, startedAt, finishedAt: new Date().toISOString(),
    elapsedMs: elapsed(), configuredDurationMs: OBSERVATION_DURATION_MS,
    attempts: executedAttempts, acceptedAttempt: passed ? history.attempts.at(-1).attempt : null,
    reason: decision.reason, publicRegression, tailRegression,
    regression: publicRegression || tailRegression || aggregateRegression, infrastructureFailure: !passed && !publicRegression && !tailRegression && !aggregateRegression,
  };
  if (!evidenceOwned) return { ...summary, reason: "stale_observation_evidence" };
  try {
    await writeAggregateAtomically(join(directory, "observation-history.json"), history);
    if (passed) {
      for (const name of ["monitor.json", "invocation-tail-aggregate.json", "server-tail-aggregate.json"]) {
        await copyFile(join(lastDirectory, name), join(directory, name));
      }
      await writeAggregateAtomically(join(directory, "tail-health.json"), compatibilityHealth(history.attempts.at(-1), history.attempts.length));
    }
    await writeAggregateAtomically(join(directory, "observation-summary.json"), summary);
  } catch {
    summary.status = "failed"; summary.acceptedAttempt = null;
    summary.infrastructureFailure = true; summary.reason = "evidence_write_failure";
  }
  return summary;
}

export async function writeObservationOutputs(file, result) {
  const values = { public_regression: result.publicRegression === true, tail_regression: result.tailRegression === true,
    regression: result.regression === true, infrastructure_failure: result.infrastructureFailure === true,
    monitor_infrastructure_failure: result.infrastructureFailure === true };
  await appendFile(file, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const abort = new AbortController();
  const stop = () => abort.abort();
  process.once("SIGTERM", stop); process.once("SIGINT", stop);
  let result;
  try {
    assert.equal(process.argv.length, 5);
    result = await observeRelease(process.argv[2], process.argv[3], process.argv[4], { signal: abort.signal });
  } catch {
    result = { status: "failed", reason: "invalid_observation_configuration", publicRegression: false,
      tailRegression: false, regression: false, infrastructureFailure: true };
  }
  try {
    if (process.env.GITHUB_OUTPUT) await writeObservationOutputs(process.env.GITHUB_OUTPUT, result);
  } catch {
    result.status = "failed"; result.infrastructureFailure = true; result.reason = "output_write_failure";
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "passed" ? 0 : 1;
  process.removeListener("SIGTERM", stop); process.removeListener("SIGINT", stop);
}
