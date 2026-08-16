import assert from "node:assert/strict";
import test from "node:test";
import {
  measureReadinessLatency,
  nearestRankPercentile,
} from "../scripts/readiness-latency.mjs";

const ORIGIN = "https://worker.example.test";
const RELEASE_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_SHA = "a".repeat(40);
const BASE_TIME_MS = Date.parse("2026-08-17T00:00:00.000Z");

function readinessPayload({
  releaseId = RELEASE_ID,
  time = new Date(BASE_TIME_MS).toISOString(),
  aiPlanningBrief = false,
  reportHandoff = false,
  overrides = {},
} = {}) {
  return {
    status: "ready",
    service: "grihagrid",
    releaseId,
    checks: {
      database: "ok",
      schema: "current",
      rateLimit: "configured",
      aiSchema: "current",
      aiAbuseControl: "configured",
      decisionSchema: "current",
      paymentSchema: "current",
      familyAlignmentSchema: "current",
      archiveSafetySchema: "current",
      revisionSchema: "current",
      reportFeedbackSchema: "current",
      reportShareSchema: "current",
      reportHandoffControl: reportHandoff ? "enabled" : "disabled",
      reportShareAbuseHashing: "configured",
      projectCreationSchema: "current",
      authSchema: "current",
      ai: aiPlanningBrief ? "configured" : "unavailable",
      privateStorage: "unavailable",
      acceptingPaidPlans: [],
    },
    capabilities: {
      freePlanning: true,
      privateUploads: false,
      paidCheckout: false,
      paidFulfillment: false,
      aiPlanningBrief,
      decisionCompare: true,
      familyAlignment: true,
      briefCheck: true,
      reportFeedback: true,
      reportHandoff,
      accountSecurity: true,
    },
    time,
    ...overrides,
  };
}

function jsonResponse(payload, {
  status = 200,
  cacheControl = "no-store",
  contentType = "application/json; charset=utf-8",
} = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "cache-control": cacheControl,
      "content-type": contentType,
    },
  });
}

function latencyHarness(latencies, payloadForSample = () => readinessPayload()) {
  let tick = 0;
  let active = 0;
  let maxActive = 0;
  const requests = [];
  const fetchImpl = async (url, init) => {
    const index = requests.length;
    active += 1;
    maxActive = Math.max(maxActive, active);
    requests.push({ url: String(url), init });
    await Promise.resolve();
    tick += latencies[index];
    active -= 1;
    return jsonResponse(payloadForSample(index, BASE_TIME_MS + tick));
  };
  return {
    fetchImpl,
    monotonicNow: () => tick,
    wallNow: () => BASE_TIME_MS + tick,
    requests,
    maxActive: () => maxActive,
  };
}

test("readiness latency gate retains twenty serial exact-version no-cache samples", async () => {
  const latencies = Array.from({ length: 20 }, (_, index) => index + 1);
  const harness = latencyHarness(latencies, (_index, nowMs) => readinessPayload({ time: new Date(nowMs).toISOString() }));
  const evidence = await measureReadinessLatency(`${ORIGIN}/ignored?query=yes`, RELEASE_ID, {
    releaseSha: RELEASE_SHA,
    sampleCount: 20,
    maxP95Ms: 20,
    fetchImpl: harness.fetchImpl,
    monotonicNow: harness.monotonicNow,
    wallNow: harness.wallNow,
  });

  assert.equal(evidence.passed, true);
  assert.equal(evidence.origin, ORIGIN);
  assert.equal(evidence.releaseId, RELEASE_ID);
  assert.equal(evidence.releaseSha, RELEASE_SHA);
  assert.equal(evidence.sampleCount, 20);
  assert.equal(evidence.successCount, 20);
  assert.equal(evidence.failureCount, 0);
  assert.equal(evidence.serial, true);
  assert.equal(evidence.latency.p95, 19);
  assert.equal(evidence.latency.requiredStrictlyBelow, 20);
  assert.equal(evidence.samples.length, 20);
  assert.equal(harness.requests.length, 20);
  assert.equal(harness.maxActive(), 1);
  assert.equal(new Set(evidence.samples.map((sample) => sample.requestPath)).size, 20);
  assert.deepEqual(evidence.samples.map((sample) => sample.latencyMs), latencies);
  assert.ok(evidence.samples.every((sample) => sample.httpStatus === 200));
  assert.ok(evidence.samples.every((sample) => sample.cacheControl === "no-store"));
  assert.ok(evidence.samples.every((sample) => sample.contentType === "application/json"));
  assert.ok(evidence.samples.every((sample) => sample.response.releaseId === RELEASE_ID));
  assert.ok(evidence.samples.every((sample) => /^[a-f0-9]{64}$/u.test(sample.responseBodySha256)));
  for (const { url, init } of harness.requests) {
    assert.match(new URL(url).searchParams.get("release_probe"), /^\d+-\d+$/u);
    const headers = new Headers(init.headers);
    assert.equal(headers.get("cache-control"), "no-cache");
    assert.equal(headers.get("pragma"), "no-cache");
    assert.equal(headers.get("accept"), "application/json");
    assert.equal(headers.get("cookie"), null);
  }
});

