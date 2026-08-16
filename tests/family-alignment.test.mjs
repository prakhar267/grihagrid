import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

function response(preference, confidence = "medium", reasons = ["budget"]) {
  return { preference, confidence, reasons_json: JSON.stringify(reasons) };
}

test("Family Alignment derives bounded owner-only statuses and aggregates", () => {
  assert.deepEqual(__test.familyAlignmentSummary([]), {
    status: "no_responses",
    totalResponses: 0,
    preferences: { A: 0, B: 0, notReady: 0 },
    confidence: { high: 0, medium: 0, low: 0 },
    reasons: { budget: 0, space: 0, parking: 0, accessibility: 0, futureExpansion: 0, constructionComplexity: 0 },
  });
  assert.equal(__test.familyAlignmentSummary([response("not_ready")]).status, "not_ready");
  assert.equal(__test.familyAlignmentSummary([response("A")]).status, "leaning_a");
  assert.equal(__test.familyAlignmentSummary([response("B"), response("B", "high", ["future_expansion", "construction_complexity"])]).status, "aligned_b");
  assert.equal(__test.familyAlignmentSummary([response("A"), response("A"), response("not_ready")]).status, "leaning_a");
  assert.equal(__test.familyAlignmentSummary([response("A"), response("B")]).status, "split");

  const aggregate = __test.familyAlignmentSummary([
    response("A", "high", ["space", "future_expansion"]),
    response("A", "low", ["space", "construction_complexity"]),
  ]);
  assert.deepEqual(aggregate.preferences, { A: 2, B: 0, notReady: 0 });
  assert.deepEqual(aggregate.confidence, { high: 1, medium: 0, low: 1 });
  assert.equal(aggregate.reasons.space, 2);
  assert.equal(aggregate.reasons.futureExpansion, 1);
  assert.equal(aggregate.reasons.constructionComplexity, 1);
});

test("Family Alignment accepts only the exact structured response vocabulary", () => {
  const valid = {
    role: "spouse",
    preference: "A",
    confidence: "high",
    reasons: ["space", "accessibility", "future_expansion"],
  };
  assert.deepEqual(__test.normalizeFamilyAlignmentResponse(valid), valid);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, comment: "call me" }), /only role/u);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, preference: "scenario_a" }), /invalid structured choice/u);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, role: "architect" }), /invalid structured choice/u);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, reasons: ["space", "space"] }), /different supported reasons/u);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, reasons: [] }), /one and three/u);
  assert.throws(() => __test.normalizeFamilyAlignmentResponse({ ...valid, reasons: ["location"] }), /supported reasons/u);
});

