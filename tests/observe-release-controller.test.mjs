import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { observeRelease, writeObservationOutputs } from "../scripts/observe-release.mjs";
import { OBSERVATION_DURATION_MS as WINDOW, OBSERVATION_BUDGET_MS as BUDGET } from "../scripts/release-observation-policy.mjs";

const ORIGIN = "https://release.example.test";
const VERSION = "11111111-1111-4111-8111-111111111111";
const empty = () => ({ byteCount: 0, ignoredProxyWarning: false, unexpected: false,
  diagnosticClasses: [], recognizedWarningCount: 0, hasUnrecognizedContent: false });
const loss = () => ({ byteCount: 118, ignoredProxyWarning: false, unexpected: true,
  diagnosticClasses: ["wrangler_tail_keepalive_timeout"], recognizedWarningCount: 1, hasUnrecognizedContent: false });
const unknown = () => ({ byteCount: 118, ignoredProxyWarning: false, unexpected: true,
  diagnosticClasses: ["unrecognized_stderr"], recognizedWarningCount: 0, hasUnrecognizedContent: true });

function completed(attempt) {
  return { attempt, closed: true, monitorStatus: 0, exactVersion: VERSION, configuredDurationMs: WINDOW,
    observedDurationMs: WINDOW, completedFullDuration: true, finalFencePassed: true, finalFenceReleaseId: VERSION,
    publicRegression: false, tailRegression: false, invocationEvents: 0, invocationBytes: 0,
    handledServerErrorEvents: 0, handledServerErrorBytes: 0, tailsAliveThroughPublicMonitor: true,
    invocationProcessExit: 143, serverProcessExit: 143, tailsStoppedByOperator: true, regression: false,
    infrastructureFailure: false, invocationStderr: empty(), serverStderr: empty() };
}
function interrupted(attempt, observedDurationMs = 10_000) {
  return { ...completed(attempt), monitorStatus: 2, observedDurationMs, completedFullDuration: false,
    finalFencePassed: false, finalFenceReleaseId: null, infrastructureFailure: true, serverStderr: loss() };
}

function monitorFor(record) {
  const progress = { configuredDurationMs: WINDOW, observedDurationMs: record.observedDurationMs,
    completedFullDuration: record.completedFullDuration, finalFencePassed: record.finalFencePassed,
    finalFenceReleaseId: record.finalFenceReleaseId };
  const finishedAt = "2026-09-15T00:30:00.000Z";
  return record.monitorStatus === 0
    ? { origin: ORIGIN, releaseId: VERSION, startedAt: "2026-09-15T00:00:00.000Z", finishedAt,
      samples: 21, successfulChecks: 231, requests: 231, latencyMs: { minimum: 5, maximum: 20, average: 10 }, ...progress }
    : { status: "failed", failureType: record.monitorStatus === 1 ? "public_regression" : "tail_coverage", finishedAt, ...progress };
}

async function readJSON(path) { return JSON.parse(await readFile(path, "utf8")); }
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), "release-observer-controller-"));
  try { await run(directory); } finally { await rm(directory, { recursive: true, force: true }); }
}

