import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const localD1ApiPath = "/cdn-cgi/local/explorer/api/d1/database";
const localD1TimeoutMs = 10_000;
const localD1MaxRequestBytes = 1024 * 1024;
const localD1MaxResponseBytes = 2 * 1024 * 1024;

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
  return `${current}${String(chunk)}`.slice(-40_000);
}

function assertJsonObject(value, context) {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${context} must be an object`);
}

function assertExactKeys(value, expected, context) {
  assertJsonObject(value, context);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${context} has an unexpected shape`);
}

async function readLocalD1Json(response, context) {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  assert.equal(mediaType, "application/json", `${context} must return application/json`);
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    assert.match(declaredLength, /^\d+$/u, `${context} returned an invalid content-length`);
    assert.ok(Number(declaredLength) <= localD1MaxResponseBytes, `${context} exceeded the response limit`);
  }
  assert.ok(response.body, `${context} must return a response body`);
  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > localD1MaxResponseBytes) {
        await reader.cancel("local D1 response exceeded the limit");
        assert.fail(`${context} exceeded the response limit`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${context} returned invalid JSON: ${error?.message || error}`);
  }
}

function assertLocalD1Messages(value, context) {
  assert.ok(Array.isArray(value), `${context} must be an array`);
  for (const [index, message] of value.entries()) {
    assertExactKeys(message, ["code", "message"], `${context}[${index}]`);
    assert.ok(Number.isInteger(message.code) && message.code >= 1_000, `${context}[${index}].code is invalid`);
    assert.equal(typeof message.message, "string", `${context}[${index}].message is invalid`);
  }
}

function assertLocalD1Envelope(payload, expectedKeys, context) {
  assertExactKeys(payload, expectedKeys, context);
  assert.equal(payload.success, true, `${context} failed: ${JSON.stringify(payload.errors)}`);
  assertLocalD1Messages(payload.errors, `${context}.errors`);
  assertLocalD1Messages(payload.messages, `${context}.messages`);
  assert.deepEqual(payload.errors, [], `${context} returned errors`);
}

async function discoverLocalD1Database(server) {
  const context = "local D1 database discovery";
  const response = await fetch(`${server.origin}${localD1ApiPath}`, {
    headers: {
      accept: "application/json",
      "x-miniflare-explorer-no-aggregate": "true",
    },
    signal: AbortSignal.timeout(localD1TimeoutMs),
  });
  const payload = await readLocalD1Json(response, context);
  assert.equal(response.status, 200, `${context} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  assertLocalD1Envelope(payload, ["success", "errors", "messages", "result", "result_info"], context);
  assert.ok(Array.isArray(payload.result), `${context}.result must be an array`);
  assertExactKeys(payload.result_info, ["count"], `${context}.result_info`);
  assert.equal(payload.result_info.count, payload.result.length, `${context} returned an invalid count`);
  const databases = payload.result.filter((database) => database?.name === "DB");
  assert.equal(databases.length, 1, `${context} must find exactly one DB binding`);
  const database = databases[0];
  assertExactKeys(database, ["name", "uuid", "version"], `${context}.result[DB]`);
  assert.match(database.uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu, `${context} returned an invalid UUID`);
  assert.equal(database.version, "production", `${context} returned an unexpected database version`);
  return database.uuid;
}

async function localD1Raw(server, sql, context) {
  assert.ok(server?.databaseId, `${context} requires a discovered database binding`);
  assert.equal(typeof sql, "string", `${context} SQL must be a string`);
  assert.ok(sql.trim(), `${context} SQL must not be empty`);
  assert.ok(Buffer.byteLength(sql, "utf8") <= localD1MaxRequestBytes, `${context} SQL exceeded the request limit`);
  let response;
  try {
    response = await fetch(
      `${server.origin}${localD1ApiPath}/${encodeURIComponent(server.databaseId)}/raw`,
      {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-miniflare-explorer-no-aggregate": "true",
        },
        body: JSON.stringify({ sql }),
        signal: AbortSignal.timeout(localD1TimeoutMs),
      },
    );
  } catch (error) {
    throw new Error(`${context} request failed: ${error?.message || error}\n${server.logs()}`);
  }
  const payload = await readLocalD1Json(response, context);
  assert.equal(response.status, 200, `${context} returned HTTP ${response.status}: ${JSON.stringify(payload)}`);
  assertLocalD1Envelope(payload, ["success", "errors", "messages", "result"], context);
  assert.ok(Array.isArray(payload.result) && payload.result.length > 0, `${context}.result must be non-empty`);
  for (const [index, result] of payload.result.entries()) {
    const resultContext = `${context}.result[${index}]`;
    assertExactKeys(result, ["meta", "results", "success"], resultContext);
    assert.equal(result.success, true, `${resultContext} was unsuccessful`);
    assertJsonObject(result.meta, `${resultContext}.meta`);
    assertExactKeys(result.results, ["columns", "rows"], `${resultContext}.results`);
    assert.ok(Array.isArray(result.results.columns), `${resultContext}.results.columns must be an array`);
    assert.ok(
      result.results.columns.every((column) => typeof column === "string"),
      `${resultContext}.results.columns must contain strings`,
    );
    assert.equal(
      new Set(result.results.columns).size,
      result.results.columns.length,
      `${resultContext}.results.columns must be unique`,
    );
    assert.ok(Array.isArray(result.results.rows), `${resultContext}.results.rows must be an array`);
    assert.ok(
      result.results.rows.every((row) => Array.isArray(row) && row.length === result.results.columns.length),
      `${resultContext}.results.rows must match the column width`,
    );
  }
  return payload.result;
}

async function liveExecute(server, sql, context) {
  await localD1Raw(server, sql, context);
}

