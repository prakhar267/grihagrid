import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const metricsToken = "report-feedback-e2e-metrics-token-2026";

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
  return `${current}${String(chunk)}`.slice(-200_000);
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
    "--var",
    `METRICS_READ_TOKEN:${metricsToken}`,
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
      throw new Error(`wrangler dev exited before health was ready (${JSON.stringify(earlyExit)}):\n${logs}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.body?.cancel();
        return { child, exited, origin, logs: () => logs };
      }
      await response.body?.cancel();
    } catch {
      // workerd has not bound the local socket yet.
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

function d1(stateDirectory, action, value = null) {
  const args = ["d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
    if (value) args.push("--config", value);
  } else if (action === "file") {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--file", value);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", value);
    if (action === "query") args.push("--json");
  }
  return spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

function requireD1Success(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function query(stateDirectory, sql, context = "D1 query failed") {
  const result = requireD1Success(d1(stateDirectory, "query", sql), context);
  return JSON.parse(result.stdout).flatMap((entry) => entry.results || []);
}

function migrationFile(number) {
  const prefix = String(number).padStart(4, "0");
  const names = readdirSync(path.join(root, "migrations"))
    .filter((name) => name.startsWith(`${prefix}_`) && name.endsWith(".sql"));
  assert.equal(names.length, 1, `expected exactly one ${prefix} migration, found ${names.length}`);
  return path.join(root, "migrations", names[0]);
}

function migrationSubset(stateDirectory, maximum) {
  const subset = path.join(stateDirectory, `migrations-through-${String(maximum).padStart(4, "0")}`);
  mkdirSync(subset, { recursive: true });
  for (let number = 1; number <= maximum; number += 1) {
    const file = migrationFile(number);
    copyFileSync(file, path.join(subset, path.basename(file)));
  }
  const config = path.join(stateDirectory, "wrangler-pre-feedback.toml");
  writeFileSync(config, [
    'name = "grihagrid-report-feedback-pre-migration"',
    `main = ${JSON.stringify(path.join(root, "worker", "index.js"))}`,
    'compatibility_date = "2026-08-01"',
    "",
    "[[d1_databases]]",
    'binding = "DB"',
    'database_name = "grihagrid-db"',
    'database_id = "42a75a83-ab24-4e3f-93f1-b80c51284f1e"',
    `migrations_dir = ${JSON.stringify(subset)}`,
    "",
  ].join("\n"));
  return config;
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
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
  if ((body !== undefined || rawBody !== undefined) && !requestHeaders.has("content-type")) {
    requestHeaders.set("content-type", "application/json");
  }
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    if (includeCsrf) requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!["GET", "HEAD"].includes(method)) requestHeaders.set("origin", requestOrigin ?? origin);
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: requestHeaders,
    body: rawBody !== undefined ? rawBody : body === undefined ? undefined : JSON.stringify(body),
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
      name: `Feedback owner ${suffix}`,
      email: `feedback-owner-${suffix}@example.test`,
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

async function createProject(origin, auth) {
  const result = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    body: {
      name: "PRIVATE_REPORT_FEEDBACK_PROJECT_DO_NOT_EXPOSE",
      input: {
        width: 38,
        length: 62,
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        quality: "Signature",
        city: "Jaipur",
        budgetLakh: 68,
      },
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.project;
}

async function generateReport(origin, auth, projectId) {
  const result = await call(origin, `/api/projects/${encodeURIComponent(projectId)}/report`, {
    method: "POST",
    auth,
    body: {},
  });
  assert.equal([200, 201].includes(result.response.status), true, JSON.stringify(result.payload));
  return result.payload.report;
}

function feedbackPath(projectId, revision, schemaVersion) {
  return `/api/projects/${encodeURIComponent(projectId)}/revisions/${revision}/reports/${schemaVersion}/feedback`;
}

function assertFeedback(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [
    "createdAt", "outcome", "projectRevision", "reportSchemaVersion", "sections", "updatedAt",
  ].sort());
  assert.equal(value.projectRevision, expected.revision);
  assert.equal(value.reportSchemaVersion, expected.schemaVersion);
  assert.equal(value.outcome, expected.outcome);
  assert.deepEqual(value.sections, expected.sections);
  assert.match(value.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
  assert.match(value.updatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u);
}

function assertNoAggregateIdentifiers(value) {
  const forbidden = new Set([
    "projectid", "project_id", "projectrevision", "reportschemaversion", "userid", "user_id",
    "email", "name", "contentjson", "content_json", "sectionsjson", "sections_json",
  ]);
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `aggregate exposed identifier field ${key}`);
      visit(child);
    }
  }
  visit(value);
}

test("report feedback is exact, private, immutable-report-safe, and observable on real D1", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-report-feedback-e2e-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  const capturedLogs = [];
  try {
    const preFeedbackMigrations = migrationSubset(stateDirectory, 12);
    requireD1Success(
      d1(stateDirectory, "migrate", preFeedbackMigrations),
      "migrations through 0012 failed",
    );

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const beforeMigration = await call(server.origin, "/api/readiness");
    assert.equal(beforeMigration.response.status, 503, JSON.stringify(beforeMigration.payload));
    assert.equal(beforeMigration.payload.status, "not_ready");
    assert.equal(beforeMigration.payload.checks.reportFeedbackSchema, "outdated");
    assert.equal(beforeMigration.payload.capabilities.reportFeedback, false);
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;

    const feedbackMigration = migrationFile(13);
    assert.equal(path.basename(feedbackMigration), "0013_report_feedback_and_intake_hardening.sql");
    requireD1Success(d1(stateDirectory, "migrate"), "migration 0013 failed");
    const migrationLedger = query(stateDirectory, "SELECT id,name FROM d1_migrations ORDER BY id", "migration ledger query failed");
    assert.equal(migrationLedger.length, 13);
    assert.equal(migrationLedger.at(-1)?.name, path.basename(feedbackMigration));
    const schemaObjects = query(
      stateDirectory,
      `SELECT type,name FROM sqlite_master WHERE name IN (
        'report_feedback','idx_report_feedback_updated','idx_report_feedback_outcome',
        'report_feedback_insert_guard','report_feedback_update_guard',
        'project_input_allowlist_insert_guard','project_input_allowlist_update_guard',
        'project_account_limit_insert_guard'
      ) ORDER BY type,name`,
      "report feedback schema inspection failed",
    );
    assert.deepEqual(
      schemaObjects.map((row) => row.name).sort(),
      [
        "report_feedback", "idx_report_feedback_updated", "idx_report_feedback_outcome",
        "report_feedback_insert_guard", "report_feedback_update_guard",
        "project_input_allowlist_insert_guard", "project_input_allowlist_update_guard",
        "project_account_limit_insert_guard",
      ].sort(),
    );
    const feedbackTableSql = String(query(
      stateDirectory,
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='report_feedback'",
      "report feedback table SQL inspection failed",
    )[0]?.sql || "");
    assert.match(feedbackTableSql, /report_schema_version\s*=\s*2/iu, "feedback must reject legacy report schemas at SQL time");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.status, "ready");
    assert.equal(readiness.payload.checks.reportFeedbackSchema, "current");
    assert.equal(readiness.payload.capabilities.reportFeedback, true);

    const owner = await register(server.origin, "primary");
    const other = await register(server.origin, "other");
    const project = await createProject(server.origin, owner);
    const report = await generateReport(server.origin, owner, project.id);
    const revision = 1;
    const schemaVersion = Number(report.version);
    assert.equal(schemaVersion, 2);
    const pathV1 = feedbackPath(project.id, revision, schemaVersion);
    const legacySchemaFeedback = await call(server.origin, feedbackPath(project.id, revision, 1), { auth: owner });
    assert.equal(legacySchemaFeedback.response.status, 404);
    assert.equal(legacySchemaFeedback.payload.code, "report_not_found");

    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;

    const reportBefore = query(
      stateDirectory,
      `SELECT hex(content_json) AS content_bytes,source_content_hash,input_hash,generated_at
         FROM project_revision_reports
        WHERE project_id=${sqlLiteral(project.id)}
          AND project_revision=${revision}
          AND report_schema_version=${schemaVersion}`,
      "initial immutable report snapshot failed",
    );
    assert.equal(reportBefore.length, 1);

    const invalidFeedbackSql = d1(
      stateDirectory,
      "execute",
      `INSERT INTO report_feedback
         (project_id,project_revision,report_schema_version,user_id,outcome,sections_json,created_at,updated_at)
       VALUES (
         ${sqlLiteral(project.id)},1,${schemaVersion},${sqlLiteral(owner.user.id)},
         'helpful','["overall","brief_check"]',datetime('now'),datetime('now')
       )`,
    );
    assert.notEqual(invalidFeedbackSql.status, 0, "D1 must reject invalid feedback even when the Worker is bypassed");
    const invalidInputSql = d1(
      stateDirectory,
      "execute",
      `UPDATE projects SET input_json='"not-an-object"' WHERE id=${sqlLiteral(project.id)}`,
    );
    assert.notEqual(invalidInputSql.status, 0, "D1 must reject non-object project input when the Worker is bypassed");
    const hiddenInputSql = d1(
      stateDirectory,
      "execute",
      `UPDATE projects SET input_json=json_set(input_json,'$.soilReport',json('true')) WHERE id=${sqlLiteral(project.id)}`,
    );
    assert.notEqual(hiddenInputSql.status, 0, "D1 must reject hidden project-input claims when the Worker is bypassed");
    assert.equal(
      Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM report_feedback WHERE project_id=${sqlLiteral(project.id)}`)[0].count),
      0,
      "rejected SQL bypasses must leave no feedback row",
    );

    server = await startWorker(stateDirectory, assetsDirectory, port);

    const unauthenticatedGet = await call(server.origin, pathV1);
    assert.equal(unauthenticatedGet.response.status, 401);
    assert.equal(unauthenticatedGet.payload.code, "unauthenticated");
    const unauthenticatedPut = await call(server.origin, pathV1, {
      method: "PUT",
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(unauthenticatedPut.response.status, 401);
    assert.equal(unauthenticatedPut.payload.code, "unauthenticated");

    const missingProjectId = "11111111-1111-4111-8111-111111111111";
    const foreignGet = await call(server.origin, pathV1, { auth: other });
    const missingGet = await call(server.origin, feedbackPath(missingProjectId, revision, schemaVersion), { auth: other });
    assert.deepEqual(
      { status: foreignGet.response.status, payload: foreignGet.payload },
      { status: missingGet.response.status, payload: missingGet.payload },
      "foreign feedback GET must not become a project-existence oracle",
    );
    assert.equal(foreignGet.response.status, 404);
    const foreignPut = await call(server.origin, pathV1, {
      method: "PUT",
      auth: other,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    const missingPut = await call(server.origin, feedbackPath(missingProjectId, revision, schemaVersion), {
      method: "PUT",
      auth: other,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.deepEqual(
      { status: foreignPut.response.status, payload: foreignPut.payload },
      { status: missingPut.response.status, payload: missingPut.payload },
      "foreign feedback PUT must not become a project-existence oracle",
    );
    assert.equal(foreignPut.response.status, 404);

    const empty = await call(server.origin, pathV1, { auth: owner });
    assert.equal(empty.response.status, 200, JSON.stringify(empty.payload));
    assert.deepEqual(empty.payload, { feedback: null });

    const rejectedOrigin = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      requestOrigin: "https://attacker.example.test",
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(rejectedOrigin.response.status, 403);
    assert.equal(rejectedOrigin.payload.code, "origin_rejected");
    const rejectedCsrf = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      includeCsrf: false,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(rejectedCsrf.response.status, 403);
    assert.equal(rejectedCsrf.payload.code, "csrf_rejected");
    const wrongMethod = await call(server.origin, pathV1, {
      method: "POST",
      auth: owner,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(wrongMethod.response.status, 405);
    assert.equal(wrongMethod.response.headers.get("allow"), "GET, PUT");

    const invalidBodies = [
      { body: null, code: "invalid_json" },
      { body: [], code: "invalid_json" },
      { body: {}, code: "invalid_report_feedback" },
      { body: { outcome: "helpful" }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: ["overall"], comment: "free text" }, code: "invalid_report_feedback" },
      { body: { outcome: "excellent", sections: ["overall"] }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: [] }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: "overall" }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: ["brief_check", "programme", "cost_range", "assumptions"] }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: ["brief_check", "brief_check"] }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: ["not_a_report_section"] }, code: "invalid_report_feedback" },
      { body: { outcome: "helpful", sections: ["overall", "brief_check"] }, code: "invalid_report_feedback" },
    ];
    for (const fixture of invalidBodies) {
      const invalid = await call(server.origin, pathV1, { method: "PUT", auth: owner, body: fixture.body });
      assert.equal(invalid.response.status, 400, JSON.stringify({ fixture, payload: invalid.payload }));
      assert.equal(invalid.payload.code, fixture.code);
    }
    const malformed = await call(server.origin, pathV1, { method: "PUT", auth: owner, rawBody: "{" });
    assert.equal(malformed.response.status, 400);
    assert.equal(malformed.payload.code, "invalid_json");
    const wrongContentType = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      rawBody: JSON.stringify({ outcome: "helpful", sections: ["overall"] }),
      headers: { "content-type": "text/plain" },
    });
    assert.equal(wrongContentType.response.status, 415);
    assert.equal(wrongContentType.payload.code, "unsupported_media_type");

    const invalidRevision = await call(server.origin, feedbackPath(project.id, 0, schemaVersion), { auth: owner });
    assert.equal(invalidRevision.response.status, 400);
    assert.equal(invalidRevision.payload.code, "invalid_revision_request");
    const invalidSchema = await call(server.origin, feedbackPath(project.id, revision, 0), { auth: owner });
    assert.equal(invalidSchema.response.status, 400);
    assert.equal(invalidSchema.payload.code, "invalid_report_feedback");
    const missingSchema = await call(server.origin, feedbackPath(project.id, revision, schemaVersion + 1), { auth: owner });
    assert.equal(missingSchema.response.status, 404);
    assert.equal(missingSchema.payload.code, "report_not_found");

    const created = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(created.response.status, 200, JSON.stringify(created.payload));
    assert.deepEqual(Object.keys(created.payload), ["feedback"]);
    assertFeedback(created.payload.feedback, {
      revision,
      schemaVersion,
      outcome: "helpful",
      sections: ["overall"],
    });
    assert.equal(created.payload.feedback.createdAt, created.payload.feedback.updatedAt);

    const createReplay = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(createReplay.response.status, 200, JSON.stringify(createReplay.payload));
    assert.deepEqual(createReplay.payload, created.payload, "an exact replay must preserve both timestamps");

    await wait(25);
    const updated = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      body: { outcome: "unclear", sections: ["next_actions", "brief_check"] },
    });
    assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
    assertFeedback(updated.payload.feedback, {
      revision,
      schemaVersion,
      outcome: "unclear",
      sections: ["brief_check", "next_actions"],
    });
    assert.equal(updated.payload.feedback.createdAt, created.payload.feedback.createdAt);
    assert.notEqual(updated.payload.feedback.updatedAt, created.payload.feedback.updatedAt);

    const updateReplay = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      body: { outcome: "unclear", sections: ["brief_check", "next_actions"] },
    });
    assert.equal(updateReplay.response.status, 200, JSON.stringify(updateReplay.payload));
    assert.deepEqual(updateReplay.payload, updated.payload, "canonical equivalent replay must preserve updatedAt");

    const feedbackRows = query(
      stateDirectory,
      `SELECT project_id,project_revision,report_schema_version,user_id,outcome,sections_json,created_at,updated_at
         FROM report_feedback WHERE project_id=${sqlLiteral(project.id)}`,
      "stored feedback query failed",
    );
    assert.equal(feedbackRows.length, 1);
    assert.equal(feedbackRows[0].user_id, owner.user.id);
    assert.equal(feedbackRows[0].outcome, "unclear");
    assert.deepEqual(JSON.parse(feedbackRows[0].sections_json), ["brief_check", "next_actions"]);
    assert.equal(feedbackRows[0].created_at, created.payload.feedback.createdAt);
    assert.equal(feedbackRows[0].updated_at, updated.payload.feedback.updatedAt);
    const reportAfterFeedback = query(
      stateDirectory,
      `SELECT hex(content_json) AS content_bytes,source_content_hash,input_hash,generated_at
         FROM project_revision_reports
        WHERE project_id=${sqlLiteral(project.id)}
          AND project_revision=${revision}
          AND report_schema_version=${schemaVersion}`,
      "post-feedback immutable report snapshot failed",
    );
    assert.deepEqual(reportAfterFeedback, reportBefore, "feedback writes must not alter one report byte or its provenance");

    const committed = await call(server.origin, `/api/projects/${encodeURIComponent(project.id)}/revisions`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "report-feedback-revision-two" },
      body: {
        expectedInputRevision: 1,
        input: { budgetLakh: 72 },
        acceptedImpact: true,
      },
    });
    assert.equal(committed.response.status, 201, JSON.stringify(committed.payload));
    assert.equal(committed.payload.revision.revision, 2);
    const historicalAfterCommit = await call(server.origin, pathV1, { auth: owner });
    assert.equal(historicalAfterCommit.response.status, 200, JSON.stringify(historicalAfterCommit.payload));
    assert.deepEqual(historicalAfterCommit.payload, updated.payload);

    const reportV2 = await generateReport(server.origin, owner, project.id);
    assert.equal(Number(reportV2.version), schemaVersion);
    const pathV2 = feedbackPath(project.id, 2, schemaVersion);
    const newRevisionEmpty = await call(server.origin, pathV2, { auth: owner });
    assert.equal(newRevisionEmpty.response.status, 200, JSON.stringify(newRevisionEmpty.payload));
    assert.deepEqual(newRevisionEmpty.payload, { feedback: null });
    const wrongRevision = await call(server.origin, feedbackPath(project.id, 3, schemaVersion), { auth: owner });
    assert.equal(wrongRevision.response.status, 404);
    assert.equal(wrongRevision.payload.code, "report_not_found");
    const reportAfterRevision = query(
      stateDirectory,
      `SELECT hex(content_json) AS content_bytes,source_content_hash,input_hash,generated_at
         FROM project_revision_reports
        WHERE project_id=${sqlLiteral(project.id)}
          AND project_revision=${revision}
          AND report_schema_version=${schemaVersion}`,
      "historical report preservation snapshot failed",
    );
    assert.deepEqual(reportAfterRevision, reportBefore);

    const hiddenMetrics = await call(server.origin, "/api/events/aggregate?days=30", {
      headers: { authorization: "Bearer wrong-report-feedback-metrics-token" },
    });
    assert.equal(hiddenMetrics.response.status, 404);
    const metrics = await call(server.origin, "/api/events/aggregate?days=30", {
      headers: { authorization: `Bearer ${metricsToken}` },
    });
    assert.equal(metrics.response.status, 200, JSON.stringify(metrics.payload));
    assert.equal(metrics.payload.windowDays, 30);
    assert.deepEqual(metrics.payload.reportFeedback, {
      totalResponses: 1,
      byOutcome: [{ outcome: "unclear", count: 1 }],
      bySection: [
        { section: "brief_check", count: 1 },
        { section: "next_actions", count: 1 },
      ],
    });
    assertNoAggregateIdentifiers(metrics.payload);
    const metricsJson = JSON.stringify(metrics.payload);
    for (const privateValue of [
      project.id,
      owner.user.id,
      owner.user.email,
      other.user.id,
      "PRIVATE_REPORT_FEEDBACK_PROJECT_DO_NOT_EXPOSE",
    ]) {
      assert.equal(metricsJson.includes(privateValue), false, `aggregate leaked ${privateValue}`);
    }

    const archived = await call(server.origin, `/api/projects/${encodeURIComponent(project.id)}`, {
      method: "PATCH",
      auth: owner,
      body: { status: "archived" },
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
    assert.equal(archived.payload.project.status, "archived");
    const archivedRead = await call(server.origin, pathV1, { auth: owner });
    assert.equal(archivedRead.response.status, 200, JSON.stringify(archivedRead.payload));
    assert.deepEqual(archivedRead.payload, updated.payload, "archiving must preserve saved feedback reads");
    const archivedWrite = await call(server.origin, pathV1, {
      method: "PUT",
      auth: owner,
      body: { outcome: "needs_review", sections: ["assumptions"] },
    });
    assert.equal(archivedWrite.response.status, 409, JSON.stringify(archivedWrite.payload));
    assert.equal(archivedWrite.payload.code, "project_archived");
    const archivedRows = query(
      stateDirectory,
      `SELECT outcome,sections_json,created_at,updated_at FROM report_feedback WHERE project_id=${sqlLiteral(project.id)}`,
      "archived feedback preservation query failed",
    );
    assert.deepEqual(archivedRows, [{
      outcome: "unclear",
      sections_json: JSON.stringify(["brief_check", "next_actions"]),
      created_at: created.payload.feedback.createdAt,
      updated_at: updated.payload.feedback.updatedAt,
    }]);

    const deleted = await call(server.origin, `/api/projects/${encodeURIComponent(project.id)}`, {
      method: "DELETE",
      auth: owner,
    });
    assert.equal(deleted.response.status, 204, JSON.stringify(deleted.payload));
    assert.equal(deleted.payload, null);
    const cascade = query(
      stateDirectory,
      `SELECT
        (SELECT COUNT(*) FROM projects WHERE id=${sqlLiteral(project.id)}) AS projects,
        (SELECT COUNT(*) FROM project_revision_reports WHERE project_id=${sqlLiteral(project.id)}) AS reports,
        (SELECT COUNT(*) FROM report_feedback WHERE project_id=${sqlLiteral(project.id)}) AS feedback`,
      "feedback deletion cascade query failed",
    )[0];
    assert.deepEqual(
      [Number(cascade.projects), Number(cascade.reports), Number(cascade.feedback)],
      [0, 0, 0],
      "project deletion must cascade through immutable reports into feedback",
    );

    await wait(100);
    capturedLogs.push(server.logs());
    const applicationLogs = capturedLogs.join("\n")
      .split(/\r?\n/u)
      .filter((line) => line.includes('"type":"request_complete"'))
      .join("\n");
    assert.match(
      applicationLogs,
      /"route":"\/api\/projects\/:projectId\/revisions\/:revision\/reports\/:schemaVersion\/feedback"/u,
    );
    for (const secret of [
      project.id,
      owner.user.id,
      owner.user.email,
      owner.csrf,
      other.user.id,
      "PRIVATE_REPORT_FEEDBACK_PROJECT_DO_NOT_EXPOSE",
      "free text",
    ]) {
      assert.equal(applicationLogs.includes(secret), false, `Worker operational logs exposed ${secret}`);
    }
  } finally {
    if (server) capturedLogs.push(server.logs());
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});

