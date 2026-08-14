import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_TRANSIENT_ATTEMPTS = 2;

function canonicalOrigin(raw) {
  const origin = new URL(raw);
  assert.equal(origin.protocol, "https:", "smoke target must use HTTPS");
  assert.equal(origin.username, "", "smoke target cannot include credentials");
  assert.equal(origin.password, "", "smoke target cannot include credentials");
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin;
}

async function timedFetch(url, init = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = performance.now();
  let lastError;
  for (let attempt = 1; attempt <= MAX_TRANSIENT_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
        headers: { "user-agent": "grihagrid-read-only-synthetic/1.0", ...(init.headers || {}) },
      });
      return { response, latencyMs: Math.round(performance.now() - startedAt), attempts: attempt };
    } catch (error) {
      lastError = error;
      const transient = error?.name === "TimeoutError" || error?.name === "AbortError" || error instanceof TypeError;
      if (!transient || attempt === MAX_TRANSIENT_ATTEMPTS) {
        const pathname = new URL(url).pathname;
        throw new Error(
          `${pathname} fetch failed after ${attempt} attempt${attempt === 1 ? "" : "s"}: ${error?.name || "Error"}`,
          { cause: error },
        );
      }
    }
  }
  throw lastError;
}

function assertSecurityHeaders(response, path) {
  assert.match(response.headers.get("strict-transport-security") || "", /\bmax-age=/u, `${path} is missing HSTS`);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff", `${path} is missing MIME protection`);
  assert.equal(response.headers.get("x-frame-options"), "DENY", `${path} is not frame-denied`);
  assert.match(response.headers.get("content-security-policy") || "", /frame-ancestors 'none'/u, `${path} is missing frame CSP`);
}

async function jsonCheck(origin, path, init, validate) {
  const { response, latencyMs, attempts } = await timedFetch(new URL(path, origin), init);
  assert.equal(response.status, 200, `${path} returned ${response.status}`);
  assertSecurityHeaders(response, path);
  assert.match(response.headers.get("content-type") || "", /^application\/json\b/u, `${path} must return JSON`);
  assert.equal(response.headers.get("cache-control"), "no-store", `${path} must not be cached`);
  const body = await response.json();
  validate(body);
  return { path, status: response.status, latencyMs, attempts };
}

export async function runSmoke(rawOrigin, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const expectCheckout = options.expectCheckout === true;
  const checks = [];

  const home = await timedFetch(origin);
  assert.equal(home.response.status, 200, `homepage returned ${home.response.status}`);
  assertSecurityHeaders(home.response, "/");
  assert.match(home.response.headers.get("content-type") || "", /^text\/html\b/u, "homepage must return HTML");
  const homepage = await home.response.text();
  assert.match(homepage, /GrihaGrid/u, "homepage brand marker is missing");
  checks.push({ path: "/", status: 200, latencyMs: home.latencyMs, attempts: home.attempts });

  checks.push(await jsonCheck(origin, "/api/health", {}, (body) => {
    assert.equal(body.status, "ok");
    assert.equal(body.service, "grihagrid");
    assert.ok(!Number.isNaN(Date.parse(body.time)), "health timestamp must be parseable");
  }));

  checks.push(await jsonCheck(origin, "/api/readiness", {}, (body) => {
    assert.equal(body.status, "ready");
    assert.equal(body.checks?.familyAlignmentSchema, "current");
    assert.equal(body.capabilities?.freePlanning, true);
    assert.equal(body.capabilities?.familyAlignment, true);
    assert.equal(body.capabilities?.paidCheckout, expectCheckout);
    assert.ok(!JSON.stringify(body).match(/(?:secret|api[_-]?key|authorization|cookie)/iu), "readiness may not expose secret-shaped fields");
  }));

  checks.push(await jsonCheck(origin, "/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" }),
  }, (body) => {
    assert.ok(body.estimate && typeof body.estimate === "object", "estimate payload is missing");
    assert.ok(Number.isFinite(body.estimate.plotSqft), "estimate plotSqft must be numeric");
  }));

  checks.push(await jsonCheck(origin, "/api/commerce/catalog", {}, (body) => {
    assert.ok(Array.isArray(body.plans), "commerce catalog plans must be an array");
    const accepting = body.plans.filter((plan) => plan.acceptingOrders);
    if (!expectCheckout) assert.equal(accepting.length, 0, "checkout is unexpectedly open");
    if (expectCheckout) {
      assert.deepEqual(accepting.map((plan) => plan.id), ["decision_compare"]);
      assert.equal(accepting[0].amountPaise, 99_900);
      assert.equal(accepting[0].currency, "INR");
    }
  }));

  return { origin: origin.origin, checkedAt: new Date().toISOString(), checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || process.env.GRIHAGRID_SMOKE_ORIGIN;
  assert.ok(origin, "usage: npm run smoke -- https://worker.example or set GRIHAGRID_SMOKE_ORIGIN");
  const result = await runSmoke(origin, { expectCheckout: process.env.EXPECT_PAID_CHECKOUT === "true" });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
