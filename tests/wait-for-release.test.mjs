import assert from "node:assert/strict";
import test from "node:test";
import {
  ReleaseReadinessTimeoutError,
  waitForRelease,
} from "../scripts/wait-for-release.mjs";

const RELEASE_ID = "11111111-1111-4111-8111-111111111111";

function sample(sequence) {
  return {
    origin: "https://worker.example.test",
    checkedAt: `sample-${sequence}`,
    checks: [{ path: "/api/readiness", status: 200, latencyMs: sequence, attempts: 1 }],
  };
}

test("release probe requires three consecutive full smoke samples", async () => {
  let clock = 0;
  let call = 0;
  const outcomes = [sample(1), new Error("propagation race"), sample(3), sample(4), sample(5)];
  const observedReleaseIds = [];

  const result = await waitForRelease("https://worker.example.test/a/path?ignored=true", RELEASE_ID, {
    timeoutMs: 1_000,
    intervalMs: 10,
    now: () => clock,
    sleep: async (delayMs) => { clock += delayMs; },
    smoke: async (origin, options) => {
      assert.equal(origin, "https://worker.example.test");
      observedReleaseIds.push(options.expectedReleaseId);
      const outcome = outcomes[call];
      call += 1;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });

  assert.equal(result.attempts, 5);
  assert.equal(result.failedSamples, 1);
  assert.equal(result.consecutiveSamples, 3);
  assert.deepEqual(result.samples.map((value) => value.checkedAt), ["sample-3", "sample-4", "sample-5"]);
  assert.deepEqual(observedReleaseIds, Array(5).fill(RELEASE_ID));
});

test("release probe stops retrying at its bounded deadline", async () => {
  let clock = 0;
  let attempts = 0;

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 25,
      intervalMs: 10,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async () => {
        attempts += 1;
        throw new Error("version not ready");
      },
    }),
    (error) => {
      assert.ok(error instanceof ReleaseReadinessTimeoutError);
      assert.equal(error.details.attempts, 3);
      assert.equal(error.details.failedSamples, 3);
      assert.equal(error.details.consecutiveSamples, 0);
      assert.deepEqual(error.details.lastFailure, { name: "Error", message: "version not ready" });
      return true;
    },
  );

  assert.equal(clock, 25);
  assert.equal(attempts, 3);
});

test("a smoke sample completing after the deadline cannot make a release ready", async () => {
  let clock = 0;

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 20,
      intervalMs: 1,
      now: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async () => {
        clock += 21;
        return sample(1);
      },
    }),
    ReleaseReadinessTimeoutError,
  );
});

test("a stalled smoke sample is cut off by the hard wall-clock deadline", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 15,
      intervalMs: 1,
      smoke: async () => new Promise(() => {}),
    }),
    ReleaseReadinessTimeoutError,
  );

  assert.ok(Date.now() - startedAt < 250, "release probe exceeded its hard deadline");
});

test("release probe rejects unsafe targets and malformed inputs before smoke", async () => {
  let called = false;
  const smoke = async () => { called = true; };

  await assert.rejects(
    () => waitForRelease("http://worker.example.test", RELEASE_ID, { smoke }),
    /must use HTTPS/u,
  );
  await assert.rejects(
    () => waitForRelease("https://user:password@worker.example.test", RELEASE_ID, { smoke }),
    /cannot include credentials/u,
  );
  await assert.rejects(
    () => waitForRelease("https://worker.example.test", "main", { smoke }),
    /Worker version ID/u,
  );
  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, { smoke, timeoutMs: 0 }),
    /positive integer/u,
  );
  assert.equal(called, false);
});
