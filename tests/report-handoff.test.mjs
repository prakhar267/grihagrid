import assert from "node:assert/strict";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

function sourceReport() {
  const input = {
    width: 30,
    length: 50,
    city: "Pune",
    facing: "East",
    floors: "G+1",
    bedrooms: "3",
    bathrooms: 3,
    parking: true,
    style: "Quiet courtyard home",
    quality: "Signature",
    roadWidthFt: 24,
    plotShape: "regular",
    accessibility: "none",
    futureUse: "none",
    budgetLakh: 50,
  };
  const estimate = __test.computeEstimate(input);
  const project = {
    id: "project-private-canary",
    name: "Owner Name owner@example.test",
    input_json: JSON.stringify(input),
    estimate_json: JSON.stringify(estimate),
    brief_check_json: JSON.stringify(__test.briefCheck(input, estimate)),
  };
  return __test.buildReport(
    project,
    "a".repeat(64),
    "internal-report-id",
    "2026-08-16 10:00:00",
  );
}

test("report share requests require exact primitive fields and canonicalize sections", () => {
  assert.deepEqual(__test.normalizeReportShareRequest({
    projectRevision: 3,
    reportSchemaVersion: 2,
    expiresInDays: 7,
    sections: ["risks", "overview", "cost"],
  }), {
    projectRevision: 3,
    reportSchemaVersion: 2,
    expiresInDays: 7,
    sections: ["overview", "cost", "risks"],
  });

  for (const body of [
    { projectRevision: "3", reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 1, expiresInDays: 7, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: "7", sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 2, sections: ["overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: [] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview", "overview"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["raw_input"] },
    { projectRevision: 3, reportSchemaVersion: 2, expiresInDays: 7, sections: ["overview"], note: "free text" },
  ]) {
    assert.throws(() => __test.normalizeReportShareRequest(body), /report|sections|expiry|projectRevision/u);
  }
});

test("public report projection is selected, bounded, and recursively redacted", () => {
  const report = sourceReport();
  report.ownerEmail = "leak-owner@example.test";
  report.rawInput = { facing: "secret-facing" };
  report.briefCheck.internal = "secret-check";
  report.summary.city = "secret-city";
  report.areaProgram.projectId = "secret-project";
  report.costPlan.providerOrderId = "secret-provider";
  report.deliveryPlan.phases[0].internalId = "secret-phase";

  const sections = __test.publicReportShareProjection(report, [
    "overview", "programme", "cost", "timeline", "risks", "next_actions",
  ]);
  assert.deepEqual(Object.keys(sections), ["overview", "programme", "cost", "timeline", "risks", "nextActions"]);
  assert.deepEqual(Object.keys(sections.overview), ["status", "label", "headline", "summary", "disclaimer"]);
  assert.deepEqual(Object.keys(sections.programme), [
    "plotSqft", "targetBuiltUpSqft", "floorCount", "bedrooms", "bathrooms",
    "estimatedFloorPlateSqft", "estimatedOpenAreaSqft", "suggestedSpaces",
  ]);
  assert.deepEqual(Object.keys(sections.cost.categories[0]), ["name", "percent", "amountInr"]);
  assert.deepEqual(Object.keys(sections.timeline.phases[0]), ["name", "weeks"]);
  const serialized = JSON.stringify(sections);
  for (const secret of [
    "Owner Name", "owner@example.test", "leak-owner@example.test", "project-private-canary",
    "internal-report-id", "secret-facing", "secret-check", "secret-city", "secret-project",
    "secret-provider", "secret-phase", "Quiet courtyard home", "Pune", "East", "a".repeat(64),
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }

  const overviewOnly = __test.publicReportShareProjection(report, ["overview"]);
  assert.deepEqual(Object.keys(overviewOnly), ["overview"]);
  assert.equal(JSON.stringify(overviewOnly).includes("lowInr"), false);

  const malformed = structuredClone(report);
  malformed.costPlan.lowInr = Number.POSITIVE_INFINITY;
  assert.throws(
    () => __test.publicReportShareProjection(malformed, ["cost"]),
    /shared report is unavailable/u,
  );
  const oversized = structuredClone(report);
  oversized.risks = ["x".repeat(1_001)];
  assert.throws(
    () => __test.publicReportShareProjection(oversized, ["risks"]),
    /shared report is unavailable/u,
  );
});

test("owner metadata never returns stored hashes and emits the URL only with the fresh token", () => {
  const row = {
    id: "share-id",
    project_id: "private-project",
    user_id: "private-user",
    project_revision: 4,
    report_schema_version: 2,
    sections_json: JSON.stringify(["overview", "next_actions"]),
    report_content_hash: "a".repeat(64),
    token_hash: "b".repeat(64),
    idempotency_key_hash: "c".repeat(43),
    request_hash: "d".repeat(64),
    expires_at: "2099-08-23 10:00:00",
    revoked_at: null,
    access_count: 2,
    created_at: "2099-08-16 10:00:00",
  };
  const metadata = __test.reportShareMetadata(row);
  assert.deepEqual(metadata, {
    id: "share-id",
    projectRevision: 4,
    reportSchemaVersion: 2,
    sections: ["overview", "next_actions"],
    expiresAt: "2099-08-23 10:00:00",
    revokedAt: null,
    active: true,
    accessCount: 2,
    lastAccessedAt: null,
    createdAt: "2099-08-16 10:00:00",
  });
  assert.equal(JSON.stringify(metadata).includes("private-project"), false);
  assert.equal(Object.hasOwn(metadata, "url"), false);
  assert.equal(
    __test.reportShareMetadata(row, "https://app.example.test", "t".repeat(43)).url,
    `https://app.example.test/share/report#${"t".repeat(43)}`,
  );
});

test("report bearer redemption uses one constant route and admits malformed bodies before generic rejection", async () => {
  const token = "s".repeat(43);
  assert.equal(token.length, 43);
  assert.equal(__test.operationalRoute("/api/shared/report"), "/api/shared/report");
  assert.equal(__test.operationalRoute("/share/report"), "/share/report");
  let admissions=0;
  const guardedEnv={
    GRIHAGRID_CACHE:{get:async()=>null,put:async()=>{}},
    DB:{prepare(sql){
      assert.match(sql,/INSERT INTO report_share_read_counters/u);
      return {bind(){return {first:async()=>{admissions+=1;return {request_count:admissions}}}}};
    }},
  };

  for (const request of [
    new Request("https://app.example.test/api/shared/report", { method: "POST" }),
    new Request("https://app.example.test/api/shared/report", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }),
    new Request("https://app.example.test/api/shared/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, extra: true }) }),
    new Request("https://app.example.test/api/shared/report", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "malformed" }) }),
  ]) {
    const malformed = await worker.fetch(request, guardedEnv, {});
    const payload = await malformed.json();
    assert.equal(malformed.status, 404);
    assert.deepEqual(payload, { error: "shared report not found", code: "report_share_not_found" });
    assert.equal(JSON.stringify(payload).includes(token), false);
    assert.equal(malformed.headers.get("cache-control"), "no-store");
    assert.equal(malformed.headers.get("referrer-policy"), "no-referrer");
  }
  assert.equal(admissions,4);

  const wrongMethod = await worker.fetch(new Request("https://app.example.test/api/shared/report"), {}, {});
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get("allow"), "POST");

  const failClosed = await worker.fetch(
    new Request("https://app.example.test/api/shared/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "a".repeat(43) }),
    }),
    {},
    {},
  );
  assert.equal(failClosed.status, 503);
  assert.equal((await failClosed.json()).code, "abuse_control_unavailable");
});

test("exact report handoff documents are non-cacheable and non-indexable for GET and HEAD", async () => {
  const assets = {
    fetch: async (request) => new URL(request.url).pathname === "/index.html"
      ? new Response("<!doctype html><title>GrihaGrid</title>", { headers: { "content-type": "text/html" } })
      : new Response("missing", { status: 404 }),
  };
  for (const method of ["GET", "HEAD"]) {
    const response = await worker.fetch(new Request("https://app.example.test/share/report", {
      method,
      headers: { accept: "text/html" },
    }), { ASSETS: assets }, {});
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-robots-tag"), "noindex,nofollow,noarchive");
    assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  }
});
