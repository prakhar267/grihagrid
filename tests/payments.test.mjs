import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const ORIGIN = "https://app.example.test";
const SESSION_TOKEN = "test-session-token";
const CSRF_TOKEN = "test-csrf-token";
const assets = { fetch: async () => new Response("missing", { status: 404 }) };

class MemoryKV {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key) || null; }
  async put(key, value) { this.values.set(key, value); }
}

class PaymentD1 {
  constructor() {
    this.users = [];
    this.sessions = [];
    this.projects = [];
    this.orders = [];
    this.events = [];
    this.reports = [];
    this.snapshots = [];
    this.fulfillments = [];
  }

  prepare(sql) { return new PaymentStatement(this, sql.replace(/\s+/gu, " ").trim()); }

  async batch(statements) {
    const snapshot = structuredClone({
      orders: this.orders,
      events: this.events,
      snapshots: this.snapshots,
      fulfillments: this.fulfillments,
      projects: this.projects,
    });
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    } catch (error) {
      this.orders = snapshot.orders;
      this.events = snapshot.events;
      this.snapshots = snapshot.snapshots;
      this.fulfillments = snapshot.fulfillments;
      this.projects = snapshot.projects;
      throw error;
    }
  }
}

class PaymentStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) { this.values = values; return this; }

  enrichedOrder(order) {
    if (!order) return null;
    const fulfillment = this.db.fulfillments.find((candidate) => candidate.order_id === order.id);
    const snapshot = fulfillment && this.db.snapshots.find((candidate) => candidate.id === fulfillment.snapshot_id);
    return {
      ...order,
      fulfillment_id: fulfillment?.id || null,
      fulfillment_status: fulfillment?.status || null,
      fulfillment_status_reason: fulfillment?.status_reason || null,
      fulfillment_snapshot_id: fulfillment?.snapshot_id || null,
      fulfillment_created_at: fulfillment?.created_at || null,
      fulfillment_updated_at: fulfillment?.updated_at || null,
      fulfillment_ready_at: fulfillment?.ready_at || null,
      snapshot_schema_version: snapshot?.snapshot_schema_version || null,
      snapshot_report_version: snapshot?.report_version || null,
      snapshot_input_hash: snapshot?.input_hash || null,
      snapshot_report_json: snapshot?.report_json || null,
      snapshot_project_updated_at: snapshot?.project_updated_at || null,
      snapshot_created_at: snapshot?.created_at || null,
    };
  }

  async first() {
    if (this.sql.includes("FROM sessions s JOIN users u")) {
      const session = this.db.sessions.find((candidate) => candidate.token_hash === this.values[0]);
      const user = session && this.db.users.find((candidate) => candidate.id === session.user_id);
      return user ? {
        session_id: session.id,
        user_id: user.id,
        csrf_hash: session.csrf_hash,
        expires_at: session.expires_at,
        email: user.email,
        name: user.name,
        user_created_at: user.created_at,
      } : null;
    }
    if (this.sql.includes("FROM projects p WHERE p.id=? AND p.user_id=?")) {
      const project = this.db.projects.find((candidate) => candidate.id === this.values[0] && candidate.user_id === this.values[1]);
      return project ? { ...project, report_available: 0 } : null;
    }
    if (this.sql.includes("o.idempotency_key=?")) {
      return this.enrichedOrder(this.db.orders.find((order) => order.user_id === this.values[0] && order.idempotency_key === this.values[1]));
    }
    if (this.sql.includes("o.status IN ('created','paid')")) {
      const [userId, projectId, plan] = this.values;
      const rows = this.db.orders.filter((order) => order.user_id === userId && order.project_id === projectId && order.plan === plan && ["created", "paid"].includes(order.status));
      rows.sort((left, right) => Number(right.status === "paid") - Number(left.status === "paid") || right.created_at.localeCompare(left.created_at));
      return this.enrichedOrder(rows[0]);
    }
    if (this.sql.includes("FROM orders o") && this.sql.includes("WHERE o.id=? AND o.user_id=?")) {
      return this.enrichedOrder(this.db.orders.find((order) => order.id === this.values[0] && order.user_id === this.values[1]));
    }
    if (this.sql === "SELECT * FROM orders WHERE id=? AND user_id=?") {
      return this.db.orders.find((order) => order.id === this.values[0] && order.user_id === this.values[1]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE id=?") {
      return this.db.orders.find((order) => order.id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE provider_order_id=?") {
      return this.db.orders.find((order) => order.provider_order_id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM orders WHERE provider_checkout_order_id=?") {
      return this.db.orders.find((order) => order.provider_checkout_order_id === this.values[0]) || null;
    }
    if (this.sql.startsWith("SELECT provider_event_id,payload_sha256,processing_result FROM payment_webhook_events")) {
      return this.db.events.find((event) => event.provider_event_id === this.values[0]) || null;
    }
    if (this.sql === "SELECT * FROM reports WHERE project_id=? AND user_id=?") {
      return this.db.reports.find((report) => report.project_id === this.values[0] && report.user_id === this.values[1]) || null;
    }
    if (this.sql === "SELECT id FROM purchased_report_snapshots WHERE order_id=?") {
      const snapshot = this.db.snapshots.find((candidate) => candidate.order_id === this.values[0]);
      return snapshot ? { id: snapshot.id } : null;
    }
    if (this.sql.startsWith("SELECT id,status FROM orders WHERE user_id=?")) {
      const [userId, projectId, plan, excludedId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.user_id === userId && candidate.project_id === projectId && candidate.plan === plan && candidate.id !== excludedId && ["created", "paid"].includes(candidate.status));
      return order ? { id: order.id, status: order.status } : null;
    }
    throw new Error(`Unhandled PaymentD1 first(): ${this.sql}`);
  }

  async all() {
    if (this.sql.includes("FROM orders o") && this.sql.includes("o.project_id=?")) {
      const [userId, projectId, limit] = this.values;
      return { results: this.db.orders.filter((order) => order.user_id === userId && order.project_id === projectId).slice(0, limit).map((order) => this.enrichedOrder(order)) };
    }
    if (this.sql.includes("FROM orders o") && this.sql.includes("o.user_id=?")) {
      const [userId, limit] = this.values;
      return { results: this.db.orders.filter((order) => order.user_id === userId).slice(0, limit).map((order) => this.enrichedOrder(order)) };
    }
    throw new Error(`Unhandled PaymentD1 all(): ${this.sql}`);
  }

  async run() {
    if (this.sql.startsWith("INSERT INTO orders")) {
      const [id, project_id, user_id, plan, amount_paise, idempotency_key, created_at, updated_at, provider_status] = this.values;
      if (this.db.orders.some((order) => order.idempotency_key === idempotency_key)) throw new Error("UNIQUE constraint failed");
      this.db.orders.push({
        id, project_id, user_id, plan, amount_paise, currency: "INR", idempotency_key,
        status: "created", created_at, updated_at, provider_status, provider_order_id: null,
        provider_checkout_order_id: null, provider_payment_id: null, provider_error_code: null, checkout_url: null, paid_at: null,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET provider_order_id=?,provider_checkout_order_id=?")) {
      const [providerId, providerCheckoutOrderId, checkoutUrl, providerStatus, updatedAt, id, userId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === id && candidate.user_id === userId && candidate.status === "created");
      if (order) Object.assign(order, { provider_order_id: providerId, provider_checkout_order_id: providerCheckoutOrderId, checkout_url: checkoutUrl, provider_status: providerStatus, provider_error_code: null, updated_at: updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='failed',provider_status='expired'")) {
      for (const order of this.db.orders.filter((candidate) => candidate.status === "created")) {
        Object.assign(order, { status: "failed", provider_status: "expired", provider_error_code: "checkout_expired", checkout_url: null });
      }
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='failed'")) {
      const [code, updatedAt, id, userId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === id && candidate.user_id === userId && candidate.status === "created");
      if (order) Object.assign(order, { status: "failed", provider_status: "request_failed", provider_error_code: code, updated_at: updatedAt });
      return { success: true };
    }
    if (this.sql.startsWith("DELETE FROM sessions WHERE expires_at")) return { success: true };
    if (this.sql.startsWith("INSERT INTO payment_webhook_events")) {
      const [provider_event_id, event_type, payload_sha256, order_id, provider_payment_id, processing_result, received_at, processed_at] = this.values;
      if (this.db.events.some((event) => event.provider_event_id === provider_event_id)) throw new Error("UNIQUE constraint failed");
      this.db.events.push({ provider_event_id, event_type, payload_sha256, order_id, provider_payment_id, processing_result, received_at, processed_at });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO purchased_report_snapshots")) {
      const [
        id, order_id, project_id, user_id, source_report_id, snapshot_schema_version,
        report_version, input_hash, project_name, input_json, estimate_json, report_json,
        project_updated_at, created_at,
      ] = this.values;
      if (this.db.snapshots.some((snapshot) => snapshot.order_id === order_id)) throw new Error("UNIQUE constraint failed");
      this.db.snapshots.push({
        id, order_id, project_id, user_id, source_report_id, snapshot_schema_version,
        report_version, input_hash, project_name, input_json, estimate_json, report_json,
        project_updated_at, created_at,
      });
      return { success: true };
    }
    if (this.sql.startsWith("INSERT INTO order_fulfillments")) {
      const [id, order_id, snapshot_id, project_id, user_id, plan, status, status_reason, created_at, updated_at, ready_at] = this.values;
      if (!this.db.fulfillments.some((fulfillment) => fulfillment.order_id === order_id)) {
        this.db.fulfillments.push({ id, order_id, snapshot_id, project_id, user_id, plan, status, status_reason, created_at, updated_at, ready_at });
      }
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE orders SET status='paid'")) {
      const [paymentId, linkId, providerCheckoutOrderId, providerStatus, paidAt, updatedAt, orderId] = this.values;
      const order = this.db.orders.find((candidate) => candidate.id === orderId && ["created", "failed"].includes(candidate.status));
      if (order) Object.assign(order, {
        status: "paid",
        provider_payment_id: paymentId,
        provider_order_id: order.provider_order_id || linkId,
        provider_checkout_order_id: order.provider_checkout_order_id || providerCheckoutOrderId,
        provider_status: providerStatus,
        provider_error_code: null,
        paid_at: order.paid_at || paidAt,
        updated_at: updatedAt,
      });
      return { success: true };
    }
    if (this.sql.startsWith("UPDATE projects SET status='expert_review'")) {
      const [updatedAt, projectId, userId] = this.values;
      const project = this.db.projects.find((candidate) => candidate.id === projectId && candidate.user_id === userId && candidate.status !== "archived");
      if (project) Object.assign(project, { status: "expert_review", updated_at: updatedAt });
      return { success: true };
    }
    throw new Error(`Unhandled PaymentD1 run(): ${this.sql}`);
  }
}

async function fixture() {
  const DB = new PaymentD1();
  const tokenHash = await __test.digestBase64(SESSION_TOKEN);
  const csrfHash = await __test.digestBase64(CSRF_TOKEN);
  DB.users.push({ id: "user-a", email: "owner@example.test", name: "Owner", created_at: "2026-08-13 00:00:00" });
  DB.users.push({ id: "user-b", email: "other@example.test", name: "Other", created_at: "2026-08-13 00:00:00" });
  DB.sessions.push({ id: "session-a", user_id: "user-a", token_hash: tokenHash, csrf_hash: csrfHash, expires_at: "2099-01-01 00:00:00" });
  const input = { width: 30, length: 50, floors: 2, bedrooms: 3, quality: "Standard", city: "Bengaluru" };
  const estimate = __test.computeEstimate(input);
  DB.projects.push({ id: "project-a", user_id: "user-a", name: "A", status: "draft", input_json: JSON.stringify(input), estimate_json: JSON.stringify(estimate), created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00" });
  DB.projects.push({ id: "project-b", user_id: "user-b", name: "B", status: "draft", input_json: JSON.stringify(input), estimate_json: JSON.stringify(estimate), created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00" });
  const providerCalls = [];
  const env = {
    ASSETS: assets,
    DB,
    GRIHAGRID_CACHE: new MemoryKV(),
    APP_ORIGIN: ORIGIN,
    ENABLED_PAYMENT_PLANS: "plan,site_plus,expert",
    RAZORPAY_KEY_ID: "rzp_test_key",
    RAZORPAY_KEY_SECRET: "test-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
    FILES: {},
    RAZORPAY_FETCH: async (url, init) => {
      providerCalls.push({ url, init, body: JSON.parse(init.body) });
      const number = providerCalls.length;
      return Response.json({ id: `plink_TEST${number}`, order_id: `order_TEST${number}`, short_url: `https://rzp.io/i/test${number}`, status: "created" }, { status: 200 });
    },
  };
  return { DB, env, providerCalls };
}

function authHeaders(extra = {}) {
  return {
    origin: ORIGIN,
    cookie: `__Host-grihagrid_session=${SESSION_TOKEN}; grihagrid_csrf=${CSRF_TOKEN}`,
    "x-csrf-token": CSRF_TOKEN,
    "content-type": "application/json",
    ...extra,
  };
}

function appRequest(path, init = {}) { return new Request(`${ORIGIN}${path}`, init); }

test("checkout prices are server-owned paise values and plans are closed", () => {
  assert.equal(__test.paymentPlan("plan").amountPaise, 49_900);
  assert.equal(__test.paymentPlan("site_plus").amountPaise, 99_900);
  assert.equal(__test.paymentPlan("expert").amountPaise, 349_900);
  assert.throws(() => __test.paymentPlan("admin-free"), /plan must be one of/u);
});

test("public commerce catalog is server-priced and fail-closed by plan", async () => {
  const { env } = await fixture();
  const disabled = await worker.fetch(appRequest("/api/commerce/catalog"), { ...env, ENABLED_PAYMENT_PLANS: "" });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.headers.get("access-control-allow-origin"), "*");
  const disabledPlans = (await disabled.json()).plans;
  assert.deepEqual(disabledPlans.map((plan) => plan.acceptingOrders), [false, false, false]);
  assert.deepEqual(disabledPlans.map((plan) => plan.amountPaise), [49_900, 99_900, 349_900]);

  const planOnly = await worker.fetch(appRequest("/api/commerce/catalog"), { ...env, ENABLED_PAYMENT_PLANS: "plan" });
  assert.deepEqual((await planOnly.json()).plans.map((plan) => plan.acceptingOrders), [true, false, false]);
  const invalid = await worker.fetch(appRequest("/api/commerce/catalog"), { ...env, ENABLED_PAYMENT_PLANS: "plan,not-a-plan" });
  assert.deepEqual((await invalid.json()).plans.map((plan) => plan.acceptingOrders), [false, false, false]);
});

test("Razorpay signatures are checked against the exact raw bytes", async () => {
  const bytes = new TextEncoder().encode('{"event":"payment.captured","amount":49900}');
  const signature = await __test.hmacSha256Hex("webhook-secret", bytes);
  assert.equal(await __test.verifyRazorpaySignature("webhook-secret", bytes, signature), true);
  assert.equal(await __test.verifyRazorpaySignature("wrong-secret", bytes, signature), false);
  assert.equal(await __test.verifyRazorpaySignature("webhook-secret", new TextEncoder().encode("{}"), signature), false);
});

test("checkout creates one provider link and replays the same result idempotently", async () => {
  const { env, providerCalls } = await fixture();
  const create = () => worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "checkout-attempt-0001" }),
    body: JSON.stringify({ plan: "plan", amountPaise: 1 }),
  }), env);
  const first = await create();
  assert.equal(first.status, 201);
  const firstBody = await first.json();
  assert.equal(firstBody.order.amountPaise, 49_900);
  assert.equal(firstBody.order.taxInclusive, true);
  assert.equal(firstBody.checkoutUrl, "https://rzp.io/i/test1");
  assert.equal(providerCalls.length, 1);
  assert.equal(providerCalls[0].url, "https://api.razorpay.com/v1/payment_links/");
  assert.equal(providerCalls[0].body.amount, 49_900);
  assert.equal(providerCalls[0].body.currency, "INR");
  assert.equal(providerCalls[0].body.accept_partial, false);
  assert.equal(providerCalls[0].body.customer.email, "owner@example.test");
  assert.match(providerCalls[0].body.description, /inclusive of applicable taxes/u);
  assert.match(providerCalls[0].body.callback_url, /^https:\/\/app\.example\.test\/checkout\/return\?order=/u);

  const replay = await create();
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).idempotentReplay, true);
  assert.equal(providerCalls.length, 1);

  const differentKey = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "checkout-attempt-0002" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  assert.equal(differentKey.status, 200);
  assert.equal((await differentKey.json()).reusedExisting, true);
  assert.equal(providerCalls.length, 1);

  const conflict = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "checkout-attempt-0001" }),
    body: JSON.stringify({ plan: "expert" }),
  }), env);
  assert.equal(conflict.status, 409);
  assert.equal((await conflict.json()).code, "idempotency_conflict");
});

