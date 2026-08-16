#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash, pbkdf2Sync, randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const COUNTED_ENTITIES = Object.freeze([
  "users",
  "sessions",
  "projects",
  "reports",
  "orders",
  "payment_webhook_events",
]);

const CREDENTIAL_EVIDENCE_ALGORITHM = "PBKDF2-SHA256";
const CREDENTIAL_EVIDENCE_ITERATIONS = 100_000;
const CREDENTIAL_EVIDENCE_SALT_BYTES = 16;

const REQUIRED_0013_OBJECTS = Object.freeze([
  "table:report_feedback",
  "index:idx_report_feedback_updated",
  "index:idx_report_feedback_outcome",
  "trigger:report_feedback_insert_guard",
  "trigger:report_feedback_update_guard",
  "trigger:project_input_allowlist_insert_guard",
  "trigger:project_input_allowlist_update_guard",
  "trigger:project_account_limit_insert_guard",
]);

const REQUIRED_0014_OBJECTS = Object.freeze([
  "index:idx_projects_user_creation_key",
]);

const REQUIRED_0015_OBJECTS = Object.freeze([
  "table:password_change_attempt_counters",
  "index:idx_password_change_attempts_updated",
  "trigger:users_auth_state_update_guard",
  "trigger:session_auth_state_immutable",
]);

const REQUIRED_BASELINE_OBJECTS = Object.freeze([
  "table:users",
  "table:projects",
  "table:orders",
  "table:project_revisions",
  "index:idx_project_revisions_owner_created",
  "trigger:project_revisions_immutable_update",
  "trigger:archived_project_revision_insert_guard",
  "trigger:purchased_report_snapshots_immutable_update",
]);

const REQUIRED_COLUMNS = Object.freeze([
  "users:id", "users:email", "users:password_hash", "users:password_salt", "users:password_iterations", "users:password_algorithm",
  "users:auth_generation", "users:auth_revision_id", "users:password_changed_at",
  "sessions:id", "sessions:user_id", "sessions:token_hash", "sessions:csrf_hash", "sessions:auth_generation", "sessions:auth_revision_id",
  "password_change_attempt_counters:user_id", "password_change_attempt_counters:window_start",
  "password_change_attempt_counters:request_count", "password_change_attempt_counters:limit_count",
  "password_change_attempt_counters:updated_at",
  "projects:id", "projects:user_id", "projects:status", "projects:input_json", "projects:input_revision", "projects:input_hash", "projects:brief_check_json",
  "projects:creation_key_hash", "projects:creation_request_hash",
  "orders:id", "orders:project_id", "orders:plan", "orders:status", "orders:product_code", "orders:request_hash",
  "project_revisions:project_id", "project_revisions:revision", "project_revisions:content_hash", "project_revisions:input_json", "project_revisions:brief_check_json",
  "report_feedback:project_id", "report_feedback:project_revision", "report_feedback:report_schema_version", "report_feedback:user_id",
  "report_feedback:outcome", "report_feedback:sections_json", "report_feedback:created_at", "report_feedback:updated_at",
]);

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function d1Rows(payload, label) {
  assert.ok(Array.isArray(payload) && payload.length > 0, `${label} must contain D1 result batches`);
  assert.ok(payload.every((batch) => batch?.success === true), `${label} contains a failed D1 batch`);
  return payload.flatMap((batch) => Array.isArray(batch.results) ? batch.results : []);
}

function exactCounts(payload) {
  const rows = d1Rows(payload, "row counts");
  const counts = Object.fromEntries(rows.map((row) => [String(row.entity), Number(row.row_count)]));
  assert.equal(rows.length, COUNTED_ENTITIES.length, "row-count evidence has an unexpected shape");
  for (const entity of COUNTED_ENTITIES) {
    assert.ok(Number.isSafeInteger(counts[entity]) && counts[entity] >= 0, `invalid ${entity} count`);
  }
  return counts;
}