// Each stub represents a closed, credential-free attempt process and writes the
// actual bounded files consumed by the production controller. No network or
// 30-minute sleep is substituted for a success assertion: only the monotonic
// clock advances, and the controller/policy still enforce the full duration.
function processFixture(steps, options = {}) {
  let clock = 100_000;
  const calls = [];
  return {
    calls,
    now: () => clock,
    runAttempt: async input => {
      calls.push({ ...input });
      const step = steps[calls.length - 1];
      assert.ok(step, "controller must not start an unplanned attempt");
      assert.equal(input.origin, ORIGIN);
      assert.equal(input.releaseId, VERSION);
      assert.equal(input.attempt, calls.length);
      assert.ok(input.timeoutMs > WINDOW, "attempt has a complete window available");
      const record = step.record(input.attempt);
      const monitor = monitorFor(record);
      const invocation = { eventCount: record.invocationEvents, byteCount: record.invocationBytes,
        startedAt: "2026-09-15T00:00:00Z", finishedAt: "2026-09-15T00:30:00Z" };
      const server = { ...invocation, eventCount: record.handledServerErrorEvents, byteCount: record.handledServerErrorBytes };
      await Promise.all([
        writeFile(join(input.directory, "tail-health.json"), step.malformedHealth ?? JSON.stringify(record), { mode: 0o600 }),
        writeFile(join(input.directory, "monitor.json"), step.malformedMonitor ?? JSON.stringify(step.monitor ?? monitor), { mode: 0o600 }),
        writeFile(join(input.directory, "invocation-tail-aggregate.json"), JSON.stringify(step.invocation ?? invocation), { mode: 0o600 }),
        writeFile(join(input.directory, "server-tail-aggregate.json"), JSON.stringify(step.server ?? server), { mode: 0o600 }),
        writeFile(join(input.directory, "monitor-status.txt"), step.statusText ?? `public_regression=${record.publicRegression}\ntail_regression=${record.tailRegression}\n`, { mode: 0o600 }),
      ]);
      clock += step.advanceMs ?? record.observedDurationMs + 500;
      if (step.throwError) throw step.throwError;
      return { code: step.code ?? (record.infrastructureFailure || record.regression ? 1 : 0),
        signal: null, timedOut: false, interrupted: false, diagnosticBytes: 0, ...step.result };
    },
    ...options,
  };
}

