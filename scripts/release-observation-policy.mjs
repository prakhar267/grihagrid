#!/usr/bin/env node
import { open } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export const OBSERVATION_DURATION_MS = 1_800_000;
export const OBSERVATION_BUDGET_MS = 4_200_000;
export const OBSERVATION_START_RESERVE_MS = 30_000;
export const OBSERVATION_MAX_ATTEMPTS = 3;

const VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const TRANSIENT_CLASSES = new Set(["wrangler_tail_keepalive_timeout", "wrangler_tail_reconnect"]);
const STDERR_CLASSES = new Set([...TRANSIENT_CLASSES, "unrecognized_stderr"]);
const MAX_HISTORY_BYTES = 65_536;
const ATTEMPT_KEYS = [
  "attempt", "closed", "monitorStatus", "exactVersion", "configuredDurationMs", "observedDurationMs",
  "completedFullDuration", "finalFencePassed", "finalFenceReleaseId", "publicRegression", "tailRegression",
  "invocationEvents", "invocationBytes", "handledServerErrorEvents", "handledServerErrorBytes",
  "tailsAliveThroughPublicMonitor", "invocationProcessExit", "serverProcessExit", "tailsStoppedByOperator",
  "regression", "infrastructureFailure", "invocationStderr", "serverStderr",
];
const STDERR_KEYS = ["byteCount", "ignoredProxyWarning", "unexpected", "diagnosticClasses", "recognizedWarningCount", "hasUnrecognizedContent"];
const BOOLEAN_KEYS = ["completedFullDuration", "finalFencePassed", "publicRegression", "tailRegression",
  "tailsAliveThroughPublicMonitor", "tailsStoppedByOperator", "regression", "infrastructureFailure"];

function objectWithKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => Object.hasOwn(value, key));
}

function count(value) { return Number.isSafeInteger(value) && value >= 0; }

function validStderr(value) {
  if (!objectWithKeys(value, STDERR_KEYS) || !count(value.byteCount) || !count(value.recognizedWarningCount)
    || typeof value.ignoredProxyWarning !== "boolean" || typeof value.unexpected !== "boolean"
    || typeof value.hasUnrecognizedContent !== "boolean" || !Array.isArray(value.diagnosticClasses)
    || value.diagnosticClasses.length > STDERR_CLASSES.size
    || new Set(value.diagnosticClasses).size !== value.diagnosticClasses.length
    || value.diagnosticClasses.some(label => !STDERR_CLASSES.has(label))) return false;

  const knownClasses = value.diagnosticClasses.filter(label => TRANSIENT_CLASSES.has(label));
  if (value.hasUnrecognizedContent !== value.diagnosticClasses.includes("unrecognized_stderr")
    || value.recognizedWarningCount < knownClasses.length
    || (knownClasses.length === 0 && value.recognizedWarningCount !== 0)
    || value.recognizedWarningCount > value.byteCount) return false;

  if (value.byteCount === 0) return !value.ignoredProxyWarning && !value.unexpected
    && value.diagnosticClasses.length === 0 && !value.hasUnrecognizedContent;
  if (value.ignoredProxyWarning) return !value.unexpected && value.byteCount <= 4096
    && value.diagnosticClasses.length === 0 && !value.hasUnrecognizedContent;
  return value.unexpected && (value.hasUnrecognizedContent || knownClasses.length > 0)
    && (value.byteCount <= 4096 || value.hasUnrecognizedContent);
}

function validAttempt(value, index, version, durationMs) {
  return objectWithKeys(value, ATTEMPT_KEYS) && value.attempt === index + 1 && value.closed === true
    && [0, 1, 2].includes(value.monitorStatus) && value.exactVersion === version
    && value.configuredDurationMs === durationMs && count(value.observedDurationMs)
    && BOOLEAN_KEYS.every(key => typeof value[key] === "boolean")
    && ["invocationEvents", "invocationBytes", "handledServerErrorEvents", "handledServerErrorBytes",
      "invocationProcessExit", "serverProcessExit"].every(key => count(value[key]))
    && value.invocationProcessExit <= 255 && value.serverProcessExit <= 255
    && value.invocationEvents <= value.invocationBytes && value.handledServerErrorEvents <= value.handledServerErrorBytes
    && (value.invocationEvents === 0) === (value.invocationBytes === 0)
    && (value.handledServerErrorEvents === 0) === (value.handledServerErrorBytes === 0)
    && (value.finalFencePassed ? value.finalFenceReleaseId === version : value.finalFenceReleaseId === null)
    && (value.monitorStatus === 0
      ? value.completedFullDuration && value.observedDurationMs >= durationMs && value.finalFencePassed
      : !value.completedFullDuration && !value.finalFencePassed)
    && validStderr(value.invocationStderr) && validStderr(value.serverStderr);
}

/** Validate before copying a closed record into public aggregate evidence.
 * attemptIndex is one-based, matching the trusted attempt runner argument. */
export function validateClosedObservationAttempt(record, { attemptIndex, expectedReleaseId, durationMs = OBSERVATION_DURATION_MS } = {}) {
  return Number.isSafeInteger(attemptIndex) && attemptIndex >= 1 && attemptIndex <= OBSERVATION_MAX_ATTEMPTS
    && typeof expectedReleaseId === "string" && VERSION.test(expectedReleaseId)
    && Number.isSafeInteger(durationMs) && durationMs >= OBSERVATION_DURATION_MS
    && durationMs + OBSERVATION_START_RESERVE_MS <= OBSERVATION_BUDGET_MS
    && validAttempt(record, attemptIndex - 1, expectedReleaseId, durationMs);
}

