#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { runSmoke } from "./smoke.mjs";

const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_INTERVAL_MS = 5 * 1000;
const REQUIRED_CONSECUTIVE_SAMPLES = 3;

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
      `release ${details.releaseId} did not pass ${REQUIRED_CONSECUTIVE_SAMPLES} consecutive smoke samples `
      + `within ${details.timeoutMs}ms after ${details.attempts} attempt${details.attempts === 1 ? "" : "s"}${suffix}`,
    );
    this.name = "ReleaseReadinessTimeoutError";
    this.details = details;
  }
}

/**
 * Poll the public smoke suite until one Worker version passes three complete,
 * consecutive samples. A failed or wrong-version sample resets the streak.
 */
export async function waitForRelease(rawOrigin, releaseId, options = {}) {
  const origin = canonicalOrigin(rawOrigin);
  const expectedReleaseId = String(releaseId || "");
  assert.match(expectedReleaseId, /^[0-9a-f-]{36}$/u, "release probe requires a Worker version ID");

  const timeoutMs = positiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, "release probe timeout");
  const intervalMs = positiveInteger(options.intervalMs, DEFAULT_INTERVAL_MS, "release probe interval");
  const legacyWorker = options.legacyWorker === true;
  const expectReportHandoff = options.expectReportHandoff !== false;
  const smoke = options.smoke || runSmoke;
  const now = options.now || Date.now;
  const sleep = options.sleep || ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  assert.equal(typeof smoke, "function", "release probe smoke must be a function");
  assert.equal(typeof now, "function", "release probe clock must be a function");
  assert.equal(typeof sleep, "function", "release probe sleep must be a function");

  const startedAtMs = now();
  const deadlineMs = startedAtMs + timeoutMs;
  let attempts = 0;
  let failedSamples = 0;
  let lastFailure = null;
  let streak = [];

  const timeout = () => new ReleaseReadinessTimeoutError({
    origin,
    releaseId: expectedReleaseId,
    timeoutMs,
    attempts,
    failedSamples,
    consecutiveSamples: streak.length,
    lastFailure,
  });

  const polling = (async () => {
    while (now() < deadlineMs) {
      attempts += 1;
      try {
        const sample = await smoke(origin, { expectedReleaseId, legacyWorker, expectReportHandoff });
        if (now() > deadlineMs) throw timeout();
        streak.push(sample);
        if (streak.length === REQUIRED_CONSECUTIVE_SAMPLES) {
          return {
            origin,
            releaseId: expectedReleaseId,
            legacyWorker,
            expectReportHandoff,
            startedAt: new Date(startedAtMs).toISOString(),
            readyAt: new Date(now()).toISOString(),
            attempts,
            failedSamples,
            consecutiveSamples: REQUIRED_CONSECUTIVE_SAMPLES,
            samples: streak,
          };
        }
      } catch (error) {
        if (error instanceof ReleaseReadinessTimeoutError) throw error;
        failedSamples += 1;
        lastFailure = describeError(error);
        streak = [];
      }

      const remainingMs = deadlineMs - now();
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