async function liveQuery(server, sql, context = "local D1 query failed") {
  const result = (await localD1Raw(server, sql, context)).at(-1).results;
  return result.rows.map((row) => Object.fromEntries(
    result.columns.map((column, index) => [column, row[index]]),
  ));
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
    "--test-scheduled",
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
    // Wrangler otherwise prints its development request summary with the raw
    // URL. That is tool-owned local output, not the Worker's templated
    // production completion log; suppress it so this canary measures the
    // application log contract itself.
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
    let response;
    try {
      response = await fetch(`${origin}/api/health`);
    } catch {
      // workerd has not bound its local port yet.
      continue;
    }
    if (response.status !== 200) {
      await response.body?.cancel();
      continue;
    }
    await response.body?.cancel();
    const server = { child, exited, origin, logs: () => logs };
    try {
      server.databaseId = await discoverLocalD1Database(server);
      return server;
    } catch (error) {
      await stopWorker(server);
      throw new Error(`wrangler local D1 discovery failed:\n${error?.message || error}\n${logs}`);
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

function requireD1Success(result, context) {
  assert.equal(result.status, 0, `${context}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  return result;
}

function query(stateDirectory, sql) {
  const result = requireD1Success(d1(stateDirectory, "query", sql), "D1 query failed");
  return JSON.parse(result.stdout).flatMap((entry) => entry.results || []);
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
  method = "GET", body, auth, headers = {}, originHeader = origin,
} = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!["GET", "HEAD"].includes(method)) requestHeaders.set("origin", originHeader);
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
      name: `Family owner ${suffix}`,
      email: `family-owner-${suffix}@example.test`,
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

async function createDecision(origin, auth, suffix, dimensions = [37, 61], city = "Jaipur") {
  const projectName = `PRIVATE_PROJECT_${suffix}_DO_NOT_SHARE`;
  const firstNote = `PRIVATE_NOTE_${suffix}_A_DO_NOT_SHARE`;
  const secondNote = `PRIVATE_NOTE_${suffix}_B_DO_NOT_SHARE`;
  const firstLabel = `PRIVATE_LABEL_${suffix}_A`;
  const secondLabel = `PRIVATE_LABEL_${suffix}_B`;
  const projectResult = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    body: {
      name: projectName,
      input: {
        width: dimensions[0],
        length: dimensions[1],
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        quality: "Signature",
        city,
      },
    },
  });
  assert.equal(projectResult.response.status, 201, JSON.stringify(projectResult.payload));
  const project = projectResult.payload.project;
  const comparisonResult = await call(origin, `/api/projects/${project.id}/decision-compare`, {
    method: "PUT",
    auth,
    body: {
      priority: "balanced",
      scenarios: [
        { label: firstLabel, floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: firstNote },
        { label: secondLabel, floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: secondNote },
      ],
    },
  });
  assert.equal(comparisonResult.response.status, 201, JSON.stringify(comparisonResult.payload));
  return {
    project,
    comparison: comparisonResult.payload.comparison,
    privateValues: [projectName, firstNote, secondNote, firstLabel, secondLabel, city, `${dimensions[0]} × ${dimensions[1]}`],
  };
}

async function createRoom(origin, auth, decision, key) {
  return call(origin, `/api/projects/${decision.project.id}/family-alignment`, {
    method: "POST",
    auth,
    headers: { "idempotency-key": key },
    body: { comparisonId: decision.comparison.id },
  });
}

function roomToken(room) {
  assert.match(room.url, /^https:\/\/app\.example\.test\/align#[A-Za-z0-9_-]{43}$/u);
  return new URL(room.url).hash.slice(1);
}

function responseToken() {
  return randomBytes(32).toString("base64url");
}

async function submitResponse(origin, token, receipt, body) {
  return call(origin, "/api/shared/family-alignment/response", {
    method: "PUT",
    headers: { "x-family-response-token": receipt },
    body: { token, response: body },
  });
}

async function readRoom(origin, token, options = {}) {
  return call(origin, "/api/shared/family-alignment", {
    method: "POST",
    body: { token },
    ...options,
  });
}

function assertGenericFamilyNotFound(result, context) {
  assert.equal(result.response.status, 404, `${context}: ${JSON.stringify(result.payload)}`);
  assert.deepEqual(result.payload, {
    error: "review room not found",
    code: "family_alignment_not_found",
  }, context);
}

function assertNoForbiddenPublicFields(value) {
  const forbidden = new Set([
    "recommendation", "selection", "selectedscenarioid", "projectid", "projectname",
    "userid", "accountid", "input", "notes", "questionsforarchitect", "contenthash",
    "sourceinputhash", "orderid", "payment", "entitlement", "token", "tokenhash",
    "receipthash", "responses",
  ]);
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `public projection contains forbidden field ${key}`);
      visit(child);
    }
  }
  visit(value);
}

test("Family Alignment is redacted, bounded, owner-scoped, revocable, and retained safely in real D1", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-family-alignment-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  const capturedLogs = [];
  try {
    requireD1Success(d1(stateDirectory, "migrate"), "fresh migrations failed");
    requireD1Success(d1(
      stateDirectory,
      "execute",
      `CREATE TRIGGER e2e_fail_family_analytics
         BEFORE INSERT ON product_event_aggregates
         WHEN NEW.event_name LIKE 'family_alignment_%'
       BEGIN SELECT RAISE(ABORT, 'synthetic family analytics outage'); END;`,
    ), "installing the ancillary analytics failure failed");

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.checks.schema, "current");
    assert.equal(readiness.payload.checks.familyAlignmentSchema, "current");
    assert.equal(readiness.payload.capabilities.familyAlignment, true);
    assert.equal(readiness.payload.capabilities.paidCheckout, false);

    const owner = await register(server.origin, "primary");
    const other = await register(server.origin, "other");
    const main = await createDecision(server.origin, owner, "MAIN");

    const foreignCreate = await createRoom(server.origin, other, main, "family-foreign-create");
    assert.equal(foreignCreate.response.status, 404);
    const created = await createRoom(server.origin, owner, main, "family-main-create");
    assert.equal(created.response.status, 201, JSON.stringify(created.payload));
    const mainRoom = created.payload.room;
    const mainToken = roomToken(mainRoom);
    assert.equal((Date.parse(`${mainRoom.expiresAt.replace(" ", "T")}Z`) - Date.parse(`${mainRoom.createdAt.replace(" ", "T")}Z`)) / 1000, 7 * 24 * 60 * 60);

    const replay = await createRoom(server.origin, owner, main, "family-main-create");
    assert.equal(replay.response.status, 200, JSON.stringify(replay.payload));
    assert.equal(replay.payload.room.id, mainRoom.id);
    assert.equal(Object.hasOwn(replay.payload.room, "url"), false);
    const duplicateDifferentKey = await createRoom(server.origin, owner, main, "family-main-different-key");
    assert.equal(duplicateDifferentKey.response.status, 409);
    assert.equal(duplicateDifferentKey.payload.code, "family_alignment_room_exists");

    const foreignOwnerRead = await call(server.origin, `/api/projects/${main.project.id}/family-alignment`, { auth: other });
    assert.equal(foreignOwnerRead.response.status, 404);
    const foreignRevoke = await call(server.origin, `/api/projects/${main.project.id}/family-alignment/${mainRoom.id}`, {
      method: "DELETE",
      auth: other,
    });
    assert.equal(foreignRevoke.response.status, 404);

    const initialExpiryState = (await liveQuery(server, `
      SELECT expires_at,
             length(expires_at)=19 AS canonical_length,
             strftime('%Y-%m-%d %H:%M:%S',julianday(expires_at))=expires_at AS canonical_value
        FROM family_alignment_rooms WHERE id=${sqlLiteral(mainRoom.id)};
    `))[0];
    assert.deepEqual(
      [Number(initialExpiryState.canonical_length), Number(initialExpiryState.canonical_value)],
      [1, 1],
      `created room expiry must be canonical: ${JSON.stringify(initialExpiryState)}`,
    );

    // Reject transport and envelope failures before either fixed endpoint can
    // admit a read or write against the room. Token failures deliberately share
    // one generic response so parsing does not become a capability oracle.
    const rejectedResponseBody = {
      role: "spouse", preference: "A", confidence: "high", reasons: ["budget"],
    };
    const malformedBearer = "z".repeat(43);
    const untrustedRead = await readRoom(server.origin, mainToken, {
      originHeader: "https://evil.example.test",
    });
    assert.equal(untrustedRead.response.status, 403);
    assert.equal(untrustedRead.payload.code, "origin_rejected");
    const untrustedWrite = await call(server.origin, "/api/shared/family-alignment/response", {
      method: "PUT",
      originHeader: "https://evil.example.test",
      headers: { "x-family-response-token": responseToken() },
      body: { token: mainToken, response: rejectedResponseBody },
    });
    assert.equal(untrustedWrite.response.status, 403);
    assert.equal(untrustedWrite.payload.code, "origin_rejected");

    for (const [context, body] of [
      ["missing token", {}],
      ["array envelope", []],
      ["malformed token", { token: "short" }],
      ["unknown token", { token: malformedBearer }],
      ["unsupported read field", { token: mainToken, extra: true }],
    ]) {
      assertGenericFamilyNotFound(
        await readRoom(server.origin, malformedBearer, { body }),
        context,
      );
    }
    const malformedWrite = await call(server.origin, "/api/shared/family-alignment/response", {
      method: "PUT",
      headers: { "x-family-response-token": responseToken() },
      body: { token: "short", response: rejectedResponseBody },
    });
    assertGenericFamilyNotFound(malformedWrite, "malformed response token envelope");
    const unsupportedWriteField = await call(server.origin, "/api/shared/family-alignment/response", {
      method: "PUT",
      headers: { "x-family-response-token": responseToken() },
      body: { token: mainToken, response: rejectedResponseBody, extra: true },
    });
    assertGenericFamilyNotFound(unsupportedWriteField, "unsupported response envelope field");

    const sameOriginTextResponse = await fetch(`${server.origin}/api/shared/family-alignment`, {
      method: "POST",
      // Wrong-media rejection deliberately cancels the unread body. Keep that
      // transport probe off Miniflare's pooled HTTP/1 socket for later checks.
      headers: { origin: server.origin, "content-type": "text/plain; charset=utf-8", connection: "close" },
      body: JSON.stringify({ token: mainToken }),
    });
    assertGenericFamilyNotFound({
      response: sameOriginTextResponse,
      payload: await sameOriginTextResponse.json(),
    }, "unsupported read media type");
    const canonicalJsonResponse = await fetch(`${server.origin}/api/shared/family-alignment`, {
      method: "POST",
      headers: {
        origin: "https://app.example.test",
        "content-type": "Application/JSON; charset=utf-8",
      },
      body: JSON.stringify({ token: malformedBearer }),
    });
    assertGenericFamilyNotFound({
      response: canonicalJsonResponse,
      payload: await canonicalJsonResponse.json(),
    }, "canonical origin and parameterized JSON");
    const oversizedRead = await readRoom(server.origin, mainToken, {
      body: { token: mainToken, padding: "x".repeat(70 * 1024) },
    });
    assertGenericFamilyNotFound(oversizedRead, "oversized read envelope");

    // Miniflare may retire its internal HTTP/1 socket after the Worker rejects
    // an unread oversized body. Restart against the same persisted D1 state so
    // the next assertion measures admission rather than harness connection reuse.
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const rejectedAdmissionState = (await liveQuery(server, `
      SELECT access_count,last_accessed_at,response_count,
             (SELECT COUNT(*) FROM family_alignment_responses f WHERE f.room_id=r.id) AS actual_count
        FROM family_alignment_rooms r WHERE r.id=${sqlLiteral(mainRoom.id)};
    `))[0];
    assert.equal(Number(rejectedAdmissionState.access_count), 0);
    assert.equal(rejectedAdmissionState.last_accessed_at, null);
    assert.equal(Number(rejectedAdmissionState.response_count), 0);
    assert.equal(Number(rejectedAdmissionState.actual_count), 0);

    const publicRead = await readRoom(server.origin, mainToken);
    assert.equal(publicRead.response.status, 200, JSON.stringify(publicRead.payload));
    assert.deepEqual(Object.keys(publicRead.payload), ["room"]);
    assert.deepEqual(
      Object.keys(publicRead.payload.room).sort(),
      ["assumptions", "comparisonVersion", "createdAt", "disclaimer", "expiresAt", "id", "maxResponses", "responseCount", "scenarios"].sort(),
    );
    assert.equal(publicRead.payload.room.scenarios.length, 2);
    assert.deepEqual(publicRead.payload.room.scenarios.map((scenario) => scenario.key), ["A", "B"]);
    assertNoForbiddenPublicFields(publicRead.payload);
    const publicJson = JSON.stringify(publicRead.payload);
    for (const privateValue of [...main.privateValues, main.project.id, main.comparison.id, main.comparison.scenarios[0].id]) {
      assert.equal(publicJson.includes(privateValue), false, `public review leaked ${privateValue}`);
    }
    const successfulReadState = (await liveQuery(server, `
      SELECT access_count,last_accessed_at FROM family_alignment_rooms WHERE id=${sqlLiteral(mainRoom.id)};
    `))[0];
    assert.equal(Number(successfulReadState.access_count), 1, "one admitted read must increment exactly once");
    assert.ok(successfulReadState.last_accessed_at, "one admitted read must record its access time");

    // Keep the prior path-based APIs functional during the fragment-link
    // transition. Isolate this compatibility proof so legacy traffic cannot
    // alter the primary room's response cap, closure races, or retention math.
    const legacyCompatibility = await createDecision(
      server.origin,
      owner,
      "LEGACY_COMPATIBILITY",
      [38, 62],
      "Jaipur",
    );
    const legacyCompatibilityCreated = await createRoom(
      server.origin,
      owner,
      legacyCompatibility,
      "family-legacy-compatibility-create",
    );
    assert.equal(
      legacyCompatibilityCreated.response.status,
      201,
      JSON.stringify(legacyCompatibilityCreated.payload),
    );
    const legacyRoom = legacyCompatibilityCreated.payload.room;
    const legacyToken = roomToken(legacyRoom);
    const legacyReceipt = responseToken();
    const legacyRead = await call(server.origin, `/api/family-alignment/${legacyToken}`);
    assert.equal(legacyRead.response.status, 200, JSON.stringify(legacyRead.payload));
    assertNoForbiddenPublicFields(legacyRead.payload);
    assert.equal(legacyRead.payload.room.responseCount, 0);
    const legacyBody = {
      role: "advisor", preference: "B", confidence: "medium", reasons: ["accessibility"],
    };
    const legacyWrite = await call(server.origin, `/api/family-alignment/${legacyToken}/response`, {
      method: "PUT",
      headers: { "x-family-response-token": legacyReceipt },
      body: legacyBody,
    });
    assert.equal(legacyWrite.response.status, 201, JSON.stringify(legacyWrite.payload));
    assert.deepEqual(legacyWrite.payload, { response: legacyBody, saved: true, updated: false });
    const legacyCanonicalRead = await readRoom(server.origin, legacyToken);
    assert.equal(legacyCanonicalRead.response.status, 200, JSON.stringify(legacyCanonicalRead.payload));
    assert.equal(legacyCanonicalRead.payload.room.responseCount, 1);
    const deletedLegacyProject = await call(
      server.origin,
      `/api/projects/${legacyCompatibility.project.id}`,
      { method: "DELETE", auth: owner },
    );
    assert.equal(deletedLegacyProject.response.status, 204, JSON.stringify(deletedLegacyProject.payload));
    const deletedLegacyRows = (await liveQuery(server, `
      SELECT
        (SELECT COUNT(*) FROM family_alignment_rooms WHERE id=${sqlLiteral(legacyRoom.id)}) AS room_count,
        (SELECT COUNT(*) FROM family_alignment_responses WHERE room_id=${sqlLiteral(legacyRoom.id)}) AS response_count;
    `))[0];
    assert.deepEqual(deletedLegacyRows, { room_count: 0, response_count: 0 });

    // The public comparison must not survive a dependency failure or a revoke
    // that wins after the initial token lookup but before final read admission.
    // These real-D1 triggers deterministically exercise both interleavings.
    await liveExecute(
      server,
      "DROP TRIGGER e2e_fail_family_analytics;",
      "enabling aggregate observation for read admission failed",
    );
    const openedEventsBeforeAdmission = Number((await liveQuery(
      server,
      "SELECT COALESCE(SUM(event_count),0) AS count FROM product_event_aggregates WHERE event_name='family_alignment_review_opened';",
    ))[0].count);
    const readAdmission = await createDecision(server.origin, owner, "READ_ADMISSION", [39, 59], "Pune");
    const readAdmissionCreated = await createRoom(
      server.origin,
      owner,
      readAdmission,
      "family-read-admission-create",
    );
    assert.equal(readAdmissionCreated.response.status, 201, JSON.stringify(readAdmissionCreated.payload));
    const readAdmissionRoom = readAdmissionCreated.payload.room;
    const readAdmissionToken = roomToken(readAdmissionRoom);
    await liveExecute(
      server,
      `CREATE TRIGGER e2e_fail_family_read_admission
         BEFORE UPDATE OF access_count ON family_alignment_rooms
         WHEN OLD.id=${sqlLiteral(readAdmissionRoom.id)}
       BEGIN
         SELECT RAISE(ABORT, 'synthetic private read admission outage');
       END;`,
      "installing the read-admission failure failed",
    );
    const failedAdmission = await readRoom(server.origin, readAdmissionToken);
    assert.equal(failedAdmission.response.status, 503, JSON.stringify(failedAdmission.payload));
    assert.equal(Object.hasOwn(failedAdmission.payload, "room"), false);
    assert.equal(JSON.stringify(failedAdmission.payload).includes("synthetic private read admission outage"), false);
    await liveExecute(
      server,
      `DROP TRIGGER e2e_fail_family_read_admission;
       CREATE TRIGGER e2e_revoke_family_before_read_admission
         BEFORE UPDATE OF access_count ON family_alignment_rooms
         WHEN OLD.id=${sqlLiteral(readAdmissionRoom.id)} AND OLD.revoked_at IS NULL
       BEGIN
         UPDATE family_alignment_rooms SET revoked_at=datetime('now') WHERE id=OLD.id;
         SELECT RAISE(IGNORE);
       END;`,
      "installing the read-vs-revoke interleaving failed",
    );
    const revokeWonAdmission = await readRoom(server.origin, readAdmissionToken);
    assert.equal(revokeWonAdmission.response.status, 410, JSON.stringify(revokeWonAdmission.payload));
    assert.equal(revokeWonAdmission.payload.code, "family_alignment_unavailable");
    assert.equal(Object.hasOwn(revokeWonAdmission.payload, "room"), false);
    const readAdmissionState = (await liveQuery(server, `
      SELECT access_count,last_accessed_at,revoked_at
        FROM family_alignment_rooms WHERE id=${sqlLiteral(readAdmissionRoom.id)};
    `))[0];
    assert.equal(Number(readAdmissionState.access_count), 0);
    assert.equal(readAdmissionState.last_accessed_at, null);
    assert.ok(readAdmissionState.revoked_at);
    await liveExecute(
      server,
      "DROP TRIGGER e2e_revoke_family_before_read_admission;",
      "dropping the read-vs-revoke interleaving failed",
    );
    const deletedReadAdmissionProject = await call(
      server.origin,
      `/api/projects/${readAdmission.project.id}`,
      { method: "DELETE", auth: owner },
    );
    assert.equal(deletedReadAdmissionProject.response.status, 204, JSON.stringify(deletedReadAdmissionProject.payload));

    const archiveAdmission = await createDecision(server.origin, owner, "ARCHIVE_ADMISSION", [39, 61], "Jaipur");
    const archiveAdmissionCreated = await createRoom(
      server.origin,
      owner,
      archiveAdmission,
      "family-archive-admission-create",
    );
    assert.equal(archiveAdmissionCreated.response.status, 201, JSON.stringify(archiveAdmissionCreated.payload));
    const archiveAdmissionRoom = archiveAdmissionCreated.payload.room;
    const archiveAdmissionToken = roomToken(archiveAdmissionRoom);
    await liveExecute(
      server,
      `CREATE TRIGGER e2e_archive_family_before_read_admission
         BEFORE UPDATE OF access_count ON family_alignment_rooms
         WHEN OLD.id=${sqlLiteral(archiveAdmissionRoom.id)}
       BEGIN
         UPDATE projects SET status='archived' WHERE id=OLD.project_id;
         SELECT RAISE(IGNORE);
       END;`,
      "installing the read-vs-archive interleaving failed",
    );
    const archiveWonAdmission = await readRoom(server.origin, archiveAdmissionToken);
    assert.equal(archiveWonAdmission.response.status, 410, JSON.stringify(archiveWonAdmission.payload));
    assert.equal(archiveWonAdmission.payload.code, "family_alignment_unavailable");
    assert.equal(Object.hasOwn(archiveWonAdmission.payload, "room"), false);
    const archiveAdmissionState = (await liveQuery(server, `
      SELECT r.access_count,r.last_accessed_at,p.status AS project_status
        FROM family_alignment_rooms r
        JOIN projects p ON p.id=r.project_id
       WHERE r.id=${sqlLiteral(archiveAdmissionRoom.id)};
    `))[0];
    assert.equal(Number(archiveAdmissionState.access_count), 0);
    assert.equal(archiveAdmissionState.last_accessed_at, null);
    assert.equal(archiveAdmissionState.project_status, "archived");
    await liveExecute(
      server,
      "DROP TRIGGER e2e_archive_family_before_read_admission;",
      "dropping the read-vs-archive interleaving failed",
    );
    const deletedArchiveAdmissionProject = await call(
      server.origin,
      `/api/projects/${archiveAdmission.project.id}`,
      { method: "DELETE", auth: owner },
    );
    assert.equal(deletedArchiveAdmissionProject.response.status, 204, JSON.stringify(deletedArchiveAdmissionProject.payload));

    const invalidExpiryAdmission = await createDecision(
      server.origin,
      owner,
      "INVALID_EXPIRY_ADMISSION",
      [41, 61],
      "Hyderabad",
    );
    const invalidExpiryCreated = await createRoom(
      server.origin,
      owner,
      invalidExpiryAdmission,
      "family-invalid-expiry-admission-create",
    );
    assert.equal(invalidExpiryCreated.response.status, 201, JSON.stringify(invalidExpiryCreated.payload));
    const invalidExpiryRoom = invalidExpiryCreated.payload.room;
    const invalidExpiryToken = roomToken(invalidExpiryRoom);
    const expiryAdmission = await createDecision(server.origin, owner, "EXPIRY_ADMISSION", [43, 61], "Chennai");
    const expiryAdmissionCreated = await createRoom(
      server.origin,
      owner,
      expiryAdmission,
      "family-expiry-admission-create",
    );
    assert.equal(expiryAdmissionCreated.response.status, 201, JSON.stringify(expiryAdmissionCreated.payload));
    const expiryAdmissionRoom = expiryAdmissionCreated.payload.room;
    const expiryAdmissionToken = roomToken(expiryAdmissionRoom);
    await liveExecute(
      server,
      `DROP TRIGGER family_alignment_room_identity_immutable;
       CREATE TRIGGER e2e_invalidate_family_expiry_before_read_admission
         BEFORE UPDATE OF access_count ON family_alignment_rooms
         WHEN OLD.id=${sqlLiteral(invalidExpiryRoom.id)}
       BEGIN
         UPDATE family_alignment_rooms SET expires_at='2027-02-30 12:00:00' WHERE id=OLD.id;
         SELECT RAISE(IGNORE);
       END;
       CREATE TRIGGER e2e_expire_family_before_read_admission
         BEFORE UPDATE OF access_count ON family_alignment_rooms
         WHEN OLD.id=${sqlLiteral(expiryAdmissionRoom.id)}
       BEGIN
         UPDATE family_alignment_rooms SET expires_at=datetime('now','-1 second') WHERE id=OLD.id;
         SELECT RAISE(IGNORE);
       END;`,
      "installing malformed and expired read-admission interleavings failed",
    );
    const invalidExpiryRead = await readRoom(server.origin, invalidExpiryToken);
    assert.equal(invalidExpiryRead.response.status, 503, JSON.stringify(invalidExpiryRead.payload));
    assert.equal(Object.hasOwn(invalidExpiryRead.payload, "room"), false);
    assert.equal(JSON.stringify(invalidExpiryRead.payload).includes("2027-02-30"), false);
    await liveExecute(
      server,
      `UPDATE family_alignment_rooms SET expires_at='2099-01-02T03:04:05'
        WHERE id=${sqlLiteral(invalidExpiryRoom.id)};`,
      "installing a non-canonical stored expiry failed",
    );
    const nonCanonicalExpiryRead = await readRoom(server.origin, invalidExpiryToken);
    assert.equal(nonCanonicalExpiryRead.response.status, 503, JSON.stringify(nonCanonicalExpiryRead.payload));
    assert.equal(Object.hasOwn(nonCanonicalExpiryRead.payload, "room"), false);
    assert.equal(JSON.stringify(nonCanonicalExpiryRead.payload).includes("2099-01-02"), false);
    const expiryWonAdmission = await readRoom(server.origin, expiryAdmissionToken);
    assert.equal(expiryWonAdmission.response.status, 410, JSON.stringify(expiryWonAdmission.payload));
    assert.equal(expiryWonAdmission.payload.code, "family_alignment_expired");
    assert.equal(Object.hasOwn(expiryWonAdmission.payload, "room"), false);
    for (const fixture of [invalidExpiryRoom, expiryAdmissionRoom]) {
      const state = (await liveQuery(server, `
        SELECT access_count,last_accessed_at FROM family_alignment_rooms WHERE id=${sqlLiteral(fixture.id)};
      `))[0];
      assert.equal(Number(state.access_count), 0);
      assert.equal(state.last_accessed_at, null);
    }
    await liveExecute(
      server,
      `DROP TRIGGER e2e_invalidate_family_expiry_before_read_admission;
       DROP TRIGGER e2e_expire_family_before_read_admission;
       CREATE TRIGGER family_alignment_room_identity_immutable
       BEFORE UPDATE ON family_alignment_rooms
       WHEN NEW.project_id IS NOT OLD.project_id
         OR NEW.user_id IS NOT OLD.user_id
         OR NEW.comparison_id IS NOT OLD.comparison_id
         OR NEW.comparison_version != OLD.comparison_version
         OR NEW.token_hash IS NOT OLD.token_hash
         OR NEW.idempotency_key IS NOT OLD.idempotency_key
         OR NEW.request_hash IS NOT OLD.request_hash
         OR NEW.expires_at IS NOT OLD.expires_at
         OR NEW.created_at IS NOT OLD.created_at
       BEGIN
         SELECT RAISE(ABORT, 'family alignment room identity is immutable');
       END;`,
      "restoring the immutable room identity fence failed",
    );
    for (const fixture of [invalidExpiryAdmission, expiryAdmission]) {
      const deletedFixture = await call(
        server.origin,
        `/api/projects/${fixture.project.id}`,
        { method: "DELETE", auth: owner },
      );
      assert.equal(deletedFixture.response.status, 204, JSON.stringify(deletedFixture.payload));
    }
    assert.equal(Number((await liveQuery(
      server,
      "SELECT COALESCE(SUM(event_count),0) AS count FROM product_event_aggregates WHERE event_name='family_alignment_review_opened';",
    ))[0].count), openedEventsBeforeAdmission, "closed or failed reads must not emit successful-open events");
    await liveExecute(
      server,
      `CREATE TRIGGER e2e_fail_family_analytics
         BEFORE INSERT ON product_event_aggregates
         WHEN NEW.event_name LIKE 'family_alignment_%'
       BEGIN SELECT RAISE(ABORT, 'synthetic family analytics outage'); END;`,
      "restoring the ancillary analytics failure failed",
    );

    const invalidBody = await submitResponse(server.origin, mainToken, responseToken(), {
      role: "spouse",
      preference: "A",
      confidence: "high",
      reasons: ["budget"],
      comment: "PRIVATE_FREE_TEXT_DO_NOT_STORE",
    });
    assert.equal(invalidBody.response.status, 400);
    const missingReceipt = await call(server.origin, "/api/shared/family-alignment/response", {
      method: "PUT",
      body: {
        token: mainToken,
        response: { role: "spouse", preference: "A", confidence: "high", reasons: ["budget"] },
      },
    });
    assert.equal(missingReceipt.response.status, 400);

    const receipts = Array.from({ length: 6 }, () => responseToken());
    const responseBodies = [
      { role: "spouse", preference: "A", confidence: "high", reasons: ["budget"] },
      { role: "parent", preference: "A", confidence: "medium", reasons: ["space"] },
      { role: "sibling", preference: "B", confidence: "low", reasons: ["parking"] },
      { role: "advisor", preference: "B", confidence: "high", reasons: ["accessibility"] },
      { role: "other", preference: "not_ready", confidence: "medium", reasons: ["future_expansion"] },
    ];
    for (let index = 0; index < responseBodies.length; index += 1) {
      const submitted = await submitResponse(server.origin, mainToken, receipts[index], responseBodies[index]);
      assert.equal(submitted.response.status, 201, JSON.stringify(submitted.payload));
      assert.deepEqual(submitted.payload, { response: responseBodies[index], saved: true, updated: false });
      assert.equal(JSON.stringify(submitted.payload).includes(receipts[index]), false);
    }
    const sixth = await submitResponse(server.origin, mainToken, receipts[5], {
      role: "other", preference: "A", confidence: "low", reasons: ["construction_complexity"],
    });
    assert.equal(sixth.response.status, 409);
    assert.equal(sixth.payload.code, "family_alignment_full");

    const updatedBody = {
      role: "spouse", preference: "B", confidence: "high", reasons: ["construction_complexity"],
    };
    const updated = await submitResponse(server.origin, mainToken, receipts[0], updatedBody);
    assert.equal(updated.response.status, 200, JSON.stringify(updated.payload));
    assert.deepEqual(updated.payload, { response: updatedBody, saved: true, updated: true });

    const ownerRead = await call(server.origin, `/api/projects/${main.project.id}/family-alignment`, { auth: owner });
    assert.equal(ownerRead.response.status, 200, JSON.stringify(ownerRead.payload));
    assert.equal(ownerRead.payload.room.id, mainRoom.id);
    assert.equal(ownerRead.payload.rooms.length, 1);
    assert.equal(ownerRead.payload.room.responseCount, 5);
    assert.equal(ownerRead.payload.summary.totalResponses, 5);
    assert.deepEqual(ownerRead.payload.summary.preferences, { A: 1, B: 3, notReady: 1 });
    assert.deepEqual(ownerRead.payload.summary.confidence, { high: 2, medium: 2, low: 1 });
    assert.deepEqual(ownerRead.payload.summary.reasons, {
      budget: 0,
      space: 1,
      parking: 1,
      accessibility: 1,
      futureExpansion: 1,
      constructionComplexity: 1,
    });
    assert.equal(ownerRead.payload.summary.status, "leaning_b");
    const ownerSummaryJson = JSON.stringify(ownerRead.payload.summary);
    for (const secret of [mainToken, ...receipts]) assert.equal(ownerSummaryJson.includes(secret), false);

    const chosenScenarioId = main.comparison.scenarios[1].id;
    const chosen = await call(server.origin, `/api/projects/${main.project.id}/decision-compare/choice`, {
      method: "POST",
      auth: owner,
      body: { scenarioId: chosenScenarioId },
    });
    assert.equal(chosen.response.status, 201, JSON.stringify(chosen.payload));
    const afterChoicePublic = await readRoom(server.origin, mainToken);
    assert.equal(afterChoicePublic.response.status, 200);
    assertNoForbiddenPublicFields(afterChoicePublic.payload);
    assert.equal(JSON.stringify(afterChoicePublic.payload).includes(chosenScenarioId), false);

    const ordersBeforeRevoke = await liveQuery(server, "SELECT COUNT(*) AS count FROM orders;");
    assert.equal(Number(ordersBeforeRevoke[0].count), 0);
    const selectionBeforeRevoke = await liveQuery(server, `SELECT scenario_id,locked_at FROM decision_selections WHERE comparison_id=${sqlLiteral(main.comparison.id)};`);
    assert.equal(selectionBeforeRevoke[0].scenario_id, chosenScenarioId);
    assert.equal(selectionBeforeRevoke[0].locked_at, null);

    const revoked = await call(server.origin, `/api/projects/${main.project.id}/family-alignment/${mainRoom.id}`, {
      method: "DELETE",
      auth: owner,
    });
    assert.equal(revoked.response.status, 204);
    const revokeReplay = await call(server.origin, `/api/projects/${main.project.id}/family-alignment/${mainRoom.id}`, {
      method: "DELETE",
      auth: owner,
    });
    assert.equal(revokeReplay.response.status, 204);
    const revokedRead = await readRoom(server.origin, mainToken);
    assert.equal(revokedRead.response.status, 410);
    const revokedUpdate = await submitResponse(server.origin, mainToken, receipts[0], updatedBody);
    assert.equal(revokedUpdate.response.status, 410);

    // A second immutable comparison on the same project is the authoritative
    // current room even when D1's second-precision timestamps collide. Version
    // order must win over random UUID order.
    const mainV2Comparison = await call(server.origin, `/api/projects/${main.project.id}/decision-compare`, {
      method: "PUT",
      auth: owner,
      body: {
        priority: "space",
        scenarios: [
          { label: "Compact v2", floors: "G+1", bedrooms: 3, parking: true, quality: "Essential", notes: "" },
          { label: "Extended v2", floors: "G+2", bedrooms: 5, parking: true, quality: "Signature", notes: "" },
        ],
      },
    });
    assert.equal(mainV2Comparison.response.status, 201, JSON.stringify(mainV2Comparison.payload));
    assert.equal(mainV2Comparison.payload.comparison.version, 2);
    const mainV2 = { project: main.project, comparison: mainV2Comparison.payload.comparison };
    const mainV2Created = await createRoom(server.origin, owner, mainV2, "family-main-v2-create");
    assert.equal(mainV2Created.response.status, 201, JSON.stringify(mainV2Created.payload));
    const mainV2Room = mainV2Created.payload.room;
    const mainV2Token = roomToken(mainV2Room);
    await liveExecute(
      server,
      `DROP TRIGGER family_alignment_room_identity_immutable;
       UPDATE family_alignment_rooms
          SET created_at=(SELECT created_at FROM family_alignment_rooms WHERE id=${sqlLiteral(mainRoom.id)})
        WHERE id=${sqlLiteral(mainV2Room.id)};
       CREATE TRIGGER family_alignment_room_identity_immutable
       BEFORE UPDATE ON family_alignment_rooms
       WHEN NEW.project_id IS NOT OLD.project_id
         OR NEW.user_id IS NOT OLD.user_id
         OR NEW.comparison_id IS NOT OLD.comparison_id
         OR NEW.comparison_version != OLD.comparison_version
         OR NEW.token_hash IS NOT OLD.token_hash
         OR NEW.idempotency_key IS NOT OLD.idempotency_key
         OR NEW.request_hash IS NOT OLD.request_hash
         OR NEW.expires_at IS NOT OLD.expires_at
         OR NEW.created_at IS NOT OLD.created_at
       BEGIN
         SELECT RAISE(ABORT, 'family alignment room identity is immutable');
       END;`,
      "same-second room ordering fixture failed",
    );
    const orderedOwnerRead = await call(server.origin, `/api/projects/${main.project.id}/family-alignment`, { auth: owner });
    assert.equal(orderedOwnerRead.response.status, 200, JSON.stringify(orderedOwnerRead.payload));
    assert.equal(orderedOwnerRead.payload.room.id, mainV2Room.id);
    assert.equal(orderedOwnerRead.payload.summary.status, "no_responses");

    // Interleave the real public write with owner revocation. Either the write
    // commits first or it receives 410; after both finish the room is closed,
    // its counter reconciles, and no later update can cross the SQL-time fence.
    const raceReceipt = responseToken();
    const [racedWrite, racedRevoke] = await Promise.all([
      submitResponse(server.origin, mainV2Token, raceReceipt, {
        role: "parent", preference: "A", confidence: "high", reasons: ["space"],
      }),
      call(server.origin, `/api/projects/${main.project.id}/family-alignment/${mainV2Room.id}`, { method: "DELETE", auth: owner }),
    ]);
    assert.equal(racedRevoke.response.status, 204);
    assert.ok([201, 410].includes(racedWrite.response.status), JSON.stringify(racedWrite.payload));
    const closedV2Read = await readRoom(server.origin, mainV2Token);
    assert.equal(closedV2Read.response.status, 410);
    const racedState = (await liveQuery(server, `
      SELECT r.response_count,(SELECT COUNT(*) FROM family_alignment_responses f WHERE f.room_id=r.id) AS actual_count
        FROM family_alignment_rooms r WHERE r.id=${sqlLiteral(mainV2Room.id)};
    `))[0];
    assert.equal(Number(racedState.response_count), Number(racedState.actual_count));
    assert.equal(Number(racedState.actual_count), racedWrite.response.status === 201 ? 1 : 0);
    const postRaceWrite = await submitResponse(server.origin, mainV2Token, raceReceipt, {
      role: "parent", preference: "B", confidence: "low", reasons: ["budget"],
    });
    assert.equal(postRaceWrite.response.status, 410);
    await liveExecute(
      server,
      `DELETE FROM family_alignment_responses WHERE room_id=${sqlLiteral(mainV2Room.id)};`,
      "race fixture cleanup failed",
    );

    const concurrent = await createDecision(server.origin, owner, "CONCURRENT", [41, 63], "Pune");
    const idemMismatch = await createRoom(server.origin, owner, concurrent, "family-main-create");
    assert.equal(idemMismatch.response.status, 409);
    assert.equal(idemMismatch.payload.code, "idempotency_conflict");
    const concurrentCreated = await createRoom(server.origin, owner, concurrent, "family-concurrent-create");
    assert.equal(concurrentCreated.response.status, 201);
    const concurrentRoom = concurrentCreated.payload.room;
    const concurrentToken = roomToken(concurrentRoom);
    const concurrentReceipts = Array.from({ length: 6 }, () => responseToken());
    const concurrentWrites = await Promise.all(concurrentReceipts.map((receipt, index) => submitResponse(
      server.origin,
      concurrentToken,
      receipt,
      { role: "sibling", preference: index % 2 ? "B" : "A", confidence: "medium", reasons: ["space"] },
    )));
    assert.equal(concurrentWrites.filter((result) => result.response.status === 201).length, 5);
    assert.equal(concurrentWrites.filter((result) => result.response.status === 409 && result.payload.code === "family_alignment_full").length, 1);

    const active = await createDecision(server.origin, owner, "ACTIVE", [43, 67], "Chennai");
    const activeCreated = await createRoom(server.origin, owner, active, "family-active-create");
    assert.equal(activeCreated.response.status, 201);
    const activeRoom = activeCreated.payload.room;
    const activeToken = roomToken(activeRoom);
    const recentRevoked = await createDecision(server.origin, owner, "RECENT", [47, 71], "Hyderabad");
    const recentCreated = await createRoom(server.origin, owner, recentRevoked, "family-recent-create");
    assert.equal(recentCreated.response.status, 201);
    const recentRoom = recentCreated.payload.room;
    const recentToken = roomToken(recentRoom);
    const recentResponse = await submitResponse(server.origin, recentToken, responseToken(), {
      role: "parent", preference: "not_ready", confidence: "low", reasons: ["budget"],
    });
    assert.equal(recentResponse.response.status, 201);
    const recentRevoke = await call(server.origin, `/api/projects/${recentRevoked.project.id}/family-alignment/${recentRoom.id}`, {
      method: "DELETE",
      auth: owner,
    });
    assert.equal(recentRevoke.response.status, 204);

    // Normal account lifecycle must not be trapped by the room's project
    // CASCADE plus comparison RESTRICT relationship. With no order/file
    // evidence, deleting the owner project removes its comparison, room and
    // anonymous response in the same real-D1 cascade.
    const deletable = await createDecision(server.origin, owner, "DELETABLE", [49, 73], "Other");
    const deletableCreated = await createRoom(server.origin, owner, deletable, "family-deletable-create");
    assert.equal(deletableCreated.response.status, 201);
    const deletableRoom = deletableCreated.payload.room;
    const deletableToken = roomToken(deletableRoom);
    // Exercise the maximum child-cardinality cascade. A single response can
    // mask response-count trigger ordering bugs that appear only after the
    // first child has already decremented the parent counter.
    for (let index = 0; index < 5; index += 1) {
      const deletableResponse = await submitResponse(server.origin, deletableToken, responseToken(), {
        role: "advisor",
        preference: index % 2 ? "B" : "A",
        confidence: "medium",
        reasons: ["accessibility"],
      });
      assert.equal(deletableResponse.response.status, 201);
    }
    const deletedProject = await call(server.origin, `/api/projects/${deletable.project.id}`, { method: "DELETE", auth: owner });
    assert.equal(deletedProject.response.status, 204, JSON.stringify(deletedProject.payload));
    const deletedRows = (await liveQuery(server, `
      SELECT
        (SELECT COUNT(*) FROM projects WHERE id=${sqlLiteral(deletable.project.id)}) AS project_count,
        (SELECT COUNT(*) FROM decision_comparisons WHERE id=${sqlLiteral(deletable.comparison.id)}) AS comparison_count,
        (SELECT COUNT(*) FROM family_alignment_rooms WHERE id=${sqlLiteral(deletableRoom.id)}) AS room_count,
        (SELECT COUNT(*) FROM family_alignment_responses WHERE room_id=${sqlLiteral(deletableRoom.id)}) AS response_count;
    `))[0];
    assert.deepEqual(deletedRows, { project_count: 0, comparison_count: 0, room_count: 0, response_count: 0 });

    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;

    const postRevokeMutation = d1(
      stateDirectory,
      "execute",
      `UPDATE family_alignment_responses SET preference='A' WHERE room_id=${sqlLiteral(mainRoom.id)};`,
    );
    assert.notEqual(postRevokeMutation.status, 0, "D1 must reject a response mutation after revocation");
    assert.match(`${postRevokeMutation.stdout}\n${postRevokeMutation.stderr}`, /not editable/iu);
    const immutableRoom = d1(
      stateDirectory,
      "execute",
      `UPDATE family_alignment_rooms SET comparison_version=comparison_version+1 WHERE id=${sqlLiteral(mainRoom.id)};`,
    );
    assert.notEqual(immutableRoom.status, 0, "D1 must reject room identity mutation");
    assert.match(`${immutableRoom.stdout}\n${immutableRoom.stderr}`, /immutable/iu);

    requireD1Success(d1(
      stateDirectory,
      "execute",
      `UPDATE family_alignment_rooms SET revoked_at=datetime('now','-91 days') WHERE id=${sqlLiteral(mainRoom.id)};
       DROP TRIGGER family_alignment_room_identity_immutable;
       UPDATE family_alignment_rooms SET expires_at=datetime('now','-91 days') WHERE id=${sqlLiteral(concurrentRoom.id)};`,
    ), "aging retention fixtures failed");
    const postExpiryMutation = d1(
      stateDirectory,
      "execute",
      `UPDATE family_alignment_responses SET confidence='high' WHERE room_id=${sqlLiteral(concurrentRoom.id)};`,
    );
    assert.notEqual(postExpiryMutation.status, 0, "D1 must reject a response mutation after expiry");
    assert.match(`${postExpiryMutation.stdout}\n${postExpiryMutation.stderr}`, /not editable/iu);

    const beforeRetention = query(stateDirectory, `
      SELECT
        (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM decision_comparisons) AS comparisons,
        (SELECT COUNT(*) FROM decision_selections) AS selections,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM family_alignment_rooms) AS rooms,
        (SELECT COUNT(*) FROM family_alignment_responses) AS responses;
    `)[0];
    assert.deepEqual(
      [Number(beforeRetention.projects), Number(beforeRetention.comparisons), Number(beforeRetention.selections), Number(beforeRetention.orders), Number(beforeRetention.rooms)],
      [4, 5, 1, 0, 5],
    );
    assert.equal(query(
      stateDirectory,
      "SELECT COUNT(*) AS count FROM family_alignment_rooms WHERE expires_at<datetime('now','-90 days') OR (revoked_at IS NOT NULL AND revoked_at<datetime('now','-90 days'));",
    )[0].count, 2);

    server = await startWorker(stateDirectory, assetsDirectory, port);
    const expiredRead = await readRoom(server.origin, concurrentToken);
    assert.equal(expiredRead.response.status, 410);
    assert.equal(expiredRead.payload.code, "family_alignment_expired");
    const activeRead = await readRoom(server.origin, activeToken);
    assert.equal(activeRead.response.status, 200);
    const recentClosedRead = await readRoom(server.origin, recentToken);
    assert.equal(recentClosedRead.response.status, 410);

    const scheduled = await fetch(`${server.origin}/__scheduled?cron=17+2+*+*+*`);
    assert.equal(scheduled.status, 200);
    const scheduledBody = await scheduled.text();
    const cleanupDeadline = Date.now() + 10_000;
    while (Date.now() < cleanupDeadline) {
      const remaining = await liveQuery(server, "SELECT COUNT(*) AS count FROM family_alignment_rooms;");
      if (Number(remaining[0].count) === 3) break;
      await wait(250);
    }
    capturedLogs.push(server.logs());
    await stopWorker(server);
    server = null;

    const afterRetention = query(stateDirectory, `
      SELECT
        (SELECT COUNT(*) FROM projects) AS projects,
        (SELECT COUNT(*) FROM decision_comparisons) AS comparisons,
        (SELECT COUNT(*) FROM decision_selections) AS selections,
        (SELECT COUNT(*) FROM orders) AS orders,
        (SELECT COUNT(*) FROM family_alignment_rooms) AS rooms,
        (SELECT COUNT(*) FROM family_alignment_responses) AS responses,
        (SELECT COUNT(*) FROM family_alignment_rooms WHERE id=${sqlLiteral(activeRoom.id)}) AS active_room,
        (SELECT COUNT(*) FROM family_alignment_rooms WHERE id=${sqlLiteral(recentRoom.id)}) AS recent_revoked_room;
    `)[0];
    assert.deepEqual(
      [Number(afterRetention.projects), Number(afterRetention.comparisons), Number(afterRetention.selections), Number(afterRetention.orders)],
      [4, 5, 1, 0],
    );
    assert.equal(Number(afterRetention.rooms), 3, `scheduled response: ${scheduledBody}\n${capturedLogs.at(-1) || ""}`);
    assert.equal(Number(afterRetention.responses), 1);
    assert.equal(Number(afterRetention.active_room), 1);
    assert.equal(Number(afterRetention.recent_revoked_room), 1);

    const storedSecrets = query(stateDirectory, "SELECT token_hash FROM family_alignment_rooms UNION ALL SELECT receipt_hash FROM family_alignment_responses;");
    assert.ok(storedSecrets.length > 0);
    for (const row of storedSecrets) assert.match(row.token_hash, /^[a-f0-9]{64}$/u);
    const allLogs = capturedLogs.join("\n");
    // Local Wrangler prints a development request access line with the raw URL.
    // Production/staging invocation logging is statically forced off by the
    // operational configuration gate, so inspect only Worker-owned logs here.
    const applicationLogs = allLogs
      .split(/\r?\n/u)
      .filter((line) => line.includes('"type":"request_complete"') || line.includes("Family Alignment aggregate recording failed"))
      .join("\n");
    assert.match(applicationLogs, /Family Alignment aggregate recording failed/u);
    for (const secret of [
      mainToken, malformedBearer, legacyToken, legacyReceipt, mainV2Token, raceReceipt,
      concurrentToken, activeToken, recentToken, ...receipts, ...concurrentReceipts,
    ]) {
      assert.equal(applicationLogs.includes(secret), false, `raw Family Alignment bearer material entered Worker logs: ${secret}`);
    }
    for (const privateValue of main.privateValues) assert.equal(applicationLogs.includes(privateValue), false);
    assert.equal(applicationLogs.includes("PRIVATE_FREE_TEXT_DO_NOT_STORE"), false);
    assert.match(applicationLogs, /"route":"\/api\/shared\/family-alignment"/u);
    assert.match(applicationLogs, /"route":"\/api\/shared\/family-alignment\/response"/u);
    assert.match(applicationLogs, /"route":"\/api\/family-alignment\/:token"/u);
    assert.match(applicationLogs, /"route":"\/api\/family-alignment\/:token\/response"/u);
    assert.match(applicationLogs, /"route":"\/api\/projects\/:projectId\/family-alignment\/:roomId"/u);
  } finally {
    if (server) capturedLogs.push(server.logs());
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
