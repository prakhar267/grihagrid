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
let mockedHouseCreates = 0;
let mockedSpatialPreviews = 0;
let mockedSpatialCommits = 0;
let mockedLegacyEstimates = 0;
let remoteRequests = 0;
const diagnostics = { consoleErrors: [], failedRequests: [] };
try {
  if (!built) await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  async function isolated({ auth, blockSpatial = () => false, apiHandler, createHouse, firstSpatialSave } = {}) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const calls = [];
    // Recovery cases deliberately inject HTTP failures and blocked chunks.
    // Preserve their diagnostics; ordinary spatial rendering has a separate
    // zero-error harness rather than treating these injected errors as regressions.
    page.on('console', message => { if (message.type() === 'error') diagnostics.consoleErrors.push({ case: checks.length + 1, text: message.text().slice(0, 500) }); });
    page.on('requestfailed', request => diagnostics.failedRequests.push({ case: checks.length + 1, pathname: new URL(request.url()).pathname, error: request.failure()?.errorText }));
    await page.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin !== origin) { remoteRequests++; return route.abort(); }
      // Only the explicit legacy estimator may calculate a public range.
      // A calculation from the studio root remains an unexpected write.
      if (url.pathname === '/api/estimate' && request.method() === 'POST' && new URL(page.url()).pathname === '/estimate') {
        assert.deepEqual(request.postDataJSON(), { width: 30, length: 50, city: 'Bengaluru', floors: 'G+1', quality: 'Signature' });
        for (const header of ['cookie', 'authorization', 'x-csrf-token']) assert.equal(request.headers()[header], undefined);
        mockedLegacyEstimates++;
        return route.fulfill({ status: 503, json: { code: 'test_legacy_estimate_unavailable' } });
      }
      if (url.pathname === '/api/projects' && request.method() === 'POST' && createHouse) {
        mockedHouseCreates++;
        return createHouse(route, request);
      }
      if (firstSpatialSave && request.method() === 'POST' && [
        `/api/projects/${firstSpatialSave.projectId}/spatial/preview`,
        `/api/projects/${firstSpatialSave.projectId}/spatial`,
      ].includes(url.pathname)) return firstSpatialSave.handle(route, request, url.pathname);
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
    await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'grihagrid.auth.logout', newValue: 'recovery-test-logout' })));
    await page.waitForURL(origin + '/');
    release();
    await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    await page.waitForTimeout(250);
    assert.equal(calls.includes('/api/auth/sessions'), false);
    await page.getByText('You’re logged out. Private workspace data was cleared from this tab.').waitFor();
    await page.getByRole('button', { name: 'My houses', exact: true }).waitFor();
    checks.push('A sibling-tab logout fences a late successful bootstrap response');
    await context.close();
  }
  {
    let blocked = true;
    const { context, page } = await isolated({ blockSpatial: () => blocked });
    await page.goto(origin + '/');
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
    await page.getByRole('heading', { name: 'Your houses.', exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Make room for your first house.', exact: true }).waitFor();
    assert.equal(await page.locator('.project-list article').count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Retry projects' }).count(), 0);
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
  for (const publicPath of ['/', '/estimate', '/explore', '/share/report']) {
    const { context, page, calls } = await isolated();
    await page.goto(origin + publicPath);
    await page.locator('main h1').waitFor();
    await page.evaluate(() => { dispatchEvent(new Event('focus')); dispatchEvent(new Event('pageshow')); document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForTimeout(publicPath === '/estimate' ? 400 : 100);
    assert.equal(calls.includes('/api/auth/me'), false, 'A genuinely rendered public route stays authentication-free');
    assert.equal(new URL(page.url()).pathname, publicPath);
    checks.push(`${publicPath} remains auth-free on initial entry and focus/pageshow/visibility revalidation`);
    await context.close();
  }
  const projectId = '10000000-0000-4000-8000-000000000002';
  const model = createDemoBuilding(), tour = generateTour(model, { duration: 30 });
  const spatialPath = `/projects/${projectId}/spatial`;
  {
    let activeUser = user;
    const otherUser = { id: '10000000-0000-4000-8000-000000000004', name: 'Other account fixture', email: 'other-recovery@example.test' };
    const { context, page } = await isolated({ auth: route => route.fulfill({ json: { user: activeUser } }) });
    await page.goto(origin + '/houses/new');
    await page.getByRole('heading', { name: 'Begin a house.', exact: true }).waitFor();
    await page.getByLabel('Name', { exact: true }).fill('Private draft for the first account');
    await page.getByLabel('Plot width (feet)', { exact: true }).fill('47');
    activeUser = otherUser;
    const revalidated = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/me');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await revalidated;
    await page.waitForFunction(() => document.querySelector('.new-house-form input')?.value === '');
    assert.equal(await page.getByLabel('Name', { exact: true }).inputValue(), '');
    assert.equal(await page.getByLabel('Plot width (feet)', { exact: true }).inputValue(), '40');
    assert.equal(await page.locator('button[type="submit"]').isEnabled(), true);
    assert.equal(new URL(page.url()).pathname, '/houses/new');
    assert.equal(await page.evaluate(() => {
      const event = new Event('beforeunload', { cancelable: true }); dispatchEvent(event); return event.defaultPrevented;
    }), false, 'The previous account’s dirty draft and navigation guard are discarded');
    checks.push('New house focus revalidation to a different account resets the private name, plot details and dirty-navigation state before further creation');
    await context.close();
  }
  {
    const name = 'Studio creation fixture', csrfToken = 'synthetic-house-csrf';
    let created = false, createCalls = 0, originalKey, originalBody, releaseCreate, reachedCreate;
    let reviewedModel = null, savedModel = null;
    const pending = new Promise(resolve => { releaseCreate = resolve; });
    const reached = new Promise(resolve => { reachedCreate = resolve; });
    const project = { id: projectId, name, inputRevision: 1, status: 'feasibility_ready', reportAvailable: false, input: { width: 40, length: 50, city: 'Other', quality: 'Signature', floors: 'G' } };
    const spatialProjection = () => ({
      project: { id: projectId, name, status: project.status, inputRevision: 1 },
      model: savedModel, tour: null, spatialRevision: savedModel ? 1 : 0, tourRevision: 0,
      cameraRevision: 0, viewpoints: [], sourceInputRevision: savedModel ? 1 : null,
      stale: false, tourStale: false,
    });
    const { context, page, calls } = await isolated({
      auth: route => route.fulfill({ json: { user, csrfToken } }),
      createHouse: async (route, request) => {
        createCalls++;
        assert.ok(createCalls <= 2, 'One initial request and one explicit retry, without duplicate pending submissions');
        const body = request.postDataJSON();
        assert.deepEqual(body, { name, input: project.input });
        assert.equal(request.headers()['x-csrf-token'], csrfToken);
        assert.match(request.headers()['idempotency-key'], /^[0-9a-f-]{36}$/u);
        if (createCalls === 1) {
          originalKey = request.headers()['idempotency-key']; originalBody = body;
          created = true; // Model an accepted request whose response was lost.
          return route.fulfill({ status: 503, json: { code: 'test_creation_response_unavailable' } });
        }
        assert.equal(request.headers()['idempotency-key'], originalKey, 'Uncertain retry preserves request identity');
        assert.deepEqual(body, originalBody, 'Uncertain retry preserves exact submitted data');
        reachedCreate(); await pending;
        await route.fulfill({ status: 200, json: { project } });
      },
      firstSpatialSave: {
        projectId,
        handle: async (route, request, pathname) => {
          assert.ok(created, 'A house must exist before reviewing its first spatial model');
          assert.equal(savedModel, null, 'This fixture permits only the first spatial revision');
          assert.equal(request.headers()['x-csrf-token'], csrfToken);
          const body = request.postDataJSON();
          if (pathname.endsWith('/preview')) {
            mockedSpatialPreviews++;
            assert.equal(mockedSpatialPreviews, 1);
            assert.deepEqual(body, { expectedInputRevision: 1, expectedSpatialRevision: 0, model });
            reviewedModel = { ...structuredClone(body.model), revision: 1 };
            return route.fulfill({ json: {
              model: reviewedModel, baseRevision: 0, proposedRevision: 1,
              changeStudy: { summary: 'Save this reviewed layout as the first spatial concept for this project.', rooms: model.rooms.length, existingToursBecomeStale: false, estimateUnchanged: true },
            } });
          }
          mockedSpatialCommits++;
          assert.equal(mockedSpatialCommits, 1);
          assert.ok(reviewedModel, 'Commit requires a previously reviewed Change Study');
          assert.match(request.headers()['idempotency-key'], /^[0-9a-f-]{36}$/u);
          assert.deepEqual(body, { expectedInputRevision: 1, expectedSpatialRevision: 0, model: reviewedModel, acceptedImpact: true });
          savedModel = structuredClone(reviewedModel);
          return route.fulfill({ status: 201, json: spatialProjection() });
        },
      },
      apiHandler: async (route, pathname) => {
        if (pathname === '/api/projects') {
          await route.fulfill({ json: { projects: created ? [project] : [] } }); return true;
        }
        if (pathname === `/api/projects/${projectId}/spatial`) {
          assert.ok(created, 'Private model is read only after accepted project creation');
          await route.fulfill({ json: { ...spatialProjection(), history: savedModel ? [{ revision: 1, inputRevision: 1, createdAt: '2026-09-17 00:00:00' }] : [] } }); return true;
        }
        return false;
      },
    });
    await page.goto(origin + '/');
    await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
    assert.equal(calls.includes('/api/auth/me'), false);
    await page.getByRole('button', { name: 'My houses', exact: true }).click();
    await page.waitForURL(origin + '/dashboard');
    await page.getByRole('heading', { name: 'Your houses.', exact: true }).waitFor();
    await page.locator('.workspace-main > header').getByRole('button', { name: 'New house', exact: true }).click();
    await page.waitForURL(origin + '/houses/new');
    await page.getByRole('heading', { name: 'Begin a house.', exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.new-house-intro h1'));
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByRole('button', { name: 'Create house', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Retry creation', exact: true }).waitFor().catch(async error => {
      console.error(JSON.stringify({ diagnostic: 'house-create-retry', createCalls, pathname: new URL(page.url()).pathname,
        form: await page.locator('.new-house-form').evaluate(form => ({ busy: form.getAttribute('aria-busy'),
          activeTag: document.activeElement?.tagName, activeText: document.activeElement?.textContent?.slice(0, 100),
          fields: [...form.querySelectorAll('input,select')].map(field => ({ label: field.closest('label')?.childNodes[0]?.textContent, valid: field.validity.valid, disabled: field.matches(':disabled'), empty: !field.value })),
          submitText: form.querySelector('button[type="submit"]')?.textContent, error: form.querySelector('[role="alert"]')?.textContent })),
      })); throw error;
    });
    assert.equal(createCalls, 1);
    assert.equal(await page.getByLabel('Name', { exact: true }).isDisabled(), true);
    assert.equal(await page.locator('.new-house-form').getByRole('combobox').isDisabled(), true);
    assert.equal(await page.getByLabel('Plot width (feet)', { exact: true }).isDisabled(), true);
    assert.equal(await page.getByLabel('Plot depth (feet)', { exact: true }).isDisabled(), true);
    await page.getByRole('button', { name: 'Retry creation', exact: true }).press('Enter'); await reached;
    assert.equal(await page.locator('button[type="submit"]').isDisabled(), true);
    await page.keyboard.press('Enter');
    assert.equal(createCalls, 2);
    releaseCreate();
    await page.waitForURL(origin + spatialPath);
    await page.getByRole('heading', { name: name + '.', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: '2D Plan', exact: true }).getAttribute('aria-current'), 'page');
    await page.getByRole('heading', { name: 'Everything in its place.', exact: true }).waitFor();
    await page.getByText('Import a drawing or edit this sample, then review the concept before saving.', { exact: true }).waitFor();
    // Compact layouts hide the supplementary metadata; the sample instruction
    // above must remain visible, while this label still reflects model state.
    assert.match(await page.locator('.sp-heading-meta').textContent(), /Sample geometry/u);
    assert.equal(savedModel, null, 'Creating the house never silently saves the sample model');
    await page.getByRole('button', { name: 'Review Change Study', exact: true }).click();
    await page.getByRole('region', { name: 'Spatial Change Study', exact: true }).waitFor();
    await page.getByText('Save this reviewed layout as the first spatial concept for this project.', { exact: true }).waitFor();
    assert.equal(savedModel, null, 'Review remains read-only until explicit acceptance');
    await page.getByRole('button', { name: 'Accept concept revision', exact: true }).click();
    await page.getByRole('region', { name: 'Spatial Change Study', exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(savedModel, model);
    assert.match(await page.locator('.sp-heading-meta').textContent(), /Saved concept/u);
    assert.equal(await page.getByRole('button', { name: 'Review Change Study', exact: true }).count(), 0);
    await page.reload();
    await page.getByRole('heading', { name: name + '.', exact: true }).waitFor();
    assert.match(await page.locator('.sp-heading-meta').textContent(), /Saved concept/u);
    assert.equal(await page.getByRole('button', { name: 'Review Change Study', exact: true }).count(), 0);
    assert.equal(await page.getByText('Import a drawing or edit this sample, then review the concept before saving.', { exact: true }).count(), 0);
    assert.equal(createCalls, 2, 'Reload never creates another house');
    await page.getByRole('button', { name: 'My houses', exact: true }).click();
    await page.waitForURL(origin + '/dashboard');
    const card = page.locator('.project-list article').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.getByRole('button', { name: 'Open studio', exact: true }).click();
    await page.waitForURL(origin + spatialPath);
    await page.getByRole('heading', { name: name + '.', exact: true }).waitFor();
    checks.push('Root studio → My houses → New house: uncertain 503 locks details; explicit retry uses the same CSRF/idempotency-protected payload; pending Enter cannot duplicate; canonical replay opens the unsaved sample in 2D with an honest notice; Change Study preview is read-only and explicit acceptance saves the first model; reload and dashboard Open studio reuse the saved house');
    await context.close();
  }
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
    await dismissButton(page, page.getByRole('button', { name: 'Project details', exact: true }));
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
    page.on('dialog', handle); await page.getByRole('button', { name: 'Project details', exact: true }).click(); page.off('dialog', handle);
    assert.equal(prompts, 0); assert.equal(new URL(page.url()).pathname, `/projects/${projectId}`);
    checks.push('Dirty layout warns on Brand, Back, browser Back/Forward and actual reload; cancelling retains URL, history length and values; discard makes leaving prompt-free');
    await context.close();
  }
  {
    const { context, page } = await spatial(); await page.goto(origin + spatialPath);
    await page.getByLabel('Name for viewpoint recovery-view').waitFor();
    await page.getByRole('button', { name: 'Camera Tour', exact: true }).click();
    await page.getByLabel('Tour duration in seconds').fill('40');
    await dismissButton(page, page.getByRole('button', { name: 'Project details', exact: true }));
    await page.getByRole('button', { name: 'Rebuild tour', exact: true }).click();
    await dismissButton(page, page.getByRole('button', { name: 'Project details', exact: true }));
    assert.equal(await unloadPrevented(page), true);
    page.once('dialog', dialog => dialog.accept()); await page.getByRole('button', { name: 'Project details', exact: true }).click();
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
  for (const publicPath of ['/plans', '/', '/explore']) {
    for (const invalidation of ['sibling-logout', 'focus-unauthenticated']) {
      let authenticated = true;
      const { context, page, calls } = await spatial(route => route.fulfill(authenticated ? { json: { user } } : { status: 401, json: { code: 'unauthenticated' } }));
      await page.goto(origin + publicPath);
      if (publicPath === '/' || publicPath === '/explore') await page.getByRole('heading', { name: 'The Courtyard House.' }).waitFor();
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
      // For the root destination the address bar was already '/'; wait for
      // React's invalidation commit before resuming the held native traversal.
      await page.getByLabel('Name for viewpoint recovery-view').waitFor({ state: 'detached' });
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
  assert.equal(mockedHouseCreates, 2, 'One logical house creation and its explicit identical retry are mocked');
  assert.equal(mockedSpatialPreviews, 1, 'Exactly one first-model Change Study is previewed');
  assert.equal(mockedSpatialCommits, 1, 'Exactly one first-model revision is explicitly accepted');
  assert.equal(mockedLegacyEstimates, 1, 'Only the separately opened legacy estimator computes a public range');
  assert.equal(remoteRequests, 0, 'No requests may leave the isolated local origin');
  console.log(JSON.stringify({ outcome: 'passed', checkedAt: new Date().toISOString(), mode: built ? 'compiled-production-assets' : 'vite-development', blockedChunks: [...blockedChunks], browser: 'Separate headless Chrome; 390 px and 720 px CSS viewports', checks, mockedHouseCreates, mockedSpatialPreviews, mockedSpatialCommits, mockedLegacyEstimates, providerRequests: 0, remoteRequests, interceptedWrites, diagnosticsScope: 'Includes deliberately injected HTTP failures, chunk failures and aborted navigation reads', diagnostics }, null, 2));
} finally {
  await browser?.close();
  if (built) await new Promise(resolve => server.httpServer.close(resolve)); else await server.close();
  await rm(cacheDir, { recursive: true, force: true });
}
