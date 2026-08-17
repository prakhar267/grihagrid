import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";
import worker, { __test } from "../worker/index.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDirectory = path.join(root, "migrations");
const ORIGIN = "https://readiness.example.test";
const REPORT_SHARE_ABUSE_HMAC_KEY = "ab".repeat(32);
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

function migrationStatements(source) {
  const statements = [];
  let lines = [];
  let trigger = false;
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("--") || /^PRAGMA\s+/iu.test(line)) continue;
    if (!lines.length) trigger = /^CREATE\s+TRIGGER\b/iu.test(line);
    lines.push(rawLine);
    const complete = trigger ? /\bEND;\s*$/iu.test(line) : /;\s*$/u.test(line);
    if (!complete) continue;
    statements.push(lines.join("\n").trim());
    lines = [];
    trigger = false;
  }
  assert.equal(lines.length, 0, "migration contains an incomplete SQL statement");
  return statements;
}

async function applyMigrations(db) {
  const names = (await readdir(migrationsDirectory)).filter((name) => name.endsWith(".sql")).sort();
  for (const name of names) {
    const source = await readFile(path.join(migrationsDirectory, name), "utf8");
    for (const statement of migrationStatements(source)) await db.prepare(statement).run();
  }
}

async function realD1(context) {
  const miniflare = new Miniflare({
    workers: [{
      config: {
        name: "readiness-worker",
        type: "worker",
        compatibilityDate: "2026-08-01",
        manifest: {
          mainModule: "index.mjs",
          modulesRoot: process.cwd(),
          modules: { "index.mjs": { type: "esm", contents: "export default {}" } },
        },
        env: { DB: { type: "d1", name: "readiness-db" } },
      },
    }],
  });
  context.after(() => miniflare.dispose());
  const db = await miniflare.getD1Database("DB");
  await applyMigrations(db);
  return db;
}

function observedDatabase(db, {
  failControl = false,
  failInventory = false,
  includeBatch = true,
  transformControl = (row) => row,
  transformInventory = (result) => result,
} = {}) {
  const executions = [];
  const rejectUnexpected = async (method, sql = null) => {
    executions.push({ method, sql });
    throw new Error(`readiness used unexpected D1 method ${method}`);
  };
  const observed = {
    ...(includeBatch ? { batch: async () => rejectUnexpected("batch") } : {}),
    exec: async (sql) => rejectUnexpected("exec", sql),
    dump: async () => rejectUnexpected("dump"),
    prepare(sql) {
      const statement = db.prepare(sql);
      return {
        async all() {
          executions.push({ method: "all", sql });
          if (failInventory) throw new Error("synthetic readiness inventory failure");
          const includesControl = /SELECT 'control' AS kind/iu.test(sql);
          if (failControl && includesControl) throw new Error("synthetic report handoff control failure");
          const result = transformInventory(await statement.all());
          if (!includesControl || !Array.isArray(result?.results)) return result;
          const controlIndex = result.results.findIndex((row) => row?.kind === "control");
          if (controlIndex < 0) return result;
          const control = transformControl(result.results[controlIndex]);
          const results = [...result.results];
          if (control === null) results.splice(controlIndex, 1);
          else results[controlIndex] = control;
          return { ...result, results };
        },
        async first() {
          executions.push({ method: "first", sql });
          if (failControl) throw new Error("synthetic report handoff control failure");
          return transformControl(await statement.first());
        },
        run: async () => rejectUnexpected("run", sql),
        raw: async () => rejectUnexpected("raw", sql),
      };
    },
  };
  return { db: observed, executions };
}

