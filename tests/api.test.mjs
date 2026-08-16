import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const assets = { fetch: async () => new Response("missing", { status: 404 }) };

test("liveness endpoint is dependency-independent and safe without bindings", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/health"), { ASSETS: assets });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.status, "ok");
  assert.equal(body.service, "grihagrid");
  assert.equal(typeof body.time, "string");
  assert.equal("database" in body, false);
  assert.match(response.headers.get("x-request-id"), /^[0-9a-f-]{36}$/u);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("public Decision Compare projection excludes owner and snapshot internals", () => {
  const internalScenarioId = "private-comparison-id_a";
  const artifact = __test.publicDecisionArtifact({
    id: "private-comparison-id",
    projectId: "private-project-id",
    projectName: "12 Secret Street",
    projectUpdatedAt: "2026-08-14 00:00:00",
    sourceInputHash: "source-secret-hash",
    contentHash: "content-secret-hash",
    purchasedAt: "2026-08-14 00:00:00",
    version: 3,
    priority: "budget",
    selectedScenarioId: internalScenarioId,
    selection: { scenarioId: internalScenarioId, selectedAt: "private-time" },
    scenarios: [
      {
        id: internalScenarioId,
        label: "Compact plan",
        input: { floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "Private family note" },
        estimate: { builtUpSqft: 1_800, lowInr: 3_000_000, highInr: 4_000_000 },
        programme: { summary: "G+1 · 3 bedrooms", detail: "Parking required · Signature finish" },
        constraints: ["Verify setbacks."], assumptions: ["Indicative only."], tradeoffs: ["Lower area."],
      },
      {
        id: "private-comparison-id_b",
        label: "Roomier plan",
        input: { floors: "G+2", bedrooms: 4, parking: true, quality: "Premium", notes: "Another private note" },
        estimate: { builtUpSqft: 2_400, lowInr: 5_000_000, highInr: 6_000_000 },
        programme: { summary: "G+2 · 4 bedrooms", detail: "Parking required · Premium finish" },
        constraints: ["Verify height."], assumptions: ["Indicative only."], tradeoffs: ["Higher cost."],
      },
    ],
    recommendation: { scenarioId: internalScenarioId, headline: "Start compact.", rationale: "It protects budget." },
    assumptions: ["Concept stage."], questionsForArchitect: ["What changes locally?"], disclaimer: "Verify professionally.",
  });

  assert.equal(artifact.selectedScenarioId, "option_a");
  assert.equal(artifact.recommendation.scenarioId, "option_a");
  assert.deepEqual(artifact.scenarios.map((scenario) => scenario.id), ["option_a", "option_b"]);
  const serialized = JSON.stringify(artifact);
  for (const secret of [
    "12 Secret Street", "private-project-id", "private-comparison-id", "source-secret-hash",
    "content-secret-hash", "Private family note", "Another private note", "private-time",
  ]) assert.equal(serialized.includes(secret), false, secret);
  for (const forbidden of ["projectName", "projectId", "contentHash", "sourceInputHash", "purchasedAt", "selection", "input", "notes"]) {
    assert.equal(Object.hasOwn(artifact, forbidden), false, forbidden);
  }
  assert.equal(Object.hasOwn(artifact.scenarios[0], "input"), false);
});

test("share origins are canonical HTTPS URLs and sensitive routes fail closed without abuse control", async () => {
  assert.equal(__test.canonicalAppOrigin({ APP_ORIGIN: "https://app.example.test" }), "https://app.example.test");
  assert.equal(
    __test.canonicalAppOrigin({ APP_ENV: "test", APP_ORIGIN: "http://127.0.0.1:8791" }),
    "http://127.0.0.1:8791",
  );
  assert.throws(() => __test.canonicalAppOrigin({ APP_ORIGIN: "http://app.example.test" }), /not configured/u);
  assert.throws(
    () => __test.canonicalAppOrigin({ APP_ENV: "test", APP_ORIGIN: "http://app.example.test" }),
    /not configured/u,
  );
  assert.throws(
    () => __test.canonicalAppOrigin({ APP_ENV: "staging", APP_ORIGIN: "http://127.0.0.1:8791" }),
    /not configured/u,
  );
  assert.throws(() => __test.canonicalAppOrigin({ APP_ORIGIN: "https://app.example.test/path" }), /not configured/u);

  const shared = await worker.fetch(new Request("https://example.test/api/shared/decision-compare/abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNO"), {
    ASSETS: assets,
    DECISION_COMPARE_FULFILLMENT_ENABLED: "true",
  });
  assert.equal(shared.status, 503);
  assert.equal((await shared.json()).code, "abuse_control_unavailable");
});

test("estimate endpoint validates and computes normalized results", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" }),
  }), { ASSETS: assets });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  const { input, estimate, basis } = await response.json();
  assert.deepEqual(input, { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" });
  assert.equal(estimate.builtUpSqft, 1830);
  assert.equal(estimate.lowInr, 3703920);
  assert.equal(estimate.highInr, 4428600);
  assert.deepEqual(basis, {
    ruleVersion: 1,
    rulePublishedDate: "2026-08-16",
    benchmarkStatus: "internal_directional_rule",
    marketBenchmarkAsOf: null,
    marketWarning: "Internal planning assumptions are not independently calibrated to current local quotes. Rates vary with specification, contractor, availability, and market conditions; verify current local quotations before decisions.",
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
    exclusions: [
      "Land purchase and finance costs",
      "Taxes, statutory fees, utility connections, and municipal charges",
      "Abnormal ground, retaining, foundation, demolition, and external works",
      "Loose furniture, appliances, and owner-specific upgrades",
    ],
  });
});

