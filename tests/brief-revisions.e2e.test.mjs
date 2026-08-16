import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function appendLog(current, chunk) {
  return `${current}${String(chunk)}`.slice(-160_000);
}

async function startWorker(stateDirectory, assetsDirectory, port) {
  const args = [
    "dev",
    "worker/index.js",
    "--config",
    "wrangler.toml",
    "--local",
    "--persist-to",
    stateDirectory,
    "--assets",
    assetsDirectory,
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--log-level",
    "log",
    "--show-interactive-dev-session=false",
    "--var",
    "APP_ENV:test",
    "--var",
    "APP_ORIGIN:https://app.example.test",
    "--var",
    "PAID_CHECKOUT_ENABLED:false",
    "--var",
    "DECISION_COMPARE_FULFILLMENT_ENABLED:false",
    "--var",
    "ENABLED_PAYMENT_PLANS:",
    "--var",
    "GEMINI_API_KEY:",
  ];
  const child = spawn(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    env: { ...process.env, CI: "true", WRANGLER_LOG_SANITIZE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = appendLog(logs, chunk); });
  child.stderr.on("data", (chunk) => { logs = appendLog(logs, chunk); });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const earlyExit = await Promise.race([exited, wait(100).then(() => null)]);
    if (earlyExit) {
      await stopWorker({ child, exited });
      throw new Error(`wrangler dev exited before readiness (${JSON.stringify(earlyExit)}):\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.body?.cancel();
        return { child, exited, origin, logs: () => logs };
      }
      await response.body?.cancel();
    } catch {
      // workerd has not bound its local port yet.
    }
  }
  await stopWorker({ child, exited });
  throw new Error(`wrangler dev did not become ready:\n${logs}`);
}

async function stopWorker(server) {
  if (!server?.child) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    const graceful = await Promise.race([server.exited.then(() => true), wait(5_000).then(() => false)]);
    if (!graceful && server.child.exitCode === null) {
      server.child.kill("SIGKILL");
      await Promise.race([server.exited, wait(2_000)]);
    }
  }
  server.child.stdout?.destroy();
  server.child.stderr?.destroy();
}

function d1(stateDirectory, action, sql = null) {
  const args = ["d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
  } else if (action === "file") {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--file", sql);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", sql);
    if (action === "query") args.push("--json");
  }
  return spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function applyMigrationFilesThrough(stateDirectory, maximumNumber) {
  const migrationDirectory = path.join(root, "migrations");
  for (let number = 1; number <= maximumNumber; number += 1) {
    const prefix = String(number).padStart(4, "0");
    const files = readdirSync(migrationDirectory).filter((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
    assert.equal(files.length, 1, `expected exactly one ${prefix} migration, found ${files.length}`);
    const file = path.join(migrationDirectory, files[0]);
    requireD1Success(d1(stateDirectory, "file", file), `migration ${files[0]} failed`);
  }
}

function requireD1Success(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function d1Query(stateDirectory, sql, context = "D1 query failed") {
  const result = requireD1Success(d1(stateDirectory, "query", sql), context);
  return JSON.parse(result.stdout);
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function applicationTableNames(stateDirectory) {
  const result = d1Query(
    stateDirectory,
    `SELECT name FROM sqlite_master
      WHERE type='table'
        AND name NOT LIKE 'sqlite_%'
        AND name NOT LIKE '_cf_%'
        AND name!='d1_migrations'
      ORDER BY name`,
    "application table discovery failed",
  );
  return (result[0]?.results || []).map((row) => row.name).filter((name) => /^[a-z][a-z0-9_]*$/u.test(name));
}

function databaseSnapshot(stateDirectory) {
  const tables = applicationTableNames(stateDirectory);
  const statements = tables.map((table) => `SELECT * FROM \"${table}\"`).join(";");
  const result = d1Query(stateDirectory, statements, "full application snapshot failed");
  return tables.map((table, index) => ({
    table,
    rows: (result[index]?.results || []).map(stableStringify).sort(),
  }));
}

function extractCookies(response, csrfToken) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(values.join(";"))?.[1];
  assert.ok(session, "registration must set the secure session cookie");
  return `__Host-grihagrid_session=${session}; grihagrid_csrf=${csrfToken}`;
}

async function call(origin, pathname, {
  method = "GET",
  body,
  rawBody,
  auth,
  includeCsrf = true,
  requestOrigin,
  headers = {},
} = {}) {
  const requestHeaders = new Headers(headers);
  const suppliedRawBody = rawBody !== undefined;
  if (body !== undefined || suppliedRawBody) {
    if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  }
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    if (includeCsrf) requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!["GET", "HEAD"].includes(method)) {
    requestHeaders.set("origin", requestOrigin === undefined ? origin : requestOrigin);
  }
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: requestHeaders,
    body: suppliedRawBody ? rawBody : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try { payload = JSON.parse(text); } catch { payload = text; }
  }
  return { response, payload };
}