test("provider timeout fails the local order without creating a payable result", async () => {
  const { env, DB } = await fixture();
  env.RAZORPAY_FETCH = async (_url, init) => {
    assert.equal(init.signal instanceof AbortSignal, true);
    throw new DOMException("timed out", "TimeoutError");
  };
  const response = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "provider-timeout-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  assert.equal(response.status, 502);
  assert.equal((await response.json()).code, "payment_provider_error");
  assert.equal(DB.orders.length, 1);
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[0].provider_error_code, "network_error");
  assert.equal(DB.orders[0].checkout_url, null);
  assert.equal(DB.snapshots.length, 1);
});

test("daily maintenance expires stale created checkout links so retries can proceed", async () => {
  const { DB } = await fixture();
  DB.orders.push({
    id: "stale", project_id: "project-a", user_id: "user-a", plan: "plan", amount_paise: 49_900,
    currency: "INR", idempotency_key: "stale-key", status: "created", checkout_url: "https://rzp.io/i/stale",
    provider_status: "created", provider_error_code: null, created_at: "2020-01-01 00:00:00", updated_at: "2020-01-01 00:00:00",
  });
  let maintenance;
  await worker.scheduled({}, { DB }, { waitUntil(promise) { maintenance = promise; } });
  await maintenance;
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[0].provider_status, "expired");
  assert.equal(DB.orders[0].provider_error_code, "checkout_expired");
  assert.equal(DB.orders[0].checkout_url, null);
});

