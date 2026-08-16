import assert from "node:assert/strict";
import test from "node:test";
import { checkOpsConfig } from "../scripts/check-ops-config.mjs";
import { runSmoke } from "../scripts/smoke.mjs";
import worker from "../worker/index.js";

const assets = { fetch: async () => new Response("missing", { status: 404 }) };

test("version-controlled production and staging configuration stays isolated and paid-closed", async () => {
  const result = await checkOpsConfig();
  assert.equal(result.paidDefaults, "closed");
  assert.equal(result.productionOrigin, "https://grihagrid.prakhargupta267.workers.dev");
  assert.equal(result.stagingOrigin, "https://grihagrid-staging.prakhargupta267.workers.dev");
});

test("read-only smoke rejects unsafe targets before network access", async () => {
  await assert.rejects(() => runSmoke("http://localhost:8787"), /must use HTTPS/u);
  await assert.rejects(() => runSmoke("https://user:password@example.test"), /cannot include credentials/u);
});

test("read-only smoke verifies health, readiness, estimate and fail-closed catalog", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  let readinessAttempts = 0;
  let legacyReadiness = false;
  let handoffEnabled = true;
  const securityHeaders = {
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
  };
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    requested.push({ path: url.pathname, method: init.method || "GET" });
    if (url.pathname === "/") {
      return new Response("<!doctype html><title>GrihaGrid</title>", {
        headers: { ...securityHeaders, "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/share/report") {
      return new Response(init.method==="HEAD"?null:"<!doctype html><title>Professional handoff</title>", {
        headers: {
          ...securityHeaders,
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "x-robots-tag": "noindex,nofollow,noarchive",
          "referrer-policy": "no-referrer",
        },
      });
    }
    if (url.pathname === "/api/health") {
      return Response.json({ status: "ok", service: "grihagrid", time: new Date().toISOString() }, { headers: { ...securityHeaders, "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/readiness") {
      readinessAttempts += 1;
      if (readinessAttempts === 1) throw new DOMException("synthetic timeout", "TimeoutError");
      return Response.json({
        status: "ready",
        releaseId: "11111111-1111-4111-8111-111111111111",
        checks: {
          familyAlignmentSchema: "current",
          reportFeedbackSchema: "current",
          ...(legacyReadiness ? {} : {
            reportShareSchema: "current",
            reportHandoffControl: handoffEnabled ? "enabled" : "disabled",
            reportShareAbuseHashing: "configured",
          }),
          projectCreationSchema: "current",
          authSchema: "current",
          privateStorage: "unavailable",
          acceptingPaidPlans: [],
        },
        capabilities: {
          freePlanning: true,
          familyAlignment: true,
          reportFeedback: true,
          ...(legacyReadiness ? {} : { reportHandoff: handoffEnabled }),
          accountSecurity: true,
          privateUploads: false,
          paidCheckout: false,
          paidFulfillment: false,
        },
        time: new Date().toISOString(),
      }, { headers: { ...securityHeaders, "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/estimate") {
      return Response.json({
        input: { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" },
        estimate: {
          plotSqft: 1500,
          builtUpSqft: 1830,
          lowInr: 3_703_920,
          highInr: 4_428_600,
          floors: "G+1",
          quality: "Signature",
          city: "Pune",
          disclaimer: "Indicative concept-stage estimate; not a contractor quote.",
        },
        basis: {
          ruleVersion: 1,
          rulePublishedDate: "2026-08-16",
          benchmarkStatus: "internal_directional_rule",
          marketBenchmarkAsOf: null,
          marketWarning: "Internal planning assumptions are not independently calibrated to current local quotes.",
          currency: "INR",
          confidence: "directional",
          areaMethod: "Plot area × floor-programme factor",
          costMethod: "Likely built-up area × internal finish benchmark × city factor",
          floorFactor: 1.22,
          finishRateInrPerSqft: 2200,
          cityFactor: 1,
          lowFactor: 0.92,
          highFactor: 1.1,
          taxesAndStatutoryFees: "excluded",
          exclusions: ["Taxes and statutory fees"],
        },
      }, { headers: { ...securityHeaders, "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/commerce/catalog") {
      return Response.json({ plans: [{ id: "decision_compare", amountPaise: 99_900, currency: "INR", acceptingOrders: false }] }, { headers: { ...securityHeaders, "cache-control": "no-store" } });
    }
    return new Response("missing", { status: 404 });
  };

  try {
    const result = await runSmoke("https://worker.example.test", { expectedReleaseId: "11111111-1111-4111-8111-111111111111" });
    assert.equal(result.checks.length, 7);
    assert.equal(result.checks.find((check) => check.path === "/api/readiness")?.attempts, 2);
    assert.deepEqual(requested, [
      { path: "/", method: "GET" },
      { path: "/share/report", method: "GET" },
      { path: "/share/report", method: "HEAD" },
      { path: "/api/health", method: "GET" },
      { path: "/api/readiness", method: "GET" },
      { path: "/api/readiness", method: "GET" },
      { path: "/api/estimate", method: "POST" },
      { path: "/api/commerce/catalog", method: "GET" },
    ]);

    requested.length = 0;
    readinessAttempts = 0;
    handoffEnabled = false;
    const closed = await runSmoke("https://worker.example.test", {
      expectedReleaseId: "11111111-1111-4111-8111-111111111111",
      expectReportHandoff: false,
    });
    assert.equal(closed.expectReportHandoff, false);
    assert.equal(closed.checks.length, 7);

    requested.length = 0;
    readinessAttempts = 0;
    legacyReadiness = true;
    const legacy = await runSmoke("https://worker.example.test", {
      expectedReleaseId: "11111111-1111-4111-8111-111111111111",
      legacyWorker: true,
    });
    assert.equal(legacy.legacyWorker, true);
    assert.equal(legacy.checks.length, 5);
    assert.equal(requested.some((request) => request.path === "/share/report"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("operational completion telemetry correlates responses without logging resource IDs or queries", async () => {
  const originalLog = console.log;
  const lines = [];
  console.log = (...values) => { lines.push(values.join(" ")); };
  try {
    const privateProjectId = "private-project-canary-123";
    const queryCanary = "query-secret-canary-456";
    const response = await worker.fetch(
      new Request(`https://app.example.test/api/projects/${privateProjectId}?share=${queryCanary}`),
      {
        ASSETS: assets,
        APP_ENV: "test",
        CF_VERSION_METADATA: { id: "release-canary-789" },
      },
    );
    assert.equal(response.status, 503);
    assert.equal(lines.length, 1);
    const completion = JSON.parse(lines[0]);
    assert.deepEqual({
      type: completion.type,
      environment: completion.environment,
      method: completion.method,
      route: completion.route,
      status: completion.status,
      outcome: completion.outcome,
      releaseId: completion.releaseId,
    }, {
      type: "request_complete",
      environment: "test",
      method: "GET",
      route: "/api/projects/:projectId",
      status: 503,
      outcome: "server_error",
      releaseId: "release-canary-789",
    });
    assert.match(completion.requestId, /^[0-9a-f-]{36}$/u);
    assert.equal(response.headers.get("x-request-id"), completion.requestId);
    assert.equal(lines[0].includes(privateProjectId), false);
    assert.equal(lines[0].includes(queryCanary), false);
  } finally {
    console.log = originalLog;
  }
});

test("unexpected dependency errors emit a fixed marker without leaking error text", async () => {
  const originalError = console.error;
  const originalLog = console.log;
  const errors = [];
  console.error = (...values) => { errors.push(values.join(" ")); };
  console.log = () => {};
  try {
    const dependencyCanary = "database-error-with-private-content-123";
    const response = await worker.fetch(
      new Request("https://app.example.test/api/projects/private-project-456", {
        headers: { cookie: "__Host-grihagrid_session=synthetic-session-token" },
      }),
      {
        ASSETS: assets,
        APP_ENV: "test",
        DB: { prepare() { throw new Error(dependencyCanary); } },
      },
    );
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "internal server error", code: "internal_error" });
    assert.deepEqual(errors, ["Unhandled API error"]);
    assert.equal(errors.join(" ").includes(dependencyCanary), false);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("scheduled hygiene retains active report handoffs and deletes only 90-day expired or revoked rows", async () => {
  const statements = [];
  let maintenance;
  const env = {
    DB: {
      prepare(sql) {
        return { sql };
      },
      async batch(batch) {
        statements.push(...batch.map((statement) => statement.sql));
        return [];
      },
    },
  };
  const ctx = {
    waitUntil(promise) {
      maintenance = promise;
    },
  };

  await worker.scheduled({}, env, ctx);
  await maintenance;

  const cleanup = statements.find((sql) => sql.includes("DELETE FROM report_shares"));
  assert.equal(
    cleanup,
    "DELETE FROM report_shares WHERE expires_at<datetime('now','-90 days') OR (revoked_at IS NOT NULL AND revoked_at<datetime('now','-90 days'))",
  );
  assert.equal(cleanup.includes("revoked_at IS NULL"), false);
  assert.equal(
    statements.find((sql) => sql.includes("DELETE FROM report_share_read_counters")),
    "DELETE FROM report_share_read_counters WHERE updated_at<datetime('now','-2 days')",
  );
  assert.equal(
    statements.find((sql) => sql.includes("DELETE FROM report_share_create_counters")),
    "DELETE FROM report_share_create_counters WHERE updated_at<datetime('now','-2 days')",
  );
});
