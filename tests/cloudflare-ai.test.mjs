import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import test from 'node:test';
import { Miniflare } from 'miniflare';
import worker, { __test } from '../worker/index.js';
import { createCloudflareAi, CLOUDFLARE_AI_MODEL } from '../worker/cloudflare-ai.js';
import { createDemoBuilding, toV2 } from '../src/spatial/model.js';
import { generateTour, validateTour } from '../src/spatial/tours.js';
import { defaultHouseBrief } from '../src/spatial/house-brief.js';
import { generateBriefLayout } from '../src/spatial/brief-layout.js';

const consent = { acceptedAiTerms: true, aiProviders: ['cloudflare'] };
const both = { ...consent, aiProviders: ['cloudflare', 'gemini'] };
const brief = {
  headline: 'A measured three-storey family house',
  overview: 'Review the family programme against the site survey and daylight needs before asking a local architect to prepare coordinated drawings.',
  planningPriorities: ['Review the household room programme.', 'Confirm access and local planning requirements.', 'Coordinate the stair across all three floors.'],
  layoutSuggestions: ['Keep the kitchen close to the dining space.', 'Review daylight in the deeper rooms.', 'Reserve a clear route between the entrance and stairs.'],
  costAndDeliveryNotes: ['Request itemized quotations after coordinated drawings.', 'Confirm quantities with the appointed project team.'],
  riskFlags: ['Local setbacks and permissible height remain unverified.', 'A qualified engineer needs to review ground conditions.'],
  questionsForArchitect: ['Which local rules apply to this plot?', 'How will services connect between the floors?', 'Which rooms need more daylight or ventilation?'],
};
const gemini = () => new Response(JSON.stringify({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: JSON.stringify(brief) }] }] }));
const options = { schema: __test.AI_BRIEF_RESPONSE_SCHEMA, validate: __test.validateAiBriefContent, reserveCloudflare: async () => {} };

test('live-model walk preferences generate distinct travel and subject shots across three floors', () => {
  const houseBrief = defaultHouseBrief({ floors: 'G+2', city: 'Jaipur' });
  houseBrief.setbacks = { front: 1, back: 1, left: 1, right: 1 };
  const { model } = generateBriefLayout(houseBrief);
  const roomIds = ['brief-r1', 'brief-r6', 'brief-r8'];
  const shotPreferences = roomIds.map(roomId => ({ roomId, subjectId: model.furniture.find(item => item.roomId === roomId).id, kind: 'walk', pace: 'normal' }));
  const tour = generateTour(model, { roomIds, duration: 45, eyeHeight: 1650, shotPreferences, source: 'cloudflare' });
  assert.equal(validateTour(model, tour).valid, true);
  assert.equal(new Set(tour.shots.map(shot => shot.id)).size, tour.shots.length);
  assert.equal(new Set(tour.shots.map(shot => shot.floorId).filter(Boolean)).size, 3);
  assert.ok(Math.abs(tour.shots.reduce((sum, shot) => sum + shot.duration, 0) - 45) < 0.001);
});

test('Cloudflare selection requires explicit processor consent and keeps fallback optional', () => {
  const env = { AI: { run() {} }, GEMINI_API_KEY: 'test-gemini-secret', AI_GEMINI_FALLBACK: 'true' };
  assert.equal(__test.requireAiConfig(env, consent).provider, 'cloudflare');
  assert.equal(__test.requireAiConfig(env, consent).fallback, null);
  assert.equal(__test.requireAiConfig(env, both).fallback.provider, 'gemini');
  assert.throws(() => __test.requireAiConfig(env, { acceptedAiTerms: true }), error => error.code === 'ai_terms_required');
  for (const aiProviders of [null, [], ['unknown'], ['cloudflare', 'cloudflare'], 'cloudflare']) {
    assert.throws(() => __test.requireAiConfig(env, { ...consent, aiProviders }), error => error.code === 'invalid_ai_request');
  }
  assert.throws(() => __test.requireAiConfig({ ...env, CLOUDFLARE_AI_MODEL: '@cf/paid-model' }, consent), error => error.code === 'ai_unavailable');
  assert.throws(() => __test.requireAiConfig({ AI_PROVIDER: 'cloudflare', GEMINI_API_KEY: 'test-gemini-secret' }, both), error => error.code === 'ai_unavailable');
  const missingBinding = { AI_PROVIDER: 'cloudflare', AI_GEMINI_FALLBACK: 'true', GEMINI_API_KEY: 'test-gemini-secret' };
  assert.throws(() => __test.requireAiConfig(missingBinding, consent), error => error.code === 'ai_terms_required');
  assert.equal(__test.requireAiConfig(missingBinding, both).provider, 'gemini');
});

