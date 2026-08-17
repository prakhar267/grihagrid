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

test("release probe requires a sustained window with at least three consecutive full smoke samples", async () => {
  let clock = 0;
  let call = 0;
  const outcomes = [sample(1), new Error("propagation race"), sample(3), sample(4), sample(5)];
  const observedOptions = [];

  const result = await waitForRelease("https://worker.example.test/a/path?ignored=true", RELEASE_ID, {
    timeoutMs: 1_000,
    intervalMs: 10,
    stabilityMs: 20,
    monotonicNow: () => clock,
    sleep: async (delayMs) => { clock += delayMs; },
    smoke: async (origin, options) => {
      assert.equal(origin, "https://worker.example.test");
      observedOptions.push(options);
      const outcome = outcomes[call];
      call += 1;
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  });

  assert.equal(result.attempts, 5);
  assert.equal(result.failedSamples, 1);
  assert.equal(result.consecutiveSamples, 3);
  assert.equal(result.stabilityMs, 20);
  assert.equal(result.stableForMs, 20);
  assert.deepEqual(result.samples.map((value) => value.checkedAt), ["sample-3", "sample-4", "sample-5"]);
  assert.deepEqual(observedOptions.map((options) => options.expectedReleaseId), Array(5).fill(RELEASE_ID));
  assert.equal(new Set(observedOptions.map((options) => options.releaseProbe)).size, 5);
  assert.ok(observedOptions.every((options) => /^\d+-\d+$/u.test(options.releaseProbe)));
});

test("a brief exact-version streak cannot pass before the stability window", async () => {
  let clock = 0;
  let attempts = 0;

  const result = await waitForRelease("https://worker.example.test", RELEASE_ID, {
    timeoutMs: 200,
    intervalMs: 10,
    stabilityMs: 40,
    monotonicNow: () => clock,
    sleep: async (delayMs) => { clock += delayMs; },
    smoke: async () => {
      attempts += 1;
      if (attempts === 4) throw new Error("old edge returned after three exact samples");
      return sample(attempts);
    },
  });

  assert.equal(result.failedSamples, 1);
  assert.equal(result.consecutiveSamples, 5);
  assert.equal(result.stableForMs, 40);
  assert.equal(result.samples[0].checkedAt, "sample-5");
  assert.equal(result.samples.at(-1).checkedAt, "sample-9");
});

test("a forward wall-clock correction cannot shorten the monotonic stability window", async () => {
  let monotonicClock = 0;
  let wallClock = 1_786_000_000_000;
  let attempts = 0;

  const result = await waitForRelease("https://worker.example.test", RELEASE_ID, {
    timeoutMs: 200,
    intervalMs: 10,
    stabilityMs: 40,
    monotonicNow: () => monotonicClock,
    wallNow: () => wallClock,
    sleep: async (delayMs) => { monotonicClock += delayMs; },
    smoke: async () => {
      attempts += 1;
      if (attempts === 2) wallClock += 60_000;
      return sample(attempts);
    },
  });

  assert.equal(result.attempts, 5);
  assert.equal(result.consecutiveSamples, 5);
  assert.equal(result.stableForMs, 40);
  assert.equal(monotonicClock, 40);
});

test("release probe stops retrying at its bounded deadline", async () => {
  let clock = 0;
  let attempts = 0;

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 25,
      intervalMs: 10,
      stabilityMs: 10,
      monotonicNow: () => clock,
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
      stabilityMs: 10,
      monotonicNow: () => clock,
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async () => {
        clock += 21;
        return sample(1);
      },
    }),
    ReleaseReadinessTimeoutError,
  );
});

test("one captured completion tick cannot cross from within the deadline into success", async () => {
  let clock = 0;
  let attempts = 0;
  let completionReads = 0;

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 20,
      intervalMs: 9,
      stabilityMs: 20,
      monotonicNow: () => {
        if (attempts === 3) {
          completionReads += 1;
          return completionReads === 1 ? 19.9 : 20.1;
        }
        return clock;
      },
      sleep: async (delayMs) => { clock += delayMs; },
      smoke: async () => {
        attempts += 1;
        return sample(attempts);
      },
    }),
    ReleaseReadinessTimeoutError,
  );

  assert.equal(attempts, 3);
});

test("a stalled smoke sample is cut off by the hard wall-clock deadline", async () => {
  const startedAt = Date.now();

  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, {
      timeoutMs: 15,
      intervalMs: 1,
      stabilityMs: 10,
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
  await assert.rejects(
    () => waitForRelease("https://worker.example.test", RELEASE_ID, { smoke, stabilityMs: 0 }),
    /positive integer/u,
  );
  assert.equal(called, false);
});
