import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';

// Real local Worker data and renderer pairing; delete only this run's synthetic account/project.
const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));
const privateOrigin = process.env.SPATIAL_PRIVATE_ORIGIN || 'http://127.0.0.1:8790';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(privateOrigin).hostname));
const pairFile = process.env.SPATIAL_PAIR_FILE;
assert.ok(pairFile, 'Supply the private pairing file path, never its contents.');
const output = new URL('../qa-artifacts/spatial-print-archive/', import.meta.url);
await mkdir(output, { recursive: true });
const profile = await mkdtemp(path.join(os.tmpdir(), 'grihagrid-print-archive-'));
const context = await chromium.launchPersistentContext(profile, { channel: 'chrome', headless: true, viewport: { width: 1440, height: 1080 } });
const page = await context.newPage(), errors = [], checks = [], password = `${randomUUID()}Aa1!`;
let projectId, accountCreated = false, paired = false;
const evidence = { origin, privateOrigin, browser: 'Actual Chrome with an isolated temporary profile', checks, errors };
page.setDefaultTimeout(30000);
page.on('pageerror', error => errors.push(error.message));
const checkpoint = message => console.log(message);
const api = (pathname, method = 'GET', body) => page.evaluate(async ({ pathname, method, body }) => {
  const csrf = decodeURIComponent(document.cookie.split('; ').find(value => value.startsWith('grihagrid_csrf='))?.split('=').slice(1).join('=') || '');
  const response = await fetch(pathname, { method, headers: { 'content-type': 'application/json', 'x-csrf-token': csrf, 'idempotency-key': crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const text = await response.text();
  return { status: response.status, data: text ? JSON.parse(text) : null };
}, { pathname, method, body });
const disabled = async locator => assert.equal(await locator.isDisabled(), true);
try {
  await page.goto(`${origin}/explore`);
  await page.getByRole('button', { name: '2D Plan', exact: true }).click();
  await page.locator('.le-plan-stage svg').waitFor();
  await page.setViewportSize({ width: 794, height: 1123 });
  await page.emulateMedia({ media: 'print' });
  evidence.print = await page.evaluate(() => ({
    visibleControls: [...document.querySelectorAll('button,input,select,textarea,summary')].filter(element => element.checkVisibility()).map(element => element.textContent),
    roomLabels: [...document.querySelectorAll('.le-plan-stage svg g[role=button]>text')].map(element => element.textContent),
    plan: document.querySelector('.le-plan-stage svg').getBoundingClientRect().toJSON(),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
  }));
  assert.deepEqual(evidence.print.visibleControls, []);
  assert.equal(evidence.print.horizontalOverflow, false);
  assert.equal(evidence.print.roomLabels.length, 8);
  await page.pdf({ path: new URL('concept-a4.pdf', output).pathname, preferCSSPageSize: true, printBackground: true });
  await page.screenshot({ path: new URL('print-a4-media.png', output).pathname, fullPage: true });
  checks.push('Chrome print media retains all eight room labels and hides editor/import/scaling controls; actual A4 PDF generated.');
  await page.emulateMedia({ media: 'screen' });
  await page.setViewportSize({ width: 1440, height: 1080 });
  const beforeZoom = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, scale: visualViewport.scale }));
  const settings = await context.newPage();
  await settings.goto('chrome://settings/appearance');
  await settings.locator('#zoomLevel').selectOption('2');
  await page.bringToFront();
  await page.waitForFunction(() => innerWidth === 720 && devicePixelRatio === 2);
  const afterZoom = await page.evaluate(() => ({ width: innerWidth, dpr: devicePixelRatio, scale: visualViewport.scale, scroll: document.documentElement.scrollWidth }));
  assert.equal(afterZoom.scale, 1, 'Browser zoom, not pinch magnification.');
  assert.equal(afterZoom.scroll, afterZoom.width);
  const planTab = page.getByRole('button', { name: '2D Plan', exact: true });
  await planTab.focus(); await planTab.press('Enter');
  assert.equal(await planTab.evaluate(element => element === document.activeElement), true);
  // Browser zoom changes Chrome's native-pixel capture coordinates independently of
  // Playwright's configured scale factor; use native content bounds to avoid a half-width crop.
  const cdp = await context.newCDPSession(page);
  const metrics = await cdp.send('Page.getLayoutMetrics');
  const captured = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: true, clip: { ...metrics.contentSize, scale: 1 } });
  const zoomImage = Buffer.from(captured.data, 'base64');
  assert.equal(zoomImage.readUInt32BE(16), beforeZoom.width);
  await writeFile(new URL('actual-200-percent-zoom.png', output), zoomImage);
  await cdp.detach();
  evidence.zoom = { chromeSettingsValue: await settings.locator('#zoomLevel').inputValue(), before: beforeZoom, after: afterZoom, keyboardFocusRetained: true, screenshot: { width: zoomImage.readUInt32BE(16), height: zoomImage.readUInt32BE(20), nativeCapture: true } };
  checks.push('Chrome Settings page zoom set to 200%: DPR doubled, CSS viewport halved, no overflow, keyboard focus retained.');
  await settings.locator('#zoomLevel').selectOption('1'); await settings.close();
  await page.waitForFunction(() => innerWidth === 1440 && devicePixelRatio === 1);
  checkpoint('Print and actual 200% browser zoom verified.');

  await page.goto(`${privateOrigin}/explore`);
  const auth = await api('/api/auth/register', 'POST', { name: 'Spatial archive verification', email: `spatial-archive-${randomUUID()}@example.test`, password });
  assert.equal(auth.status, 201); accountCreated = true;
  const created = await api('/api/projects', 'POST', { name: 'Archived spatial QA', input: { width: 40, length: 50, city: 'Pune', quality: 'Signature', floors: 'G', bedrooms: 2 } });
  assert.equal(created.status, 201); projectId = created.data.project.id;
  await page.goto(`${privateOrigin}/projects/${projectId}/spatial`);
  await page.getByRole('button', { name: 'Review Change Study', exact: true }).click();
  await page.getByRole('button', { name: 'Accept concept revision', exact: true }).click();
  await page.getByText('Concept revision accepted. Rebuild the tour to use the updated layout.').waitFor();
  await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
  await page.getByText('Camera library saved privately.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
  await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click();
  await page.getByRole('button', { name: 'Save tour revision', exact: true }).click();
  await page.getByText('A separate camera-tour revision has been saved.').waitFor();
  const saved = (await api(`/api/projects/${projectId}/spatial`)).data;
  assert.equal((await api(`/api/projects/${projectId}`, 'PATCH', { status: 'archived' })).status, 200);
  await page.reload();
  await page.getByText('Archived · read only', { exact: true }).waitFor();
  const mutations = [];
  const observe = request => { if (request.url().includes(`/api/projects/${projectId}`) && !['GET', 'HEAD'].includes(request.method()) || request.url() === 'http://127.0.0.1:43127/jobs' && request.method() === 'POST') mutations.push({ method: request.method(), pathname: new URL(request.url()).pathname }); };
  page.on('request', observe);
  await disabled(page.getByRole('button', { name: 'Save viewpoint', exact: true }));
  await disabled(page.getByRole('textbox', { name: /Name for viewpoint/ }));
  await disabled(page.getByRole('button', { name: 'Delete View 1', exact: true }));
  await page.getByRole('button', { name: '2D Plan', exact: true }).click();
  await disabled(page.getByRole('button', { name: 'Import a drawing or floor plan', exact: true }));
  await disabled(page.getByRole('button', { name: 'Draw room', exact: true }));
  await disabled(page.getByRole('button', { name: 'Add floor', exact: true }));
  const planRoom = page.getByRole('button', { name: 'Edit Living room', exact: true });
  await planRoom.focus(); await planRoom.press('ArrowRight');
  assert.equal(await page.getByRole('button', { name: 'Review Change Study', exact: true }).count(), 0);
  await page.screenshot({ path: new URL('archived-plan.png', output).pathname, fullPage: true });
  await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
  for (const name of ['Rebuild tour', 'Save tour revision', 'Match room names locally', 'Use Gemini direction']) await disabled(page.getByRole('button', { name, exact: true }));
  await disabled(page.getByRole('spinbutton', { name: 'Tour duration in seconds', exact: true }));
  await page.screenshot({ path: new URL('archived-tour.png', output).pathname, fullPage: true });
  // The same loopback host shares its session cookie. Reads through Vite's Worker proxy are allowed;
  // all account/project mutations above and cleanup below use the Worker's trusted origin directly.
  await page.goto(`${origin}/projects/${projectId}/spatial`);
  await page.getByText('Archived · read only', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Render / Export', exact: true }).click();
  await page.getByLabel('Pairing code').fill((await readFile(pairFile, 'utf8')).trim());
  await page.getByRole('button', { name: 'Connect renderer', exact: true }).click();
  await page.getByText('Connected to your computer', { exact: true }).waitFor(); paired = true;
  await disabled(page.getByRole('button', { name: 'Render previews', exact: true }));
  await disabled(page.getByRole('button', { name: 'Render 1080p film', exact: true }));
  await page.screenshot({ path: new URL('archived-render.png', output).pathname, fullPage: true });
  const after = (await api(`/api/projects/${projectId}/spatial`)).data;
  assert.equal(after.project.status, 'archived');
  for (const key of ['model', 'tour', 'viewpoints', 'spatialRevision', 'tourRevision', 'cameraRevision']) assert.deepEqual(after[key], saved[key], `Archived ${key} remains unchanged.`);
  assert.deepEqual(mutations, []); page.off('request', observe);
  evidence.archive = { projectId, status: after.project.status, spatialRevision: after.spatialRevision, tourRevision: after.tourRevision, cameraRevision: after.cameraRevision, mutatingRequests: mutations, localRenderButtonsDisabled: true };
  checks.push('Real archived Worker project stays readable; drawing, floor, viewpoint, tour, AI and paired local-render writes disabled, with zero mutation requests and unchanged saved revisions.');
  assert.deepEqual(errors, []);
  checkpoint('Archived project editing, camera and paired render fences verified.');
} finally {
  if (paired) await page.getByRole('button', { name: 'Disconnect', exact: true }).click({ timeout: 3000 }).catch(() => {});
  try {
    if (accountCreated && new URL(page.url()).origin !== privateOrigin) await page.goto(`${privateOrigin}/explore`);
    if (projectId) assert.equal((await api(`/api/projects/${projectId}`, 'DELETE')).status, 204, 'Delete only this run’s synthetic project.');
    if (accountCreated) assert.equal((await api('/api/account', 'DELETE', { currentPassword: password, confirmation: 'DELETE' })).status, 204, 'Delete only this run’s synthetic account.');
    evidence.syntheticCleanupComplete = true;
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); }
}
await writeFile(new URL('verification.json', output), JSON.stringify(evidence, null, 2));
console.log(JSON.stringify(evidence, null, 2));