test("a late capture from an expired link cannot collide with a replacement checkout", async () => {
  const { env, DB } = await fixture();
  DB.orders.push({
    id: "expired-order", project_id: "project-a", user_id: "user-a", plan: "plan", amount_paise: 49_900,
    currency: "INR", idempotency_key: "expired-key", status: "failed", provider_order_id: "plink_EXPIRED",
    provider_checkout_order_id: "order_EXPIRED", provider_payment_id: null, checkout_url: null,
    provider_status: "expired", provider_error_code: "checkout_expired", paid_at: null,
    created_at: "2026-08-10 00:00:00", updated_at: "2026-08-12 00:00:00",
  }, {
    id: "replacement-order", project_id: "project-a", user_id: "user-a", plan: "plan", amount_paise: 49_900,
    currency: "INR", idempotency_key: "replacement-key", status: "created", provider_order_id: "plink_REPLACEMENT",
    provider_checkout_order_id: "order_REPLACEMENT", provider_payment_id: null, checkout_url: "https://rzp.io/i/replacement",
    provider_status: "created", provider_error_code: null, paid_at: null,
    created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00",
  });
  DB.snapshots.push({ id: "expired-snapshot", order_id: "expired-order", snapshot_schema_version: 1, report_version: 1, report_json: "{}" });
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_LATE", order_id: "order_EXPIRED", status: "captured", captured: true, amount: 49_900, currency: "INR",
    } } },
  });
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const response = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_late_capture" },
    body: payload,
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "late_payment_conflict");
  assert.equal(DB.orders[0].status, "failed");
  assert.equal(DB.orders[1].status, "created");
  assert.equal(DB.fulfillments.length, 0);
  assert.equal(DB.events[0].processing_result, "late_payment_conflict");
});

