#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { runSmoke } from "./smoke.mjs";
import { classifyTailStderr } from "./classify-tail-stderr.mjs";

const DEFAULT_DURATION_MS = 30 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 90 * 1000;
const DEFAULT_HEALTH_INTERVAL_MS = 1000;
const MAX_STDERR_BYTES = 4096;

export class ReleaseTailCoverageError extends Error {
  constructor() {
    super("an exact-version error tail stopped before monitoring completed");
    this.name = "ReleaseTailCoverageError";
  }
}

export function parseWatchedStderr(value) {
  if (value == null || value === "") return [];
  try {
    const paths = typeof value === "string" ? JSON.parse(value) : value;
    assert.ok(Array.isArray(paths) && paths.length <= 2);
    assert.ok(paths.every(path => typeof path === "string" && path.length > 0 && path.length <= 4096 && !path.includes("\0")));
    return paths;
  } catch {
    throw new ReleaseTailCoverageError();
  }
}

async function assertWatchedStderrClean(paths, identities) {
  for (const path of paths) {
    let handle;
    try {
      handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      const stat = await handle.stat(), previous = identities.get(path);
      if (!stat.isFile() || stat.size > MAX_STDERR_BYTES || (previous && (previous.dev !== stat.dev || previous.ino !== stat.ino || stat.size < previous.size))) throw new ReleaseTailCoverageError();
      identities.set(path, { dev: stat.dev, ino: stat.ino, size: stat.size });
      const bytes = Buffer.alloc(MAX_STDERR_BYTES + 1);
      let length = 0;
      while (length < bytes.length) {
        const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await handle.stat();
      if (after.size !== stat.size || length !== after.size || classifyTailStderr(bytes.subarray(0, length)).unexpected) throw new ReleaseTailCoverageError();
    } catch {
      // Diagnostics and trusted private paths never become an error message.
      throw new ReleaseTailCoverageError();
    } finally {
      await handle?.close();
    }
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
  const healthIntervalMs = positiveInteger(options.healthIntervalMs, DEFAULT_HEALTH_INTERVAL_MS, "health interval");
  const watchPids = Array.isArray(options.watchPids) ? options.watchPids.map(Number) : [];
  const watchStderr = parseWatchedStderr(options.watchStderr);
  const smoke = options.smoke || runSmoke;
  const startedAt = new Date().toISOString();
  const startedMono = performance.now(), deadline = startedMono + durationMs;
  const samples = [];
  const requests = new AbortController(), healthStop = new AbortController(), identities = new Map();
  let coverageFailure, publicFailure, healthLoop;
  const checkHealth = async () => {
    try {
      assertWatchedProcessesAlive(watchPids);
      await assertWatchedStderrClean(watchStderr, identities);
      assertWatchedProcessesAlive(watchPids);
    } catch {
      coverageFailure ||= new ReleaseTailCoverageError();
      requests.abort(coverageFailure);
      throw coverageFailure;
    }
  };
  try {
    await checkHealth();
    healthLoop = (async () => {
      try {
        while (!healthStop.signal.aborted) {
          await delay(healthIntervalMs, undefined, { signal: healthStop.signal });
          await checkHealth();
        }
      } catch (error) {
        if (!healthStop.signal.aborted && !coverageFailure) {
          coverageFailure = new ReleaseTailCoverageError(); requests.abort(coverageFailure);
        }
      }
    })();
    do {
      samples.push(await smoke(rawOrigin, { expectedReleaseId: releaseId, signal: requests.signal }));
      await checkHealth();
      const remaining = deadline - performance.now();
      if (remaining > 0) await delay(Math.min(intervalMs, remaining), undefined, { signal: requests.signal });
    } while (performance.now() < deadline);

    // Fence the end of the complete monotonic window with a fresh no-cache
    // exact-version smoke. A periodic sample from 90 seconds earlier cannot
    // establish the version that was active at completion.
    await checkHealth();
    samples.push(await smoke(rawOrigin, {
      expectedReleaseId: releaseId,
      releaseProbe: `1-${Math.floor(performance.timeOrigin + performance.now())}`,
      signal: requests.signal,
    }));
    await checkHealth();
  } catch (error) {
    const coverageAbort = error === coverageFailure || (requests.signal.aborted && error?.name === "AbortError");
    // A confirmed HTTP/assertion failure wins even if a tail warning races it.
    if (!coverageAbort) publicFailure = error instanceof Error ? error : new Error("release monitor detected a public regression");
    requests.abort(coverageFailure || publicFailure);
  } finally {
    healthStop.abort();
    await healthLoop;
  }
  const observedDurationMs = Math.floor(performance.now() - startedMono);
  if (publicFailure || coverageFailure) {
    const error = publicFailure || coverageFailure;
    error.monitorProgress = { configuredDurationMs: durationMs, observedDurationMs, completedFullDuration: false, finalFencePassed: false, finalFenceReleaseId: null };
    throw error;
  }
  return { ...summarizeSamples(
    new URL(rawOrigin).origin,
    releaseId,
    startedAt,
    new Date().toISOString(),
    samples,
  ), configuredDurationMs: durationMs, observedDurationMs, completedFullDuration: observedDurationMs >= durationMs, finalFencePassed: true, finalFenceReleaseId: releaseId };
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
      watchStderr: parseWatchedStderr(process.env.GRIHAGRID_MONITOR_WATCH_STDERR),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    const tailCoverageFailure = error instanceof ReleaseTailCoverageError;
    process.stdout.write(`${JSON.stringify({
      status: "failed",
      failureType: tailCoverageFailure ? "tail_coverage" : "public_regression",
      finishedAt: new Date().toISOString(),
      ...(error.monitorProgress || { configuredDurationMs: Number(process.env.GRIHAGRID_MONITOR_DURATION_MS || DEFAULT_DURATION_MS), observedDurationMs: 0, completedFullDuration: false, finalFencePassed: false, finalFenceReleaseId: null }),
    }, null, 2)}\n`);
    process.stderr.write(tailCoverageFailure
      ? "release monitor lost exact-version tail coverage\n"
      : "release monitor detected a public regression\n");
    process.exitCode = tailCoverageFailure ? 2 : 1;
  }
}
