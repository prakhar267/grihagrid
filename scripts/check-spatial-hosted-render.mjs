import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';

// An actual configured app -> paired local Blender journey. No cloud account
// or project is created; the public sample creates one local preview job.
const config = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
const configured = [...config.matchAll(/^APP_ORIGIN = "([^"]+)"$/gm)].map(match => match[1]);
const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
assert.ok(configured.includes(origin) || origin === 'http://127.0.0.1:5277', 'Use a configured app origin.');
const pairFile = process.env.SPATIAL_PAIR_FILE;
assert.ok(pairFile, 'Provide only the private pairing-file path, never its contents.');
const hosted = new URL(origin).protocol === 'https:';
if (hosted) assert.match(process.env.EXPECT_RELEASE_ID || '', /^[0-9a-f-]{36}$/);
const output = new URL(`../qa-artifacts/spatial-release/render-${new URL(origin).hostname}/`, import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
// Exercise the browser's supported local-network permission, without disabling
// web security, the app CSP or the service's exact-origin and pairing checks.
await context.grantPermissions(['local-network-access'], { origin });
const page = await context.newPage(), errors = [], failedRequests = [];
page.setDefaultTimeout(30000);
page.on('pageerror', () => errors.push('Browser page error'));
page.on('requestfailed', request => failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
let id, stage = 'opening app';
try {
  await page.goto(origin + '/explore');
  await page.locator('canvas[aria-label]').waitFor();
  const readiness = await (await context.request.get(origin + '/api/readiness')).json();
  if (hosted) assert.equal(readiness.releaseId, process.env.EXPECT_RELEASE_ID);
  assert.equal(readiness.checks.spatialSchema, 'current');
  assert.equal(readiness.capabilities.spatialStudio, true);
  await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
  await page.getByRole('textbox', { name: /^Name for viewpoint / }).first().fill('Release preview overview');
  await page.getByRole('button', { name: 'Render / Export', exact: true }).click();
  const setup = await page.locator('.render-panel details code').textContent();
  assert.ok(setup.includes(origin) && setup.endsWith('npm run spatial:service'));
  stage = 'pairing';
  await page.getByLabel('Pairing code', { exact: true }).fill((await readFile(pairFile, 'utf8')).trim());
  await page.getByRole('button', { name: 'Connect renderer', exact: true }).click();
  await page.getByRole('button', { name: 'Render previews', exact: true }).waitFor();
  stage = 'submitting preview';
  const created = page.waitForResponse(response => response.url() === 'http://127.0.0.1:43127/jobs' && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Render previews', exact: true }).click();
  const response = await created;
  assert.equal(response.status(), 201);
  id = (await response.json()).job.id;
  assert.match(id, /^[0-9a-f-]{36}$/);
  const job = page.locator(`[data-render-job-id="${id}"]`);
  stage = 'rendering preview';
  await job.getByRole('button', { name: 'Blender scene', exact: true }).waitFor({ timeout: 180000 });
  await job.getByRole('button', { name: 'View preview', exact: true }).click();
  const preview = page.locator('.render-media img');
  await preview.waitFor();
  await preview.evaluate(image => image.decode());
  const dimensions = await preview.evaluate(image => ({ width: image.naturalWidth, height: image.naturalHeight }));
  assert.ok(dimensions.width >= 600 && dimensions.height >= 350);
  stage = 'verifying download';
  const downloaded = page.waitForEvent('download');
  await job.getByRole('button', { name: '3D model', exact: true }).click();
  const glbPath = new URL('house.glb', output).pathname;
  await (await downloaded).saveAs(glbPath);
  const bytes = await readFile(glbPath);
  assert.equal(bytes.toString('ascii', 0, 4), 'glTF');
  const json = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.ok(json.nodes.some(node => node.extras?.viewpointName === 'Release preview overview'));
  await page.screenshot({ path: new URL('render-complete.png', output).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Disconnect', exact: true }).click();
  assert.deepEqual(errors, []);
  assert.deepEqual(failedRequests, []);
  const report = { origin, releaseId: readiness.releaseId, browser: browser.version(), checkedAt: new Date().toISOString(),
    scope: 'Real Chrome with supported local-network permission granted; configured app CSP, origin-bound pairing and native Cycles renderer.',
    jobId: id, complete: true, savedCameraInNativeGlb: true, preview: dimensions,
    glbSha256: createHash('sha256').update(bytes).digest('hex'), errors, failedRequests };
  await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} catch (error) {
  // Playwright errors can include fill("private code") in their call log.
  // Never print the original message, stack or cause, or capture failed pairing.
  if (stage !== 'pairing') await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true }).catch(() => {});
  const errorType = ['AssertionError', 'TimeoutError'].includes(error?.name) ? error.name : 'Error';
  await writeFile(new URL('failure.json', output), JSON.stringify({ origin, stage, errorType, errors, failedRequests }, null, 2));
  throw new Error(`Spatial render verification failed during ${stage} (${errorType}); private diagnostics withheld.`);
} finally { await browser.close(); }
