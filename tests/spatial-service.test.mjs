import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm, symlink, stat, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import http from 'node:http';
import fsPromises from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { startRenderService, validateRenderRequest } from '../scripts/spatial/service.mjs';
import { createDemoBuilding } from '../src/spatial/model.js';
import { serializeScene } from '../scripts/spatial/run.mjs';

const ORIGIN = 'http://127.0.0.1:5277';
const model = createDemoBuilding();
const scene = serializeScene(model, 20);
const requestBody = { model, tour: scene.tour, settings: { mode: 'preview', samples: 8 } };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function waitFor(read, predicate) {
  for (let attempt = 0; attempt < 200; attempt++) { const value = await read(); if (predicate(value)) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('Expected local service state did not arrive');
}
async function fixture(options = {}) {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'grihagrid-render-service-'));
  const code = randomBytes(24).toString('base64url');
  const service = await startRenderService({ rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false, ...options, pairingCode: code });
  const baseHeaders = { Origin: ORIGIN, 'Content-Type': 'application/json' };
  assert.equal(await readFile(service.pairingFile, 'utf8'), code);
  const pair = await fetch(`${service.origin}/pair`, { method: 'POST', headers: baseHeaders, body: JSON.stringify({ code }) });
  assert.equal(pair.status, 200);
  const { token } = await pair.json();
  const request = (pathname, options = {}) => fetch(`${service.origin}${pathname}`, { ...options, headers: { ...baseHeaders, Authorization: `Bearer ${token}`, ...options.headers } });
  const jobs = async () => (await (await request('/jobs')).json()).jobs;
  return { service, rootDirectory, request, jobs, async close() { await service.close(); await rm(rootDirectory, { recursive: true, force: true }); } };
}

