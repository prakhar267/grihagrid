import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import worker, { __test } from "../worker/index.js";

const familyCapability = "f".repeat(43);

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
  assert.equal(__test.operationalRoute("/api/shared/family-alignment"), "/api/shared/family-alignment");
  assert.equal(__test.operationalRoute("/api/shared/family-alignment/response"), "/api/shared/family-alignment/response");
  assert.equal(__test.operationalRoute("/align"), "/align");
  assert.equal(__test.operationalRoute(`/api/family-alignment/${"a".repeat(43)}`), "/api/family-alignment/:token");
  assert.equal(__test.operationalRoute(`/api/family-alignment/${"b".repeat(43)}/response`), "/api/family-alignment/:token/response");
  assert.equal(__test.operationalRoute(`/align/${"c".repeat(43)}`), "/align/:token");
  assert.equal(__test.operationalRoute("/api/projects/project-secret/family-alignment/room-secret"), "/api/projects/:projectId/family-alignment/:roomId");
});

test("Family Alignment public envelopes require one exact 43-character capability and a nested structured response", () => {
  assert.deepEqual(__test.normalizePublicFamilyAlignmentRequest({ token: familyCapability }), {
    token: familyCapability,
  });
  const response = {
    role: "spouse",
    preference: "A",
    confidence: "high",
    reasons: ["space", "accessibility"],
  };
  assert.deepEqual(
    __test.normalizePublicFamilyAlignmentRequest({ token: familyCapability, response }, true),
    { token: familyCapability, response },
  );

  for (const body of [
    {},
    { token: familyCapability, extra: true },
    { token: "f".repeat(42) },
    { token: "f".repeat(44) },
    { token: `${"f".repeat(42)}!` },
    { token: 123 },
    [familyCapability],
    null,
  ]) {
    assert.throws(() => __test.normalizePublicFamilyAlignmentRequest(body));
  }
  for (const body of [
    { token: familyCapability },
    { token: familyCapability, response, extra: true },
    { token: familyCapability, role: response.role, preference: response.preference, confidence: response.confidence, reasons: response.reasons },
  ]) {
    assert.throws(() => __test.normalizePublicFamilyAlignmentRequest(body, true));
  }
  const invalidNestedResponse = { ...response, comment: "private free text" };
  assert.deepEqual(
    __test.normalizePublicFamilyAlignmentRequest({ token: familyCapability, response: invalidNestedResponse }, true),
    { token: familyCapability, response: invalidNestedResponse },
    "response validation must wait until after a well-shaped capability is admitted",
  );
});

test("Family Alignment public envelopes use exact JSON media types and route-specific byte limits", async () => {
  const read = new Request("https://app.example.test/api/shared/family-alignment", {
    method: "POST",
    headers: { "content-type": "Application/JSON; charset=utf-8" },
    body: JSON.stringify({ token: familyCapability }),
  });
  assert.deepEqual(await __test.readPublicFamilyAlignmentRequest(read), { token: familyCapability });

  const structuredResponse = {
    role: "parent",
    preference: "not_ready",
    confidence: "medium",
    reasons: ["budget"],
  };
  const write = new Request("https://app.example.test/api/shared/family-alignment/response", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: familyCapability, response: structuredResponse }),
  });
  assert.deepEqual(await __test.readPublicFamilyAlignmentRequest(write, true), {
    token: familyCapability,
    response: structuredResponse,
  });

  for (const [includeResponse, limit] of [[false, 512], [true, 1_536]]) {
    await assert.rejects(
      __test.readPublicFamilyAlignmentRequest(new Request("https://app.example.test/api/shared/family-alignment", {
        method: "POST",
        headers: { "content-type": "application/json", "content-length": String(limit + 1) },
        body: JSON.stringify({ token: familyCapability }),
      }), includeResponse),
    );
  }
  await assert.rejects(__test.readPublicFamilyAlignmentRequest(new Request(
    "https://app.example.test/api/shared/family-alignment",
    { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ token: familyCapability }) },
  )));
});

