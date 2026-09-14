import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDemoBuilding, createMultiFloorDemo, buildPrimitives } from '../src/spatial/model.js';
import { generateTour } from '../src/spatial/tours.js';
import { parseArgs, serializeScene, runJob, runProcess, verifyGltfCoordinates, readSceneInput, verifyFrameSequence } from '../scripts/spatial/run.mjs';

test('scene input preserves a UTF-8 model/tour bundle at the exact byte limit', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-spatial-input-'));
  try {
    const model = createDemoBuilding();
    const bundle = { model, tour: { ...serializeScene(model, 24).tour, name: 'Kitchen → courtyard' } };
    const inputPath = path.join(directory, 'scene.json');
    const buffer = Buffer.alloc(2 * 1024 * 1024, 0x20);
    Buffer.from(JSON.stringify(bundle)).copy(buffer);
    await writeFile(inputPath, buffer);
    assert.deepEqual(await readSceneInput(inputPath), bundle);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scene input rejects even one byte over the limit before starting Blender', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-spatial-input-'));
  try {
    const inputPath = path.join(directory, 'large.json');
    const buffer = Buffer.alloc(2 * 1024 * 1024 + 1, 0x20);
    buffer.write('{}');
    await writeFile(inputPath, buffer);
    await assert.rejects(readSceneInput(inputPath), /exceeds 2 MiB/);
    await assert.rejects(runJob({ ...parseArgs(['--mode', 'scene']), input: inputPath, blender: '/unavailable/blender' }), /exceeds 2 MiB/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('scene input rejects nonregular files and malformed UTF-8', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-spatial-input-'));
  try {
    await assert.rejects(readSceneInput(directory), /regular file|EISDIR/);
    if (process.platform !== 'win32') await assert.rejects(readSceneInput('/dev/null'), /regular file/);
    const inputPath = path.join(directory, 'malformed.json');
    await writeFile(inputPath, Buffer.from([0x22, 0xff, 0x22]));
    await assert.rejects(readSceneInput(inputPath), /encoded data|encoding/i);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local rendering bounds duration, samples, timeout and accepted operations', () => {
  assert.equal(parseArgs(['--mode', 'film', '--samples', '4']).mode, 'film');
  for (const args of [['--mode', 'shell'], ['--samples', '0'], ['--samples', '129'], ['--duration', 'NaN'], ['--duration', '121'], ['--timeout', '7201'], ['--python', 'untrusted.py']]) {
    assert.throws(() => parseArgs(args));
  }
});

test('Blender serialization preserves shared geometry and each sampled camera frame', () => {
  const model = createDemoBuilding();
  const payload = serializeScene(model, 24);
  assert.deepEqual(payload.primitives, buildPrimitives(model));
  assert.equal(payload.sourceRevision, model.revision);
  assert.equal(payload.fps, 30);
  assert.equal(payload.cameraSamples.length, 720);
  assert.ok(payload.cameraSamples.every(sample => sample.position.length === 3 && sample.target.length === 3));
  assert.ok(payload.primitives.some(item => item.category === 'roof'));
  assert.throws(() => serializeScene({ ...model, revision: -1 }), /Invalid building/);
});

test('multi-floor serialization preserves triangle slabs, stair identifiers and camera elevation', () => {
  const model = createMultiFloorDemo();
  const tour = generateTour(model, { roomIds: ['ground-gallery', 'upper-gallery'], duration: 8, includeExterior: false });
  const payload = serializeScene(model, 8, tour);
  const slabs = payload.primitives.filter(item => item.kind === 'mesh');
  assert.ok(slabs.length >= 4);
  assert.ok(slabs.every(item => item.vertices.length > 0 && item.indices.length % 3 === 0));
  assert.ok(payload.primitives.some(item => item.stairId === 'gallery-stair'));
  assert.deepEqual(new Set(payload.primitives.map(item => item.floorId)), new Set(['ground', 'upper']));
  assert.ok(payload.cameraSamples.some(sample => sample.position[2] > 4000));
  assert.ok(payload.cameraSamples.some(sample => sample.position[2] < 2000));
});

test('local job refuses to overwrite an existing output directory', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-spatial-test-'));
  try {
    await writeFile(path.join(directory, 'keep.txt'), 'untouched');
    await assert.rejects(runJob({ ...parseArgs(['--mode', 'scene']), output: directory, blender: process.execPath }), /must be empty/);
    assert.equal(await readFile(path.join(directory, 'keep.txt'), 'utf8'), 'untouched');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent local jobs cannot overwrite each other’s initial scene records', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-spatial-race-'));
  try {
    const models = [createDemoBuilding(), { ...createDemoBuilding(), revision: 2 }];
    const inputs = models.map((_, index) => path.join(directory, `input-${index}.json`));
    await Promise.all(inputs.map((input, index) => writeFile(input, JSON.stringify(models[index]))));
    const output = path.join(directory, 'job');
    const results = await Promise.allSettled(inputs.map(input => runJob({ ...parseArgs(['--mode', 'scene']), input, output, blender: process.execPath })));
    // Node is intentionally used as an invalid Blender binary: only the winning
    // job may reach it, and no real Blender process is needed for this race.
    assert.equal(results.filter(result => result.status === 'rejected' && /must be empty|EEXIST/.test(result.reason.message)).length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && /Local process failed/.test(result.reason.message)).length, 1);
    const [model, scene, job] = await Promise.all(['building.json', 'scene-data.json', 'job.json'].map(async name => JSON.parse(await readFile(path.join(output, name), 'utf8'))));
    assert.equal(model.revision, scene.sourceRevision);
    assert.equal(model.revision, job.sourceRevision);
    assert.deepEqual(model, models[model.revision - 1]);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('local process forwards literal arguments and enforces its timeout', async () => {
  const literal = '$(touch SHOULD_NOT_EXIST); `echo unsafe`';
  const result = await runProcess(process.execPath, ['-e', 'console.log(process.argv[1])', literal], { timeoutMs: 5000 });
  assert.equal(result.tail.trim(), literal);
  await assert.rejects(runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 40 }), /timeout/);
});

