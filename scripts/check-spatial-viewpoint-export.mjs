import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { validateViewpoints } from '../src/spatial/viewpoints.js';
import { validateRenderRequest } from './spatial/service.mjs';
import { serializeScene, verifyGltfCoordinates } from './spatial/run.mjs';
import { buildPrimitives, toBrowser } from '../src/spatial/model.js';

const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Local preview only');
const output = new URL('../qa-artifacts/spatial-viewpoint-export/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(30000);
const errors = [], checks = [];
page.on('pageerror', () => errors.push('Browser page error'));
const download = async (label, name) => {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: label, exact: true }).click();
  const file = await event;
  const filename = new URL(name, output).pathname;
  await file.saveAs(filename);
  return readFile(filename);
};
let createdJobId, stage = 'verifying browser exports';
try {
  await page.goto(origin + '/explore');
  await page.locator('canvas[aria-label]').waitFor();
  await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
  const names = page.getByRole('textbox', { name: /^Name for viewpoint / });
  await names.first().fill('Earlier concept overview');
  await page.getByRole('button', { name: '2D Plan', exact: true }).click();
  await page.getByRole('button', { name: 'Study a two-floor example', exact: true }).click();
  await page.getByRole('button', { name: 'Review Change Study', exact: true }).click();
  await page.getByRole('button', { name: 'Accept concept revision', exact: true }).click();
  await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click();
  await page.getByRole('button', { name: '3D Explore', exact: true }).click();
  await page.getByRole('combobox', { name: 'Active floor', exact: true }).selectOption({ index: 1 });
  await page.locator('.sp-room-list button').first().click();
  await page.waitForTimeout(600); // Allow the documented room fade to finish before saving its pose.
  await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
  await names.nth(1).fill('ऊपरी कमरा — upper room');
  await page.getByRole('button', { name: 'Reset overview', exact: true }).click();
  await page.waitForTimeout(600); // Save the completed overview pose after its fade.
  await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
  await names.nth(2).fill('Whole house overview');
  assert.equal(await page.getByRole('button', { name: 'Go to Earlier concept overview', exact: true }).isDisabled(), true);

  const library = JSON.parse(await download('Download camera library', 'camera-library.json'));
  assert.equal(library.viewpoints.length, 3);
  assert.equal(library.viewpoints[0].name, 'Earlier concept overview');
  await page.getByRole('button', { name: 'Render / Export', exact: true }).click();
  await page.getByText('1 older viewpoint remains in your library.', { exact: false }).waitFor();
  const scene = JSON.parse(await download('Download scene JSON', 'scene.json'));
  assert.equal(scene.viewpoints.length, 2);
  assert.ok(validateViewpoints(scene.viewpoints, scene.model));
  assert.ok(Math.hypot(...scene.viewpoints[0].position.map((value, i) => value - scene.viewpoints[1].position[i])) > 1000, 'Room and overview cameras must be distinct');
  assert.deepEqual(scene.viewpoints.map(view => view.id), library.viewpoints.slice(1).map(view => view.id));
  checks.push('Scene export keeps both current cameras; full library download retains the older pose with a visible exclusion notice.');

  const glb = await download('Download GLB', 'house.glb');
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  const gltf = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
  const cameraNodes = gltf.nodes.filter(node => node.extras?.category === 'viewpoint');
  assert.equal(cameraNodes.length, 2);
  const worldMatrices = new Map();
  const visit = (index, parent) => {
    const node = gltf.nodes[index];
    const local = node.matrix ? new Matrix4().fromArray(node.matrix) : new Matrix4().compose(new Vector3(...(node.translation || [0, 0, 0])), new Quaternion(...(node.rotation || [0, 0, 0, 1])), new Vector3(...(node.scale || [1, 1, 1])));
    const world = parent.clone().multiply(local);
    worldMatrices.set(node, world);
    for (const child of node.children || []) visit(child, world);
  };
  for (const index of gltf.scenes[gltf.scene || 0].nodes) visit(index, new Matrix4());
  for (const primitive of buildPrimitives(scene.model)) {
    const node = gltf.nodes.find(item => item.extras?.id === primitive.id);
    assert.ok(node, `Exported geometry ${primitive.id} exists`);
    for (const key of ['roomId', 'floorId', 'stairId', 'wallId', 'openingId']) assert.equal(node.extras[key] ?? null, primitive[key] ?? null);
  }
  const cameraChecks = [];
  for (const view of scene.viewpoints) {
    const node = cameraNodes.find(item => item.extras.id === `viewpoint:${view.id}`);
    assert.ok(node);
    assert.equal(node.name, view.name);
    assert.equal(node.extras.viewpointName, view.name);
    assert.equal(node.extras.viewpointId, view.id);
    assert.equal(node.extras.floorId, view.floorId);
    assert.equal(node.extras.buildingId, scene.model.id);
    assert.equal(node.extras.sourceRevision, scene.model.revision);
    const position = toBrowser(view.position), target = toBrowser(view.target);
    const world = worldMatrices.get(node);
    const actualPosition = new Vector3().setFromMatrixPosition(world).toArray();
    const positionError = Math.hypot(...position.map((value, i) => value - actualPosition[i]));
    assert.ok(positionError < 0.000001);
    const actualDirection = new Vector3(0, 0, -1).transformDirection(world).toArray();
    const distance = Math.hypot(...position.map((value, i) => target[i] - value));
    const directionError = Math.hypot(...actualDirection.map((value, i) => value - (target[i] - position[i]) / distance));
    assert.ok(directionError < 0.000001);
    const fovError = Math.abs(gltf.cameras[node.camera].perspective.yfov * 180 / Math.PI - view.fov);
    assert.ok(fovError < 0.000001);
    cameraChecks.push({ id: view.id, floorId: view.floorId, positionErrorMetres: positionError, directionError, verticalFovErrorDegrees: fovError });
  }
  checks.push('Actual browser GLB preserves named upper-floor/overview cameras, Unicode names, canonical axes, pose, vertical lens and stable revision/ID metadata.');

  const pairFile = process.env.SPATIAL_PAIR_FILE;
  let render = { verified: false, reason: 'No pairing file supplied; browser export checks only.' };
  if (pairFile) {
    stage = 'pairing';
    await page.getByLabel('Pairing code', { exact: true }).fill((await readFile(pairFile, 'utf8')).trim());
    await page.getByRole('button', { name: 'Connect renderer', exact: true }).click();
    await page.getByRole('button', { name: 'Render previews', exact: true }).waitFor();
    stage = 'verifying native export';
    const responseEvent = page.waitForResponse(response => response.url() === 'http://127.0.0.1:43127/jobs' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Render previews', exact: true }).click();
    const response = await responseEvent;
    assert.equal(response.status(), 201);
    const submitted = response.request().postDataJSON();
    assert.deepEqual(submitted.viewpoints, scene.viewpoints);
    assert.deepEqual(validateRenderRequest(submitted).scene.viewpoints, scene.viewpoints);
    createdJobId = (await response.json()).job.id;
    const card = page.locator(`[data-render-job-id="${createdJobId}"]`);
    await card.getByRole('button', { name: 'Blender scene', exact: true }).waitFor({ timeout: 180000 });
    const renderedEvent = page.waitForEvent('download');
    await card.getByRole('button', { name: '3D model', exact: true }).click();
    const renderedDownload = await renderedEvent;
    const renderedPath = new URL('rendered-house.glb', output).pathname;
    await renderedDownload.saveAs(renderedPath);
    const renderedBytes = await readFile(renderedPath);
    const renderedGltf = JSON.parse(renderedBytes.subarray(20, 20 + renderedBytes.readUInt32LE(12)).toString('utf8'));
    const renderedIds = renderedGltf.nodes.filter(node => node.extras?.viewpointId).map(node => node.extras.viewpointId).sort();
    assert.deepEqual(renderedIds, scene.viewpoints.map(view => view.id).sort());
    const nativeCoordinates = verifyGltfCoordinates(renderedBytes, serializeScene(scene.model, scene.tour.duration, scene.tour, scene.viewpoints));
    render = { verified: true, jobId: createdJobId, actualPreviewComplete: true, savedCameraIds: renderedIds, nativeCoordinates, glbSha256: createHash('sha256').update(renderedBytes).digest('hex') };
    checks.push('The real app request carries only current cameras; its native Cycles preview completes and the authenticated downloaded Blender GLB retains both cameras.');
    await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.screenshot({ path: new URL('camera-export-mobile.png', output).pathname, fullPage: true });
  assert.deepEqual(errors, []);
  const sourceHashes = {};
  for (const file of ['src/spatial/SpatialWorkspace.jsx', 'src/spatial/RenderPanel.jsx', 'src/spatial/WorldCanvas.jsx', 'src/spatial/viewpoints.js', 'scripts/spatial/run.mjs', 'scripts/spatial/service.mjs', 'scripts/spatial/cameras.py', 'scripts/spatial/render.py']) {
    sourceHashes[file] = createHash('sha256').update(await readFile(new URL('../' + file, import.meta.url))).digest('hex');
  }
  const report = { completedAt: new Date().toISOString(), scope: 'Chrome desktop and 390px emulation, not physical-device or VoiceOver testing', origin, checks, cameraChecks, render, errors, sourceHashes };
  await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: true, checks: checks.length, renderVerified: render.verified, errors: errors.length, createdJobId }));
} catch (error) {
  // Playwright fill errors can contain the private pairing code in call logs.
  if (stage !== 'pairing') await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  const errorType = ['AssertionError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error';
  throw new Error(`Viewpoint export verification failed during ${stage} (${errorType}); private diagnostics withheld.`);
} finally {
  await browser.close();
}