test("chunked Family Alignment capability bodies are cancelled once the read envelope exceeds 512 bytes", async () => {
  const encoder = new TextEncoder();
  let cancelled = false;
  const chunks = [
    encoder.encode(`{"token":"${familyCapability}","padding":"`),
    encoder.encode("x".repeat(480)),
    encoder.encode("x".repeat(80)),
    encoder.encode('"}'),
  ];
  const stream = new ReadableStream({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(__test.readPublicFamilyAlignmentRequest(new Request(
    "https://app.example.test/api/shared/family-alignment",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: stream,
      duplex: "half",
    },
  )));
  assert.equal(cancelled, true);
});

test("Family Alignment validates a structured response only after admitting a well-shaped capability", async () => {
  const request = () => new Request("https://worker.example.test/api/shared/family-alignment/response", {
    method: "PUT",
    headers: {
      origin: "https://app.example.test",
      "content-type": "application/json",
      "x-family-response-token": "r".repeat(43),
    },
    body: JSON.stringify({
      token: familyCapability,
      response: {
        role: "spouse",
        preference: "A",
        confidence: "high",
        reasons: ["budget"],
        comment: "PRIVATE_FREE_TEXT_MUST_NOT_BE_ACCEPTED",
      },
    }),
  });
  const env = (room) => ({
    APP_ORIGIN: "https://app.example.test",
    GRIHAGRID_CACHE: { get: async () => null, put: async () => {} },
    DB: {
      prepare(sql) {
        assert.match(sql, /FROM family_alignment_rooms r/u);
        return {
          bind() {
            return { first: async () => room };
          },
        };
      },
    },
  });

  const unknown = await worker.fetch(request(), env(null), {});
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), {
    error: "review room not found",
    code: "family_alignment_not_found",
  });

  const admitted = await worker.fetch(request(), env({
    id: "admitted-room",
    revoked_at: null,
    project_status: "active",
    expires_at: "2099-01-01 00:00:00",
  }), {});
  assert.equal(admitted.status, 400);
  assert.deepEqual(await admitted.json(), {
    error: "response must contain only role, preference, confidence, and reasons",
    code: "invalid_family_alignment_response",
  });
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
  assert.match(app, /error\.status===404&&code==="family_alignment_not_found"\)return "unavailable"/u);
  assert.match(app, /error\.status===410&&\["family_alignment_unavailable","family_alignment_expired"\]\.includes\(code\)\)return "closed"/u);
  assert.match(review, /const terminalPhase=familyAlignmentTerminalPhase\(err\)/u);
  assert.match(review, /if\(terminalPhase\)scrubClosedFamilyAlignmentCapability\(token\)/u);
  assert.doesNotMatch(review, /\[404,410\]\.includes\(err\.status\)/u, "generic rollback-skew 404s must retain the fragment for retry");
  assert.match(review, /setRoom\(null\)/u, "each load must clear any stale comparison before admission");
  assert.match(review, /setPhase\('temporary'\)/u, "dependency failures must use a retryable private state");
  assert.match(review, /The review remains private and nothing was submitted\./u);
  assert.match(review, /setLoadAttempt\(value=>value\+1\)/u, "retry must re-run admission for the same bearer link");
  assert.match(review, /Try this link again/u);
  assert.match(review, /ref=\{stateHeadingRef\} tabIndex="-1"/u, "asynchronous terminal states must receive focus");
  assert.match(review, /This family review has ended\./u);
  assert.match(review, /No response can be viewed or submitted from this link\./u);
});

