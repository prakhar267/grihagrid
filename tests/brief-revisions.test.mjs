import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import worker, { __test } from "../worker/index.js";

const completeInput = {
  width: 30,
  length: 50,
  city: "Pune",
  facing: "East",
  floors: "G+1",
  bedrooms: "3",
  bathrooms: 3,
  parking: "1 car",
  style: "Warm modern",
  quality: "Signature",
  roadWidthFt: 20,
  plotShape: "regular",
  accessibility: "none",
  futureUse: "none",
  budgetLakh: 50,
};

function projectRow(input = completeInput, overrides = {}) {
  const estimate = __test.computeEstimate(input);
  return {
    id: "project-brief-1",
    user_id: "owner-brief-1",
    name: "Rao residence",
    status: "feasibility_ready",
    input_json: JSON.stringify(input),
    estimate_json: JSON.stringify(estimate),
    brief_check_json: null,
    input_revision: 1,
    report_available: 0,
    created_at: "2026-08-15 00:00:00",
    updated_at: "2026-08-15 00:00:00",
    ...overrides,
  };
}

test("Brief Check uses only the three bounded, non-feasibility states", () => {
  const plausibleEstimate = __test.computeEstimate(completeInput);
  const plausible = __test.briefCheck(completeInput, plausibleEstimate);
  assert.equal(plausible.status, "directionally_plausible");
  assert.match(plausible.summary, /professional validation/iu);

  const incomplete = { ...completeInput, bathrooms: null, roadWidthFt: null, budgetLakh: null };
  const missing = __test.briefCheck(incomplete, __test.computeEstimate(incomplete));
  assert.equal(missing.status, "insufficient_information");
  assert.deepEqual(missing.missingFields.map((item) => item.field), ["bathrooms", "roadWidthFt", "budgetLakh"]);

  const tenseInput = { ...completeInput, width: 20, roadWidthFt: 10, budgetLakh: 5 };
  const tense = __test.briefCheck(tenseInput, __test.computeEstimate(tenseInput));
  assert.equal(tense.status, "programme_tension");
  assert.deepEqual(tense.tensions.map((item) => item.code), [
    "narrow_frontage_parking",
    "narrow_road_parking",
    "budget_below_range",
  ]);

  for (const result of [plausible, missing, tense]) {
    assert.equal(["insufficient_information", "programme_tension", "directionally_plausible"].includes(result.status), true);
    assert.equal(/\b(?:feasible|approved|compliant|guaranteed)\b/iu.test(`${result.headline} ${result.summary}`), false);
  }
});

test("revision input validation is allowlisted and keeps honest unknown defaults", () => {
  assert.deepEqual(__test.normalizeRevisionPatch({
    bathrooms: null,
    roadWidthFt: null,
    plotShape: "unknown",
    accessibility: "unknown",
    futureUse: "unknown",
    budgetLakh: null,
  }), {
    bathrooms: null,
    roadWidthFt: null,
    plotShape: "unknown",
    accessibility: "unknown",
    futureUse: "unknown",
    budgetLakh: null,
  });
  assert.throws(
    () => __test.normalizeRevisionPatch({ legacyPrivateNote: "must remain server-side" }),
    (error) => error.status === 400 && error.code === "invalid_revision_request",
  );
  assert.throws(() => __test.normalizeRevisionPatch({ bathrooms: 0 }), /bathrooms is invalid/iu);
  assert.throws(() => __test.normalizeRevisionPatch({ plotShape: "triangle" }), /plot shape is invalid/iu);
  for (const patch of [
    { width: [30] },
    { width: "30" },
    { width: true },
    { city: ["Pune"] },
    { city: true },
    { bedrooms: [3] },
    { bedrooms: "3" },
    { bedrooms: true },
    { bathrooms: "3" },
    { parking: ["1 car"] },
    { style: ["Warm modern"] },
  ]) {
    assert.throws(
      () => __test.normalizeRevisionPatch(patch),
      (error) => error.status === 400 && error.code === "invalid_revision_request",
      JSON.stringify(patch),
    );
  }
});

test("Change Study is deterministic, consequence-complete, and rejects no-op commits upstream", () => {
  const beforeEstimate = __test.computeEstimate(completeInput);
  const afterInput = { ...completeInput, floors: "G+2", quality: "Premium" };
  const afterEstimate = __test.computeEstimate(afterInput);
  const impact = __test.changeStudy(completeInput, beforeEstimate, afterInput, afterEstimate);
  assert.equal(impact.hasChanges, true);
  assert.deepEqual(impact.changedFields.map((item) => item.field), ["floors", "quality"]);
  assert.equal(impact.estimateDeltas.builtUpSqft.delta, afterEstimate.builtUpSqft - beforeEstimate.builtUpSqft);
  assert.deepEqual(impact.consequences.map((item) => item.code), [
    "feasibility_refresh",
    "comparison_historical",
    "family_rooms_closed",
    "purchases_unchanged",
  ]);
  assert.equal(__test.changeStudy(completeInput, beforeEstimate, completeInput, beforeEstimate).hasChanges, false);
});