test("estimate endpoint rejects unsafe dimensions", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 2, length: 900 }),
  }), { ASSETS: assets });
  assert.equal(response.status, 400);
});

test("estimate endpoint rejects unsupported fields, enum typos, and scalar coercion", async () => {
  const fixtures = [
    { width: "30", length: 50, floors: "G+1", quality: "Signature", city: "Pune" },
    { width: true, length: 50, floors: "G+1", quality: "Signature", city: "Pune" },
    { width: 30, length: 50, floors: "G+9", quality: "Signature", city: "Pune" },
    { width: 30, length: 50, floors: "G+1", quality: "signature", city: "Pune" },
    { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Puna" },
    { width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune", address: "private" },
  ];
  for (const body of fixtures) {
    const response = await worker.fetch(new Request("https://example.test/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }), { ASSETS: assets });
    assert.equal(response.status, 400, JSON.stringify(body));
    assert.equal((await response.json()).code, "invalid_estimate_request", JSON.stringify(body));
  }

  const nonFinite = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: '{"width":1e309,"length":50,"floors":"G+1","quality":"Signature","city":"Pune"}',
  }), { ASSETS: assets });
  assert.equal(nonFinite.status, 400);
  assert.equal((await nonFinite.json()).code, "invalid_estimate_request");
});

test("estimate endpoint accepts exact inclusive bounds and explicit defaults", () => {
  for (const dimensions of [[10, 10], [500, 500]]) {
    const envelope = __test.publicEstimateEnvelope({ width: dimensions[0], length: dimensions[1] });
    assert.deepEqual(envelope.input, {
      width: dimensions[0],
      length: dimensions[1],
      floors: "G+1",
      quality: "Signature",
      city: "Other",
    });
    assert.equal(Number.isFinite(envelope.estimate.lowInr), true);
    assert.equal(envelope.estimate.lowInr <= envelope.estimate.highInr, true);
  }
});

test("every public city, floor, finish, and dimension boundary reconciles with project calculation", () => {
  const floorFactors = { G: 0.72, "G+1": 1.22, "G+2": 1.65 };
  const finishRates = { Essential: 1750, Signature: 2200, Premium: 2850, Luxury: 3900 };
  const cityFactors = { Pune: 1, Bengaluru: 1.08, Mumbai: 1.18, Delhi: 1.1, Hyderabad: 0.98, Chennai: 1.02, Jaipur: 0.88, Other: 0.95 };
  for (const [width, length] of [[10, 10], [500, 500]]) {
    for (const [floors, floorFactor] of Object.entries(floorFactors)) {
      for (const [quality, finishRateInrPerSqft] of Object.entries(finishRates)) {
        for (const [city, cityFactor] of Object.entries(cityFactors)) {
          const input = { width, length, floors, quality, city };
          const envelope = __test.publicEstimateEnvelope(input);
          const builtUpSqft = Math.round(width * length * floorFactor);
          const midpoint = builtUpSqft * finishRateInrPerSqft * cityFactor;
          assert.deepEqual(envelope.estimate, __test.computeEstimate(input), JSON.stringify(input));
          assert.equal(envelope.estimate.plotSqft, width * length, JSON.stringify(input));
          assert.equal(envelope.estimate.builtUpSqft, builtUpSqft, JSON.stringify(input));
          assert.equal(envelope.estimate.lowInr, Math.round(midpoint * 0.92), JSON.stringify(input));
          assert.equal(envelope.estimate.highInr, Math.round(midpoint * 1.1), JSON.stringify(input));
          assert.equal(envelope.basis.floorFactor, floorFactor, JSON.stringify(input));
          assert.equal(envelope.basis.finishRateInrPerSqft, finishRateInrPerSqft, JSON.stringify(input));
          assert.equal(envelope.basis.cityFactor, cityFactor, JSON.stringify(input));
        }
      }
    }
  }
});

test("estimate endpoint rejects malformed JSON and the wrong content type", async () => {
  const malformed = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{not-json",
  }), { ASSETS: assets });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).code, "invalid_json");

  const wrongContentType = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "text/plain" },
    body: JSON.stringify({ width: 30, length: 50 }),
  }), { ASSETS: assets });
  assert.equal(wrongContentType.status, 415);
  assert.equal((await wrongContentType.json()).code, "unsupported_media_type");
});