test('Cloudflare bounds input/output, normalizes both JSON forms and never falls back from invalid output', async () => {
  let calls = 0, fallback = 0, reservations = 0;
  const env = { AI: { run: async (model, input) => {
    calls++; assert.equal(model, CLOUDFLARE_AI_MODEL); assert.equal(input.max_tokens, 1600); assert.equal(input.stream, false);
    return { response: calls === 1 ? brief : JSON.stringify(brief), usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 } };
  } }, GEMINI_API_KEY: 'test-gemini-secret', AI_GEMINI_FALLBACK: 'true', GEMINI_FETCH: async () => { fallback++; return gemini(); } };
  const config = __test.requireAiConfig(env, both);
  const run = prompt => __test.callAiJson(env, prompt, config, { ...options, reserveCloudflare: async () => { reservations++; } });
  for (let index = 0; index < 2; index++) {
    const result = await run('Sanitized planning facts');
    assert.equal(result.provider, 'cloudflare'); assert.equal(result.usage.totalTokens, 150);
  }
  for (const response of ['not json', { ...brief, secret: 'unexpected' }, { ...brief, overview: 'This house is structurally safe and fully code-compliant.' }, 'x'.repeat(65_537)]) {
    env.AI.run = async () => ({ response });
    await assert.rejects(run('Safe facts'), error => error.status === 502 && !error.message.includes('structurally'));
  }
  assert.equal(fallback, 0);
  const before = reservations;
  const oversized = await run('घर'.repeat(6000));
  assert.equal(oversized.provider, 'gemini'); assert.equal(reservations, before); assert.equal(fallback, 1);
  await assert.rejects(__test.callAiJson(env, 'x'.repeat(13000), __test.requireAiConfig(env, consent), options), error => error.code === 'ai_capacity_unavailable');
});

test('Cloudflare outage allows only one consented Gemini call; deadlines redact provider errors', async () => {
  let fallback = 0;
  const env = { AI: { run: async () => { throw new Error('private upstream detail'); } }, GEMINI_API_KEY: 'test-gemini-secret', AI_GEMINI_FALLBACK: 'true', GEMINI_FETCH: async () => { fallback++; return new Response('private', { status: 503 }); } };
  await assert.rejects(__test.callAiJson(env, 'facts', __test.requireAiConfig(env, consent), options), error => error.code === 'ai_capacity_unavailable' && !error.message.includes('private'));
  assert.equal(fallback, 0);
  await assert.rejects(__test.callAiJson(env, 'facts', __test.requireAiConfig(env, both), options));
  assert.equal(fallback, 1);
  class SafeError extends Error { constructor(status, message, code) { super(message); this.status = status; this.code = code; } }
  const adapter = createCloudflareAi(SafeError);
  await assert.rejects(adapter.run({ AI: { run: () => new Promise(() => {}) } }, CLOUDFLARE_AI_MODEL, {}, value => value, 5), error => error.status === 503);
});