async function readiness(DB) {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/readiness`), {
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: {},
    REPORT_SHARE_ABUSE_HMAC_KEY,
    PAID_CHECKOUT_ENABLED: "false",
    DECISION_COMPARE_FULFILLMENT_ENABLED: "false",
    ENABLED_PAYMENT_PLANS: "",
  });
  return { response, payload: await response.json() };
}

function assertSelectOnly(executions) {
  for (const execution of executions) {
    for (const sql of Array.isArray(execution.sql) ? execution.sql : [execution.sql]) {
      assert.match(sql.trim(), /^(?:SELECT|WITH)\b/iu);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|VACUUM|ATTACH|DETACH)\b/iu);
    }
  }
}

function querySources(sql) {
  return [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_][a-z0-9_]*)/giu)].map((match) => match[1].toLowerCase());
}

test("readiness manifests stay pinned to the independently reviewed 299-key contract", () => {
  const keys = __test.readinessInventoryRowsForTest()
    .map(({ kind, scope, name }) => `${kind}:${scope}:${name}`)
    .sort();
  assert.equal(keys.length, 299);
  assert.equal(
    createHash("sha256").update(JSON.stringify(keys)).digest("hex"),
    "1dc3a4ee497a8783ac1eb68f6d52e61a0f3d6b9dfcbfcee4194b7078ab1bc40d",
    "a readiness schema key changed without an explicit contract review",
  );
  for (const key of [
    "object:table:ai_planning_briefs",
    "column:decision_shares:request_hash",
    "object:index:idx_projects_user_creation_key",
    "object:trigger:archived_family_response_update_guard",
    "object:trigger:report_handoff_enabled_insert_guard",
    "column:login_attempt_fences:expires_at",
  ]) {
    assert.ok(keys.includes(key), `readiness contract omitted ${key}`);
  }
});

test("readiness snapshots metadata and the live handoff control in one read and fails closed", { timeout: 60_000 }, async (context) => {
  const sourceDb = await realD1(context);

  const healthy = observedDatabase(sourceDb);
  const current = await readiness(healthy.db);
  assert.equal(current.response.status, 200, JSON.stringify(current.payload));
  assert.equal(current.payload.status, "ready");
  assert.deepEqual({
    database: current.payload.checks.database,
    schema: current.payload.checks.schema,
    aiSchema: current.payload.checks.aiSchema,
    aiAbuseControl: current.payload.checks.aiAbuseControl,
    decisionSchema: current.payload.checks.decisionSchema,
    paymentSchema: current.payload.checks.paymentSchema,
    familyAlignmentSchema: current.payload.checks.familyAlignmentSchema,
    archiveSafetySchema: current.payload.checks.archiveSafetySchema,
    revisionSchema: current.payload.checks.revisionSchema,
    reportFeedbackSchema: current.payload.checks.reportFeedbackSchema,
    reportShareSchema: current.payload.checks.reportShareSchema,
    reportHandoffControl: current.payload.checks.reportHandoffControl,
    projectCreationSchema: current.payload.checks.projectCreationSchema,
    authSchema: current.payload.checks.authSchema,
  }, {
    database: "ok",
    schema: "current",
    aiSchema: "current",
    aiAbuseControl: "configured",
    decisionSchema: "current",
    paymentSchema: "current",
    familyAlignmentSchema: "current",
    archiveSafetySchema: "current",
    revisionSchema: "current",
    reportFeedbackSchema: "current",
    reportShareSchema: "current",
    reportHandoffControl: "disabled",
    projectCreationSchema: "current",
    authSchema: "current",
  });
  assert.deepEqual(healthy.executions.map(({ method }) => method), ["all"]);
  assert.match(healthy.executions[0].sql, /FROM sqlite_master/iu);
  assert.match(healthy.executions[0].sql, /JOIN pragma_table_info\(target_tables\.table_name\)/iu);
  assert.match(healthy.executions[0].sql, /SELECT 'control' AS kind,'report_handoff' AS scope/iu);
  assert.match(healthy.executions[0].sql, /FROM report_handoff_controls/iu);
  assert.match(healthy.executions[0].sql, /WHERE control_key='report_handoff'\s+LIMIT 2/iu);
  assert.deepEqual(
    querySources(healthy.executions[0].sql),
    ["sqlite_master", "target_tables", "pragma_table_info", "report_handoff_controls"],
    "the snapshot must read only SQLite metadata, its bounded CTE, and the singleton control",
  );
  assertSelectOnly(healthy.executions);

  await sourceDb.prepare("UPDATE report_handoff_controls SET enabled=1 WHERE control_key='report_handoff'").run();
  const enabledControl = observedDatabase(sourceDb);
  const enabled = await readiness(enabledControl.db);
  assert.equal(enabled.response.status, 200, JSON.stringify(enabled.payload));
  assert.equal(enabled.payload.checks.reportHandoffControl, "enabled");
  assert.equal(enabled.payload.capabilities.reportHandoff, true);
  assert.deepEqual(enabledControl.executions.map(({ method }) => method), ["all"]);
  await sourceDb.prepare("UPDATE report_handoff_controls SET enabled=0 WHERE control_key='report_handoff'").run();

  for (const { label, key, check, capability } of [
    {
      label: "required table",
      key: "object:table:ai_planning_briefs",
      check: "aiSchema",
      capability: "aiPlanningBrief",
    },
    {
      label: "required column",
      key: "column:decision_shares:request_hash",
      check: "decisionSchema",
      capability: "decisionCompare",
    },
    {
      label: "required index",
      key: "object:index:idx_projects_user_creation_key",
      check: "projectCreationSchema",
      capability: "freePlanning",
    },
    {
      label: "required trigger",
      key: "object:trigger:archived_family_response_update_guard",
      check: "archiveSafetySchema",
      capability: "freePlanning",
    },
  ]) {
    const partial = observedDatabase(sourceDb, {
      transformInventory: (result) => {
        const results = result.results.filter((row) => `${row.kind}:${row.scope}:${row.name}` !== key);
        assert.equal(results.length, result.results.length - 1, `${label} fixture did not remove exactly one row`);
        return { ...result, results };
      },
    });
    const degraded = await readiness(partial.db);
    assert.equal(degraded.response.status, 503, `${label}: ${JSON.stringify(degraded.payload)}`);
    assert.equal(degraded.payload.checks.database, "ok", label);
    assert.equal(degraded.payload.checks.schema, "outdated", label);
    assert.equal(degraded.payload.checks[check], "outdated", label);
    assert.equal(degraded.payload.checks.reportShareSchema, "current", `${label} must not hide unrelated schema state`);
    assert.equal(degraded.payload.checks.reportHandoffControl, "disabled", label);
    assert.equal(degraded.payload.capabilities[capability], false, label);
    assert.deepEqual(partial.executions.map(({ method }) => method), ["all"], label);
    assertSelectOnly(partial.executions);
  }

  await sourceDb.prepare("DROP INDEX idx_report_shares_expiry").run();
  const incompleteShare = observedDatabase(sourceDb);
  const incomplete = await readiness(incompleteShare.db);
  assert.equal(incomplete.response.status, 503, JSON.stringify(incomplete.payload));
  assert.equal(incomplete.payload.checks.database, "ok");
  assert.equal(incomplete.payload.checks.schema, "outdated");
  assert.equal(incomplete.payload.checks.reportShareSchema, "outdated");
  assert.equal(incomplete.payload.checks.reportHandoffControl, "unavailable");
  assert.equal(incomplete.payload.checks.authSchema, "current", "unrelated groups must remain diagnosable");
  assert.deepEqual(incompleteShare.executions.map(({ method }) => method), ["all"]);
  assertSelectOnly(incompleteShare.executions);
  await sourceDb.prepare("CREATE INDEX idx_report_shares_expiry ON report_shares(expires_at,revoked_at)").run();

  const controlFailure = observedDatabase(sourceDb, { failControl: true });
  const unavailableControl = await readiness(controlFailure.db);
  assert.equal(unavailableControl.response.status, 503, JSON.stringify(unavailableControl.payload));
  assert.equal(unavailableControl.payload.checks.database, "ok");
  assert.equal(unavailableControl.payload.checks.reportShareSchema, "outdated");
  assert.equal(unavailableControl.payload.checks.reportHandoffControl, "unavailable");
  assert.deepEqual(controlFailure.executions.map(({ method }) => method), ["all", "all"]);
  assertSelectOnly(controlFailure.executions);

  for (const [label, row, database, reportShareSchema, control] of [
    ["missing row", null, "ok", "outdated", "unavailable"],
    ["normalized invalid state", { kind: "control", scope: "report_handoff", name: "invalid" }, "ok", "outdated", "unavailable"],
    ["array row", [], "error", "unknown", "unknown"],
    ["missing state", { kind: "control", scope: "report_handoff" }, "error", "unknown", "unknown"],
    ["wrong scope", { kind: "control", scope: "other", name: "enabled" }, "error", "unknown", "unknown"],
    ["unknown state", { kind: "control", scope: "report_handoff", name: "yes" }, "error", "unknown", "unknown"],
  ]) {
    const malformedControl = observedDatabase(sourceDb, { transformControl: () => row });
    const malformed = await readiness(malformedControl.db);
    assert.equal(malformed.response.status, 503, `${label}: ${JSON.stringify(malformed.payload)}`);
    assert.equal(malformed.payload.checks.database, database, label);
    assert.equal(malformed.payload.checks.reportShareSchema, reportShareSchema, label);
    assert.equal(malformed.payload.checks.reportHandoffControl, control, label);
    assert.equal(malformed.payload.capabilities.reportHandoff, false, label);
    assert.deepEqual(malformedControl.executions.map(({ method }) => method), ["all"], label);
    assertSelectOnly(malformedControl.executions);
  }

  const duplicateControl = observedDatabase(sourceDb, {
    transformInventory: (result) => ({
      ...result,
      results: [...result.results, result.results.find((row) => row.kind === "control")],
    }),
  });
  const duplicate = await readiness(duplicateControl.db);
  assert.equal(duplicate.response.status, 503, JSON.stringify(duplicate.payload));
  assert.equal(duplicate.payload.checks.database, "error");
  assert.equal(duplicate.payload.checks.reportHandoffControl, "unknown");
  assert.deepEqual(duplicateControl.executions.map(({ method }) => method), ["all"]);
  assertSelectOnly(duplicateControl.executions);

  const missingBatch = observedDatabase(sourceDb, { includeBatch: false });
  const unavailableAdmission = await readiness(missingBatch.db);
  assert.equal(unavailableAdmission.response.status, 503, JSON.stringify(unavailableAdmission.payload));
  assert.equal(unavailableAdmission.payload.checks.database, "ok");
  assert.equal(unavailableAdmission.payload.checks.aiSchema, "current");
  assert.equal(unavailableAdmission.payload.checks.aiAbuseControl, "unavailable");
  assert.equal(unavailableAdmission.payload.checks.authSchema, "current");
  assert.deepEqual(missingBatch.executions.map(({ method }) => method), ["all"]);
  assertSelectOnly(missingBatch.executions);

  const inventoryFailure = observedDatabase(sourceDb, { failInventory: true });
  const unavailableDatabase = await readiness(inventoryFailure.db);
  assert.equal(unavailableDatabase.response.status, 503, JSON.stringify(unavailableDatabase.payload));
  assert.equal(unavailableDatabase.payload.checks.database, "error");
  assert.equal(unavailableDatabase.payload.checks.schema, "unknown");
  assert.equal(unavailableDatabase.payload.checks.reportShareSchema, "unknown");
  assert.equal(unavailableDatabase.payload.checks.reportHandoffControl, "unknown");
  assert.deepEqual(inventoryFailure.executions.map(({ method }) => method), ["all", "all"]);
  assertSelectOnly(inventoryFailure.executions);

  const malformedInventories = [
    ["missing result", (result) => ({ success: result.success })],
    ["missing success", (result) => ({ results: result.results })],
    ["unsuccessful result", (result) => ({ ...result, success: false })],
    ["non-boolean success", (result) => ({ ...result, success: 1 })],
    ["non-array results", (result) => ({ ...result, results: {} })],
    ["non-object row", (result) => ({ ...result, results: [null] })],
    ["array row", (result) => ({ ...result, results: [[]] })],
    ["non-string field", (result) => ({ ...result, results: [{ kind: "object", scope: "table", name: 1 }] })],
    ["empty object scope", (result) => ({ ...result, results: [{ kind: "object", scope: "", name: "users" }] })],
    ["empty column name", (result) => ({ ...result, results: [{ kind: "column", scope: "users", name: "" }] })],
    ["whitespace object scope", (result) => ({ ...result, results: [{ kind: "object", scope: " ", name: "users" }] })],
    ["unknown kind", (result) => ({ ...result, results: [{ kind: "mystery", scope: "table", name: "users" }] })],
    ["unknown object scope", (result) => ({ ...result, results: [{ kind: "object", scope: "view", name: "users" }] })],
    ["unknown column scope", (result) => ({ ...result, results: [{ kind: "column", scope: "unknown", name: "id" }] })],
    ["complete inventory plus duplicate object", (result) => ({
      ...result,
      results: [...result.results, result.results[0]],
    })],
    ["duplicate column", (result) => {
      const column = result.results.find((row) => row.kind === "column");
      return { ...result, results: [...result.results, column] };
    }],
  ];
  for (const [label, transformInventory] of malformedInventories) {
    const malformed = observedDatabase(sourceDb, { transformInventory });
    const rejected = await readiness(malformed.db);
    assert.equal(rejected.response.status, 503, `${label}: ${JSON.stringify(rejected.payload)}`);
    assert.equal(rejected.payload.checks.database, "error", label);
    assert.equal(rejected.payload.checks.schema, "unknown", label);
    assert.equal(rejected.payload.checks.reportHandoffControl, "unknown", label);
    assert.deepEqual(malformed.executions.map(({ method }) => method), ["all"], label);
    assertSelectOnly(malformed.executions);
  }

  const emptyInventory = observedDatabase(sourceDb, {
    transformInventory: (result) => ({ ...result, results: [] }),
  });
  const empty = await readiness(emptyInventory.db);
  assert.equal(empty.response.status, 503, JSON.stringify(empty.payload));
  assert.equal(empty.payload.checks.database, "ok");
  assert.equal(empty.payload.checks.schema, "outdated");
  assert.equal(empty.payload.checks.aiSchema, "outdated");
  assert.equal(empty.payload.checks.reportShareSchema, "outdated");
  assert.equal(empty.payload.checks.reportHandoffControl, "unavailable");
  assert.deepEqual(emptyInventory.executions.map(({ method }) => method), ["all"]);
  assertSelectOnly(emptyInventory.executions);

  for (const [label, omittedKey] of [
    ["missing control column", "column:report_handoff_controls:enabled"],
  ]) {
    const partialFallback = observedDatabase(sourceDb, {
      failControl: true,
      transformInventory: (inventoryResult) => ({
        ...inventoryResult,
        results: inventoryResult.results.filter((row) => `${row.kind}:${row.scope}:${row.name}` !== omittedKey),
      }),
    });
    const fallback = await readiness(partialFallback.db);
    assert.equal(fallback.response.status, 503, `${label}: ${JSON.stringify(fallback.payload)}`);
    assert.equal(fallback.payload.checks.database, "ok", label);
    assert.equal(fallback.payload.checks.schema, "outdated", label);
    assert.equal(fallback.payload.checks.reportShareSchema, "outdated", label);
    assert.equal(fallback.payload.checks.reportHandoffControl, "unavailable", label);
    assert.equal(fallback.payload.checks.authSchema, "current", label);
    assert.deepEqual(partialFallback.executions.map(({ method }) => method), ["all", "all"], label);
    assert.ok(partialFallback.executions[0].sql.includes("report_handoff_controls"), label);
    assert.doesNotMatch(partialFallback.executions[1].sql, /SELECT 'control' AS kind/iu, label);
    assertSelectOnly(partialFallback.executions);
  }

  await sourceDb.prepare("DROP TABLE report_handoff_controls").run();
  const absentControlTable = observedDatabase(sourceDb);
  const absent = await readiness(absentControlTable.db);
  assert.equal(absent.response.status, 503, JSON.stringify(absent.payload));
  assert.equal(absent.payload.checks.database, "ok");
  assert.equal(absent.payload.checks.schema, "outdated");
  assert.equal(absent.payload.checks.reportShareSchema, "outdated");
  assert.equal(absent.payload.checks.reportHandoffControl, "unavailable");
  assert.equal(absent.payload.checks.authSchema, "current");
  assert.deepEqual(absentControlTable.executions.map(({ method }) => method), ["all", "all"]);
  assert.match(absentControlTable.executions[0].sql, /FROM report_handoff_controls/iu);
  assert.doesNotMatch(absentControlTable.executions[1].sql, /FROM report_handoff_controls/iu);
  assertSelectOnly(absentControlTable.executions);
});