test("0013 upgrades populated history, canonicalizes legacy input, rejects v1 feedback, and enforces the exact account cap", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-report-feedback-populated-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  try {
    const through11 = migrationSubset(stateDirectory, 11);
    requireD1Success(d1(stateDirectory, "migrate", through11), "migrations through 0011 failed");
    const userId = "feedback-populated-owner";
    const projectId = "feedback-populated-project";
    const reportId = "feedback-populated-report-v1";
    const sessionToken = "feedback-populated-session-token";
    const csrfToken = "feedback-populated-csrf-token";
    const inputHash = "a".repeat(64);
    const legacyInput = {
      width: 30,
      length: 50,
      city: "Pune",
      facing: "East",
      floors: "G+1",
      bedrooms: "3",
      bathrooms: 3,
      parking: "1 car",
      style: "Warm modern",
      quality: "Signature",
      roadWidthFt: 24,
      plotShape: "regular",
      accessibility: "none",
      futureUse: "none",
      budgetLakh: 55,
      legacyPrivateField: "PRESERVE_ONLY_IN_IMMUTABLE_REVISION_ONE",
    };
    const estimate = {
      plotSqft: 1500,
      builtUpSqft: 1830,
      lowInr: 3_703_920,
      highInr: 4_428_600,
      floors: "G+1",
      quality: "Signature",
      city: "Pune",
      disclaimer: "Indicative concept-stage estimate; not a contractor quote.",
    };
    const legacyReport = {
      id: reportId,
      projectId,
      version: 1,
      inputHash,
      generatedAt: "2026-08-14 00:00:00",
      title: "Persisted legacy report",
      summary: { verdict: "Persisted v1 verdict only" },
    };
    const seed = `
      INSERT INTO users (id,email,name,created_at)
      VALUES (${sqlLiteral(userId)},'feedback-populated@example.test','Populated owner','2026-08-14 00:00:00');
      INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at,csrf_hash,last_seen_at)
      VALUES (
        'feedback-populated-session',${sqlLiteral(userId)},
        ${sqlLiteral(createHash("sha256").update(sessionToken).digest("base64url"))},
        '2099-01-01 00:00:00','2026-08-14 00:00:00',
        ${sqlLiteral(createHash("sha256").update(csrfToken).digest("base64url"))},
        '2026-08-14 00:00:00'
      );
      INSERT INTO projects
        (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
      VALUES (
        ${sqlLiteral(projectId)},${sqlLiteral(userId)},'Populated legacy project','report_ready',
        ${sqlLiteral(JSON.stringify(legacyInput))},${sqlLiteral(JSON.stringify(estimate))},
        '2026-08-14 00:00:00','2026-08-14 00:00:00',1
      );
      INSERT INTO reports
        (id,project_id,user_id,version,input_hash,content_json,generated_at,updated_at)
      VALUES (
        ${sqlLiteral(reportId)},${sqlLiteral(projectId)},${sqlLiteral(userId)},1,${sqlLiteral(inputHash)},
        ${sqlLiteral(JSON.stringify(legacyReport))},'2026-08-14 00:00:00','2026-08-14 00:00:00'
      );
    `;
    requireD1Success(d1(stateDirectory, "execute", seed), "populated legacy seed failed");
    requireD1Success(d1(stateDirectory, "migrate"), "populated 0012/0013 upgrade failed");
    const coreAfterMigration = query(
      stateDirectory,
      `SELECT p.input_json,r.content_json
         FROM projects p JOIN reports r ON r.project_id=p.id
        WHERE p.id=${sqlLiteral(projectId)}`,
      "populated core preservation query failed",
    )[0];
    assert.equal(coreAfterMigration.input_json, JSON.stringify(legacyInput));
    assert.equal(coreAfterMigration.content_json, JSON.stringify(legacyReport));

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const auth = {
      cookie: `__Host-grihagrid_session=${sessionToken}; grihagrid_csrf=${csrfToken}`,
      csrf: csrfToken,
    };
    const legacyEnvelope = await call(server.origin, `/api/projects/${encodeURIComponent(projectId)}/revisions/1/report`, { auth });
    assert.equal(legacyEnvelope.response.status, 200, JSON.stringify(legacyEnvelope.payload));
    assert.equal(legacyEnvelope.payload.report.summary.verdict, "Persisted v1 verdict only");
    assert.equal(legacyEnvelope.payload.revision.report.schemaVersion, 1);
    const legacyFeedbackPath = feedbackPath(projectId, 1, 1);
    const legacyFeedbackGet = await call(server.origin, legacyFeedbackPath, { auth });
    assert.equal(legacyFeedbackGet.response.status, 404);
    assert.equal(legacyFeedbackGet.payload.code, "report_not_found");
    const legacyFeedbackPut = await call(server.origin, legacyFeedbackPath, {
      method: "PUT",
      auth,
      body: { outcome: "helpful", sections: ["overall"] },
    });
    assert.equal(legacyFeedbackPut.response.status, 404);
    assert.equal(legacyFeedbackPut.payload.code, "report_not_found");

    const canonicalized = await call(server.origin, `/api/projects/${encodeURIComponent(projectId)}/revisions`, {
      method: "POST",
      auth,
      headers: { "idempotency-key": "canonicalize-populated-legacy-input" },
      body: { expectedInputRevision: 1, input: { width: 31 }, acceptedImpact: true },
    });
    assert.equal(canonicalized.response.status, 201, JSON.stringify(canonicalized.payload));
    assert.equal(canonicalized.payload.revision.revision, 2);
    const revisionInputs = query(
      stateDirectory,
      `SELECT revision,input_json FROM project_revisions
        WHERE project_id=${sqlLiteral(projectId)} ORDER BY revision`,
      "canonicalized revision query failed",
    );
    assert.equal(revisionInputs.length, 2);
    assert.equal(JSON.parse(revisionInputs[0].input_json).legacyPrivateField, "PRESERVE_ONLY_IN_IMMUTABLE_REVISION_ONE");
    assert.equal(Object.hasOwn(JSON.parse(revisionInputs[1].input_json), "legacyPrivateField"), false);
    const currentInput = JSON.parse(query(
      stateDirectory,
      `SELECT input_json FROM projects WHERE id=${sqlLiteral(projectId)}`,
      "canonical current input query failed",
    )[0].input_json);
    assert.equal(Object.hasOwn(currentInput, "legacyPrivateField"), false);
    await stopWorker(server);
    server = null;

    const cappedUser = "feedback-project-cap-owner";
    const validInput = JSON.stringify(Object.fromEntries(Object.entries(legacyInput).filter(([key]) => key !== "legacyPrivateField")));
    const capSeed = `
      INSERT INTO users (id,email,name,created_at)
      VALUES (${sqlLiteral(cappedUser)},'feedback-cap@example.test','Project cap owner','2026-08-15 00:00:00');
      WITH RECURSIVE sequence(value) AS (
        SELECT 1 UNION ALL SELECT value+1 FROM sequence WHERE value<50
      )
      INSERT INTO projects
        (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
      SELECT printf('feedback-cap-project-%02d',value),${sqlLiteral(cappedUser)},
             printf('Cap project %02d',value),'feasibility_ready',
             ${sqlLiteral(validInput)},${sqlLiteral(JSON.stringify(estimate))},
             '2026-08-15 00:00:00','2026-08-15 00:00:00',1
        FROM sequence;
    `;
    requireD1Success(d1(stateDirectory, "execute", capSeed), "first 50 project inserts failed");
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM projects WHERE user_id=${sqlLiteral(cappedUser)}`)[0].count), 50);
    const fiftyFirst = d1(
      stateDirectory,
      "execute",
      `INSERT INTO projects
         (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
       VALUES (
         'feedback-cap-project-51',${sqlLiteral(cappedUser)},'Cap project 51','feasibility_ready',
         ${sqlLiteral(validInput)},${sqlLiteral(JSON.stringify(estimate))},
         '2026-08-15 00:00:00','2026-08-15 00:00:00',1
       );`,
    );
    assert.notEqual(fiftyFirst.status, 0, "the 51st project must fail at SQL time");
    assert.match(`${fiftyFirst.stdout}\n${fiftyFirst.stderr}`, /project account limit reached/iu);
    assert.equal(Number(query(stateDirectory, `SELECT COUNT(*) AS count FROM projects WHERE user_id=${sqlLiteral(cappedUser)}`)[0].count), 50);
    assert.equal(query(stateDirectory, "PRAGMA foreign_key_check;", "populated foreign key check failed").length, 0);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