test('local bridge rejects DNS rebinding, hostile origins, missing auth and credential URLs', async () => {
  const f = await fixture({ executor: async () => {} });
  try {
    const reboundStatus = await new Promise((resolve, reject) => {
      const request = http.request(`${f.service.origin}/jobs`, { headers: { Host: 'attacker.example', Origin: ORIGIN } }, response => { response.resume(); resolve(response.statusCode); });
      request.on('error', reject); request.end();
    });
    assert.equal(reboundStatus, 403);
    assert.equal((await f.request('/jobs', { headers: { Origin: 'https://attacker.example' } })).status, 403);
    assert.equal((await fetch(`${f.service.origin}/jobs`, { headers: { Origin: ORIGIN } })).status, 401);
    assert.equal((await f.request('/jobs?token=not-allowed')).status, 400);
    const preflight = await fetch(`${f.service.origin}/jobs`, { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');
    assert.equal((await f.request('/jobs', { method: 'POST', body: JSON.stringify({ ...requestBody, executable: 'untrusted' }) })).status, 400);
    assert.equal((await f.request('/jobs', { method: 'POST', body: ' '.repeat(2 * 1024 * 1024 + 1) })).status, 413);
    await f.request('/session', { method: 'DELETE' });
    assert.equal((await f.request('/jobs')).status, 401);
  } finally { await f.close(); }
});

test('job settings accept only bounded fixed Cycles operations and valid scene references', () => {
  assert.equal(validateRenderRequest(requestBody).settings.engine, 'cycles');
  for (const settings of [{ mode: 'shell', samples: 8 }, { mode: 'film', samples: 999 }, { mode: 'film', samples: 8, engine: 'custom' }]) assert.throws(() => validateRenderRequest({ ...requestBody, settings }));
  assert.throws(() => validateRenderRequest({ ...requestBody, tour: { ...scene.tour, sourceRevision: 99 } }), /older|revision/i);
});

test('queued jobs run serially and cancellation releases the next job', async () => {
  let running = 0, maxRunning = 0; const releases = new Map();
  const executor = async (options, progress, signal) => {
    const id = path.basename(path.dirname(options.output));
    running++; maxRunning = Math.max(maxRunning, running);
    try { await new Promise((resolve, reject) => { releases.set(id, resolve); const cancel = () => { const e = new Error('cancelled'); e.name = 'AbortError'; reject(e); }; signal.addEventListener('abort', cancel, { once: true }); if (signal.aborted) cancel(); progress({ stage: 'frame', frame: 1, total: 600 }); }); }
    finally { releases.delete(id); running--; }
  };
  const f = await fixture({ executor });
  try {
    const first = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    const second = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs.find(j => j.id === first.job.id)?.status === 'running');
    assert.equal((await f.jobs()).find(j => j.id === second.job.id).status, 'queued');
    assert.equal((await f.request(`/jobs/${first.job.id}/cancel`, { method: 'POST', body: '{}' })).status, 200);
    await waitFor(f.jobs, jobs => jobs.find(j => j.id === second.job.id)?.status === 'running');
    const releaseSecond = await waitFor(async () => releases.get(second.job.id), release => typeof release === 'function');
    releaseSecond();
    await waitFor(f.jobs, jobs => jobs.find(j => j.id === second.job.id)?.status === 'complete');
    assert.equal(maxRunning, 1);
    assert.equal((await f.jobs()).find(j => j.id === first.job.id).status, 'cancelled');
  } finally { await f.close(); }
});

test('an accepted cancellation stays cancelled when an executor returns normally after abort', async () => {
  const f = await fixture({ executor: async (options, progress, signal) => {
    await new Promise(resolve => { signal.addEventListener('abort', resolve, { once: true }); if (signal.aborted) resolve(); progress({ stage: 'frame', frame: 1, total: 600 }); });
  } });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs.find(item => item.id === job.id)?.progress.frame === 1);
    assert.equal((await f.request(`/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' })).status, 200);
    await waitFor(f.jobs, jobs => jobs.find(item => item.id === job.id)?.status === 'cancelled');
  } finally { await f.close(); }
});

test('cancellation fences a renderer finishing while its cancellation record is being written', async () => {
  let finish, signal, abortedBeforePersistence;
  const originalWriteFile = fsPromises.writeFile;
  const f = await fixture({ executor: async (options, progress, abortSignal) => {
    signal = abortSignal;
    await new Promise(resolve => { finish = resolve; progress({ stage: 'frame', frame: 1, total: 600 }); });
  } });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    const directory = path.join(f.service.rootDirectory, 'jobs', job.id);
    await waitFor(async () => JSON.parse(await readFile(path.join(directory, 'record.json'), 'utf8')), record => record.progress.frame === 1);
    // Delay only this synthetic job's cancellation write. Other tests run in
    // separate test-file processes, and this file's cases run sequentially.
    fsPromises.writeFile = async (filename, data, options) => {
      if (String(filename).startsWith(path.join(directory, 'record.json.')) && JSON.parse(data).status === 'cancelling') {
        abortedBeforePersistence = signal.aborted;
        finish();
        await new Promise(resolve => setImmediate(resolve));
      }
      return originalWriteFile(filename, data, options);
    };
    syncBuiltinESMExports();
    assert.equal((await f.request(`/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' })).status, 200);
    await waitFor(f.jobs, jobs => ['cancelled', 'complete'].includes(jobs.find(item => item.id === job.id)?.status));
    assert.equal(abortedBeforePersistence, true, 'Abort must be visible before the cancellation record is written.');
    assert.equal((await f.jobs()).find(item => item.id === job.id).status, 'cancelled');
    await waitFor(async () => JSON.parse(await readFile(path.join(directory, 'record.json'), 'utf8')), record => record.status === 'cancelled');
  } finally { fsPromises.writeFile = originalWriteFile; syncBuiltinESMExports(); finish?.(); await f.close(); }
});

test('resume keeps complete frames and rejects tampered provenance', async () => {
  let calls = 0, originalFrame;
  const executor = async (options, progress, signal) => {
    calls++;
    if (options.resume) { assert.equal(await readFile(path.join(options.output, 'frames/frame-0001.png'), 'utf8'), originalFrame); return; }
    await mkdir(path.join(options.output, 'frames'), { recursive: true });
    const source = JSON.stringify(scene), blend = 'trusted test fixture scene';
    const config = JSON.stringify({ mode: 'preview', samples: 8, engine: 'cycles', device: 'cpu', timeout: 30, sourceSha256: hash(source) });
    await Promise.all([
      writeFile(path.join(options.output, 'scene-data.json'), source), writeFile(path.join(options.output, 'house.blend'), blend),
      writeFile(path.join(options.output, 'render-config.json'), config), writeFile(path.join(options.output, 'job.json'), JSON.stringify({ status: 'cancelled' })),
      writeFile(path.join(options.output, 'build-proof.json'), JSON.stringify({ sourceSha256: hash(source), blendSha256: hash(blend), recipeSha256: hash(config) })),
      writeFile(path.join(options.output, 'frames/frame-0001.png'), originalFrame = 'complete original frame'),
    ]);
    progress({ stage: 'frame', frame: 1, total: 600 });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => { const e = new Error('cancelled'); e.name = 'AbortError'; reject(e); }, { once: true }));
  };
  const f = await fixture({ executor });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs[0].progress.frame === 1);
    await f.request(`/jobs/${job.id}/cancel`, { method: 'POST', body: '{}' });
    await waitFor(f.jobs, jobs => jobs[0].status === 'cancelled');
    const blend = path.join(f.rootDirectory, 'jobs', job.id, 'attempt-1', 'house.blend');
    await writeFile(blend, 'changed');
    assert.equal((await f.request(`/jobs/${job.id}/resume`, { method: 'POST', body: '{}' })).status, 409);
    await writeFile(blend, 'trusted test fixture scene');
    assert.equal((await f.request(`/jobs/${job.id}/resume`, { method: 'POST', body: '{}' })).status, 200);
    await waitFor(f.jobs, jobs => jobs[0].status === 'complete'); assert.equal(calls, 2);
  } finally { await f.close(); }
});

