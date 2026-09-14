import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { chromium } from '@playwright/test';
import { buildPrimitives, createDemoBuilding, createMultiFloorDemo } from '../src/spatial/model.js';

// Read-only public-demo measurements. No provider calls, accounts or real user data.
const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:8790';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin).hostname), 'Use a local build.');
const output = new URL('../qa-artifacts/spatial-performance/', import.meta.url);
await mkdir(output, { recursive: true });
const seconds = Number(process.env.SPATIAL_PERF_SECONDS || 8);
const transitionsOnly = process.env.SPATIAL_PERF_TRANSITIONS_ONLY === '1';
assert.ok(Number.isFinite(seconds) && seconds >= 4 && seconds <= 30, 'Measure for 4–30 seconds.');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const host = { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCores: os.cpus().length, memoryBytes: os.totalmem() };
if (os.platform() === 'darwin') {
  host.model = execFileSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).trim();
  host.osVersion = execFileSync('sw_vers', ['-productVersion'], { encoding: 'utf8' }).trim();
}
const scenes = [createDemoBuilding(), createMultiFloorDemo()].map(model => ({ id: model.id, schemaVersion: model.schemaVersion, floors: model.floors.length, rooms: model.rooms.length, walls: model.walls.length, openings: model.walls.reduce((sum, wall) => sum + wall.openings.length, 0), furniture: model.furniture.length, stairs: model.stairs?.length || 0, primitives: buildPrimitives(model).length, jsonBytes: Buffer.byteLength(JSON.stringify(model)), sha256: hash(JSON.stringify(model)) }));
async function inventory(directory) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const child = new URL(item.name + (item.isDirectory() ? '/' : ''), directory);
    if (item.isDirectory()) entries.push(...await inventory(child));
    else entries.push({ path: child.pathname.split('/dist/client/')[1], bytes: (await stat(child)).size });
  }
  return entries;
}
const files = [...(await readdir(new URL('../src/spatial/', import.meta.url))).sort().map(file => 'src/spatial/' + file), 'package-lock.json', 'scripts/check-spatial-performance.mjs'];
const report = { measuredAt: new Date().toISOString(), origin, mode: transitionsOnly ? 'quality-lifecycle-regression' : 'six-profile-performance', scope: 'Headless desktop Chrome on this host, with CSS/touch/DPR emulation for 390px. Not a physical-phone or GPU-timer benchmark. Observed draw frames, not browser RAF callbacks, define rendered FPS. Instrumentation and other local work can affect timing.', host, source: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), files: Object.fromEntries(await Promise.all(files.map(async file => [file, hash(await readFile(new URL('../' + file, import.meta.url)))]))), builtHtml: hash(await readFile(new URL('../dist/client/index.html', import.meta.url))) }, scenes, assetInventory: await inventory(new URL('../dist/client/', import.meta.url)), scenarios: [] };
const browser = await chromium.launch({ channel: 'chrome', headless: true });
report.browserVersion = browser.version();
let failed = false;
try {
  for (const profile of [{ name: 'desktop', viewport: { width: 1440, height: 1080 }, deviceScaleFactor: 2 }, { name: 'mobile-emulation', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }]) {
    for (const quality of ['balanced', 'low', 'high']) {
      if (transitionsOnly && (profile.name !== 'desktop' || quality !== 'balanced')) continue;
      const result = { profile: profile.name, viewport: profile.viewport, emulatedDpr: profile.deviceScaleFactor, quality, sceneId: scenes[0].id, hostLoadAverage: os.loadavg(), errors: [], failedRequests: [], responses: [] };
      report.scenarios.push(result);
      const context = await browser.newContext(profile);
      const page = await context.newPage();
      page.setDefaultTimeout(25000);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await cdp.send('Performance.enable');
      let networkBytes = 0;
      cdp.on('Network.loadingFinished', data => { networkBytes += data.encodedDataLength; });
      page.on('pageerror', error => result.errors.push(error.stack || error.message));
      page.on('requestfailed', request => result.failedRequests.push({ path: new URL(request.url()).pathname, failure: request.failure()?.errorText }));
      page.on('response', response => { if (response.status() >= 400) result.responses.push({ path: new URL(response.url()).pathname, status: response.status() }); });
      await context.route('**/*', async route => { const url = new URL(route.request().url()); const localHealth = url.origin === 'http://127.0.0.1:43127' && url.pathname === '/health' && route.request().method() === 'GET'; if (url.origin !== origin && !localHealth && !['data:', 'blob:'].includes(url.protocol)) { result.errors.push('Unexpected nonlocal request: ' + url.origin); await route.abort(); } else await route.continue(); });
      await page.addInitScript(() => {
        let activeStamp = null, session = null;
        const contexts = new WeakSet(), longTasks = [];
        const requestFrame = window.requestAnimationFrame;
        window.requestAnimationFrame = callback => requestFrame.call(window, timestamp => { const previous = activeStamp; activeStamp = timestamp; try { callback(timestamp); } finally { activeStamp = previous; } });
        const originalContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function (...args) { const context = originalContext.apply(this, args); if (context && /^webgl/.test(args[0])) this.__spatialPerformanceContext = context; return context; };
        const record = (gl, args, instanced) => {
          if (!session) return;
          if (!contexts.has(gl)) { if (!gl.canvas?.closest?.('.world-canvas-shell')) return; contexts.add(gl); }
          const stamp = activeStamp ?? performance.now();
          let frame = session.frames.at(-1);
          if (!frame || frame.timestamp !== stamp) { frame = { timestamp: stamp, calls: 0, triangles: 0, outsideRaf: activeStamp === null }; session.frames.push(frame); }
          const count = args[1], instances = instanced ? args[4] : 1;
          frame.calls++;
          if (args[0] === gl.TRIANGLES) frame.triangles += count / 3 * instances;
          else if (args[0] === gl.TRIANGLE_STRIP || args[0] === gl.TRIANGLE_FAN) frame.triangles += Math.max(0, count - 2) * instances;
        };
        for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext].filter(Boolean)) {
          for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
            const original = type.prototype[name];
            if (typeof original !== 'function') continue;
            type.prototype[name] = function (...args) {
              // Normalize drawArrays first/count and instanceCount positions to drawElements shape.
              const normalized = name.includes('Arrays') ? [args[0], args[2], null, null, args[3]] : args;
              const returned = original.apply(this, args); record(this, normalized, name.includes('Instanced')); return returned;
            };
          }
        }
        try { new PerformanceObserver(list => longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true }); } catch { /* Engine may omit Long Tasks. */ }
        window.__spatialPerformance = {
          begin() { session = { startedAt: performance.now(), frames: [] }; },
          end() { const done = session; session = null; return { ...done, endedAt: performance.now(), longTasks: longTasks.filter(task => task.startTime >= done.startedAt) }; },
          context() {
            const canvas = document.querySelector('.world-canvas-shell canvas'), gl = canvas?.__spatialPerformanceContext;
            if (!gl) return null;
            const extension = gl.getExtension('WEBGL_debug_renderer_info'), rect = canvas.getBoundingClientRect();
            return { renderer: extension ? gl.getParameter(extension.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), vendor: extension ? gl.getParameter(extension.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR), version: gl.getParameter(gl.VERSION), contextAttributes: gl.getContextAttributes(), cssSize: [rect.width, rect.height], bufferSize: [gl.drawingBufferWidth, gl.drawingBufferHeight], effectiveDpr: gl.drawingBufferWidth / rect.width, devicePixelRatio, maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE), userAgent: navigator.userAgent, hardwareConcurrency: navigator.hardwareConcurrency };
          },
        };
      });
      const metrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(metric => [metric.name, metric.value]));
      const summarize = raw => {
        const frames = raw.frames, elapsed = (raw.endedAt - raw.startedAt) / 1000;
        const values = key => frames.map(frame => frame[key]).sort((a, b) => a - b);
        const percentile = (array, p) => array.length ? array[Math.min(array.length - 1, Math.floor((array.length - 1) * p))] : null;
        const intervals = frames.slice(1).map((frame, i) => frame.timestamp - frames[i].timestamp).sort((a, b) => a - b);
        const stats = array => ({ min: array[0] ?? null, median: percentile(array, .5), p95: percentile(array, .95), max: array.at(-1) ?? null });
        return { seconds: elapsed, renderedFrames: frames.length, renderedFps: frames.length / elapsed, drawCalls: frames.reduce((sum, frame) => sum + frame.calls, 0), triangles: frames.reduce((sum, frame) => sum + frame.triangles, 0), perFrameDrawCalls: stats(values('calls')), perFrameTriangles: stats(values('triangles')), frameIntervalMs: stats(intervals), framesOutsideRaf: frames.filter(frame => frame.outsideRaf).length, longTasks: raw.longTasks, rawFrames: frames };
      };
      const measure = async (label, duration) => {
        const before = await metrics(); await page.evaluate(() => window.__spatialPerformance.begin()); await page.waitForTimeout(duration);
        const sample = summarize(await page.evaluate(() => window.__spatialPerformance.end())), after = await metrics();
        result[label] = { ...sample, mainThreadTaskSeconds: after.TaskDuration - before.TaskDuration, jsHeapUsedBytes: after.JSHeapUsedSize, uiStatus: await page.locator('.sp-statusbar').innerText() };
        result[label].hudFps = Number(result[label].uiStatus.match(/(\d+) fps/)?.[1]) || null;
        result[label].hudDifferenceFromMeasuredFps = result[label].hudFps === null ? null : result[label].hudFps - sample.renderedFps;
      };
      try {
        await page.goto(origin + '/explore'); await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
        await page.waitForFunction(() => window.__spatialPerformance.context());
        result.defaultContext = await page.evaluate(() => window.__spatialPerformance.context());
        if (transitionsOnly) {
          result.qualityTransitions = [];
          // Remove orbit inertia so camera comparisons isolate remount behavior.
          await page.getByRole('button', { name: 'Reduced motion off', exact: true }).click();
          const canvas = page.locator('.world-canvas-shell canvas');
          const settle = async () => { await page.waitForTimeout(800); await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await page.waitForTimeout(200); };
          const pose = async () => {
            // Export a temporary demo viewpoint through the real public UI;
            // this measures the actual camera without React internals or mocks.
            await page.getByRole('button', { name: 'Save viewpoint', exact: true }).click();
            await page.getByRole('button', { name: 'Render / Export', exact: true }).click();
            const pending = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download scene JSON', exact: true }).click();
            const download = await pending, bundle = JSON.parse(await readFile(await download.path(), 'utf8'));
            const view = bundle.viewpoints.at(-1); assert.ok(view?.position && view?.target); return { position: view.position, target: view.target, fov: [view.fov] };
          };
          const progress = () => page.getByLabel('Tour progress', { exact: true }).inputValue().then(Number);
          const change = async quality => {
            await page.getByLabel('Rendering quality', { exact: true }).selectOption(quality);
            await page.waitForFunction(expected => window.__spatialPerformance.context()?.contextAttributes?.antialias === expected, quality !== 'low');
            await settle();
          };
          const preserve = async mode => {
            const before = await pose(), time = await progress();
            const deltas = [];
            for (const selectedQuality of ['low', 'balanced']) {
              await change(selectedQuality);
              const after = await pose(), delta = Math.max(...['position', 'target', 'fov'].flatMap(key => before[key].map((value, index) => Math.abs(value - after[key][index]))));
              assert.ok(delta < .0001, `${mode} camera changed during ${selectedQuality} transition: ${delta}`);
              assert.equal(await progress(), time, 'Paused tour time is preserved.'); deltas.push({ quality: selectedQuality, maxCameraCoordinateOrFovDelta: delta });
            }
            result.qualityTransitions.push({ mode, currentPosePreserved: true, time, deltas });
          };
          await canvas.scrollIntoViewIfNeeded(); const box = await canvas.boundingBox();
          await page.mouse.move(box.x + box.width * .5, box.y + box.height * .5); await page.mouse.down(); await page.mouse.move(box.x + box.width * .65, box.y + box.height * .58, { steps: 12 }); await page.mouse.up(); await settle();
          await preserve('orbit-adjusted overview');
          await page.locator('.sp-room-list').getByRole('button', { name: /Study/ }).click(); await settle(); await preserve('room');
          await page.getByRole('button', { name: 'Walk inside', exact: true }).click(); await settle();
          const beforeLook = await pose(); await canvas.scrollIntoViewIfNeeded();
          const walkBox = await canvas.boundingBox(); await page.mouse.move(walkBox.x + walkBox.width * .5, walkBox.y + walkBox.height * .5); await page.mouse.down(); await page.mouse.move(walkBox.x + walkBox.width * .56, walkBox.y + walkBox.height * .46, { steps: 6 }); await page.mouse.up(); await settle(); await preserve('walk with changed look direction');
          const afterLook = await pose(); assert.ok(beforeLook.target.some((value, index) => Math.abs(value - afterLook.target[index]) > 10), 'Canvas drag must change the actual walking look direction.');
          await page.getByRole('button', { name: 'Play tour', exact: true }).click(); await page.waitForFunction(() => Number(document.querySelector('[aria-label="Tour progress"]').value) > 1); await page.getByRole('button', { name: 'Pause tour', exact: true }).click(); await settle(); await preserve('paused tour');
          await page.getByRole('button', { name: 'Resume tour', exact: true }).click();
          for (const selectedQuality of ['low', 'balanced']) {
            const before = await progress(); await change(selectedQuality);
            await page.getByRole('button', { name: 'Pause tour', exact: true }).waitFor(); const after = await progress();
            assert.ok(after > before && after < before + 3, 'Playing tour continues from its previous time.');
            result.qualityTransitions.push({ mode: 'playing tour', quality: selectedQuality, before, after, remainedPlaying: true });
          }
          await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
          await page.getByRole('button', { name: 'Restart tour', exact: true }).click(); await page.getByRole('button', { name: 'Reset overview', exact: true }).click(); await settle();
          await measure('qualityTransitionIdleOverview', 2000);
          assert.equal(result.qualityTransitionIdleOverview.renderedFrames, 0, 'Restored overview must settle back to demand rendering.');
          const pickBox = await canvas.boundingBox(); let picked = false;
          for (const y of [.45, .55, .65, .35]) {
            for (const x of [.4, .5, .6, .3, .7]) {
              await page.mouse.move(pickBox.x + pickBox.width * x, pickBox.y + pickBox.height * y); await page.waitForTimeout(40);
              if (!(await page.locator('.sp-hover-label').count())) continue;
              await page.mouse.click(pickBox.x + pickBox.width * x, pickBox.y + pickBox.height * y); await page.waitForTimeout(100);
              picked = await page.locator('.world-object-card,.world-mode-room').count() > 0;
              if (picked) break;
            }
            if (picked) break;
          }
          assert.ok(picked, 'The stable event source must retain semantic room/object picking.'); result.semanticPointerPick = true;
          await page.evaluate(() => document.querySelector('.world-canvas-shell canvas').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
          await page.getByText('The graphics session ended. Your 2D plan is still available.', { exact: true }).waitFor();
          await page.getByRole('button', { name: '2D Plan', exact: true }).click(); await page.getByRole('heading', { name: 'Everything in its place.', exact: true }).waitFor();
          result.connectedContextLossFallback = true;
          assert.deepEqual(result.errors, [], 'No uncaught browser errors.');
          if (transitionsOnly) { result.completed = true; continue; }
        }
        await page.getByLabel('Rendering quality', { exact: true }).selectOption(quality);
        await page.waitForTimeout(300);
        result.contextAfterQualityChange = await page.evaluate(() => window.__spatialPerformance.context());
        // Fresh canvas makes immutable WebGL creation attributes unambiguous per quality.
        await page.getByRole('button', { name: '2D Plan', exact: true }).click();
        await page.getByRole('button', { name: '3D Explore', exact: true }).click();
        await page.waitForFunction(() => window.__spatialPerformance.context());
        const canvas = page.locator('.world-canvas-shell canvas'); await canvas.scrollIntoViewIfNeeded();
        await page.mouse.move(1, 1); await page.waitForTimeout(1000);
        result.context = await page.evaluate(() => window.__spatialPerformance.context());
        result.coldLoad = { navigation: await page.evaluate(() => performance.getEntriesByType('navigation')[0].toJSON()), resources: await page.evaluate(() => performance.getEntriesByType('resource').map(entry => ({ path: new URL(entry.name).pathname, initiatorType: entry.initiatorType, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, durationMs: entry.duration }))), cdpEncodedNetworkBytes: networkBytes };
        await measure('idleOverview', 2500);
        await page.getByRole('button', { name: 'Play tour', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1);
        await page.waitForFunction(() => Number(document.querySelector('[aria-label="Tour progress"]').value) > .8);
        result.tourStartSeconds = Number(await page.getByLabel('Tour progress', { exact: true }).inputValue());
        await measure('activeTour', seconds * 1000);
        result.tourEndSeconds = Number(await page.getByLabel('Tour progress', { exact: true }).inputValue());
        assert.ok(result.activeTour.renderedFrames > 0 && result.tourEndSeconds > result.tourStartSeconds, 'A real rendered tour must advance.');
        await page.getByRole('button', { name: 'Pause tour', exact: true }).click();
        await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await page.waitForTimeout(300);
        await measure('pausedTour', 2000);
        await page.getByRole('button', { name: 'Reset overview', exact: true }).click(); await canvas.scrollIntoViewIfNeeded(); await page.mouse.move(1, 1); await page.waitForTimeout(1000);
        if (quality === 'balanced') await page.screenshot({ path: new URL(profile.name + '-balanced.png', output).pathname, fullPage: true });
        await measure('settledOverview', 2000);
        assert.deepEqual(result.errors, [], 'No uncaught browser errors.');
        result.completed = true;
      } catch (error) { failed = true; result.completed = false; result.failure = error.stack || error.message; result.fallbackText = await page.locator('.world-fallback,.sp-notice,.sp-messages').allTextContents().catch(() => []); await page.screenshot({ path: new URL('quality-failure.png', output).pathname, fullPage: true }).catch(() => {}); }
      finally {
        await context.close();
        await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2) + '\n');
        console.log(JSON.stringify({ profile: result.profile, quality, completed: result.completed, failure: result.failure, idleFrames: result.idleOverview?.renderedFrames, tourFps: result.activeTour?.renderedFps, tourDrawCallsP95: result.activeTour?.perFrameDrawCalls.p95, tourTrianglesP95: result.activeTour?.perFrameTriangles.p95, antialiasAfterChange: result.contextAfterQualityChange?.contextAttributes?.antialias, antialiasFresh: result.context?.contextAttributes?.antialias, errors: result.errors }));
      }
    }
  }
} finally { await browser.close(); report.completedAt = new Date().toISOString(); await writeFile(new URL('verification.json', output), JSON.stringify(report, null, 2) + '\n'); }
if (failed) process.exitCode = 1;
