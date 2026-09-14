import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { decideReleaseObservation, validateClosedObservationAttempt, OBSERVATION_DURATION_MS as WINDOW, OBSERVATION_BUDGET_MS as BUDGET,
  OBSERVATION_START_RESERVE_MS as RESERVE } from "../scripts/release-observation-policy.mjs";

const VERSION = "11111111-1111-4111-8111-111111111111";
const OTHER_VERSION = "22222222-2222-4222-8222-222222222222";
const script = fileURLToPath(new URL("../scripts/release-observation-policy.mjs", import.meta.url));
const empty = () => ({ byteCount: 0, ignoredProxyWarning: false, unexpected: false,
  diagnosticClasses: [], recognizedWarningCount: 0, hasUnrecognizedContent: false });
const loss = () => ({ byteCount: 118, ignoredProxyWarning: false, unexpected: true,
  diagnosticClasses: ["wrangler_tail_keepalive_timeout"], recognizedWarningCount: 1, hasUnrecognizedContent: false });
const unknown = () => ({ byteCount: 118, ignoredProxyWarning: false, unexpected: true,
  diagnosticClasses: ["unrecognized_stderr"], recognizedWarningCount: 0, hasUnrecognizedContent: true });

function clean(attempt = 1) {
  return { attempt, closed: true, monitorStatus: 0, exactVersion: VERSION, configuredDurationMs: WINDOW,
    observedDurationMs: WINDOW, completedFullDuration: true, finalFencePassed: true, finalFenceReleaseId: VERSION,
    publicRegression: false, tailRegression: false, invocationEvents: 0, invocationBytes: 0,
    handledServerErrorEvents: 0, handledServerErrorBytes: 0, tailsAliveThroughPublicMonitor: true,
    invocationProcessExit: 143, serverProcessExit: 143, tailsStoppedByOperator: true, regression: false,
    infrastructureFailure: false, invocationStderr: empty(), serverStderr: empty() };
}
function interrupted(attempt = 1, elapsed = 10_000) {
  return { ...clean(attempt), monitorStatus: 2, observedDurationMs: elapsed, completedFullDuration: false,
    finalFencePassed: false, finalFenceReleaseId: null, infrastructureFailure: true, serverStderr: loss() };
}
const decide = (attempts, elapsedMs = attempts.reduce((sum, value) => sum + value.observedDurationMs, 0), extra = {}) =>
  decideReleaseObservation({ attempts }, { expectedReleaseId: VERSION, elapsedMs, ...extra });

test("closed-record validation is safe before persistence and uses a one-based attempt index", () => {
  const options = { attemptIndex: 1, expectedReleaseId: VERSION };
  assert.equal(validateClosedObservationAttempt(clean(), options), true);
  assert.equal(validateClosedObservationAttempt(interrupted(), options), true);
  assert.equal(validateClosedObservationAttempt(clean(2), { ...options, attemptIndex: 2 }), true);
  for (const record of [null, {}, { ...clean(), rawSecret: "must-not-be-copied" }, { ...clean(), observedDurationMs: "secret" }]) {
    assert.equal(validateClosedObservationAttempt(record, options), false);
  }
  for (const patch of [{ attemptIndex: 0 }, { attemptIndex: 4 }, { expectedReleaseId: OTHER_VERSION }, { durationMs: WINDOW - 1 }]) {
    assert.equal(validateClosedObservationAttempt(clean(), { ...options, ...patch }), false);
  }
});

test("a release needs one complete fresh30-minute window, not combined partial coverage", () => {
  assert.equal(decide([]).decision, "retry");
  const partials = [interrupted(1, 900_000), interrupted(2, 900_000)];
  const partial = decide(partials);
  assert.equal(partial.decision, "retry");
  assert.equal(partial.nextAttempt, 3);
  assert.equal(decide([...partials, clean(3)]).decision, "success");
  assert.equal(decide([clean()]).reason, "continuous_window_complete");
});

test("recognized stderr found on final drain invalidates that full window and permits only a new one", () => {
  const lateLoss = { ...clean(), infrastructureFailure: true, serverStderr: loss() };
  assert.equal(decide([lateLoss]).decision, "retry");
  assert.equal(decide([lateLoss, clean(2)], WINDOW * 2 + 1_000).decision, "success");
  assert.equal(decide([lateLoss, interrupted(2)], BUDGET - WINDOW - RESERVE + 1).reason, "budget_exhausted");
});

test("every positive application/public signal is sticky across all attempts and tail-drain races", () => {
  const positives = [
    { publicRegression: true }, { tailRegression: true }, { regression: true }, { monitorStatus: 1 },
    { invocationEvents: 1, invocationBytes: 1 }, { handledServerErrorEvents: 1, handledServerErrorBytes: 500 },
  ];
  for (const signal of positives) {
    const concurrent = { ...interrupted(), ...signal };
    assert.equal(decide([concurrent]).reason, "application_regression");
    assert.equal(decide([concurrent, clean(2)]).decision, "failure");
    const late = { ...clean(), infrastructureFailure: true, serverStderr: loss(), ...signal };
    assert.equal(decide([late]).reason, "application_regression");
  }
  const malformedSibling = { ...interrupted(), closed: false };
  assert.equal(decide([malformedSibling, { ...clean(2), invocationEvents: 1, invocationBytes: 10 }]).reason, "application_regression");
});