function canonicalTable(payload, expectedCount, label) {
  const rows = d1Rows(payload, `${label} canonical rows`);
  assert.equal(rows.length, expectedCount, `${label} canonical query was truncated or inconsistent`);
  return { rowCount: rows.length, sha256: sha256(stableStringify(rows)) };
}

function canonicalProjects(payload, expectedCount) {
  const rows = d1Rows(payload, "projects canonical rows");
  assert.equal(rows.length, expectedCount, "projects canonical query was truncated or inconsistent");
  const canonicalRows = rows.map((row) => ({
    ...row,
    creation_key_hash: row.creation_key_hash ?? null,
    creation_request_hash: row.creation_request_hash ?? null,
  }));
  return { rowCount: rows.length, sha256: sha256(stableStringify(canonicalRows)) };
}

function canonicalUsers(payload, expectedCount, priorProof = null) {
  const rows = d1Rows(payload, "users canonical rows");
  assert.equal(rows.length, expectedCount, "users canonical query was truncated or inconsistent");
  const canonicalRows = rows.map((row) => ({
    ...row,
    auth_generation: row.auth_generation ?? 1,
    auth_revision_id: row.auth_revision_id ?? null,
    password_changed_at: row.password_changed_at ?? null,
  }));
  if (priorProof) {
    assert.equal(priorProof.algorithm, CREDENTIAL_EVIDENCE_ALGORITHM, "credential evidence algorithm changed");
    assert.equal(priorProof.iterations, CREDENTIAL_EVIDENCE_ITERATIONS, "credential evidence work factor changed");
    assert.match(String(priorProof.saltBase64Url || ""), /^[A-Za-z0-9_-]{22}$/u, "credential evidence salt is invalid");
  }
  const salt = priorProof
    ? Buffer.from(priorProof.saltBase64Url, "base64url")
    : randomBytes(CREDENTIAL_EVIDENCE_SALT_BYTES);
  assert.equal(salt.length, CREDENTIAL_EVIDENCE_SALT_BYTES, "credential evidence salt length is invalid");
  const digest = pbkdf2Sync(
    stableStringify(canonicalRows),
    salt,
    CREDENTIAL_EVIDENCE_ITERATIONS,
    32,
    "sha256",
  ).toString("hex");
  return {
    rowCount: rows.length,
    algorithm: CREDENTIAL_EVIDENCE_ALGORITHM,
    iterations: CREDENTIAL_EVIDENCE_ITERATIONS,
    saltBase64Url: salt.toString("base64url"),
    digest,
  };
}

function canonicalSessions(payload, expectedCount) {
  const rows = d1Rows(payload, "sessions canonical rows");
  assert.equal(rows.length, expectedCount, "sessions canonical query was truncated or inconsistent");
  const canonicalRows = rows.map((row) => ({
    ...row,
    auth_generation: row.auth_generation ?? 1,
    auth_revision_id: row.auth_revision_id ?? null,
  }));
  return { rowCount: rows.length, sha256: sha256(stableStringify(canonicalRows)) };
}

export function buildPreMigrationEvidence({
  environment,
  countsPayload,
  auditPayload,
  usersPayload,
  sessionsPayload,
  projectsPayload,
  reportsPayload,
}) {
  assert.match(String(environment), /^(?:staging|production)$/u, "invalid release environment");
  const counts = exactCounts(countsPayload);
  const auditRows = d1Rows(auditPayload, "legacy safety audit");
  assert.equal(auditRows.length, 1, "legacy safety audit must return one row");
  const audit = Object.fromEntries(Object.entries(auditRows[0]).map(([key, value]) => [key, Number(value)]));
  const requiredAudit = [
    "invalid_input_rows",
    "unknown_input_rows",
    "soil_report_keys",
    "unsafe_revision_reports",
    "unsafe_current_reports",
  ];
  for (const key of requiredAudit) {
    assert.ok(Number.isSafeInteger(audit[key]) && audit[key] >= 0, `invalid ${key} audit value`);
    assert.equal(audit[key], 0, `${key} must be zero before migration or rollback can be considered safe`);
  }
  return {
    environment,
    checkedAt: new Date().toISOString(),
    counts,
    legacySafety: audit,
    canonical: {
      users: canonicalUsers(usersPayload, counts.users),
      sessions: canonicalSessions(sessionsPayload, counts.sessions),
      projects: canonicalProjects(projectsPayload, counts.projects),
      reports: canonicalTable(reportsPayload, counts.reports, "reports"),
    },
  };
}

