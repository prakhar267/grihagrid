import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer, preview } from 'vite';
import { createDemoBuilding } from '../src/spatial/model.js';
import { generateTour } from '../src/spatial/tours.js';

// An isolated browser/server exercises real React recovery without a session,
// provider, mail service, database, or the user's open browser tabs.
const root = fileURLToPath(new URL('..', import.meta.url));
const cacheDir = await mkdtemp(path.join(tmpdir(), 'grihagrid-recovery-'));
const built = process.env.APP_RECOVERY_BUILT === '1';
const server = built
  ? await preview({ root, logLevel: 'silent', preview: { host: '127.0.0.1', port: 0, open: false } })
  : await createServer({ root, cacheDir, logLevel: 'silent', server: { host: '127.0.0.1', port: 0, open: false } });
const blockedChunks = new Set();
let browser;
const checks = [];
let interceptedWrites = 0;
const writePaths = [];
let mockedPublicEstimates = 0;
try {
  if (!built) await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function isolated({ auth, blockSpatial = () => false, apiHandler } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const calls = [];
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      // Returning home mounts its existing 300 ms anonymous cost calculator.
      // This POST computes a range; it is not a project/save/provider action.
      // Validate its exact synthetic default input and keep it fully mocked.
      if (url.pathname === '/api/estimate' && request.method() === 'POST') {
        assert.deepEqual(request.postDataJSON(), { width: 30, length: 50, city: 'Bengaluru', floors: 'G+1', quality: 'Signature' });
        for (const header of ['cookie', 'authorization', 'x-csrf-token']) assert.equal(request.headers()[header], undefined);
        mockedPublicEstimates++;
        return route.fulfill({ status: 503, json: { code: 'test_public_estimate_unavailable' } });
      }
      if (!['GET', 'HEAD'].includes(request.method())) {
        interceptedWrites++;
        writePaths.push(url.pathname);
        return route.fulfill({ status: 503, json: { code: 'test_write_blocked' } });
      }
      if (url.pathname.startsWith('/api/')) {
        calls.push(url.pathname);
        if (url.pathname === '/api/auth/me') return auth ? auth(route) : route.fulfill({ status: 401, json: { code: 'unauthenticated' } });
        if (apiHandler && await apiHandler(route, url.pathname)) return;
        if (url.pathname === '/api/auth/sessions') return route.fulfill({ json: { sessions: [{ current: true, startedAt: '2026-09-15 00:00:00', expiresAt: '2026-09-22 00:00:00' }], hasMore: false } });
        if (url.pathname === '/api/commerce/catalog') return route.fulfill({ json: { plans: [] } });
        if (url.pathname === '/api/readiness') return route.fulfill({ json: { capabilities: { passwordRecovery: false, emailVerification: false } } });
        return route.fulfill({ status: 404, json: { code: 'test_route_not_available' } });
      }
      if ((url.pathname === '/src/spatial/SpatialWorkspace.jsx' || /^\/assets\/SpatialWorkspace-[^/]+\.js$/.test(url.pathname)) && blockSpatial()) { blockedChunks.add(url.pathname); return route.abort('failed'); }
      return route.continue();
    });
    return { context, page, calls };
  }
  const user = { id: '10000000-0000-4000-8000-000000000001', name: 'Recovery fixture', email: 'recovery@example.test' };
  for (const [status, code] of [[503, 'service_unavailable'], [401, 'edge_denied']]) {
    let healthy = false;
    const { context, page, calls } = await isolated({ auth: route => route.fulfill(healthy ? { json: { user } } : { status, json: { error: 'PRIVATE_INTERNAL_ERROR_SENTINEL', code } }) });
    await page.goto(origin + '/security');
    await page.getByRole('heading', { name: 'We could not confirm your session.' }).waitFor();
    assert.equal(await page.locator('input').count(), 0);
    assert.equal(calls.includes('/api/auth/sessions'), false);
    assert.equal(await page.getByText('PRIVATE_INTERNAL_ERROR_SENTINEL').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'We could not confirm your session.' }).evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const count = calls.filter(value => value === '/api/auth/me').length;
    await page.waitForTimeout(250);
    assert.equal(calls.filter(value => value === '/api/auth/me').length, count, 'No automatic retry loop');
    healthy = true;
    await page.getByRole('button', { name: 'Retry session check' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: /Protect your account/ }).waitFor();
    await page.getByLabel('Current password', { exact: true }).waitFor();
    assert.equal(calls.filter(value => value === '/api/auth/me').length, count + 1);
    checks.push(`${status}/${code}: private controls withheld, fixed error, focused heading, keyboard retry succeeds without reload`);
    await context.close();
  }
  {
    const { context, page, calls } = await isolated({ auth: route => route.fulfill({ status: 401, json: { code: 'unauthenticated' } }) });
    await page.goto(origin + '/security');
    await page.waitForURL(origin + '/login');
    await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
    assert.equal(calls.includes('/api/auth/sessions'), false);
    checks.push('Only exact application unauthenticated 401 follows the existing sign-in route');
    await context.close();
  }
  {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const { context, page, calls } = await isolated({ auth: async route => { await pending; await route.fulfill({ json: { user } }); } });
    await page.goto(origin + '/security');
    await page.getByRole('heading', { name: 'Checking your session…' }).waitFor();
    const publicEstimate = page.waitForRequest(request => new URL(request.url()).pathname === '/api/estimate' && request.method() === 'POST');
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'grihagrid.auth.logout', newValue: 'recovery-test-logout' })));
    await page.waitForURL(origin + '/');
    release();
    await publicEstimate;
    await page.waitForTimeout(250);
    assert.equal(calls.includes('/api/auth/sessions'), false);
    await page.getByText('You’re logged out. Private workspace data was cleared from this tab.').waitFor();
    await page.getByRole('button', { name: 'Open menu', exact: true }).click();
    await page.getByRole('button', { name: 'Log in', exact: true }).waitFor();
    checks.push('A sibling-tab logout fences a late successful bootstrap response');
    await context.close();
  }
  {
    let blocked = true;
    const { context, page } = await isolated({ blockSpatial: () => blocked });
    await page.goto(origin + '/explore');
    await page.getByRole('heading', { name: 'This page could not be opened.' }).waitFor();
    assert.equal(await page.getByText(/Unsaved changes in this tab may be lost when you reload/).count(), 1);
    assert.equal(await page.getByRole('heading', { name: 'This page could not be opened.' }).evaluate(node => node === document.activeElement), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.setViewportSize({ width: 720, height: 540 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    page.once('dialog', dialog => dialog.dismiss());
    await page.getByRole('button', { name: 'Reload app' }).click();
    await page.getByRole('heading', { name: 'This page could not be opened.' }).waitFor();
    blocked = false;
    page.once('dialog', dialog => dialog.accept());
    await page.getByRole('button', { name: 'Reload app' }).focus();
    await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    checks.push('Failed lazy chunk has focused, reflow-safe recovery; dismiss retains the error screen and explicit keyboard reload restores the studio');
    await context.close();
  }
  async function spa(page, pathname) {
    await page.evaluate(pathname => { history.pushState({}, '', pathname); dispatchEvent(new PopStateEvent('popstate')); }, pathname);
  }
  {
    let healthy = false;
    const { context, page, calls } = await isolated({ auth: route => route.fulfill({ json: { user } }), apiHandler: async (route, pathname) => {
      if (pathname !== '/api/projects') return false;
      await route.fulfill(healthy ? { json: { projects: [] } } : { status: 503, json: { error: 'PRIVATE_PROJECT_ERROR_SENTINEL' } }); return true;
    } });
    await page.goto(origin + '/dashboard');
    await page.getByRole('button', { name: 'Retry projects' }).waitFor();
    assert.equal(await page.getByText('PRIVATE_PROJECT_ERROR_SENTINEL').count(), 0);
    const before = calls.filter(value => value === '/api/projects').length;
    healthy = true;
    await page.getByRole('button', { name: 'Retry projects' }).focus(); await page.keyboard.press('Enter');
    await page.getByRole('heading', { name: 'Your first plot is still blank paper.' }).waitFor();
    assert.equal(calls.filter(value => value === '/api/projects').length, before + 1);
    checks.push('Dashboard failure has a safe explicit keyboard retry and recovers to the confirmed empty state');
    await context.close();
  }
  {
    let release, reached;
    const started = new Promise(resolve => { reached = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const { context, page } = await isolated({ auth: route => route.fulfill({ json: { user } }), apiHandler: async (route, pathname) => {
      if (pathname !== '/api/projects') return false;
      reached(); await pending; await route.fulfill({ status: 401, json: { code: 'unauthenticated' } }).catch(() => {}); return true;
    } });
    await page.goto(origin + '/dashboard'); await started;
    await spa(page, '/plans');
    release(); await page.waitForTimeout(150);
    assert.equal(new URL(page.url()).pathname, '/plans');
    checks.push('Leaving dashboard aborts its read; a late unauthenticated result cannot redirect the next screen');
    await context.close();
  }
  {
    let mode = 'healthy', release, reached;
    const started = new Promise(resolve => { reached = resolve; });
    const pending = new Promise(resolve => { release = resolve; });
    const { context, page } = await isolated({ auth: async route => {
      if (mode === 'pending') { reached(); await pending; }
      await route.fulfill(mode === 'failed' ? { status: 503, json: { code: 'unavailable' } } : { json: { user } });
    } });
    await page.goto(origin + '/security'); await page.getByRole('heading', { name: /Protect your account/ }).waitFor();
    await spa(page, '/explore'); await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    mode = 'pending'; await page.evaluate(() => history.back()); await started;
    await page.getByRole('heading', { name: 'Checking your session…' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/security'); assert.equal(await page.locator('input').count(), 0);
    mode = 'failed'; release(); await page.getByRole('button', { name: 'Retry session check' }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/security');
    mode = 'healthy'; await page.getByRole('button', { name: 'Retry session check' }).click();
    await page.getByRole('heading', { name: /Protect your account/ }).waitFor();
    checks.push('Back from auth-free demo waits for a fresh session, retains the private URL on transport failure, and retries without a false sign-out');
    await context.close();
  }
  for (const publicPath of ['/estimate', '/explore']) {
    const { context, page, calls } = await isolated();
    await page.goto(origin + publicPath);
    await page.locator('main h1').waitFor();
    await page.evaluate(() => { dispatchEvent(new Event('focus')); dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(100);
    assert.equal(calls.includes('/api/auth/me'), false, 'A genuinely rendered public route stays authentication-free');
    assert.equal(new URL(page.url()).pathname, publicPath);
    checks.push(`${publicPath} remains auth-free on initial entry and focus/pageshow/visibility revalidation`);
    await context.close();
  }
  const projectId = '10000000-0000-4000-8000-000000000002';
  const model = createDemoBuilding(), tour = generateTour(model, { duration: 30 });
  const spatialPath = `/projects/${projectId}/spatial`;
  const view = { id: 'recovery-view', name: 'Saved view', buildingId: model.id, sourceRevision: model.revision, floorId: model.floors[0].id, position: [12000, 10000, 14000], target: [6000, 1500, 5000] };
  async function spatial(auth = route => route.fulfill({ json: { user } })) {
    return isolated({ auth, apiHandler: async (route, pathname) => {
      if (pathname !== `/api/projects/${projectId}/spatial`) return false;
      await route.fulfill({ json: { project: { id: projectId, name: 'Recovery fixture', inputRevision: 1, status: 'draft' }, model, tour, spatialRevision: 1, tourRevision: 1, cameraRevision: 1, viewpoints: [view], stale: false, tourStale: false } }); return true;
    } });
  }
  async function unloadPrevented(page) { return page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented; }); }
  async function dismissButton(page, selector) {
    let count = 0; const dialog = async dialog => { count++; await dialog.dismiss(); };
    page.on('dialog', dialog); await selector.click(); page.off('dialog', dialog);
    assert.equal(count, 1); assert.equal(new URL(page.url()).pathname, spatialPath);
  }
  {
    const { context, page } = await spatial();
    await page.goto(origin + '/plans'); await spa(page, spatialPath);
    await page.getByLabel('Name for viewpoint recovery-view').waitFor();
    assert.equal(await unloadPrevented(page), false);
    await spa(page, '/plans'); await page.evaluate(() => history.back());
    await page.getByLabel('Name for viewpoint recovery-view').waitFor();
    const length = await page.evaluate(() => history.length);
    await page.getByRole('button', { name: '2D Plan', exact: true }).click();
    await page.getByText('Scale overall dimensions', { exact: true }).click();
    await page.getByLabel('Overall width in metres').fill('13');
    await page.getByRole('button', { name: 'Preview dimensions' }).click();
    assert.equal(await unloadPrevented(page), true);
    await dismissButton(page, page.locator('.sp-brand'));
    await dismissButton(page, page.locator('.sp-back'));
    for (const direction of ['forward', 'back']) {
      let prompts = 0; const handle = async dialog => { prompts++; await dialog.dismiss(); };
      page.on('dialog', handle); await page.evaluate(direction => history[direction](), direction);
      await page.waitForTimeout(150); page.off('dialog', handle);
      assert.equal(prompts, 1, `${direction} prompts once`);
      assert.equal(new URL(page.url()).pathname, spatialPath);
      assert.equal(await page.evaluate(() => history.length), length);
      assert.equal(await page.getByLabel('Overall width in metres').inputValue(), '13');
    }
    // Exercise the browser's actual reload event, not just a synthetic unload.
    const nativeDialog = page.waitForEvent('dialog');
    await page.evaluate(() => setTimeout(() => location.reload(), 0));
    const dialog = await nativeDialog; assert.equal(dialog.type(), 'beforeunload'); await dialog.dismiss();
    await page.waitForTimeout(100); assert.equal(await page.getByLabel('Overall width in metres').inputValue(), '13');
    await page.getByRole('button', { name: 'Discard study', exact: true }).click();
    assert.equal(await unloadPrevented(page), false);
    let prompts = 0; const handle = async dialog => { prompts++; await dialog.dismiss(); };
    page.on('dialog', handle); await page.locator('.sp-back').click(); page.off('dialog', handle);
    assert.equal(prompts, 0); assert.equal(new URL(page.url()).pathname, `/projects/${projectId}`);
    checks.push('Dirty layout warns on Brand, Back, browser Back/Forward and actual reload; cancelling retains URL, history length and values; discard makes leaving prompt-free');
    await context.close();
  }
  {
    const { context, page } = await spatial(); await page.goto(origin + spatialPath);
    await page.getByLabel('Name for viewpoint recovery-view').waitFor();
    await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
    await page.getByLabel('Tour duration in seconds').fill('40');
    await dismissButton(page, page.locator('.sp-back'));
    await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click();
    await dismissButton(page, page.locator('.sp-back'));
    assert.equal(await unloadPrevented(page), true);
    page.once('dialog', dialog => dialog.accept()); await page.locator('.sp-back').click();
    assert.equal(new URL(page.url()).pathname, `/projects/${projectId}`);
    checks.push('Both pending itinerary edits and rebuilt unsaved tours warn; explicit acceptance leaves');
    await context.close();
  }
  {
    const { context, page } = await spatial(); await page.goto(origin + spatialPath);
    await page.getByLabel('Name for viewpoint recovery-view').fill('Unsaved camera name');
    await dismissButton(page, page.locator('.sp-brand')); assert.equal(await unloadPrevented(page), true);
    let prompts = 0; const handle = async dialog => { prompts++; await dialog.dismiss(); };
    page.on('dialog', handle);
    await page.evaluate(() => dispatchEvent(new StorageEvent('storage', { key: 'grihagrid.auth.logout', newValue: 'recovery-test-logout' })));
    await page.waitForURL(origin + '/'); page.off('dialog', handle);
    assert.equal(prompts, 0); assert.equal(await page.getByLabel('Name for viewpoint recovery-view').count(), 0);
    assert.equal(await unloadPrevented(page), false);
    checks.push('Unsaved camera names warn, while sibling-tab revocation forcibly removes private UI without a prompt');
    await context.close();
  }
  for (const publicPath of ['/plans', '/explore']) {
    for (const invalidation of ['sibling-logout', 'focus-unauthenticated']) {
      let authenticated = true;
      const { context, page, calls } = await spatial(route => route.fulfill(authenticated ? { json: { user } } : { status: 401, json: { code: 'unauthenticated' } }));
      await page.goto(origin + publicPath);
      if (publicPath === '/explore') await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
      else await page.locator('main h1').waitFor();
      await spa(page, spatialPath);
      await page.getByLabel('Name for viewpoint recovery-view').fill('Unsaved queued navigation');
      const readCount = calls.filter(path => path === `/api/projects/${projectId}/spatial`).length;
      await page.evaluate(() => {
        const nativeGo = history.go;
        window.__recoveryQueuedDeltas = [];
        history.go = delta => { window.__recoveryQueuedDeltas.push(delta); };
        window.__recoveryFlushTraversal = () => {
          history.go = nativeGo;
          const deltas = window.__recoveryQueuedDeltas.splice(0);
          for (const delta of deltas) nativeGo.call(history, delta);
        };
      });
      let prompts = 0; const dismiss = async dialog => { prompts++; await dialog.dismiss(); };
      page.on('dialog', dismiss);
      await page.evaluate(() => history.back());
      await page.waitForFunction(() => window.__recoveryQueuedDeltas?.length === 1);
      assert.equal(new URL(page.url()).pathname, publicPath, 'Address bar changes before queued restoration');
      assert.equal(await page.getByLabel('Name for viewpoint recovery-view').inputValue(), 'Unsaved queued navigation', 'Private screen is still mounted');
      if (invalidation === 'sibling-logout') {
        await page.evaluate(() => dispatchEvent(new StorageEvent('storage', { key: 'grihagrid.auth.logout', newValue: 'queued-recovery-test-logout' })));
      } else {
        authenticated = false;
        await page.evaluate(() => dispatchEvent(new Event('focus')));
      }
      await page.waitForURL(origin + '/');
      assert.equal(await page.getByLabel('Name for viewpoint recovery-view').count(), 0, 'Private cached UI is removed before traversal resumes');
      await page.evaluate(() => window.__recoveryFlushTraversal());
      await page.waitForTimeout(150);
      assert.equal(new URL(page.url()).pathname, '/');
      assert.equal(await page.getByLabel('Name for viewpoint recovery-view').count(), 0);
      assert.equal(calls.filter(path => path === `/api/projects/${projectId}/spatial`).length, readCount, 'No private remount/read after restoration');
      assert.equal(prompts, 1, 'Only the original unsaved traversal prompts');
      assert.equal(await unloadPrevented(page), false);
      page.off('dialog', dismiss);
      checks.push(`${invalidation} while cancelled Back temporarily shows ${publicPath}: private UI removed immediately and queued restoration cannot restore it`);
      await context.close();
    }
  }
  {
    const { context, page, calls } = await spatial(route => route.fulfill({ status: 401, json: { code: 'unauthenticated' } }));
    await page.goto(origin + spatialPath); await page.waitForURL(origin + '/login');
    await page.getByRole('heading', { name: 'Welcome back.' }).waitFor();
    assert.equal(calls.some(path => path.endsWith('/spatial')), false);
    assert.equal(await page.locator('.sp-workspace, .sp-saved-views').count(), 0);
    checks.push('Confirmed anonymous private studio entry redirects to login without mounting or requesting private project data');
    await context.close();
  }
  assert.equal(interceptedWrites, 0, `Unexpected mocked write paths: ${writePaths.join(', ')}`);
  assert.ok(mockedPublicEstimates >= 1, 'The homepage calculation mock is exercised explicitly');
  console.log(JSON.stringify({ outcome: 'passed', mode: built ? 'compiled-production-assets' : 'vite-development', blockedChunks: [...blockedChunks], browser: 'Separate headless Chrome; 390 px and 720 px CSS viewports', checks, mockedPublicEstimates, providerRequests: 0, remoteRequests: 0, interceptedWrites }, null, 2));
} finally {
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve)); else await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
