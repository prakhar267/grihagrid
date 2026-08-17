#!/usr/bin/env node
import assert from "node:assert/strict";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function validateCanaryEnvironment(environment) {
  const value = String(environment);
  assert.ok(/^(?:staging|production)$/u.test(value), "invalid canary environment");
  return value;
}

export function normalizeCanaryEmail(value) {
  assert.equal(typeof value, "string", "canary email must be a string");
  const email = value.trim().toLowerCase();
  assert.ok(email.length > 0 && email.length <= 254, "canary email length is invalid");
  assert.ok(!CONTROL_CHARACTER_PATTERN.test(email), "canary email contains invalid characters");
  assert.ok(EMAIL_PATTERN.test(email), "canary email is invalid");
  return email;
}

function validateUuid(value, label) {
  assert.ok(typeof value === "string" && UUID_PATTERN.test(value), `${label} must be a canonical UUID`);
  return value;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function d1Rows(payload, label) {
  assert.ok(Array.isArray(payload), `${label} must contain D1 result batches`);
  assert.equal(payload.length, 1, `${label} must contain exactly one D1 result batch`);
  const [batch] = payload;
  assert.ok(batch && typeof batch === "object" && !Array.isArray(batch), `${label} contains an invalid D1 batch`);
  assert.equal(batch.success, true, `${label} contains a failed D1 batch`);
  assert.ok(Array.isArray(batch.results), `${label} D1 results are missing`);
  return batch.results;
}

function exactKeys(row, expected, label) {
  assert.ok(row && typeof row === "object" && !Array.isArray(row), `${label} contains an invalid row`);
  const actual = Object.keys(row).sort();
  const reviewed = [...expected].sort();
  assert.ok(actual.length === reviewed.length && actual.every((key, index) => key === reviewed[index]), `${label} row shape is invalid`);
}

export function parseCanarySessionSnapshot(payload, label = "canary session snapshot") {
  const rows = d1Rows(payload, label);
  const users = [];
  const sessions = [];

  for (const row of rows) {
    exactKeys(row, ["record_type", "id"], label);
    if (row.record_type === "user") {
      users.push(validateUuid(row.id, `${label} user identifier`));
    } else if (row.record_type === "session") {
      sessions.push(validateUuid(row.id, `${label} session identifier`));
    } else {
      assert.fail(`${label} contains an unexpected record type`);
    }
  }

  assert.equal(users.length, 1, `${label} must identify exactly one active canary user`);
  assert.equal(new Set(sessions).size, sessions.length, `${label} contains duplicate session identifiers`);
  return Object.freeze({
    userId: users[0],
    sessionIds: Object.freeze([...sessions].sort()),
  });
}

function parseCleanupResult(payload) {
  const rows = d1Rows(payload, "canary session cleanup");
  const sessionIds = rows.map((row) => {
    exactKeys(row, ["id"], "canary session cleanup");
    return validateUuid(row.id, "canary session cleanup identifier");
  });
  assert.equal(new Set(sessionIds).size, sessionIds.length, "canary session cleanup contains duplicate identifiers");
  return sessionIds.sort();
}

function sameSet(actual, expected, message) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  assert.ok(
    actualSet.size === actual.length
      && expectedSet.size === expected.length
      && actualSet.size === expectedSet.size
      && [...actualSet].every((value) => expectedSet.has(value)),
    message,
  );
}

function newSessionIds(before, observed) {
  assert.ok(observed.userId === before.userId, "canary user changed between session snapshots");
  const baseline = new Set(before.sessionIds);
  return observed.sessionIds.filter((id) => !baseline.has(id)).sort();
}

export function buildCanarySessionSnapshotSql({ environment, email }) {
  validateCanaryEnvironment(environment);
  const normalizedEmail = normalizeCanaryEmail(email);
  const emailLiteral = sqlLiteral(normalizedEmail);
  return [
    "WITH canary_user AS (",
    "  SELECT id",
    "    FROM users",
    `   WHERE email = ${emailLiteral}`,
    "     AND deleted_at IS NULL",
    ")",
    "SELECT 'user' AS record_type, id",
    "  FROM canary_user",
    "UNION ALL",
    "SELECT 'session' AS record_type, sessions.id",
    "  FROM sessions",
    "  JOIN canary_user ON canary_user.id = sessions.user_id",
    "ORDER BY record_type, id;",
    "",
  ].join("\n");
}