export function verifyPostMigrationEvidence({
  environment,
  pre,
  foreignKeysPayload,
  schemaPayload,
  columnsPayload,
  countsPayload,
  usersPayload,
  sessionsPayload,
  projectsPayload,
  reportsPayload,
  feedbackCountPayload,
  feedbackMigrationPending,
}) {
  assert.equal(pre.environment, environment, "pre/post environment mismatch");
  const foreignKeyBatches = Array.isArray(foreignKeysPayload) ? foreignKeysPayload : [];
  assert.ok(
    foreignKeyBatches.length > 0
      && foreignKeyBatches.every((batch) => batch?.success === true && Array.isArray(batch.results) && batch.results.length === 0),
    "foreign-key check must succeed with zero rows",
  );

  const schemaNames = new Set(d1Rows(schemaPayload, "schema objects").map((row) => `${row.type}:${row.name}`));
  for (const name of [...REQUIRED_BASELINE_OBJECTS, ...REQUIRED_0013_OBJECTS, ...REQUIRED_0014_OBJECTS, ...REQUIRED_0015_OBJECTS]) {
    assert.ok(schemaNames.has(name), `required schema object is missing: ${name}`);
  }
  const columns = new Set(d1Rows(columnsPayload, "schema columns").map((row) => `${row.table_name}:${row.name}`));
  for (const name of REQUIRED_COLUMNS) assert.ok(columns.has(name), `required schema column is missing: ${name}`);

  const counts = exactCounts(countsPayload);
  assert.deepEqual(counts, pre.counts, "migration changed protected table row counts");
  const canonical = {
    users: canonicalUsers(usersPayload, counts.users, pre.canonical.users),
    sessions: canonicalSessions(sessionsPayload, counts.sessions),
    projects: canonicalProjects(projectsPayload, counts.projects),
    reports: canonicalTable(reportsPayload, counts.reports, "reports"),
  };
  assert.deepEqual(canonical, pre.canonical, "migration changed canonical users, sessions, projects, or reports bytes");

  const feedbackRows = d1Rows(feedbackCountPayload, "report feedback count");
  assert.equal(feedbackRows.length, 1, "report feedback count must return one row");
  const reportFeedbackRows = Number(feedbackRows[0].row_count);
  assert.ok(Number.isSafeInteger(reportFeedbackRows) && reportFeedbackRows >= 0, "invalid report feedback row count");
  if (feedbackMigrationPending) assert.equal(reportFeedbackRows, 0, "new report_feedback table must start empty");

  return {
    environment,
    checkedAt: new Date().toISOString(),
    counts,
    canonical,
    coreDataUnchanged: true,
    credentialsAndSessionsUnchanged: true,
    foreignKeyCheckRows: 0,
    reportFeedbackRows,
    feedbackMigrationPending: Boolean(feedbackMigrationPending),
    requiredSchemaObjects: [...REQUIRED_BASELINE_OBJECTS, ...REQUIRED_0013_OBJECTS, ...REQUIRED_0014_OBJECTS, ...REQUIRED_0015_OBJECTS],
    requiredColumns: [...REQUIRED_COLUMNS],
  };
}