test("legacy input remains historical but is removed from every prepared revision", () => {
  const stored = { ...completeInput, legacyPrivateNote: "PRIVATE_CANARY" };
  const candidate = __test.prepareRevisionCandidate(projectRow(stored), { bathrooms: 4 });
  assert.equal(Object.hasOwn(candidate.input, "legacyPrivateNote"), false, "new revision candidates must be canonical");

  const projected = __test.revisionFromRow({
    project_id: "project-brief-1",
    revision: 2,
    provenance: "updated",
    input_schema_version: 1,
    estimate_rule_version: 1,
    brief_check_version: 1,
    input_json: JSON.stringify(candidate.input),
    estimate_json: JSON.stringify(candidate.estimate),
    brief_check_json: JSON.stringify(candidate.briefCheck),
    created_at: "2026-08-15 00:05:00",
    report_available: 0,
    report_schema_version: null,
    report_generated_at: null,
  }, 2, true);
  assert.equal(Object.hasOwn(projected.input, "legacyPrivateNote"), false);
  assert.deepEqual(Object.keys(projected.input), [
    "width", "length", "city", "facing", "floors", "bedrooms", "bathrooms", "parking",
    "style", "quality", "roadWidthFt", "plotShape", "accessibility", "futureUse", "budgetLakh",
  ]);
});

test("PATCH control fields cannot be misclassified as editable input", () => {
  assert.deepEqual(__test.directInput({
    input: { bathrooms: 3 },
    expectedInputRevision: 4,
    acceptedImpact: true,
    name: "Home",
    status: "feasibility_ready",
  }), {});
  assert.deepEqual(__test.directInput({ expectedInputRevision: 4, width: 32 }), { width: 32 });
});

test("report v2 embeds Brief Check and avoids unsupported fit/compliance claims", () => {
  const row = projectRow();
  const report = __test.buildReport(row, "a".repeat(64), "report-v2", "2026-08-15 00:10:00");
  assert.equal(report.version, 2);
  assert.equal(report.briefCheck.status, "directionally_plausible");
  assert.match(report.summary.verdict, /professional validation is still required/iu);
  assert.doesNotMatch(JSON.stringify(report), /\bfeasib(?:le|ility)\b/iu);
  const spaces = report.areaProgram.suggestedSpaces.join(" ");
  assert.doesNotMatch(spaces, /code-compliant|at least one on-plot parking bay/iu);
  assert.match(spaces, /professional sizing/iu);
});

test("malformed revision project paths return bounded JSON and redact operational IDs", async () => {
  const env = { ASSETS: { fetch: async () => new Response("not found", { status: 404 }) } };
  for (const path of ["/api/projects/%ZZ/revisions", "/api/projects/%ZZ/report", "/api/projects/%ZZ/files"]) {
    const response = await worker.fetch(new Request(`https://app.example.test${path}`, {
      headers: { accept: "application/json" },
    }), env);
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: "project not found", code: "project_not_found" }, path);
  }
  const order = await worker.fetch(new Request("https://app.example.test/api/orders/%ZZ", {
    headers: { accept: "application/json" },
  }), env);
  assert.equal(order.status, 404);
  assert.deepEqual(await order.json(), { error: "order not found", code: "order_not_found" });
  assert.equal(__test.operationalRoute("/api/projects/private-project/revisions/28/report"), "/api/projects/:projectId/revisions/:revision/report");
  const unmatchedCanary = "PRIVATE_UNKNOWN_SUFFIX_CANARY";
  for (const unmatchedPath of [
    `/api/projects/private-project/${unmatchedCanary}/nested`,
    `/api/orders/private-order/${unmatchedCanary}/nested`,
  ]) {
    const unmatchedRoute = __test.operationalRoute(unmatchedPath);
    assert.equal(unmatchedRoute, "/api/:unmatched", unmatchedPath);
    assert.equal(unmatchedRoute.includes(unmatchedCanary), false, unmatchedPath);
  }
});

test("migration 0012 has cascade-safe ownership and atomic immutability fences", async () => {
  const sql = await readFile(new URL("../migrations/0012_brief_check_revision_history.sql", import.meta.url), "utf8");
  for (const table of ["project_revisions", "project_revision_requests", "project_revision_reports"]) {
    const section = sql.slice(sql.indexOf(`CREATE TABLE ${table}`), sql.indexOf(";", sql.indexOf(`CREATE TABLE ${table}`)) + 1);
    assert.doesNotMatch(section, /user_id|REFERENCES users/iu, `${table} must inherit ownership only through its project cascade`);
  }
  assert.match(sql, /project revision compare and swap failed/iu);
  assert.match(sql, /report source revision changed/iu);
  assert.match(sql, /WHEN EXISTS \(SELECT 1 FROM projects p WHERE p\.id=OLD\.project_id\)/iu);
  assert.match(sql, /ALTER TABLE reports ADD COLUMN project_input_revision/iu);
  assert.doesNotMatch(
    sql,
    /CREATE TRIGGER project_revisions_identity_guard[\s\S]*?WHEN NEW\.provenance!='migration_baseline'/u,
    "future migration_baseline inserts must not bypass current-source identity",
  );
});
