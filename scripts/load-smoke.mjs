import assert from "node:assert/strict";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MAX_REQUESTS = 200;
const MAX_CONCURRENCY = 10;

export function nearestRank(values, percentile) {
  assert.ok(Array.isArray(values) && values.length > 0, "latency samples are required");
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(percentile * sorted.length) - 1)];
}

export function safeLoadTarget(value, allowRemote = false) {
  const target = new URL(value);
  const local = ["127.0.0.1", "localhost", "::1"].includes(target.hostname);
  if (!local && !allowRemote) {
    throw new Error("remote load smoke requires GRIHAGRID_ALLOW_REMOTE_LOAD=true");
  }
  if (!local && target.protocol !== "https:") throw new Error("remote load smoke requires HTTPS");
  target.pathname = target.pathname.replace(/\/$/u, "");
  target.search = "";
  target.hash = "";
  return target;
}

export function boundedLoadSettings(env = process.env) {
  const requests = Number(env.GRIHAGRID_LOAD_REQUESTS || 60);
  const concurrency = Number(env.GRIHAGRID_LOAD_CONCURRENCY || 6);
  const p95LimitMs = Number(env.GRIHAGRID_LOAD_P95_MS || 750);
  if (!Number.isSafeInteger(requests) || requests < 3 || requests > MAX_REQUESTS) throw new Error("load requests must be 3-200");
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > MAX_CONCURRENCY) throw new Error("load concurrency must be 1-10");
  if (!Number.isFinite(p95LimitMs) || p95LimitMs < 50 || p95LimitMs > 10_000) throw new Error("load p95 limit must be 50-10000 ms");
  return { requests, concurrency, p95LimitMs };
}

const probes = Object.freeze([
  { name: "health", path: "/api/health", init: { headers: { accept: "application/json" } } },
  { name: "readiness", path: "/api/readiness", init: { headers: { accept: "application/json" } } },
  {
    name: "estimate",
    path: "/api/estimate",
    init: {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ width: 30, length: 50, floors: "G+1", quality: "Signature", city: "Pune" }),
    },
  },
]);

async function runProbe(origin, index) {
  const probe = probes[index % probes.length];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  const started = performance.now();
  try {
    const response = await fetch(new URL(probe.path, origin), { ...probe.init, signal: controller.signal });
    await response.body?.cancel();
    return { name: probe.name, status: response.status, durationMs: performance.now() - started };
  } catch (error) {
    return { name: probe.name, status: 0, durationMs: performance.now() - started, error: error?.name || "request_failed" };
  } finally {
    clearTimeout(timer);
  }
}

export async function runLoadSmoke(origin, settings) {
  const results = new Array(settings.requests);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= settings.requests) return;
      results[index] = await runProbe(origin, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(settings.concurrency, settings.requests) }, worker));
  const latencies = results.map((result) => result.durationMs);
  const failures = results.filter((result) => result.status < 200 || result.status >= 300);
  const summary = {
    target: origin.origin,
    requestCount: results.length,
    concurrency: settings.concurrency,
    failures: failures.length,
    p50Ms: Math.round(nearestRank(latencies, 0.5)),
    p95Ms: Math.round(nearestRank(latencies, 0.95)),
    maxMs: Math.round(Math.max(...latencies)),
    byProbe: Object.fromEntries(probes.map((probe) => {
      const matches = results.filter((result) => result.name === probe.name);
      return [probe.name, { requests: matches.length, failures: matches.filter((result) => result.status < 200 || result.status >= 300).length }];
    })),
  };
  if (summary.failures || summary.p95Ms > settings.p95LimitMs) {
    const error = new Error(`load smoke failed: failures=${summary.failures}, p95Ms=${summary.p95Ms}, limitMs=${settings.p95LimitMs}`);
    error.summary = summary;
    throw error;
  }
  return summary;
}

function isDirectExecution() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; }
}

if (isDirectExecution()) {
  try {
    const origin = safeLoadTarget(process.argv[2] || "http://127.0.0.1:8787", process.env.GRIHAGRID_ALLOW_REMOTE_LOAD === "true");
    const summary = await runLoadSmoke(origin, boundedLoadSettings());
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    if (error?.summary) process.stderr.write(`${JSON.stringify(error.summary)}\n`);
    process.stderr.write(`${error?.message || "load smoke failed"}\n`);
    process.exitCode = 1;
  }
}