test("Family Alignment public projection is a neutral A/B allowlist without owner, plot, notes, IDs, or recommendation", () => {
  const row = {
    id: "room-public-opaque",
    comparison_version: 7,
    response_count: 2,
    created_at: "2026-08-14 10:00:00",
    expires_at: "2026-08-21 10:00:00",
    content_json: JSON.stringify({
      projectName: "Rao family, secret lane",
      projectId: "project-private",
      sourceInputHash: "f".repeat(64),
      plot: { width: 31, length: 47, city: "Pune", facing: "East" },
      recommendation: { scenarioId: "scenario-private-a", headline: "Choose A" },
      selectedScenarioId: "scenario-private-a",
      questionsForArchitect: ["Private question"],
      assumptions: ["Both options use the same plot, city factor, and concept-stage cost basis."],
      disclaimer: "Concept-stage decision aid only.",
      scenarios: [
        {
          id: "scenario-private-a",
          label: "Ananya's east-lane courtyard",
          input: { floors: "G+1", bedrooms: 3, parking: true, quality: "Signature", notes: "Mother needs privacy" },
          estimate: { builtUpSqft: 1776, lowInr: 3_594_000, highInr: 4_297_000 },
          programme: { summary: "private programme", detail: "private detail" },
          assumptions: ["31 × 47 ft in Pune"],
          constraints: ["Parking and a comfortable entrance compete for a narrow frontage."],
          tradeoffs: ["Protects about ₹4 lakh."],
        },
        {
          id: "scenario-private-b",
          label: "Brother's rental idea",
          input: { floors: "G+2", bedrooms: 4, parking: false, quality: "Premium", notes: "Call 9999999999" },
          estimate: { builtUpSqft: 2400, lowInr: 6_000_000, highInr: 7_000_000 },
          programme: { summary: "private programme b", detail: "private detail b" },
          assumptions: ["31 × 47 ft in Pune"],
          constraints: ["A third level increases vertical circulation."],
          tradeoffs: ["Adds derived area."],
        },
      ],
    }),
  };
  const projection = __test.familyAlignmentPublicProjection(row);
  assert.equal(projection.id, row.id);
  assert.deepEqual(projection.scenarios.map(({ key, label }) => ({ key, label })), [
    { key: "A", label: "Option A" },
    { key: "B", label: "Option B" },
  ]);
  assert.deepEqual(projection.scenarios[0].programme, { summary: "G+1 · 3 bedrooms", detail: "Parking required · Signature finish" });
  assert.equal(Object.hasOwn(projection.scenarios[0], "assumptions"), false);
  const serialized = JSON.stringify(projection);
  for (const forbidden of [
    "Rao family", "secret lane", "Pune", "31 × 47", "East", "Ananya", "Brother", "Mother", "9999999999",
    "scenario-private", "project-private", "sourceInputHash", "recommendation", "selectedScenarioId", "questionsForArchitect",
  ]) assert.equal(serialized.includes(forbidden), false, `projection leaked ${forbidden}`);
});

test("Family Alignment bearer paths are templated in operational logs", () => {
  assert.equal(__test.operationalRoute(`/api/family-alignment/${"a".repeat(43)}`), "/api/family-alignment/:token");
  assert.equal(__test.operationalRoute(`/api/family-alignment/${"b".repeat(43)}/response`), "/api/family-alignment/:token/response");
  assert.equal(__test.operationalRoute(`/align/${"c".repeat(43)}`), "/align/:token");
  assert.equal(__test.operationalRoute("/api/projects/project-secret/family-alignment/room-secret"), "/api/projects/:projectId/family-alignment/:roomId");
});

test("malformed percent escapes on Family bearer routes are rejected without a 500", async () => {
  const errors = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values) => { errors.push(values.join(" ")); };
  console.log = () => {};
  try {
    const response = await worker.fetch(new Request("https://app.example.test/api/family-alignment/%ZZ"), {
      GRIHAGRID_CACHE: { get: async () => null, put: async () => {} },
      DB: { prepare() { throw new Error("database must not be touched for a malformed token"); } },
      ASSETS: { fetch: async () => new Response("missing", { status: 404 }) },
    });
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "review room not found", code: "family_alignment_not_found" });
    assert.equal(errors.length, 0);
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
});

test("Family Alignment frontend hides the comparison and retries temporary admission failures", async () => {
  const app = await readFile(new URL("../src/App.jsx", import.meta.url), "utf8");
  const start = app.indexOf("function FamilyAlignmentReviewPage(");
  const end = app.indexOf("function CheckoutReturnPage(", start);
  assert.ok(start >= 0 && end > start, "Family Alignment review must remain a discrete frontend flow");
  const review = app.slice(start, end);
  assert.match(review, /if\(err\.status===410\)setPhase\('closed'\)/u);
  assert.match(review, /else if\(err\.status===404\)setPhase\('unavailable'\)/u);
  assert.match(review, /setRoom\(null\)/u, "each load must clear any stale comparison before admission");
  assert.match(review, /setPhase\('temporary'\)/u, "dependency failures must use a retryable private state");
  assert.match(review, /The review remains private and nothing was submitted\./u);
  assert.match(review, /setLoadAttempt\(value=>value\+1\)/u, "retry must re-run admission for the same bearer link");
  assert.match(review, /Try this link again/u);
  assert.match(review, /ref=\{stateHeadingRef\} tabIndex="-1"/u, "asynchronous terminal states must receive focus");
  assert.match(review, /This family review has ended\./u);
  assert.match(review, /No response can be viewed or submitted from this link\./u);
});