export function verifyCanaryResidueEvidence({
  environment,
  residuePayload,
  canaryProjectIds,
}) {
  assert.match(String(environment), /^(?:staging|production)$/u, "invalid release environment");
  assert.ok(Array.isArray(canaryProjectIds) && canaryProjectIds.length > 0, "canary evidence must contain at least one project identifier");
  const projectIds = canaryProjectIds.map((id) => String(id).toLowerCase()).sort();
  assert.equal(new Set(projectIds).size, projectIds.length, "canary project identifiers must be unique");
  for (const id of projectIds) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "invalid canary project identifier");
  }
  const rows = d1Rows(residuePayload, "canary residue");
  assert.equal(rows.length, 1, "canary residue query must return one row");
  const residue = Object.fromEntries(
    ["projects", "project_revisions", "reports", "revision_reports", "feedback"].map((key) => [key, Number(rows[0][key])]),
  );
  for (const [entity, count] of Object.entries(residue)) {
    assert.ok(Number.isSafeInteger(count) && count >= 0, `invalid ${entity} residue count`);
    assert.equal(count, 0, `authenticated canary left ${entity} residue`);
  }
  return {
    environment,
    checkedAt: new Date().toISOString(),
    canaryProjectCount: projectIds.length,
    projectIdsSha256: sha256(stableStringify(projectIds)),
    residue,
    canaryResidue: 0,
  };
}

export function buildCanaryResidueSql(canaryProjectIds) {
  assert.ok(Array.isArray(canaryProjectIds) && canaryProjectIds.length > 0, "canary evidence must contain at least one project identifier");
  const projectIds = canaryProjectIds.map((id) => String(id).toLowerCase()).sort();
  assert.equal(new Set(projectIds).size, projectIds.length, "canary project identifiers must be unique");
  for (const id of projectIds) {
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u, "invalid canary project identifier");
  }
  const ids = projectIds.map((id) => `'${id}'`).join(",");
  return [
    "SELECT",
    `  (SELECT COUNT(*) FROM projects WHERE id IN (${ids})) AS projects,`,
    `  (SELECT COUNT(*) FROM project_revisions WHERE project_id IN (${ids})) AS project_revisions,`,
    `  (SELECT COUNT(*) FROM reports WHERE project_id IN (${ids})) AS reports,`,
    `  (SELECT COUNT(*) FROM project_revision_reports WHERE project_id IN (${ids})) AS revision_reports,`,
    `  (SELECT COUNT(*) FROM report_feedback WHERE project_id IN (${ids})) AS feedback;`,
    "",
  ].join("\n");
}

function readJson(filename) {
  return JSON.parse(readFileSync(filename, "utf8"));
}

function writeJson(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

function usage() {
  throw new Error("usage: release-db-evidence.mjs pre|post|residue-sql|residue <environment> <evidence files...>");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [mode, environment, ...files] = process.argv.slice(2);
  if (mode === "pre" && files.length === 7) {
    const [counts, audit, users, sessions, projects, reports, output] = files;
    writeJson(output, buildPreMigrationEvidence({
      environment,
      countsPayload: readJson(counts),
      auditPayload: readJson(audit),
      usersPayload: readJson(users),
      sessionsPayload: readJson(sessions),
      projectsPayload: readJson(projects),
      reportsPayload: readJson(reports),
    }));
  } else if (mode === "post" && files.length === 11) {
    const [pre, foreignKeys, schema, columns, counts, users, sessions, projects, reports, feedbackCount, output] = files;
    writeJson(output, verifyPostMigrationEvidence({
      environment,
      pre: readJson(pre),
      foreignKeysPayload: readJson(foreignKeys),
      schemaPayload: readJson(schema),
      columnsPayload: readJson(columns),
      countsPayload: readJson(counts),
      usersPayload: readJson(users),
      sessionsPayload: readJson(sessions),
      projectsPayload: readJson(projects),
      reportsPayload: readJson(reports),
      feedbackCountPayload: readJson(feedbackCount),
      feedbackMigrationPending: process.env.FEEDBACK_MIGRATION_PENDING === "true",
    }));
  } else if (mode === "residue-sql" && files.length === 2) {
    const [canary, output] = files;
    const canaryEvidence = readJson(canary);
    writeFileSync(output, buildCanaryResidueSql(canaryEvidence.canaryProjectIds));
  } else if (mode === "residue" && files.length === 3) {
    const [canary, residue, output] = files;
    const canaryEvidence = readJson(canary);
    writeJson(output, verifyCanaryResidueEvidence({
      environment,
      residuePayload: readJson(residue),
      canaryProjectIds: canaryEvidence.canaryProjectIds,
    }));
  } else {
    usage();
  }
}
