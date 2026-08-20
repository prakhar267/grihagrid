import assert from "node:assert/strict";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const reportShareAbuseHmacKey = "ab".repeat(32);
const localD1ApiPath = "/cdn-cgi/local/explorer/api/d1/database";
const localD1TimeoutMs = 10_000;
const localD1MaxRequestBytes = 1024 * 1024;
const localD1MaxResponseBytes = 2 * 1024 * 1024;

function reservePort() {
  return new Promise((resolve, reject) => {
    const listener = createServer();
    listener.once("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function stopWorker(server) {
  if (!server?.child) return;
  if (server.child.exitCode === null) {
    server.child.kill("SIGTERM");
    const stopped = await Promise.race([server.exited.then(() => true), wait(5_000).then(() => false)]);
    if (!stopped && server.child.exitCode === null) server.child.kill("SIGKILL");
  }
  server.child.stdout?.destroy();
  server.child.stderr?.destroy();
}

async function startWorker(
  stateDirectory,
  assetsDirectory,
  port,
  configuredReportShareKey = reportShareAbuseHmacKey,
) {
  const child = spawn(process.execPath, [wranglerCli,
    "dev", "worker/index.js", "--config", "wrangler.toml", "--local",
    "--persist-to", stateDirectory, "--assets", assetsDirectory,
    "--ip", "127.0.0.1", "--port", String(port), "--test-scheduled",
    "--log-level", "log", "--show-interactive-dev-session=false",
    "--var", "APP_ENV:test", "--var", "APP_ORIGIN:https://app.example.test",
    ...(configuredReportShareKey === null
      ? []
      : ["--var", `REPORT_SHARE_ABUSE_HMAC_KEY:${configuredReportShareKey}`]),
    "--var", "PAID_CHECKOUT_ENABLED:false",
    "--var", "DECISION_COMPARE_FULFILLMENT_ENABLED:false",
    "--var", "ENABLED_PAYMENT_PLANS:", "--var", "GEMINI_API_KEY:",
  ], {
    cwd: root,
    env: { ...process.env, CI: "true", WRANGLER_LOG_SANITIZE: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-50_000); });
  child.stderr.on("data", (chunk) => { logs = `${logs}${chunk}`.slice(-50_000); });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const early = await Promise.race([exited, wait(100).then(() => null)]);
    if (early) throw new Error(`wrangler exited early (${JSON.stringify(early)}):\n${logs}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.arrayBuffer();
        const server = { child, exited, origin, logs: () => logs };
        try {
          server.databaseId = await discoverLocalD1Database(server);
          return server;
        } catch (error) {
          await stopWorker(server);
          const discoveryError = new Error(`wrangler local D1 discovery failed:\n${error?.message || error}\n${logs}`);
          discoveryError.code = "LOCAL_D1_DISCOVERY_FAILED";
          throw discoveryError;
        }
      }
      await response.arrayBuffer();
    } catch (error) {
      if (error?.code === "LOCAL_D1_DISCOVERY_FAILED") throw error;
      // workerd is still starting.
    }
  }
  await stopWorker({ child, exited });
  throw new Error(`wrangler did not become ready:\n${logs}`);
}

function d1(stateDirectory, action, sql = null) {
  const args = ["d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", sql);
    if (action === "query") args.push("--json");
  }
  return spawnSync(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function requireD1(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function query(stateDirectory, sql) {
  return JSON.parse(requireD1(d1(stateDirectory, "query", sql), "D1 query failed").stdout)
    .flatMap((entry) => entry.results || []);
}

function isPlainRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

async function boundedJson(response, context) {
  const contentType = response.headers.get("content-type") || "";
  assert.match(contentType, /^application\/json\b/iu, `${context}: expected JSON, received ${contentType || "no content type"}`);
  const lengthHeader = response.headers.get("content-length");
  if (lengthHeader !== null) {
    const declaredLength = Number(lengthHeader);
    assert.ok(Number.isSafeInteger(declaredLength) && declaredLength >= 0, `${context}: invalid content length`);
    assert.ok(declaredLength <= localD1MaxResponseBytes, `${context}: response exceeded byte limit`);
  }
  assert.ok(response.body, `${context}: response body missing`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > localD1MaxResponseBytes) {
      await reader.cancel();
      assert.fail(`${context}: response exceeded byte limit`);
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  assert.ok(text, `${context}: empty JSON response`);
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (error) {
    assert.fail(`${context}: invalid JSON (${error?.message || error})`);
  }
  return { payload, text };
}

function validateLocalD1Envelope(payload, context) {
  assert.ok(isPlainRecord(payload), `${context}: invalid response envelope`);
  assert.equal(typeof payload.success, "boolean", `${context}: missing success flag`);
  assert.ok(Array.isArray(payload.errors), `${context}: errors must be an array`);
  assert.ok(Array.isArray(payload.messages), `${context}: messages must be an array`);
}

async function discoverLocalD1Database(server) {
  const response = await fetch(`${server.origin}${localD1ApiPath}`, {
    headers: {
      accept: "application/json",
      "x-miniflare-explorer-no-aggregate": "true",
    },
    signal: AbortSignal.timeout(localD1TimeoutMs),
  });
  const { payload } = await boundedJson(response, "local D1 discovery");
  validateLocalD1Envelope(payload, "local D1 discovery");
  assert.equal(response.status, 200, `local D1 discovery failed with HTTP ${response.status}`);
  assert.equal(payload.success, true, `local D1 discovery failed: ${JSON.stringify(payload.errors)}`);
  assert.deepEqual(payload.errors, []);
  assert.ok(Array.isArray(payload.result), "local D1 discovery result must be an array");
  assert.ok(isPlainRecord(payload.result_info), "local D1 discovery result info missing");
  assert.equal(payload.result_info.count, payload.result.length, "local D1 discovery count mismatch");
  const matches = payload.result.filter((entry) => isPlainRecord(entry) && entry.name === "DB");
  assert.equal(matches.length, 1, `expected one local DB binding, received ${JSON.stringify(payload.result)}`);
  assert.match(matches[0].uuid, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/u, "local DB binding returned an invalid UUID");
  return matches[0].uuid;
}

function validateLocalD1Result(result, context) {
  assert.ok(isPlainRecord(result), `${context}: invalid result entry`);
  assert.equal(result.success, true, `${context}: result entry was unsuccessful`);
  assert.ok(isPlainRecord(result.meta), `${context}: result metadata missing`);
  assert.ok(isPlainRecord(result.results), `${context}: result rows missing`);
  const { columns, rows } = result.results;
  assert.ok(Array.isArray(columns), `${context}: result columns must be an array`);
  assert.ok(columns.every((column) => typeof column === "string"), `${context}: invalid result column`);
  assert.equal(new Set(columns).size, columns.length, `${context}: duplicate result column`);
  assert.ok(Array.isArray(rows), `${context}: result rows must be an array`);
  assert.ok(rows.every((row) => Array.isArray(row) && row.length === columns.length), `${context}: invalid result row`);
}

async function liveD1(server, sql) {
  assert.ok(server?.databaseId, "live D1 requires a discovered database binding");
  assert.equal(typeof sql, "string");
  assert.ok(sql.trim(), "live D1 SQL must not be empty");
  assert.ok(Buffer.byteLength(sql, "utf8") <= localD1MaxRequestBytes, "live D1 SQL exceeded byte limit");
  let response;
  try {
    response = await fetch(
      `${server.origin}${localD1ApiPath}/${encodeURIComponent(server.databaseId)}/raw`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-miniflare-explorer-no-aggregate": "true",
        },
        body: JSON.stringify({ sql }),
        signal: AbortSignal.timeout(localD1TimeoutMs),
      },
    );
  } catch (error) {
    throw new Error(`live D1 request failed: ${error?.message || error}\n${server.logs()}`);
  }
  const { payload, text } = await boundedJson(response, "live D1 execution");
  validateLocalD1Envelope(payload, "live D1 execution");
  if (payload.success === false) {
    assert.equal(response.ok, false, "live D1 failure returned a successful HTTP status");
    assert.ok(payload.errors.length > 0, "live D1 failure omitted errors");
    assert.equal(payload.result, null, "live D1 failure returned a result");
    const errorText = payload.errors.map((error) => {
      assert.ok(isPlainRecord(error), "live D1 returned an invalid error");
      assert.ok(typeof error.message === "string" && error.message, "live D1 error omitted its message");
      return error.message;
    }).join("\n");
    return { status: response.ok ? 1 : response.status, stdout: text, stderr: errorText, result: null };
  }
  assert.equal(response.status, 200, `live D1 succeeded with HTTP ${response.status}`);
  assert.deepEqual(payload.errors, []);
  assert.ok(Array.isArray(payload.result) && payload.result.length > 0, "live D1 success omitted results");
  for (const result of payload.result) validateLocalD1Result(result, "live D1 execution");
  return { status: 0, stdout: text, stderr: "", result: payload.result };
}

async function liveQuery(server, sql) {
  const execution = requireD1(await liveD1(server, sql), "live D1 query failed");
  const { columns, rows } = execution.result.at(-1).results;
  return rows.map((row) => Object.fromEntries(columns.map((column, index) => [column, row[index]])));
}

async function ownerHandoffWriteState(server, userId) {
  const row = (await liveQuery(server, `
    SELECT
      (SELECT COALESCE(SUM(request_count),0)
         FROM report_share_create_counters WHERE user_id='${userId}') AS quota_count,
      (SELECT COUNT(*) FROM report_shares WHERE user_id='${userId}') AS share_count,
      (SELECT COALESCE(SUM(event_count),0)
         FROM product_event_aggregates
        WHERE event_name IN (
          'report_handoff_link_created','report_handoff_opened','report_handoff_link_revoked'
        )) AS event_count;
  `))[0];
  return {
    quotaCount: Number(row.quota_count),
    shareCount: Number(row.share_count),
    eventCount: Number(row.event_count),
  };
}

async function handoffEventCounts(server) {
  const counts = {
    report_handoff_link_created: 0,
    report_handoff_opened: 0,
    report_handoff_link_revoked: 0,
  };
  for (const row of await liveQuery(server, `
    SELECT event_name,COALESCE(SUM(event_count),0) AS event_count
      FROM product_event_aggregates
     WHERE event_name IN (
       'report_handoff_link_created','report_handoff_opened','report_handoff_link_revoked'
     )
     GROUP BY event_name;
  `)) {
    counts[row.event_name] = Number(row.event_count);
  }
  return counts;
}

function extractCookies(response, csrf) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(values.join(";"))?.[1];
  assert.ok(session);
  return `__Host-grihagrid_session=${session}; grihagrid_csrf=${csrf}`;
}

async function call(origin, pathname, {
  method = "GET", body, auth, headers = {}, originHeader = origin,
} = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!['GET', 'HEAD'].includes(method)) requestHeaders.set("origin", originHeader);
  const response = await fetch(`${origin}${pathname}`, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
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
      name: `Handoff ${suffix}`,
      email: `handoff-${suffix}@example.test`,
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

async function createReport(origin, auth, suffix, projectName = `PRIVATE_PROJECT_${suffix}_owner@example.test`) {
  const created = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    headers: { "idempotency-key": `handoff-project-${suffix}` },
    body: {
      name: projectName,
      input: {
        width: 30,
        length: 50,
        city: "Pune",
        facing: "East",
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        style: "PRIVATE_STYLE_DO_NOT_SHARE",
        quality: "Signature",
        roadWidthFt: 24,
        plotShape: "regular",
        accessibility: "none",
        futureUse: "none",
        budgetLakh: 50,
      },
    },
  });
  assert.equal(created.response.status, 201, JSON.stringify(created.payload));
  const generated = await call(origin, `/api/projects/${created.payload.project.id}/report`, {
    method: "POST", auth, body: {},
  });
  assert.ok([200, 201].includes(generated.response.status), JSON.stringify(generated.payload));
  return {
    project: created.payload.project,
    revision: generated.payload.revision.revision,
    schemaVersion: generated.payload.revision.report.schemaVersion,
    report: generated.payload.report,
  };
}

const allSections = ["overview", "programme", "cost", "timeline", "risks", "next_actions"];

async function createShare(origin, auth, source, key, overrides = {}, originHeader = origin) {
  return call(origin, `/api/projects/${source.project.id}/report-shares`, {
    method: "POST",
    auth,
    originHeader,
    headers: { "idempotency-key": key },
    body: {
      projectRevision: source.revision,
      reportSchemaVersion: source.schemaVersion,
      expiresInDays: 7,
      sections: allSections,
      ...overrides,
    },
  });
}

function tokenFromShare(share) {
  assert.match(share.url, /^https:\/\/app\.example\.test\/share\/report#[A-Za-z0-9_-]{43}$/u);
  return new URL(share.url).hash.slice(1);
}

function openShare(origin, token, { headers = {} } = {}) {
  return call(origin, "/api/shared/report", {
    method: "POST",
    headers,
    body: { token },
  });
}

function assertPublicRedaction(payload) {
  const forbiddenKeys = new Set([
    "id", "projectid", "userid", "email", "input", "inputhash", "token",
    "tokenhash", "contenthash", "city", "facing", "width", "length", "aibrief",
    "files", "feedback", "orders", "source_report_id", "report_content_hash",
  ]);
  const visit = (value) => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key.toLowerCase()), false, `forbidden public key ${key}`);
      visit(child);
    }
  };
  visit(payload);
  const serialized = JSON.stringify(payload);
  for (const value of ["PRIVATE_PROJECT", "owner@example.test", "PRIVATE_STYLE", "Pune", "East"]) {
    assert.equal(serialized.includes(value), false, value);
  }
}

test("Professional Handoff links preserve one redacted immutable report across owner, race, archive, and cleanup boundaries", { timeout: 240_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-report-handoff-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  const capturedLogs = [];
  try {
    requireD1(d1(stateDirectory, "migrate"), "fresh migrations failed");
    assert.deepEqual(
      query(stateDirectory, "SELECT control_key,enabled FROM report_handoff_controls;"),
      [{ control_key: "report_handoff", enabled: 0 }],
      "a fresh migration must keep Professional Handoff closed until release validation enables it",
    );
    assert.deepEqual(
      query(
        stateDirectory,
        `SELECT name FROM sqlite_master
          WHERE type='trigger' AND name IN (
            'report_handoff_enabled_insert_guard','report_share_sections_insert_guard',
            'archived_report_share_insert_guard','report_share_active_limit_insert',
            'report_share_identity_immutable'
          ) ORDER BY name`,
      ).map((row) => row.name),
      [
        "archived_report_share_insert_guard",
        "report_handoff_enabled_insert_guard",
        "report_share_active_limit_insert",
        "report_share_identity_immutable",
        "report_share_sections_insert_guard",
      ],
    );
    const cleanupPlan = query(stateDirectory, `
      EXPLAIN QUERY PLAN
      DELETE FROM report_shares
       WHERE expires_at<datetime('now','-90 days')
          OR (revoked_at IS NOT NULL AND revoked_at<datetime('now','-90 days'));
    `);
    const cleanupPlanText = cleanupPlan.map((row) => row.detail || JSON.stringify(row)).join("\n");
    assert.match(cleanupPlanText, /idx_report_shares_expiry/u);
    assert.match(cleanupPlanText, /idx_report_shares_revoked/u);
    assert.doesNotMatch(cleanupPlanText, /SCAN report_shares(?:\s|$)/u);
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const defaultReadiness = await call(server.origin, "/api/readiness");
    assert.equal(defaultReadiness.response.status, 200, JSON.stringify(defaultReadiness.payload));
    assert.equal(defaultReadiness.payload.checks.reportShareSchema, "current");
    assert.equal(defaultReadiness.payload.checks.reportHandoffControl, "disabled");
    assert.equal(defaultReadiness.payload.capabilities.reportHandoff, false);
    requireD1(await liveD1(server, `
      UPDATE report_handoff_controls
         SET enabled=1,updated_at=datetime('now')
       WHERE control_key='report_handoff';
    `), "initial report handoff enable failed");
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.checks.reportHandoffControl, "enabled");
    assert.equal(readiness.payload.capabilities.reportHandoff, true);

    const wrongPublicMethod=await call(server.origin,"/api/shared/report");
    assert.equal(wrongPublicMethod.response.status,405);
    assert.equal(wrongPublicMethod.response.headers.get("allow"),"POST");
    const malformedBearer="z".repeat(43);
    for(const body of [{},{token:malformedBearer,extra:true},{token:"short"}]){
      const invalidPublic=await call(server.origin,"/api/shared/report",{method:"POST",body});
      assert.equal(invalidPublic.response.status,404);
      assert.deepEqual(invalidPublic.payload,{error:"shared report not found",code:"report_share_not_found"});
      assert.equal(JSON.stringify(invalidPublic.payload).includes(malformedBearer),false);
    }
    const untrustedJson = await call(server.origin, "/api/shared/report", {
      method: "POST",
      originHeader: "https://evil.example.test",
      body: { token: malformedBearer },
    });
    assert.equal(untrustedJson.response.status, 403);
    assert.equal(untrustedJson.payload.code, "origin_rejected");
    const crossSiteText = await fetch(`${server.origin}/api/shared/report`, {
      method: "POST",
      headers: { origin: "https://evil.example.test", "content-type": "text/plain" },
      body: JSON.stringify({ token: malformedBearer }),
    });
    assert.equal(crossSiteText.status, 403);
    await crossSiteText.arrayBuffer();
    const sameSiteText = await fetch(`${server.origin}/api/shared/report`, {
      method: "POST",
      headers: { origin: server.origin, "content-type": "text/plain; charset=utf-8" },
      body: JSON.stringify({ token: malformedBearer }),
    });
    assert.equal(sameSiteText.status, 404);
    assert.deepEqual(await sameSiteText.json(), {
      error: "shared report not found",
      code: "report_share_not_found",
    });

    // Wrong-media rejection deliberately cancels the unread body. Miniflare
    // may retire its internal HTTP/1 socket, so resume on the same D1 state.
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const parameterizedJson = await fetch(`${server.origin}/api/shared/report`, {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        "content-type": "Application/JSON; charset=utf-8",
      },
      body: JSON.stringify({ token: malformedBearer }),
    });
    assert.equal(
      parameterizedJson.status,
      404,
      `unexpected parameterized JSON response: ${await parameterizedJson.clone().text()}\n${server.logs()}`,
    );
    assert.deepEqual(await parameterizedJson.json(), {
      error: "shared report not found",
      code: "report_share_not_found",
    });

    const owner = await register(server.origin, "owner");
    const other = await register(server.origin, "other");
    const source = await createReport(server.origin, owner, "MAIN");

    const stateBeforeInvalidSecrets = await ownerHandoffWriteState(server, owner.user.id);
    assert.deepEqual(stateBeforeInvalidSecrets, {
      quotaCount: 0,
      shareCount: 0,
      eventCount: 0,
    });
    for (const [label, configuredKey] of [
      ["missing", null],
      ["malformed", "not-a-hex-key"],
    ]) {
      await stopWorker(server);
      server = await startWorker(stateDirectory, assetsDirectory, port, configuredKey);
      const rejectedCreate = await createShare(
        server.origin,
        owner,
        source,
        `${label}-secret-must-not-mutate`,
        { sections: ["overview"] },
      );
      assert.equal(rejectedCreate.response.status, 503, JSON.stringify(rejectedCreate.payload));
      assert.deepEqual(rejectedCreate.payload, {
        error: "abuse controls are temporarily unavailable",
        code: "abuse_control_unavailable",
      });
      assert.deepEqual(
        await ownerHandoffWriteState(server, owner.user.id),
        stateBeforeInvalidSecrets,
        `${label} handoff key mutated quota, share, or aggregate state`,
      );
    }
    await stopWorker(server);
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const foreignList = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: other });
    assert.equal(foreignList.response.status, 404);
    const foreignCreate = await createShare(server.origin, other, source, "foreign-report-share");
    assert.equal(foreignCreate.response.status, 404);

    const missingCsrf = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, {
      method: "POST",
      headers: {
        cookie: owner.cookie,
        "idempotency-key": "missing-csrf-share",
      },
      body: { projectRevision: source.revision, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"] },
    });
    assert.equal(missingCsrf.response.status, 403);
    const badOrigin = await createShare(server.origin, owner, source, "bad-origin-share", {}, "https://evil.example");
    assert.equal(badOrigin.response.status, 403);
    assert.equal(badOrigin.payload.code, "origin_rejected");

    const sameKeyCreates = await Promise.all([
      createShare(server.origin, owner, source, "main-report-share"),
      createShare(server.origin, owner, source, "main-report-share"),
    ]);
    assert.deepEqual(sameKeyCreates.map(result=>result.response.status).sort(), [200, 201]);
    const created = sameKeyCreates.find(result=>result.response.status===201);
    const replayedCreate = sameKeyCreates.find(result=>result.response.status===200);
    assert.ok(created&&replayedCreate);
    assert.equal(Object.hasOwn(created.payload.share,"url"),true);
    assert.equal(Object.hasOwn(replayedCreate.payload.share,"url"),false);
    assert.equal(created.payload.share.id,replayedCreate.payload.share.id);
    const mainShare = created.payload.share;
    const mainToken = tokenFromShare(mainShare);
    assert.deepEqual(mainShare.sections, allSections);
    assert.equal(Object.hasOwn(mainShare, "token"), false);
    const storedShare = (await liveQuery(server, `SELECT token_hash,idempotency_key_hash,request_hash,report_content_hash FROM report_shares WHERE id='${mainShare.id}';`))[0];
    for (const value of [storedShare.token_hash, storedShare.request_hash, storedShare.report_content_hash]) {
      assert.match(value, /^[a-f0-9]{64}$/u);
    }
    assert.match(storedShare.idempotency_key_hash, /^[A-Za-z0-9_-]{43}$/u);
    assert.equal(JSON.stringify(storedShare).includes(mainToken), false);
    assert.equal(JSON.stringify(storedShare).includes("main-report-share"), false);

    const replay = await createShare(server.origin, owner, source, "main-report-share");
    assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.share.id, mainShare.id);
    assert.equal(Object.hasOwn(replay.payload.share, "url"), false);
    const conflict = await createShare(server.origin, owner, source, "main-report-share", { sections: ["overview"] });
    assert.equal(conflict.response.status, 409);
    assert.equal(conflict.payload.code, "idempotency_conflict");

    const listed = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.payload.shares.length, 1);
    assert.equal(Object.hasOwn(listed.payload.shares[0], "url"), false);
    assert.equal(JSON.stringify(listed.payload).includes(mainToken), false);

    const opened = await openShare(server.origin, mainToken);
    assert.equal(opened.response.status, 200, JSON.stringify(opened.payload));
    assert.equal(opened.response.headers.get("cache-control"), "no-store");
    assert.equal(opened.response.headers.get("referrer-policy"), "no-referrer");
    assert.deepEqual(Object.keys(opened.payload.share).sort(), ["expiresAt", "sections"]);
    assert.equal(opened.payload.share.expiresAt, mainShare.expiresAt);
    assert.deepEqual(Object.keys(opened.payload.share.sections), [
      "overview", "programme", "cost", "timeline", "risks", "nextActions",
    ]);
    assertPublicRedaction(opened.payload);
    const afterOpen = await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(afterOpen.payload.shares[0].accessCount, 1);
    assert.ok(afterOpen.payload.shares[0].lastAccessedAt);

    const canaryOwner = await register(server.origin, "aggregate-canary");
    const canaryMarker = `Release canary ${randomUUID()}`;
    const canarySource = await createReport(
      server.origin,
      canaryOwner,
      "AGGREGATE_CANARY",
      canaryMarker,
    );
    const eventsBeforeCanary = await handoffEventCounts(server);
    const canaryCreated = await createShare(
      server.origin,
      canaryOwner,
      canarySource,
      "aggregate-canary-share",
      { sections: ["overview"] },
    );
    assert.equal(canaryCreated.response.status, 201, JSON.stringify(canaryCreated.payload));
    assert.equal(JSON.stringify(canaryCreated.payload).includes(canaryMarker), false);
    const canaryToken = tokenFromShare(canaryCreated.payload.share);
    const canaryOpened = await openShare(server.origin, canaryToken);
    assert.equal(canaryOpened.response.status, 200, JSON.stringify(canaryOpened.payload));
    assert.equal(JSON.stringify(canaryOpened.payload).includes(canaryMarker), false);
    const canaryListed = await call(
      server.origin,
      `/api/projects/${canarySource.project.id}/report-shares`,
      { auth: canaryOwner },
    );
    assert.equal(canaryListed.response.status, 200, JSON.stringify(canaryListed.payload));
    assert.equal(JSON.stringify(canaryListed.payload).includes(canaryMarker), false);
    const canaryRevoked = await call(
      server.origin,
      `/api/projects/${canarySource.project.id}/report-shares/${canaryCreated.payload.share.id}`,
      { method: "DELETE", auth: canaryOwner },
    );
    assert.equal(canaryRevoked.response.status, 204, JSON.stringify(canaryRevoked.payload));
    assert.deepEqual(
      await handoffEventCounts(server),
      eventsBeforeCanary,
      "the release canary lifecycle must not inflate customer handoff aggregates",
    );

    const metricsOwner = await register(server.origin, "aggregate-customer");
    const metricsSource = await createReport(
      server.origin,
      metricsOwner,
      "AGGREGATE_CUSTOMER",
      "Customer aggregate project",
    );
    const eventsBeforeCustomer = await handoffEventCounts(server);
    const customerCreated = await createShare(
      server.origin,
      metricsOwner,
      metricsSource,
      "aggregate-customer-share",
      { sections: ["overview"] },
    );
    assert.equal(customerCreated.response.status, 201, JSON.stringify(customerCreated.payload));
    const customerOpened = await openShare(server.origin, tokenFromShare(customerCreated.payload.share));
    assert.equal(customerOpened.response.status, 200, JSON.stringify(customerOpened.payload));
    const customerRevoked = await call(
      server.origin,
      `/api/projects/${metricsSource.project.id}/report-shares/${customerCreated.payload.share.id}`,
      { method: "DELETE", auth: metricsOwner },
    );
    assert.equal(customerRevoked.response.status, 204, JSON.stringify(customerRevoked.payload));
    assert.deepEqual(await handoffEventCounts(server), {
      report_handoff_link_created: eventsBeforeCustomer.report_handoff_link_created + 1,
      report_handoff_opened: eventsBeforeCustomer.report_handoff_opened + 1,
      report_handoff_link_revoked: eventsBeforeCustomer.report_handoff_link_revoked + 1,
    });

    // Force the switch closed after the Worker's early create check but before
    // its report_shares insert. The production BEFORE INSERT guard is the
    // authoritative linearization point and must map to the stable public 503.
    const createRaceOwner = await register(server.origin, "create-disable-race");
    const createRaceSource = await createReport(server.origin, createRaceOwner, "CREATE_DISABLE_RACE");
    requireD1(await liveD1(server, `
      CREATE TRIGGER test_disable_handoff_after_create_admission
      AFTER INSERT ON report_share_create_counters
      WHEN NEW.user_id='${createRaceOwner.user.id}'
      BEGIN
        UPDATE report_handoff_controls
           SET enabled=0,updated_at=datetime('now')
         WHERE control_key='report_handoff';
      END;
    `), "create-race trigger install failed");
    const createAcrossDisable = await createShare(
      server.origin,
      createRaceOwner,
      createRaceSource,
      "create-cross-disable-linearization",
      { sections: ["overview"] },
    );
    assert.equal(createAcrossDisable.response.status, 503, JSON.stringify(createAcrossDisable.payload));
    assert.deepEqual(createAcrossDisable.payload, {
      error: "professional handoff is temporarily unavailable",
      code: "report_handoff_disabled",
    });
    assert.equal(Number((await liveQuery(
      server,
      `SELECT COUNT(*) AS count FROM report_shares WHERE user_id='${createRaceOwner.user.id}';`,
    ))[0].count), 0);
    assert.deepEqual(await liveQuery(
      server,
      "SELECT enabled FROM report_handoff_controls WHERE control_key='report_handoff';",
    ), [{ enabled: 0 }]);
    requireD1(await liveD1(server, `
      DROP TRIGGER test_disable_handoff_after_create_admission;
      UPDATE report_handoff_controls
         SET enabled=1,updated_at=datetime('now')
       WHERE control_key='report_handoff';
    `), "create-race trigger cleanup failed");

    // Force the switch closed after the Worker's early redemption check by
    // flipping it from the strongly-consistent read-admission insert. The final
    // conditional access update must not increment or return report content.
    requireD1(await liveD1(server, `
      CREATE TRIGGER test_disable_handoff_after_read_admission
      AFTER INSERT ON report_share_read_counters
      BEGIN
        UPDATE report_handoff_controls
           SET enabled=0,updated_at=datetime('now')
         WHERE control_key='report_handoff';
      END;
    `), "redemption-race trigger install failed");
    const accessCountBeforeDisableRace = Number((await liveQuery(
      server,
      `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`,
    ))[0].access_count);
    const openEventsBeforeDisableRace = Number((await liveQuery(
      server,
      `SELECT COALESCE(SUM(event_count),0) AS count
         FROM product_event_aggregates
        WHERE event_name='report_handoff_opened';`,
    ))[0].count);
    const redemptionAcrossDisable = await openShare(server.origin, mainToken, {
      headers: { "cf-connecting-ip": "203.0.113.208" },
    });
    assert.equal(redemptionAcrossDisable.response.status, 503, JSON.stringify(redemptionAcrossDisable.payload));
    assert.deepEqual(redemptionAcrossDisable.payload, {
      error: "professional handoff is temporarily unavailable",
      code: "report_handoff_disabled",
    });
    assert.equal(Object.hasOwn(redemptionAcrossDisable.payload, "share"), false);
    assert.equal(Number((await liveQuery(
      server,
      `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`,
    ))[0].access_count), accessCountBeforeDisableRace);
    assert.equal(Number((await liveQuery(
      server,
      `SELECT COALESCE(SUM(event_count),0) AS count
         FROM product_event_aggregates
        WHERE event_name='report_handoff_opened';`,
    ))[0].count), openEventsBeforeDisableRace);
    requireD1(await liveD1(server, `
      DROP TRIGGER test_disable_handoff_after_read_admission;
      UPDATE report_handoff_controls
         SET enabled=1,updated_at=datetime('now')
       WHERE control_key='report_handoff';
    `), "redemption-race trigger cleanup failed");

    const controlShareResult = await createShare(
      server.origin,
      owner,
      source,
      "kill-switch-revocable-share",
      { sections: ["overview"] },
    );
    assert.equal(controlShareResult.response.status, 201, JSON.stringify(controlShareResult.payload));
    const controlShare = controlShareResult.payload.share;
    const controlToken = tokenFromShare(controlShare);
    const ownerCreateQuotaBeforeDisable = Number((await liveQuery(
      server,
      `SELECT COALESCE(SUM(request_count),0) AS count FROM report_share_create_counters WHERE user_id='${owner.user.id}';`,
    ))[0].count);
    requireD1(await liveD1(server, `
      UPDATE report_handoff_controls
         SET enabled=0,updated_at=datetime('now')
       WHERE control_key='report_handoff';
    `), "report handoff kill switch disable failed");
    const disabledReadiness = await call(server.origin, "/api/readiness");
    assert.equal(disabledReadiness.payload.checks.reportHandoffControl, "disabled");
    assert.equal(disabledReadiness.payload.capabilities.reportHandoff, false);
    const listWhileDisabled = await call(
      server.origin,
      `/api/projects/${source.project.id}/report-shares`,
      { auth: owner },
    );
    assert.equal(listWhileDisabled.response.status, 200, JSON.stringify(listWhileDisabled.payload));
    assert.ok(listWhileDisabled.payload.shares.some((share) => share.id === controlShare.id));
    const createWhileDisabled = await createShare(
      server.origin,
      owner,
      source,
      "kill-switch-blocked-create",
      { sections: ["overview"] },
    );
    assert.equal(createWhileDisabled.response.status, 503);
    assert.equal(createWhileDisabled.payload.code, "report_handoff_disabled");
    const openWhileDisabled = await openShare(server.origin, controlToken);
    assert.equal(openWhileDisabled.response.status, 503);
    assert.equal(openWhileDisabled.payload.code, "report_handoff_disabled");
    const revokeWhileDisabled = await call(
      server.origin,
      `/api/projects/${source.project.id}/report-shares/${controlShare.id}`,
      { method: "DELETE", auth: owner },
    );
    assert.equal(revokeWhileDisabled.response.status, 204);
    assert.equal(Number((await liveQuery(
      server,
      `SELECT COALESCE(SUM(request_count),0) AS count FROM report_share_create_counters WHERE user_id='${owner.user.id}';`,
    ))[0].count), ownerCreateQuotaBeforeDisable);
    requireD1(await liveD1(server, `
      UPDATE report_handoff_controls
         SET enabled=1,updated_at=datetime('now')
       WHERE control_key='report_handoff';
    `), "report handoff kill switch re-enable failed");
    const restoredReadiness = await call(server.origin, "/api/readiness");
    assert.equal(restoredReadiness.response.status, 200, JSON.stringify(restoredReadiness.payload));
    assert.equal(restoredReadiness.payload.checks.reportHandoffControl, "enabled");
    assert.equal(restoredReadiness.payload.capabilities.reportHandoff, true);
    assert.equal((await openShare(server.origin, controlToken)).response.status, 410);

    const admissionIp="198.51.100.77";
    const accessCountBeforeAdmissionRace=Number((await liveQuery(server, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`))[0].access_count);
    const admissionRace=await Promise.all(Array.from({length:121},()=>openShare(server.origin,mainToken,{
      headers:{"cf-connecting-ip":admissionIp},
    })));
    const admissionStatuses=admissionRace.map(result=>result.response.status);
    assert.equal(admissionStatuses.filter(status=>status===200).length,120);
    assert.equal(admissionStatuses.filter(status=>status===429).length,1);
    const counterRows=await liveQuery(server,"SELECT subject_hash,window_start,request_count,limit_count FROM report_share_read_counters;");
    const admissionCounter=counterRows.find((row) => row.subject_hash === createHmac(
      "sha256",
      reportShareAbuseHmacKey,
    ).update(`report-share-read:${row.window_start}:${admissionIp}`).digest("hex"));
    assert.ok(admissionCounter);
    assert.equal(Number(admissionCounter.request_count),120);
    assert.equal(Number(admissionCounter.limit_count),120);
    assert.notEqual(
      admissionCounter.subject_hash,
      createHash("sha256").update(`report-share-read:${admissionIp}`).digest("hex"),
    );
    assert.equal(JSON.stringify(counterRows).includes(admissionIp),false);
    assert.equal(JSON.stringify(counterRows).includes(mainToken),false);
    const accessCountAfterAdmissionRace=Number((await liveQuery(server, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`))[0].access_count);
    assert.equal(accessCountAfterAdmissionRace-accessCountBeforeAdmissionRace,120);

    const revised = await call(server.origin, `/api/projects/${source.project.id}/revisions`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "handoff-revision-two" },
      body: { expectedInputRevision: source.revision, input: { budgetLakh: 55 }, acceptedImpact: true },
    });
    assert.equal(revised.response.status, 201, JSON.stringify(revised.payload));
    const oldStillOpen = await openShare(server.origin, mainToken);
    assert.equal(oldStillOpen.response.status, 200, JSON.stringify(oldStillOpen.payload));
    assert.deepEqual(oldStillOpen.payload.share.sections, opened.payload.share.sections);

    const historical = await createShare(server.origin, owner, source, "historical-report-share", { sections: ["overview", "risks"] });
    assert.equal(historical.response.status, 201, JSON.stringify(historical.payload));
    const historicalToken = tokenFromShare(historical.payload.share);

    const archived = await call(server.origin, `/api/projects/${source.project.id}`, {
      method: "PATCH", auth: owner, body: { status: "archived" },
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
    assert.equal((await openShare(server.origin, mainToken)).response.status, 200);
    const blockedArchived = await createShare(server.origin, owner, source, "archived-report-share", { sections: ["overview"] });
    assert.equal(blockedArchived.response.status, 409);
    assert.equal(blockedArchived.payload.code, "project_archived");
    const restored = await call(server.origin, `/api/projects/${source.project.id}`, {
      method: "PATCH", auth: owner, body: { status: "feasibility_ready" },
    });
    assert.equal(restored.response.status, 200);

    for (let index = 3; index <= 4; index += 1) {
      const extra = await createShare(server.origin, owner, source, `report-share-${index}`, { sections: ["overview"] });
      assert.equal(extra.response.status, 201, JSON.stringify(extra.payload));
    }
    assert.equal(Number((await liveQuery(server, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now');`))[0].count), 4);
    const capRace = await Promise.all([
      createShare(server.origin, owner, source, "report-share-five-a", { sections: ["overview"] }),
      createShare(server.origin, owner, source, "report-share-five-b", { sections: ["overview"] }),
    ]);
    assert.deepEqual(capRace.map(result=>result.response.status).sort(), [201, 409]);
    assert.equal(capRace.find(result=>result.response.status===409)?.payload.code, "report_share_limit");
    assert.equal(Number((await liveQuery(server, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now');`))[0].count), 5);

    requireD1(await liveD1(server, `
      WITH RECURSIVE history(index_value) AS (
        SELECT 1
        UNION ALL
        SELECT index_value+1 FROM history WHERE index_value<50
      )
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,
        revoked_at,access_count,last_accessed_at,created_at
      )
      SELECT
        'closed-history-' || printf('%03d',index_value),
        '${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${storedShare.report_content_hash}',printf('%064x',1000+index_value),
        printf('%043d',1000+index_value),printf('%064x',2000+index_value),
        datetime(datetime('now','+' || index_value || ' minutes'),'+1 day'),
        datetime('now','+' || index_value || ' minutes'),0,NULL,
        datetime('now','+' || index_value || ' minutes')
      FROM history;
    `), "closed history fixture insert failed");
    const activeIds=(await liveQuery(server, `SELECT id FROM report_shares WHERE project_id='${source.project.id}' AND revoked_at IS NULL AND expires_at>datetime('now') ORDER BY id;`)).map(row=>row.id);
    assert.equal(activeIds.length,5);
    const boundedHistory=await call(server.origin, `/api/projects/${source.project.id}/report-shares`, { auth: owner });
    assert.equal(boundedHistory.response.status,200);
    assert.equal(boundedHistory.payload.shares.length,50);
    assert.deepEqual(boundedHistory.payload.shares.slice(0,5).map(share=>share.id).sort(),activeIds);
    assert.ok(boundedHistory.payload.shares.slice(0,5).every(share=>share.active===true));
    assert.ok(boundedHistory.payload.shares.slice(5).every(share=>share.active===false));

    const foreignRevoke = await call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
      method: "DELETE", auth: other,
    });
    assert.equal(foreignRevoke.response.status, 404);
    const [racedOpen,revoked] = await Promise.all([
      openShare(server.origin, mainToken),
      call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
        method: "DELETE", auth: owner,
      }),
    ]);
    assert.ok([200,410].includes(racedOpen.response.status));
    assert.equal(revoked.response.status, 204);
    assert.equal((await call(server.origin, `/api/projects/${source.project.id}/report-shares/${mainShare.id}`, {
      method: "DELETE", auth: owner,
    })).response.status, 204);
    const closed = await openShare(server.origin, mainToken);
    assert.equal(closed.response.status, 410);
    assert.equal(closed.payload.code, "report_share_unavailable");
    const closedAccessCount=Number((await liveQuery(server, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`))[0].access_count);
    const afterClosure=await Promise.all(Array.from({length:8},()=>openShare(server.origin,mainToken)));
    assert.ok(afterClosure.every(result=>result.response.status===410));
    assert.equal(Number((await liveQuery(server, `SELECT access_count FROM report_shares WHERE id='${mainShare.id}';`))[0].access_count),closedAccessCount);

    const quotaOwner = await register(server.origin, "quota-owner");
    const quotaSource = await createReport(server.origin, quotaOwner, "QUOTA");
    let quotaReplay = null;
    for (let wave = 0; wave < 4; wave += 1) {
      const waveCreates = await Promise.all(Array.from({ length: 5 }, (_, index) => createShare(
        server.origin,
        quotaOwner,
        quotaSource,
        `quota-wave-${wave}-${index}`,
        { sections: ["overview"] },
      )));
      assert.ok(
        waveCreates.every((result) => result.response.status === 201),
        JSON.stringify(waveCreates.map((result) => ({ status: result.response.status, payload: result.payload }))),
      );
      if (wave === 0) quotaReplay = waveCreates[0];
      const waveRevokes = await Promise.all(waveCreates.map((result) => call(
        server.origin,
        `/api/projects/${quotaSource.project.id}/report-shares/${result.payload.share.id}`,
        { method: "DELETE", auth: quotaOwner },
      )));
      assert.ok(waveRevokes.every((result) => result.response.status === 204));
    }
    const quotaRows = await liveQuery(
      server,
      `SELECT window_start,request_count,limit_count FROM report_share_create_counters WHERE user_id='${quotaOwner.user.id}';`,
    );
    assert.equal(quotaRows.length, 1);
    assert.equal(Number(quotaRows[0].request_count), 20);
    assert.equal(Number(quotaRows[0].limit_count), 20);
    assert.match(quotaRows[0].window_start, / 00:00:00$/u);
    const quotaExceeded = await createShare(
      server.origin,
      quotaOwner,
      quotaSource,
      "quota-wave-over-limit",
      { sections: ["overview"] },
    );
    assert.equal(quotaExceeded.response.status, 429, JSON.stringify(quotaExceeded.payload));
    assert.equal(quotaExceeded.payload.code, "rate_limited");
    const quotaReplayAfterLimit = await createShare(
      server.origin,
      quotaOwner,
      quotaSource,
      "quota-wave-0-0",
      { sections: ["overview"] },
    );
    assert.equal(quotaReplayAfterLimit.response.status, 200, JSON.stringify(quotaReplayAfterLimit.payload));
    assert.equal(quotaReplayAfterLimit.payload.share.id, quotaReplay.payload.share.id);
    assert.equal(quotaReplayAfterLimit.payload.idempotentReplay, true);
    assert.equal(Number((await liveQuery(
      server,
      `SELECT request_count FROM report_share_create_counters WHERE user_id='${quotaOwner.user.id}';`,
    ))[0].request_count), 20);

    const expiredToken = "e".repeat(43);
    const expiredTokenHash = createHash("sha256").update(expiredToken).digest("hex");
    requireD1(await liveD1(server, `
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,created_at
      ) VALUES (
        'expiry-recent','${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${"1".repeat(64)}','${expiredTokenHash}','${"2".repeat(43)}','${"3".repeat(64)}',
        datetime('now','-1 day'),datetime('now','-8 days')
      );
    `), "expiry fixture insert failed");
    const expired = await openShare(server.origin, expiredToken);
    assert.equal(expired.response.status, 410);
    assert.equal(expired.payload.code, "report_share_expired");

    const retentionToken = "r".repeat(43);
    const retentionTokenHash = createHash("sha256").update(retentionToken).digest("hex");
    requireD1(await liveD1(server, `
      INSERT INTO report_shares (
        id,project_id,user_id,project_revision,report_schema_version,sections_json,
        report_content_hash,token_hash,idempotency_key_hash,request_hash,expires_at,created_at
      ) VALUES (
        'retention-old','${source.project.id}','${owner.user.id}',${source.revision},2,'["overview"]',
        '${"a".repeat(64)}','${retentionTokenHash}','${"c".repeat(43)}','${"d".repeat(64)}',
        datetime('now','-91 days'),datetime('now','-121 days')
      );
      INSERT INTO report_share_read_counters
        (subject_hash,window_start,request_count,limit_count,updated_at)
      VALUES (
        '${"9".repeat(64)}',datetime('now','-73 hours'),1,120,datetime('now','-73 hours')
      );
      INSERT INTO report_share_create_counters
        (user_id,window_start,request_count,limit_count,updated_at)
      VALUES (
        '${other.user.id}',datetime('now','-3 days'),1,20,datetime('now','-3 days')
      );
    `), "retention fixture insert failed");
    const scheduled = await fetch(`${server.origin}/__scheduled?cron=17+2+*+*+*`);
    assert.equal(scheduled.status, 200);
    await scheduled.arrayBuffer();
    const deadline = Date.now() + 10_000;
    let retentionStatus = 410;
    while (Date.now() < deadline && retentionStatus !== 404) {
      retentionStatus = (await openShare(server.origin, retentionToken)).response.status;
      if (retentionStatus === 404) break;
      assert.equal(retentionStatus, 410);
      await wait(100);
    }
    assert.equal(retentionStatus, 404, "scheduled cleanup did not remove the over-90-day report share");
    assert.equal(Number((await liveQuery(server, "SELECT COUNT(*) AS count FROM report_shares WHERE id='retention-old';"))[0].count), 0);
    assert.equal(Number((await liveQuery(server, `SELECT COUNT(*) AS count FROM report_share_read_counters WHERE subject_hash='${"9".repeat(64)}';`))[0].count), 0);
    assert.ok(Number((await liveQuery(server, "SELECT COUNT(*) AS count FROM report_share_read_counters;"))[0].count)>0);
    assert.equal(Number((await liveQuery(
      server,
      `SELECT COUNT(*) AS count FROM report_share_create_counters WHERE user_id='${other.user.id}';`,
    ))[0].count), 0);
    assert.deepEqual(await liveQuery(
      server,
      `SELECT request_count,limit_count FROM report_share_create_counters WHERE user_id='${quotaOwner.user.id}';`,
    ), [{ request_count: 20, limit_count: 20 }]);
    let historicalAfterCleanup;
    try {
      historicalAfterCleanup = await openShare(server.origin, historicalToken);
    } catch (error) {
      assert.fail(`Worker connection failed after scheduled cleanup: ${error?.message || error}\n${server.logs()}`);
    }
    assert.equal(historicalAfterCleanup.response.status, 200);

    const directRetarget = await liveD1(server, `UPDATE report_shares SET project_revision=project_revision+1 WHERE id='${historical.payload.share.id}';`);
    assert.notEqual(directRetarget.status, 0);
    assert.match(`${directRetarget.stdout}\n${directRetarget.stderr}`, /immutable/iu);

    const deleted = await call(server.origin, `/api/projects/${source.project.id}`, { method: "DELETE", auth: owner });
    assert.equal(deleted.response.status, 204, JSON.stringify(deleted.payload));
    assert.equal(Number((await liveQuery(server, `SELECT COUNT(*) AS count FROM report_shares WHERE project_id='${source.project.id}';`))[0].count), 0);
    assert.equal((await openShare(server.origin, historicalToken)).response.status, 404);

    // Run the deliberate stream cancellation last. Miniflare can tear down an
    // internal HTTP/1 connection after the Worker rejects the unread remainder;
    // no later product assertion should depend on that test-harness socket.
    const oversizedChunks = [
      new TextEncoder().encode(`{"token":"${malformedBearer}","padding":"`),
      new TextEncoder().encode("x".repeat(600)),
      new TextEncoder().encode('"}'),
    ];
    const oversizedStream = new ReadableStream({
      pull(controller) {
        const chunk = oversizedChunks.shift();
        if (chunk) controller.enqueue(chunk);
        else controller.close();
      },
    });
    const oversizedPublic = await fetch(`${server.origin}/api/shared/report`, {
      method: "POST",
      headers: { origin: server.origin, "content-type": "application/json", connection: "close" },
      body: oversizedStream,
      duplex: "half",
    });
    assert.equal(oversizedPublic.status, 404);
    assert.deepEqual(await oversizedPublic.json(), {
      error: "shared report not found",
      code: "report_share_not_found",
    });

    const applicationLogs = [...capturedLogs, server.logs()].join("\n")
      .split(/\r?\n/u)
      .filter((line) => line.includes('"type":"request_complete"'))
      .join("\n");
    assert.match(applicationLogs, /"route":"\/api\/shared\/report"/u);
    assert.equal(applicationLogs.includes(mainToken), false);
    assert.equal(applicationLogs.includes(historicalToken), false);
    assert.equal(applicationLogs.includes(malformedBearer), false);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