test("checkout is project-owner scoped and fails closed without provider config", async () => {
  const { env, DB, providerCalls } = await fixture();
  const forbidden = await worker.fetch(appRequest("/api/projects/project-b/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "ownership-attempt-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  assert.equal(forbidden.status, 404);
  assert.equal((await forbidden.json()).code, "project_not_found");
  assert.equal(providerCalls.length, 0);

  const disabled = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "disabled-plan-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), { ...env, ENABLED_PAYMENT_PLANS: "" });
  assert.equal(disabled.status, 503);
  assert.equal((await disabled.json()).code, "payment_plan_unavailable");
  assert.equal(DB.orders.length, 0);

  const selectivelyDisabled = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "disabled-plan-0002" }),
    body: JSON.stringify({ plan: "expert" }),
  }), { ...env, ENABLED_PAYMENT_PLANS: "plan" });
  assert.equal(selectivelyDisabled.status, 503);
  assert.equal((await selectivelyDisabled.json()).code, "payment_plan_unavailable");
  assert.equal(DB.orders.length, 0);

  const unavailableEnv = { ...env, RAZORPAY_KEY_SECRET: "" };
  const unavailable = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "missing-config-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), unavailableEnv);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, "payments_unavailable");
  assert.equal(DB.orders.length, 0);

  const noCsrf = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "x-csrf-token": "", "idempotency-key": "missing-csrf-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).code, "csrf_rejected");

  const withoutStorage = { ...env, FILES: undefined };
  const storageRequired = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "missing-storage-0001" }),
    body: JSON.stringify({ plan: "site_plus" }),
  }), withoutStorage);
  assert.equal(storageRequired.status, 503);
  assert.equal((await storageRequired.json()).code, "fulfillment_unavailable");
  assert.equal(DB.orders.length, 0);
  assert.equal(DB.snapshots.length, 0);
});

