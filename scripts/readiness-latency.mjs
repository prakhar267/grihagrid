#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const DEFAULT_SAMPLE_COUNT = 20;
const DEFAULT_MAX_P95_MS = 500;
const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_RESPONSE_BYTES = 32 * 1024;

const CURRENT_SCHEMA_CHECKS = Object.freeze([
  "schema",
  "aiSchema",
  "decisionSchema",
  "paymentSchema",
  "familyAlignmentSchema",
  "archiveSafetySchema",
  "revisionSchema",
  "reportFeedbackSchema",
  "reportShareSchema",
  "projectCreationSchema",
  "authSchema",
]);

const REQUIRED_CAPABILITIES = Object.freeze([
  "freePlanning",
  "decisionCompare",
  "familyAlignment",
  "briefCheck",
  "reportFeedback",
  "accountSecurity",
]);

const CHECK_PROJECTION = Object.freeze([
  "database",
  "schema",
  "rateLimit",
  "aiSchema",
  "aiAbuseControl",
  "decisionSchema",
  "paymentSchema",
  "familyAlignmentSchema",
  "archiveSafetySchema",
  "revisionSchema",
  "reportFeedbackSchema",
  "reportShareSchema",
  "reportHandoffControl",
  "reportShareAbuseHashing",
  "projectCreationSchema",
  "authSchema",
  "ai",
  "privateStorage",
]);

const CAPABILITY_PROJECTION = Object.freeze([
  ...REQUIRED_CAPABILITIES,
  "privateUploads",
  "paidCheckout",
  "paidFulfillment",
  "aiPlanningBrief",
  "reportHandoff",
]);

function positiveInteger(value, fallback, label) {
  const number = value == null || value === "" ? fallback : Number(value);
  assert.ok(Number.isInteger(number) && number > 0, `${label} must be a positive integer`);
  return number;
}

function canonicalOrigin(rawOrigin) {
  const origin = new URL(rawOrigin);
  assert.equal(origin.protocol, "https:", "readiness latency target must use HTTPS");
  assert.equal(origin.username, "", "readiness latency target cannot include credentials");
  assert.equal(origin.password, "", "readiness latency target cannot include credentials");
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin.origin;
}

function plainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function safeError(error) {
  const name = String(error?.name || "Error");
  return {
    name: ["AbortError", "AssertionError", "Error", "SyntaxError", "TimeoutError", "TypeError"].includes(name)
      ? name
      : "Error",
    message: "readiness latency sample failed",
  };
}

function safeCacheControl(value) {
  return value === "no-store" ? "no-store" : value == null ? null : "<unexpected>";
}

function safeContentType(value) {
  return typeof value === "string" && /^application\/json\b/iu.test(value)
    ? "application/json"
    : value == null ? null : "<unexpected>";
}

function safeEnum(value, allowed) {
  return typeof value === "string" && allowed.includes(value) ? value : "<unexpected>";
}

function safeReleaseId(value) {
  return typeof value === "string" && /^[0-9a-f-]{36}$/u.test(value) ? value : "<unexpected>";
}

function safeTimestamp(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value))
    ? value.slice(0, 64)
    : "<unexpected>";
}

function projectReadiness(payload) {
  if (!plainObject(payload)) return null;
  const checks = plainObject(payload.checks) ? payload.checks : {};
  const capabilities = plainObject(payload.capabilities) ? payload.capabilities : {};
  return {
    status: safeEnum(payload.status, ["ready", "not_ready"]),
    service: payload.service === "grihagrid" ? "grihagrid" : "<unexpected>",
    releaseId: safeReleaseId(payload.releaseId),
    checks: Object.fromEntries(CHECK_PROJECTION.map((key) => [
      key,
      safeEnum(checks[key], [
        "ok", "error", "missing", "unknown", "current", "outdated", "configured", "unavailable",
        "valid", "invalid", "enabled", "disabled",
      ]),
    ])),
    acceptingPaidPlans: Array.isArray(checks.acceptingPaidPlans)
      ? checks.acceptingPaidPlans.map((value) => value === "decision_compare" ? value : "<unexpected>")
      : "<unexpected>",
    capabilities: Object.fromEntries(CAPABILITY_PROJECTION.map((key) => [
      key,
      typeof capabilities[key] === "boolean" ? capabilities[key] : null,
    ])),
    time: safeTimestamp(payload.time),
  };
}

