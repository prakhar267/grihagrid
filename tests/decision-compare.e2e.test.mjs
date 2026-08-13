import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const webhookSecret = "decision-e2e-webhook-secret";
const metricsToken = "decision-e2e-metrics-token-1234567890";

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
  return `${current}${String(chunk)}`.slice(-20_000);
}

async function startWorker({ stateDirectory, assetsDirectory, port, checkout, fulfillment, enabledPlans, paymentConfig = false }) {
  const args = [
    "--no-install",
    "wrangler",
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
    "error",
    "--show-interactive-dev-session=false",
    "--var",
    "APP_ENV:test",
    "--var",
    "APP_ORIGIN:https://app.example.test",
    "--var",
    `PAID_CHECKOUT_ENABLED:${checkout ? "true" : "false"}`,
    "--var",
    `DECISION_COMPARE_FULFILLMENT_ENABLED:${fulfillment ? "true" : "false"}`,
    "--var",
    `ENABLED_PAYMENT_PLANS:${enabledPlans}`,
    "--var",
    `RAZORPAY_KEY_ID:${paymentConfig ? "rzp_test_decision_e2e" : ""}`,
    "--var",
    `RAZORPAY_KEY_SECRET:${paymentConfig ? "decision-e2e-provider-secret" : ""}`,
    "--var",
    `RAZORPAY_WEBHOOK_SECRET:${webhookSecret}`,
    "--var",
    "GEMINI_API_KEY:",
    "--var",
    `METRICS_READ_TOKEN:${metricsToken}`,
  ];
  const child = spawn(npx, args, {
    cwd: root,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  child.stdout.on("data", (chunk) => { logs = appendLog(logs, chunk); });
  child.stderr.on("data", (chunk) => { logs = appendLog(logs, chunk); });
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 25_000;
  while (Date.now() < deadline) {
    const earlyExit = await Promise.race([exited, wait(100).then(() => null)]);
    if (earlyExit) throw new Error(`wrangler dev exited before readiness (${JSON.stringify(earlyExit)}):\n${logs}`);
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.status === 200) {
        await response.body?.cancel();
        return { child, exited, origin, logs: () => logs };
      }
      await response.body?.cancel();
    } catch {
      // The local socket is expected to refuse connections while workerd boots.
    }
  }
  throw new Error(`wrangler dev did not become ready:\n${logs}`);
}