test('film encoding requires every expected native frame, rejecting truncation or preview dimensions', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-native-frame-check-'));
  try {
    await mkdir(path.join(directory, 'frames'));
    const frame = Buffer.alloc(45); Buffer.from('89504e470d0a1a0a', 'hex').copy(frame);
    frame.writeUInt32BE(13, 8); frame.write('IHDR', 12); frame.writeUInt32BE(1920, 16); frame.writeUInt32BE(1080, 20);
    Buffer.from('0000000049454e44ae426082', 'hex').copy(frame, frame.length - 12);
    const filename = path.join(directory, 'frames/frame-0001.png'); await writeFile(filename, frame);
    assert.deepEqual(await verifyFrameSequence(directory, 1), { count: 1, width: 1920, height: 1080 });
    await assert.rejects(verifyFrameSequence(directory, 2), { code: 'ENOENT' });
    frame.writeUInt32BE(633, 16); await writeFile(filename, frame);
    await assert.rejects(verifyFrameSequence(directory, 1), /native/);
    await writeFile(filename, frame.subarray(0, 40)); await assert.rejects(verifyFrameSequence(directory, 1), /bounded PNG/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('losing the service IPC connection terminates its renderer subprocess', { skip: process.platform === 'win32', timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'grihagrid-worker-disconnect-'));
  let worker, rendererPid;
  try {
    const input = path.join(directory, 'input.json'), output = path.join(directory, 'job'), pidFile = path.join(directory, 'renderer.pid');
    const executable = path.join(directory, 'fake-blender.mjs');
    await writeFile(input, JSON.stringify(createDemoBuilding()));
    await writeFile(executable, `#!/usr/bin/env node\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(pidFile)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`);
    await chmod(executable, 0o700);
    worker = spawn(process.execPath, [fileURLToPath(new URL('../scripts/spatial/worker.mjs', import.meta.url))], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const closed = new Promise((resolve, reject) => { worker.once('exit', resolve); worker.once('error', reject); });
    worker.send({ options: { ...parseArgs(['--mode', 'scene', '--duration', '8']), input, output, blender: executable } });
    for (let attempt = 0; attempt < 300; attempt++) {
      rendererPid = await readFile(pidFile, 'utf8').then(Number, () => null);
      if (rendererPid) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert(rendererPid, 'the renderer subprocess started');
    worker.disconnect(); await closed;
    assert.throws(() => process.kill(rendererPid, 0), { code: 'ESRCH' });
    rendererPid = null;
    assert.equal(JSON.parse(await readFile(path.join(output, 'job.json'))).status, 'cancelled');
  } finally {
    if (worker && worker.exitCode === null) worker.kill('SIGKILL');
    if (rendererPid) { try { process.kill(rendererPid, 'SIGKILL'); } catch { /* Already terminated. */ } }
    await rm(directory, { recursive: true, force: true });
  }
});

test('GLB inspection detects axis, scale, vertical lens and direction mistakes', () => {
  const payload = { primitives: [{ id: 'floor', roomId: 'living', position: [1000, 2000, 500] }],
    cameraSamples: [{ position: [0, 0, 1650], target: [0, 1000, 1650], fov: 60 }] };
  const document = { nodes: [
    { extras: { id: 'floor', roomId: 'living' }, translation: [1, .5, -2] },
    { extras: { id: 'tour-camera' }, camera: 0, translation: [0, 1.65, 0] },
  ], cameras: [{ perspective: { yfov: Math.PI / 3 } }] };
  const binary = (data) => {
    const json = Buffer.from(JSON.stringify(data));
    const header = Buffer.alloc(20);
    header.write('glTF'); header.writeUInt32LE(2, 4); header.writeUInt32LE(json.length + 20, 8);
    header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    return Buffer.concat([header, json]);
  };
  assert.equal(verifyGltfCoordinates(binary(document), payload).passed, true);
  document.nodes[0].translation = [1, 2, .5];
  assert.throws(() => verifyGltfCoordinates(binary(document), payload), /coordinate/);
  document.nodes[0].translation = [1, .5, -2];
  document.cameras[0].perspective.yfov = 1.5;
  assert.throws(() => verifyGltfCoordinates(binary(document), payload), /lens/);
  assert.throws(() => verifyGltfCoordinates(Buffer.from('wrong'), payload), /glTF/);
});