test('a restarted service automatically recovers previously running construction', async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'grihagrid-render-recovery-')); const id = randomUUID();
  await mkdir(path.join(rootDirectory, 'jobs', id), { recursive: true });
  await writeFile(path.join(rootDirectory, 'jobs', id, 'record.json'), JSON.stringify({ id, name: 'Synthetic recovery', buildingId: model.id, sourceRevision: 1, status: 'running', settings: { mode: 'preview', samples: 8, engine: 'cycles', device: 'auto', duration: 20, timeout: 7200 }, attempt: 1, createdAt: new Date().toISOString(), progress: { frame: 3, total: 600 } }));
  let calls = 0;
  const service = await startRenderService({ rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false, executor: async () => { calls++; } });
  try {
    const record = await waitFor(async () => JSON.parse(await readFile(path.join(rootDirectory, 'jobs', id, 'record.json'))), record => record.status === 'complete');
    assert.equal(record.progress.frame, 3); assert.equal(calls, 1); assert.match(record.recovery, /automatically/);
  } finally { await service.close(); await rm(rootDirectory, { recursive: true, force: true }); }
});

test('a graceful service restart automatically resumes the verified original frames', async () => {
  const frame = 'completed frame fixture'; let output;
  const f = await fixture({ executor: async (options, progress, signal) => {
    output = options.output; await mkdir(path.join(output, 'frames'), { recursive: true });
    const source = JSON.stringify(scene), blend = 'original generated scene';
    const config = JSON.stringify({ ...options, input: undefined, output: undefined, resume: undefined, sourceSha256: hash(source) });
    await Promise.all([
      writeFile(path.join(output, 'scene-data.json'), source), writeFile(path.join(output, 'house.blend'), blend),
      writeFile(path.join(output, 'render-config.json'), config), writeFile(path.join(output, 'job.json'), JSON.stringify({ status: 'running' })),
      writeFile(path.join(output, 'build-proof.json'), JSON.stringify({ sourceSha256: hash(source), blendSha256: hash(blend), recipeSha256: hash(config) })),
      writeFile(path.join(output, 'frames/frame-0001.png'), frame),
    ]);
    progress({ stage: 'frame', frame: 1, total: 600 });
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('service stopped')), { once: true }));
  } });
  let second;
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs[0].progress.frame === 1);
    const before = await stat(path.join(output, 'frames/frame-0001.png'));
    await f.service.close();
    const readRecord = async () => JSON.parse(await readFile(path.join(f.rootDirectory, 'jobs', job.id, 'record.json')));
    assert.equal((await readRecord()).status, 'interrupted');
    let resumed = false;
    second = await startRenderService({ rootDirectory: f.rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false, executor: async options => {
      assert.equal(options.resume, true); assert.equal(options.output, output);
      assert.equal(await readFile(path.join(output, 'frames/frame-0001.png'), 'utf8'), frame); resumed = true;
    } });
    await waitFor(readRecord, record => record.status === 'complete'); assert.equal(resumed, true);
    assert.equal((await stat(path.join(output, 'frames/frame-0001.png'))).mtimeMs, before.mtimeMs);
  } finally { if (second) await second.close(); else await f.service.close(); await rm(f.rootDirectory, { recursive: true, force: true }); }
});

