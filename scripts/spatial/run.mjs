#!/usr/bin/env node
/** Local-only Blender job runner. No shell, uploaded code, or cloud credentials. */
import { access, mkdir, open, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPrimitives, createDemoBuilding, validateBuilding } from '../../src/spatial/model.js';
import { generateTour, sampleTour, validateTour } from '../../src/spatial/tours.js';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDirectory, '../..');
const MAX_INPUT_BYTES = 2 * 1024 * 1024;

export async function readSceneInput(inputPath) {
  // NONBLOCK lets us reject a FIFO by descriptor without waiting for a writer.
  const handle = await open(inputPath, constants.O_RDONLY | constants.O_NONBLOCK);
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

export function serializeScene(model, duration = 24, suppliedTour) {
  const validation = validateBuilding(model);
  if (!validation.valid) throw new Error(`Invalid building: ${JSON.stringify(validation.errors)}`);
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
  return { schemaVersion: 1, sourceRevision: model.revision, primitives, rooms: model.rooms, fps, cameraSamples, tour };
}

export function verifyGltfCoordinates(buffer, payload) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(16) !== 0x4e4f534a) {
    throw new Error('Blender did not produce a supported binary glTF');
  }
  const json = JSON.parse(buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString('utf8'));
  const nodes = new Map((json.nodes || []).map(node => [node.extras?.id, node]));
  const toGltf = ([x, y, z]) => [x / 1000, z / 1000, -y / 1000];
  const distance = (a, b) => Math.hypot(...a.map((value, i) => value - b[i]));
  let maxPositionErrorMm = 0;
  for (const primitive of payload.primitives) {
    const node = nodes.get(primitive.id);
    if (!node || node.matrix || node.extras.roomId !== primitive.roomId) throw new Error(`GLB node contract failed for ${primitive.id}`);
    maxPositionErrorMm = Math.max(maxPositionErrorMm, distance(node.translation || [0, 0, 0], toGltf(primitive.position)) * 1000);
  }
  const cameraNode = nodes.get('tour-camera');
  if (!cameraNode || cameraNode.matrix) throw new Error('Missing GLB camera transform');
  const first = payload.cameraSamples[0];
  const cameraPositionErrorMm = distance(cameraNode.translation || [0, 0, 0], toGltf(first.position)) * 1000;
  const expectedPosition = toGltf(first.position), target = toGltf(first.target);
  const length = distance(expectedPosition, target);
  const expectedDirection = target.map((v, i) => (v - expectedPosition[i]) / length);
  const [x, y, z, w] = cameraNode.rotation || [0, 0, 0, 1];
  const actualDirection = [-2 * (x * z + w * y), -2 * (y * z - w * x), -(1 - 2 * (x * x + y * y))];
  const cameraDirectionError = distance(expectedDirection, actualDirection);
  const yfov = json.cameras?.[cameraNode.camera]?.perspective?.yfov;
  const fovErrorDegrees = Math.abs(yfov * 180 / Math.PI - first.fov);
  if (!Number.isFinite(fovErrorDegrees) || maxPositionErrorMm > 1 || cameraPositionErrorMm > 1 || cameraDirectionError > .0001 || fovErrorDegrees > .001) {
    throw new Error('GLB does not preserve browser coordinate or vertical lens conventions');
  }
  return { passed: true, objectsChecked: payload.primitives.length, maxPositionErrorMm, cameraPositionErrorMm, cameraDirectionError, fovErrorDegrees };
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

export async function runProcess(executable, args, { timeoutMs, onLine = () => {}, cwd = root } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    let pending = '';
    let timedOut = false;
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
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Local render reached its timeout. Partial artifacts remain in its job directory.'));
      else if (code !== 0) reject(new Error(`Local process failed (${code}): ${tail}`));
      else resolve({ code, tail });
    });
  });
}

export async function runJob(options) {
  // Validate before creating outputs or executing Blender.
  let model = createDemoBuilding();
  let suppliedTour;
  if (options.input) {
    const input = path.resolve(options.input);
    const inputData = await readSceneInput(input);
    model = inputData.model || inputData;
    suppliedTour = inputData.model ? inputData.tour : undefined;
  }
  const payload = serializeScene(model, options.duration, suppliedTour);
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
  let lastFrameMessage = 0;
  const onLine = (line) => {
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
    { timeoutMs: options.timeout * 1000, onLine });
    const browserCoordinates = verifyGltfCoordinates(await readFile(path.join(output, 'house.glb')), payload);
    const manifestPath = path.join(output, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.browserCoordinates = browserCoordinates;
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    if (ffmpeg) {
      process.stdout.write('GRIHAGRID_PROGRESS {"stage":"encoding"}\n');
      await runProcess(ffmpeg, ['-nostdin', '-v', 'error', '-xerror', '-framerate', String(payload.fps), '-start_number', '1',
        '-i', path.join(output, 'frames', 'frame-%04d.png'), '-c:v', 'libx264', '-threads', '2', '-pix_fmt', 'yuv420p',
        '-crf', '20', '-movflags', '+faststart', path.join(output, 'tour.mp4')], { timeoutMs: 300000 });
    }
    job.status = 'complete';
    job.completedAt = new Date().toISOString();
    await writeFile(jobFile, JSON.stringify(job, null, 2));
    process.stdout.write(`Local spatial artifacts: ${output}\n`);
    return { output, job };
  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    job.completedAt = new Date().toISOString();
    await writeFile(jobFile, JSON.stringify(job, null, 2));
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await runJob(parseArgs(process.argv.slice(2))); }
  catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }
}