async function stopWorker(server) {
  if (!server?.child || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  const graceful = await Promise.race([server.exited.then(() => true), wait(5_000).then(() => false)]);
  if (!graceful && server.child.exitCode === null) {
    server.child.kill("SIGKILL");
    await Promise.race([server.exited, wait(2_000)]);
  }
}

function wranglerD1(stateDirectory, action, sql = null) {
  const args = ["--no-install", "wrangler", "d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", sql);
  }
  return spawnSync(npx, args, {
    cwd: root,
    env: { ...process.env, CI: "true" },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

function sqlLiteral(value) {
  if (value == null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

function seedOrderSql({ orderId, projectId, userId, comparison, selectedScenarioId, suffix, failedProviderless = false }) {
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
    failedProviderless ? null : `plink_${suffix}`,
    null,
    `decision-e2e-${suffix}`,
    failedProviderless ? "failed" : "created",
    createdAt,
    createdAt,
    failedProviderless ? null : `https://rzp.io/i/${suffix}`,
    failedProviderless ? "request_failed" : "created",
    failedProviderless ? "network_error" : null,
    null,
    failedProviderless ? null : `order_${suffix}`,
    null,
    null,
    "pilot-v1",
    createdAt,
  ];
  const snapshotValues = [
    `snapshot-${suffix}`,
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
       AND locked_at IS NULL
       AND EXISTS (
         SELECT 1
           FROM decision_comparisons c
           JOIN projects p ON p.id=c.project_id AND p.user_id=c.user_id
          WHERE c.id=decision_selections.comparison_id
            AND c.project_input_revision=p.input_revision
       );
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

function extractCookies(response, csrfToken) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  const combined = values.join(";");
  const session = /__Host-grihagrid_session=([^;,]+)/u.exec(combined)?.[1];
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

async function register(origin, number) {
  const result = await call(origin, "/api/auth/register", {
    method: "POST",
    body: { name: `Decision Owner ${number}`, email: `decision-owner-${number}@example.test`, password: "correct horse battery staple" },
  });
  assert.equal(result.response.status, 201, JSON.stringify(result.payload));
  return {
    user: result.payload.user,
    csrf: result.payload.csrfToken,
    cookie: extractCookies(result.response, result.payload.csrfToken),
  };
}

async function createDecision(origin, auth, suffix) {
  const projectResult = await call(origin, "/api/projects", {
    method: "POST",
    auth,
    body: {
      name: `Decision project ${suffix}`,
      input: {
        width: 30,
        length: 50,
        floors: "G+1",
        bedrooms: 3,
        bathrooms: 3,
        parking: true,
        quality: "Signature",
        city: "Bengaluru",
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
        { label: "Courtyard calm", floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "Protect daylight and a quiet centre." },
        { label: "Upper-floor room", floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: "Keep more garden at ground level." },
      ],
    },
  });
  assert.equal(comparisonResult.response.status, 201, JSON.stringify(comparisonResult.payload));
  const comparison = comparisonResult.payload.comparison;
  assert.equal(comparison.scenarios.length, 2);
  const initialScenarioId = comparison.scenarios[0].id;
  const selected = await call(origin, `/api/projects/${project.id}/decision-compare/choice`, {
    method: "POST",
    auth,
    body: { scenarioId: initialScenarioId },
  });
  assert.equal(selected.response.status, 201, JSON.stringify(selected.payload));
  assert.equal(selected.payload.selection.lockedAt, null);
  const selectedScenarioId = comparison.scenarios[1].id;
  const changed = await call(origin, `/api/projects/${project.id}/decision-compare/choice`, {
    method: "POST",
    auth,
    body: { scenarioId: selectedScenarioId },
  });
  assert.equal(changed.response.status, 200, JSON.stringify(changed.payload));
  assert.equal(changed.payload.selection.scenarioId, selectedScenarioId);
  assert.equal(changed.payload.selection.lockedAt, null);
  assert.equal(changed.payload.updated, true);
  const repeated = await call(origin, `/api/projects/${project.id}/decision-compare/choice`, {
    method: "POST",
    auth,
    body: { scenarioId: selectedScenarioId },
  });
  assert.equal(repeated.response.status, 200);
  assert.equal(repeated.payload.idempotentReplay, true);
  return { project, comparison, selectedScenarioId };
}

function paymentPayload({ orderId, suffix }) {
  return {
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: `plink_${suffix}`, order_id: `order_${suffix}`, reference_id: orderId, status: "paid", amount_paid: 99_900, currency: "INR" } },
      payment: { entity: { id: `pay_${suffix}`, order_id: `order_${suffix}`, status: "captured", captured: true, amount: 99_900, currency: "INR" } },
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

test("Decision Compare survives real D1 migrations, payment containment, sharing, refund, and dispute", { timeout: 120_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-decision-e2e-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory);
  const port = await reservePort();
  let server = null;
  try {
    const migrated = wranglerD1(stateDirectory, "migrate");
    assert.equal(migrated.status, 0, `${migrated.stdout}\n${migrated.stderr}`);

    // Checkout prerequisites are deliberately incomplete: consent validation
    // is exercised, but no outbound provider call can occur in this test.
    server = await startWorker({ stateDirectory, assetsDirectory, port, checkout: true, fulfillment: true, enabledPlans: "decision_compare" });
    const readiness = await call(server.origin, "/api/readiness");
    assert.equal(readiness.response.status, 200, JSON.stringify(readiness.payload));
    assert.equal(readiness.payload.checks.schema, "current");
    assert.equal(readiness.payload.checks.decisionSchema, "current");
    assert.equal(readiness.payload.capabilities.paidCheckout, false);

    const owner = await register(server.origin, 1);
    const other = await register(server.origin, 2);
    const first = await createDecision(server.origin, owner, "A");
    const second = await createDecision(server.origin, owner, "B");
    const failedDraft = await createDecision(server.origin, owner, "failed-providerless");
    const staleDraft = await createDecision(server.origin, owner, "stale-source");
    const raceDraft = await createDecision(server.origin, owner, "checkout-race");

    assert.equal(staleDraft.project.inputRevision, 1);
    const renameOnly = await call(server.origin, `/api/projects/${staleDraft.project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { name: "Renamed without source change" },
    });
    assert.equal(renameOnly.response.status, 200, JSON.stringify(renameOnly.payload));
    assert.equal(renameOnly.payload.project.inputRevision, 1);
    const revisedInput = await call(server.origin, `/api/projects/${staleDraft.project.id}`, {
      method: "PATCH",
      auth: owner,
      body: { input: { bathrooms: 4 } },
    });
    assert.equal(revisedInput.response.status, 200, JSON.stringify(revisedInput.payload));
    assert.equal(revisedInput.payload.project.inputRevision, 2);
    const staleComparison = await call(server.origin, `/api/projects/${staleDraft.project.id}/decision-compare`, { auth: owner });
    assert.equal(staleComparison.response.status, 404);
    assert.equal(staleComparison.payload.code, "decision_compare_stale");
    const staleChoice = await call(server.origin, `/api/projects/${staleDraft.project.id}/decision-compare/choice`, {
      method: "POST",
      auth: owner,
      body: { scenarioId: staleDraft.comparison.scenarios[0].id },
    });
    assert.equal(staleChoice.response.status, 409);
    assert.equal(staleChoice.payload.code, "decision_compare_stale");

    const tenantProbe = await call(server.origin, `/api/projects/${first.project.id}/decision-compare`, { auth: other });
    assert.equal(tenantProbe.response.status, 404);
    assert.equal(tenantProbe.payload.code, "project_not_found");

    const noConsent = await call(server.origin, `/api/projects/${first.project.id}/orders`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "decision-e2e-no-consent" },
      body: { plan: "decision_compare", decisionComparisonId: first.comparison.id },
    });
    assert.equal(noConsent.response.status, 400);
    assert.equal(noConsent.payload.code, "checkout_terms_required");
    const safeClosedCheckout = await call(server.origin, `/api/projects/${first.project.id}/orders`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "decision-e2e-closed" },
      body: {
        plan: "decision_compare",
        decisionComparisonId: first.comparison.id,
        acceptedTerms: true,
        acceptedProfessionalBoundary: true,
        termsVersion: "pilot-v1",
      },
    });
    assert.equal(safeClosedCheckout.response.status, 503);
    assert.equal(safeClosedCheckout.payload.code, "payments_unavailable");

    await stopWorker(server);
    server = null;
    const installRace = wranglerD1(
      stateDirectory,
      "execute",
      `CREATE TRIGGER e2e_checkout_revision_race
         AFTER INSERT ON orders
         WHEN NEW.project_id=${sqlLiteral(raceDraft.project.id)}
          AND COALESCE(NEW.product_code,NEW.plan)='decision_compare'
       BEGIN
         UPDATE projects
            SET input_json=json_set(input_json,'$.bathrooms',COALESCE(json_extract(input_json,'$.bathrooms'),0)+1),
                input_revision=input_revision+1
          WHERE id=NEW.project_id;
       END;`,
    );
    assert.equal(installRace.status, 0, `${installRace.stdout}\n${installRace.stderr}`);
    server = await startWorker({
      stateDirectory,
      assetsDirectory,
      port,
      checkout: true,
      fulfillment: true,
      enabledPlans: "decision_compare",
      paymentConfig: true,
    });
    const fencedCheckout = await call(server.origin, `/api/projects/${raceDraft.project.id}/orders`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": "decision-e2e-revision-race" },
      body: {
        plan: "decision_compare",
        decisionComparisonId: raceDraft.comparison.id,
        acceptedTerms: true,
        acceptedProfessionalBoundary: true,
        termsVersion: "pilot-v1",
      },
    });
    assert.equal(fencedCheckout.response.status, 409, JSON.stringify(fencedCheckout.payload));
    assert.equal(fencedCheckout.payload.code, "decision_checkout_conflict");
    const afterRace = await call(server.origin, `/api/projects/${raceDraft.project.id}/decision-compare`, { auth: owner });
    assert.equal(afterRace.response.status, 200, JSON.stringify(afterRace.payload));
    assert.equal(afterRace.payload.comparison.projectInputRevision, 1);
    assert.equal(afterRace.payload.selection.lockedAt, null);
    const afterRaceOrders = await call(server.origin, `/api/orders?projectId=${encodeURIComponent(raceDraft.project.id)}`, { auth: owner });
    assert.equal(afterRaceOrders.response.status, 200, JSON.stringify(afterRaceOrders.payload));
    assert.deepEqual(afterRaceOrders.payload.orders, []);
    await stopWorker(server);
    server = null;
    const removeRace = wranglerD1(stateDirectory, "execute", "DROP TRIGGER e2e_checkout_revision_race;");
    assert.equal(removeRace.status, 0, `${removeRace.stdout}\n${removeRace.stderr}`);

    const seed = wranglerD1(stateDirectory, "execute", [
      seedOrderSql({ orderId: "decision-order-a", projectId: first.project.id, userId: owner.user.id, comparison: first.comparison, selectedScenarioId: first.selectedScenarioId, suffix: "DECISIONA" }),
      seedOrderSql({ orderId: "decision-order-b", projectId: second.project.id, userId: owner.user.id, comparison: second.comparison, selectedScenarioId: second.selectedScenarioId, suffix: "DECISIONB" }),
      seedOrderSql({ orderId: "decision-order-failed", projectId: failedDraft.project.id, userId: owner.user.id, comparison: failedDraft.comparison, selectedScenarioId: failedDraft.selectedScenarioId, suffix: "FAILED", failedProviderless: true }),
    ].join("\n"));
    assert.equal(seed.status, 0, `${seed.stdout}\n${seed.stderr}`);

    // Verified provider events remain ingestible while delivery is paused.
    server = await startWorker({ stateDirectory, assetsDirectory, port, checkout: false, fulfillment: false, enabledPlans: "" });
    const lockedChoice = await call(server.origin, `/api/projects/${first.project.id}/decision-compare/choice`, {
      method: "POST",
      auth: owner,
      body: { scenarioId: first.comparison.scenarios[0].id },
    });
    assert.equal(lockedChoice.response.status, 409);
    assert.equal(lockedChoice.payload.code, "selection_locked");
    for (const [orderId, suffix] of [["decision-order-a", "DECISIONA"], ["decision-order-b", "DECISIONB"]]) {
      const paid = await signedWebhook(server.origin, `evt_paid_${suffix}`, paymentPayload({ orderId, suffix }));
      assert.equal(paid.response.status, 200, JSON.stringify(paid.payload));
      assert.equal(paid.payload.result, "paid");
      const duplicate = await signedWebhook(server.origin, `evt_paid_${suffix}`, paymentPayload({ orderId, suffix }));
      assert.equal(duplicate.response.status, 200);
      assert.equal(duplicate.payload.duplicate, true);
      const pausedArtifact = await call(server.origin, `/api/orders/${orderId}/artifact`, { auth: owner });
      assert.equal(pausedArtifact.response.status, 503);
      assert.equal(pausedArtifact.payload.code, "fulfillment_paused");
    }
    const pausedProgress = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: owner,
      body: { action: "printed" },
    });
    assert.equal(pausedProgress.response.status, 503);
    assert.equal(pausedProgress.payload.code, "fulfillment_paused");

    await stopWorker(server);
    server = await startWorker({ stateDirectory, assetsDirectory, port, checkout: false, fulfillment: true, enabledPlans: "" });
    const artifact = await call(server.origin, "/api/orders/decision-order-a/artifact", { auth: owner });
    assert.equal(artifact.response.status, 200, JSON.stringify(artifact.payload));
    assert.equal(artifact.payload.artifact.type, "purchased_decision_compare");
    assert.equal(artifact.payload.artifact.comparison.id, first.comparison.id);
    assert.equal(artifact.payload.artifact.comparison.selectedScenarioId, first.selectedScenarioId);
    assert.ok(artifact.payload.progress.firstOpenedAt);
    const otherArtifact = await call(server.origin, "/api/orders/decision-order-a/artifact", { auth: other });
    assert.equal(otherArtifact.response.status, 404);

    const invalidProgress = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: owner,
      body: { action: "printed", clientTimestamp: "2026-08-14T00:00:00Z" },
    });
    assert.equal(invalidProgress.response.status, 400);
    assert.equal(invalidProgress.payload.code, "invalid_progress_action");
    const foreignProgress = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: other,
      body: { action: "printed" },
    });
    assert.equal(foreignProgress.response.status, 404);
    const printed = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: owner,
      body: { action: "printed" },
    });
    assert.equal(printed.response.status, 200, JSON.stringify(printed.payload));
    assert.ok(printed.payload.progress.firstPrintedAt);
    const firstPrintedAt = printed.payload.progress.firstPrintedAt;
    const repeatedPrint = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: owner,
      body: { action: "printed" },
    });
    assert.equal(repeatedPrint.response.status, 200);
    assert.equal(repeatedPrint.payload.progress.firstPrintedAt, firstPrintedAt);
    const professionalHandoff = await call(server.origin, "/api/orders/decision-order-b/progress", {
      method: "POST",
      auth: owner,
      body: { action: "professional_handoff" },
    });
    assert.equal(professionalHandoff.response.status, 200, JSON.stringify(professionalHandoff.payload));
    assert.ok(professionalHandoff.payload.progress.professionalHandoffAt);

    const createShare = async (orderId, projectId, key) => call(server.origin, `/api/projects/${projectId}/decision-compare/shares`, {
      method: "POST",
      auth: owner,
      headers: { "idempotency-key": key },
      body: { orderId, expiresInDays: 7 },
    });
    const firstShare = await createShare("decision-order-a", first.project.id, "decision-share-a-manual");
    assert.equal(firstShare.response.status, 201, JSON.stringify(firstShare.payload));
    assert.match(firstShare.payload.share.token, /^[A-Za-z0-9_-]{40,64}$/u);
    const firstToken = firstShare.payload.share.token;
    const sharedProgress = await call(server.origin, "/api/orders/decision-order-a/artifact", { auth: owner });
    assert.equal(sharedProgress.response.status, 200);
    assert.ok(sharedProgress.payload.progress.firstSharedAt);
    const listed = await call(server.origin, `/api/projects/${first.project.id}/decision-compare/shares`, { auth: owner });
    assert.equal(listed.response.status, 200);
    assert.equal(Object.hasOwn(listed.payload.shares[0], "token"), false);
    assert.equal(Object.hasOwn(listed.payload.shares[0], "url"), false);
    const replay = await createShare("decision-order-a", first.project.id, "decision-share-a-manual");
    assert.equal(replay.response.status, 200);
    assert.equal(replay.payload.idempotentReplay, true);
    assert.equal(Object.hasOwn(replay.payload.share, "token"), false);
    const publicShare = await call(server.origin, `/api/shared/decision-compare/${firstToken}`);
    assert.equal(publicShare.response.status, 200, JSON.stringify(publicShare.payload));
    assert.equal(publicShare.payload.share.artifact.selectedScenarioId, "option_b");
    const publicArtifact = JSON.stringify(publicShare.payload.share.artifact);
    for (const privateValue of [first.project.id, first.comparison.id, first.selectedScenarioId, "Protect daylight and a quiet centre."]) {
      assert.equal(publicArtifact.includes(privateValue), false, privateValue);
    }
    assert.equal(Object.hasOwn(publicShare.payload.share.artifact, "projectName"), false);
    assert.equal(Object.hasOwn(publicShare.payload.share.artifact, "contentHash"), false);
    assert.equal(Object.hasOwn(publicShare.payload.share.artifact.scenarios[0], "input"), false);
    assert.equal(Object.hasOwn(publicShare.payload.share, "contentHash"), false);
    const revoked = await call(server.origin, `/api/projects/${first.project.id}/decision-compare/shares/${firstShare.payload.share.id}`, {
      method: "DELETE",
      auth: owner,
    });
    assert.equal(revoked.response.status, 204);
    const revokedPublic = await call(server.origin, `/api/shared/decision-compare/${firstToken}`);
    assert.equal(revokedPublic.response.status, 410);

    // Paid delivery must survive an ancillary cohort-measurement write failure.
    await stopWorker(server);
    server = null;
    const failProgress = wranglerD1(
      stateDirectory,
      "execute",
      "CREATE TRIGGER e2e_fail_decision_progress BEFORE INSERT ON decision_progress BEGIN SELECT RAISE(ABORT, 'synthetic progress outage'); END;",
    );
    assert.equal(failProgress.status, 0, `${failProgress.stdout}\n${failProgress.stderr}`);
    server = await startWorker({ stateDirectory, assetsDirectory, port, checkout: false, fulfillment: true, enabledPlans: "" });
    const artifactDuringProgressOutage = await call(server.origin, "/api/orders/decision-order-a/artifact", { auth: owner });
    assert.equal(artifactDuringProgressOutage.response.status, 200, JSON.stringify(artifactDuringProgressOutage.payload));
    assert.equal(artifactDuringProgressOutage.payload.progress, null);

    const refundShare = await createShare("decision-order-a", first.project.id, "decision-share-a-refund");
    assert.equal(refundShare.response.status, 201);
    const refundToken = refundShare.payload.share.token;
    const refunded = await signedWebhook(server.origin, "evt_refund_DECISIONA", {
      event: "refund.processed",
      payload: { refund: { entity: { id: "rfnd_DECISIONA", payment_id: "pay_DECISIONA", amount: 99_900, currency: "INR", status: "processed" } } },
    });
    assert.equal(refunded.response.status, 200, JSON.stringify(refunded.payload));
    assert.equal(refunded.payload.result, "refunded");
    const refundedOrder = await call(server.origin, "/api/orders/decision-order-a", { auth: owner });
    assert.equal(refundedOrder.payload.order.status, "refunded");
    assert.equal(refundedOrder.payload.order.entitlement.active, false);
    const refundRevokedShare = await call(server.origin, `/api/shared/decision-compare/${refundToken}`);
    assert.equal(refundRevokedShare.response.status, 410);
    const refundShareList = await call(server.origin, `/api/projects/${first.project.id}/decision-compare/shares`, { auth: owner });
    assert.equal(refundShareList.response.status, 200);
    assert.equal(refundShareList.payload.shares.find((share) => share.id === refundShare.payload.share.id)?.active, false);
    const refundedProgress = await call(server.origin, "/api/orders/decision-order-a/progress", {
      method: "POST",
      auth: owner,
      body: { action: "printed" },
    });
    assert.equal(refundedProgress.response.status, 410);

    const disputeShare = await createShare("decision-order-b", second.project.id, "decision-share-b-dispute");
    assert.equal(disputeShare.response.status, 201);
    const disputed = await signedWebhook(server.origin, "evt_dispute_DECISIONB", {
      event: "payment.dispute.created",
      payload: { dispute: { entity: { id: "disp_DECISIONB", payment_id: "pay_DECISIONB", status: "open" } } },
    });
    assert.equal(disputed.response.status, 200, JSON.stringify(disputed.payload));
    assert.equal(disputed.payload.result, "entitlement_revoked");
    const disputedArtifact = await call(server.origin, "/api/orders/decision-order-b/artifact", { auth: owner });
    assert.equal(disputedArtifact.response.status, 410);
    assert.equal(disputedArtifact.payload.code, "entitlement_revoked");
    const disputedPublic = await call(server.origin, `/api/shared/decision-compare/${disputeShare.payload.share.token}`);
    assert.equal(disputedPublic.response.status, 410);
    const disputeShareList = await call(server.origin, `/api/projects/${second.project.id}/decision-compare/shares`, { auth: owner });
    assert.equal(disputeShareList.response.status, 200);
    assert.equal(disputeShareList.payload.shares.find((share) => share.id === disputeShare.payload.share.id)?.active, false);
    const disputedProgress = await call(server.origin, "/api/orders/decision-order-b/progress", {
      method: "POST",
      auth: owner,
      body: { action: "professional_handoff" },
    });
    assert.equal(disputedProgress.response.status, 410);

    const deleteFailedDraft = await call(server.origin, `/api/projects/${failedDraft.project.id}`, { method: "DELETE", auth: owner });
    assert.equal(deleteFailedDraft.response.status, 204, JSON.stringify(deleteFailedDraft.payload));
    const deletedDraft = await call(server.origin, `/api/projects/${failedDraft.project.id}`, { auth: owner });
    assert.equal(deletedDraft.response.status, 404);

    const invalidEvent = await call(server.origin, "/api/events", {
      method: "POST",
      auth: owner,
      body: { event: "decision_compare_saved", properties: { surface: "owner_compare", outcome: "success", projectId: first.project.id } },
    });
    assert.equal(invalidEvent.response.status, 400);
    const anonymousEvent = await call(server.origin, "/api/events", {
      method: "POST",
      body: { event: "decision_compare_saved", properties: { surface: "owner_compare", outcome: "success" } },
    });
    assert.equal(anonymousEvent.response.status, 401);
    const validEvent = await call(server.origin, "/api/events", {
      method: "POST",
      auth: owner,
      body: { event: "decision_compare_saved", properties: { surface: "owner_compare", outcome: "success" } },
    });
    assert.equal(validEvent.response.status, 204);
    const hiddenMetrics = await call(server.origin, "/api/events/aggregate?days=1");
    assert.equal(hiddenMetrics.response.status, 404);
    const metrics = await call(server.origin, "/api/events/aggregate?days=1", { headers: { authorization: `Bearer ${metricsToken}` } });
    assert.equal(metrics.response.status, 200, JSON.stringify(metrics.payload));
    assert.equal(metrics.payload.aggregates.some((row) => row.event_name === "decision_compare_saved" && row.event_count === 1), true);
    assert.equal(metrics.payload.paidDecisionCohort.paidOrders, 2);
    assert.equal(metrics.payload.paidDecisionCohort.completedWithin7Days, 2);
    assert.equal(metrics.payload.paidDecisionCohort.completionRate, 1);

    await stopWorker(server);
    server = null;
    const bypassRevision = wranglerD1(
      stateDirectory,
      "execute",
      `UPDATE projects SET input_json=json_set(input_json,'$.bathrooms',5) WHERE id=${sqlLiteral(staleDraft.project.id)};`,
    );
    assert.notEqual(bypassRevision.status, 0, "D1 must reject a source mutation that does not advance input_revision");
    assert.match(`${bypassRevision.stdout}\n${bypassRevision.stderr}`, /input revision/u);
    const immutable = wranglerD1(stateDirectory, "execute", "UPDATE purchased_decision_snapshots SET artifact_json='{}' WHERE id='snapshot-DECISIONA';");
    assert.notEqual(immutable.status, 0, "the purchased artifact mutation must be rejected by D1");
    assert.match(`${immutable.stdout}\n${immutable.stderr}`, /immutable/u);
    const immutableSelection = wranglerD1(
      stateDirectory,
      "execute",
      `UPDATE decision_selections SET scenario_id=${sqlLiteral(first.comparison.scenarios[0].id)} WHERE comparison_id=${sqlLiteral(first.comparison.id)};`,
    );
    assert.notEqual(immutableSelection.status, 0, "a purchased selection mutation must be rejected by D1");
    assert.match(`${immutableSelection.stdout}\n${immutableSelection.stderr}`, /immutable/u);
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { recursive: true, force: true });
  }
});