test('explicit cancellation and prior failures never restart automatically', async () => {
  const rootDirectory = await mkdtemp(path.join(tmpdir(), 'grihagrid-render-explicit-cancel-'));
  const ids = [];
  for (const status of ['cancelled', 'cancelling', 'failed']) {
    const id = randomUUID(); ids.push(id); await mkdir(path.join(rootDirectory, 'jobs', id), { recursive: true });
    await writeFile(path.join(rootDirectory, 'jobs', id, 'record.json'), JSON.stringify({ id, name: 'Stopped by user', status, settings: { mode: 'film', samples: 8, engine: 'cycles', device: 'auto', duration: 20, timeout: 7200 }, attempt: 1, createdAt: new Date().toISOString() }));
  }
  let calls = 0;
  const service = await startRenderService({ rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false, executor: async () => { calls++; } });
  try {
    const records = await Promise.all(ids.map(id => readFile(path.join(rootDirectory, 'jobs', id, 'record.json')).then(JSON.parse)));
    assert.deepEqual(records.map(record => record.status), ['cancelled', 'cancelled', 'failed']); assert.equal(calls, 0);
  } finally { await service.close(); await rm(rootDirectory, { recursive: true, force: true }); }
});

test('artifact reads require a paired session, a fixed name, and a regular private file', async () => {
  const f = await fixture({ executor: async options => {
    await mkdir(path.join(options.output, 'previews'), { recursive: true });
    await writeFile(path.join(options.output, 'house.glb'), 'synthetic glb');
    await writeFile(path.join(options.output, 'previews/frame-0001.png'), 'synthetic preview');
    await symlink(path.join(options.output, 'house.glb'), path.join(options.output, 'house.blend'));
  } });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs[0].status === 'complete');
    const artifact = `/jobs/${job.id}/artifacts/house.glb`;
    assert.equal((await fetch(`${f.service.origin}${artifact}`, { headers: { Origin: ORIGIN } })).status, 401);
    const response = await f.request(artifact);
    assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'model/gltf-binary');
    assert.equal(response.headers.get('cache-control'), 'no-store'); assert.equal(await response.text(), 'synthetic glb');
    assert.equal((await f.request(`/jobs/${job.id}/artifacts/request.json`)).status, 404);
    assert.equal((await f.request(`/jobs/${job.id}/artifacts/house.blend`)).status, 404);
    assert.equal((await f.request(`/jobs/${job.id}/artifacts/previews/frame-0001.png`)).status, 200);
    assert.equal((await stat(path.join(f.rootDirectory, 'jobs', job.id))).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(f.rootDirectory, 'jobs', job.id, 'request.json'))).mode & 0o777, 0o600);
  } finally { await f.close(); }
});

test('revoking a session closes its authenticated progress stream', async () => {
  const f = await fixture({ executor: async () => {} });
  try {
    const events = await f.request('/events'); assert.equal(events.status, 200);
    const reader = events.body.getReader();
    assert.match(new TextDecoder().decode((await reader.read()).value), /connected/);
    await f.request('/session', { method: 'DELETE' });
    assert.equal((await reader.read()).done, true);
  } finally { await f.close(); }
});

test('a second service cannot rotate the live pairing code or recover its active records', async () => {
  const f = await fixture({ executor: async (options, progress, signal) => {
    if (signal.aborted) throw new Error('stopped');
    await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
  } });
  try {
    await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) });
    await waitFor(f.jobs, jobs => jobs[0].status === 'running');
    const codeBefore = await readFile(f.service.pairingFile);
    await assert.rejects(startRenderService({ rootDirectory: f.rootDirectory, port: Number(new URL(f.service.origin).port), allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false }), { code: 'EADDRINUSE' });
    assert.deepEqual(await readFile(f.service.pairingFile), codeBefore);
    assert.equal((await f.jobs())[0].status, 'running');
  } finally { await f.close(); }
});