test("controller accepts the first full window and publishes exactly that completed attempt", async () => {
  await fixture(async directory => {
    const process = processFixture([{ record: completed }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "passed");
    assert.equal(summary.acceptedAttempt, 1);
    assert.equal(process.calls.length, 1);
    assert.equal((await readJSON(join(directory, "tail-health.json"))).acceptedAttempt, 1);
    assert.equal((await readJSON(join(directory, "observation-history.json"))).attempts.length, 1);
    assert.deepEqual(await readJSON(join(directory, "monitor.json")), await readJSON(join(directory, "attempts/01/monitor.json")));
    assert.deepEqual(await readJSON(join(directory, "observation-summary.json")), summary);
  });
});

test("controller retains partial loss evidence and restarts a complete independent window", async () => {
  await fixture(async directory => {
    const process = processFixture([{ record: index => interrupted(index, 900_000) }, { record: completed }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "passed");
    assert.equal(summary.acceptedAttempt, 2);
    const history = await readJSON(join(directory, "observation-history.json"));
    assert.equal(history.attempts[0].observedDurationMs, 900_000);
    assert.equal(history.attempts[0].completedFullDuration, false);
    assert.equal(history.attempts[1].observedDurationMs, WINDOW);
    assert.notEqual(process.calls[0].directory, process.calls[1].directory);
    assert.equal((await readJSON(join(directory, "monitor.json"))).observedDurationMs, WINDOW);
    assert.equal((await readJSON(join(directory, "tail-health.json"))).attemptCount, 2);
  });
});

test("partial windows never combine into success; attempts and remaining budget stop recovery", async () => {
  for (const scenario of [
    { steps: [{ record: index => interrupted(index, 700_000) }, { record: index => interrupted(index, 700_000) },
      { record: index => interrupted(index, 700_000) }], count: 3, reason: "attempt_limit" },
    { steps: [{ record: index => interrupted(index, WINDOW), advanceMs: BUDGET - WINDOW - 29_999 }], count: 1, reason: "budget_exhausted" },
  ]) await fixture(async directory => {
    const process = processFixture(scenario.steps);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(summary.reason, scenario.reason);
    assert.equal(summary.acceptedAttempt, null);
    assert.equal(process.calls.length, scenario.count);
    assert.equal((await readJSON(join(directory, "observation-history.json"))).attempts.length, scenario.count);
  });
});

test("unknown warnings are terminal even alongside a classified connection loss", async () => {
  await fixture(async directory => {
    const process = processFixture([{ record: index => ({ ...interrupted(index), invocationStderr: unknown() }) }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(summary.reason, "unknown_stderr");
    assert.equal(process.calls.length, 1);
  });
});

test("public and late tail regressions survive malformed health evidence and supervisor failure", async () => {
  for (const scenario of [
    { statusText: "public_regression=true\ntail_regression=false\n", publicRegression: true },
    { statusText: "", monitor: { status: "failed", failureType: "public_regression" }, publicRegression: true,
      result: { code: 143, signal: "SIGTERM" } },
    { invocation: { eventCount: 1, byteCount: 400 }, tailRegression: true },
    { server: { eventCount: 1, byteCount: 50 }, tailRegression: true, result: { code: 143, signal: "SIGTERM" } },
  ]) await fixture(async directory => {
    const process = processFixture([{ record: interrupted, malformedHealth: "{ malformed", ...scenario }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(summary.regression, true);
    if (scenario.publicRegression) assert.equal(summary.publicRegression, true);
    if (scenario.tailRegression) assert.equal(summary.tailRegression, true);
    assert.equal(process.calls.length, 1);
    const outputs = join(directory, "outputs.txt");
    await writeObservationOutputs(outputs, summary);
    assert.match(await readFile(outputs, "utf8"), /^regression=true$/mu);
  });
});

test("a regression during a later attempt permanently ends recovery and keeps prior failed evidence", async () => {
  await fixture(async directory => {
    const process = processFixture([{ record: interrupted }, { record: index => ({ ...interrupted(index),
      handledServerErrorEvents: 1, handledServerErrorBytes: 300, tailRegression: true, regression: true }) }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(summary.regression, true);
    assert.equal(summary.tailRegression, true);
    assert.equal(process.calls.length, 2);
    const history = await readJSON(join(directory, "observation-history.json"));
    assert.equal(history.attempts[0].completedFullDuration, false);
    assert.equal(history.attempts[1].handledServerErrorEvents, 1);
  });
});

test("a closed record's aggregate regression flag remains sticky even with malformed extra fields", async () => {
  for (const extra of [{}, { unrecognized: "must reject without clearing regression" }]) await fixture(async directory => {
    const runtime = processFixture([{ record: index => ({ ...interrupted(index), regression: true, ...extra }) }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, runtime);
    assert.equal(summary.status, "failed");
    assert.equal(summary.regression, true);
    assert.equal(summary.infrastructureFailure, false);
    assert.equal(summary.publicRegression, false);
    assert.equal(summary.tailRegression, false);
    assert.equal(runtime.calls.length, 1);
  });
});

test("runner exit must agree with the closed evidence; timeouts never establish success", async () => {
  for (const scenario of [
    { record: completed, code: 1 }, { record: interrupted, code: 0 },
    { record: completed, result: { timedOut: true } }, { record: completed, result: { interrupted: true } },
    { record: completed, result: { code: 255 } },
  ]) await fixture(async directory => {
    const process = processFixture([scenario]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(summary.acceptedAttempt, null);
    assert.equal(process.calls.length, 1);
  });
});

test("unexpected outer-runner stderr cannot pass or authorize another attempt", async () => {
  for (const record of [completed, interrupted]) await fixture(async directory => {
    const process = processFixture([{ record, result: { diagnosticBytes: 7 } }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(process.calls.length, 1);
  });
});

test("stale attempt directories are rejected without overwriting retained release evidence", async () => {
  await fixture(async directory => {
    await mkdir(join(directory, "attempts/01"), { recursive: true });
    const original = '{"retained":"previous observation, do not replace"}\n';
    await writeFile(join(directory, "observation-history.json"), original);
    await writeFile(join(directory, "observation-summary.json"), original);
    const process = processFixture([]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(process.calls.length, 0);
    assert.equal(await readFile(join(directory, "observation-history.json"), "utf8"), original);
    assert.equal(await readFile(join(directory, "observation-summary.json"), "utf8"), original);
  });
});

test("a stale published monitor is rejected untouched even without an attempts directory", async () => {
  await fixture(async directory => {
    const original = '{"retained":"completed prior monitoring artifact"}\n';
    await writeFile(join(directory, "monitor.json"), original);
    const before = await readdir(directory);
    const process = processFixture([]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, process);
    assert.equal(summary.status, "failed");
    assert.equal(process.calls.length, 0);
    assert.equal(await readFile(join(directory, "monitor.json"), "utf8"), original);
    assert.deepEqual(await readdir(directory), before);
  });
});

test("environment credential sentinels and raw runner exceptions never enter generated summaries or outputs", async () => {
  await fixture(async directory => {
    const sentinel = "PRIVATE-CREDENTIAL-SENTINEL-DO-NOT-EMIT";
    const original = process.env.CF_DEPLOY_TOKEN;
    process.env.CF_DEPLOY_TOKEN = sentinel;
    try {
      const runtime = processFixture([{ record: interrupted, throwError: new Error(sentinel) }]);
      const summary = await observeRelease(ORIGIN, VERSION, directory, runtime);
      const outputs = join(directory, "outputs.txt");
      await writeObservationOutputs(outputs, summary);
      assert.equal(summary.status, "failed");
      for (const name of await readdir(directory)) {
        if (name === "attempts") continue;
        assert.equal((await readFile(join(directory, name), "utf8")).includes(sentinel), false);
      }
    } finally {
      if (original === undefined) delete process.env.CF_DEPLOY_TOKEN;
      else process.env.CF_DEPLOY_TOKEN = original;
    }
  });
});

test("malformed health is sanitized in both retained attempt evidence and safe history", async () => {
  for (const kind of ["extra-field", "invalid-json", "oversized", "wrong-index"]) await fixture(async directory => {
    const sentinel = "RAW-HEALTH-SECRET-SENTINEL";
    const step = kind === "extra-field" ? { record: index => ({ ...interrupted(index), arbitrary: sentinel }) }
      : kind === "wrong-index" ? { record: () => ({ ...interrupted(0), exactVersion: sentinel }) }
      : { record: interrupted, malformedHealth: kind === "invalid-json" ? `${sentinel}{ invalid` : `${sentinel}${"x".repeat(65_536)}` };
    const runtime = processFixture([step]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, runtime);
    assert.equal(summary.status, "failed");
    assert.equal(runtime.calls.length, 1);
    const history = await readFile(join(directory, "observation-history.json"), "utf8");
    assert.equal(history.includes(sentinel), false);
    const retained = await readFile(join(directory, "attempts/01/tail-health.json"), "utf8");
    assert.equal(retained.includes(sentinel), false);
    assert.ok(retained.length < 4096);
    assert.doesNotThrow(() => JSON.parse(retained));
  });
});

test("accepted monitor and tail artifacts must agree with the closed record before publication", async () => {
  const valid = completed(1);
  const monitor = monitorFor(valid);
  for (const mismatch of [
    { monitor: { ...monitor, releaseId: "22222222-2222-4222-8222-222222222222" } },
    { monitor: { ...monitor, observedDurationMs: WINDOW - 1 } },
    { monitor: { ...monitor, finalFencePassed: false, finalFenceReleaseId: null } },
    { monitor: { ...monitor, unknownField: "not part of monitor schema" } },
    { invocation: { eventCount: 0, byteCount: 100 } },
    { server: { eventCount: 0, byteCount: 1 } },
    { invocation: { eventCount: 0, byteCount: 0, startedAt: "2026-09-15T00:00:00Z", finishedAt: "2026-09-15T00:30:00Z", extra: true } },
    { server: { eventCount: 0, byteCount: 0, startedAt: "2026-09-15T00:30:01Z", finishedAt: "2026-09-15T00:30:02Z" } },
    { server: { eventCount: 0, byteCount: 0, startedAt: "2026-09-15T00:00:00Z", finishedAt: "2026-09-15T00:00:01Z" } },
    { malformedMonitor: "{ invalid" },
  ]) await fixture(async directory => {
    const runtime = processFixture([{ record: () => valid, ...mismatch }]);
    const summary = await observeRelease(ORIGIN, VERSION, directory, runtime);
    assert.equal(summary.status, "failed");
    assert.equal(summary.acceptedAttempt, null);
    assert.equal(runtime.calls.length, 1);
    assert.equal((await readdir(directory)).includes("monitor.json"), false, "inconsistent monitor is never published as accepted evidence");
  });
});
