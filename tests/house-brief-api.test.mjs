import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import worker from '../worker/index.js';
import { defaultHouseBrief } from '../src/spatial/house-brief.js';
import { generateBriefLayout } from '../src/spatial/brief-layout.js';

const ORIGIN = 'https://app.example.test';
function statements(source) {
  const output = []; let lines = [], trigger = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('--') || /^PRAGMA\s+/i.test(line)) continue;
    if (!lines.length) trigger = /^CREATE\s+TRIGGER\b/i.test(line); lines.push(raw);
    if (trigger ? /\bEND;\s*$/i.test(line) : /;\s*$/.test(line)) { output.push(lines.join('\n')); lines = []; trigger = false; }
  }
  assert.equal(lines.length, 0); return output;
}
function request(path, user, body, { key = crypto.randomUUID(), csrf = user?.csrf, method = body === undefined ? 'GET' : 'POST' } = {}) {
  return new Request(ORIGIN + path, { method, headers: { origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': key, ...(user ? { cookie: user.cookies, 'x-csrf-token': csrf || '' } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expect(response, status) { const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body; }

test('house brief survives real D1 creation, revision, private reads and accepted geometry', async context => {
  const mf = new Miniflare({ workers: [{ config: { name: 'house-brief-test', type: 'worker', compatibilityDate: '2026-08-01', manifest: { mainModule: 'index.mjs', modulesRoot: process.cwd(), modules: { 'index.mjs': { type: 'esm', contents: 'export default {}' } } }, env: { DB: { type: 'd1', name: 'house-brief-test-db' } } } }] });
  context.after(() => mf.dispose());
  const db = await mf.getD1Database('DB'), directory = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(directory)).filter(f => f.endsWith('.sql')).sort()) for (const sql of statements(await readFile(new URL(file, directory), 'utf8'))) await db.prepare(sql).run();
  const kv = new Map();
  const env = { DB: db, ASSETS: { fetch: async () => new Response('missing', { status: 404 }) }, GRIHAGRID_CACHE: { get: async key => kv.get(key) || null, put: async (key, value) => kv.set(key, value) } };
  async function register(email) { const response = await worker.fetch(request('/api/auth/register', null, { email, password: 'synthetic scenario account password' }), env); const body = await expect(response, 201); return { csrf: body.csrfToken, cookies: response.headers.getSetCookie().map(v => v.split(';', 1)[0]).join('; ') }; }
  const owner = await register('scenario-owner@example.test'), stranger = await register('scenario-stranger@example.test');
  const brief = defaultHouseBrief({ floors: 'G+3' }); brief.city = 'Lucknow'; brief.locality = 'PRIVATE TEST LOCALITY'; brief.notes = 'PRIVATE TEST REQUIREMENTS'; brief.setbacks = { front: 1, back: 1, left: 1, right: 1 };
  const body = { name: 'Synthetic four-floor scenario', input: { width: 40, length: 50, quality: 'Signature' }, houseBrief: brief }, key = crypto.randomUUID();
  let project;
  await context.test('create and safe retry keep exact brief and four-storey context', async () => {
    const created = await expect(await worker.fetch(request('/api/projects', owner, body, { key }), env), 201); project = created.project;
    assert.equal(project.input.floors, 'G+3'); assert.equal(Object.hasOwn(project.input, 'houseBrief'), false);
    const replay = await worker.fetch(request('/api/projects', owner, body, { key }), env); assert.ok([200, 201].includes(replay.status)); assert.equal((await replay.json()).project.id, project.id);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
  });
  const path = `/api/projects/${project.id}`;
  await context.test('new spatial read returns saved brief but never pretends there is an accepted model', async () => {
    const opened = await expect(await worker.fetch(request(path + '/spatial', owner), env), 200);
    assert.deepEqual(opened.houseBrief, brief); assert.equal(opened.model, null); assert.equal(opened.spatialRevision, 0);
    await expect(await worker.fetch(request(path + '/spatial', stranger), env), 404);
  });
  await context.test('malformed nested requirements and CSRF failures persist nothing', async () => {
    const bad = structuredClone(body); bad.houseBrief.rooms[0].floor = 4;
    await expect(await worker.fetch(request('/api/projects', owner, bad), env), 400);
    await expect(await worker.fetch(request(path + '/spatial/brief-preview', owner, { expectedInputRevision: 1, expectedSpatialRevision: 0, expectedBriefRevision: 1, brief }, { csrf: '' }), env), 403);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM projects').first()).n, 1);
  });
  let model;
  await context.test('generated four-floor geometry previews read-only then accepts once', async () => {
    model = generateBriefLayout(brief).model;
    const base = { expectedInputRevision: 1, expectedSpatialRevision: 0, expectedBriefRevision: 1, model };
    await expect(await worker.fetch(request(path + '/spatial/preview', owner, base), env), 200);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM spatial_revisions').first()).n, 0);
    const saved = await expect(await worker.fetch(request(path + '/spatial', owner, { ...base, acceptedImpact: true }), env), 201);
    assert.equal(saved.model.floors.length, 4); assert.equal(saved.spatialRevision, 1);
  });
  await context.test('brief revision is immutable, replay-safe and marks existing geometry stale', async () => {
    const revised = structuredClone(brief); revised.rooms[0].areaM2 = 30;
    const draft = { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedBriefRevision: 1, brief: revised };
    const preview = await expect(await worker.fetch(request(path + '/spatial/brief-preview', owner, draft), env), 200);
    assert.equal(preview.proposedRevision, 2);
    assert.equal((await expect(await worker.fetch(request(path + '/spatial', owner), env), 200)).project.inputRevision, 1);
    const revisionKey = crypto.randomUUID(), commit = { ...draft, acceptedImpact: true };
    const saved = await worker.fetch(request(path + '/spatial/brief', owner, commit, { key: revisionKey }), env); assert.ok([200, 201].includes(saved.status), JSON.stringify(await saved.clone().json()));
    const replay = await worker.fetch(request(path + '/spatial/brief', owner, commit, { key: revisionKey }), env); assert.equal(replay.status, 200);
    const opened = await expect(await worker.fetch(request(path + '/spatial', owner), env), 200);
    assert.equal(opened.project.inputRevision, 1); assert.equal(opened.briefRevision, 2); assert.equal(opened.houseBrief.rooms[0].areaM2, 30); assert.equal(opened.stale, true); assert.deepEqual(opened.model, model);
    const original = await db.prepare('SELECT brief_json FROM house_brief_revisions WHERE project_id=? AND revision=1').bind(project.id).first(); assert.equal(JSON.parse(original.brief_json).rooms[0].areaM2, 18);
    await expect(await worker.fetch(request(path + '/spatial/brief', owner, { ...draft, brief, acceptedImpact: true }), env), 409);
  });
  await context.test('stale brief sources cannot accept layouts, cameras or tours', async () => {
    const base = { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedBriefRevision: 1, model };
    await expect(await worker.fetch(request(path + '/spatial', owner, { ...base, acceptedImpact: true }), env), 409);
    await expect(await worker.fetch(request(path + '/spatial/preview', owner, { ...base, expectedBriefRevision: '2' }), env), 400);
    for (const action of ['tour', 'viewpoints']) await expect(await worker.fetch(request(path + '/spatial/' + action, owner, { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedBriefRevision: 2 }), env), 409);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM spatial_revisions').first()).n, 1);
    await assert.rejects(db.prepare('UPDATE house_brief_revisions SET input_revision=2 WHERE project_id=?').bind(project.id).run(), /immutable/);
  });
  await context.test('concurrent house brief edits save one revision and preserve the losing draft', async () => {
    const opened = await expect(await worker.fetch(request(path + '/spatial', owner), env), 200);
    const a = { ...opened.houseBrief, notes: 'Concurrent A' }, b = { ...opened.houseBrief, notes: 'Concurrent B' };
    const results = await Promise.all([a, b].map(brief => worker.fetch(request(path + '/spatial/brief', owner, { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedBriefRevision: 2, brief, acceptedImpact: true }), env)));
    assert.deepEqual(results.map(r => r.status).sort(), [201, 409]);
    assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM house_brief_revisions').first()).n, 3);
    assert.equal(a.notes, 'Concurrent A'); assert.equal(b.notes, 'Concurrent B');
  });
  await context.test('account export contains the owner brief history and excludes another account', async () => {
    const own = await expect(await worker.fetch(request('/api/account/export', owner), env), 200);
    assert.equal(own.houseBriefs.length, 3); assert.deepEqual(own.houseBriefs[0].brief, brief);
    assert.ok(own.houseBriefs.every(row => row.projectId === project.id));
    assert.equal(JSON.stringify(own.houseBriefs).includes('request_hash'), false);
    const other = await expect(await worker.fetch(request('/api/account/export', stranger), env), 200);
    assert.deepEqual(other.houseBriefs, []); assert.equal(JSON.stringify(other).includes('PRIVATE TEST'), false);
  });
  await context.test('archived houses retain the brief but reject new revisions', async () => {
    await expect(await worker.fetch(request(path, owner, { status: 'archived' }, { method: 'PATCH' }), env), 200);
    await expect(await worker.fetch(request(path + '/spatial/brief-preview', owner, { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedBriefRevision: 3, brief }), env), 409);
    const opened = await expect(await worker.fetch(request(path + '/spatial', owner), env), 200); assert.equal(opened.project.status, 'archived'); assert.equal(opened.houseBrief.city, 'Lucknow');
  });
});