test('queue admission stays within four jobs under simultaneous submissions', async () => {
  let active = 0, highest = 0;
  const f = await fixture({ executor: async (options, progress, signal) => {
    active++; highest = Math.max(highest, active);
    try {
      if (signal.aborted) throw new Error('stopped');
      await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')), { once: true }));
    }
    finally { active--; }
  } });
  try {
    const responses = await Promise.all(Array.from({ length: 10 }, () => f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })));
    assert(responses.every(response => [201, 429].includes(response.status)));
    assert(responses.some(response => response.status === 429));
    const jobs = await f.jobs(); assert(jobs.length > 0 && jobs.length <= 4);
    await waitFor(async () => highest, value => value === 1); assert.equal(highest, 1);
  } finally { await f.close(); }
});

test('disk limits apply to fresh jobs, manual resume and automatic restart without moving the saved attempt', async () => {
  let available = 1e12, calls = 0, firstClosed = false, second;
  const f = await fixture({ checkDisk: true, readDiskSpace: async () => available, executor: async options => {
    calls++; await mkdir(options.output, { recursive: true }); throw new Error('Interrupted construction fixture');
  } });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    const filename = path.join(f.rootDirectory, 'jobs', job.id, 'record.json');
    const readRecord = async () => JSON.parse(await readFile(filename));
    await waitFor(readRecord, record => record.status === 'failed');
    available = 0;
    assert.equal((await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).status, 507);
    assert.equal((await f.request(`/jobs/${job.id}/resume`, { method: 'POST', body: '{}' })).status, 507);
    assert.equal((await f.jobs())[0].attempt, 1); assert.equal((await readRecord()).attempt, 1);
    await f.service.close(); firstClosed = true;
    await writeFile(filename, JSON.stringify({ ...await readRecord(), status: 'running' }));
    second = await startRenderService({ rootDirectory: f.rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false,
      readDiskSpace: async () => available, executor: async () => { calls++; } });
    const recovered = await readRecord(); assert.equal(recovered.status, 'failed'); assert.equal(recovered.attempt, 1);
    assert.match(recovered.publicError, /disk space/); assert.equal(calls, 1);
  } finally { if (second) await second.close(); if (!firstClosed) await f.service.close(); await rm(f.rootDirectory, { recursive: true, force: true }); }
});

test('artifact parents and recovered job directories cannot be symlinks', async () => {
  let output, firstClosed = false, second;
  const f = await fixture({ executor: async options => {
    output = options.output; await mkdir(path.join(output, 'previews'), { recursive: true });
    await writeFile(path.join(output, 'house.glb'), 'private artifact fixture');
  } });
  try {
    const { job } = await (await f.request('/jobs', { method: 'POST', body: JSON.stringify(requestBody) })).json();
    await waitFor(f.jobs, jobs => jobs[0].status === 'complete');
    await rename(output, `${output}-original`); await symlink(`${output}-original`, output);
    assert.equal((await f.request(`/jobs/${job.id}/artifacts/house.glb`)).status, 409);
    await rm(output); await rename(`${output}-original`, output);
    await f.service.close(); firstClosed = true;
    const jobPath = path.join(f.rootDirectory, 'jobs', job.id), moved = path.join(f.rootDirectory, 'moved-job');
    await rename(jobPath, moved); await symlink(moved, jobPath);
    const code = randomBytes(24).toString('base64url');
    second = await startRenderService({ rootDirectory: f.rootDirectory, port: 0, allowedOrigins: [ORIGIN], checkDependencies: false, checkDisk: false, executor: async () => {}, pairingCode: code });
    assert.equal(await readFile(second.pairingFile, 'utf8'), code);
    const pair = await fetch(`${second.origin}/pair`, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
    const { token } = await pair.json();
    const response = await fetch(`${second.origin}/jobs`, { headers: { Origin: ORIGIN, Authorization: `Bearer ${token}` } });
    assert.deepEqual((await response.json()).jobs, []);
  } finally { if (second) await second.close(); if (!firstClosed) await f.service.close(); await rm(f.rootDirectory, { recursive: true, force: true }); }
});
