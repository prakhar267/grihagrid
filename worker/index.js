const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };
const CORS_HEADERS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,OPTIONS", "access-control-allow-headers": "content-type,idempotency-key" };
const SECURITY_HEADERS = {
  "content-security-policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
  "cross-origin-opener-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

function secure(response) {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...CORS_HEADERS, ...headers } });
}

async function readJson(request) {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new Error("content-type must be application/json");
  const data = await request.json();
  if (!data || typeof data !== "object") throw new Error("invalid JSON body");
  return data;
}

function computeEstimate(input) {
  const width = Number(input.width), length = Number(input.length);
  const floorFactors = { G: .72, "G+1": 1.22, "G+2": 1.65 };
  const rates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };
  const cityFactors = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: .98, Chennai: 1.02, Jaipur: .88, Other: .95 };
  if (!Number.isFinite(width) || !Number.isFinite(length) || width < 10 || length < 10 || width > 500 || length > 500) throw new Error("plot dimensions must be between 10 and 500 feet");
  const floors = floorFactors[input.floors] ? input.floors : "G+1";
  const quality = rates[input.quality] ? input.quality : "Signature";
  const city = cityFactors[input.city] ? input.city : "Other";
  const builtUpSqft = Math.round(width * length * floorFactors[floors]);
  const midpoint = builtUpSqft * rates[quality] * cityFactors[city];
  return { plotSqft: width * length, builtUpSqft, lowInr: Math.round(midpoint * .92), highInr: Math.round(midpoint * 1.1), floors, quality, city, disclaimer: "Indicative concept-stage estimate; not a contractor quote." };
}

async function api(request, env, ctx, url) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS_HEADERS });
  if (url.pathname === "/api/health") {
    let database = "not-configured";
    if (env.DB) { try { await env.DB.prepare("SELECT 1").first(); database = "ok"; } catch { database = "error"; } }
    return json({ status: database === "error" ? "degraded" : "ok", service: "grihagrid", database, time: new Date().toISOString() }, database === "error" ? 503 : 200);
  }
  if (url.pathname === "/api/estimate" && request.method === "POST") {
    try { return json({ estimate: computeEstimate(await readJson(request)) }); }
    catch (error) { return json({ error: error.message }, 400); }
  }
  if (url.pathname === "/api/leads" && request.method === "POST") {
    try {
      const body = await readJson(request); const email = String(body.email || "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: "valid email required" }, 400);
      if (env.DB) await env.DB.prepare("INSERT OR IGNORE INTO leads (id,email,source,created_at) VALUES (?,?,?,datetime('now'))").bind(crypto.randomUUID(), email, String(body.source || "website").slice(0,64)).run();
      return json({ ok: true }, 201);
    } catch (error) { return json({ error: error.message }, 400); }
  }
  if (url.pathname === "/api/projects" && request.method === "POST") {
    try {
      const body = await readJson(request); const estimate = computeEstimate(body); const id = crypto.randomUUID();
      if (env.DB) await env.DB.prepare("INSERT INTO projects (id,user_id,name,status,input_json,estimate_json,created_at,updated_at) VALUES (?,?,?,?,?,?,datetime('now'),datetime('now'))").bind(id, null, String(body.name || "My home project").slice(0,100), "feasibility_ready", JSON.stringify(body), JSON.stringify(estimate)).run();
      return json({ project: { id, name: body.name || "My home project", status: "feasibility_ready", estimate } }, 201);
    } catch (error) { return json({ error: error.message }, 400); }
  }
  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const apiRoutes = new Set(["/api/health", "/api/estimate", "/api/leads", "/api/projects"]);
    if (apiRoutes.has(url.pathname)) return secure(await api(request, env, ctx, url));
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return secure(response);
    const indexUrl = new URL(request.url); indexUrl.pathname = "/index.html"; indexUrl.search = "";
    return secure(await env.ASSETS.fetch(new Request(indexUrl, request)));
  },
  async scheduled(controller, env, ctx) {
    if (!env.DB) return;
    ctx.waitUntil(env.DB.prepare("DELETE FROM sessions WHERE expires_at < datetime('now')").run());
  },
};
