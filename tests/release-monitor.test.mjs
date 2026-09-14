import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile, appendFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { monitorRelease, parseWatchedStderr, ReleaseTailCoverageError } from '../scripts/monitor-release.mjs';
import { runSmoke } from '../scripts/smoke.mjs';

const origin = 'https://worker.example.test', releaseId = '11111111-1111-4111-8111-111111111111';
const sample = () => ({ checks: [{ latencyMs: 1, attempts: 1 }] });
const script = fileURLToPath(new URL('../scripts/monitor-release.mjs', import.meta.url));
async function fixture(run) {
  const directory = await mkdtemp(join(tmpdir(), 'release-monitor-'));
  const paths = [join(directory, 'invocation.stderr'), join(directory, 'server.stderr')];
  await Promise.all(paths.map(path => writeFile(path, '', { mode: 0o600 })));
  try { return await run(paths); } finally { await rm(directory, { recursive: true, force: true }); }
}

test('full coverage uses monotonic time and a fresh exact-version final fence', async () => {
  await fixture(async watchStderr => {
    const calls = [], started = performance.now(), oldNow = Date.now;
    try {
      // A large wall-clock jump cannot make a short/partial observation pass.
      let clockJump = 0;
      Date.now = () => oldNow() + clockJump;
      const result = await monitorRelease(origin, releaseId, {
        durationMs: 65, intervalMs: 30, healthIntervalMs: 5, watchPids: [process.pid], watchStderr,
        smoke: async (_origin, options) => { calls.push({ at: performance.now(), ...options }); clockJump = 10_000_000; return sample(); },
      });
      assert.ok(performance.now() - started >= 65);
      assert.equal(result.configuredDurationMs, 65); assert.ok(result.observedDurationMs >= 65);
      assert.equal(result.completedFullDuration, true); assert.equal(result.finalFencePassed, true); assert.equal(result.finalFenceReleaseId, releaseId);
      assert.ok(calls.length >= 2); assert.ok(calls.at(-1).at - started >= 65);
      assert.equal(calls.at(-1).expectedReleaseId, releaseId);
      assert.match(calls.at(-1).releaseProbe, /^1-\d{1,16}$/);
      assert.ok(calls.every(call => call.signal instanceof AbortSignal));
    } finally { Date.now = oldNow; }
  });
});

test('final fence failure prevents a complete-window success', async () => {
  let finalCalled = false;
  const failure = new Error('confirmed public regression');
  await assert.rejects(monitorRelease(origin, releaseId, {
    durationMs: 25, intervalMs: 40, healthIntervalMs: 5,
    smoke: async (_origin, options) => { if (options.releaseProbe) { finalCalled = true; throw failure; } return sample(); },
  }), error => {
    assert.equal(error, failure); assert.equal(error.monitorProgress.finalFencePassed, false);
    assert.equal(error.monitorProgress.completedFullDuration, false); assert.ok(error.monitorProgress.observedDurationMs >= 25);
    return true;
  });
  assert.equal(finalCalled, true);
});

test('both actual tail processes are continuously watched during the polling sleep', async () => {
  for (const victim of [0, 1]) {
    const children = [0, 1].map(() => spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore' }));
    const exits = children.map(child => once(child, 'exit'));
    let calls = 0, timer;
    try {
      const started = performance.now();
      const monitor = monitorRelease(origin, releaseId, { durationMs: 1000, intervalMs: 1000, healthIntervalMs: 10, watchPids: children.map(child => child.pid), smoke: async () => { calls++; return sample(); } });
      timer = setTimeout(() => children[victim].kill(), 45);
      await assert.rejects(monitor, ReleaseTailCoverageError);
      assert.ok(performance.now() - started < 800, 'PID loss must not wait for the one-second public polling sleep.');
      assert.equal(calls, 1);
    } finally { clearTimeout(timer); children.forEach(child => child.kill()); await Promise.all(exits); }
  }
});

test('stderr growth on either tail aborts in-flight smoke and awaits its cancellation', async () => {
  for (const index of [0, 1]) await fixture(async watchStderr => {
    let active = false, cancelled = false, timer;
    const monitor = monitorRelease(origin, releaseId, {
      durationMs: 1000, intervalMs: 1000, healthIntervalMs: 5, watchPids: [process.pid], watchStderr,
      smoke: async (_origin, { signal }) => {
        active = true;
        timer = setTimeout(() => { void appendFile(watchStderr[index], 'sensitive unknown diagnostic\n'); }, 20);
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => { void delay(15).then(() => { active = false; cancelled = true; reject(signal.reason); }); }, { once: true }));
      },
    });
    try {
      await assert.rejects(monitor, error => error instanceof ReleaseTailCoverageError && error.monitorProgress.finalFencePassed === false);
      assert.equal(cancelled, true); assert.equal(active, false, 'No smoke request may remain outstanding when monitor returns.');
    } finally { clearTimeout(timer); }
  });
});