test("Family Alignment issues fragment-only links and uses strict canonical and legacy capability parsing", async () => {
  const [app, workerSource] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../worker/index.js", import.meta.url), "utf8"),
  ]);
  const helpersStart = app.indexOf("function isPrivateAccountPath(");
  const helpersEnd = app.indexOf("function reportShareMetadata(", helpersStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart, "public capability helpers must remain inspectable");
  const helpers = app.slice(helpersStart, helpersEnd);
  const reviewStart = app.indexOf("function FamilyAlignmentReviewPage(");
  const reviewEnd = app.indexOf("function CheckoutReturnPage(", reviewStart);
  const review = app.slice(reviewStart, reviewEnd);
  const appComponent = app.slice(app.indexOf("export function App()"));

  assert.match(workerSource, /url: `\$\{appOrigin\}\/align#\$\{token\}`/u);
  assert.doesNotMatch(workerSource, /url: `\$\{appOrigin\}\/align\/\$\{token\}`/u);
  assert.match(app, /`\$\{window\.location\.origin\}\/align#\$\{(?:result|created)\.token\}`/u);
  assert.doesNotMatch(app, /`\$\{window\.location\.origin\}\/align\/\$\{/u);
  const historyCalls = [];
  const fakeWindow = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: { retained: true },
      replaceState(state, title, next) {
        historyCalls.push([state, title, next]);
        const url = new URL(next, "https://app.example.test");
        fakeWindow.location.pathname = url.pathname;
        fakeWindow.location.search = url.search;
        fakeWindow.location.hash = url.hash;
      },
    },
  };
  const capabilityHelpers = Function(
    "window",
    `${helpers}\nreturn {isFamilyAlignmentPath,isAuthenticationFreePath,familyAlignmentCapabilityToken,migrateLegacyFamilyAlignmentCapability,scrubClosedFamilyAlignmentCapability,scrubFamilyAlignmentCapabilityForPrint};`,
  )(fakeWindow);
  assert.equal(capabilityHelpers.familyAlignmentCapabilityToken({
    pathname: "/align", search: "", hash: `#${familyCapability}`,
  }), familyCapability);
  for (const location of [
    { pathname: `/align/${familyCapability}`, search: "", hash: "" },
    { pathname: "/align", search: "?source=private", hash: `#${familyCapability}` },
    { pathname: "/align", search: "", hash: familyCapability },
    { pathname: "/align", search: "", hash: `#${"f".repeat(42)}` },
    { pathname: "/align", search: "", hash: `#${"f".repeat(42)}!` },
  ]) assert.equal(capabilityHelpers.familyAlignmentCapabilityToken(location), "");
  assert.equal(capabilityHelpers.isAuthenticationFreePath("/align"), true);
  assert.equal(capabilityHelpers.isAuthenticationFreePath("/align/"), true);
  assert.equal(capabilityHelpers.isAuthenticationFreePath(`/align/${familyCapability}`), true);
  assert.equal(capabilityHelpers.isAuthenticationFreePath("/align/not-a-capability"), true);
  assert.equal(capabilityHelpers.isAuthenticationFreePath(`/align/${familyCapability}/`), true);
  assert.equal(capabilityHelpers.isAuthenticationFreePath(`/align/${familyCapability}/extra`), true);

  fakeWindow.location = { pathname: `/align/${familyCapability}`, search: "", hash: "" };
  assert.equal(capabilityHelpers.migrateLegacyFamilyAlignmentCapability(fakeWindow.location), familyCapability);
  assert.equal(fakeWindow.location.pathname, "/align");
  assert.equal(fakeWindow.location.hash, `#${familyCapability}`);
  assert.equal(historyCalls.at(-1)[2], `/align#${familyCapability}`);
  const callsAfterMigration = historyCalls.length;
  assert.equal(capabilityHelpers.migrateLegacyFamilyAlignmentCapability({
    pathname: `/align/${familyCapability}`, search: "?source=private", hash: "",
  }), "");
  assert.equal(capabilityHelpers.migrateLegacyFamilyAlignmentCapability({
    pathname: "/align/not-a-capability", search: "", hash: "",
  }), "");
  assert.equal(historyCalls.length, callsAfterMigration);

  capabilityHelpers.scrubClosedFamilyAlignmentCapability(familyCapability);
  assert.deepEqual(fakeWindow.location, { pathname: "/align", search: "", hash: "" });
  fakeWindow.location = { pathname: "/align", search: "", hash: `#${familyCapability}` };
  const restore = capabilityHelpers.scrubFamilyAlignmentCapabilityForPrint();
  assert.equal(typeof restore, "function");
  assert.equal(fakeWindow.location.hash, "");
  restore();
  assert.equal(fakeWindow.location.hash, `#${familyCapability}`);

  assert.match(review, /publicApi\(['"]\/api\/shared\/family-alignment['"],\{method:['"]POST['"],body:\{token\},signal/u);
  assert.match(review, /publicApi\(['"]\/api\/shared\/family-alignment\/response['"],\{method:['"]PUT['"]/u);
  assert.match(review, /headers:\{'x-family-response-token':responseToken\}/u);
  assert.match(review, /body:\{token,response:form\}/u);
  assert.doesNotMatch(review, /api\(`?\/api\/family-alignment/u);
  assert.match(app, /copyText\(privateUrl,\{domFallback:false\}\)/u, "capabilities must never use the DOM clipboard fallback");
  assert.match(app, /copyText\(secretUrl,\{domFallback:false\}\)/u, "capability retries must remain DOM-free");
  assert.match(review, /scrubClosedFamilyAlignmentCapability\(token\)/u);
  assert.match(review, /window\.addEventListener\('hashchange',refreshCapability\)/u);
  assert.match(review, /const refreshCapability=\(\)=>\{\s*migrateLegacyFamilyAlignmentCapability\(\)/u);
  assert.match(review, /window\.addEventListener\('beforeprint',beforePrint\)/u);
  assert.match(review, /scrubFamilyAlignmentCapabilityForPrint\(\)/u);
  assert.match(appComponent, /if\(isFamilyAlignmentPath\(path\)\)return <FamilyAlignmentReviewPage\/>/u);
  assert.match(appComponent, /useState\(\(\)=>\{migrateLegacyFamilyAlignmentCapability\(\);return window\.location\.pathname\}\)/u);
  assert.match(appComponent, /isAuthenticationFreePath\(window\.location\.pathname\)\?null:undefined/u);
  assert.match(appComponent, /if\(isAuthenticationFreePath\(path\)\)\{[\s\S]*?setUser\(null\);return\}/u);
});

test("Family Alignment canonical and legacy routes are disallowed to crawlers and set page-level noindex metadata", async () => {
  const [app, robots] = await Promise.all([
    readFile(new URL("../src/App.jsx", import.meta.url), "utf8"),
    readFile(new URL("../public/robots.txt", import.meta.url), "utf8"),
  ]);
  const reviewStart = app.indexOf("function FamilyAlignmentReviewPage(");
  const reviewEnd = app.indexOf("function CheckoutReturnPage(", reviewStart);
  const review = app.slice(reviewStart, reviewEnd);
  assert.match(review, /document\.querySelector\('meta\[name="robots"\]'\)/u);
  assert.match(review, /robots\?\.setAttribute\('content','noindex,nofollow,noarchive'\)/u);
  assert.match(review, /return\(\)=>\{if\(robots&&previous!==null&&previous!==undefined\)robots\.setAttribute\('content',previous\)\}/u);
  assert.match(robots, /^Disallow: \/align$/mu);
  assert.doesNotMatch(robots, /^Allow: \/align\/?$/mu);
});
