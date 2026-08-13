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
const webhookSecret = "payment-state-e2e-webhook-secret";

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

function d1(stateDirectory, action, sql = null) {
  const args = ["--no-install", "wrangler", "d1"];
  if (action === "migrate") {
    args.push("migrations", "apply", "grihagrid-db", "--local", "--persist-to", stateDirectory);
  } else {
    args.push("execute", "grihagrid-db", "--local", "--persist-to", stateDirectory, "--command", sql);
    if (action === "query") args.push("--json");
  }
  return spawnSync(npx, args, {
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
  const payload = JSON.parse(result.stdout);
  return payload.flatMap((entry) => entry.results || []);
}

async function startWorker(stateDirectory, assetsDirectory, port) {
  const args = [
    "--no-install", "wrangler", "dev", "worker/index.js",
    "--config", "wrangler.toml",
    "--local",
    "--persist-to", stateDirectory,
    "--assets", assetsDirectory,
    "--ip", "127.0.0.1",
    "--port", String(port),
    "--log-level", "error",
    "--show-interactive-dev-session=false",
    "--var", "APP_ENV:test",
    "--var", "APP_ORIGIN:https://app.example.test",
    "--var", "PAID_CHECKOUT_ENABLED:false",
    "--var", "DECISION_COMPARE_FULFILLMENT_ENABLED:false",
    "--var", "ENABLED_PAYMENT_PLANS:",
    "--var", `RAZORPAY_WEBHOOK_SECRET:${webhookSecret}`,
    "--var", "GEMINI_API_KEY:",
  ];
  const child = spawn(npx, args, {
    cwd: root,
    env: { ...process.env, CI: "true" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let logs = "";
  const append = (chunk) => { logs = `${logs}${String(chunk)}`.slice(-20_000); };
  child.stdout.on("data", append);
  child.stderr.on("data", append);
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  const origin = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 45_000;
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
      // workerd has not bound its local port yet.
    }
  }
  await stopWorker({ child, exited });
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

async function webhook(origin, eventId, payload) {
  const raw = JSON.stringify(payload);
  const signature = createHmac("sha256", webhookSecret).update(raw).digest("hex");
  const response = await fetch(`${origin}/api/payments/razorpay/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-razorpay-event-id": eventId,
      "x-razorpay-signature": signature,
    },
    body: raw,
  });
  return { response, body: await response.json() };
}

function capture(paymentId, checkoutOrderId, amount = 49_900) {
  return {
    event: "payment.captured",
    payload: { payment: { entity: {
      id: paymentId,
      order_id: checkoutOrderId,
      status: "captured",
      captured: true,
      amount,
      currency: "INR",
    } } },
  };
}

function refund(refundId, paymentId, amount) {
  return {
    event: "refund.processed",
    payload: { refund: { entity: {
      id: refundId,
      payment_id: paymentId,
      amount,
      currency: "INR",
      status: "processed",
    } } },
  };
}

function orderSql({ id, projectId, status, linkId, checkoutOrderId, paymentId = null, requestHash }) {
  const createdAt = "2026-08-14 00:00:00";
  const checkoutUrl = status === "created" ? `https://rzp.io/i/${id}` : null;
  const paidAt = status === "paid" ? createdAt : null;
  const text = (value) => value == null ? "NULL" : `'${String(value).replaceAll("'", "''")}'`;
  return `
    INSERT INTO orders
      (id,project_id,user_id,plan,product_code,amount_paise,currency,provider_order_id,
       provider_payment_id,idempotency_key,status,created_at,updated_at,checkout_url,
       provider_status,provider_error_code,paid_at,provider_checkout_order_id,
       entitlement_revoked_at,entitlement_revocation_reason,terms_version,terms_accepted_at,request_hash)
    VALUES (
      ${text(id)},${text(projectId)},'payment-user','plan','plan',49900,'INR',${text(linkId)},
      ${text(paymentId)},${text(`idem-${id}`)},${text(status)},${text(createdAt)},${text(createdAt)},${text(checkoutUrl)},
      ${text(status === "paid" ? "captured" : status === "failed" ? "expired" : "created")},
      ${text(status === "failed" ? "checkout_expired" : null)},${text(paidAt)},${text(checkoutOrderId)},
      NULL,NULL,NULL,NULL,${text(requestHash)}
    );
    INSERT INTO purchased_report_snapshots
      (id,order_id,project_id,user_id,source_report_id,snapshot_schema_version,report_version,input_hash,
       project_name,input_json,estimate_json,report_json,project_updated_at,created_at)
    VALUES (
      ${text(`snapshot-${id}`)},${text(id)},${text(projectId)},'payment-user',NULL,1,1,${text(requestHash)},
      ${text(projectId)},'{}','{}','{"title":"Payment state fixture"}',${text(createdAt)},${text(createdAt)}
    );`;
}

test("real D1 enforces terminal payment facts and late-capture transactions", { timeout: 120_000 }, async () => {
  const stateDirectory = mkdtempSync(path.join(tmpdir(), "grihagrid-payment-state-"));
  const assetsDirectory = path.join(stateDirectory, "assets");
  mkdirSync(assetsDirectory, { recursive: true });
  let server;
  try {
    requireD1Success(d1(stateDirectory, "migrate"), "fresh 0001-0009 migrations failed");
    const projects = [
      "refund-before", "cumulative", "late-created", "late-paid",
      "race-duplicate", "race-refund", "race-dispute",
    ];
    const seed = `
      INSERT INTO users (id,email,name,created_at)
      VALUES ('payment-user','payment-state@example.test','Payment State','2026-08-14 00:00:00');
      ${projects.map((id) => `
        INSERT INTO projects
          (id,user_id,name,status,input_json,estimate_json,created_at,updated_at,input_revision)
        VALUES ('project-${id}','payment-user','${id}','feasibility_ready','{}','{}',
                '2026-08-14 00:00:00','2026-08-14 00:00:00',1);`).join("\n")}
      ${orderSql({
        id: "refund-before-order", projectId: "project-refund-before", status: "created",
        linkId: "plink_REFUNDBEFORE", checkoutOrderId: "order_REFUNDBEFORE", requestHash: "a".repeat(64),
      })}
      ${orderSql({
        id: "cumulative-order", projectId: "project-cumulative", status: "created",
        linkId: "plink_CUMULATIVE", checkoutOrderId: "order_CUMULATIVE", requestHash: "b".repeat(64),
      })}
      ${orderSql({
        id: "late-original", projectId: "project-late-created", status: "failed",
        linkId: "plink_LATEORIGINAL", checkoutOrderId: "order_LATEORIGINAL", requestHash: "c".repeat(64),
      })}
      ${orderSql({
        id: "late-replacement", projectId: "project-late-created", status: "created",
        linkId: "plink_LATEREPLACEMENT", checkoutOrderId: "order_LATEREPLACEMENT", requestHash: "d".repeat(64),
      })}
      ${orderSql({
        id: "duplicate-original", projectId: "project-late-paid", status: "failed",
        linkId: "plink_DUPLICATEORIGINAL", checkoutOrderId: "order_DUPLICATEORIGINAL", requestHash: "e".repeat(64),
      })}
      ${orderSql({
        id: "duplicate-paid", projectId: "project-late-paid", status: "paid",
        linkId: "plink_DUPLICATEPAID", checkoutOrderId: "order_DUPLICATEPAID",
        paymentId: "pay_DUPLICATEPAID", requestHash: "f".repeat(64),
      })}
      ${orderSql({
        id: "race-duplicate-original", projectId: "project-race-duplicate", status: "failed",
        linkId: "plink_RACEDUPLICATEORIGINAL", checkoutOrderId: "order_RACEDUPLICATEORIGINAL",
        requestHash: "3".repeat(64),
      })}
      ${orderSql({
        id: "race-duplicate-paid", projectId: "project-race-duplicate", status: "paid",
        linkId: "plink_RACEDUPLICATEPAID", checkoutOrderId: "order_RACEDUPLICATEPAID",
        paymentId: "pay_RACEDUPLICATEPAID", requestHash: "4".repeat(64),
      })}
      ${orderSql({
        id: "race-refund-order", projectId: "project-race-refund", status: "created",
        linkId: "plink_RACEREFUND", checkoutOrderId: "order_RACEREFUND", requestHash: "1".repeat(64),
      })}
      ${orderSql({
        id: "race-dispute-order", projectId: "project-race-dispute", status: "created",
        linkId: "plink_RACEDISPUTE", checkoutOrderId: "order_RACEDISPUTE", requestHash: "2".repeat(64),
      })}
      CREATE TRIGGER e2e_inject_refund_during_capture
      BEFORE UPDATE OF status ON orders
      WHEN OLD.id='race-refund-order' AND OLD.status!='paid' AND NEW.status='paid'
      BEGIN
        INSERT INTO payment_terminal_records
          (record_type,provider_object_id,terminal_action,provider_event_id,provider_payment_id,
           order_id,amount_paise,currency,provider_state,observed_at)
        VALUES ('refund','rfnd_RACEINJECTED','refund_processed','evt_race_refund_injected',
                'pay_RACEREFUND','race-refund-order',49900,'INR','processed','2026-08-14 00:00:01');
      END;
      CREATE TRIGGER e2e_inject_refund_during_duplicate_capture
      BEFORE UPDATE OF provider_payment_id ON orders
      WHEN OLD.id='race-duplicate-original' AND OLD.provider_payment_id IS NULL
           AND NEW.provider_payment_id='pay_RACEDUPLICATESECOND'
      BEGIN
        INSERT INTO payment_terminal_records
          (record_type,provider_object_id,terminal_action,provider_event_id,provider_payment_id,
           order_id,amount_paise,currency,provider_state,observed_at)
        VALUES ('refund','rfnd_RACEDUPLICATE','refund_processed','evt_race_duplicate_refund_injected',
                'pay_RACEDUPLICATESECOND','race-duplicate-original',49900,'INR','processed',
                '2026-08-14 00:00:01');
      END;
      CREATE TRIGGER e2e_inject_dispute_during_capture
      BEFORE UPDATE OF status ON orders
      WHEN OLD.id='race-dispute-order' AND OLD.status!='paid' AND NEW.status='paid'
      BEGIN
        INSERT INTO payment_terminal_records
          (record_type,provider_object_id,terminal_action,provider_event_id,provider_payment_id,
           order_id,amount_paise,currency,provider_state,observed_at)
        VALUES ('dispute','disp_RACEINJECTED','entitlement_revoked','evt_race_dispute_injected',
                'pay_RACEDISPUTE','race-dispute-order',NULL,NULL,'open','2026-08-14 00:00:01');
      END;
    `;
    requireD1Success(d1(stateDirectory, "execute", seed), "payment fixture seed failed");

    server = await startWorker(stateDirectory, assetsDirectory, await reservePort());

    const earlyRefundPayload = refund("rfnd_BEFORECAPTURE", "pay_BEFORECAPTURE", 49_900);
    const early = await webhook(server.origin, "evt_refund_before_capture", earlyRefundPayload);
    assert.equal(early.response.status, 200, JSON.stringify(early.body));
    assert.equal(early.body.result, "refund_pending_payment");

    const redelivered = await webhook(server.origin, "evt_refund_before_capture_redelivery", earlyRefundPayload);
    assert.equal(redelivered.response.status, 200, JSON.stringify(redelivered.body));
    const beforeCaptureRows = query(stateDirectory,
      "SELECT COUNT(*) AS count,SUM(amount_paise) AS paise FROM payment_terminal_records WHERE provider_payment_id='pay_BEFORECAPTURE'");
    assert.deepEqual(beforeCaptureRows[0], { count: 1, paise: 49_900 });

    const afterRefund = await webhook(server.origin, "evt_capture_after_refund",
      capture("pay_BEFORECAPTURE", "order_REFUNDBEFORE"));
    assert.equal(afterRefund.response.status, 200, JSON.stringify(afterRefund.body));
    assert.equal(afterRefund.body.result, "paid_reconciled_refunded");
    assert.deepEqual(query(stateDirectory,
      "SELECT status,provider_payment_id,entitlement_revocation_reason FROM orders WHERE id='refund-before-order'")[0], {
      status: "refunded",
      provider_payment_id: "pay_BEFORECAPTURE",
      entitlement_revocation_reason: "refund_processed",
    });

    const terminalMutation = d1(stateDirectory, "execute",
      "UPDATE payment_terminal_records SET amount_paise=1 WHERE provider_object_id='rfnd_BEFORECAPTURE'");
    assert.notEqual(terminalMutation.status, 0, "immutable terminal record unexpectedly changed");
    assert.match(`${terminalMutation.stdout}\n${terminalMutation.stderr}`, /payment terminal records are immutable/u);

    const paidCumulative = await webhook(server.origin, "evt_cumulative_paid",
      capture("pay_CUMULATIVE", "order_CUMULATIVE"));
    assert.equal(paidCumulative.body.result, "paid");
    assert.equal((await webhook(server.origin, "evt_partial_one", refund("rfnd_REALPARTONE", "pay_CUMULATIVE", 20_000))).body.result,
      "partial_refund_recorded");
    assert.equal((await webhook(server.origin, "evt_partial_two", refund("rfnd_REALPARTTWO", "pay_CUMULATIVE", 29_900))).body.result,
      "refunded");
    assert.deepEqual(query(stateDirectory,
      "SELECT o.status,COUNT(t.provider_object_id) AS refunds,SUM(t.amount_paise) AS paise FROM orders o JOIN payment_terminal_records t ON t.provider_payment_id=o.provider_payment_id WHERE o.id='cumulative-order' GROUP BY o.status")[0], {
      status: "refunded", refunds: 2, paise: 49_900,
    });

    const recovered = await webhook(server.origin, "evt_late_created_recovery",
      capture("pay_LATEORIGINAL", "order_LATEORIGINAL"));
    assert.equal(recovered.body.result, "late_payment_recovered");
    assert.deepEqual(query(stateDirectory,
      "SELECT id,status,provider_error_code FROM orders WHERE project_id='project-late-created' ORDER BY id"), [
      { id: "late-original", status: "paid", provider_error_code: null },
      { id: "late-replacement", status: "failed", provider_error_code: "superseded_by_late_capture" },
    ]);
    assert.equal(query(stateDirectory,
      "SELECT COUNT(*) AS count FROM order_fulfillments WHERE order_id='late-original'")[0].count, 1);

    const duplicate = await webhook(server.origin, "evt_late_paid_conflict",
      capture("pay_DUPLICATESECOND", "order_DUPLICATEORIGINAL"));
    assert.equal(duplicate.body.result, "late_payment_requires_reconciliation");
    assert.deepEqual(query(stateDirectory,
      "SELECT status,provider_payment_id,provider_error_code FROM orders WHERE id='duplicate-original'")[0], {
      status: "failed",
      provider_payment_id: "pay_DUPLICATESECOND",
      provider_error_code: "duplicate_late_capture",
    });
    assert.deepEqual(query(stateDirectory,
      "SELECT order_id,conflicting_order_id,provider_payment_id,status FROM payment_reconciliation_cases")[0], {
      order_id: "duplicate-original",
      conflicting_order_id: "duplicate-paid",
      provider_payment_id: "pay_DUPLICATESECOND",
      status: "open",
    });
    assert.equal(query(stateDirectory,
      "SELECT COUNT(*) AS count FROM order_fulfillments WHERE order_id='duplicate-original'")[0].count, 0);

    const duplicateRefundRace = await webhook(server.origin, "evt_late_paid_refund_race",
      capture("pay_RACEDUPLICATESECOND", "order_RACEDUPLICATEORIGINAL"));
    assert.equal(duplicateRefundRace.response.status, 200, JSON.stringify(duplicateRefundRace.body));
    assert.equal(duplicateRefundRace.body.result, "paid_reconciled_refunded");
    assert.deepEqual(query(stateDirectory,
      "SELECT status,provider_payment_id,provider_error_code FROM orders WHERE id='race-duplicate-original'")[0], {
      status: "refunded",
      provider_payment_id: "pay_RACEDUPLICATESECOND",
      provider_error_code: "duplicate_late_capture",
    });
    assert.deepEqual(query(stateDirectory,
      "SELECT status,resolved_at IS NOT NULL AS resolved FROM payment_reconciliation_cases WHERE order_id='race-duplicate-original'")[0], {
      status: "resolved_refunded", resolved: 1,
    });
    assert.equal(query(stateDirectory,
      "SELECT COUNT(*) AS count FROM order_fulfillments WHERE order_id='race-duplicate-original'")[0].count, 0);

    // These triggers inject terminal evidence only after the Worker has made
    // its application-level pre-read, during the created -> paid UPDATE in the
    // D1 batch. The following SQL-time reconciliation and conditional
    // fulfillment statements must observe it before commit.
    const refundRace = await webhook(server.origin, "evt_race_refund_capture",
      capture("pay_RACEREFUND", "order_RACEREFUND"));
    assert.equal(refundRace.response.status, 200, JSON.stringify(refundRace.body));
    assert.equal(refundRace.body.result, "paid_reconciled_refunded");
    assert.deepEqual(query(stateDirectory,
      "SELECT status,entitlement_revocation_reason FROM orders WHERE id='race-refund-order'")[0], {
      status: "refunded", entitlement_revocation_reason: "refund_processed",
    });
    assert.equal(query(stateDirectory,
      "SELECT COUNT(*) AS count FROM order_fulfillments WHERE order_id='race-refund-order'")[0].count, 0);
    assert.equal(query(stateDirectory,
      "SELECT processing_result FROM payment_webhook_events WHERE provider_event_id='evt_race_refund_capture'")[0].processing_result,
    "paid_reconciled_refunded");

    const disputeRace = await webhook(server.origin, "evt_race_dispute_capture",
      capture("pay_RACEDISPUTE", "order_RACEDISPUTE"));
    assert.equal(disputeRace.response.status, 200, JSON.stringify(disputeRace.body));
    assert.equal(disputeRace.body.result, "paid_reconciled_revoked");
    assert.deepEqual(query(stateDirectory,
      "SELECT status,entitlement_revocation_reason FROM orders WHERE id='race-dispute-order'")[0], {
      status: "paid", entitlement_revocation_reason: "provider_dispute_preexisting",
    });
    assert.equal(query(stateDirectory,
      "SELECT COUNT(*) AS count FROM order_fulfillments WHERE order_id='race-dispute-order'")[0].count, 0);
    assert.equal(query(stateDirectory,
      "SELECT processing_result FROM payment_webhook_events WHERE provider_event_id='evt_race_dispute_capture'")[0].processing_result,
    "paid_reconciled_revoked");
  } finally {
    await stopWorker(server);
    rmSync(stateDirectory, { force: true, recursive: true });
  }
});