test('confirmed public failure remains terminal when tail coverage fails concurrently', async () => {
  await fixture(async watchStderr => {
    const publicFailure = new Error('confirmed HTTP 503');
    await assert.rejects(monitorRelease(origin, releaseId, {
      durationMs: 1000, intervalMs: 1000, healthIntervalMs: 5, watchStderr,
      smoke: async (_origin, { signal }) => {
        await appendFile(watchStderr[1], 'connection diagnostic');
        return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(publicFailure), { once: true }));
      },
    }), error => error === publicFailure && error.monitorProgress.finalFencePassed === false);
  });
});

test('bounded stderr reading accepts the one proxy notice but rejects oversize and missing evidence', async () => {
  await fixture(async watchStderr => {
    await writeFile(watchStderr[0], "Proxy environment variables detected. We'll use your proxy for fetch requests.\n");
    const result = await monitorRelease(origin, releaseId, { durationMs: 10, intervalMs: 10, healthIntervalMs: 2, watchStderr, smoke: async () => sample() });
    assert.equal(result.finalFencePassed, true);
    await writeFile(watchStderr[1], Buffer.alloc(500_000, 0x61));
    await assert.rejects(monitorRelease(origin, releaseId, { durationMs: 10, watchStderr, smoke: async () => { throw new Error('must not start public sampling'); } }), ReleaseTailCoverageError);
    await rm(watchStderr[1]);
    await assert.rejects(monitorRelease(origin, releaseId, { durationMs: 10, watchStderr, smoke: async () => sample() }), ReleaseTailCoverageError);
  });
});

test('replaced or truncated stderr invalidates an observation even when the new contents are clean', async () => {
  for (const operation of ['replace', 'truncate']) await fixture(async watchStderr => {
    await writeFile(watchStderr[0], "Proxy environment variables detected. We'll use your proxy for fetch requests.\n");
    await assert.rejects(monitorRelease(origin, releaseId, {
      durationMs: 1000, intervalMs: 1000, healthIntervalMs: 5, watchStderr,
      smoke: async () => {
        if (operation === 'replace') {
          await writeFile(watchStderr[0] + '.new', '', { mode: 0o600 });
          await rename(watchStderr[0] + '.new', watchStderr[0]);
        } else await writeFile(watchStderr[0], '');
        return sample();
      },
    }), ReleaseTailCoverageError);
  });
});

test('a non-Error public failure cannot be mistaken for success', async () => {
  await assert.rejects(monitorRelease(origin, releaseId, {
    durationMs: 10, smoke: async () => { throw null; },
  }), error => !(error instanceof ReleaseTailCoverageError) && error.monitorProgress.completedFullDuration === false);
});

test('runSmoke forwards parent abort to fetch without retrying the cancelled request', async () => {
  const original = globalThis.fetch, controller = new AbortController(), reason = new ReleaseTailCoverageError();
  let requests = 0, active = 0;
  globalThis.fetch = async (_url, { signal }) => {
    requests++; active++;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => { active--; reject(signal.reason); }, { once: true }));
  };
  try {
    const smoke = runSmoke(origin, { expectedReleaseId: releaseId, signal: controller.signal });
    await delay(5); controller.abort(reason);
    await assert.rejects(smoke, error => error === reason);
    assert.equal(requests, 1); assert.equal(active, 0);
  } finally { globalThis.fetch = original; }
});

test('CLI emits safe failure progress and never raw stderr or trusted file paths', async () => {
  await fixture(async paths => {
    await writeFile(paths[1], 'PRIVATE-BEARER-SECRET unknown diagnostic\n');
    const result = spawnSync(process.execPath, [script, origin, releaseId], { encoding: 'utf8', env: {
      ...process.env, GRIHAGRID_MONITOR_DURATION_MS: '1000', GRIHAGRID_MONITOR_INTERVAL_MS: '1000', GRIHAGRID_MONITOR_WATCH_PIDS: String(process.pid), GRIHAGRID_MONITOR_WATCH_STDERR: JSON.stringify(paths),
    } });
    assert.equal(result.status, 2);
    const record = JSON.parse(result.stdout);
    assert.equal(record.failureType, 'tail_coverage'); assert.equal(record.configuredDurationMs, 1000); assert.equal(record.completedFullDuration, false); assert.equal(record.finalFencePassed, false); assert.equal(record.finalFenceReleaseId, null);
    assert.ok(Number.isFinite(record.observedDurationMs));
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE-BEARER|unknown diagnostic|invocation\.stderr|server\.stderr/);
    assert.throws(() => parseWatchedStderr('not-json'), ReleaseTailCoverageError);
    assert.throws(() => parseWatchedStderr(['a', 'b', 'c']), ReleaseTailCoverageError);
  });
});
