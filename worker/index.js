const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "content-type,idempotency-key,x-csrf-token,x-file-name,x-file-kind",
  "access-control-max-age": "86400",
};
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const SESSION_COOKIE = "__Host-grihagrid_session";
const CSRF_COOKIE = "grihagrid_csrf";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
// Cloudflare Workers Web Crypto currently caps PBKDF2 at 100,000 rounds.
// The per-user salt and versioned algorithm fields permit a future managed-
// identity or Argon2 migration without invalidating existing accounts.
const PASSWORD_ITERATIONS = 100_000;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const REPORT_VERSION = 1;
const PURCHASE_SNAPSHOT_VERSION = 1;
const PAYMENT_PROVIDER_TIMEOUT_MS = 10_000;

const PAYMENT_PLANS = Object.freeze({
  plan: Object.freeze({
    amountPaise: 49_900,
    label: "Plan Pack",
    displayPrice: "₹499",
    requiresStorage: false,
    fulfillmentStatus: "ready",
    fulfillmentReason: "baseline_report_ready",
  }),
  site_plus: Object.freeze({
    amountPaise: 99_900,
    label: "Site Plus",
    displayPrice: "₹999",
    requiresStorage: true,
    fulfillmentStatus: "awaiting_input",
    fulfillmentReason: "awaiting_site_materials",
  }),
  expert: Object.freeze({
    amountPaise: 349_900,
    label: "Expert Review",
    displayPrice: "₹3,499",
    requiresStorage: true,
    fulfillmentStatus: "queued",
    fulfillmentReason: "expert_review_queue",
  }),
});
const RAZORPAY_PAYMENT_LINKS_URL = "https://api.razorpay.com/v1/payment_links/";

const FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const FILE_KINDS = new Set(["site-plan", "survey", "reference", "inspiration", "document", "other"]);

