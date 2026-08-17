#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { runSmoke } from "./smoke.mjs";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 1000;
const DEFAULT_STABILITY_MS = 60 * 1000;
const MINIMUM_CONSECUTIVE_SAMPLES = 3;

function positiveInteger(value, fallback, label) {
  const number = value == null || value === "" ? fallback : Number(value);
  assert.ok(Number.isInteger(number) && number > 0, `${label} must be a positive integer`);
  return number;
}

function canonicalOrigin(rawOrigin) {
  const origin = new URL(rawOrigin);
  assert.equal(origin.protocol, "https:", "release probe target must use HTTPS");
  assert.equal(origin.username, "", "release probe target cannot include credentials");
  assert.equal(origin.password, "", "release probe target cannot include credentials");
  origin.pathname = "/";
  origin.search = "";
  origin.hash = "";
  return origin.origin;
}

function describeError(error) {
  return {
    name: String(error?.name || "Error"),
    message: String(error?.message || "release smoke sample failed").slice(0, 500),
  };
}

export class ReleaseReadinessTimeoutError extends Error {
  constructor(details) {
    const suffix = details.lastFailure ? `; last failure: ${details.lastFailure.message}` : "";
    super(
      `release ${details.releaseId} did not stay exact for ${details.stabilityMs}ms across at least `
      + `${MINIMUM_CONSECUTIVE_SAMPLES} consecutive smoke samples `
      + `within ${details.timeoutMs}ms after ${details.attempts} attempt${details.attempts === 1 ? "" : "s"}${suffix}`,
    );
    this.name = "ReleaseReadinessTimeoutError";
    this.details = details;
  }
}

/**
 * Poll the public smoke suite until one Worker version passes at least three
 * complete, consecutive samples across a sustained stability window. A failed
 * or wrong-version sample resets both the streak and the stability clock.
 */
export async function waitForRelease(rawOrigin, releaseId, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const expectedReleaseId = String(releaseId || "");
  assert.match(expectedReleaseId, /^[0-9a-f-]{36}$/u, "release probe requires a Worker version ID");

  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "release probe timeout");
  const intervalMs = positiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS, "release probe interval");
  const stabilityMs = positiveInteger(options.stabilityMs, DEFAULT_STABILITY_MS, "release stability window");
  const legacyWorker = options.legacyWorker === true;
  const expectReportHandoff = options.expectReportHandoff !== false;
  const smoke = options.smoke || runSmoke;
  const monotonicNow = options.monotonicNow || (() => performance.now());
  const wallNow = options.wallNow || Date.now;
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  assert.equal(typeof smoke, "function", "release probe smoke must be a function");
  assert.equal(typeof monotonicNow, "function", "release probe monotonic clock must be a function");
  assert.equal(typeof wallNow, "function", "release probe wall clock must be a function");
  assert.equal(typeof sleep, "function", "release probe sleep must be a function");

  const tick = () => {
    const value = monotonicNow();
    assert.ok(Number.isFinite(value), "release probe monotonic clock must return a finite number");
    return value;
  };
  const wallTime = () => {
    const value = wallNow();
    assert.ok(Number.isFinite(value), "release probe wall clock must return a finite number");
    return value;
  };
  const startedTick = tick();
  const startedAtMs = wallTime();
  const deadlineTick = startedTick + timeoutMs;
  let attempts = 0;
  let failedSamples = 0;
  let lastFailure = null;
  let streak = [];
  let stableSinceTick = null;

  const timeout = () => new ReleaseReadinessTimeoutError({
    origin,
    releaseId: expectedReleaseId,
    timeoutMs,
    attempts,
    failedSamples,
    consecutiveSamples: streak.length,
    stabilityMs,
    stableForMs: stableSinceTick == null ? 0 : Math.max(0, tick() - stableSinceTick),
    lastFailure,
  });

  const polling = (async () => {
    while (tick() < deadlineTick) {
      attempts += 1;
      try {
        const releaseProbe = `${attempts}-${Math.trunc(wallTime())}`;
        const sample = await smoke(origin, {
          expectedReleaseId,
          legacyWorker,
          expectReportHandoff,
          releaseProbe,
        });
        const completedTick = tick();
        if (completedTick > deadlineTick) throw timeout();
        if (stableSinceTick == null) stableSinceTick = completedTick;
        streak.push(sample);
        const stableForMs = Math.max(0, completedTick - stableSinceTick);
        if (streak.length >= MINIMUM_CONSECUTIVE_SAMPLES && stableForMs >= stabilityMs) {
          return {
            origin,
            releaseId: expectedReleaseId,
            legacyWorker,
            expectReportHandoff,
            startedAt: new Date(startedAtMs).toISOString(),
            readyAt: new Date(wallTime()).toISOString(),
            attempts,
            failedSamples,
            consecutiveSamples: streak.length,
            stabilityMs,
            stableForMs,
            samples: streak,
          };
        }
      } catch (error) {
        if (error instanceof ReleaseReadinessTimeoutError) throw error;
        failedSamples += 1;
        lastFailure = describeError(error);
        streak = [];
        stableSinceTick = null;
      }

      const remainingMs = deadlineTick - tick();
      if (remainingMs <= 0) throw timeout();
      await sleep(Math.min(intervalMs, remainingMs));
    }

    throw timeout();
  })();

  let deadlineTimer;
  const hardDeadline = new Promise((resolve, reject) => {
    deadlineTimer = setTimeout(() => reject(timeout()), timeoutMs);
  });
  try {
    return await Promise.race([polling, hardDeadline]);
  } finally {
    clearTimeout(deadlineTimer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const origin = process.argv[2] || process.env.GRIHAGRID_RELEASE_ORIGIN || process.env.GRIHAGRID_SMOKE_ORIGIN;
  const releaseId = process.argv[3] || process.env.GRIHAGRID_RELEASE_ID || process.env.EXPECT_RELEASE_ID;
  assert.ok(origin, "usage: node scripts/wait-for-release.mjs https://worker.example <version-id>");
  const result = await waitForRelease(origin, releaseId, {
    timeoutMs: process.env.GRIHAGRID_RELEASE_WAIT_TIMEOUT_MS,
    intervalMs: process.env.GRIHAGRID_RELEASE_WAIT_INTERVAL_MS,
    legacyWorker: process.env.LEGACY_WORKER_COMPAT === "true",
    expectReportHandoff: process.env.EXPECT_REPORT_HANDOFF !== "false",
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