async function readBoundedJson(response) {
  const contentType = response.headers.get("content-type") || "";
  assert.match(contentType, /^application\/json\b/iu, "readiness latency sample must return JSON");
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    assert.match(declaredLength, /^\d+$/u, "readiness latency sample returned an invalid content-length");
    assert.ok(Number(declaredLength) <= MAX_RESPONSE_BYTES, "readiness latency sample exceeded the response limit");
  }
  assert.ok(response.body, "readiness latency sample returned no body");

  const reader = response.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > MAX_RESPONSE_BYTES) {
        await reader.cancel("readiness latency response exceeded the limit");
        throw new Error("readiness latency sample exceeded the response limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  return {
    payload: JSON.parse(text),
    byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function addMismatch(violations, label, actual, expected) {
  if (!Object.is(actual, expected)) violations.push(label);
}

function validateReadinessSample({ response, payload, releaseId, expectAiPlanningBrief, expectReportHandoff, nowMs }) {
  const violations = [];
  addMismatch(violations, "http.status", response.status, 200);
  addMismatch(violations, "headers.cache-control", response.headers.get("cache-control"), "no-store");
  if (!/^application\/json\b/iu.test(response.headers.get("content-type") || "")) {
    violations.push("headers.content-type");
  }
  if (!plainObject(payload)) return [...violations, "body.shape"];

  addMismatch(violations, "body.status", payload.status, "ready");
  addMismatch(violations, "body.service", payload.service, "grihagrid");
  addMismatch(violations, "body.releaseId", payload.releaseId, releaseId);
  const bodyTime = Date.parse(payload.time);
  if (Number.isNaN(bodyTime) || Math.abs(nowMs - bodyTime) >= 5 * 60 * 1000) {
    violations.push("body.time");
  }

  if (!plainObject(payload.checks)) {
    violations.push("body.checks");
  } else {
    addMismatch(violations, "checks.database", payload.checks.database, "ok");
    addMismatch(violations, "checks.rateLimit", payload.checks.rateLimit, "configured");
    addMismatch(violations, "checks.aiAbuseControl", payload.checks.aiAbuseControl, "configured");
    addMismatch(violations, "checks.reportShareAbuseHashing", payload.checks.reportShareAbuseHashing, "configured");
    addMismatch(violations, "checks.privateStorage", payload.checks.privateStorage, "unavailable");
    addMismatch(
      violations,
      "checks.reportHandoffControl",
      payload.checks.reportHandoffControl,
      expectReportHandoff ? "enabled" : "disabled",
    );
    addMismatch(
      violations,
      "checks.ai",
      payload.checks.ai,
      expectAiPlanningBrief ? "configured" : "unavailable",
    );
    for (const key of CURRENT_SCHEMA_CHECKS) {
      addMismatch(violations, `checks.${key}`, payload.checks[key], "current");
    }
    if (!Array.isArray(payload.checks.acceptingPaidPlans) || payload.checks.acceptingPaidPlans.length !== 0) {
      violations.push("checks.acceptingPaidPlans");
    }
  }

  if (!plainObject(payload.capabilities)) {
    violations.push("body.capabilities");
  } else {
    for (const key of REQUIRED_CAPABILITIES) {
      addMismatch(violations, `capabilities.${key}`, payload.capabilities[key], true);
    }
    for (const key of ["privateUploads", "paidCheckout", "paidFulfillment"]) {
      addMismatch(violations, `capabilities.${key}`, payload.capabilities[key], false);
    }
    addMismatch(
      violations,
      "capabilities.aiPlanningBrief",
      payload.capabilities.aiPlanningBrief,
      expectAiPlanningBrief,
    );
    addMismatch(
      violations,
      "capabilities.reportHandoff",
      payload.capabilities.reportHandoff,
      expectReportHandoff,
    );
  }
  return violations;
}

export function nearestRankPercentile(values, percentile) {
  assert.ok(Array.isArray(values) && values.length > 0, "percentile requires at least one sample");
  assert.ok(percentile > 0 && percentile <= 1, "percentile must be within (0, 1]");
  const sorted = values.map(Number).sort((left, right) => left - right);
  return sorted[Math.ceil(percentile * sorted.length) - 1];
}

export async function measureReadinessLatency(rawOrigin, releaseId, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const expectedReleaseId = String(releaseId || "");
  assert.match(expectedReleaseId, /^[0-9a-f-]{36}$/u, "readiness latency gate requires a Worker version ID");
  const releaseSha = options.releaseSha == null || options.releaseSha === "" ? null : String(options.releaseSha);
  if (releaseSha !== null) assert.match(releaseSha, /^[a-f0-9]{40}$/u, "readiness latency gate requires a merged SHA");

  const sampleCount = positiveInteger(options.sampleCount, DEFAULT_SAMPLE_COUNT, "readiness latency sample count");
  const maxP95Ms = positiveInteger(options.maxP95Ms, DEFAULT_MAX_P95_MS, "readiness latency p95 threshold");
  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "readiness latency sample timeout");
  const expectAiPlanningBrief = options.expectAiPlanningBrief === true;
  const expectReportHandoff = options.expectReportHandoff === true;
  const fetchImpl = options.fetchImpl || fetch;
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const wallNow = options.wallNow || Date.now;
  assert.equal(typeof fetchImpl, "function", "readiness latency fetch must be a function");
  assert.equal(typeof monotonicNow, "function", "readiness latency monotonic clock must be a function");
  assert.equal(typeof wallNow, "function", "readiness latency wall clock must be a function");

  const gateStartedMs = wallNow();
  const samples = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const sequence = index + 1;
    const startedAtMs = wallNow();
    const startedTick = monotonicNow();
    const url = new URL("/api/readiness", origin);
    url.searchParams.set("release_probe", `${sequence}-${startedAtMs}`);
    let response = null;
    let body = null;
    let error = null;
    let violations = [];
    try {
      response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        headers: {
          accept: "application/json",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": "grihagrid-readiness-latency/1.0",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
      body = await readBoundedJson(response);
      violations = validateReadinessSample({
        response,
        payload: body.payload,
        releaseId: expectedReleaseId,
        expectAiPlanningBrief,
        expectReportHandoff,
        nowMs: wallNow(),
      });
    } catch (caught) {
      error = safeError(caught);
      violations = ["sample.error"];
    }
    const completedAtMs = wallNow();
    const latencyMs = Math.max(0, Math.ceil(monotonicNow() - startedTick));
    samples.push({
      sequence,
      requestPath: `${url.pathname}${url.search}`,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(completedAtMs).toISOString(),
      latencyMs,
      httpStatus: response?.status ?? null,
      cacheControl: safeCacheControl(response?.headers.get("cache-control")),
      contentType: safeContentType(response?.headers.get("content-type")),
      responseBodyBytes: body?.byteLength ?? null,
      responseBodySha256: body?.sha256 ?? null,
      response: body ? projectReadiness(body.payload) : null,
      violations,
      error,
    });
  }

  const latencies = samples.map((sample) => sample.latencyMs);
  const p95Ms = nearestRankPercentile(latencies, 0.95);
  const successCount = samples.filter((sample) => sample.violations.length === 0).length;
  const violations = [];
  if (successCount !== sampleCount) violations.push("sample_contract_failure");
  if (!(p95Ms < maxP95Ms)) violations.push("p95_threshold_failure");
  return {
    schemaVersion: 1,
    gate: "readiness_latency",
    origin,
    releaseId: expectedReleaseId,
    releaseSha,
    startedAt: new Date(gateStartedMs).toISOString(),
    completedAt: new Date(wallNow()).toISOString(),
    sampleCount,
    successCount,
    failureCount: sampleCount - successCount,
    serial: true,
    requestCacheControl: "no-cache",
    responseCacheControl: "no-store",
    expectedAiPlanningBrief: expectAiPlanningBrief,
    expectedReportHandoff: expectReportHandoff,
    expectedClosedCapabilities: ["privateUploads", "paidCheckout", "paidFulfillment"],
    latency: {
      unit: "ms",
      minimum: Math.min(...latencies),
      maximum: Math.max(...latencies),
      average: Number((latencies.reduce((sum, value) => sum + value, 0) / latencies.length).toFixed(3)),
      p95: p95Ms,
      percentileMethod: "nearest_rank",
      requiredStrictlyBelow: maxP95Ms,
    },
    passed: violations.length === 0,
    violations,
    samples,
  };
}

function environmentBoolean(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  assert.ok(raw === "true" || raw === "false", `${name} must be true or false`);
  return raw === "true";
}

async function runCli() {
  try {
    const origin = process.argv[2] || process.env.GRIHAGRID_READINESS_ORIGIN;
    const releaseId = process.argv[3] || process.env.GRIHAGRID_RELEASE_ID;
    assert.ok(origin, "usage: node scripts/readiness-latency.mjs https://worker.example <version-id>");
    const result = await measureReadinessLatency(origin, releaseId, {
      releaseSha: process.env.GRIHAGRID_RELEASE_SHA,
      expectAiPlanningBrief: environmentBoolean("EXPECT_AI_PLANNING_BRIEF"),
      expectReportHandoff: environmentBoolean("EXPECT_REPORT_HANDOFF"),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      gate: "readiness_latency",
      passed: false,
      violations: ["configuration_or_execution_failure"],
      error: safeError(error),
      samples: [],
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCli();
}