const ORIGIN = 'https://app.example.test';
function request(path, owner, body, method = body === undefined ? 'GET' : 'POST') {
  return new Request(ORIGIN + path, { method, headers: {
    origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), 'cf-connecting-ip': '192.0.2.10',
    ...(owner ? { cookie: owner.cookies, 'x-csrf-token': owner.csrfToken } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function expect(response, status) {
  const body = await response.json(); assert.equal(response.status, status, JSON.stringify(body)); return body;
}
function statements(source) {
  const result = []; let lines = [], trigger = false;
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line.startsWith('--') || /^PRAGMA\s+/i.test(line)) continue;
    if (!lines.length) trigger = /^CREATE\s+TRIGGER\b/i.test(line);
    lines.push(raw);
    if (trigger ? /\bEND;\s*$/i.test(line) : /;\s*$/.test(line)) { result.push(lines.join('\n')); lines = []; trigger = false; }
  }
  assert.equal(lines.length, 0); return result;
}

test('real D1 Cloudflare planning and camera direction enforce privacy, revisions, quota, provenance and recovery', async context => {
  const mf = new Miniflare({ workers: [{ config: { name: 'cloudflare-ai-test', type: 'worker', compatibilityDate: '2026-08-01', manifest: { mainModule: 'index.mjs', modulesRoot: process.cwd(), modules: { 'index.mjs': { type: 'esm', contents: 'export default {}' } } }, env: { DB: { type: 'd1', name: 'cloudflare-ai-test' } } } }] });
  context.after(() => mf.dispose());
  const DB = await mf.getD1Database('DB');
  const root = new URL('../migrations/', import.meta.url);
  for (const file of (await readdir(root)).filter(name => name.endsWith('.sql')).sort()) for (const sql of statements(await readFile(new URL(file, root), 'utf8'))) await DB.prepare(sql).run();
  const kv = new Map(); let cloudCalls = 0, geminiCalls = 0, outbound;
  const env = { DB, APP_ENV: 'staging', APP_ORIGIN: ORIGIN, REPORT_SHARE_ABUSE_HMAC_KEY: 'ab'.repeat(32), ASSETS: { fetch: async () => new Response('missing', { status: 404 }) },
    GRIHAGRID_CACHE: { get: async key => kv.get(key) || null, put: async (key, value) => kv.set(key, value) },
    AI_PROVIDER: 'cloudflare', AI_GEMINI_FALLBACK: 'true', GEMINI_API_KEY: 'test-server-gemini-key',
    AI: { run: async (_model, input) => { cloudCalls++; outbound = JSON.stringify(input); return { response: brief }; } },
    GEMINI_FETCH: async () => { geminiCalls++; return gemini(); },
  };
  async function createOwner(city) {
    const response = await worker.fetch(request('/api/auth/register', null, { email: `${city.toLowerCase()}@example.test`, password: 'correct horse battery staple' }), env);
    const registration = await expect(response, 201);
    const owner = { cookies: response.headers.getSetCookie().map(value => value.split(';', 1)[0]).join('; '), csrfToken: registration.csrfToken };
    const created = await expect(await worker.fetch(request('/api/projects', owner, { name: 'PRIVATE-CUSTOMER-NAME', input: { width: 30, length: 50, floors: 'G+2', city, quality: 'Signature', style: 'PRIVATE-CUSTOMER-NOTE' } }), env), 201);
    owner.project = created.project;
    await expect(await worker.fetch(request(`/api/projects/${owner.project.id}/report`, owner, {}), env), 201);
    return owner;
  }
  const jaipur = await createOwner('Jaipur'), delhi = await createOwner('Delhi');
  const path = `/api/projects/${jaipur.project.id}/ai-brief`;
  await context.test('consent, ownership and CSRF precede provider admission', async () => {
    await expect(await worker.fetch(request(path, jaipur, { acceptedAiTerms: true }), env), 400);
    await expect(await worker.fetch(request(path, delhi, consent), env), 404);
    await expect(await worker.fetch(request(path, { ...jaipur, csrfToken: 'invalid' }, consent), env), 403);
    assert.equal(cloudCalls, 0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM ai_generation_counters').first()).n, 0);
  });
  await context.test('planning persists actual provider, cache skips inference, prompt excludes private data', async () => {
    const result = await expect(await worker.fetch(request(path, jaipur, consent), env), 201);
    assert.equal(result.aiBrief.provider, 'cloudflare'); assert.equal(result.aiBrief.model, CLOUDFLARE_AI_MODEL);
    for (const value of ['PRIVATE-CUSTOMER', jaipur.project.id, 'jaipur@example.test']) assert.equal(outbound.includes(value), false);
    assert.equal((await expect(await worker.fetch(request(path, jaipur, consent), env), 200)).cached, true);
    assert.equal((await expect(await worker.fetch(request(path, jaipur), env), 200)).aiBrief.provider, 'cloudflare');
    assert.equal(cloudCalls, 1); assert.equal(geminiCalls, 0);
  });
  await context.test('free budget reservations are atomic and quota fallback is explicitly authorized', async () => {
    env.CLOUDFLARE_AI_DAILY_NEURONS = '700';
    await expect(await worker.fetch(request(path, jaipur, { ...consent, refresh: true }), env), 503);
    assert.equal(cloudCalls, 1); assert.equal(geminiCalls, 0);
    const fallback = await expect(await worker.fetch(request(path, jaipur, { ...both, refresh: true }), env), 200);
    assert.equal(fallback.aiBrief.provider, 'gemini'); assert.equal(geminiCalls, 1);
    assert.equal((await expect(await worker.fetch(request(path, jaipur, both), env), 200)).cached, true);
    assert.equal(geminiCalls, 1);
    assert.equal((await DB.prepare("SELECT request_count FROM ai_generation_counters WHERE subject_id='cloudflare_neurons'").first()).request_count, 700);
    delete env.CLOUDFLARE_AI_DAILY_NEURONS;
  });
  await context.test('camera uses anonymous references and Cloudflare source survives saved tour validation', async () => {
    const spatialPath = `/api/projects/${delhi.project.id}/spatial`;
    const model = toV2(createDemoBuilding({ id: 'cloudflare-house' }));
    const saved = await expect(await worker.fetch(request(spatialPath, delhi, { expectedInputRevision: 1, expectedSpatialRevision: 0, model, acceptedImpact: true }), env), 201);
    const accepted = saved.model;
    const intent = { roomIds: [accepted.rooms[0].id], duration: 30, eyeHeight: 1650, shotPreferences: [] };
    env.AI.run = async (_model, input) => { cloudCalls++; outbound = JSON.stringify(input); const data = JSON.parse(input.messages[0].content.split('Data: ')[1]); return { response: { ...data.requested, shotPreferences: [] } }; };
    const directed = await expect(await worker.fetch(request(spatialPath + '/tour-intent', delhi, { expectedInputRevision: 1, expectedSpatialRevision: 1, ...consent, intent }), env), 200);
    assert.equal(directed.source, 'cloudflare'); assert.equal(directed.model, CLOUDFLARE_AI_MODEL);
    assert.deepEqual(directed.intent, intent);
    assert.equal(outbound.includes(accepted.rooms[0].name), false); assert.equal(outbound.includes('PRIVATE-CUSTOMER'), false);
    const tour = { ...generateTour(accepted, directed.intent), source: directed.source };
    assert.equal(validateTour(accepted, tour).valid, true);
    await expect(await worker.fetch(request(spatialPath + '/tour', delhi, { expectedInputRevision: 1, expectedSpatialRevision: 1, expectedTourRevision: 0, tour }), env), 201);
    assert.equal((await expect(await worker.fetch(request(spatialPath, delhi), env), 200)).tour.source, 'cloudflare');
    env.AI.run = async () => ({ response: { roomIds: ['invented'], duration: 30 } });
    await expect(await worker.fetch(request(spatialPath + '/tour-intent', delhi, { expectedInputRevision: 1, expectedSpatialRevision: 1, ...both, intent }), env), 502);
    assert.equal(geminiCalls, 1);
  });
  await context.test('concurrent reservations admit only the remaining free allocation', async () => {
    const now = new Date();
    const source = 'a'.repeat(64);
    const user = await DB.prepare('SELECT user_id FROM projects WHERE id=?').bind(delhi.project.id).first();
    const lease = await __test.acquireAiGenerationAdmission(DB, delhi.project.id, user.user_id, source, now);
    const results = await Promise.allSettled([1, 2, 3].map(() => __test.reserveCloudflareAi(DB, env, delhi.project.id, lease, source, now)));
    // Three preceding Cloudflare calls reserved 2100 of staging's 2800 neurons.
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected' && result.reason.code === 'ai_capacity_unavailable').length, 2);
    await __test.releaseAiGenerationLease(DB, delhi.project.id, user.user_id, lease);
  });
});