class HttpError extends Error {
  constructor(status, message, code = "request_error") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function secure(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function empty(status = 204, headers = {}) {
  return new Response(null, { status, headers });
}

function publicJson(data, status = 200, headers = {}) {
  return json(data, status, { ...CORS_HEADERS, ...headers });
}

function withCookies(response, cookies) {
  const headers = new Headers(response.headers);
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function sessionCookies(sessionToken, csrfToken, maxAge = SESSION_TTL_SECONDS) {
  return [
    `${SESSION_COOKIE}=${sessionToken}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`,
    `${CSRF_COOKIE}=${csrfToken}; Path=/; Max-Age=${maxAge}; Secure; SameSite=Strict`,
  ];
}

function clearSessionCookies() {
  return [
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Strict`,
  ];
}

function parseCookies(request) {
  const cookies = {};
  for (const part of (request.headers.get("cookie") || "").split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function trustedOrigins(request, env) {
  const origins = new Set([new URL(request.url).origin]);
  const configured = [env.APP_ORIGIN, env.ALLOWED_ORIGINS]
    .filter(Boolean)
    .flatMap((value) => String(value).split(","));
  for (const value of configured) {
    try {
      origins.add(new URL(value.trim()).origin);
    } catch {
      // Ignore malformed deployment configuration rather than trusting it.
    }
  }
  return origins;
}

function requireTrustedOrigin(request, env) {
  const origin = request.headers.get("origin");
  if (origin && trustedOrigins(request, env).has(origin)) return;
  if (!origin && request.headers.get("sec-fetch-site") === "same-origin") return;
  throw new HttpError(403, "request origin is not allowed", "origin_rejected");
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    throw new HttpError(415, "content-type must be application/json", "unsupported_media_type");
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_JSON_BYTES) throw new HttpError(413, "request body is too large", "payload_too_large");
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BYTES) {
    throw new HttpError(413, "request body is too large", "payload_too_large");
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new HttpError(400, "invalid JSON body", "invalid_json");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new HttpError(400, "JSON body must be an object", "invalid_json");
  }
  return data;
}

function requireDatabase(env) {
  if (!env.DB) throw new HttpError(503, "database is not configured", "database_unavailable");
  return env.DB;
}

function requireFileStore(env) {
  if (!env.FILES) throw new HttpError(503, "file storage is not configured", "storage_unavailable");
  return env.FILES;
}

function computeEstimate(input) {
  const width = Number(input.width);
  const length = Number(input.length);
  const floorFactors = { G: 0.72, "G+1": 1.22, "G+2": 1.65 };
  const rates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };
  const cityFactors = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: 0.98, Chennai: 1.02, Jaipur: 0.88, Other: 0.95 };
  if (!Number.isFinite(width) || !Number.isFinite(length) || width < 10 || length < 10 || width > 500 || length > 500) {
    throw new HttpError(400, "plot dimensions must be between 10 and 500 feet", "invalid_dimensions");
  }
  const floors = floorFactors[input.floors] ? input.floors : "G+1";
  const quality = rates[input.quality] ? input.quality : "Signature";
  const city = cityFactors[input.city] ? input.city : "Other";
  const builtUpSqft = Math.round(width * length * floorFactors[floors]);
  const midpoint = builtUpSqft * rates[quality] * cityFactors[city];
  return {
    plotSqft: width * length,
    builtUpSqft,
    lowInr: Math.round(midpoint * 0.92),
    highInr: Math.round(midpoint * 1.1),
    floors,
    quality,
    city,
    disclaimer: "Indicative concept-stage estimate; not a contractor quote.",
  };
}

function toBase64Url(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function fromBase64Url(value) {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomToken(byteLength = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function digestBytes(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function digestBase64(value) {
  return toBase64Url(await digestBytes(value));
}

async function digestHex(value) {
  return [...await digestBytes(value)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function constantTimeEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function derivePassword(password, salt, iterations = PASSWORD_ITERATIONS) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

async function makePasswordRecord(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt);
  return {
    hash: toBase64Url(hash),
    salt: toBase64Url(salt),
    iterations: PASSWORD_ITERATIONS,
    algorithm: "PBKDF2-SHA256",
  };
}

async function verifyPassword(password, user) {
  const validRecord = user.password_hash && user.password_salt && user.password_algorithm === "PBKDF2-SHA256";
  const iterations = Number(user.password_iterations);
  if (!validRecord || !Number.isSafeInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) {
    await derivePassword(password, new TextEncoder().encode("grihagrid-invalid-password-record"));
    return false;
  }
  try {
    const candidate = await derivePassword(password, fromBase64Url(user.password_salt), iterations);
    return constantTimeEqual(candidate, fromBase64Url(user.password_hash));
  } catch {
    return false;
  }
}

function sqliteTimestamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function publicUser(row) {
  return {
    id: row.user_id || row.id,
    email: row.email,
    name: row.name || null,
    createdAt: row.user_created_at || row.created_at,
  };
}

function normalizeEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new HttpError(400, "valid email required", "invalid_email");
  }
  return email;
}

function normalizePassword(value) {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    throw new HttpError(400, "password must be between 10 and 128 characters", "invalid_password");
  }
  return value;
}

function requestIp(request) {
  return (request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for")?.split(",")[0] || "unknown").trim().slice(0, 80);
}

async function rateLimit(request, env, scope, limit, windowSeconds) {
  if (!env.GRIHAGRID_CACHE) return;
  const window = Math.floor(Date.now() / (windowSeconds * 1000));
  const identity = await digestBase64(`${scope}:${requestIp(request)}`);
  const key = `rate:${scope}:${window}:${identity}`;
  const attempts = Number(await env.GRIHAGRID_CACHE.get(key) || 0) + 1;
  await env.GRIHAGRID_CACHE.put(key, String(attempts), { expirationTtl: windowSeconds * 2 });
  if (attempts > limit) throw new HttpError(429, "too many attempts; please try again later", "rate_limited");
}

function paymentPlan(value) {
  const plan = String(value || "").trim();
  const price = PAYMENT_PLANS[plan];
  if (!price) throw new HttpError(400, "plan must be one of: plan, site_plus, expert", "invalid_plan");
  return { plan, ...price };
}

function requireEnabledPaymentPlan(env, selected) {
  const configured = enabledPaymentPlans(env);
  if (!configured.includes(selected.plan)) {
    throw new HttpError(503, "this paid plan is not accepting orders yet", "payment_plan_unavailable");
  }
}

function enabledPaymentPlans(env) {
  const configured = String(env.ENABLED_PAYMENT_PLANS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (configured.some((plan) => !PAYMENT_PLANS[plan])) {
    throw new HttpError(503, "payment plan configuration is invalid", "payments_unavailable");
  }
  return [...new Set(configured)];
}

function commerceCatalog(env) {
  let enabled = [];
  try { enabled = enabledPaymentPlans(env); } catch { /* Public catalog stays fail-closed for invalid config. */ }
  return Object.entries(PAYMENT_PLANS).map(([id, plan]) => {
    const prerequisitesReady = Boolean(env.GRIHAGRID_CACHE)
      && Boolean(String(env.RAZORPAY_KEY_ID || "").trim())
      && Boolean(String(env.RAZORPAY_KEY_SECRET || ""))
      && (!plan.requiresStorage || Boolean(env.FILES));
    return {
      id,
      label: plan.label,
      amountPaise: plan.amountPaise,
      currency: "INR",
      taxInclusive: true,
      displayPrice: plan.displayPrice,
      acceptingOrders: enabled.includes(id) && prerequisitesReady,
    };
  });
}

function normalizeIdempotencyKey(request) {
  const key = String(request.headers.get("idempotency-key") || "").trim();
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:~-]+$/u.test(key)) {
    throw new HttpError(400, "a valid Idempotency-Key header (8-128 characters) is required", "invalid_idempotency_key");
  }
  return key;
}

async function scopedIdempotencyKey(userId, key) {
  return digestBase64(`checkout:${userId}:${key}`);
}

function requirePaymentConfig(env) {
  const keyId = String(env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = String(env.RAZORPAY_KEY_SECRET || "");
  const configuredOrigin = String(env.APP_ORIGIN || "").split(",", 1)[0].trim();
  let appOrigin;
  try {
    const parsed = new URL(configuredOrigin);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("invalid origin");
    appOrigin = parsed.origin;
  } catch {
    throw new HttpError(503, "payments are not configured", "payments_unavailable");
  }
  if (!keyId || !keySecret || keyId.length > 128 || keySecret.length > 256) {
    throw new HttpError(503, "payments are not configured", "payments_unavailable");
  }
  return { keyId, keySecret, appOrigin };
}

function requireWebhookSecret(env) {
  const secret = String(env.RAZORPAY_WEBHOOK_SECRET || "");
  if (!secret || secret.length > 256) {
    throw new HttpError(503, "payments are not configured", "payments_unavailable");
  }
  return secret;
}

function standardBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

function orderFromRow(row) {
  const plan = PAYMENT_PLANS[row.plan] || { label: row.plan, displayPrice: null };
  return {
    id: row.id,
    projectId: row.project_id,
    plan: row.plan,
    planLabel: plan.label,
    amountPaise: Number(row.amount_paise),
    currency: row.currency,
    taxInclusive: true,
    displayPrice: plan.displayPrice,
    status: row.status,
    checkoutUrl: row.status === "created" ? row.checkout_url || null : null,
    providerPaymentId: row.provider_payment_id || null,
    paidAt: row.paid_at || null,
    fulfillment: fulfillmentFromRow(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function fulfillmentFromRow(row) {
  if (!row?.fulfillment_id) return null;
  return {
    id: row.fulfillment_id,
    status: row.fulfillment_status,
    statusReason: row.fulfillment_status_reason || null,
    snapshotId: row.fulfillment_snapshot_id,
    snapshotVersion: row.snapshot_schema_version == null ? null : Number(row.snapshot_schema_version),
    reportVersion: row.snapshot_report_version == null ? null : Number(row.snapshot_report_version),
    createdAt: row.fulfillment_created_at,
    updatedAt: row.fulfillment_updated_at,
    readyAt: row.fulfillment_ready_at || null,
  };
}

const ORDER_FULFILLMENT_COLUMNS = `o.*,
  f.id AS fulfillment_id,f.status AS fulfillment_status,f.status_reason AS fulfillment_status_reason,
  f.snapshot_id AS fulfillment_snapshot_id,f.created_at AS fulfillment_created_at,
  f.updated_at AS fulfillment_updated_at,f.ready_at AS fulfillment_ready_at,
  s.snapshot_schema_version AS snapshot_schema_version,s.report_version AS snapshot_report_version`;

async function idempotentOrder(db, userId, scopedKey) {
  return db.prepare(
    `SELECT ${ORDER_FULFILLMENT_COLUMNS}
       FROM orders o
       LEFT JOIN order_fulfillments f ON f.order_id=o.id
       LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
      WHERE o.user_id=? AND o.idempotency_key=?`,
  ).bind(userId, scopedKey).first();
}

function idempotentOrderResponse(row, projectId, plan) {
  if (row.project_id !== projectId || row.plan !== plan) {
    throw new HttpError(409, "this Idempotency-Key was already used for a different checkout", "idempotency_conflict");
  }
  if (row.status === "failed" && !row.checkout_url) {
    throw new HttpError(409, "the previous checkout attempt failed; retry with a new Idempotency-Key", "checkout_failed");
  }
  const checkoutUrl = row.status === "created" ? row.checkout_url || null : null;
  const status = checkoutUrl || row.status === "paid" ? 200 : 202;
  return json({ order: orderFromRow(row), checkoutUrl, idempotentReplay: true }, status);
}

async function activeOrder(db, userId, projectId, plan) {
  return db.prepare(
    `SELECT ${ORDER_FULFILLMENT_COLUMNS}
       FROM orders o
       LEFT JOIN order_fulfillments f ON f.order_id=o.id
       LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
      WHERE o.user_id=? AND o.project_id=? AND o.plan=? AND o.status IN ('created','paid')
      ORDER BY CASE o.status WHEN 'paid' THEN 0 ELSE 1 END,o.created_at DESC,o.id DESC
      LIMIT 1`,
  ).bind(userId, projectId, plan).first();
}

function existingActiveOrderResponse(row) {
  const checkoutUrl = row.status === "created" ? row.checkout_url || null : null;
  const status = checkoutUrl || row.status === "paid" ? 200 : 202;
  return json({ order: orderFromRow(row), checkoutUrl, reusedExisting: true }, status);
}

async function makePurchasedSnapshot(db, project, userId, orderId, now) {
  const input = parseStoredJson(project.input_json, {});
  const estimate = parseStoredJson(project.estimate_json, null);
  const inputHash = await digestHex(stableStringify({ version: REPORT_VERSION, input, estimate }));
  const existing = await db.prepare("SELECT * FROM reports WHERE project_id=? AND user_id=?")
    .bind(project.id, userId).first();
  const existingContent = existing?.input_hash === inputHash ? parseStoredJson(existing.content_json, null) : null;
  const snapshotId = crypto.randomUUID();
  const report = existingContent || buildReport(project, inputHash, snapshotId, now);
  return {
    id: snapshotId,
    orderId,
    projectId: project.id,
    userId,
    sourceReportId: existingContent ? existing.id : null,
    reportVersion: existingContent ? Number(existing.version) || REPORT_VERSION : REPORT_VERSION,
    inputHash,
    projectName: project.name,
    inputJson: JSON.stringify(input),
    estimateJson: estimate == null ? null : JSON.stringify(estimate),
    reportJson: JSON.stringify(report),
    projectUpdatedAt: project.updated_at,
    createdAt: now,
  };
}

function insertSnapshotStatement(db, snapshot) {
  return db.prepare(
    `INSERT INTO purchased_report_snapshots
       (id,order_id,project_id,user_id,source_report_id,snapshot_schema_version,report_version,input_hash,
        project_name,input_json,estimate_json,report_json,project_updated_at,created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).bind(
    snapshot.id,
    snapshot.orderId,
    snapshot.projectId,
    snapshot.userId,
    snapshot.sourceReportId,
    PURCHASE_SNAPSHOT_VERSION,
    snapshot.reportVersion,
    snapshot.inputHash,
    snapshot.projectName,
    snapshot.inputJson,
    snapshot.estimateJson,
    snapshot.reportJson,
    snapshot.projectUpdatedAt,
    snapshot.createdAt,
  );
}

function safeProviderErrorCode(status) {
  return Number.isInteger(status) && status >= 400 && status <= 599 ? `http_${status}` : "provider_request_failed";
}

async function markOrderProviderFailure(db, orderId, userId, code) {
  const now = sqliteTimestamp();
  try {
    await db.prepare(
      "UPDATE orders SET status='failed',provider_status='request_failed',provider_error_code=?,updated_at=? WHERE id=? AND user_id=? AND status='created'",
    ).bind(String(code).slice(0, 64), now, orderId, userId).run();
  } catch (error) {
    console.error("Could not persist payment provider failure", { orderId, error: String(error?.message || error) });
  }
}

function validCheckoutUrl(value) {
  try {
    const url = new URL(String(value || ""));
    const trustedHost = url.hostname === "rzp.io" || url.hostname === "razorpay.com" || url.hostname.endsWith(".razorpay.com");
    return url.protocol === "https:" && trustedHost ? url.toString() : null;
  } catch {
    return null;
  }
}

async function createOrder(request, env, projectId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  const body = await readJson(request);
  const selected = paymentPlan(body.plan);
  requireEnabledPaymentPlan(env, selected);
  if (selected.requiresStorage && !env.FILES) {
    throw new HttpError(503, "this plan requires private file storage before checkout can open", "fulfillment_unavailable");
  }
  const config = requirePaymentConfig(env);
  if (!env.GRIHAGRID_CACHE) throw new HttpError(503, "payments are not configured", "payments_unavailable");
  await rateLimit(request, env, `checkout:${session.user_id}`, 10, 10 * 60);

  const rawKey = normalizeIdempotencyKey(request);
  const scopedKey = await scopedIdempotencyKey(session.user_id, rawKey);
  const project = await ownedProject(db, projectId, session.user_id);
  if (project.status === "archived") {
    throw new HttpError(409, "restore the project before purchasing a report", "project_archived");
  }

  const previous = await idempotentOrder(db, session.user_id, scopedKey);
  if (previous) return idempotentOrderResponse(previous, projectId, selected.plan);

  const reusable = await activeOrder(db, session.user_id, projectId, selected.plan);
  if (reusable) return existingActiveOrderResponse(reusable);

  const id = crypto.randomUUID();
  const now = sqliteTimestamp();
  const snapshot = await makePurchasedSnapshot(db, project, session.user_id, id, now);
  try {
    await db.batch([db.prepare(
      `INSERT INTO orders (id,project_id,user_id,plan,amount_paise,currency,idempotency_key,status,created_at,updated_at,provider_status)
       VALUES (?,?,?,?,?,'INR',?,'created',?,?,?)`,
    ).bind(id, projectId, session.user_id, selected.plan, selected.amountPaise, scopedKey, now, now, "creating"), insertSnapshotStatement(db, snapshot)]);
  } catch (error) {
    const raced = await idempotentOrder(db, session.user_id, scopedKey);
    if (raced) return idempotentOrderResponse(raced, projectId, selected.plan);
    const activeRace = await activeOrder(db, session.user_id, projectId, selected.plan);
    if (activeRace) return existingActiveOrderResponse(activeRace);
    throw error;
  }

  const callback = new URL("/checkout/return", config.appOrigin);
  callback.searchParams.set("order", id);
  const providerPayload = {
    amount: selected.amountPaise,
    currency: "INR",
    accept_partial: false,
    reference_id: id,
    description: `GrihaGrid ${selected.label} — ${selected.displayPrice}, inclusive of applicable taxes`,
    customer: { email: session.email },
    notify: { sms: false, email: false },
    reminder_enable: false,
    callback_url: callback.toString(),
    callback_method: "get",
    expire_by: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
    notes: {
      grihagrid_order_id: id,
      grihagrid_project_id: projectId,
      grihagrid_plan: selected.plan,
    },
  };

  let providerResponse;
  try {
    const providerFetch = typeof env.RAZORPAY_FETCH === "function" ? env.RAZORPAY_FETCH : fetch;
    providerResponse = await providerFetch(RAZORPAY_PAYMENT_LINKS_URL, {
      method: "POST",
      headers: {
        authorization: `Basic ${standardBase64(`${config.keyId}:${config.keySecret}`)}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(providerPayload),
      signal: AbortSignal.timeout(PAYMENT_PROVIDER_TIMEOUT_MS),
    });
  } catch {
    await markOrderProviderFailure(db, id, session.user_id, "network_error");
    throw new HttpError(502, "payment provider could not create checkout", "payment_provider_error");
  }

  if (!providerResponse.ok) {
    await markOrderProviderFailure(db, id, session.user_id, safeProviderErrorCode(providerResponse.status));
    throw new HttpError(502, "payment provider could not create checkout", "payment_provider_error");
  }

  let provider;
  try {
    provider = await providerResponse.json();
  } catch {
    await markOrderProviderFailure(db, id, session.user_id, "invalid_response");
    throw new HttpError(502, "payment provider returned an invalid checkout", "payment_provider_error");
  }
  const providerId = String(provider?.id || "");
  const providerCheckoutOrderId = providerIdentifier(provider?.order_id, "order_");
  const checkoutUrl = validCheckoutUrl(provider?.short_url);
  if (!/^plink_[A-Za-z0-9]+$/u.test(providerId) || !checkoutUrl) {
    await markOrderProviderFailure(db, id, session.user_id, "invalid_response");
    throw new HttpError(502, "payment provider returned an invalid checkout", "payment_provider_error");
  }

  const updatedAt = sqliteTimestamp();
  await db.prepare(
    `UPDATE orders SET provider_order_id=?,provider_checkout_order_id=?,checkout_url=?,provider_status=?,provider_error_code=NULL,updated_at=?
      WHERE id=? AND user_id=? AND status='created'`,
  ).bind(providerId, providerCheckoutOrderId, checkoutUrl, String(provider.status || "created").slice(0, 64), updatedAt, id, session.user_id).run();
  const order = await db.prepare("SELECT * FROM orders WHERE id=? AND user_id=?").bind(id, session.user_id).first();
  return json({ order: orderFromRow(order), checkoutUrl }, 201);
}

async function listOrders(request, env, url) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  const requestedLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isSafeInteger(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 50;
  const projectId = url.searchParams.get("projectId");
  let statement;
  if (projectId) {
    statement = db.prepare(
      `SELECT ${ORDER_FULFILLMENT_COLUMNS}
         FROM orders o
         LEFT JOIN order_fulfillments f ON f.order_id=o.id
         LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
        WHERE o.user_id=? AND o.project_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT ?`,
    )
      .bind(session.user_id, projectId.slice(0, 128), limit);
  } else {
    statement = db.prepare(
      `SELECT ${ORDER_FULFILLMENT_COLUMNS}
         FROM orders o
         LEFT JOIN order_fulfillments f ON f.order_id=o.id
         LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
        WHERE o.user_id=? ORDER BY o.created_at DESC,o.id DESC LIMIT ?`,
    )
      .bind(session.user_id, limit);
  }
  const result = await statement.all();
  return json({ orders: (result.results || []).map(orderFromRow) });
}

async function getOrder(request, env, orderId) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  const row = await db.prepare(
    `SELECT ${ORDER_FULFILLMENT_COLUMNS}
       FROM orders o
       LEFT JOIN order_fulfillments f ON f.order_id=o.id
       LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
      WHERE o.id=? AND o.user_id=?`,
  ).bind(orderId, session.user_id).first();
  if (!row) throw new HttpError(404, "order not found", "order_not_found");
  return json({ order: orderFromRow(row) });
}

async function getOrderFulfillment(request, env, orderId) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  const row = await db.prepare(
    `SELECT ${ORDER_FULFILLMENT_COLUMNS},
            s.input_hash AS snapshot_input_hash,s.report_json AS snapshot_report_json,
            s.project_updated_at AS snapshot_project_updated_at,s.created_at AS snapshot_created_at
       FROM orders o
       LEFT JOIN order_fulfillments f ON f.order_id=o.id
       LEFT JOIN purchased_report_snapshots s ON s.id=f.snapshot_id
      WHERE o.id=? AND o.user_id=?`,
  ).bind(orderId, session.user_id).first();
  if (!row) throw new HttpError(404, "order not found", "order_not_found");
  const fulfillment = fulfillmentFromRow(row);
  const artifact = fulfillment?.status === "ready"
    ? {
      type: "purchased_report_snapshot",
      snapshotId: row.fulfillment_snapshot_id,
      snapshotVersion: Number(row.snapshot_schema_version),
      reportVersion: Number(row.snapshot_report_version),
      inputHash: row.snapshot_input_hash,
      projectUpdatedAt: row.snapshot_project_updated_at,
      createdAt: row.snapshot_created_at,
      report: parseStoredJson(row.snapshot_report_json, null),
    }
    : null;
  if (fulfillment?.status === "ready" && !artifact.report) {
    throw new HttpError(500, "purchased report artifact is unavailable", "artifact_unavailable");
  }
  return json({ order: orderFromRow(row), fulfillment, artifact });
}

async function readBoundedWebhookBody(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) throw new HttpError(413, "webhook body is too large", "payload_too_large");
  const buffer = await request.arrayBuffer();
  if (buffer.byteLength > MAX_WEBHOOK_BYTES) throw new HttpError(413, "webhook body is too large", "payload_too_large");
  return new Uint8Array(buffer);
}

function fromHex(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(normalized)) return null;
  const bytes = new Uint8Array(normalized.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

async function hmacSha256Hex(secret, bytes) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
  return [...signature].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verifyRazorpaySignature(secret, bytes, suppliedSignature) {
  const supplied = fromHex(suppliedSignature);
  if (!supplied) return false;
  return constantTimeEqual(fromHex(await hmacSha256Hex(secret, bytes)), supplied);
}

function providerIdentifier(value, prefix = null) {
  const identifier = typeof value === "string" ? value.trim() : "";
  if (!identifier || identifier.length > 160 || !/^[A-Za-z0-9_-]+$/u.test(identifier)) return null;
  if (prefix && !identifier.startsWith(prefix)) return null;
  return identifier;
}

function webhookPaymentDetails(payload) {
  const eventType = typeof payload?.event === "string" ? payload.event.slice(0, 100) : "unknown";
  if (!["payment_link.paid", "payment.captured"].includes(eventType)) {
    return { eventType, supported: false };
  }
  const link = payload?.payload?.payment_link?.entity || null;
  const payment = payload?.payload?.payment?.entity || null;
  const notes = payment?.notes && typeof payment.notes === "object" ? payment.notes : {};
  const orderId = providerIdentifier(link?.reference_id || notes.grihagrid_order_id);
  const providerLinkId = providerIdentifier(link?.id || payment?.payment_link_id, "plink_");
  const providerCheckoutOrderId = providerIdentifier(payment?.order_id || link?.order_id, "order_");
  const providerPaymentId = providerIdentifier(payment?.id, "pay_");
  const amount = Number(payment?.amount ?? link?.amount_paid ?? link?.amount);
  const currency = String(payment?.currency || link?.currency || "").toUpperCase();
  const providerState = eventType === "payment_link.paid" ? String(link?.status || "") : String(payment?.status || "");
  const stateIsPaid = eventType === "payment_link.paid"
    ? providerState === "paid"
    : providerState === "captured" || payment?.captured === true;
  return {
    eventType,
    supported: true,
    orderId,
    providerLinkId,
    providerCheckoutOrderId,
    providerPaymentId,
    amount: Number.isSafeInteger(amount) ? amount : null,
    currency,
    providerState,
    stateIsPaid,
  };
}

async function findWebhookOrder(db, details) {
  let byReference = null;
  let byProvider = null;
  let byCheckoutOrder = null;
  if (details.orderId) byReference = await db.prepare("SELECT * FROM orders WHERE id=?").bind(details.orderId).first();
  if (details.providerLinkId) byProvider = await db.prepare("SELECT * FROM orders WHERE provider_order_id=?").bind(details.providerLinkId).first();
  if (details.providerCheckoutOrderId) {
    byCheckoutOrder = await db.prepare("SELECT * FROM orders WHERE provider_checkout_order_id=?").bind(details.providerCheckoutOrderId).first();
  }
  const matchedIds = new Set([byReference?.id, byProvider?.id, byCheckoutOrder?.id].filter(Boolean));
  if (matchedIds.size > 1) {
    return { order: null, conflict: true };
  }
  const order = byReference || byProvider || byCheckoutOrder;
  if (order?.provider_order_id && details.providerLinkId && order.provider_order_id !== details.providerLinkId) {
    return { order: null, conflict: true };
  }
  if (order?.provider_checkout_order_id && details.providerCheckoutOrderId && order.provider_checkout_order_id !== details.providerCheckoutOrderId) {
    return { order: null, conflict: true };
  }
  return { order, conflict: false };
}

async function activeSiblingOrder(db, order) {
  if (!order?.user_id) return null;
  return db.prepare(
    `SELECT id,status FROM orders
      WHERE user_id=? AND project_id=? AND plan=? AND id!=? AND status IN ('created','paid')
      LIMIT 1`,
  ).bind(order.user_id, order.project_id, order.plan, order.id).first();
}

async function existingWebhookEvent(db, eventId) {
  return db.prepare("SELECT provider_event_id,payload_sha256,processing_result FROM payment_webhook_events WHERE provider_event_id=?")
    .bind(eventId).first();
}

function insertFulfillmentStatement(db, order, snapshotId, now) {
  const plan = PAYMENT_PLANS[order.plan];
  if (!plan) throw new HttpError(500, "order has an invalid fulfillment plan", "invalid_order_plan");
  return db.prepare(
    `INSERT INTO order_fulfillments
       (id,order_id,snapshot_id,project_id,user_id,plan,status,status_reason,created_at,updated_at,ready_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(order_id) DO NOTHING`,
  ).bind(
    crypto.randomUUID(),
    order.id,
    snapshotId,
    order.project_id,
    order.user_id,
    order.plan,
    plan.fulfillmentStatus,
    plan.fulfillmentReason,
    now,
    now,
    plan.fulfillmentStatus === "ready" ? now : null,
  );
}

async function razorpayWebhook(request, env) {
  const db = requireDatabase(env);
  const secret = requireWebhookSecret(env);
  const bytes = await readBoundedWebhookBody(request);
  if (!await verifyRazorpaySignature(secret, bytes, request.headers.get("x-razorpay-signature"))) {
    throw new HttpError(401, "invalid webhook signature", "invalid_webhook_signature");
  }

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid webhook JSON", "invalid_json");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new HttpError(400, "invalid webhook JSON", "invalid_json");
  }

  const payloadHash = await digestHex(bytes);
  const suppliedEventId = request.headers.get("x-razorpay-event-id") || payload.id;
  const eventId = providerIdentifier(suppliedEventId) || `body_${payloadHash}`;
  const replay = await existingWebhookEvent(db, eventId);
  if (replay) {
    if (replay.payload_sha256 !== payloadHash) {
      throw new HttpError(409, "webhook event id was replayed with different content", "webhook_event_conflict");
    }
    return json({ received: true, duplicate: true, result: replay.processing_result });
  }

  const details = webhookPaymentDetails(payload);
  let order = null;
  let processingResult = "ignored_event";
  let shouldMarkPaid = false;
  let shouldEnsureFulfillment = false;
  if (details.supported) {
    const located = await findWebhookOrder(db, details);
    order = located.order;
    if (located.conflict) {
      processingResult = "reference_mismatch";
    } else if (!order) {
      processingResult = "unmatched";
    } else if (!details.stateIsPaid || !details.providerPaymentId) {
      processingResult = "invalid_payment_state";
    } else if (details.amount !== Number(order.amount_paise) || details.currency !== "INR") {
      processingResult = "amount_mismatch";
    } else if (order.status === "refunded") {
      processingResult = "ignored_terminal";
    } else if (order.status === "paid") {
      processingResult = order.provider_payment_id && order.provider_payment_id !== details.providerPaymentId
        ? "payment_mismatch"
        : "already_paid";
      shouldEnsureFulfillment = processingResult === "already_paid";
    } else if (order.status === "failed" && await activeSiblingOrder(db, order)) {
      // A late capture from an expired link must never produce two active
      // entitlements after the customer has already retried checkout.
      processingResult = "late_payment_conflict";
    } else {
      processingResult = "paid";
      shouldMarkPaid = true;
      shouldEnsureFulfillment = true;
    }
  }

  const now = sqliteTimestamp();
  let snapshot = null;
  if (shouldEnsureFulfillment) {
    snapshot = await db.prepare("SELECT id FROM purchased_report_snapshots WHERE order_id=?").bind(order.id).first();
    // A provider may retry a 5xx.  Refuse to acknowledge a paid event until
    // the immutable purchase boundary can be fulfilled atomically.
    if (!snapshot) {
      throw new HttpError(500, "purchase snapshot is missing", "purchase_snapshot_missing");
    }
  }
  const eventStatement = db.prepare(
    `INSERT INTO payment_webhook_events
       (provider_event_id,event_type,payload_sha256,order_id,provider_payment_id,processing_result,received_at,processed_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(
    eventId,
    details.eventType,
    payloadHash,
    order?.id || null,
    details.providerPaymentId || null,
    processingResult,
    now,
    now,
  );
  const statements = [eventStatement];
  if (shouldMarkPaid) {
    statements.push(db.prepare(
      `UPDATE orders
          SET status='paid',provider_payment_id=?,provider_order_id=COALESCE(provider_order_id,?),
              provider_checkout_order_id=COALESCE(provider_checkout_order_id,?),
              provider_status=?,provider_error_code=NULL,paid_at=COALESCE(paid_at,?),updated_at=?
        WHERE id=? AND status IN ('created','failed')`,
    ).bind(details.providerPaymentId, details.providerLinkId, details.providerCheckoutOrderId, details.providerState || "paid", now, now, order.id));
  }
  if (shouldEnsureFulfillment) {
    statements.push(insertFulfillmentStatement(db, order, snapshot.id, now));
    if (order.plan === "expert") {
      statements.push(db.prepare(
        "UPDATE projects SET status='expert_review',updated_at=? WHERE id=? AND user_id=? AND status!='archived'",
      ).bind(now, order.project_id, order.user_id));
    }
  }
  try {
    await db.batch(statements);
  } catch (error) {
    const raced = await existingWebhookEvent(db, eventId);
    if (raced?.payload_sha256 === payloadHash) {
      return json({ received: true, duplicate: true, result: raced.processing_result });
    }
    if (raced) {
      throw new HttpError(409, "webhook event id was replayed with different content", "webhook_event_conflict");
    }
    throw error;
  }
  return json({ received: true, duplicate: false, result: processingResult });
}

function normalizeName(value) {
  if (value == null || value === "") return null;
  const name = String(value).trim().replace(/\s+/gu, " ");
  if (name.length < 2 || name.length > 80) {
    throw new HttpError(400, "name must be between 2 and 80 characters", "invalid_name");
  }
  return name;
}

async function createSession(db, userId) {
  const sessionToken = randomToken();
  const csrfToken = randomToken();
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_TTL_SECONDS * 1000);
  const id = crypto.randomUUID();
  await db.prepare(
    "INSERT INTO sessions (id,user_id,token_hash,csrf_hash,expires_at,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?)",
  ).bind(
    id,
    userId,
    await digestBase64(sessionToken),
    await digestBase64(csrfToken),
    sqliteTimestamp(expires),
    sqliteTimestamp(now),
    sqliteTimestamp(now),
  ).run();
  return { id, sessionToken, csrfToken, expiresAt: sqliteTimestamp(expires) };
}

async function getSession(request, env, required = true) {
  const db = requireDatabase(env);
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token || token.length > 256) {
    if (required) throw new HttpError(401, "authentication required", "unauthenticated");
    return null;
  }
  const tokenHash = await digestBase64(token);
  const row = await db.prepare(
    `SELECT s.id AS session_id,s.user_id,s.csrf_hash,s.expires_at,
            u.email,u.name,u.created_at AS user_created_at
       FROM sessions s
       JOIN users u ON u.id=s.user_id
      WHERE s.token_hash=? AND s.expires_at>datetime('now') AND u.deleted_at IS NULL`,
  ).bind(tokenHash).first();
  if (!row) {
    if (required) throw new HttpError(401, "authentication required", "unauthenticated");
    return null;
  }
  return row;
}

async function requireCsrf(request, session) {
  const headerToken = request.headers.get("x-csrf-token") || "";
  const cookieToken = parseCookies(request)[CSRF_COOKIE] || "";
  if (!headerToken || !cookieToken || headerToken !== cookieToken || headerToken.length > 256) {
    throw new HttpError(403, "valid CSRF token required", "csrf_rejected");
  }
  const candidateHash = await digestBase64(headerToken);
  let valid = false;
  try {
    valid = constantTimeEqual(fromBase64Url(candidateHash), fromBase64Url(session.csrf_hash || ""));
  } catch {
    valid = false;
  }
  if (!valid) throw new HttpError(403, "valid CSRF token required", "csrf_rejected");
}

async function register(request, env) {
  requireTrustedOrigin(request, env);
  await rateLimit(request, env, "register", 8, 15 * 60);
  const db = requireDatabase(env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const password = normalizePassword(body.password);
  const name = normalizeName(body.name);
  const existing = await db.prepare("SELECT id FROM users WHERE email=?").bind(email).first();
  if (existing) throw new HttpError(409, "an account with this email already exists", "email_in_use");

  const id = crypto.randomUUID();
  const createdAt = sqliteTimestamp();
  const credentials = await makePasswordRecord(password);
  try {
    await db.prepare(
      `INSERT INTO users (id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).bind(
      id,
      email,
      name,
      createdAt,
      credentials.hash,
      credentials.salt,
      credentials.iterations,
      credentials.algorithm,
    ).run();
  } catch (error) {
    if (String(error?.message || error).toLowerCase().includes("unique")) {
      throw new HttpError(409, "an account with this email already exists", "email_in_use");
    }
    throw error;
  }
  const session = await createSession(db, id);
  const response = json({ user: { id, email, name, createdAt }, csrfToken: session.csrfToken }, 201);
  return withCookies(response, sessionCookies(session.sessionToken, session.csrfToken));
}

async function login(request, env) {
  requireTrustedOrigin(request, env);
  await rateLimit(request, env, "login", 12, 15 * 60);
  const db = requireDatabase(env);
  const body = await readJson(request);
  const email = normalizeEmail(body.email);
  const suppliedPassword = typeof body.password === "string" ? body.password : "";
  const passwordShapeValid = suppliedPassword.length >= 10 && suppliedPassword.length <= 128;
  const password = suppliedPassword.slice(0, 128) || "\0";
  const user = await db.prepare(
    `SELECT id,email,name,created_at,password_hash,password_salt,password_iterations,password_algorithm
       FROM users WHERE email=? AND deleted_at IS NULL`,
  ).bind(email).first();
  // Perform one PBKDF2 derivation even when the account or submitted password
  // shape is invalid so response timing does not become an account oracle.
  let passwordValid = false;
  if (user && passwordShapeValid) {
    passwordValid = await verifyPassword(password, user);
  } else {
    await derivePassword(password, new TextEncoder().encode("grihagrid-login-dummy-salt"));
  }
  if (!user || !passwordValid) {
    throw new HttpError(401, "email or password is incorrect", "invalid_credentials");
  }
  const session = await createSession(db, user.id);
  const response = json({ user: publicUser(user), csrfToken: session.csrfToken });
  return withCookies(response, sessionCookies(session.sessionToken, session.csrfToken));
}

async function logout(request, env) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  await db.prepare("DELETE FROM sessions WHERE id=? AND user_id=?").bind(session.session_id, session.user_id).run();
  return withCookies(empty(), clearSessionCookies());
}

async function me(request, env) {
  const session = await getSession(request, env);
  const csrfToken = parseCookies(request)[CSRF_COOKIE] || null;
  return json({ user: publicUser(session), csrfToken });
}

function validateJsonValue(value, depth = 0) {
  if (depth > 8) throw new HttpError(400, "project input is too deeply nested", "invalid_project_input");
  if (value == null || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new HttpError(400, "project input contains an invalid number", "invalid_project_input");
    return;
  }
  if (typeof value === "string") {
    if (value.length > 5000) throw new HttpError(400, "project input contains an oversized value", "invalid_project_input");
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new HttpError(400, "project input contains too many items", "invalid_project_input");
    for (const item of value) validateJsonValue(item, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (entries.length > 100) throw new HttpError(400, "project input contains too many fields", "invalid_project_input");
    for (const [key, item] of entries) {
      if (["__proto__", "prototype", "constructor"].includes(key) || key.length > 100) {
        throw new HttpError(400, "project input contains an invalid field", "invalid_project_input");
      }
      validateJsonValue(item, depth + 1);
    }
    return;
  }
  throw new HttpError(400, "project input contains an unsupported value", "invalid_project_input");
}

function normalizeProjectName(value) {
  const name = String(value || "My home project").trim().replace(/\s+/gu, " ");
  if (!name || name.length > 100) throw new HttpError(400, "project name must be between 1 and 100 characters", "invalid_project_name");
  return name;
}

function directInput(body) {
  const input = {};
  for (const [key, value] of Object.entries(body)) {
    if (!["name", "status", "input"].includes(key)) input[key] = value;
  }
  return input;
}

function normalizeProjectInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "project input must be an object", "invalid_project_input");
  }
  validateJsonValue(value);
  const input = JSON.parse(JSON.stringify(value));
  const estimate = computeEstimate(input);
  input.width = Number(input.width);
  input.length = Number(input.length);
  input.floors = estimate.floors;
  input.quality = estimate.quality;
  input.city = estimate.city;
  return { input, estimate };
}

function parseStoredJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function projectFromRow(row) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    input: parseStoredJson(row.input_json, {}),
    estimate: parseStoredJson(row.estimate_json, null),
    reportAvailable: Boolean(row.report_available),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ownedProject(db, projectId, userId) {
  const row = await db.prepare(
    `SELECT p.*,EXISTS(SELECT 1 FROM reports r WHERE r.project_id=p.id) AS report_available
       FROM projects p WHERE p.id=? AND p.user_id=?`,
  ).bind(projectId, userId).first();
  if (!row) throw new HttpError(404, "project not found", "project_not_found");
  return row;
}

async function createProject(request, env) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  const body = await readJson(request);
  const sourceInput = body.input == null ? directInput(body) : body.input;
  const { input, estimate } = normalizeProjectInput(sourceInput);
  const id = crypto.randomUUID();
  const name = normalizeProjectName(body.name);
  const now = sqliteTimestamp();
  await db.prepare(
    `INSERT INTO projects (id,user_id,name,status,input_json,estimate_json,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)`,
  ).bind(id, session.user_id, name, "feasibility_ready", JSON.stringify(input), JSON.stringify(estimate), now, now).run();
  return json({ project: { id, name, status: "feasibility_ready", input, estimate, reportAvailable: false, createdAt: now, updatedAt: now } }, 201);
}

async function listProjects(request, env, url) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  const limitValue = Number(url.searchParams.get("limit") || 50);
  const offsetValue = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(limitValue) || limitValue < 1 || limitValue > 100 || !Number.isInteger(offsetValue) || offsetValue < 0 || offsetValue > 100_000) {
    throw new HttpError(400, "invalid pagination", "invalid_pagination");
  }
  const result = await db.prepare(
    `SELECT p.*,EXISTS(SELECT 1 FROM reports r WHERE r.project_id=p.id) AS report_available
       FROM projects p WHERE p.user_id=? ORDER BY p.updated_at DESC,p.id DESC LIMIT ? OFFSET ?`,
  ).bind(session.user_id, limitValue + 1, offsetValue).all();
  const rows = result.results || [];
  const hasMore = rows.length > limitValue;
  return json({ projects: rows.slice(0, limitValue).map(projectFromRow), pagination: { limit: limitValue, offset: offsetValue, hasMore } });
}

async function getProject(request, env, projectId) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  return json({ project: projectFromRow(await ownedProject(db, projectId, session.user_id)) });
}

async function updateProject(request, env, projectId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  const current = await ownedProject(db, projectId, session.user_id);
  const body = await readJson(request);
  const hasName = Object.hasOwn(body, "name");
  const hasNestedInput = Object.hasOwn(body, "input");
  const patchInput = directInput(body);
  const hasDirectInput = Object.keys(patchInput).length > 0;
  const hasStatus = Object.hasOwn(body, "status");
  if (!hasName && !hasNestedInput && !hasDirectInput && !hasStatus) {
    throw new HttpError(400, "no supported project fields supplied", "empty_update");
  }

  const name = hasName ? normalizeProjectName(body.name) : current.name;
  let input = parseStoredJson(current.input_json, {});
  let estimate = parseStoredJson(current.estimate_json, null);
  let inputChanged = false;
  if (hasNestedInput || hasDirectInput) {
    const nested = hasNestedInput ? body.input : {};
    if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
      throw new HttpError(400, "project input must be an object", "invalid_project_input");
    }
    const normalized = normalizeProjectInput({ ...input, ...nested, ...patchInput });
    inputChanged = stableStringify(input) !== stableStringify(normalized.input);
    input = normalized.input;
    estimate = normalized.estimate;
  }

  let status = current.status;
  if (hasStatus) {
    if (!["draft", "feasibility_ready", "archived"].includes(body.status)) {
      throw new HttpError(400, "status may only be draft, feasibility_ready, or archived", "invalid_project_status");
    }
    status = body.status;
  } else if (inputChanged && current.status !== "archived") {
    status = "feasibility_ready";
  }
  const now = sqliteTimestamp();
  await db.prepare(
    "UPDATE projects SET name=?,status=?,input_json=?,estimate_json=?,updated_at=? WHERE id=? AND user_id=?",
  ).bind(name, status, JSON.stringify(input), JSON.stringify(estimate), now, projectId, session.user_id).run();
  if (inputChanged) await db.prepare("DELETE FROM reports WHERE project_id=? AND user_id=?").bind(projectId, session.user_id).run();
  return json({ project: { id: projectId, name, status, input, estimate, reportAvailable: inputChanged ? false : Boolean(current.report_available), createdAt: current.created_at, updatedAt: now } });
}

async function ensureProjectDeletable(db, projectId) {
  const order = await db.prepare("SELECT id FROM orders WHERE project_id=? LIMIT 1").bind(projectId).first();
  if (order) {
    throw new HttpError(409, "project has payment history; archive it instead", "project_has_orders");
  }
}

async function deleteProject(request, env, projectId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  await ownedProject(db, projectId, session.user_id);
  // Orders use ON DELETE RESTRICT. Preflight that constraint before touching
  // R2 so a database rejection can never strand metadata without its object.
  await ensureProjectDeletable(db, projectId);
  const result = await db.prepare("SELECT object_key FROM project_files WHERE project_id=? AND user_id=?").bind(projectId, session.user_id).all();
  const objectKeys = (result.results || []).map((row) => row.object_key);
  if (objectKeys.length) await requireFileStore(env).delete(objectKeys);
  await db.prepare("DELETE FROM projects WHERE id=? AND user_id=?").bind(projectId, session.user_id).run();
  return empty();
}

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

function boundedInteger(value, fallback, minimum, maximum) {
  if (typeof value === "string" && /^\d+\+$/u.test(value.trim())) {
    return Math.min(maximum, Math.max(minimum, Number.parseInt(value, 10)));
  }
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, Math.round(number))) : fallback;
}

function buildReport(project, inputHash, reportId, generatedAt) {
  const input = parseStoredJson(project.input_json, {});
  const estimate = parseStoredJson(project.estimate_json, computeEstimate(input));
  const floorCount = { G: 1, "G+1": 2, "G+2": 3 }[estimate.floors] || 2;
  const bedrooms = boundedInteger(input.bedrooms, floorCount === 1 ? 2 : 3, 1, 10);
  const bathrooms = boundedInteger(input.bathrooms, Math.max(2, bedrooms), 1, 12);
  const floorPlateSqft = Math.round(estimate.builtUpSqft / floorCount);
  const midpointInr = Math.round((estimate.lowInr + estimate.highInr) / 2);
  const costShares = [
    ["Civil and structure", 38],
    ["Finishes", 26],
    ["Electrical and plumbing", 14],
    ["Doors and windows", 9],
    ["Design, approvals, and site setup", 5],
    ["Contingency", 8],
  ];
  const risks = [];
  if (Number(input.width) < 25) risks.push("Narrow frontage may constrain parking, daylight, and stair placement.");
  if (floorCount > 2) risks.push("Confirm local height, FAR/FSI, and structural requirements before freezing the third level.");
  if (estimate.quality === "Luxury") risks.push("Imported or custom finishes can materially extend procurement lead times.");
  if (!input.soilReport) risks.push("Foundation assumptions must be validated through a geotechnical investigation.");
  risks.push("Municipal setbacks, FAR/FSI, fire, and parking rules require verification by a locally licensed architect.");

  return {
    id: reportId,
    projectId: project.id,
    version: REPORT_VERSION,
    inputHash,
    generatedAt,
    title: `${project.name} — feasibility report`,
    summary: {
      verdict: "Conceptually feasible, subject to local approvals and site verification",
      city: estimate.city,
      plotSqft: estimate.plotSqft,
      targetBuiltUpSqft: estimate.builtUpSqft,
      floorCount,
      bedrooms,
      bathrooms,
      quality: estimate.quality,
    },
    areaProgram: {
      estimatedFloorPlateSqft: floorPlateSqft,
      estimatedOpenAreaSqft: Math.max(0, Math.round(estimate.plotSqft - floorPlateSqft)),
      targetBuiltUpSqft: estimate.builtUpSqft,
      suggestedSpaces: [
        `${bedrooms} bedrooms`,
        `${bathrooms} bathrooms`,
        "Living and dining zone",
        "Kitchen with utility",
        input.parking === false || String(input.parking || "").toLowerCase() === "none" ? "Arrival court" : "At least one on-plot parking bay",
        floorCount > 1 ? "Code-compliant stair core" : "Future-ready expansion zone",
      ],
    },
    costPlan: {
      currency: "INR",
      lowInr: estimate.lowInr,
      midpointInr,
      highInr: estimate.highInr,
      assumedRateInrPerSqft: Math.round(midpointInr / estimate.builtUpSqft),
      categories: costShares.map(([name, percent]) => ({ name, percent, amountInr: Math.round(midpointInr * percent / 100) })),
      disclaimer: estimate.disclaimer,
    },
    deliveryPlan: {
      estimatedMonths: 7 + floorCount * 2 + (["Premium", "Luxury"].includes(estimate.quality) ? 2 : 0),
      phases: [
        { name: "Survey, brief, and concept", weeks: 3 },
        { name: "Design development and approvals", weeks: 8 },
        { name: "Structure and shell", weeks: 8 + floorCount * 4 },
        { name: "Services and finishes", weeks: 10 + floorCount * 3 },
        { name: "Testing, snagging, and handover", weeks: 3 },
      ],
    },
    risks,
    nextActions: [
      "Commission a measured boundary and level survey.",
      "Confirm title, access, setbacks, FAR/FSI, and sanction requirements locally.",
      "Validate the brief and budget with every decision-maker.",
      "Appoint a licensed architect and structural engineer before construction documentation.",
      "Obtain itemized contractor bids against coordinated drawings and specifications.",
    ],
  };
}

async function ensureReport(db, session, project) {
  const projectId = project.id;
  const inputHash = await digestHex(stableStringify({ version: REPORT_VERSION, input: parseStoredJson(project.input_json, {}), estimate: parseStoredJson(project.estimate_json, null) }));
  const existing = await db.prepare("SELECT * FROM reports WHERE project_id=? AND user_id=?").bind(projectId, session.user_id).first();
  const existingContent = existing ? parseStoredJson(existing.content_json, null) : null;
  if (existing?.input_hash === inputHash && existingContent) return { report: existingContent, cached: true, created: false };
  if (project.status === "archived") throw new HttpError(409, "restore the project before generating a report", "project_archived");

  const id = existing?.id || crypto.randomUUID();
  const now = sqliteTimestamp();
  const report = buildReport(project, inputHash, id, now);
  await db.prepare(
    `INSERT INTO reports (id,project_id,user_id,version,input_hash,content_json,generated_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(project_id) DO UPDATE SET
       user_id=excluded.user_id,version=excluded.version,input_hash=excluded.input_hash,
       content_json=excluded.content_json,generated_at=excluded.generated_at,updated_at=excluded.updated_at`,
  ).bind(id, projectId, session.user_id, REPORT_VERSION, inputHash, JSON.stringify(report), now, now).run();
  await db.prepare("UPDATE projects SET status='report_ready',updated_at=? WHERE id=? AND user_id=?").bind(now, projectId, session.user_id).run();
  return { report, cached: false, created: !existing };
}

async function generateReport(request, env, projectId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  const result = await ensureReport(db, session, await ownedProject(db, projectId, session.user_id));
  return json({ report: result.report, cached: result.cached }, result.created ? 201 : 200);
}

async function getReport(request, env, projectId) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  const result = await ensureReport(db, session, await ownedProject(db, projectId, session.user_id));
  return json({ report: result.report, cached: result.cached, autoGenerated: !result.cached });
}

function normalizeFileName(value) {
  const name = String(value || "").split(/[\\/]/u).pop().replace(/[\u0000-\u001f\u007f]/gu, "").trim();
  if (!name || name === "." || name === ".." || name.length > 160) throw new HttpError(400, "file name must be between 1 and 160 characters", "invalid_file_name");
  return name;
}

function normalizeFileKind(value) {
  const kind = String(value || "other").toLowerCase();
  if (!FILE_KINDS.has(kind)) throw new HttpError(400, "invalid file kind", "invalid_file_kind");
  return kind;
}

function verifyFileSignature(bytes, type) {
  const matches = (...signature) => signature.every((value, index) => bytes[index] === value);
  if (type === "application/pdf" && !matches(0x25, 0x50, 0x44, 0x46, 0x2d)) return false;
  if (type === "image/png" && !matches(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return false;
  if (type === "image/jpeg" && !matches(0xff, 0xd8, 0xff)) return false;
  if (type === "image/webp" && !(matches(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)) return false;
  return true;
}

async function readUpload(request) {
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > MAX_FILE_BYTES + 1024 * 1024) throw new HttpError(413, "file exceeds the 10 MB limit", "file_too_large");
  const requestType = (request.headers.get("content-type") || "").toLowerCase();
  let source;
  let name;
  let type;
  let kind;
  if (requestType.includes("multipart/form-data")) {
    const form = await request.formData();
    source = form.get("file");
    if (!source || typeof source.arrayBuffer !== "function") throw new HttpError(400, "multipart field 'file' is required", "file_required");
    name = normalizeFileName(source.name || form.get("name"));
    type = String(source.type || form.get("contentType") || "application/octet-stream").toLowerCase();
    kind = normalizeFileKind(form.get("kind"));
  } else {
    source = request;
    name = normalizeFileName(request.headers.get("x-file-name"));
    type = requestType.split(";", 1)[0] || "application/octet-stream";
    kind = normalizeFileKind(request.headers.get("x-file-kind"));
  }
  if (!FILE_TYPES.has(type)) throw new HttpError(415, "file type is not supported", "unsupported_file_type");
  const buffer = await source.arrayBuffer();
  if (!buffer.byteLength) throw new HttpError(400, "file is empty", "empty_file");
  if (buffer.byteLength > MAX_FILE_BYTES) throw new HttpError(413, "file exceeds the 10 MB limit", "file_too_large");
  const bytes = new Uint8Array(buffer);
  if (!verifyFileSignature(bytes, type)) throw new HttpError(400, "file content does not match its declared type", "invalid_file_content");
  return { buffer, name, type, kind };
}

function fileFromRow(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.file_name,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    kind: row.kind,
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
  };
}

async function uploadFile(request, env, projectId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const store = requireFileStore(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  await ownedProject(db, projectId, session.user_id);
  const upload = await readUpload(request);
  const id = crypto.randomUUID();
  const objectKey = `users/${session.user_id}/projects/${projectId}/${id}`;
  const checksum = await digestHex(new Uint8Array(upload.buffer));
  const createdAt = sqliteTimestamp();
  await store.put(objectKey, upload.buffer, {
    httpMetadata: { contentType: upload.type, cacheControl: "private, no-store" },
    customMetadata: { projectId, userId: session.user_id, fileId: id, checksumSha256: checksum },
  });
  try {
    await db.prepare(
      `INSERT INTO project_files (id,project_id,user_id,object_key,file_name,content_type,size_bytes,kind,checksum_sha256,created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    ).bind(id, projectId, session.user_id, objectKey, upload.name, upload.type, upload.buffer.byteLength, upload.kind, checksum, createdAt).run();
  } catch (error) {
    try { await store.delete(objectKey); } catch { /* Preserve the original database error. */ }
    throw error;
  }
  return json({ file: { id, projectId, name: upload.name, contentType: upload.type, sizeBytes: upload.buffer.byteLength, kind: upload.kind, checksumSha256: checksum, createdAt } }, 201);
}

async function listFiles(request, env, projectId) {
  const db = requireDatabase(env);
  const session = await getSession(request, env);
  await ownedProject(db, projectId, session.user_id);
  const result = await db.prepare(
    "SELECT * FROM project_files WHERE project_id=? AND user_id=? ORDER BY created_at DESC,id DESC",
  ).bind(projectId, session.user_id).all();
  return json({ files: (result.results || []).map(fileFromRow) });
}

async function ownedFile(db, projectId, fileId, userId) {
  const row = await db.prepare("SELECT * FROM project_files WHERE id=? AND project_id=? AND user_id=?").bind(fileId, projectId, userId).first();
  if (!row) throw new HttpError(404, "file not found", "file_not_found");
  return row;
}

function contentDisposition(name) {
  const ascii = name.replace(/[^\x20-\x7e]/gu, "_").replace(/["\\]/gu, "_") || "download";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function downloadFile(request, env, projectId, fileId) {
  const db = requireDatabase(env);
  const store = requireFileStore(env);
  const session = await getSession(request, env);
  await ownedProject(db, projectId, session.user_id);
  const file = await ownedFile(db, projectId, fileId, session.user_id);
  const object = await store.get(file.object_key);
  if (!object) throw new HttpError(404, "file content not found", "file_content_not_found");
  const headers = new Headers({
    "content-type": file.content_type,
    "content-length": String(file.size_bytes),
    "content-disposition": contentDisposition(file.file_name),
    "cache-control": "private, no-store",
    "x-file-checksum-sha256": file.checksum_sha256,
  });
  if (object.httpEtag) headers.set("etag", object.httpEtag);
  return new Response(request.method === "HEAD" ? null : object.body, { status: 200, headers });
}

async function deleteFile(request, env, projectId, fileId) {
  requireTrustedOrigin(request, env);
  const db = requireDatabase(env);
  const store = requireFileStore(env);
  const session = await getSession(request, env);
  await requireCsrf(request, session);
  await ownedProject(db, projectId, session.user_id);
  const file = await ownedFile(db, projectId, fileId, session.user_id);
  await store.delete(file.object_key);
  await db.prepare("DELETE FROM project_files WHERE id=? AND project_id=? AND user_id=?").bind(fileId, projectId, session.user_id).run();
  return empty();
}

function methodNotAllowed(allowed) {
  return json({ error: "method not allowed", code: "method_not_allowed" }, 405, { allow: allowed.join(", ") });
}

async function api(request, env, ctx, url) {
  if (request.method === "OPTIONS") {
    if (["/api/health", "/api/readiness", "/api/estimate", "/api/commerce/catalog"].includes(url.pathname)) return empty(204, CORS_HEADERS);
    const origin = request.headers.get("origin");
    if (origin && !trustedOrigins(request, env).has(origin)) return json({ error: "request origin is not allowed", code: "origin_rejected" }, 403);
    const headers = {
      "access-control-allow-methods": CORS_HEADERS["access-control-allow-methods"],
      "access-control-allow-headers": CORS_HEADERS["access-control-allow-headers"],
      "access-control-max-age": CORS_HEADERS["access-control-max-age"],
    };
    if (origin) {
      headers["access-control-allow-origin"] = origin;
      headers.vary = "Origin";
      headers["access-control-allow-credentials"] = "true";
    }
    return empty(204, headers);
  }

  try {
    if (url.pathname === "/api/health") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return publicJson({ status: "ok", service: "grihagrid", time: new Date().toISOString() });
    }
    if (url.pathname === "/api/readiness") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      let database = "missing";
      let schema = "unknown";
      if (env.DB) {
        try {
          const result = await env.DB.prepare(
            `SELECT COUNT(*) AS count FROM sqlite_master
              WHERE type='table' AND name IN
                ('users','sessions','projects','reports','purchased_report_snapshots','order_fulfillments')`,
          ).first();
          database = "ok";
          schema = Number(result?.count) === 6 ? "current" : "outdated";
        } catch {
          database = "error";
          schema = "unknown";
        }
      }
      const rateLimit = env.GRIHAGRID_CACHE ? "configured" : "missing";
      const freeReady = database === "ok" && schema === "current" && rateLimit === "configured";
      const acceptingPlans = commerceCatalog(env).filter((plan) => plan.acceptingOrders).map((plan) => plan.id);
      return publicJson({
        status: freeReady ? "ready" : "not_ready",
        service: "grihagrid",
        checks: {
          database,
          schema,
          rateLimit,
          privateStorage: env.FILES ? "configured" : "unavailable",
          acceptingPaidPlans: acceptingPlans,
        },
        capabilities: {
          freePlanning: freeReady,
          privateUploads: Boolean(env.FILES),
          paidCheckout: acceptingPlans.length > 0,
        },
        time: new Date().toISOString(),
      }, freeReady ? 200 : 503);
    }
    if (url.pathname === "/api/estimate") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      return publicJson({ estimate: computeEstimate(await readJson(request)) });
    }
    if (url.pathname === "/api/commerce/catalog") {
      if (request.method !== "GET") return methodNotAllowed(["GET"]);
      return publicJson({ plans: commerceCatalog(env) });
    }
    if (url.pathname === "/api/leads") {
      if (request.method !== "POST") return methodNotAllowed(["POST"]);
      requireTrustedOrigin(request, env);
      const body = await readJson(request);
      const email = normalizeEmail(body.email);
      if (env.DB) {
        await env.DB.prepare("INSERT OR IGNORE INTO leads (id,email,source,created_at) VALUES (?,?,?,datetime('now'))")
          .bind(crypto.randomUUID(), email, String(body.source || "website").slice(0, 64)).run();
      }
      return json({ ok: true }, 201);
    }
    if (url.pathname === "/api/payments/razorpay/webhook") {
      return request.method === "POST" ? await razorpayWebhook(request, env) : methodNotAllowed(["POST"]);
    }
    if (url.pathname === "/api/auth/register") {
      return request.method === "POST" ? await register(request, env) : methodNotAllowed(["POST"]);
    }
    if (url.pathname === "/api/auth/login") {
      return request.method === "POST" ? await login(request, env) : methodNotAllowed(["POST"]);
    }
    if (url.pathname === "/api/auth/logout") {
      return request.method === "POST" ? await logout(request, env) : methodNotAllowed(["POST"]);
    }
    if (url.pathname === "/api/auth/me") {
      return request.method === "GET" ? await me(request, env) : methodNotAllowed(["GET"]);
    }
    if (url.pathname === "/api/projects") {
      if (request.method === "GET") return await listProjects(request, env, url);
      if (request.method === "POST") return await createProject(request, env);
      return methodNotAllowed(["GET", "POST"]);
    }
    if (url.pathname === "/api/orders") {
      return request.method === "GET" ? await listOrders(request, env, url) : methodNotAllowed(["GET"]);
    }

    const projectOrdersMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/orders$/u);
    if (projectOrdersMatch) {
      const projectId = decodeURIComponent(projectOrdersMatch[1]);
      return request.method === "POST" ? await createOrder(request, env, projectId) : methodNotAllowed(["POST"]);
    }
    const fulfillmentMatch = url.pathname.match(/^\/api\/orders\/([^/]+)\/fulfillment$/u);
    if (fulfillmentMatch) {
      const orderId = decodeURIComponent(fulfillmentMatch[1]);
      return request.method === "GET" ? await getOrderFulfillment(request, env, orderId) : methodNotAllowed(["GET"]);
    }
    const orderMatch = url.pathname.match(/^\/api\/orders\/([^/]+)$/u);
    if (orderMatch) {
      const orderId = decodeURIComponent(orderMatch[1]);
      return request.method === "GET" ? await getOrder(request, env, orderId) : methodNotAllowed(["GET"]);
    }

    const reportMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/report$/u);
    if (reportMatch) {
      const projectId = decodeURIComponent(reportMatch[1]);
      if (request.method === "GET") return await getReport(request, env, projectId);
      if (request.method === "POST") return await generateReport(request, env, projectId);
      return methodNotAllowed(["GET", "POST"]);
    }
    const fileMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files\/([^/]+)$/u);
    if (fileMatch) {
      const projectId = decodeURIComponent(fileMatch[1]);
      const fileId = decodeURIComponent(fileMatch[2]);
      if (["GET", "HEAD"].includes(request.method)) return await downloadFile(request, env, projectId, fileId);
      if (request.method === "DELETE") return await deleteFile(request, env, projectId, fileId);
      return methodNotAllowed(["GET", "HEAD", "DELETE"]);
    }
    const filesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/files$/u);
    if (filesMatch) {
      const projectId = decodeURIComponent(filesMatch[1]);
      if (request.method === "GET") return await listFiles(request, env, projectId);
      if (request.method === "POST") return await uploadFile(request, env, projectId);
      return methodNotAllowed(["GET", "POST"]);
    }
    const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/u);
    if (projectMatch) {
      const projectId = decodeURIComponent(projectMatch[1]);
      if (request.method === "GET") return await getProject(request, env, projectId);
      if (["PATCH", "PUT"].includes(request.method)) return await updateProject(request, env, projectId);
      if (request.method === "DELETE") return await deleteProject(request, env, projectId);
      return methodNotAllowed(["GET", "PATCH", "PUT", "DELETE"]);
    }
    return json({ error: "not found", code: "not_found" }, 404);
  } catch (error) {
    const respond = ["/api/health", "/api/readiness", "/api/estimate", "/api/commerce/catalog"].includes(url.pathname) ? publicJson : json;
    if (error instanceof HttpError) return respond({ error: error.message, code: error.code }, error.status);
    console.error("Unhandled API error", error);
    return respond({ error: "internal server error", code: "internal_error" }, 500);
  }
}

function isApiRoute(pathname) {
  return new Set([
    "/api/health",
    "/api/readiness",
    "/api/estimate",
    "/api/commerce/catalog",
    "/api/leads",
    "/api/auth/register",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/projects",
    "/api/orders",
    "/api/payments/razorpay/webhook",
  ]).has(pathname)
    || /^\/api\/orders\/[^/]+(?:\/fulfillment)?$/u.test(pathname)
    || /^\/api\/projects\/[^/]+(?:\/report|\/orders|\/files(?:\/[^/]+)?)?$/u.test(pathname);
}

function isAppNavigation(request, url) {
  if (!["GET", "HEAD"].includes(request.method)) return false;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return false;
  if (request.headers.get("accept")?.includes("text/html")) return true;
  // Health checks and programmatic link validators commonly send `Accept: */*`.
  // Extensionless paths are application routes; missing files keep their 404.
  const finalSegment = url.pathname.split("/").at(-1) || "";
  return !finalSegment.includes(".");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (isApiRoute(url.pathname)) return secure(await api(request, env, ctx, url));
    const response = await env.ASSETS.fetch(request);
    const isHtmlNavigation = isAppNavigation(request, url);
    const isDocumentResponse = response.headers.get("content-type")?.includes("text/html");
    if (response.status !== 404 && (!isDocumentResponse || url.pathname === "/" || url.pathname === "/index.html")) return secure(response);
    if (!isHtmlNavigation) return secure(response);
    const indexUrl = new URL(request.url);
    indexUrl.pathname = "/index.html";
    indexUrl.search = "";
    return secure(await env.ASSETS.fetch(new Request(indexUrl, request)));
  },
  async scheduled(controller, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(env.DB.batch([
      env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')"),
      env.DB.prepare(
        `UPDATE orders
            SET status='failed',provider_status='expired',provider_error_code='checkout_expired',checkout_url=NULL,updated_at=datetime('now')
          WHERE status='created' AND created_at < datetime('now','-25 hours')`,
      ),
    ]));
  },
};

// Narrowly exported for deterministic unit tests; the production entrypoint is
// the default export above.
export const __test = {
  buildReport,
  commerceCatalog,
  computeEstimate,
  constantTimeEqual,
  derivePassword,
  digestBase64,
  fromBase64Url,
  makePasswordRecord,
  normalizeFileName,
  normalizeIdempotencyKey,
  normalizeProjectInput,
  orderFromRow,
  ownedProject,
  paymentPlan,
  parseCookies,
  requireCsrf,
  ensureProjectDeletable,
  scopedIdempotencyKey,
  stableStringify,
  verifyFileSignature,
  verifyRazorpaySignature,
  verifyPassword,
  webhookPaymentDetails,
  hmacSha256Hex,
};