test("signed paid webhook atomically pays once; redirect state is irrelevant", async () => {
  const { env, DB } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "webhook-attempt-0001" }),
    body: JSON.stringify({ plan: "site_plus" }),
  }), env);
  const order = (await created.json()).order;
  const payload = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_TEST1", order_id: "order_TEST1", reference_id: order.id, status: "paid", amount_paid: 99_900, currency: "INR" } },
      payment: { entity: { id: "pay_TEST1", order_id: "order_TEST1", status: "captured", captured: true, amount: 99_900, currency: "INR" } },
    },
  });
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const deliver = () => worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "content-type": "application/json", "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_paid_0001" },
    body: payload,
  }), env);

  const first = await deliver();
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { received: true, duplicate: false, result: "paid" });
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].provider_payment_id, "pay_TEST1");
  assert.equal(DB.events.length, 1);
  assert.equal(DB.snapshots.length, 1);
  assert.equal(DB.snapshots[0].order_id, order.id);
  assert.equal(DB.fulfillments.length, 1);
  assert.equal(DB.fulfillments[0].status, "awaiting_input");
  assert.equal(DB.fulfillments[0].snapshot_id, DB.snapshots[0].id);

  const duplicate = await deliver();
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).duplicate, true);
  assert.equal(DB.events.length, 1);
  assert.equal(DB.fulfillments.length, 1);
});

