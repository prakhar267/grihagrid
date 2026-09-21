#!/usr/bin/env node
/** Paired loopback render bridge. No cookies, shell commands, public files, or cloud uploads. */
import http from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, rename, rm, open, statfs, chmod, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serializeScene, readSceneInput, findExecutable, inspectResume } from './run.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const MAX_BODY = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).every(key => keys.includes(key));
const safeEqual = (a, b) => { if (typeof a !== 'string' || typeof b !== 'string') return false; const left = Buffer.from(a), right = Buffer.from(b); return left.length === right.length && timingSafeEqual(left, right); };
const fail = (status, message) => Object.assign(new Error(message), { status });
const assertPrivateDirectory = async filename => {
  const metadata = await lstat(filename);
  if (!metadata.isDirectory() || metadata.isSymbolicLink() || await realpath(filename) !== path.resolve(filename)) throw fail(409, 'A local render directory changed. Restore the private directory or create a new job.');
};

export async function boundedBody(request, maximum = MAX_BODY) {
  if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) throw fail(415, 'Use application/json.');
  const chunks = []; let total = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    total += chunk.length;
    if (total > maximum) { request.resume(); throw fail(413, 'Render request exceeds its byte limit.'); }
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw fail(400, 'Invalid JSON.'); }
}

export function validateRenderRequest(body) {
  if (!exact(body, ['model', 'tour', 'viewpoints', 'settings']) || !body.model || !exact(body.settings, ['mode', 'samples', 'device'])) throw fail(400, 'Unsupported render request fields.');
  const { mode = 'preview', samples = 8, device = 'auto' } = body.settings;
  if (!['scene', 'preview', 'film'].includes(mode) || ![4, 8, 16, 32, 64].includes(samples) || !['auto', 'cpu'].includes(device)) throw fail(400, 'Choose a supported render mode, quality and device.');
  let scene;
  try { scene = serializeScene(body.model, 20, body.tour, body.viewpoints); } catch (error) { throw fail(400, error.message); }
  if (scene.cameraSamples.length > 1800) throw fail(400, 'Local app renders are limited to 60 seconds.');
  return { request: { model: body.model, tour: scene.tour, viewpoints: scene.viewpoints }, scene, settings: { mode, samples, engine: 'cycles', device, duration: 20, timeout: 7200 } };
}

async function atomicJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  await rename(temporary, filename);
}

function runWorker(options, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--max-old-space-size=512', path.join(directory, 'worker.mjs')], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], shell: false });
    let result;
    const cancel = () => { if (child.connected) child.disconnect(); };
    signal.addEventListener('abort', cancel, { once: true });
    child.on('message', message => {
      if (message.type === 'progress') onProgress(message.progress);
      else if (message.type === 'complete') result = { ok: true };
      else if (message.type === 'failed') result = { error: message.error, cancelled: message.cancelled };
    });
    child.on('error', reject);
    child.once('exit', () => {
      signal.removeEventListener('abort', cancel);
      if (result?.ok) resolve();
      else { const error = new Error(result?.error || 'Renderer process stopped. Completed frames can be resumed.'); if (signal.aborted || result?.cancelled) error.name = 'AbortError'; reject(error); }
    });
    child.send({ options });
    if (signal.aborted) cancel();
  });
}

