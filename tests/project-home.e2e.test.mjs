import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const wranglerCli = path.join(root, "node_modules", "wrangler", "bin", "wrangler.js");
const webhookSecret = "project-home-e2e-webhook-secret";

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
  return `${current}${String(chunk)}`.slice(-80_000);
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
    "DECISION_COMPARE_FULFILLMENT_ENABLED:true",
    "--var",
    "ENABLED_PAYMENT_PLANS:",
    "--var",
    `RAZORPAY_WEBHOOK_SECRET:${webhookSecret}`,
    "--var",
    "GEMINI_API_KEY:",
  ];
  const child = spawn(process.execPath, [wranglerCli, ...args], {
    cwd: root,
    // Suppress Wrangler's raw request summaries so log assertions cover only
    // the Worker's templated completion records.
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

function databaseSnapshot(stateDirectory) {
  const tables = [
    "users",
    "sessions",
    "projects",
    "leads",
    "reports",
    "project_files",
    "ai_planning_briefs",
    "ai_generation_counters",
    "ai_generation_leases",
    "decision_comparisons",
    "decision_selections",
    "family_alignment_rooms",
    "family_alignment_responses",
    "orders",
    "purchased_report_snapshots",
    "purchased_decision_snapshots",
    "order_fulfillments",
    "decision_shares",
    "decision_progress",
    "product_event_aggregates",
    "payment_webhook_events",
    "payment_terminal_records",
    "payment_reconciliation_cases",
  ];
  const sql = tables.map((table) => `SELECT * FROM ${table} ORDER BY 1,2,3,4`).join(";");
  const result = requireD1Success(d1(stateDirectory, "query", sql), "D1 snapshot query failed");
  const statements = JSON.parse(result.stdout);
  return tables.map((table, index) => ({ table, rows: statements[index]?.results || [] }));
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

async function call(origin, pathname, { method = "GET", body, auth, headers = {} } = {}) {
  const requestHeaders = new Headers(headers);
  if (body !== undefined) requestHeaders.set("content-type", "application/json");
  if (auth) {
    requestHeaders.set("cookie", auth.cookie);
    requestHeaders.set("x-csrf-token", auth.csrf);
  }
  if (!["GET", "HEAD"].includes(method)) requestHeaders.set("origin", origin);
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
      name: `Project Home owner ${suffix}`,
      email: `project-home-${suffix}@example.test`,
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

function assertNoInternalKeys(value) {
  const forbidden = new Set([
    "userid", "user_id", "input_json", "estimate_json", "content_json", "reasons_json",
    "passwordhash", "password_hash", "passwordsalt", "password_salt", "csrfhash", "csrf_hash",
    "token", "tokenhash", "token_hash", "receipthash", "receipt_hash", "idempotencykey",
    "idempotency_key", "requesthash", "request_hash", "artifactjson", "artifact_json", "usagejson",
    "usage_json", "objectkey", "object_key", "providerinteractionid", "provider_interaction_id",
    "providerpaymentid", "provider_payment_id", "providercheckoutorderid", "provider_checkout_order_id",
    "checkouturl", "checkout_url", "responses", "receipts",
  ]);
  function visit(current) {
    if (!current || typeof current !== "object") return;
    for (const [key, child] of Object.entries(current)) {
      assert.equal(forbidden.has(key.toLowerCase()), false, `Project Home contains forbidden field ${key}`);
      assert.equal(key.toLowerCase().endsWith("hash"), false, `Project Home contains internal hash field ${key}`);
      visit(child);
    }
  }
  visit(value);
}

function assertHomeEnvelope(home, projectId, expected) {
  assert.deepEqual(Object.keys(home).sort(), ["counts", "current", "lifecycle", "project"]);
  assert.equal(home.project.id, projectId);
  assert.deepEqual(
    Object.keys(home.lifecycle).sort(),
    ["completedCoreSteps", "nextAction", "stage", "state", "steps", "totalCoreSteps"].sort(),
  );
  assert.equal(home.lifecycle.state, expected.state || "active");
  assert.equal(home.lifecycle.stage, expected.stage);
  assert.equal(home.lifecycle.completedCoreSteps, expected.completed);
  assert.equal(home.lifecycle.totalCoreSteps, 3);
  assert.deepEqual(home.lifecycle.steps.map((step) => step.id), ["feasibility", "comparison", "family", "direction"]);
  assert.equal(home.lifecycle.nextAction.code, expected.action);
  assert.equal(home.lifecycle.nextAction.target, expected.target);
  assert.equal(typeof home.lifecycle.nextAction.label, "string");
  assert.ok(home.lifecycle.nextAction.label.length > 0);
  assert.equal(typeof home.lifecycle.nextAction.description, "string");
  assert.ok(home.lifecycle.nextAction.description.length > 0);
  assert.deepEqual(
    Object.keys(home.current).sort(),
    ["aiBrief", "comparison", "family", "feasibility", "purchase", "selection"].sort(),
  );
  const projectionKeys = {
    feasibility: ["available", "current", "generatedAt", "version"],
    aiBrief: ["available", "current", "generatedAt", "model"],
    comparison: ["available", "createdAt", "current", "id", "projectInputRevision", "version"],
    selection: ["available", "key", "label", "lockedAt", "scenarioId", "selectedAt"],
    family: ["active", "available", "current", "expiresAt", "maxResponses", "preferences", "responseCount", "roomId", "status"],
    purchase: ["available", "current", "entitlementActive", "fulfillmentStatus", "orderId", "status"],
  };
  for (const [key, projection] of Object.entries(home.current)) {
    assert.ok(projection && typeof projection === "object" && !Array.isArray(projection), `${key} projection must always be an object`);
    assert.deepEqual(Object.keys(projection).sort(), projectionKeys[key].sort(), `${key} projection drifted from its allowlist`);
    assert.equal(typeof projection.available, "boolean", `${key}.available must be a boolean`);
  }
  assert.deepEqual(Object.keys(home.counts).sort(), ["comparisons", "familyRooms", "orders", "purchasedArtifacts", "revisions"]);
  for (const value of Object.values(home.counts)) {
    assert.equal(Number.isSafeInteger(value) && value >= 0, true, "history counts must be non-negative integers");
  }
  assertNoInternalKeys(home);
}

async function createProject(origin, auth) {
  const result = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    body: {
      name: "PROJECT_HOME_PRIVATE_NAME",
      input: {
        width: 33,
        length: 57,
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        quality: "Signature",
        city: "Pune",
      },
    },
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
        { label: "Courtyard core", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "PROJECT_HOME_PRIVATE_NOTE_A" },
        { label: "Future floor", floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: "PROJECT_HOME_PRIVATE_NOTE_B" },
      ],
    },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return result.payload.comparison;
}

function seedOrderSql({ orderId, projectId, userId, comparison, selectedScenarioId }) {
  const createdAt = "2026-08-14 00:00:00";
  const artifact = {
    ...comparison,
    selectedScenarioId,
    selection: { scenarioId: selectedScenarioId, selectedAt: createdAt, lockedAt: createdAt },
    purchasedAt: createdAt,
  };
  const values = [
    orderId,
    projectId,
    userId,
    "plan",
    "decision_compare",
    99_900,
    "INR",
    "plink_PROJECT_HOME",
    null,
    "project-home-e2e-order",
    "created",
    createdAt,
    createdAt,
    "https://rzp.io/i/PROJECT_HOME",
    "created",
    null,
    null,
    "order_PROJECT_HOME",
    null,
    null,
    "pilot-v1",
    createdAt,
  ];
  const snapshotValues = [
    "snapshot-PROJECT-HOME",
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
  return `
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
    VALUES (${values.map(sqlLiteral).join(",")});
    INSERT INTO purchased_decision_snapshots
      (id,order_id,project_id,user_id,comparison_id,selected_scenario_id,
       snapshot_schema_version,content_hash,artifact_json,created_at)
    VALUES (${snapshotValues.map(sqlLiteral).join(",")});
  `;
}

function paymentPayload(orderId) {
  return {
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_PROJECT_HOME", order_id: "order_PROJECT_HOME", reference_id: orderId, status: "paid", amount_paid: 99_900, currency: "INR" } },
      payment: { entity: { id: "pay_PROJECT_HOME", order_id: "order_PROJECT_HOME", status: "captured", captured: true, amount: 99_900, currency: "INR" } },
    },
  };
}

async function signedWebhook(origin, eventId, payload) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", webhookSecret).update(raw).digest("hex");
  const response = await fetch(`${origin}/api/payments/razorpay/webhook`, {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": eventId, "content-type": "application/json" },
    body: raw,
  });
  return { response, payload: await response.json() };
}

test("Project Decision Home is owner-only, zero-write, lifecycle-correct, and paid-history safe in real D1", { timeout: 180_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-project-home-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  const port = await reservePort();
  let server = null;
  const capturedCompletionLogs = [];
  try {
    requireD1Success(d1(stateDirectory, "migrate"), "fresh migrations failed");
    server = await startWorker(stateDirectory, assetsDirectory, port);
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.checks.archiveSafetySchema, "current");
    assert.equal(readiness.payload.capabilities.paidCheckout, false);

    const owner = await register(server.origin, "owner");
    const other = await register(server.origin, "other");
    const project = await createProject(server.origin, owner);
    const homePath = `/api/projects/${project.id}/home`;

    const anonymous = await call(server.origin, homePath);
    assert.equal(anonymous.response.status, 401);
    const foreign = await call(server.origin, homePath, { auth: other });
    assert.equal(foreign.response.status, 404);
    assert.equal(foreign.payload.code, "project_not_found");
    const missing = await call(server.origin, "/api/projects/00000000-0000-4000-8000-000000000000/home", { auth: owner });
    assert.equal(missing.response.status, 404);
    assert.equal(missing.payload.code, "project_not_found");

    let homeResult = await call(server.origin, homePath, { auth: owner });
    assert.equal(homeResult.response.status, 200, JSON.stringify(homeResult.payload));
    assert.equal(homeResult.response.headers.get("cache-control"), "no-store");
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "feasibility_pending", completed: 0, action: "open_feasibility", target: "report",
    });
    assert.equal(homeResult.payload.current.feasibility.available, false);
    assert.equal(homeResult.payload.current.comparison.available, false);

    const report = await call(server.origin, `/api/projects/${project.id}/report`, { method: "POST", auth: owner, body: {} });
    assert.equal(report.response.status, 201, JSON.stringify(report.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "comparison_pending", completed: 1, action: "start_comparison", target: "compare",
    });
    assert.equal(homeResult.payload.current.feasibility.available, true);
    assert.equal(homeResult.payload.current.comparison.available, false);

    const comparison = await createComparison(server.origin, owner, project.id);
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "direction_pending", completed: 2, action: "choose_direction", target: "compare",
    });
    assert.equal(homeResult.payload.current.comparison.available, true);
    assert.equal(homeResult.payload.current.comparison.current, true);
    assert.equal(homeResult.payload.current.selection.available, false);
    const serializedComparisonHome = JSON.stringify(homeResult.payload);
    assert.equal(serializedComparisonHome.includes("PROJECT_HOME_PRIVATE_NOTE_A"), false);
    assert.equal(serializedComparisonHome.includes("PROJECT_HOME_PRIVATE_NOTE_B"), false);

    const selectedScenarioId = comparison.scenarios[1].id;
    const selected = await call(server.origin, `/api/projects/${project.id}/decision-compare/choice`, {
      method: "POST",
      auth: owner,
      body: { scenarioId: selectedScenarioId },
    });
    assert.equal(selected.response.status, 201, JSON.stringify(selected.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "decision_ready", completed: 3, action: "open_handoff", target: "compare",
    });
    assert.equal(homeResult.payload.current.selection.available, true);
    assert.equal(homeResult.payload.current.selection.scenarioId, selectedScenarioId);

    const roomCreated = await call(server.origin, `/api/projects/${project.id}/family-alignment`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "project-home-family-room" },
      body: { comparisonId: comparison.id },
    });
    assert.equal(roomCreated.response.status, 201, JSON.stringify(roomCreated.payload));
    const roomToken = roomCreated.payload.room.url.split("/").at(-1);
    const responseReceipt = randomBytes(32).toString("base64url");
    const familyResponse = await call(server.origin, `/api/family-alignment/${roomToken}/response`, {
      method: "PUT",
      headers: { "x-family-response-token": responseReceipt },
      body: { role: "spouse", preference: "B", confidence: "high", reasons: ["space", "future_expansion"] },
    });
    assert.equal(familyResponse.response.status, 201, JSON.stringify(familyResponse.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "decision_ready", completed: 3, action: "open_handoff", target: "compare",
    });
    assert.equal(homeResult.payload.current.family.available, true);
    const serializedFamilyHome = JSON.stringify(homeResult.payload);
    assert.equal(serializedFamilyHome.includes(roomToken), false, "Family bearer token must not reach Project Home");
    assert.equal(serializedFamilyHome.includes(responseReceipt), false, "Family response receipt must not reach Project Home");

    capturedCompletionLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const beforeRepeatedReads = databaseSnapshot(stateDirectory);
    server = await startWorker(stateDirectory, assetsDirectory, port);
    for (let index = 0; index < 3; index += 1) {
      const repeated = await call(server.origin, homePath, { auth: owner });
      assert.equal(repeated.response.status, 200, JSON.stringify(repeated.payload));
      assert.equal(repeated.payload.lifecycle.stage, "decision_ready");
    }
    capturedCompletionLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const afterRepeatedReads = databaseSnapshot(stateDirectory);
    assert.deepEqual(afterRepeatedReads, beforeRepeatedReads, "repeated Project Home GETs must make zero D1 writes");

    const orderId = "project-home-order";
    requireD1Success(d1(stateDirectory, "execute", seedOrderSql({
      orderId,
      projectId: project.id,
      userId: owner.user.id,
      comparison,
      selectedScenarioId,
    })), "seeding exact-comparison purchase failed");
    server = await startWorker(stateDirectory, assetsDirectory, port);
    const captured = await signedWebhook(server.origin, "evt_project_home_paid", paymentPayload(orderId));
    assert.equal(captured.response.status, 200, JSON.stringify(captured.payload));
    assert.equal(captured.payload.result, "paid");
    homeResult = await call(server.origin, homePath, { auth: owner });
    assert.equal(homeResult.response.status, 200, JSON.stringify(homeResult.payload));
    assert.equal(homeResult.payload.current.purchase.available, true);
    assert.equal(homeResult.payload.current.purchase.orderId, orderId);
    const serializedPaidHome = JSON.stringify(homeResult.payload);
    for (const providerCanary of [
      "plink_PROJECT_HOME",
      "order_PROJECT_HOME",
      "pay_PROJECT_HOME",
      "https://rzp.io/i/PROJECT_HOME",
    ]) {
      assert.equal(serializedPaidHome.includes(providerCanary), false, `provider canary ${providerCanary} must not reach Project Home`);
    }

    const refunded = await signedWebhook(server.origin, "evt_project_home_refund", {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_PROJECT_HOME", payment_id: "pay_PROJECT_HOME", amount: 99_900, currency: "INR", status: "processed" } } },
    });
    assert.equal(refunded.response.status, 200, JSON.stringify(refunded.payload));
    assert.equal(refunded.payload.result, "refunded");
    homeResult = await call(server.origin, homePath, { auth: owner });
    assert.equal(homeResult.payload.current.purchase.available, false);
    const refundedOrder = await call(server.origin, `/api/orders/${orderId}`, { auth: owner });
    assert.equal(refundedOrder.payload.order.status, "refunded");
    assert.equal(refundedOrder.payload.order.entitlement.active, false);

    const revised = await call(server.origin, `/api/projects/${project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { input: { bathrooms: 4 }, expectedInputRevision: 1 },
    });
    assert.equal(revised.response.status, 200, JSON.stringify(revised.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "feasibility_pending", completed: 0, action: "open_feasibility", target: "report",
    });
    assert.equal(homeResult.payload.current.comparison.available, true);
    assert.equal(homeResult.payload.current.comparison.current, false);
    assert.equal(homeResult.payload.current.selection.available, false);
    assert.equal(homeResult.payload.current.family.available, false);
    assert.equal(homeResult.payload.current.purchase.available, false);

    const revisedReport = await call(server.origin, `/api/projects/${project.id}/report`, { method: "POST", auth: owner, body: {} });
    assert.equal(revisedReport.response.status, 201, JSON.stringify(revisedReport.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      stage: "comparison_stale", completed: 1, action: "recalculate_comparison", target: "compare",
    });
    assert.equal(homeResult.payload.current.comparison.available, true);
    assert.equal(homeResult.payload.current.comparison.current, false);

    const archived = await call(server.origin, `/api/projects/${project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { status: "archived" },
    });
    assert.equal(archived.response.status, 200, JSON.stringify(archived.payload));
    homeResult = await call(server.origin, homePath, { auth: owner });
    assertHomeEnvelope(homeResult.payload, project.id, {
      state: "archived", stage: "archived", completed: 1, action: "view_archived", target: "dashboard",
    });
    assert.equal(homeResult.payload.current.comparison.available, true);
    assert.equal(homeResult.payload.current.family.active, false, "archiving closes the current Family room");

    const projectWithFile = await createProject(server.origin, owner);
    capturedCompletionLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    requireD1Success(d1(stateDirectory, "execute", `
      INSERT INTO project_files
        (id,project_id,user_id,object_key,file_name,content_type,size_bytes,kind,checksum_sha256,created_at)
      VALUES
        ('project-home-private-file',${sqlLiteral(projectWithFile.id)},${sqlLiteral(owner.user.id)},
         'users/owner/projects/file','private-plan.pdf','application/pdf',128,'document',
         'project_home_file_checksum','2026-08-14 00:00:00');
    `), "seeding a private-file deletion guard failed");
    const beforeArchivedWriteAttempts = databaseSnapshot(stateDirectory);
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const blockedChoice = await call(server.origin, `/api/projects/${project.id}/decision-compare/choice`, {
      method: "POST",
      auth: owner,
      body: { scenarioId: selectedScenarioId },
    });
    assert.equal(blockedChoice.response.status, 409, JSON.stringify(blockedChoice.payload));
    assert.equal(blockedChoice.payload.code, "project_archived");

    const archivedComparisonRead = await call(server.origin, `/api/projects/${project.id}/decision-compare`, { auth: owner });
    assert.equal(archivedComparisonRead.response.status, 200, JSON.stringify(archivedComparisonRead.payload));
    assert.equal(archivedComparisonRead.payload.comparison.current, false);
    assert.equal(archivedComparisonRead.payload.comparison.stale, true);

    const blockedComparison = await call(server.origin, `/api/projects/${project.id}/decision-compare`, {
      method: "PUT",
      auth: owner,
      body: {
        priority: "balanced",
        scenarios: [
          { label: "Archived A", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "" },
          { label: "Archived B", floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: "" },
        ],
      },
    });
    assert.equal(blockedComparison.response.status, 409, JSON.stringify(blockedComparison.payload));
    assert.equal(blockedComparison.payload.code, "project_archived");

    const blockedUpload = await call(server.origin, `/api/projects/${project.id}/files`, {
      method: "POST",
      auth: owner,
      body: { name: "must-not-be-read.pdf" },
    });
    assert.equal(blockedUpload.response.status, 409, JSON.stringify(blockedUpload.payload));
    assert.equal(blockedUpload.payload.code, "project_archived");

    const blockedShare = await call(server.origin, `/api/projects/${project.id}/decision-compare/shares`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "archived-project-share" },
      body: { orderId, expiresInDays: 7 },
    });
    assert.equal(blockedShare.response.status, 409, JSON.stringify(blockedShare.payload));
    assert.equal(blockedShare.payload.code, "project_archived");

    const blockedRoom = await call(server.origin, `/api/projects/${project.id}/family-alignment`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "archived-project-family-room" },
      body: { comparisonId: comparison.id },
    });
    assert.equal(blockedRoom.response.status, 409, JSON.stringify(blockedRoom.payload));
    assert.equal(blockedRoom.payload.code, "project_archived");

    const blockedProjectEdit = await call(server.origin, `/api/projects/${project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { name: "ARCHIVED_PROJECT_MUST_NOT_CHANGE" },
    });
    assert.equal(blockedProjectEdit.response.status, 409, JSON.stringify(blockedProjectEdit.payload));
    assert.equal(blockedProjectEdit.payload.code, "project_archived");

    const archivedFamilyRead = await call(server.origin, `/api/family-alignment/${roomToken}`);
    assert.equal(archivedFamilyRead.response.status, 410, JSON.stringify(archivedFamilyRead.payload));
    const archivedFamilyWrite = await call(server.origin, `/api/family-alignment/${roomToken}/response`, {
      method: "PUT",
      headers: { "x-family-response-token": responseReceipt },
      body: { role: "spouse", preference: "A", confidence: "medium", reasons: ["budget"] },
    });
    assert.equal(archivedFamilyWrite.response.status, 410, JSON.stringify(archivedFamilyWrite.payload));

    const guardedFileProjectDelete = await call(server.origin, `/api/projects/${projectWithFile.id}`, {
      method: "DELETE",
      auth: owner,
      body: {},
    });
    assert.equal(guardedFileProjectDelete.response.status, 409, JSON.stringify(guardedFileProjectDelete.payload));
    assert.equal(guardedFileProjectDelete.payload.code, "project_has_files");
    const retainedFileProject = await call(server.origin, `/api/projects/${projectWithFile.id}`, { auth: owner });
    assert.equal(retainedFileProject.response.status, 200, JSON.stringify(retainedFileProject.payload));

    capturedCompletionLogs.push(server.logs());
    await stopWorker(server);
    server = null;

    for (const [label, sql] of [
      ["comparison insert", `
        INSERT INTO decision_comparisons
          (id,project_id,user_id,version,priority,content_hash,content_json,created_at,project_input_revision)
        VALUES ('archived-race-comparison',${sqlLiteral(project.id)},${sqlLiteral(owner.user.id)},99,
                'balanced','${"a".repeat(64)}','{}','2026-08-14 00:00:01',2)
      `],
      ["selection update", `
        UPDATE decision_selections SET selected_at=selected_at
         WHERE project_id=${sqlLiteral(project.id)}
      `],
      ["report update", `
        UPDATE reports SET updated_at='2026-08-14 00:00:03'
         WHERE project_id=${sqlLiteral(project.id)}
      `],
      ["file insert", `
        INSERT INTO project_files
          (id,project_id,user_id,object_key,file_name,content_type,size_bytes,kind,checksum_sha256,created_at)
        VALUES ('archived-race-file',${sqlLiteral(project.id)},${sqlLiteral(owner.user.id)},
                'must-not-exist','blocked.pdf','application/pdf',64,'document','blocked','2026-08-14 00:00:04')
      `],
    ]) {
      const fenced = d1(stateDirectory, "execute", sql);
      assert.notEqual(fenced.status, 0, `${label} unexpectedly bypassed the archived-project D1 fence`);
      assert.match(`${fenced.stdout}\n${fenced.stderr}`, /archived project is read only/iu, `${label} failed for the wrong reason`);
    }

    const afterArchivedWriteAttempts = databaseSnapshot(stateDirectory);
    assert.deepEqual(
      afterArchivedWriteAttempts,
      beforeArchivedWriteAttempts,
      "archived write attempts and a guarded file-project delete must make zero D1 writes",
    );
    server = await startWorker(stateDirectory, assetsDirectory, port);

    const nonGet = await call(server.origin, homePath, { method: "POST", auth: owner, body: {} });
    assert.equal(nonGet.response.status, 405);
    assert.equal(nonGet.response.headers.get("allow"), "GET");
    const malformedDecodable = await call(server.origin, "/api/projects/%25ZZ/home", { auth: owner });
    assert.equal(malformedDecodable.response.status, 404);
    assert.equal(malformedDecodable.payload.code, "project_not_found");
    const malformedEscape = await call(server.origin, "/api/projects/%ZZ/home", { auth: owner });
    assert.notEqual(malformedEscape.response.status, 500, "malformed path escapes must not become scanner-induced 500s");
    const nested = await call(server.origin, `${homePath}/extra`, { auth: owner });
    assert.equal(nested.response.status, 404);
    assert.equal(nested.response.headers.get("content-type")?.includes("application/json"), true);

    await wait(200);
    capturedCompletionLogs.push(server.logs());
    await stopWorker(server);
    server = null;
    const completionLogs = capturedCompletionLogs
      .flatMap((value) => value.split("\n"))
      .filter((line) => line.includes('"type":"request_complete"'))
      .join("\n");
    assert.match(completionLogs, /"route":"\/api\/projects\/:projectId\/home"/u);
    assert.equal(completionLogs.includes(project.id), false, "operational logs must template the Project Home id");
    assert.equal(completionLogs.includes("PROJECT_HOME_PRIVATE_NAME"), false);
    assert.equal(completionLogs.includes("PROJECT_HOME_PRIVATE_NOTE"), false);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
