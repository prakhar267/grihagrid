#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { runSmoke } from "./smoke.mjs";

const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 90 * 1000;

export class ReleaseTailCoverageError extends Error {
  constructor() {
    super("an exact-version error tail stopped before monitoring completed");
    this.name = "ReleaseTailCoverageError";
  }
}

function positiveInteger(value, fallback, label) {
  const number = value == null || value === "" ? fallback : Number(value);
  assert.ok(Number.isInteger(number) && number > 0, `${label} must be a positive integer`);
  return number;
}

function assertWatchedProcessesAlive(watchPids) {
  for (const pid of watchPids) {
    assert.ok(Number.isInteger(pid) && pid > 0, "monitored process ID must be a positive integer");
    try {
      process.kill(pid, 0);
    } catch {
      throw new ReleaseTailCoverageError();
    }
  }
}

export function summarizeSamples(origin, releaseId, startedAt, finishedAt, samples) {
  assert.ok(samples.length > 0, "release monitor must record at least one sample");
  const latencies = samples.flatMap((sample) => sample.checks.map((check) => check.latencyMs));
  const requestAttempts = samples.flatMap((sample) => sample.checks).reduce((sum, check) => sum + check.attempts, 0);
  return {
    origin,
    releaseId,
    startedAt,
    finishedAt,
    samples: samples.length,
    successfulChecks: latencies.length,
    requests: requestAttempts,
    latencyMs: {
      minimum: Math.min(...latencies),
      maximum: Math.max(...latencies),
      average: Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length),
    },
  };
}

export async function monitorRelease(rawOrigin, releaseId, options = {}) {
  assert.match(String(releaseId || ""), /^[0-9a-f-]{36}$/u, "release monitor requires a Worker version ID");
  const durationMs = positiveInteger(options.durationMs, DEFAULT_DURATION_MS, "monitor duration");
  const intervalMs = positiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS, "monitor interval");
  const watchPids = Array.isArray(options.watchPids) ? options.watchPids.map(Number) : [];
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + durationMs;
  const samples = [];

  do {
    assertWatchedProcessesAlive(watchPids);
    samples.push(await runSmoke(rawOrigin, { expectedReleaseId: releaseId }));
    assertWatchedProcessesAlive(watchPids);
    const remaining = deadline - Date.now();
    if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(intervalMs, remaining)));
  } while (Date.now() < deadline);

  assertWatchedProcessesAlive(watchPids);

  return summarizeSamples(
    new URL(rawOrigin).origin,
    releaseId,
    startedAt,
    new Date().toISOString(),
    samples,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const origin = process.argv[2] || process.env.GRIHAGRID_MONITOR_ORIGIN;
    const releaseId = process.argv[3] || process.env.GRIHAGRID_RELEASE_ID;
    assert.ok(origin, "usage: node scripts/monitor-release.mjs https://worker.example <version-id>");
    const result = await monitorRelease(origin, releaseId, {
      durationMs: process.env.GRIHAGRID_MONITOR_DURATION_MS,
      intervalMs: process.env.GRIHAGRID_MONITOR_INTERVAL_MS,
      watchPids: String(process.env.GRIHAGRID_MONITOR_WATCH_PIDS || "")
        .split(",")
        .filter(Boolean),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const tailCoverageFailure = error instanceof ReleaseTailCoverageError;
    process.stdout.write(`${JSON.stringify({
      status: "failed",
      failureType: tailCoverageFailure ? "tail_coverage" : "public_regression",
      finishedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    process.stderr.write(tailCoverageFailure
      ? "release monitor lost exact-version tail coverage\n"
      : "release monitor detected a public regression\n");
    process.exitCode = tailCoverageFailure ? 2 : 1;
  }
}