async function register(origin, suffix) {
  const result = await call(origin, "/api/auth/register", {
    method: "POST",
    body: {
      name: `Brief revision owner ${suffix}`,
      email: `brief-revision-${suffix}@example.test`,
      password: "correct horse battery staple",
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return {
    user: result.payload.user,
    csrf: result.payload.csrfToken,
    cookie: extractCookies(result.response, result.payload.csrfToken),
  };
}

const completeInput = Object.freeze({
  width: 30,
  length: 50,
  city: "Pune",
  facing: "East",
  floors: "G+1",
  bedrooms: 3,
  bathrooms: 3,
  parking: "1 car",
  style: "BRIEF_REVISION_PRIVATE_STYLE",
  quality: "Signature",
  roadWidthFt: 30,
  plotShape: "regular",
  accessibility: "none",
  futureUse: "none",
  budgetLakh: 55,
});

async function createProject(origin, auth, suffix, input = completeInput) {
  const result = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    body: { name: `BRIEF_REVISION_PRIVATE_NAME_${suffix}`, input },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.project;
}

async function createComparison(origin, auth, projectId) {
  const result = await call(origin, `/api/projects/${projectId}/decision-compare`, {
    method: "PUT",
    auth,
    body: {
      priority: "balanced",
      scenarios: [
        { label: "Courtyard core", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "BRIEF_REVISION_PRIVATE_NOTE_A" },
        { label: "Future floor", floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: "BRIEF_REVISION_PRIVATE_NOTE_B" },
      ],
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.comparison;
}

async function chooseScenario(origin, auth, projectId, scenarioId) {
  const result = await call(origin, `/api/projects/${projectId}/decision-compare/choice`, {
    method: "POST",
    auth,
    body: { scenarioId },
  });
  assert.ok([200, 201].includes(result.response.status), JSON.stringify(result.payload));
  return result.payload.selection;
}

async function createFamilyRoom(origin, auth, projectId, comparisonId, suffix) {
  const result = await call(origin, `/api/projects/${projectId}/family-alignment`, {
    method: "POST",
    auth,
    headers: { "idempotency-key": `brief-revision-family-${suffix}` },
    body: { comparisonId },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  const token = /\/align\/([^/?#]+)/u.exec(result.payload.room.url)?.[1];
  assert.ok(token, "first Family Alignment creation must return its one-time token URL");
  return { room: result.payload.room, token };
}

function paidDecisionSql({ projectId, userId, comparison, selectedScenarioId }) {
  const createdAt = "2026-08-15 00:00:00";
  const orderId = "brief-revision-order";
  const snapshotId = "brief-revision-purchased-snapshot";
  const artifact = {
    ...comparison,
    selectedScenarioId,
    selection: { scenarioId: selectedScenarioId, selectedAt: createdAt, lockedAt: createdAt },
    purchasedAt: createdAt,
  };
  const orderValues = [
    orderId,
    projectId,
    userId,
    "plan",
    "decision_compare",
    99_900,
    "INR",
    "plink_BRIEF_REVISION",
    "pay_BRIEF_REVISION",
    "brief-revision-paid-order",
    "paid",
    createdAt,
    createdAt,
    "https://rzp.io/i/BRIEF_REVISION",
    "paid",
    null,
    createdAt,
    "order_BRIEF_REVISION",
    null,
    null,
    "pilot-v1",
    createdAt,
  ];
  const snapshotValues = [
    snapshotId,
    orderId,
    projectId,
    userId,
    comparison.id,
    selectedScenarioId,
    1,
    comparison.contentHash,
    JSON.stringify(artifact),
    createdAt,
  ];
  return {
    orderId,
    snapshotId,
    sql: `
      UPDATE decision_selections
         SET locked_at=${sqlLiteral(createdAt)}
       WHERE comparison_id=${sqlLiteral(comparison.id)}
         AND scenario_id=${sqlLiteral(selectedScenarioId)}
         AND locked_at IS NULL;
      INSERT INTO orders
        (id,project_id,user_id,plan,product_code,amount_paise,currency,provider_order_id,
         provider_payment_id,idempotency_key,status,created_at,updated_at,checkout_url,
         provider_status,provider_error_code,paid_at,provider_checkout_order_id,
         entitlement_revoked_at,entitlement_revocation_reason,terms_version,terms_accepted_at)
      VALUES (${orderValues.map(sqlLiteral).join(",")});
      INSERT INTO purchased_decision_snapshots
        (id,order_id,project_id,user_id,comparison_id,selected_scenario_id,
         snapshot_schema_version,content_hash,artifact_json,created_at)
      VALUES (${snapshotValues.map(sqlLiteral).join(",")});
    `,
  };
}

function assertExactKeys(value, expected, label) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} response shape drifted`);
}

function assertBriefCheck(value) {
  assertExactKeys(value, ["version", "status", "headline", "summary", "missingFields", "tensions", "professionalChecks"], "briefCheck");
  assert.ok(["insufficient_information", "programme_tension", "directionally_plausible"].includes(value.status));
  assert.ok(Array.isArray(value.missingFields));
  assert.ok(Array.isArray(value.tensions));
  assert.ok(Array.isArray(value.professionalChecks));
  for (const item of value.missingFields) assertExactKeys(item, ["field", "label", "prompt"], "briefCheck.missingFields item");
  for (const item of value.tensions) assertExactKeys(item, ["code", "label", "detail"], "briefCheck.tensions item");
}

function assertChangeStudy(value) {
  assertExactKeys(value, ["hasChanges", "changedFields", "estimateDeltas", "status", "consequences"], "changeStudy");
  assert.equal(typeof value.hasChanges, "boolean");
  assert.ok(Array.isArray(value.changedFields));
  assert.ok(Array.isArray(value.consequences));
  for (const item of value.changedFields) assertExactKeys(item, ["field", "label", "before", "after"], "changeStudy.changedFields item");
  assertExactKeys(value.estimateDeltas, ["plotSqft", "builtUpSqft", "lowInr", "highInr"], "changeStudy.estimateDeltas");
  for (const [key, item] of Object.entries(value.estimateDeltas)) {
    assertExactKeys(item, ["before", "after", "delta"], `changeStudy.estimateDeltas.${key}`);
  }
  assertExactKeys(value.status, ["before", "after", "changed"], "changeStudy.status");
  for (const item of value.consequences) assertExactKeys(item, ["code", "label", "detail"], "changeStudy.consequences item");
}

function assertRevisionDetail(value, { list = false } = {}) {
  const keys = [
    "revision",
    "current",
    "provenance",
    "createdAt",
    "inputSchemaVersion",
    "estimateRuleVersion",
    list ? "inputSummary" : "input",
    "estimate",
    "briefCheck",
    "report",
  ];
  assertExactKeys(value, keys, list ? "revision summary" : "revision detail");
  assertBriefCheck(value.briefCheck);
  assertExactKeys(value.report, ["available", "schemaVersion", "generatedAt"], "revision report metadata");
  assert.equal(typeof value.current, "boolean");
  assert.equal(Number.isSafeInteger(value.revision) && value.revision > 0, true);
}

function assertReportEnvelope(value, label = "report envelope") {
  assertExactKeys(value, ["project", "revision", "report", "cached"], label);
  assertRevisionDetail(value.revision);
  assert.equal(value.project.inputRevision, value.revision.revision, `${label} project snapshot must match its revision`);
  assert.deepEqual(value.project.input, value.revision.input, `${label} project input must come from the same revision snapshot`);
  assert.deepEqual(value.project.estimate, value.revision.estimate, `${label} project estimate must come from the same revision snapshot`);
  assert.deepEqual(value.project.briefCheck, value.revision.briefCheck, `${label} Brief Check must come from the same revision snapshot`);
  assert.equal(value.report.version, value.revision.report.schemaVersion, `${label} schema metadata must match report bytes`);
  assert.equal(typeof value.cached, "boolean");
}

function assertNoInternalRevisionKeys(value, { allowReportInputHash = false } = {}) {
  const forbidden = new Set([
    "user_id", "input_json", "estimate_json", "brief_check_json", "request_hash",
    "idempotency_key", "content_json", "input_hash", "token_hash", "receipt_hash",
    "provider_payment_id", "provider_order_id", "provider_interaction_id", "object_key",
    "token", "receipt", "idempotencykey", "bearertoken", "providerpaymentid",
    "providerorderid", "providerinteractionid",
  ]);
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase();
      assert.equal(forbidden.has(normalizedKey), false, `response exposes internal field ${key}`);
      assert.equal(
        normalizedKey.endsWith("hash") && !(allowReportInputHash && normalizedKey === "inputhash"),
        false,
        `response exposes hash field ${key}`,
      );
      visit(child);
    }
  }
  visit(value);
}

function rowsFor(stateDirectory, sql, context = "row query failed") {
  return d1Query(stateDirectory, sql, context)[0]?.results || [];
}

function revisionPath(projectId, suffix = "") {
  return `/api/projects/${encodeURIComponent(projectId)}/revisions${suffix}`;
}

test("Brief Check revisions are truthful, immutable, owner-scoped, and race safe on real D1", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-brief-revisions-e2e-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory);
  const port = await reservePort();
  let server = null;
  const capturedLogs = [];
  try {
    requireD1Success(d1(stateDirectory, "migrate"), "fresh 0001-0014 migration chain failed");
    const applied = rowsFor(stateDirectory, "SELECT name FROM d1_migrations ORDER BY id", "migration ledger query failed");
    assert.equal(applied.length, 14, JSON.stringify(applied));
    assert.equal(applied.at(-1)?.name, "0014_project_creation_idempotency.sql");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assertExactKeys(readiness.payload, ["status", "service", "releaseId", "checks", "capabilities", "time"], "readiness");
    assert.match(readiness.payload.releaseId, /^(?:unknown|[0-9a-f-]{36})$/u);
    assertExactKeys(
      readiness.payload.checks,
      [
        "database", "schema", "rateLimit", "aiSchema", "aiAbuseControl", "decisionSchema",
        "paymentSchema", "familyAlignmentSchema", "archiveSafetySchema", "revisionSchema", "reportFeedbackSchema", "projectCreationSchema", "ai",
        "privateStorage", "acceptingPaidPlans",
      ],
      "readiness.checks",
    );
    assertExactKeys(
      readiness.payload.capabilities,
      ["freePlanning", "privateUploads", "paidCheckout", "paidFulfillment", "aiPlanningBrief", "decisionCompare", "familyAlignment", "briefCheck", "reportFeedback"],
      "readiness.capabilities",
    );
    assert.equal(readiness.payload.checks.revisionSchema, "current");
    assert.equal(readiness.payload.checks.reportFeedbackSchema, "current");
    assert.equal(readiness.payload.checks.projectCreationSchema, "current");
    assert.equal(readiness.payload.capabilities.briefCheck, true);
    assert.equal(readiness.payload.capabilities.reportFeedback, true);
    assert.equal(readiness.payload.capabilities.paidCheckout, false);
    assert.equal(readiness.payload.capabilities.paidFulfillment, false);
    assert.equal(readiness.payload.capabilities.privateUploads, false);
    assert.equal(readiness.payload.capabilities.aiPlanningBrief, false);

    const owner = await register(server.origin, "owner");
    const other = await register(server.origin, "other");
    const project = await createProject(server.origin, owner, "PRIMARY");
    assert.equal(project.inputRevision, 1);

    const currentHistory = await call(server.origin, revisionPath(project.id), { auth: owner });
    assert.equal(currentHistory.response.status, 200, JSON.stringify(currentHistory.payload));
    assertExactKeys(currentHistory.payload, ["project", "briefCheck", "revisions", "pagination", "historyStartsAtRevision"], "revision list");
    assert.equal(currentHistory.payload.historyStartsAtRevision, 1);
    assert.equal(currentHistory.payload.revisions.length, 1);
    assertRevisionDetail(currentHistory.payload.revisions[0], { list: true });
    assertBriefCheck(currentHistory.payload.briefCheck);
    assert.equal(currentHistory.payload.briefCheck.status, "directionally_plausible");
    assertNoInternalRevisionKeys(currentHistory.payload);

    const generatedInitial = await call(server.origin, `/api/projects/${project.id}/report`, {
      method: "POST",
      auth: owner,
      body: {},
    });
    assert.equal(generatedInitial.response.status, 201, JSON.stringify(generatedInitial.payload));
    assertReportEnvelope(generatedInitial.payload, "generated current report");
    assert.equal(generatedInitial.payload.revision.revision, 1);
    const initialReport = generatedInitial.payload.report;
    const serializedInitialReport = JSON.stringify(initialReport);
    assert.equal(serializedInitialReport.includes("Conceptually feasible"), false);
    assert.equal(serializedInitialReport.includes("74/100"), false);
    assertNoInternalRevisionKeys(generatedInitial.payload, { allowReportInputHash: true });

    const comparison = await createComparison(server.origin, owner, project.id);
    const selectedScenarioId = comparison.scenarios[1].id;
    await chooseScenario(server.origin, owner, project.id, selectedScenarioId);
    const family = await createFamilyRoom(server.origin, owner, project.id, comparison.id, "primary");

    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const paid = paidDecisionSql({
      projectId: project.id,
      userId: owner.user.id,
      comparison,
      selectedScenarioId,
    });
    requireD1Success(d1(stateDirectory, "execute", paid.sql), "paid historical decision seed failed");
    const immutableBefore = rowsFor(
      stateDirectory,
      `SELECT 'comparison' AS source,id,content_json AS value FROM decision_comparisons WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'selection',comparison_id,scenario_id||'|'||selected_at||'|'||COALESCE(locked_at,'') FROM decision_selections WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'order',id,status||'|'||COALESCE(provider_payment_id,'')||'|'||COALESCE(entitlement_revoked_at,'') FROM orders WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'snapshot',id,artifact_json FROM purchased_decision_snapshots WHERE project_id=${sqlLiteral(project.id)}
       ORDER BY source,id`,
      "historical evidence snapshot failed",
    );

    const beforePreview = databaseSnapshot(stateDirectory);
    server = await startWorker(stateDirectory, assetsDirectory, port);
    const premiumPreview = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 1, input: { quality: "Premium" } },
    });
    assert.equal(premiumPreview.response.status, 200, JSON.stringify(premiumPreview.payload));
    assertExactKeys(premiumPreview.payload, ["baseRevision", "proposedRevision", "input", "estimate", "briefCheck", "changeStudy"], "revision preview");
    assert.equal(premiumPreview.payload.baseRevision, 1);
    assert.equal(premiumPreview.payload.proposedRevision, 2);
    assert.equal(premiumPreview.payload.input.quality, "Premium");
    assertBriefCheck(premiumPreview.payload.briefCheck);
    assertChangeStudy(premiumPreview.payload.changeStudy);
    assert.equal(premiumPreview.payload.changeStudy.hasChanges, true);
    assert.deepEqual(premiumPreview.payload.changeStudy.changedFields.map((item) => item.field), ["quality"]);
    assert.deepEqual(premiumPreview.payload.changeStudy.estimateDeltas.plotSqft, { before: 1500, after: 1500, delta: 0 });
    assert.deepEqual(premiumPreview.payload.changeStudy.estimateDeltas.builtUpSqft, { before: 1830, after: 1830, delta: 0 });
    assert.deepEqual(premiumPreview.payload.changeStudy.estimateDeltas.lowInr, { before: 3_703_920, after: 4_798_260, delta: 1_094_340 });
    assert.deepEqual(premiumPreview.payload.changeStudy.estimateDeltas.highInr, { before: 4_428_600, after: 5_737_050, delta: 1_308_450 });
    assertNoInternalRevisionKeys(premiumPreview.payload);
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const afterPreview = databaseSnapshot(stateDirectory);
    assert.deepEqual(afterPreview, beforePreview, "revision preview must make zero writes to every application table");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const missingFacts = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: {
        expectedInputRevision: 1,
        input: { roadWidthFt: null, plotShape: "unknown", accessibility: "unknown", futureUse: "unknown", budgetLakh: null },
      },
    });
    assert.equal(missingFacts.response.status, 200, JSON.stringify(missingFacts.payload));
    assert.equal(missingFacts.payload.briefCheck.status, "insufficient_information");
    assert.ok(missingFacts.payload.briefCheck.missingFields.length >= 4);

    const programmeTension = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: {
        expectedInputRevision: 1,
        input: {
          width: 20,
          floors: "G",
          bedrooms: 5,
          bathrooms: 5,
          parking: "2 cars",
          roadWidthFt: 12,
          accessibility: "wheelchair_ready",
          futureUse: "rental",
          budgetLakh: 20,
        },
      },
    });
    assert.equal(programmeTension.response.status, 200, JSON.stringify(programmeTension.payload));
    assert.equal(programmeTension.payload.briefCheck.status, "programme_tension");
    assert.ok(programmeTension.payload.briefCheck.tensions.length > 0);

    const wider = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 1, input: { width: 35 } },
    });
    const widest = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 1, input: { width: 40 } },
    });
    assert.equal(wider.response.status, 200, JSON.stringify(wider.payload));
    assert.equal(widest.response.status, 200, JSON.stringify(widest.payload));
    assert.ok(wider.payload.estimate.builtUpSqft > premiumPreview.payload.changeStudy.estimateDeltas.builtUpSqft.before);
    assert.ok(widest.payload.estimate.builtUpSqft > wider.payload.estimate.builtUpSqft);
    assert.ok(widest.payload.estimate.highInr > wider.payload.estimate.highInr);

    const swapped = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 1, input: { width: 50, length: 30 } },
    });
    assert.equal(swapped.response.status, 200, JSON.stringify(swapped.payload));
    assert.equal(swapped.payload.estimate.plotSqft, 1500);
    assert.equal(swapped.payload.estimate.builtUpSqft, 1830);
    assert.equal(swapped.payload.estimate.lowInr, 3_703_920);
    assert.equal(swapped.payload.estimate.highInr, 4_428_600);

    const noAcceptance = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "brief-revision-no-acceptance" },
      body: { expectedInputRevision: 1, input: { quality: "Premium" } },
    });
    assert.equal(noAcceptance.response.status, 400);
    assert.equal(noAcceptance.payload.code, "impact_acceptance_required");

    const commitKey = "brief-revision-primary-commit";
    const committed = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": commitKey },
      body: { expectedInputRevision: 1, input: { quality: "Premium" }, acceptedImpact: true },
    });
    assert.equal(committed.response.status, 201, JSON.stringify(committed.payload));
    assertExactKeys(committed.payload, ["project", "revision", "briefCheck", "changeStudy", "idempotentReplay"], "revision commit");
    assert.equal(committed.payload.idempotentReplay, false);
    assert.equal(committed.payload.project.inputRevision, 2);
    assertRevisionDetail(committed.payload.revision);
    assert.equal(committed.payload.revision.revision, 2);
    assertBriefCheck(committed.payload.briefCheck);
    assertChangeStudy(committed.payload.changeStudy);
    assertNoInternalRevisionKeys(committed.payload);

    const replayed = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": commitKey },
      body: { expectedInputRevision: 1, input: { quality: "Premium" }, acceptedImpact: true },
    });
    assert.equal(replayed.response.status, 200, JSON.stringify(replayed.payload));
    assert.equal(replayed.payload.idempotentReplay, true);
    assert.equal(replayed.payload.revision.revision, 2);
    assertNoInternalRevisionKeys(replayed.payload);

    const keyConflict = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": commitKey },
      body: { expectedInputRevision: 1, input: { quality: "Luxury" }, acceptedImpact: true },
    });
    assert.equal(keyConflict.response.status, 409);
    assert.equal(keyConflict.payload.code, "idempotency_conflict");

    const noChange = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "brief-revision-no-op-commit" },
      body: { expectedInputRevision: 2, input: { quality: "Premium" }, acceptedImpact: true },
    });
    assert.equal(noChange.response.status, 409);
    assert.equal(noChange.payload.code, "no_revision_changes");

    const concurrentBodies = [
      { key: "brief-revision-race-width-31", input: { width: 31 } },
      { key: "brief-revision-race-width-32", input: { width: 32 } },
    ];
    const raced = await Promise.all(concurrentBodies.map(({ key, input }) => call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": key },
      body: { expectedInputRevision: 2, input, acceptedImpact: true },
    })));
    assert.deepEqual(raced.map((item) => item.response.status).sort((a, b) => a - b), [201, 409]);
    assert.equal(raced.find((item) => item.response.status === 409)?.payload.code, "project_revision_conflict");
    const winner = raced.find((item) => item.response.status === 201);
    assert.equal(winner.payload.revision.revision, 3);

    const currentProject = await call(server.origin, `/api/projects/${project.id}`, { auth: owner });
    assert.equal(currentProject.response.status, 200, JSON.stringify(currentProject.payload));
    assert.equal(currentProject.payload.project.inputRevision, 3);
    const revisionRows = await call(server.origin, `${revisionPath(project.id)}?limit=50`, { auth: owner });
    assert.equal(revisionRows.response.status, 200, JSON.stringify(revisionRows.payload));
    assert.deepEqual(revisionRows.payload.revisions.map((revision) => revision.revision), [3, 2, 1]);
    assert.equal(revisionRows.payload.revisions.filter((revision) => revision.current).length, 1);
    assert.equal(revisionRows.payload.revisions[0].current, true);
    assertNoInternalRevisionKeys(revisionRows.payload);

    const firstPage = await call(server.origin, `${revisionPath(project.id)}?limit=1`, { auth: owner });
    assert.equal(firstPage.response.status, 200, JSON.stringify(firstPage.payload));
    assert.equal(firstPage.payload.revisions.length, 1);
    assert.equal(firstPage.payload.pagination.hasMore, true);
    assert.equal(firstPage.payload.pagination.nextBeforeRevision, 3);
    assertNoInternalRevisionKeys(firstPage.payload);
    const secondPage = await call(
      server.origin,
      `${revisionPath(project.id)}?limit=1&beforeRevision=${firstPage.payload.pagination.nextBeforeRevision}`,
      { auth: owner },
    );
    assert.equal(secondPage.response.status, 200, JSON.stringify(secondPage.payload));
    assert.equal(secondPage.payload.revisions[0].revision, 2);
    assertNoInternalRevisionKeys(secondPage.payload);

    const initialDetail = await call(server.origin, revisionPath(project.id, "/1"), { auth: owner });
    assert.equal(initialDetail.response.status, 200, JSON.stringify(initialDetail.payload));
    assertExactKeys(initialDetail.payload, ["project", "revision", "previousRevision", "changeStudy"], "revision detail response");
    assertRevisionDetail(initialDetail.payload.revision);
    assert.equal(initialDetail.payload.previousRevision, null);
    assert.equal(initialDetail.payload.revision.current, false);
    assert.equal(initialDetail.payload.changeStudy, null);
    assertNoInternalRevisionKeys(initialDetail.payload);

    const historicalReport = await call(server.origin, revisionPath(project.id, "/1/report"), { auth: owner });
    assert.equal(historicalReport.response.status, 200, JSON.stringify(historicalReport.payload));
    assertReportEnvelope(historicalReport.payload, "historical revision report");
    assert.equal(historicalReport.payload.revision.revision, 1);
    assert.equal(historicalReport.payload.revision.current, false);
    assert.equal(historicalReport.payload.project.input.quality, completeInput.quality);
    assert.deepEqual(historicalReport.payload.report, initialReport);
    assertNoInternalRevisionKeys(historicalReport.payload, { allowReportInputHash: true });

    const currentReportRead = await call(server.origin, `/api/projects/${project.id}/report`, { auth: owner });
    assert.equal(currentReportRead.response.status, 404, JSON.stringify(currentReportRead.payload));
    assert.equal(currentReportRead.payload.code, "report_not_found");
    const regenerated = await call(server.origin, `/api/projects/${project.id}/report`, {
      method: "POST",
      auth: owner,
      body: {},
    });
    assert.equal(regenerated.response.status, 201, JSON.stringify(regenerated.payload));
    assertReportEnvelope(regenerated.payload, "regenerated current report");
    assert.equal(regenerated.payload.revision.revision, 3);
    assert.equal(regenerated.payload.revision.current, true);
    assert.equal(JSON.stringify(regenerated.payload.report).includes("Conceptually feasible"), false);
    assertNoInternalRevisionKeys(regenerated.payload, { allowReportInputHash: true });
    const currentHistoricalReport = await call(server.origin, revisionPath(project.id, "/3/report"), { auth: owner });
    assert.equal(currentHistoricalReport.response.status, 200, JSON.stringify(currentHistoricalReport.payload));
    assertReportEnvelope(currentHistoricalReport.payload, "current historical-route report");
    assert.equal(currentHistoricalReport.payload.revision.revision, 3);
    assert.equal(currentHistoricalReport.payload.revision.current, true);
    assertNoInternalRevisionKeys(currentHistoricalReport.payload, { allowReportInputHash: true });

    const closedFamily = await call(server.origin, `/api/family-alignment/${family.token}`);
    assert.equal(closedFamily.response.status, 410, JSON.stringify(closedFamily.payload));
    const currentHome = await call(server.origin, `/api/projects/${project.id}/home`, { auth: owner });
    assert.equal(currentHome.response.status, 200, JSON.stringify(currentHome.payload));
    assert.equal(currentHome.payload.lifecycle.stage, "comparison_stale");
    assert.equal(currentHome.payload.current.comparison.current, false);
    assert.equal(currentHome.payload.current.selection.available, false);
    assert.equal(currentHome.payload.current.purchase.current, false);
    assert.equal(currentHome.payload.current.purchase.available, false);
    assert.equal(currentHome.payload.counts.comparisons, 1);
    assert.equal(currentHome.payload.counts.purchasedArtifacts, 1);
    assert.equal(currentHome.payload.counts.orders, 1);

    const foreignPreview = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: other,
      body: { expectedInputRevision: 3, input: { width: 40 } },
    });
    const missingPreview = await call(server.origin, revisionPath("00000000-0000-4000-8000-000000000000", "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 3, input: { width: 40 } },
    });
    assert.equal(foreignPreview.response.status, 404);
    assert.equal(foreignPreview.payload.code, "project_not_found");
    assert.equal(missingPreview.response.status, 404);
    assert.equal(missingPreview.payload.code, "project_not_found");
    const anonymousList = await call(server.origin, revisionPath(project.id));
    assert.equal(anonymousList.response.status, 401);
    const missingCsrf = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      includeCsrf: false,
      body: { expectedInputRevision: 3, input: { width: 40 } },
    });
    assert.equal(missingCsrf.response.status, 403);
    assert.equal(missingCsrf.payload.code, "csrf_rejected");
    const foreignOrigin = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      requestOrigin: "https://attacker.example.test",
      body: { expectedInputRevision: 3, input: { width: 40 } },
    });
    assert.equal(foreignOrigin.response.status, 403);
    assert.equal(foreignOrigin.payload.code, "origin_rejected");
    const unknownInput = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 3, input: { preciseAddress: "BRIEF_REVISION_PRIVATE_ADDRESS" } },
    });
    assert.equal(unknownInput.response.status, 400);
    assert.equal(unknownInput.payload.code, "invalid_revision_request");
    for (const body of [
      { expectedInputRevision: "3", input: { width: 40 } },
      { expectedInputRevision: 3, input: { width: [40] } },
      { expectedInputRevision: 3, input: { width: "40" } },
      { expectedInputRevision: 3, input: { bedrooms: true } },
    ]) {
      const confusedScalar = await call(server.origin, revisionPath(project.id, "/preview"), {
        method: "POST",
        auth: owner,
        body,
      });
      assert.equal(confusedScalar.response.status, 400, JSON.stringify(confusedScalar.payload));
      assert.equal(confusedScalar.payload.code, "invalid_revision_request");
    }
    const oversized = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      rawBody: JSON.stringify({ expectedInputRevision: 3, input: { style: "x".repeat(70_000) } }),
    });
    assert.equal(oversized.response.status, 413);
    assert.equal(oversized.payload.code, "payload_too_large");
    const invalidPagination = await call(server.origin, `${revisionPath(project.id)}?limit=0`, { auth: owner });
    assert.equal(invalidPagination.response.status, 400);
    assert.equal(invalidPagination.payload.code, "invalid_pagination");
    const invalidKey = await call(server.origin, revisionPath(project.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "bad key!" },
      body: { expectedInputRevision: 3, input: { width: 40 }, acceptedImpact: true },
    });
    assert.equal(invalidKey.response.status, 400);
    assert.equal(invalidKey.payload.code, "invalid_idempotency_key");
    const unknownNested = await call(server.origin, revisionPath(project.id, "/1/unknown"), { auth: owner });
    assert.equal(unknownNested.response.status, 404);
    assert.equal(unknownNested.response.headers.get("content-type")?.includes("application/json"), true);

    const paidPatchMissingExpected = await call(server.origin, `/api/projects/${project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { input: { bathrooms: 4 } },
    });
    assert.equal(paidPatchMissingExpected.response.status, 400);
    assert.equal(paidPatchMissingExpected.payload.code, "invalid_revision_request");

    const archived = await call(server.origin, `/api/projects/${project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { status: "archived" },
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
    const archivedPreview = await call(server.origin, revisionPath(project.id, "/preview"), {
      method: "POST",
      auth: owner,
      body: { expectedInputRevision: 3, input: { width: 40 } },
    });
    assert.equal(archivedPreview.response.status, 409);
    assert.equal(archivedPreview.payload.code, "project_archived");
    const archivedHistory = await call(server.origin, revisionPath(project.id), { auth: owner });
    assert.equal(archivedHistory.response.status, 200, JSON.stringify(archivedHistory.payload));
    assert.equal(archivedHistory.payload.revisions.length, 3);
    assertNoInternalRevisionKeys(archivedHistory.payload);

    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const immutableAfter = rowsFor(
      stateDirectory,
      `SELECT 'comparison' AS source,id,content_json AS value FROM decision_comparisons WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'selection',comparison_id,scenario_id||'|'||selected_at||'|'||COALESCE(locked_at,'') FROM decision_selections WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'order',id,status||'|'||COALESCE(provider_payment_id,'')||'|'||COALESCE(entitlement_revoked_at,'') FROM orders WHERE project_id=${sqlLiteral(project.id)}
       UNION ALL SELECT 'snapshot',id,artifact_json FROM purchased_decision_snapshots WHERE project_id=${sqlLiteral(project.id)}
       ORDER BY source,id`,
      "historical evidence reconciliation failed",
    );
    assert.deepEqual(immutableAfter, immutableBefore, "revision saves must not rewrite comparisons, choice, purchase, or money evidence");
    const familyRow = rowsFor(
      stateDirectory,
      `SELECT revoked_at FROM family_alignment_rooms WHERE id=${sqlLiteral(family.room.id)}`,
      "Family room closure query failed",
    )[0];
    assert.ok(familyRow?.revoked_at, "source revision must permanently close the old Family room");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const disposable = await createProject(server.origin, owner, "DISPOSABLE");
    const disposableRevision = await call(server.origin, revisionPath(disposable.id), {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "brief-revision-disposable-save" },
      body: { expectedInputRevision: 1, input: { bathrooms: 4 }, acceptedImpact: true },
    });
    assert.equal(disposableRevision.response.status, 201, JSON.stringify(disposableRevision.payload));
    const disposableReport = await call(server.origin, `/api/projects/${disposable.id}/report`, {
      method: "POST",
      auth: owner,
      body: {},
    });
    assert.equal(disposableReport.response.status, 201, JSON.stringify(disposableReport.payload));
    const survivorProject = await createProject(server.origin, other, "PRIVACY_SURVIVOR");
    const deleted = await call(server.origin, `/api/projects/${disposable.id}`, { method: "DELETE", auth: owner });
    assert.equal(deleted.response.status, 204, JSON.stringify(deleted.payload));
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM project_revisions WHERE project_id=${sqlLiteral(disposable.id)}`)[0]?.count, 0);
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM project_revision_requests WHERE project_id=${sqlLiteral(disposable.id)}`)[0]?.count, 0);
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM project_revision_reports WHERE project_id=${sqlLiteral(disposable.id)}`)[0]?.count, 0);
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM reports WHERE project_id=${sqlLiteral(disposable.id)}`)[0]?.count, 0);
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM projects WHERE id=${sqlLiteral(survivorProject.id)}`)[0]?.count, 1);
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM project_revisions WHERE project_id=${sqlLiteral(survivorProject.id)}`)[0]?.count, 1);

    // Wrangler's local dev access log includes raw request URLs. Production and
    // staging invocation logs are disabled by the operational config gate, so
    // privacy assertions here inspect only Worker-owned completion/error lines.
    const logs = capturedLogs
      .join("\n")
      .split(/\r?\n/u)
      .filter((line) => line.includes('"type":"request_complete"') || line.includes("Unhandled API error"))
      .join("\n");
    for (const secret of [
      project.id,
      family.token,
      "BRIEF_REVISION_PRIVATE_NAME_PRIMARY",
      "BRIEF_REVISION_PRIVATE_STYLE",
      "BRIEF_REVISION_PRIVATE_NOTE_A",
      "BRIEF_REVISION_PRIVATE_NOTE_B",
      "BRIEF_REVISION_PRIVATE_ADDRESS",
      commitKey,
    ]) {
      assert.equal(logs.includes(secret), false, `completion logs contain private canary ${secret}`);
    }
    assert.match(logs, /"route":"\/api\/projects\/:projectId\/revisions\/preview"/u);
    assert.match(logs, /"route":"\/api\/projects\/:projectId\/revisions"/u);
    assert.match(logs, /"route":"\/api\/projects\/:projectId\/revisions\/:revision\/report"/u);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test("migration 0012 starts legacy history honestly and remains usable across an old-Worker-style rollback", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-brief-revisions-legacy-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory);
  const port = await reservePort();
  let server = null;
  try {
    applyMigrationFilesThrough(stateDirectory, 11);
    const userId = "brief-revision-legacy-user";
    const projectId = "brief-revision-legacy-project";
    const sessionToken = "brief-revision-legacy-session-token-with-safe-entropy";
    const csrfToken = "brief-revision-legacy-csrf-token-with-safe-entropy";
    const auth = {
      cookie: `__Host-grihagrid_session=${sessionToken}; grihagrid_csrf=${csrfToken}`,
      csrf: csrfToken,
    };
    const legacyInput = { ...completeInput, quality: "Signature", legacyPrivateField: "LEGACY_PRIVATE_FIELD" };
    const legacyEstimate = {
      plotSqft: 1500,
      builtUpSqft: 1830,
      lowInr: 3_703_920,
      highInr: 4_428_600,
      floors: "G+1",
      quality: "Signature",
      city: "Pune",
      disclaimer: "Indicative concept-stage estimate; not a contractor quote.",
    };
    const legacyReportHash = createHash("sha256")
      .update(stableStringify({ version: 1, input: legacyInput, estimate: legacyEstimate }))
      .digest("hex");
    const legacyReport = {
      id: "brief-revision-legacy-report-v1",
      projectId,
      version: 1,
      inputHash: legacyReportHash,
      generatedAt: "2026-08-14 00:00:00",
      title: "Legacy report",
      summary: { verdict: "Conceptually feasible, subject to local approvals and site verification" },
    };
    const legacySeed = `
      INSERT INTO users (id,email,name,created_at)
      VALUES (${sqlLiteral(userId)},'legacy-brief-revision@example.test','Legacy revision owner','2026-08-14 00:00:00');
      INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,csrf_hash,last_seen_at)
      VALUES (
        'brief-revision-legacy-session',
        ${sqlLiteral(userId)},
        ${sqlLiteral(createHash("sha256").update(sessionToken).digest("base64url"))},
        '2099-01-01 00:00:00',
        '2026-08-14 00:00:00',
        ${sqlLiteral(createHash("sha256").update(csrfToken).digest("base64url"))},
        '2026-08-14 00:00:00'
      );
      INSERT INTO projects
        (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
      VALUES (
        ${sqlLiteral(projectId)},${sqlLiteral(userId)},'Legacy revision 4','report_ready',
        ${sqlLiteral(JSON.stringify(legacyInput))},${sqlLiteral(JSON.stringify(legacyEstimate))},
        '2026-08-14 00:00:00','2026-08-14 00:00:00',4
      );
      INSERT INTO reports
        (id,project_id,user_id,version,input_hash,content_json,generated_at,updated_at)
      VALUES (
        'brief-revision-legacy-report-v1',${sqlLiteral(projectId)},${sqlLiteral(userId)},1,
        ${sqlLiteral(legacyReportHash)},${sqlLiteral(JSON.stringify(legacyReport))},
        '2026-08-14 00:00:00','2026-08-14 00:00:00'
      );
    `;
    requireD1Success(d1(stateDirectory, "execute", legacySeed), "legacy revision-4 seed failed");
    const migration12 = path.join(root, "migrations", "0012_brief_check_revision_history.sql");
    requireD1Success(d1(stateDirectory, "file", migration12), "legacy 0012 upgrade failed");

    const migratedRevisions = rowsFor(
      stateDirectory,
      `SELECT revision,provenance,input_json,content_hash FROM project_revisions WHERE project_id=${sqlLiteral(projectId)} ORDER BY revision`,
      "migrated legacy revision query failed",
    );
    assert.equal(migratedRevisions.length, 1, JSON.stringify(migratedRevisions));
    assert.equal(migratedRevisions[0].revision, 4);
    assert.equal(migratedRevisions[0].provenance, "migration_baseline");
    assert.equal(migratedRevisions[0].content_hash, null);
    assert.equal(JSON.parse(migratedRevisions[0].input_json).legacyPrivateField, "LEGACY_PRIVATE_FIELD");
    const migratedReports = rowsFor(
      stateDirectory,
      `SELECT project_revision,report_schema_version,content_json FROM project_revision_reports WHERE project_id=${sqlLiteral(projectId)}`,
      "migrated legacy report query failed",
    );
    assert.equal(migratedReports.length, 1);
    assert.equal(migratedReports[0].project_revision, 4);
    assert.equal(migratedReports[0].report_schema_version, 1);
    assert.deepEqual(JSON.parse(migratedReports[0].content_json), legacyReport);

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const legacyHistory = await call(server.origin, revisionPath(projectId), { auth });
    assert.equal(legacyHistory.response.status, 200, JSON.stringify(legacyHistory.payload));
    assert.equal(legacyHistory.payload.historyStartsAtRevision, 4);
    assert.deepEqual(legacyHistory.payload.revisions.map((revision) => revision.revision), [4]);
    assert.equal(legacyHistory.payload.revisions[0].provenance, "migration_baseline");
    assert.equal(Object.hasOwn(legacyHistory.payload.revisions[0], "input"), false, "list revision must omit full input");
    assert.equal(
      JSON.stringify(legacyHistory.payload.revisions[0]).includes("LEGACY_PRIVATE_FIELD"),
      false,
      "list revision summary must omit unsupported legacy input",
    );
    assertBriefCheck(legacyHistory.payload.briefCheck);
    assertNoInternalRevisionKeys(legacyHistory.payload);

    const legacyHistorical = await call(server.origin, revisionPath(projectId, "/4/report"), { auth });
    assert.equal(legacyHistorical.response.status, 200, JSON.stringify(legacyHistorical.payload));
    assert.equal(legacyHistorical.payload.report.version, 1);
    assert.equal(JSON.stringify(legacyHistorical.payload.report).includes("Conceptually feasible"), true, "migration must preserve v1 bytes as history");
    assertNoInternalRevisionKeys(legacyHistorical.payload, { allowReportInputHash: true });

    await stopWorker(server);
    server = null;
    const beforeCurrentRead = databaseSnapshot(stateDirectory);
    server = await startWorker(stateDirectory, assetsDirectory, port);
    const legacyCurrentRead = await call(server.origin, `/api/projects/${projectId}/report`, { auth });
    assert.equal(legacyCurrentRead.response.status, 404, JSON.stringify(legacyCurrentRead.payload));
    assert.equal(legacyCurrentRead.payload.code, "report_not_found");
    await stopWorker(server);
    server = null;
    const afterCurrentRead = databaseSnapshot(stateDirectory);
    assert.deepEqual(afterCurrentRead, beforeCurrentRead, "current report GET must not promote or rewrite a migrated v1 report");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const concurrentReports = await Promise.all([
      call(server.origin, `/api/projects/${projectId}/report`, { method: "POST", auth, body: {} }),
      call(server.origin, `/api/projects/${projectId}/report`, { method: "POST", auth, body: {} }),
    ]);
    assert.equal(concurrentReports.some((result) => result.response.status >= 500), false, JSON.stringify(concurrentReports.map((result) => result.payload)));
    assert.equal(concurrentReports.some((result) => [200, 201].includes(result.response.status)), true);
    for (const result of concurrentReports.filter((item) => [200, 201].includes(item.response.status))) {
      assert.equal(result.payload.report.version, 2);
      assert.equal(JSON.stringify(result.payload.report).includes("Conceptually feasible"), false);
    }
    await stopWorker(server);
    server = null;
    const revisionFourReports = rowsFor(
      stateDirectory,
      `SELECT report_schema_version,content_json FROM project_revision_reports
        WHERE project_id=${sqlLiteral(projectId)} AND project_revision=4 ORDER BY report_schema_version`,
      "concurrent report snapshot query failed",
    );
    assert.deepEqual(revisionFourReports.map((row) => row.report_schema_version), [1, 2]);
    assert.equal(revisionFourReports.filter((row) => row.report_schema_version === 2).length, 1);
    assert.equal(JSON.parse(revisionFourReports.find((row) => row.report_schema_version === 1).content_json).summary.verdict, legacyReport.summary.verdict);
    const currentCache = rowsFor(
      stateDirectory,
      `SELECT version,project_input_revision,content_json FROM reports WHERE project_id=${sqlLiteral(projectId)}`,
      "current report cache query failed",
    );
    assert.equal(currentCache.length, 1);
    assert.equal(currentCache[0].version, 2);
    assert.equal(currentCache[0].project_input_revision, 4);

    const rollbackInput = {
      ...legacyInput,
      width: 32,
      budgetLakh: 5,
      legacyPrivateField: "ROLLBACK_PRIVATE_FIELD",
    };
    const rollbackEstimate = {
      ...legacyEstimate,
      plotSqft: 1600,
      builtUpSqft: 1952,
      lowInr: 3_950_848,
      highInr: 4_723_840,
    };
    // Simulate the exact source columns an older Worker knows. It deliberately
    // leaves 0012-derived hashes and Brief Check columns untouched.
    const oldWorkerUpdate = `
      UPDATE projects
         SET input_json=${sqlLiteral(JSON.stringify(rollbackInput))},
             estimate_json=${sqlLiteral(JSON.stringify(rollbackEstimate))},
             input_revision=input_revision+1,
             status='feasibility_ready',
             updated_at='2026-08-15 01:00:00'
       WHERE id=${sqlLiteral(projectId)} AND user_id=${sqlLiteral(userId)};
    `;
    requireD1Success(d1(stateDirectory, "execute", oldWorkerUpdate), "old-Worker-style source update failed after 0012");
    const rollbackRevisions = rowsFor(
      stateDirectory,
      `SELECT revision,provenance,content_hash,brief_check_json,input_json
         FROM project_revisions WHERE project_id=${sqlLiteral(projectId)} ORDER BY revision`,
      "rollback-created revision query failed",
    );
    assert.deepEqual(rollbackRevisions.map((row) => row.revision), [4, 5]);
    assert.equal(rollbackRevisions[1].provenance, "updated");
    assert.equal(rollbackRevisions[1].content_hash, null);
    assert.equal(rollbackRevisions[1].brief_check_json, null);
    assert.equal(JSON.parse(rollbackRevisions[1].input_json).legacyPrivateField, "ROLLBACK_PRIVATE_FIELD");
    const rollbackProjection = rowsFor(
      stateDirectory,
      `SELECT input_hash,brief_check_json FROM projects WHERE id=${sqlLiteral(projectId)}`,
      "rollback current projection query failed",
    )[0];
    assert.equal(rollbackProjection.input_hash, null, "old-Worker source change must clear the stale current fingerprint");
    assert.equal(rollbackProjection.brief_check_json, null, "old-Worker source change must clear the stale current Brief Check");
    assert.equal(rowsFor(stateDirectory, `SELECT COUNT(*) AS count FROM reports WHERE project_id=${sqlLiteral(projectId)}`)[0]?.count, 0);

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const afterRollbackHistory = await call(server.origin, revisionPath(projectId), { auth });
    assert.equal(afterRollbackHistory.response.status, 200, JSON.stringify(afterRollbackHistory.payload));
    assert.equal(afterRollbackHistory.payload.historyStartsAtRevision, 4);
    assert.deepEqual(afterRollbackHistory.payload.revisions.map((revision) => revision.revision), [5, 4]);
    assertBriefCheck(afterRollbackHistory.payload.briefCheck);
    assert.equal(afterRollbackHistory.payload.briefCheck.status, "programme_tension");
    assert.equal(afterRollbackHistory.payload.revisions[0].briefCheck.status, "programme_tension");
    assert.equal(afterRollbackHistory.payload.revisions[0].current, true);
    assert.equal(JSON.stringify(afterRollbackHistory.payload).includes("ROLLBACK_PRIVATE_FIELD"), false);
    assertNoInternalRevisionKeys(afterRollbackHistory.payload);

    const recoveredReports = await Promise.all([
      call(server.origin, `/api/projects/${projectId}/report`, { method: "POST", auth, body: {} }),
      call(server.origin, `/api/projects/${projectId}/report`, { method: "POST", auth, body: {} }),
    ]);
    assert.equal(recoveredReports.some((result) => result.response.status >= 500), false, JSON.stringify(recoveredReports.map((result) => result.payload)));
    assert.equal(recoveredReports.some((result) => [200, 201].includes(result.response.status)), true);
    for (const result of recoveredReports.filter((item) => [200, 201].includes(item.response.status))) {
      assert.equal(result.payload.report.briefCheck.status, "programme_tension");
    }
    await stopWorker(server);
    server = null;
    const recoveredHistory = rowsFor(
      stateDirectory,
      `SELECT project_revision,report_schema_version,source_content_hash
         FROM project_revision_reports WHERE project_id=${sqlLiteral(projectId)} ORDER BY project_revision,report_schema_version`,
      "rollback report recovery query failed",
    );
    assert.deepEqual(recoveredHistory.map((row) => [row.project_revision, row.report_schema_version]), [[4, 1], [4, 2], [5, 2]]);
    assert.equal(recoveredHistory.find((row) => row.project_revision === 5)?.source_content_hash, null);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