test("nearest-rank p95 is a strict release threshold", async () => {
  assert.equal(nearestRankPercentile(Array.from({ length: 20 }, (_, index) => index + 1), 0.95), 19);

  for (const [label, p95Latency, expectedPass] of [
    ["499 passes", 499, true],
    ["500 fails", 500, false],
  ]) {
    const latencies = [...Array(18).fill(100), p95Latency, 700];
    const harness = latencyHarness(latencies, (_index, nowMs) => readinessPayload({ time: new Date(nowMs).toISOString() }));
    const evidence = await measureReadinessLatency(ORIGIN, RELEASE_ID, {
      sampleCount: 20,
      maxP95Ms: 500,
      fetchImpl: harness.fetchImpl,
      monotonicNow: harness.monotonicNow,
      wallNow: harness.wallNow,
    });
    assert.equal(evidence.latency.p95, p95Latency, label);
    assert.equal(evidence.successCount, 20, label);
    assert.equal(evidence.passed, expectedPass, label);
    assert.equal(evidence.violations.includes("p95_threshold_failure"), !expectedPass, label);
  }
});

test("readiness latency gate retains bounded failure evidence for every attempted sample", async () => {
  let tick = 0;
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    tick += 10;
    if (calls === 2) throw new TypeError("synthetic network failure with token=must-not-appear-in-response-projection");
    const response = jsonResponse(readinessPayload({
      releaseId: "22222222-2222-4222-8222-222222222222",
      time: new Date(BASE_TIME_MS + tick).toISOString(),
      overrides: { checks: { schema: "current", leakedSecret: "must-not-appear" } },
    }), calls === 1 ? {
      cacheControl: "private; token=must-not-appear",
      contentType: "text/plain; token=must-not-appear",
    } : {});
    return response;
  };
  const evidence = await measureReadinessLatency(ORIGIN, RELEASE_ID, {
    sampleCount: 3,
    maxP95Ms: 500,
    fetchImpl,
    monotonicNow: () => tick,
    wallNow: () => BASE_TIME_MS + tick,
  });

  assert.equal(calls, 3);
  assert.equal(evidence.samples.length, 3);
  assert.equal(evidence.successCount, 0);
  assert.equal(evidence.failureCount, 3);
  assert.equal(evidence.passed, false);
  assert.ok(evidence.violations.includes("sample_contract_failure"));
  assert.deepEqual(evidence.samples[0].violations, ["sample.error"]);
  assert.equal(evidence.samples[0].cacheControl, "<unexpected>");
  assert.equal(evidence.samples[0].contentType, "<unexpected>");
  assert.deepEqual(evidence.samples[1].violations, ["sample.error"]);
  assert.equal(evidence.samples[1].httpStatus, null);
  assert.equal(evidence.samples[2].response.releaseId, "22222222-2222-4222-8222-222222222222");
  assert.equal(JSON.stringify(evidence.samples).includes("must-not-appear"), false);
});

test("readiness latency gate rejects unsafe targets and malformed release inputs before fetch", async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    return jsonResponse(readinessPayload());
  };
  await assert.rejects(
    () => measureReadinessLatency("http://worker.example.test", RELEASE_ID, { fetchImpl }),
    /must use HTTPS/u,
  );
  await assert.rejects(
    () => measureReadinessLatency("https://user:password@worker.example.test", RELEASE_ID, { fetchImpl }),
    /cannot include credentials/u,
  );
  await assert.rejects(
    () => measureReadinessLatency(ORIGIN, "main", { fetchImpl }),
    /Worker version ID/u,
  );
  await assert.rejects(
    () => measureReadinessLatency(ORIGIN, RELEASE_ID, { fetchImpl, releaseSha: "main" }),
    /merged SHA/u,
  );
  assert.equal(called, false);
});
