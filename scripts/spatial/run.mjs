#!/usr/bin/env node
/** Local-only Blender job runner. No shell, uploaded code, or cloud credentials. */
import { access, mkdir, open, readFile, readdir, stat, writeFile, rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimitives, createDemoBuilding, validateBuilding } from '../../src/spatial/model.js';
import { generateTour, sampleTour, validateTour } from '../../src/spatial/tours.js';
import { validateViewpoints } from '../../src/spatial/viewpoints.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
const MAX_INPUT_BYTES = 2 * 1024 * 1024;

export async function readSceneInput(inputPath, { noFollow = false } = {}) {
  // NONBLOCK lets us reject a FIFO by descriptor without waiting for a writer.
  const handle = await open(inputPath, constants.O_RDONLY | constants.O_NONBLOCK | (noFollow ? constants.O_NOFOLLOW : 0));
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile()) throw new Error('Input must be a regular file');
    if (metadata.size > MAX_INPUT_BYTES) throw new Error('Input exceeds 2 MiB');
    // The extra byte detects growth after fstat without ever reading unbounded data.
    const buffer = Buffer.alloc(MAX_INPUT_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_INPUT_BYTES) throw new Error('Input exceeds 2 MiB');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)));
  } finally {
    await handle.close();
  }
}

export function parseArgs(argv) {
  const options = { mode: 'preview', samples: 16, duration: 24, timeout: 1800, device: 'auto', engine: 'cycles' };
  const allowed = new Set(['input', 'output', 'mode', 'samples', 'duration', 'timeout', 'blender', 'device', 'engine']);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.replace(/^--/, '');
    const value = argv[index + 1];
    if (!argv[index]?.startsWith('--') || !allowed.has(key) || !value || value.startsWith('--')) {
      throw new Error(`Expected --${[...allowed].join(', --')} with values`);
    }
    options[key] = ['samples', 'duration', 'timeout'].includes(key) ? Number(value) : value;
  }
  if (!['scene', 'preview', 'film'].includes(options.mode)) throw new Error('mode must be scene, preview, or film');
  if (!['auto', 'cpu'].includes(options.device)) throw new Error('device must be auto or cpu');
  if (!['cycles', 'eevee'].includes(options.engine)) throw new Error('engine must be cycles or eevee');
  for (const [key, minimum, maximum] of [['samples', 1, 128], ['duration', 8, 120], ['timeout', 30, 7200]]) {
    if (!Number.isInteger(options[key]) || options[key] < minimum || options[key] > maximum) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}`);
    }
  }
  return options;
}

export function serializeScene(model, duration = 24, suppliedTour, suppliedViewpoints = []) {
  const validation = validateBuilding(model);
  if (!validation.valid) throw new Error(`Invalid building: ${JSON.stringify(validation.errors)}`);
  if (!validateViewpoints(suppliedViewpoints, model)) throw new Error('Invalid or stale saved viewpoints. Update or remove cameras from an older concept before exporting.');
  const tour = suppliedTour || model.tour || generateTour(model, { duration, includeExterior: true });
  const tourValidation = validateTour(model, tour);
  if (!tourValidation.valid) throw new Error(`Invalid tour: ${JSON.stringify(tourValidation.errors)}`);
  const primitives = buildPrimitives(model);
  if (primitives.length > 5000) throw new Error('Scene exceeds the 5,000 primitive local budget');
  const fps = 30;
  const actualDuration = tour.duration ?? tour.durationSeconds ?? duration;
  if (!Number.isFinite(actualDuration) || actualDuration < 1 || actualDuration > 120) throw new Error('Tour duration out of range');
  const cameraSamples = Array.from({ length: Math.round(actualDuration * fps) }, (_, frame) => {
    const sample = sampleTour(tour, frame / fps);
    if (!sample || ![...sample.position, ...sample.target].every(Number.isFinite)) throw new Error('Invalid camera sample');
    return sample;
  });
  const viewpoints = structuredClone(suppliedViewpoints);
  if (primitives.some(item => viewpoints.some(view => item.id === `viewpoint:${view.id}`) || item.id === 'tour-camera')) throw new Error('Reserved camera identifier used by geometry');
  return { schemaVersion: 1, sourceRevision: model.revision, primitives, rooms: model.rooms, floors: model.floors, fps, cameraSamples, tour, viewpoints };
}

export function verifyGltfCoordinates(buffer, payload) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error('Blender did not produce a supported binary glTF');
  }
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
  const identifiedNodes = (json.nodes || []).filter(node => typeof node.extras?.id === 'string');
  const nodes = new Map(identifiedNodes.map(node => [node.extras.id, node]));
  if (nodes.size !== identifiedNodes.length) throw new Error('GLB contains duplicate stable identifiers');
  const toGltf = ([x, y, z]) => [x / 1000, z / 1000, -y / 1000];
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  const transformVector = (value, fallback, length) => {
    const vector = value === undefined ? fallback : value;
    if (!Array.isArray(vector) || vector.length !== length || !vector.every(Number.isFinite)) throw new Error('GLB contains an invalid transform vector');
    return vector;
  };
  let maxPositionErrorMm = 0;
  for (const primitive of payload.primitives) {
    const node = nodes.get(primitive.id);
    if (!node || node.matrix || ['roomId', 'floorId', 'stairId', 'wallId', 'openingId'].some(key => (node.extras[key] ?? null) !== (primitive[key] ?? null))) throw new Error(`GLB node contract failed for ${primitive.id}`);
    maxPositionErrorMm = Math.max(maxPositionErrorMm, distance(transformVector(node.translation, [0, 0, 0], 3), toGltf(primitive.position)) * 1000);
  }
  const inspectCamera = (id, expected, saved = false) => {
    const cameraNode = nodes.get(id);
    if (!cameraNode || cameraNode.matrix || !Number.isInteger(cameraNode.camera)) throw new Error('Missing GLB camera transform');
    if (saved && (cameraNode.extras.category !== 'viewpoint' || cameraNode.extras.viewpointId !== expected.id || cameraNode.extras.viewpointName !== expected.name ||
        ['buildingId', 'sourceRevision', 'floorId'].some(key => (cameraNode.extras[key] ?? null) !== (expected[key] ?? null)))) throw new Error('GLB lost saved camera identity or source association');
    const positionErrorMm = distance(transformVector(cameraNode.translation, [0, 0, 0], 3), toGltf(expected.position)) * 1000;
    const expectedPosition = toGltf(expected.position), target = toGltf(expected.target);
    const length = distance(expectedPosition, target);
    const expectedDirection = target.map((v, i) => (v - expectedPosition[i]) / length);
    const rotation = transformVector(cameraNode.rotation, [0, 0, 0, 1], 4);
    if (Math.abs(Math.hypot(...rotation) - 1) > .0001) throw new Error('GLB camera quaternion must have unit length');
    const [x, y, z, w] = rotation;
    const actualDirection = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
    const directionError = distance(expectedDirection, actualDirection);
    const yfov = json.cameras?.[cameraNode.camera]?.perspective?.yfov;
    const fovError = Math.abs(yfov * 180 / Math.PI - expected.fov);
    if (![positionErrorMm, directionError, fovError].every(Number.isFinite) || positionErrorMm > 1 || directionError > .0001 || fovError > .001) throw new Error('GLB does not preserve browser coordinate or vertical lens conventions');
    return { positionErrorMm, directionError, fovErrorDegrees: fovError };
  };
  const firstCamera = inspectCamera('tour-camera', payload.cameraSamples[0]);
  const cameraPositionErrorMm = firstCamera.positionErrorMm, cameraDirectionError = firstCamera.directionError, fovErrorDegrees = firstCamera.fovErrorDegrees;
  const savedCameras = (payload.viewpoints || []).map(view => ({ id: view.id, ...inspectCamera(`viewpoint:${view.id}`, view, true) }));
  if (!Number.isFinite(maxPositionErrorMm) || maxPositionErrorMm > 1) {
    throw new Error('GLB does not preserve browser coordinate or vertical lens conventions');
  }
  return { passed: true, objectsChecked: payload.primitives.length, maxPositionErrorMm, cameraPositionErrorMm, cameraDirectionError, fovErrorDegrees,
    savedViewpointsChecked: savedCameras.length, savedCameras };
}

export async function findExecutable(name, explicit) {
  const candidates = explicit ? [explicit] : name === 'blender' ? [
    process.env.BLENDER_BIN,
    '/Applications/Blender.app/Contents/MacOS/Blender',
    path.join(homedir(), 'Applications/Blender.app/Contents/MacOS/Blender'),
    path.join(homedir(), '.cache/grihagrid/blender/Blender.app/Contents/MacOS/Blender'),
    ...(process.env.PATH || '').split(path.delimiter).map((directory) => path.join(directory, name)),
  ] : (process.env.PATH || '').split(path.delimiter).map((directory) => path.join(directory, name));
  for (const candidate of candidates.filter(Boolean)) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return path.resolve(candidate);
    } catch { /* Try the next explicit, conventional, or PATH candidate. */ }
  }
  throw new Error(`${name} executable unavailable. ${name === 'blender' ? 'Install Blender or pass --blender /absolute/path/to/Blender.' : 'Install ffmpeg to encode the rendered film frames.'}`);
}

export async function runProcess(executable, args, { timeoutMs, onLine = () => {}, cwd = root, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { const error = new Error('Render cancelled'); error.name = 'AbortError'; reject(error); return; }
    const child = spawn(executable, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    let pending = '';
    let timedOut = false;
    const abort = () => child.kill('SIGKILL');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs ?? 1800000);
    const receive = (chunk) => {
      const value = chunk.toString();
      tail = (tail + value).slice(-6000);
      pending += value;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop().slice(-6000);
      for (const line of lines) onLine(line);
    };
    child.stdout.on('data', receive);
    child.stderr.on('data', receive);
    child.on('error', (error) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (signal?.aborted) { const error = new Error('Render cancelled. Complete frames can be resumed.'); error.name = 'AbortError'; reject(error); }
      else if (timedOut) reject(new Error('Local render reached its timeout. Partial artifacts remain in its job directory.'));
      else if (code !== 0) reject(new Error(`Local process failed (${code}): ${tail}`));
      else resolve({ code, tail });
    });
  });
}

export async function verifyFrameSequence(output, count) {
  if (!Number.isInteger(count) || count < 1 || count > 3600) throw new Error('Invalid native frame count');
  for (let frame = 1; frame <= count; frame++) {
    const filename = path.join(output, 'frames', `frame-${String(frame).padStart(4, '0')}.png`);
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size < 45 || info.size > 32 * 1024 * 1024) throw new Error(`Frame ${frame} is not a bounded PNG`);
      const header = Buffer.alloc(24), tail = Buffer.alloc(12);
      const start = await handle.read(header, 0, 24, 0), end = await handle.read(tail, 0, 12, info.size - 12);
      if (start.bytesRead !== 24 || end.bytesRead !== 12 || !header.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
          header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR' || header.readUInt32BE(16) !== 1920 || header.readUInt32BE(20) !== 1080 ||
          !tail.equals(Buffer.from('0000000049454e44ae426082', 'hex'))) throw new Error(`Frame ${frame} is incomplete or is not native 1920×1080`);
    } finally { await handle.close(); }
  }
  return { count, width: 1920, height: 1080 };
}

export async function runJob(options) {
  if (options.resume) return resumeJob(options);
  // Validate before creating outputs or executing Blender.
  let model = createDemoBuilding();
  let suppliedTour;
  let suppliedViewpoints;
  if (options.input) {
    const input = path.resolve(options.input);
    const inputData = await readSceneInput(input);
    model = inputData.model || inputData;
    suppliedTour = inputData.model ? inputData.tour : undefined;
    suppliedViewpoints = inputData.model ? inputData.viewpoints : undefined;
  }
  const payload = serializeScene(model, options.duration, suppliedTour, suppliedViewpoints);
  const blender = await findExecutable('blender', options.blender);
  const ffmpeg = options.mode === 'film' ? await findExecutable('ffmpeg') : undefined;
  const output = options.output ? path.resolve(options.output) : path.join(root, 'output', `spatial-${Date.now()}`);
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length) throw new Error('Output directory must be empty; existing artifacts are never overwritten');
  const dataFile = path.join(output, 'scene-data.json');
  const jobFile = path.join(output, 'job.json');
  const job = { schemaVersion: 1, status: 'running', mode: options.mode, startedAt: new Date().toISOString(), sourceRevision: model.revision };
  await writeFile(dataFile, JSON.stringify(payload), { flag: 'wx' });
  await writeFile(path.join(output, 'building.json'), JSON.stringify(model, null, 2), { flag: 'wx' });
  await writeFile(jobFile, JSON.stringify(job, null, 2), { flag: 'wx' });
  await writeFile(path.join(output, 'render-config.json'), JSON.stringify({ mode: options.mode, engine: options.engine,
    device: options.device, samples: options.samples, timeout: options.timeout,
    sourceSha256: createHash('sha256').update(JSON.stringify(payload)).digest('hex') }), { flag: 'wx' });
  let lastFrameMessage = 0;
  const onLine = (line) => {
    if (line.startsWith('GRIHAGRID_PROGRESS ')) {
      try { options.onProgress?.(JSON.parse(line.slice('GRIHAGRID_PROGRESS '.length))); } catch { /* Ignore malformed subprocess telemetry. */ }
    }
    if (line.startsWith('GRIHAGRID_PROGRESS ')) process.stdout.write(`${line}\n`);
    else if (line.startsWith('Saved:') && Date.now() - lastFrameMessage > 10000) {
      lastFrameMessage = Date.now();
      process.stdout.write(`${line}\n`);
    }
  };
  try {
    await runProcess(blender, ['--background', '--factory-startup', '--disable-autoexec', '--threads', '4',
      '--python-exit-code', '1', '--python', path.join(scriptDirectory, 'render.py'), '--',
      '--scene-data', dataFile, '--output', output, '--mode', options.mode, '--samples', String(options.samples), '--device', options.device, '--engine', options.engine],
    { timeoutMs: options.timeout * 1000, onLine, signal: options.signal });
    const browserCoordinates = verifyGltfCoordinates(await readFile(path.join(output, 'house.glb')), payload);
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.browserCoordinates = browserCoordinates;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    if (ffmpeg) {
      process.stdout.write('GRIHAGRID_PROGRESS {"stage":"encoding"}\n');
      options.onProgress?.({ stage: 'encoding', frame: payload.cameraSamples.length, total: payload.cameraSamples.length });
      manifest.nativeFrameHeaders = await verifyFrameSequence(output, payload.cameraSamples.length);
      await runProcess(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-framerate', String(payload.fps), '-start_number', '1',
        '-i', path.join(output, 'frames', 'frame-%04d.png'), '-frames:v', String(payload.cameraSamples.length), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
        '-crf', '20', '-movflags', '+faststart', path.join(output, 'tour.mp4')], { timeoutMs: 300000, signal: options.signal });
      await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    }
    job.status = 'complete';
    job.completedAt = new Date().toISOString();
    await writeFile(jobFile, JSON.stringify(job, null, 2));
    process.stdout.write(`Local spatial artifacts: ${output}\n`);
    return { output, job };
  } catch (error) {
    job.status = error.name === 'AbortError' ? 'cancelled' : 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    await writeFile(jobFile, JSON.stringify(job, null, 2));
    throw error;
  }
}

export async function inspectResume(output) {
  const [configBytes, sourceBytes, proof, metadata] = await Promise.all([
    readFile(path.join(output, 'render-config.json')), readFile(path.join(output, 'scene-data.json')),
    readSceneInput(path.join(output, 'build-proof.json')), readSceneInput(path.join(output, 'job.json')),
  ]);
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const config = JSON.parse(configBytes);
  if (hash(configBytes) !== proof.recipeSha256 || hash(sourceBytes) !== proof.sourceSha256 ||
      hash(sourceBytes) !== config.sourceSha256 || hash(await readFile(path.join(output, 'house.blend'))) !== proof.blendSha256) {
    throw new Error('The original render files changed; create a new job instead of resuming.');
  }
  const payload = JSON.parse(sourceBytes);
  if (!['preview', 'film', 'scene'].includes(config.mode) || !['cycles', 'eevee'].includes(config.engine) ||
      !['auto', 'cpu'].includes(config.device) || !Number.isInteger(config.samples) || config.samples < 1 || config.samples > 128 ||
      !Number.isInteger(config.timeout) || config.timeout < 30 || config.timeout > 7200 || payload.fps !== 30 ||
      !Array.isArray(payload.cameraSamples) || payload.cameraSamples.length < 1 || payload.cameraSamples.length > 3600) throw new Error('Invalid original render configuration');
  if (proof.exportSha256) {
    const glb = await readFile(path.join(output, 'house.glb'));
    if (hash(glb) !== proof.exportSha256) throw new Error('The original GLB changed; create a new job.');
    await readSceneInput(path.join(output, 'manifest.json'));
    verifyGltfCoordinates(glb, payload);
  }
  return { config, payload, metadata };
}

export async function resumeJob(options) {
  const output = path.resolve(options.output);
  const { config, payload, metadata: job } = await inspectResume(output);
  if (!['failed', 'cancelled', 'running', 'interrupted'].includes(job.status)) throw new Error('Only interrupted or cancelled jobs can resume');
  const blender = await findExecutable('blender', options.blender);
  job.status = 'running'; job.resumedAt = new Date().toISOString();
  await writeFile(path.join(output, 'job.json'), JSON.stringify(job, null, 2));
  try {
    await runProcess(blender, ['--background', '--factory-startup', '--disable-autoexec', path.join(output, 'house.blend'), '--threads', '4', '--python-exit-code', '1', '--python', path.join(scriptDirectory, 'resume.py'), '--', '--output', output], {
      timeoutMs: Math.min(7200, config.timeout) * 1000, signal: options.signal,
      onLine(line) { if (line.startsWith('GRIHAGRID_PROGRESS ')) { try { options.onProgress?.(JSON.parse(line.slice(19))); } catch { /* Invalid telemetry is not progress. */ } } },
    });
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.browserCoordinates = verifyGltfCoordinates(await readFile(path.join(output, 'house.glb')), payload);
    if (config.mode === 'film') {
      options.onProgress?.({ stage: 'encoding', frame: payload.cameraSamples.length, total: payload.cameraSamples.length });
      manifest.nativeFrameHeaders = await verifyFrameSequence(output, payload.cameraSamples.length);
      const ffmpeg = await findExecutable('ffmpeg');
      const partial = path.join(output, `encoding-${Date.now()}.mp4`);
      await runProcess(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-framerate', String(payload.fps), '-i', path.join(output, 'frames', 'frame-%04d.png'), '-frames:v', String(payload.cameraSamples.length), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', partial], { timeoutMs: 300000, signal: options.signal });
      await rename(partial, path.join(output, 'tour.mp4'));
    }
    const resolutionScale = config.mode === 'preview' ? 0.33 : 1;
    manifest.render = { engine: config.engine === 'cycles' ? 'Cycles' : 'Eevee', samples: config.samples, mode: config.mode, resumed: true, durationSeconds: payload.cameraSamples.length / payload.fps, width: Math.floor(1920 * resolutionScale), height: Math.floor(1080 * resolutionScale), fps: payload.fps };
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    job.status = 'complete'; job.completedAt = new Date().toISOString(); delete job.error;
    await writeFile(path.join(output, 'job.json'), JSON.stringify(job, null, 2));
    return { output, job };
  } catch (error) {
    job.status = error.name === 'AbortError' ? 'cancelled' : 'failed'; job.error = error.message;
    await writeFile(path.join(output, 'job.json'), JSON.stringify(job, null, 2)); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runJob(parseArgs(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