test("generic payment.captured safely resolves the provider's internal order id", async () => {
  const { env, DB } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "captured-attempt-0001" }),
    body: JSON.stringify({ plan: "expert" }),
  }), env);
  assert.equal(created.status, 201);
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_CAPTURED1",
      order_id: "order_TEST1",
      status: "captured",
      captured: true,
      amount: 349_900,
      currency: "INR",
      notes: [],
    } } },
  });
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const response = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_captured_0001" },
    body: payload,
  }), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).result, "paid");
  assert.equal(DB.orders[0].status, "paid");
  assert.equal(DB.orders[0].provider_payment_id, "pay_CAPTURED1");
  assert.equal(DB.fulfillments[0].status, "queued");
  assert.equal(DB.fulfillments[0].status_reason, "expert_review_queue");
  assert.equal(DB.projects[0].status, "expert_review");
});

test("a verified Plan Pack payment exposes exactly one immutable owner-scoped report artifact", async () => {
  const { env, DB, providerCalls } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "artifact-attempt-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  const order = (await created.json()).order;
  assert.equal(DB.snapshots.length, 1);
  const frozenReport = DB.snapshots[0].report_json;

  // Later edits to the mutable project/report cannot alter the purchased row.
  DB.projects[0].name = "Changed after checkout";
  const payload = JSON.stringify({
    event: "payment_link.paid",
    payload: {
      payment_link: { entity: { id: "plink_TEST1", order_id: "order_TEST1", reference_id: order.id, status: "paid", amount_paid: 49_900, currency: "INR" } },
      payment: { entity: { id: "pay_ARTIFACT1", order_id: "order_TEST1", status: "captured", captured: true, amount: 49_900, currency: "INR" } },
    },
  });
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const paid = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_artifact_0001" },
    body: payload,
  }), env);
  assert.equal(paid.status, 200);
  assert.equal(DB.snapshots[0].report_json, frozenReport);
  assert.equal(DB.fulfillments.length, 1);
  assert.equal(DB.fulfillments[0].status, "ready");

  const read = await worker.fetch(appRequest(`/api/orders/${order.id}/fulfillment`, { headers: authHeaders() }), env);
  assert.equal(read.status, 200);
  const body = await read.json();
  assert.equal(body.order.status, "paid");
  assert.equal(body.order.checkoutUrl, null);
  assert.equal(body.fulfillment.status, "ready");
  assert.equal(body.artifact.type, "purchased_report_snapshot");
  assert.equal(body.artifact.report.title, "A — feasibility report");

  const replayWithNewKey = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "artifact-attempt-0002" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  assert.equal(replayWithNewKey.status, 200);
  const replayBody = await replayWithNewKey.json();
  assert.equal(replayBody.reusedExisting, true);
  assert.equal(replayBody.checkoutUrl, null);
  assert.equal(providerCalls.length, 1);
});