function hasRegression(attempt) {
  return attempt?.publicRegression === true || attempt?.tailRegression === true || attempt?.regression === true
    || (count(attempt?.invocationEvents) && attempt.invocationEvents > 0)
    || (count(attempt?.handledServerErrorEvents) && attempt.handledServerErrorEvents > 0)
    || attempt?.monitorStatus === 1;
}

function classifyClosedAttempt(attempt) {
  if (!attempt.tailsStoppedByOperator || attempt.invocationProcessExit !== 143 || attempt.serverProcessExit !== 143) {
    return "cleanup_failure";
  }
  const diagnostics = [attempt.invocationStderr, attempt.serverStderr];
  if (diagnostics.some(value => value.hasUnrecognizedContent)) return "unknown_stderr";
  const transient = diagnostics.some(value => value.unexpected && value.recognizedWarningCount > 0
    && value.diagnosticClasses.every(label => TRANSIENT_CLASSES.has(label)));
  if (transient) {
    // Recognized transport loss is still a failed attempt, including a warning
    // discovered during final drain after otherwise successful public checks.
    return attempt.infrastructureFailure ? "transient_connection_loss" : "inconsistent_evidence";
  }
  if (diagnostics.some(value => value.unexpected) || attempt.infrastructureFailure) return "infrastructure_failure";
  if (!attempt.tailsAliveThroughPublicMonitor || attempt.monitorStatus !== 0 || !attempt.completedFullDuration
    || attempt.observedDurationMs < attempt.configuredDurationMs || !attempt.finalFencePassed) return "incomplete_window";
  return "clean_window";
}

/** Decide only from fully drained attempts. No request, tail, credential or raw
 * diagnostic crosses this policy boundary; failure reasons are fixed enums. */
export function decideReleaseObservation(history, { expectedReleaseId, elapsedMs, durationMs = OBSERVATION_DURATION_MS } = {}) {
  let attempts = 0;
  const remainingMs = count(elapsedMs) ? Math.max(0, OBSERVATION_BUDGET_MS - elapsedMs) : 0;
  const result = (decision, reason) => ({ decision, reason, attempts, remainingMs,
    ...(decision === "retry" ? { nextAttempt: attempts + 1 } : {}) });

  if (typeof expectedReleaseId !== "string" || !VERSION.test(expectedReleaseId) || !count(elapsedMs)
    || !Number.isSafeInteger(durationMs) || durationMs < OBSERVATION_DURATION_MS
    || durationMs + OBSERVATION_START_RESERVE_MS > OBSERVATION_BUDGET_MS
    || !objectWithKeys(history, ["attempts"]) || !Array.isArray(history.attempts)) return result("failure", "invalid_evidence");

  attempts = Math.min(history.attempts.length, OBSERVATION_MAX_ATTEMPTS);
  // A concurrent positive event cannot be hidden by a transient on the other
  // stream, a malformed sibling record, or a later apparently healthy attempt.
  if (history.attempts.some(hasRegression)) return result("failure", "application_regression");
  if (history.attempts.length > OBSERVATION_MAX_ATTEMPTS) return result("failure", "attempt_limit");
  let observedMs = 0;
  for (const [index, attempt] of history.attempts.entries()) {
    if (!validAttempt(attempt, index, expectedReleaseId, durationMs)) return result("failure", "invalid_evidence");
    observedMs += attempt.observedDurationMs;
    if (!Number.isSafeInteger(observedMs) || observedMs > elapsedMs) return result("failure", "invalid_evidence");
    const classification = classifyClosedAttempt(attempt);
    if (classification === "clean_window") {
      if (index !== history.attempts.length - 1) return result("failure", "invalid_history");
      return elapsedMs <= OBSERVATION_BUDGET_MS ? result("success", "continuous_window_complete") : result("failure", "budget_exhausted");
    }
    if (classification !== "transient_connection_loss") return result("failure", classification);
  }
  if (attempts >= OBSERVATION_MAX_ATTEMPTS) return result("failure", "attempt_limit");
  if (remainingMs < durationMs + OBSERVATION_START_RESERVE_MS) return result("failure", "budget_exhausted");
  return result("retry", attempts === 0 ? "initial_window" : "transient_connection_loss");
}

async function main() {
  const [historyPath, expectedReleaseId, elapsed, duration = String(OBSERVATION_DURATION_MS), ...extra] = process.argv.slice(2);
  if (!historyPath || extra.length || !/^\d+$/u.test(elapsed || "") || !/^\d+$/u.test(duration)) throw new Error("invalid arguments");
  const handle = await open(historyPath, "r");
  let history;
  try {
    // A fixed read also bounds allocation if a file grows after being opened.
    const buffer = Buffer.alloc(MAX_HISTORY_BYTES + 1);
    let bytesRead = 0;
    while (bytesRead < buffer.length) {
      const chunk = await handle.read(buffer, bytesRead, buffer.length - bytesRead, bytesRead);
      if (chunk.bytesRead === 0) break;
      bytesRead += chunk.bytesRead;
    }
    if (bytesRead > MAX_HISTORY_BYTES) throw new Error("history too large");
    history = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead)));
  } finally { await handle.close(); }
  const result = decideReleaseObservation(history, { expectedReleaseId, elapsedMs: Number(elapsed), durationMs: Number(duration) });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (result.reason === "invalid_evidence") process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify({ decision: "failure", reason: "invalid_evidence", attempts: 0, remainingMs: 0 })}\n`);
    process.exitCode = 1;
  });
}
