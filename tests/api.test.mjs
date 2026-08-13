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
  assert.throws(() => __test.canonicalAppOrigin({ APP_ORIGIN: "http://app.example.test" }), /not configured/u);
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
  const { estimate } = await response.json();
  assert.equal(estimate.builtUpSqft, 1830);
  assert.equal(estimate.lowInr, 3703920);
  assert.equal(estimate.highInr, 4428600);
});

test("estimate endpoint rejects unsafe dimensions", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ width: 2, length: 900 }),
  }), { ASSETS: assets });
  assert.equal(response.status, 400);
});