test("a verified payment is not acknowledged when its immutable snapshot is missing", async () => {
  const { env, DB } = await fixture();
  const created = await worker.fetch(appRequest("/api/projects/project-a/orders", {
    method: "POST",
    headers: authHeaders({ "idempotency-key": "missing-snapshot-0001" }),
    body: JSON.stringify({ plan: "plan" }),
  }), env);
  const order = (await created.json()).order;
  DB.snapshots = [];
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_NOSNAPSHOT", order_id: "order_TEST1", status: "captured", captured: true, amount: 49_900, currency: "INR",
    } } },
  });
  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const response = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_missing_snapshot" },
    body: payload,
  }), env);
  assert.equal(response.status, 500);
  assert.equal((await response.json()).code, "purchase_snapshot_missing");
  assert.equal(DB.orders[0].status, "created");
  assert.equal(DB.events.length, 0);
  assert.equal(DB.fulfillments.length, 0);
  assert.equal(order.status, "created");
});

test("webhook rejects bad signatures and never pays amount/currency mismatches", async () => {
  const { env, DB } = await fixture();
  DB.orders.push({
    id: "order-safe", project_id: "project-a", user_id: "user-a", plan: "plan", amount_paise: 49_900,
    currency: "INR", idempotency_key: "scoped", status: "created", provider_order_id: "plink_SAFE",
    provider_checkout_order_id: "order_SAFE",
    provider_payment_id: null, checkout_url: "https://rzp.io/i/safe", provider_status: "created",
    provider_error_code: null, paid_at: null, created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00",
  });
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: {
      id: "pay_WRONG", order_id: "order_SAFE", status: "captured", captured: true, amount: 1, currency: "INR",
    } } },
  });
  const invalid = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_bad_sig" },
    body: payload,
  }), env);
  assert.equal(invalid.status, 401);
  assert.equal(DB.events.length, 0);

  const signature = await __test.hmacSha256Hex(env.RAZORPAY_WEBHOOK_SECRET, new TextEncoder().encode(payload));
  const mismatch = await worker.fetch(appRequest("/api/payments/razorpay/webhook", {
    method: "POST",
    headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": "evt_amount_mismatch" },
    body: payload,
  }), env);
  assert.equal(mismatch.status, 200);
  assert.equal((await mismatch.json()).result, "amount_mismatch");
  assert.equal(DB.orders[0].status, "created");
});

test("order reads are always scoped to the authenticated owner", async () => {
  const { env, DB } = await fixture();
  DB.orders.push({
    id: "other-order", project_id: "project-b", user_id: "user-b", plan: "expert", amount_paise: 349_900,
    currency: "INR", status: "created", checkout_url: null, provider_payment_id: null, paid_at: null,
    provider_checkout_order_id: null,
    created_at: "2026-08-13 00:00:00", updated_at: "2026-08-13 00:00:00",
  });
  const response = await worker.fetch(appRequest("/api/orders/other-order", { headers: authHeaders() }), env);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).code, "order_not_found");
});

test("project deletion preflights payment history before any file deletion", async () => {
  const calls = [];
  const db = {
    prepare(sql) {
      calls.push(sql);
      assert.equal(sql, "SELECT id FROM orders WHERE project_id=? LIMIT 1");
      return {
        bind(projectId) {
          assert.equal(projectId, "project-with-order");
          return { first: async () => ({ id: "order-existing" }) };
        },
      };
    },
  };
  await assert.rejects(
    () => __test.ensureProjectDeletable(db, "project-with-order"),
    /archive it instead/u,
  );
  assert.equal(calls.length, 1);
});