export function buildCanarySessionCleanupSql({
  environment,
  email,
  beforePayload,
  observedPayload,
}) {
  validateCanaryEnvironment(environment);
  const normalizedEmail = normalizeCanaryEmail(email);
  const before = parseCanarySessionSnapshot(beforePayload, "baseline canary session snapshot");
  const observed = parseCanarySessionSnapshot(observedPayload, "observed canary session snapshot");
  const delta = newSessionIds(before, observed);
  const userId = sqlLiteral(before.userId);
  const emailLiteral = sqlLiteral(normalizedEmail);
  const deltaPredicate = delta.length > 0
    ? `id IN (${delta.map(sqlLiteral).join(",")})`
    : "0 = 1";

  return [
    "DELETE FROM sessions",
    ` WHERE ${deltaPredicate}`,
    `   AND user_id = ${userId}`,
    "   AND EXISTS (",
    "     SELECT 1",
    "       FROM users",
    `      WHERE users.id = ${userId}`,
    `        AND users.email = ${emailLiteral}`,
    "        AND users.deleted_at IS NULL",
    "   )",
    "RETURNING id;",
    "",
  ].join("\n");
}

export function verifyCanarySessionCleanupEvidence({
  environment,
  beforePayload,
  observedPayload,
  cleanupPayload,
  finalPayload,
}) {
  const validatedEnvironment = validateCanaryEnvironment(environment);
  const before = parseCanarySessionSnapshot(beforePayload, "baseline canary session snapshot");
  const observed = parseCanarySessionSnapshot(observedPayload, "observed canary session snapshot");
  const delta = newSessionIds(before, observed);
  const removed = parseCleanupResult(cleanupPayload);
  const final = parseCanarySessionSnapshot(finalPayload, "final canary session snapshot");

  assert.ok(final.userId === before.userId, "canary user changed after session cleanup");
  sameSet(removed, delta, "canary session cleanup did not delete the exact new-session delta");
  sameSet(final.sessionIds, before.sessionIds, "canary session cleanup did not restore the exact baseline");

  return {
    environment: validatedEnvironment,
    checkedAt: new Date().toISOString(),
    baselineSessions: before.sessionIds.length,
    observedSessions: observed.sessionIds.length,
    newSessions: delta.length,
    removedSessions: removed.length,
    finalSessions: final.sessionIds.length,
    restoredExactly: true,
  };
}

export function verifyRetryableLateCanarySessionArrival({
  beforePayload,
  observedPayload,
  cleanupPayload,
  finalPayload,
}) {
  const before = parseCanarySessionSnapshot(beforePayload, "baseline canary session snapshot");
  const observed = parseCanarySessionSnapshot(observedPayload, "observed canary session snapshot");
  const delta = newSessionIds(before, observed);
  const removed = parseCleanupResult(cleanupPayload);
  const final = parseCanarySessionSnapshot(finalPayload, "final canary session snapshot");
  assert.ok(final.userId === before.userId, "canary user changed after session cleanup");
  sameSet(removed, delta, "canary session cleanup did not delete the exact new-session delta");
  const baseline = new Set(before.sessionIds);
  const observedIds = new Set(observed.sessionIds);
  assert.ok(before.sessionIds.every((id) => final.sessionIds.includes(id)), "canary session cleanup lost a baseline session");
  const late = final.sessionIds.filter((id) => !baseline.has(id));
  assert.ok(late.length > 0, "canary session cleanup has no retryable late arrival");
  assert.ok(late.every((id) => !observedIds.has(id)), "canary session cleanup retained an already-observed session");
  return { retryableLateArrival: true, lateSessions: late.length };
}

const CLEANUP_EVIDENCE_KEYS = Object.freeze([
  "environment",
  "checkedAt",
  "baselineSessions",
  "observedSessions",
  "newSessions",
  "removedSessions",
  "finalSessions",
  "restoredExactly",
]);

const ACCUMULATED_EVIDENCE_KEYS = Object.freeze([
  ...CLEANUP_EVIDENCE_KEYS,
  "reconciliationPasses",
  "stabilizedForMs",
  "totalNewSessions",
  "totalRemovedSessions",
]);

function exactEvidenceKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} is invalid`);
  const actual = Object.keys(value).sort();
  const reviewed = [...expected].sort();
  assert.ok(actual.length === reviewed.length && actual.every((key, index) => key === reviewed[index]), `${label} shape is invalid`);
}

function nonnegativeInteger(value, label) {
  const number = Number(value);
  assert.ok(Number.isSafeInteger(number) && number >= 0, `${label} is invalid`);
  return number;
}

export function accumulateCanarySessionCleanupEvidence({
  currentEvidence,
  previousEvidence = null,
  reconciliationPass,
  stabilizedForMs,
}) {
  exactEvidenceKeys(currentEvidence, CLEANUP_EVIDENCE_KEYS, "current canary session cleanup evidence");
  const pass = nonnegativeInteger(reconciliationPass, "canary session reconciliation pass");
  const stabilized = nonnegativeInteger(stabilizedForMs, "canary session stabilization duration");
  assert.ok(pass >= 1, "canary session reconciliation pass is invalid");
  assert.ok(currentEvidence.restoredExactly === true, "current canary session cleanup is unverified");
  const currentNew = nonnegativeInteger(currentEvidence.newSessions, "current new-session count");
  const currentRemoved = nonnegativeInteger(currentEvidence.removedSessions, "current removed-session count");
  assert.ok(currentNew === currentRemoved, "current canary session cleanup counts differ");

  if (previousEvidence === null) {
    assert.ok(pass === 1, "first canary session reconciliation metadata is invalid");
    return {
      ...currentEvidence,
      reconciliationPasses: 1,
      stabilizedForMs: stabilized,
      totalNewSessions: currentNew,
      totalRemovedSessions: currentRemoved,
    };
  }

  exactEvidenceKeys(previousEvidence, ACCUMULATED_EVIDENCE_KEYS, "previous canary session cleanup evidence");
  const previousPasses = nonnegativeInteger(previousEvidence.reconciliationPasses, "previous canary session reconciliation pass count");
  const previousStabilized = nonnegativeInteger(previousEvidence.stabilizedForMs, "previous canary session stabilization duration");
  const previousNew = nonnegativeInteger(previousEvidence.totalNewSessions, "previous total new-session count");
  const previousRemoved = nonnegativeInteger(previousEvidence.totalRemovedSessions, "previous total removed-session count");
  assert.ok(previousEvidence.restoredExactly === true, "previous canary session cleanup is unverified");
  assert.ok(previousEvidence.environment === currentEvidence.environment, "canary session cleanup environment changed");
  assert.ok(previousEvidence.baselineSessions === currentEvidence.baselineSessions, "canary session baseline count changed");
  assert.ok(pass === previousPasses + 1, "canary session reconciliation pass sequence is invalid");
  assert.ok(stabilized >= previousStabilized, "canary session stabilization duration moved backwards");
  assert.ok(previousNew === previousRemoved, "previous canary session cleanup counts differ");

  return {
    ...currentEvidence,
    reconciliationPasses: pass,
    stabilizedForMs: stabilized,
    totalNewSessions: previousNew + currentNew,
    totalRemovedSessions: previousRemoved + currentRemoved,
  };
}

function readJson(filename) {
  try {
    return JSON.parse(readFileSync(filename, "utf8"));
  } catch {
    throw new Error("canary session evidence JSON is unreadable");
  }
}

function writePrivateSql(filename, sql) {
  writeFileSync(filename, sql, { mode: 0o600 });
  chmodSync(filename, 0o600);
}

function writeJson(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  throw new Error("usage: canary-session-fence.mjs query-sql|validate-snapshot|cleanup-sql|proof <environment> <evidence files...>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, environment, ...files] = process.argv.slice(2);
  validateCanaryEnvironment(environment);
  if (mode === "query-sql" && files.length === 1) {
    const [output] = files;
    writePrivateSql(output, buildCanarySessionSnapshotSql({
      environment,
      email: process.env.GRIHAGRID_CANARY_EMAIL,
    }));
  } else if (mode === "validate-snapshot" && files.length === 1) {
    parseCanarySessionSnapshot(readJson(files[0]));
  } else if (mode === "cleanup-sql" && files.length === 3) {
    const [before, observed, output] = files;
    writePrivateSql(output, buildCanarySessionCleanupSql({
      environment,
      email: process.env.GRIHAGRID_CANARY_EMAIL,
      beforePayload: readJson(before),
      observedPayload: readJson(observed),
    }));
  } else if (mode === "proof" && files.length === 5) {
    const [before, observed, cleanup, final, output] = files;
    const beforePayload = readJson(before);
    const observedPayload = readJson(observed);
    const cleanupPayload = readJson(cleanup);
    const finalPayload = readJson(final);
    let currentEvidence;
    try {
      currentEvidence = verifyCanarySessionCleanupEvidence({
        environment,
        beforePayload,
        observedPayload,
        cleanupPayload,
        finalPayload,
      });
    } catch (error) {
      if (process.env.CANARY_SESSION_ALLOW_LATE_RETRY === "true") {
        verifyRetryableLateCanarySessionArrival({
          beforePayload,
          observedPayload,
          cleanupPayload,
          finalPayload,
        });
        process.exit(75);
      }
      throw error;
    }
    const previousProof = process.env.CANARY_SESSION_PREVIOUS_PROOF
      ? readJson(process.env.CANARY_SESSION_PREVIOUS_PROOF)
      : null;
    writeJson(output, accumulateCanarySessionCleanupEvidence({
      currentEvidence,
      previousEvidence: previousProof,
      reconciliationPass: process.env.CANARY_SESSION_RECONCILIATION_PASS ?? 1,
      stabilizedForMs: process.env.CANARY_SESSION_STABILIZED_FOR_MS ?? 0,
    }));
  } else {
    usage();
  }
}