export async function startRenderService({ rootDirectory = path.join(homedir(), '.local/share/grihagrid/render-service'), port = 43127,
  allowedOrigins = ['http://127.0.0.1:5277', 'http://localhost:5277', 'http://127.0.0.1:5173', 'http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'],
  executor = runWorker, checkDependencies = true, checkDisk = true, pairingCode = randomBytes(24).toString('base64url'),
  readDiskSpace = async directory => { const disk = await statfs(directory); return disk.bavail * disk.bsize; } } = {}) {
  // Internal embedding/test option only; HTTP and CLI callers cannot select it.
  if (typeof pairingCode !== 'string' || !/^[A-Za-z0-9_-]{32}$/.test(pairingCode)) throw new Error('Pairing codes must contain 32 base64url characters.');
  for (const origin of allowedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) throw new Error('Render origins must be explicit HTTPS or loopback origins.');
  }
  await mkdir(rootDirectory, { recursive: true, mode: 0o700 });
  rootDirectory = await realpath(rootDirectory);
  await chmod(rootDirectory, 0o700);
  const jobsDirectory = path.join(rootDirectory, 'jobs');
  await mkdir(jobsDirectory, { recursive: true, mode: 0o700 });
  await assertPrivateDirectory(jobsDirectory);
  const pairingFile = path.join(rootDirectory, 'pairing-code.txt');
  const pairingTemporary = `${pairingFile}.${randomUUID()}`;

  const jobs = new Map(), sessions = new Map(), streams = new Map(), mutations = new Set(), writes = new Map();
  let active = null, stopping = false, ready = false, submissions = 0, origin = '', pairWindow = { until: 0, count: 0 }, schedulePending = false;
  const jobDirectory = id => path.join(jobsDirectory, id);
  const recordPath = job => path.join(jobDirectory(job.id), 'record.json');
  const persist = job => {
    const snapshot = structuredClone(job);
    const pending = (writes.get(job.id) || Promise.resolve()).catch(() => {}).then(() => atomicJson(recordPath(snapshot), snapshot));
    writes.set(job.id, pending);
    pending.finally(() => { if (writes.get(job.id) === pending) writes.delete(job.id); }).catch(() => {});
    return pending;
  };
  const publicJob = job => ({ id: job.id, name: job.name, sourceRevision: job.sourceRevision, buildingId: job.buildingId,
    status: job.status, mode: job.settings.mode, samples: job.settings.samples, device: job.settings.device, engine: 'Cycles', createdAt: job.createdAt,
    updatedAt: job.updatedAt, progress: job.status === 'complete' && job.settings.mode === 'film' && Number.isInteger(job.frames) ? { stage: 'complete', frame: job.frames, total: job.frames } : job.progress, error: job.publicError || null, attempt: job.attempt,
    completedAt: job.completedAt || null, recovery: job.recovery || null });
  const emit = job => {
    const data = `event: job\ndata: ${JSON.stringify(publicJob(job))}\n\n`;
    for (const [response, credentials] of streams) { if (response.destroyed || response.writableEnded || !sessions.has(credentials.token) || credentials.expiresAt < Date.now()) { response.end(); streams.delete(response); } else if (!response.writableNeedDrain) response.write(data); }
  };

  let dependencies = { blender: true, ffmpeg: true };
  if (checkDependencies) dependencies = { blender: await findExecutable('blender').then(() => true, () => false), ffmpeg: await findExecutable('ffmpeg').then(() => true, () => false) };
  const availableDiskBytes = async settings => {
    if (!dependencies.blender || settings.mode === 'film' && !dependencies.ffmpeg) throw fail(503, 'Install the missing local Blender or FFmpeg dependency.');
    if (!checkDisk) return Infinity;
    const available = await readDiskSpace(rootDirectory);
    if (!Number.isFinite(available) || available < 0) throw fail(507, 'Local free disk space could not be verified.');
    return available;
  };
  const estimatedBytes = (settings, frames) => (settings.mode === 'film' ? (frames || 1800) * 1920 * 1080 * 4 : 64 * 1024 * 1024) + 512 * 1024 * 1024;
  const assertDiskAdmission = (available, settings, frames, excludedId) => {
    const reserved = [...jobs.values()].filter(job => job.id !== excludedId && ['queued', 'running', 'cancelling'].includes(job.status))
      .reduce((sum, job) => sum + estimatedBytes(job.settings, job.frames), 0);
    if (available < estimatedBytes(settings, frames) + reserved) throw fail(507, 'Not enough unreserved local disk space for this render. Free disk space before resuming.');
  };
  const artifactDirectory = job => path.join(jobDirectory(job.id), `attempt-${job.attempt}`);
  const assertJobDirectory = async job => {
    for (const filename of [rootDirectory, jobsDirectory, jobDirectory(job.id)]) await assertPrivateDirectory(filename);
  };
  const schedule = () => {
    if (schedulePending) return;
    schedulePending = true;
    queueMicrotask(async () => {
      schedulePending = false;
      if (active || stopping) return;
      const job = [...jobs.values()].filter(job => job.status === 'queued').sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (!job) return;
      const controller = new AbortController(); active = { id: job.id, controller };
      let lastPersist = 0, storageError; let writing = Promise.resolve();
      try {
        job.status = 'running'; job.recoverOnRestart = false; job.updatedAt = new Date().toISOString(); await persist(job); emit(job);
        if (controller.signal.aborted) throw new DOMException('Cancelled before the renderer started.', 'AbortError');
        const options = { ...job.settings, input: path.join(jobDirectory(job.id), 'request.json'), output: artifactDirectory(job), resume: !!job.resume };
        await executor(options, progress => {
          if (!object(progress)) return;
          job.progress = { stage: String(progress.stage || 'rendering').slice(0, 50), frame: Number.isFinite(progress.frame) ? progress.frame : job.progress?.frame || 0,
            total: Number.isFinite(progress.total) ? progress.total : job.frames };
          job.updatedAt = new Date().toISOString(); emit(job);
          if (Date.now() - lastPersist > 800) {
            lastPersist = Date.now();
            writing = persist(job).catch(error => { storageError = error; controller.abort(); });
          }
        }, controller.signal);
        if (storageError) throw storageError;
        if (controller.signal.aborted || job.status === 'cancelling') throw new DOMException('Cancelled while the renderer finished.', 'AbortError');
        job.status = 'complete'; job.completedAt = new Date().toISOString(); job.publicError = null;
      } catch (error) {
        job.status = stopping && job.recoverOnRestart ? 'interrupted' : !storageError && (controller.signal.aborted || error.name === 'AbortError') ? 'cancelled' : 'failed';
        job.publicError = job.status === 'interrupted' ? 'The local service stopped. This job will recover automatically when it restarts.' : job.status === 'cancelled' ? 'Cancelled. Resume to keep completed frames.' : 'The renderer stopped. Resume the job, or check the local setup.';
        job.localError = error.message.slice(0, 1200);
      } finally {
        job.updatedAt = new Date().toISOString(); await writing;
        try { await persist(job); }
        catch { job.status = 'failed'; job.publicError = 'Local storage is unavailable. Free disk space, restart the service, and resume.'; }
        emit(job); active = null; schedule();
      }
    });
  };
  const server = http.createServer(async (request, response) => {
    response.on('error', () => { streams.delete(response); response.destroy(); });
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const expectedHost = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== expectedHost || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) throw fail(403, 'Loopback host required.');
      if (!ready) throw fail(503, 'The local renderer is starting.');
      const requestOrigin = request.headers.origin;
      if (!allowedOrigins.includes(requestOrigin)) throw fail(403, 'App origin is not paired with this local service.');
      response.setHeader('Access-Control-Allow-Origin', requestOrigin); response.setHeader('Vary', 'Origin');
      if (request.method === 'OPTIONS') {
        const headers = (request.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(s => s.trim()).filter(Boolean);
        if (!['GET', 'POST', 'DELETE'].includes(request.headers['access-control-request-method']) || headers.some(h => !['authorization', 'content-type'].includes(h))) throw fail(403, 'Unsupported preflight.');
        response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE'); response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
        response.setHeader('Access-Control-Allow-Private-Network', 'true'); response.writeHead(204); response.end(); return;
      }
      const url = new URL(request.url, origin);
      if (url.search) throw fail(400, 'Query parameters are not accepted.');
      const send = (value, status = 200) => { response.writeHead(status, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
      if (request.method === 'GET' && url.pathname === '/health') { send({ service: 'grihagrid-local-renderer', version: 1, dependencies }); return; }
      if (request.method === 'POST' && url.pathname === '/pair') {
        if (Date.now() > pairWindow.until) pairWindow = { until: Date.now() + 300000, count: 0 };
        if (++pairWindow.count > 8) throw fail(429, 'Pairing attempts are temporarily limited.');
        const body = await boundedBody(request, 1024);
        if (!exact(body, ['code']) || !safeEqual(body.code, pairingCode)) throw fail(401, 'Pairing code is invalid.');
        for (const [key, session] of sessions) if (session.expiresAt < Date.now()) sessions.delete(key);
        if (sessions.size >= 16) throw fail(429, 'Too many paired sessions. Restart the local service.');
        const token = randomBytes(32).toString('base64url'), expiresAt = Date.now() + 8 * 3600000;
        sessions.set(token, { origin: requestOrigin, expiresAt }); send({ token, expiresAt }); return;
      }
      const token = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{43})$/)?.[1];
      const session = sessions.get(token);
      if (!session || session.expiresAt < Date.now() || session.origin !== requestOrigin) throw fail(401, 'Pair this browser with the local renderer.');
      if (url.pathname === '/session' && request.method === 'DELETE') { sessions.delete(token); for (const [stream, credentials] of streams) if (credentials.token === token) stream.end(); send({ disconnected: true }); return; }
      if (url.pathname === '/events' && request.method === 'GET') {
        if (streams.size >= 8) throw fail(429, 'Too many progress streams.');
        response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); response.write(': connected\n\n'); streams.set(response, { token, expiresAt: session.expiresAt });
        const heartbeat = setInterval(() => { if (session.expiresAt < Date.now() || !sessions.has(token)) response.end(); else response.write(': keepalive\n\n'); }, 15000);
        response.on('close', () => { clearInterval(heartbeat); streams.delete(response); }); return;
      }
      if (url.pathname === '/jobs' && request.method === 'GET') { send({ jobs: [...jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(publicJob), concurrency: 1 }); return; }
      if (url.pathname === '/jobs' && request.method === 'POST') {
        if (submissions >= 2) throw fail(429, 'Another render request is being checked.');
        submissions++;
        try {
        if (jobs.size >= 20 || [...jobs.values()].filter(j => ['queued', 'running', 'cancelling'].includes(j.status)).length >= 4) throw fail(429, 'Local render queue is full. Remove old jobs or wait for completion.');
        const { request: input, scene, settings } = validateRenderRequest(await boundedBody(request));
        const available = await availableDiskBytes(settings);
        const id = randomUUID(); const job = { id, name: String(input.model.name || 'House tour').slice(0, 100), buildingId: input.model.id, sourceRevision: input.model.revision,
          status: 'queued', settings, attempt: 1, frames: scene.cameraSamples.length, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), progress: { stage: 'queued', frame: 0, total: scene.cameraSamples.length } };
        if (jobs.size >= 20 || [...jobs.values()].filter(j => ['queued', 'running', 'cancelling'].includes(j.status)).length >= 4) throw fail(429, 'Local render queue is full.');
        assertDiskAdmission(available, settings, scene.cameraSamples.length);
        jobs.set(id, job);
        let created = false;
        try {
          await assertPrivateDirectory(jobsDirectory);
          await mkdir(jobDirectory(id), { mode: 0o700 }); created = true;
          await writeFile(path.join(jobDirectory(id), 'request.json'), JSON.stringify(input), { flag: 'wx', mode: 0o600 }); await persist(job);
        } catch (error) { jobs.delete(id); if (created) await rm(jobDirectory(id), { recursive: true, force: true }); throw error; }
        send({ job: publicJob(job) }, 201); schedule(); return;
        } finally { submissions--; }
      }
      const match = url.pathname.match(/^\/jobs\/([0-9a-f-]+)(?:\/(cancel|resume|artifacts)(?:\/(.+))?)?$/);
      if (!match || !UUID.test(match[1]) || !jobs.has(match[1])) throw fail(404, 'Render job not found.');
      const job = jobs.get(match[1]); const action = match[2];
      const changing = ['POST', 'DELETE'].includes(request.method);
      if (changing && mutations.has(job.id)) throw fail(409, 'Another job action is in progress.');
      if (changing) mutations.add(job.id);
      try {
      if (!action && request.method === 'GET') { send({ job: publicJob(job) }); return; }
      if (!action && request.method === 'DELETE') {
        if (['running', 'queued', 'cancelling'].includes(job.status)) throw fail(409, 'Cancel an active job before removing it.');
        await assertJobDirectory(job);
        await rm(jobDirectory(job.id), { recursive: true }); jobs.delete(job.id); send({ removed: true }); return;
      }
      if (action === 'cancel' && request.method === 'POST') {
        const body = await boundedBody(request, 128); if (!exact(body, []) || Object.keys(body).length) throw fail(400, 'Cancellation has no fields.');
        if (!['queued', 'running', 'cancelling'].includes(job.status)) throw fail(409, 'This job is not running.');
        const controller = active?.id === job.id ? active.controller : null;
        job.status = controller ? 'cancelling' : 'cancelled'; job.recoverOnRestart = false; job.updatedAt = new Date().toISOString();
        // Fence completion before yielding to disk I/O: the renderer can finish
        // while this cancellation snapshot is being written.
        controller?.abort();
        await persist(job); emit(job); send({ job: publicJob(job) }); return;
      }
      if (action === 'resume' && request.method === 'POST') {
        const body = await boundedBody(request, 128); if (!exact(body, []) || Object.keys(body).length) throw fail(400, 'Resume uses the original job inputs.');
        if (!['interrupted', 'cancelled', 'failed'].includes(job.status)) throw fail(409, 'This job cannot be resumed.');
        if ([...jobs.values()].filter(j => ['queued', 'running', 'cancelling'].includes(j.status)).length >= 4) throw fail(429, 'Local render queue is full.');
        await assertJobDirectory(job);
        let resume = true, attempt = job.attempt;
        try { await assertPrivateDirectory(artifactDirectory(job)); await inspectResume(artifactDirectory(job)); }
        catch (error) {
          if (error.code !== 'ENOENT') throw fail(409, 'Original render files changed; create a new job.');
          if (attempt >= 100) throw fail(409, 'This job reached its construction-attempt limit. Create a new job.');
          attempt++; resume = false;
        }
        const available = await availableDiskBytes(job.settings);
        if ([...jobs.values()].filter(j => ['queued', 'running', 'cancelling'].includes(j.status)).length >= 4) throw fail(429, 'Local render queue is full.');
        assertDiskAdmission(available, job.settings, job.frames, job.id);
        const previous = structuredClone(job);
        Object.assign(job, { attempt, resume, status: 'queued', publicError: null, updatedAt: new Date().toISOString() });
        try { await persist(job); } catch (error) { jobs.set(job.id, previous); throw error; }
        emit(job); send({ job: publicJob(job) }); schedule(); return;
      }
      if (action === 'artifacts' && request.method === 'GET') {
        const name = match[3];
        const allowed = { 'tour.mp4': 'video/mp4', 'house.glb': 'model/gltf-binary', 'house.blend': 'application/octet-stream', 'manifest.json': 'application/json' };
        const preview = /^previews\/frame-\d{4}\.png$/.test(name || '');
        if (!allowed[name] && !preview) throw fail(404, 'Artifact not found.');
        if (!preview && job.status !== 'complete') throw fail(404, 'This artifact is not ready.');
        await assertJobDirectory(job); await assertPrivateDirectory(artifactDirectory(job));
        if (preview) await assertPrivateDirectory(path.join(artifactDirectory(job), 'previews'));
        const filename = path.join(artifactDirectory(job), name);
        const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(() => { throw fail(404, 'Artifact is not ready.'); });
        try {
          const info = await handle.stat(); if (!info.isFile() || info.size > 256 * 1024 * 1024) throw fail(413, 'Artifact exceeds the download limit.');
          if (!info.size) throw fail(404, 'Artifact is not ready.');
          response.writeHead(200, { 'Content-Type': preview ? 'image/png' : allowed[name], 'Content-Length': info.size,
            'Content-Disposition': `attachment; filename="${path.basename(name)}"` });
          const stream = handle.createReadStream({ start: 0, end: info.size - 1, autoClose: false });
          await new Promise((resolve, reject) => { stream.on('error', reject); response.on('close', () => { stream.destroy(); resolve(); }); response.on('finish', resolve); stream.pipe(response); });
        } finally { await handle.close(); }
        return;
      }
      throw fail(405, 'Unsupported operation.');
      } finally { if (changing) mutations.delete(job.id); }
    } catch (error) {
      if (!response.headersSent) { response.writeHead(error.status || 500, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ error: error.status ? error.message : 'The local renderer could not complete this operation.' })); }
      else response.destroy();
    }
  });
  server.requestTimeout = 30000; server.headersTimeout = 10000; server.maxConnections = 32;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  for (const name of await readdir(jobsDirectory)) {
    if (!UUID.test(name)) continue;
    try {
      await assertPrivateDirectory(jobDirectory(name));
      const job = await readSceneInput(path.join(jobDirectory(name), 'record.json'), { noFollow: true });
      if (job.id !== name || !Number.isInteger(job.attempt) || job.attempt < 1 || job.attempt > 100 || !['queued', 'running', 'cancelling', 'complete', 'failed', 'cancelled', 'interrupted'].includes(job.status)) continue;
      if (!exact(job.settings, ['mode', 'samples', 'engine', 'device', 'duration', 'timeout']) ||
          !['scene', 'preview', 'film'].includes(job.settings.mode) || ![4, 8, 16, 32, 64].includes(job.settings.samples) ||
          job.settings.engine !== 'cycles' || !['auto', 'cpu'].includes(job.settings.device) || job.settings.timeout !== 7200 || job.settings.duration !== 20 ||
          typeof job.name !== 'string' || typeof job.createdAt !== 'string' || !Number.isFinite(Date.parse(job.createdAt))) continue;
      if (job.status === 'cancelling') {
        job.status = 'cancelled'; job.recoverOnRestart = false; job.publicError = 'Cancelled. Resume to keep completed frames.'; await persist(job);
      } else if (['queued', 'running'].includes(job.status) || job.status === 'interrupted' && job.recoverOnRestart) {
        try {
          let attempt = job.attempt, resume = true;
          try { await assertPrivateDirectory(artifactDirectory(job)); await inspectResume(artifactDirectory(job)); }
          catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const existing = await readdir(artifactDirectory(job)).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
            if (existing) {
              if (attempt >= 3) throw new Error('Automatic construction recovery reached its three-attempt limit.');
              attempt++;
            }
            resume = false;
          }
          const available = await availableDiskBytes(job.settings);
          assertDiskAdmission(available, job.settings, job.frames, job.id);
          Object.assign(job, { attempt, resume, status: 'queued', publicError: null, recoverOnRestart: false });
          job.recovery = 'Recovered automatically after local service restart.';
          job.progress = { ...job.progress, stage: 'recovered' };
        } catch (error) {
          job.status = 'failed'; job.publicError = [503, 507].includes(error.status) ? error.message : 'Automatic recovery stopped because original files changed or construction repeatedly failed. Create a new job.';
        }
        job.updatedAt = new Date().toISOString(); await persist(job);
      }
      jobs.set(name, job);
    } catch { /* Corrupt records are never scheduled or exposed. */ }
  }
  await writeFile(pairingTemporary, pairingCode, { flag: 'wx', mode: 0o600 });
  await rename(pairingTemporary, pairingFile);
  ready = true; schedule();
  return { origin, pairingFile, rootDirectory, async close() {
    stopping = true;
    if (active) { const job = jobs.get(active.id); if (job.status !== 'cancelling') job.recoverOnRestart = true; active.controller.abort(); }
    for (const response of streams.keys()) response.end();
    await new Promise(resolve => server.close(resolve));
    while (active) await new Promise(resolve => setTimeout(resolve, 25));
  } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const allowedOrigins = process.env.GRIHAGRID_RENDER_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean);
  const service = await startRenderService({ ...(allowedOrigins ? { allowedOrigins } : {}) });
  process.stdout.write(`Local renderer ready at ${service.origin}\nPairing code is stored privately in ${service.pairingFile}\n`);
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await service.close(); process.exit(0); });
}
