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

function assertFreshTime(value, label) {
  const timestamp = Date.parse(value);
  assert.ok(!Number.isNaN(timestamp), `${label} timestamp must be parseable`);
  assert.ok(Math.abs(Date.now() - timestamp) < 5 * 60 * 1000, `${label} timestamp must be fresh`);
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

async function reportShareDocumentCheck(origin, method) {
  const path="/share/report";
  const {response,latencyMs,attempts}=await timedFetch(new URL(path,origin),{
    method,
    headers:{accept:"text/html"},
  });
  assert.equal(response.status,200,`${method} ${path} returned ${response.status}`);
  assertSecurityHeaders(response,path);
  assert.match(response.headers.get("content-type")||"",/^text\/html\b/u,`${method} ${path} must return HTML`);
  assert.equal(response.headers.get("cache-control"),"no-store",`${method} ${path} must not be cached`);
  assert.equal(response.headers.get("x-robots-tag"),"noindex,nofollow,noarchive",`${method} ${path} must not be indexed`);
  assert.equal(response.headers.get("referrer-policy"),"no-referrer",`${method} ${path} must not forward its capability`);
  await response.body?.cancel();
  return {path,method,status:response.status,latencyMs,attempts};
}

export async function runSmoke(rawOrigin, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const expectCheckout = options.expectCheckout === true;
  const expectedReleaseId = options.expectedReleaseId ? String(options.expectedReleaseId) : "";
  const legacyWorker = options.legacyWorker === true;
  const expectReportHandoff = options.expectReportHandoff !== false;
  const releaseProbe = options.releaseProbe == null ? "" : String(options.releaseProbe);
  assert.match(releaseProbe, /^(?:|\d{1,6}-\d{1,16})$/u, "release probe must be a bounded numeric correlation value");
  const readinessPath = releaseProbe
    ? `/api/readiness?release_probe=${encodeURIComponent(releaseProbe)}`
    : "/api/readiness";
  const readinessInit = releaseProbe ? { headers: { "cache-control": "no-cache" } } : {};
  const checks = [];

  const home = await timedFetch(origin);
  assert.equal(home.response.status, 200, `homepage returned ${home.response.status}`);
  assertSecurityHeaders(home.response, "/");
  assert.match(home.response.headers.get("content-type") || "", /^text\/html\b/u, "homepage must return HTML");
  const homepage = await home.response.text();
  assert.match(homepage, /GrihaGrid/u, "homepage brand marker is missing");
  checks.push({ path: "/", status: 200, latencyMs: home.latencyMs, attempts: home.attempts });

  if (!legacyWorker) {
    checks.push(await reportShareDocumentCheck(origin,"GET"));
    checks.push(await reportShareDocumentCheck(origin,"HEAD"));
  }

  checks.push(await jsonCheck(origin, "/api/health", {}, (body) => {
    assert.equal(body.status, "ok");
    assert.equal(body.service, "grihagrid");
    assertFreshTime(body.time, "health");
  }));

  checks.push(await jsonCheck(origin, "/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" }),
  }, (body) => {
    assert.deepEqual(body.input, { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" });
    assert.equal(body.estimate?.plotSqft, 1500);
    assert.equal(body.estimate?.builtUpSqft, 1830);
    assert.equal(body.estimate?.lowInr, 3_703_920);
    assert.equal(body.estimate?.highInr, 4_428_600);
    assert.equal(body.estimate?.floors, "G+1");
    assert.equal(body.estimate?.quality, "Signature");
    assert.equal(body.estimate?.city, "Pune");
    assert.equal(body.basis?.ruleVersion, 1);
    assert.equal(body.basis?.rulePublishedDate, "2026-08-16");
    assert.equal(body.basis?.benchmarkStatus, "internal_directional_rule");
    assert.equal(body.basis?.marketBenchmarkAsOf, null);
    assert.match(body.basis?.marketWarning || "", /not independently calibrated/u);
    assert.equal(body.basis?.finishRateInrPerSqft, 2200);
    assert.equal(body.basis?.cityFactor, 1);
    assert.equal(body.basis?.taxesAndStatutoryFees, "excluded");
    assert.ok(Array.isArray(body.basis?.exclusions) && body.basis.exclusions.length >= 1);
  }));

  checks.push(await jsonCheck(origin, "/api/commerce/catalog", {}, (body) => {
    assert.ok(Array.isArray(body.plans), "commerce catalog plans must be an array");
    assert.equal(body.plans.length, 1, "catalog must expose exactly one pilot plan");
    assert.equal(body.plans[0]?.id, "decision_compare");
    assert.equal(body.plans[0]?.amountPaise, 99_900);
    assert.equal(body.plans[0]?.currency, "INR");
    const accepting = body.plans.filter((plan) => plan.acceptingOrders);
    if (!expectCheckout) assert.equal(accepting.length, 0, "checkout is unexpectedly open");
    if (expectCheckout) {
      assert.deepEqual(accepting.map((plan) => plan.id), ["decision_compare"]);
      assert.equal(accepting[0].amountPaise, 99_900);
      assert.equal(accepting[0].currency, "INR");
    }
  }));

  // Keep the exact-version assertion last so post-readiness endpoint latency
  // can never be counted toward the sustained propagation window.
  checks.push(await jsonCheck(origin, readinessPath, readinessInit, (body) => {
    assert.equal(body.status, "ready");
    assert.equal(body.checks?.familyAlignmentSchema, "current");
    assert.equal(body.checks?.reportFeedbackSchema, "current");
    if (!legacyWorker) {
      assert.equal(body.checks?.reportShareSchema, "current");
      assert.equal(body.checks?.reportHandoffControl, expectReportHandoff ? "enabled" : "disabled");
      assert.equal(body.checks?.reportShareAbuseHashing, "configured");
    }
    assert.equal(body.checks?.projectCreationSchema, "current");
    assert.equal(body.checks?.authSchema, "current");
    assert.equal(body.checks?.privateStorage, "unavailable");
    assert.deepEqual(body.checks?.acceptingPaidPlans, expectCheckout ? ["decision_compare"] : []);
    assert.equal(body.capabilities?.freePlanning, true);
    assert.equal(body.capabilities?.familyAlignment, true);
    assert.equal(body.capabilities?.reportFeedback, true);
    if (!legacyWorker) assert.equal(body.capabilities?.reportHandoff, expectReportHandoff);
    assert.equal(body.capabilities?.accountSecurity, true);
    assert.equal(body.capabilities?.privateUploads, false);
    assert.equal(body.capabilities?.paidCheckout, expectCheckout);
    assert.notEqual(body.capabilities?.paidFulfillment, true, "fulfillment is unexpectedly open");
    if (expectedReleaseId) {
      assert.equal(body.releaseId, expectedReleaseId, "readiness is not serving the expected Worker version");
      assert.equal(body.capabilities?.paidFulfillment, false, "versioned readiness must expose closed fulfillment");
    }
    assertFreshTime(body.time, "readiness");
    assert.ok(!JSON.stringify(body).match(/(?:secret|api[_-]?key|authorization|cookie)/iu), "readiness may not expose secret-shaped fields");
  }));

  return {
    origin: origin.origin,
    checkedAt: new Date().toISOString(),
    legacyWorker,
    expectReportHandoff,
    checks,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || process.env.GRIHAGRID_SMOKE_ORIGIN;
  assert.ok(origin, "usage: npm run smoke -- https://worker.example or set GRIHAGRID_SMOKE_ORIGIN");
  const result = await runSmoke(origin, {
    expectCheckout: process.env.EXPECT_PAID_CHECKOUT === "true",
    expectedReleaseId: process.env.EXPECT_RELEASE_ID,
    legacyWorker: process.env.LEGACY_WORKER_COMPAT === "true",
    expectReportHandoff: process.env.EXPECT_REPORT_HANDOFF !== "false",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
