import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium, firefox, webkit } from '@playwright/test';

const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use a local app origin.');
const stage = process.env.SPATIAL_VISUAL_STAGE || 'after';
assert.match(stage, /^[a-z0-9-]+$/);
const output = new URL(`../qa-artifacts/spatial-visual/${stage}/`, import.meta.url);
await mkdir(output, { recursive: true });
const engines = { chrome: chromium, firefox, webkit };
const files = ['src/spatial/WorldCanvas.jsx', 'src/spatial/world-canvas.css', 'src/spatial/model.js', 'src/spatial/model-v2.js'];
const report = { stage, origin, timestamp: new Date().toISOString(), scope: 'Public sample in real local headless browser engines; 390px is viewport emulation, not a physical device.', source: Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(new URL('../' + file, import.meta.url))).digest('hex')]))), engines: [] };
let failed = false;
for (const name of (process.env.SPATIAL_ENGINES || 'chrome,firefox,webkit').split(',')) {
  assert.ok(engines[name]);
  const result = { name, errors: [], consoleErrors: [], failedRequests: [], screenshots: [] }; report.engines.push(result);
  const browser = await engines[name].launch({ headless: true, ...(name === 'chrome' ? { channel: 'chrome' } : {}) });
  try {
    result.version = browser.version();
    const page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 1 });
    page.setDefaultTimeout(25000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => result.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.addInitScript(() => {
      window.__visualDraws = 0;
      for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) for (const key of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
        const original = type.prototype[key];
        if (typeof original === 'function') type.prototype[key] = function (...args) { window.__visualDraws++; return original.apply(this, args); };
      }
    });
    await page.goto(origin + '/explore');
    await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    await page.waitForFunction(() => window.__visualDraws > 0);
    await page.getByRole('button', { name: 'Reduced motion off', exact: true }).click();
    const canvas = page.locator('.world-canvas-shell');
    const capture = async view => {
      await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await page.waitForTimeout(650);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.world-camera-fade')).opacity) === 0);
      const file = `${name}-${view}.png`; await canvas.screenshot({ path: new URL(file, output).pathname }); result.screenshots.push(file);
    };
    await capture('overview');
    await page.screenshot({ path: new URL(`${name}-studio.png`, output).pathname, fullPage: true });
    for (const [label, view] of [[/Living room/, 'living'], [/Kitchen & dining/, 'kitchen'], [/Main bedroom/, 'bedroom']]) {
      await page.locator('.sp-room-list').getByRole('button', { name: label }).click(); await capture(view);
    }
    await page.getByRole('button', { name: 'Reset overview', exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 }); await capture('mobile');
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(result.errors, []); assert.deepEqual(result.consoleErrors, []); assert.deepEqual(result.failedRequests, []);
    result.passed = true;
  } catch (error) { failed = true; result.passed = false; result.failure = error.stack; }
  finally { await browser.close(); await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify(result)); }
}
if (failed) process.exitCode = 1;
