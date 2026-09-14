import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { firefox, webkit } from '@playwright/test';

// Local headless engine checks, not physical-device, Safari-product, or assistive-technology certification.
const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use a local development origin.');
const output = new URL('../qa-artifacts/spatial-cross-browser/', import.meta.url);
await mkdir(output, { recursive: true });
const requested = (process.env.SPATIAL_ENGINES || 'firefox,webkit').split(',');
const engines = { firefox, webkit };
const report = { origin, timestamp: new Date().toISOString(), scope: 'Sequential Playwright headless engines on macOS; CSS viewport resizing only. No physical phone, Safari application, screen reader, or native UI verification.', engines: [] };
let failed = false;
for (const name of requested) {
  assert.ok(engines[name], `Unknown browser engine: ${name}`);
  const result = { name, checks: [], errors: [], consoleErrors: [], failedRequests: [] };
  report.engines.push(result);
  let browser, page;
  try {
    browser = await engines[name].launch({ headless: true });
    result.version = browser.version();
    page = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
    page.setDefaultTimeout(20000);
    page.on('pageerror', error => result.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') result.consoleErrors.push(message.text()); });
    page.on('requestfailed', request => result.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
    await page.addInitScript(() => {
      window.__spatialDraws = 0;
      for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
        for (const method of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const original = type.prototype[method];
          if (typeof original === 'function') type.prototype[method] = function (...args) { window.__spatialDraws++; return original.apply(this, args); };
        }
      }
    });
    await page.goto(origin + '/explore');
    await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    await page.waitForFunction(() => window.__spatialDraws > 0 || [...document.querySelectorAll('.world-fallback:not([aria-hidden="true"])')].some(element => /unavailable|session ended/i.test(element.textContent)));
    result.userAgent = await page.evaluate(() => navigator.userAgent);
    result.rendering = await page.evaluate(() => window.__spatialDraws > 0 ? 'WebGL draw calls observed' : 'WebGL unavailable; explicit 2D fallback');
    const webgl = result.rendering.startsWith('WebGL draw');
    const settledView = async () => {
      if (!webgl) return;
      await page.locator('canvas').waitFor();
      await page.waitForTimeout(450);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.world-camera-fade')).opacity) === 0);
    };
    if (!webgl) {
      await page.getByText('3D graphics are unavailable.', { exact: true }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'Play tour', exact: true }).isDisabled(), true);
      result.checks.push('Missing WebGL is stated explicitly and playback is disabled.');
    }
    const noOverflow = async label => {
      const dimensions = await page.evaluate(() => ({ viewport: innerWidth, scroll: document.documentElement.scrollWidth }));
      assert.ok(dimensions.scroll <= dimensions.viewport, `${label}: ${JSON.stringify(dimensions)}`);
      result.checks.push(`${label}: no horizontal document overflow.`);
    };
    await noOverflow('Desktop 1440px');
    const study = page.locator('.sp-room-list').getByRole('button', { name: /Study/ });
    await study.focus(); await study.press('Enter');
    assert.equal(await study.getAttribute('aria-pressed'), 'true');
    assert.equal(await study.evaluate(element => document.activeElement === element), true);
    result.checks.push('Keyboard room activation retains focus and selected state.');
    await page.getByRole('button', { name: 'Reset overview', exact: true }).click();
    await settledView();
    await page.screenshot({ path: new URL(`${name}-desktop.png`, output).pathname, fullPage: true });
    if (webgl) {
      await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
      await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click();
      const progress = page.getByRole('slider', { name: 'Tour progress' });
      await page.getByRole('button', { name: 'Play tour', exact: true }).click();
      await page.waitForFunction(() => Number(document.querySelector('[aria-label="Tour progress"]').value) > 0.3);
      await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
      const paused = Number(await progress.inputValue());
      await page.waitForTimeout(350);
      assert.equal(Number(await progress.inputValue()), paused);
      await page.getByRole('button', { name: 'Resume tour', exact: true }).click();
      await page.waitForFunction(value => Number(document.querySelector('[aria-label="Tour progress"]').value) > value + 0.2, paused);
      const canvas = page.locator('canvas');
      await canvas.scrollIntoViewIfNeeded();
      const box = await canvas.boundingBox();
      await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.55);
      await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.6, { steps: 8 }); await page.mouse.up();
      await page.getByRole('button', { name: 'Resume tour', exact: true }).waitFor();
      const takeover = Number(await progress.inputValue());
      await page.waitForTimeout(350);
      assert.equal(Number(await progress.inputValue()), takeover);
      await page.getByRole('button', { name: 'Resume tour', exact: true }).click();
      await page.waitForFunction(value => Number(document.querySelector('[aria-label="Tour progress"]').value) > value + 0.2, takeover);
      await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
      result.checks.push('Actual WebGL tour advances, pauses exactly, resumes, pauses on pointer takeover, and resumes again.');
    } else result.checks.push('3D tour movement not claimed: this headless engine has no usable WebGL context.');

    await page.getByRole('button', { name: '2D Plan', exact: true }).click();
    const plan = page.getByRole('group', { name: 'Editable building plan', exact: true });
    const select = async label => { const control = plan.getByRole('button', { name: label, exact: true }); await control.focus(); await control.press('Enter'); return control; };
    const number = label => page.getByRole('spinbutton', { name: label, exact: true });
    const setNumber = async (label, value) => { await number(label).fill(String(value)); await number(label).press('Enter'); assert.equal(await page.locator('.le-error').count(), 0, (await page.locator('.le-error').allTextContents()).join('\n')); };
    await select('Edit Living room');
    assert.equal(Number(await number('Vertex 1 X').inputValue()), 0);
    await setNumber('Vertex 1 X', 0.1);
    assert.equal(Number(await number('Vertex 1 X').inputValue()), 0.1);
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await select('Edit Living room');
    assert.equal(Number(await number('Vertex 1 X').inputValue()), 0);
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await select('Edit Living room');
    assert.equal(Number(await number('Vertex 1 X').inputValue()), 0.1);
    await select('Edit coffee-table living-table');
    await setNumber('Furniture width', 0.8);
    assert.equal(Number(await number('Furniture width').inputValue()), 0.8);
    const startX = Number(await number('Furniture X').inputValue());
    const table = await select('Edit coffee-table living-table');
    await table.press('ArrowRight');
    assert.equal(Number(await number('Furniture X').inputValue()), startX + 0.1);
    assert.equal(await page.locator('.le-error').count(), 0);
    result.checks.push('2D room numeric boundary edit, undo/redo, furniture dimension edit and keyboard position nudge succeed.');
    await page.screenshot({ path: new URL(`${name}-editor.png`, output).pathname, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noOverflow('390px mobile CSS viewport, 2D editor');
    await page.screenshot({ path: new URL(`${name}-mobile-editor.png`, output).pathname, fullPage: true });
    await page.getByRole('button', { name: '3D Explore', exact: true }).click();
    await settledView();
    await noOverflow('390px mobile CSS viewport, 3D workspace');
    await page.screenshot({ path: new URL(`${name}-mobile-viewer.png`, output).pathname, fullPage: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await page.getByRole('button', { name: 'Reduced motion on' }).getAttribute('aria-pressed'), 'true');
    await page.setViewportSize({ width: 720, height: 540 });
    await noOverflow('720px CSS reflow equivalent to a 1440px viewport at 200%');
    result.checks.push('Reduced-motion preference reaches the workspace control.');
    assert.deepEqual(result.errors, []);
    result.passed = true;
  } catch (error) {
    failed = true; result.passed = false; result.failure = error.stack;
    await page?.screenshot({ path: new URL(`${name}-failure.png`, output).pathname, fullPage: true }).catch(() => {});
  } finally {
    await browser?.close();
    await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  }
}
if (failed) process.exitCode = 1;