test("unknown, mixed, authentication and missing diagnostic evidence never authorize retry", () => {
  const mixed = { ...loss(), diagnosticClasses: ["wrangler_tail_keepalive_timeout", "unrecognized_stderr"], hasUnrecognizedContent: true };
  for (const stderr of [unknown(), mixed, { ...unknown(), diagnosticClasses: ["authentication_failure"] }]) {
    assert.equal(decide([{ ...interrupted(), invocationStderr: stderr }]).decision, "failure");
  }
  // The original118/236-byte-only evidence cannot be upgraded to a known loss.
  for (const byteCount of [118, 236]) {
    const oldEvidence = { byteCount, ignoredProxyWarning: false, unexpected: true };
    assert.equal(decide([{ ...interrupted(), serverStderr: oldEvidence }]).reason, "invalid_evidence");
  }
  assert.equal(decide([{ ...interrupted(), serverStderr: unknown() }, clean(2)]).decision, "failure");
});

test("only classified transport loss permits retry; silent death and unsuccessful cleanup are terminal", () => {
  for (const patch of [
    { invocationProcessExit: 0 }, { serverProcessExit: 1 }, { serverProcessExit: 130 },
    { tailsStoppedByOperator: false }, { closed: false },
    { serverStderr: empty(), tailsAliveThroughPublicMonitor: false },
  ]) assert.equal(decide([{ ...interrupted(), ...patch }]).decision, "failure");
  const completedCleanupAfterLoss = { ...interrupted(), tailsAliveThroughPublicMonitor: false };
  assert.equal(decide([completedCleanupAfterLoss]).decision, "retry");
});

test("the start budget reserves a complete30-minute window plus30seconds, with max3 attempts", () => {
  assert.equal(decide([], BUDGET - WINDOW - RESERVE).decision, "retry");
  assert.equal(decide([], BUDGET - WINDOW - RESERVE + 1).reason, "budget_exhausted");
  assert.equal(decide([interrupted(1), interrupted(2), interrupted(3)]).reason, "attempt_limit");
  assert.equal(decide([interrupted(1), interrupted(2), clean(3)]).decision, "success");
  assert.equal(decide([interrupted(1), interrupted(2), interrupted(3), clean(4)]).reason, "attempt_limit");
  assert.equal(decide([clean()], BUDGET).decision, "success");
  assert.equal(decide([clean()], BUDGET + 1).reason, "budget_exhausted");
});

test("version, final fence, elapsed monotonic duration and history order are mandatory", () => {
  for (const patch of [
    { exactVersion: OTHER_VERSION }, { finalFenceReleaseId: OTHER_VERSION },
    { finalFencePassed: false, finalFenceReleaseId: null }, { observedDurationMs: WINDOW - 1 },
    { configuredDurationMs: WINDOW - 1 }, { completedFullDuration: false }, { attempt: 2 },
  ]) assert.equal(decide([{ ...clean(), ...patch }]).decision, "failure");
  assert.equal(decide([clean()], WINDOW - 1).reason, "invalid_evidence");
  assert.equal(decide([clean(), clean(2)]).reason, "invalid_history");
  assert.equal(decide([interrupted(), clean(3)]).reason, "invalid_evidence");
  assert.equal(decide([], 0, { durationMs: WINDOW - 1 }).reason, "invalid_evidence");
});

test("missing, nonboolean, unsafe numeric and inconsistent aggregate evidence fail closed", () => {
  for (const history of [undefined, null, {}, { attempts: null }, { attempts: [] , extra: "secret" }]) {
    assert.equal(decideReleaseObservation(history, { expectedReleaseId: VERSION, elapsedMs: 0 }).decision, "failure");
  }
  for (const patch of [
    { invocationEvents: -1 }, { invocationBytes: Number.MAX_SAFE_INTEGER + 1 }, { invocationBytes: 1 },
    { serverProcessExit: "143" }, { observedDurationMs: Infinity }, { infrastructureFailure: "false" },
    { serverStderr: { ...loss(), unexpected: false } },
    { serverStderr: { ...loss(), recognizedWarningCount: 0 } },
    { serverStderr: { ...loss(), diagnosticClasses: ["wrangler_tail_keepalive_timeout", "wrangler_tail_keepalive_timeout"] } },
    { serverStderr: { ...loss(), byteCount: 4_097 } },
  ]) assert.equal(decide([{ ...interrupted(), ...patch }]).decision, "failure");
  const missing = clean(); delete missing.finalFencePassed;
  assert.equal(decide([missing]).reason, "invalid_evidence");
});

test("a narrowly classified harmless proxy notice keeps existing clean-window behavior", () => {
  const proxy = { ...empty(), byteCount: 118, ignoredProxyWarning: true };
  assert.equal(decide([{ ...clean(), invocationStderr: proxy }]).decision, "success");
  assert.equal(decide([{ ...interrupted(), invocationStderr: proxy }]).decision, "retry");
});

test("CLI emits bounded decisions without revealing path, raw diagnostics or arbitrary exception content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "release-observation-policy-"));
  const path = join(directory, "private-marker-history.json");
  const run = () => spawnSync(process.execPath, [script, path, VERSION, String(WINDOW)], { encoding: "utf8" });
  try {
    const source = JSON.stringify({ attempts: [clean()] });
    await writeFile(path, source, { mode: 0o600 });
    const success = run();
    assert.equal(success.status, 0);
    assert.equal(JSON.parse(success.stdout).decision, "success");
    assert.equal(await readFile(path, "utf8"), source, "policy is read-only");
    for (const body of ["secret-raw-diagnostic", JSON.stringify({ attempts: [{ ...clean(), rawSecret: "private-marker" }] }), "x".repeat(65_537)]) {
      await writeFile(path, body, { mode: 0o600 });
      const failed = run();
      assert.equal(failed.status, 1);
      assert.equal(JSON.parse(failed.stdout).decision, "failure");
      assert.equal(failed.stderr, "");
      assert.doesNotMatch(failed.stdout, /private-marker|secret-raw|diagnostic|history\.json/u);
      assert.ok(failed.stdout.length < 256);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
