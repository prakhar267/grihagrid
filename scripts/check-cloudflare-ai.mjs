// Explicit, bounded live verification. No deployment, remote DB or customer data.
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { __test } from '../worker/index.js';
import { defaultHouseBrief } from '../src/spatial/house-brief.js';
import { generateBriefLayout } from '../src/spatial/brief-layout.js';
import { generateTour, validateTour } from '../src/spatial/tours.js';
import { providerIntentContext, tourIntentResponseSchema, spatialIntentPrompt, validateSpatialIntent, preservesRequestedDirection } from '../worker/spatial-intent.js';

if (!process.argv.includes('--live')) throw new Error('Pass --live to use up to four Cloudflare AI requests from the free account allowance.');
const directory = await mkdtemp(join(tmpdir(), 'grihagrid-ai-canary-'));
let proxy;
let phase = 'connect';
try {
  const configPath = join(directory, 'wrangler.json');
  await writeFile(configPath, JSON.stringify({ name: 'grihagrid-ai-canary', compatibility_date: '2026-08-01', ai: { binding: 'AI', remote: true } }));
  proxy = await getPlatformProxy({ configPath, persist: false, remoteBindings: true, envFiles: [] });
  const env = { AI: { run: async (...args) => {
    const started = Date.now();
    try { return await proxy.env.AI.run(...args); }
    catch (error) {
      const message = String(error?.message || '');
      console.error(JSON.stringify({ providerFailure: true, durationMs: Date.now() - started,
        numericCodes: message.match(/\b\d{3,6}\b/g) || [],
        categories: ['json', 'schema', 'authentication', 'permission', 'quota', 'neurons', 'timeout', 'model', 'fetch', 'not found'].filter(value => message.toLowerCase().includes(value)),
      }));
      throw error;
    }
  } }, AI_PROVIDER: 'cloudflare' };
  const config = __test.requireAiConfig(env, { acceptedAiTerms: true, aiProviders: ['cloudflare'] });
  const checks = [];
  for (const city of ['Jaipur', 'Delhi']) {
    phase = `${city}:planning`;
    const project = { id: `synthetic-${city.toLowerCase()}`, input_revision: 1, input_json: JSON.stringify({ width: 30, length: 50, floors: 'G+2', city, quality: 'Signature', bedrooms: 4, bathrooms: 3 }) };
    const report = __test.buildReport(project, 'a'.repeat(64), `synthetic-report-${city}`, new Date().toISOString());
    const started = Date.now();
    if (!process.argv.includes('--tour-only')) {
      const generated = await __test.callAiJson(env, __test.aiPrompt(report), config, { schema: __test.AI_BRIEF_RESPONSE_SCHEMA, validate: __test.validateAiBriefContent, reserveCloudflare: async () => {} });
      checks.push({ city, feature: 'planning-brief', provider: generated.provider, model: generated.model, valid: true, durationMs: Date.now() - started, usage: generated.usage });
    }
    phase = `${city}:layout`;
    const houseBrief = defaultHouseBrief({ floors: 'G+2', city });
    houseBrief.setbacks = { front: 1, back: 1, left: 1, right: 1 };
    const { model } = generateBriefLayout(houseBrief, { id: `synthetic-tour-${city.toLowerCase()}` });
    const intent = { roomIds: model.floors.map(floor => model.rooms.find(room => room.floorId === floor.id && room.id.startsWith('brief-r')).id), duration: 45, eyeHeight: 1650, shotPreferences: [] };
    const context = providerIntentContext(model, intent);
    const tourStarted = Date.now();
    phase = `${city}:direction`;
    const tour = await __test.callAiJson(env, spatialIntentPrompt + JSON.stringify(context.data), config, {
      schema: tourIntentResponseSchema(context.data), reserveCloudflare: async () => {},
      validate: raw => { const value = context.fromProvider(raw); if (!validateSpatialIntent(value, model) || !preservesRequestedDirection(value, intent)) throw new Error('Invalid direction'); return value; },
    });
    phase = `${city}:camera-path`;
    let generatedTour;
    try {
      generatedTour = { ...generateTour(model, tour.content), source: tour.provider };
      const validation = validateTour(model, generatedTour);
      if (!validation.valid) throw new Error(validation.errors.join('; '));
    } catch (error) {
      // This is a synthetic model and already-validated direction, never raw
      // provider text or customer content. Keep geometry failures reproducible.
      console.error(JSON.stringify({ geometryCheck: false, city, intent: tour.content, reason: String(error.message).slice(0, 300) }));
      throw error;
    }
    checks.push({ city, feature: 'camera-direction', floors: model.floors.length, visitedFloors: new Set(generatedTour.shots.map(shot => shot.floorId).filter(Boolean)).size, provider: tour.provider, model: tour.model, valid: true, durationMs: Date.now() - tourStarted, usage: tour.usage });
    console.log(JSON.stringify({ city, checks: checks.filter(check => check.city === city) }));
  }
  console.log(JSON.stringify({ checkedAt: new Date().toISOString(), live: true, customerDataSent: false, deployment: false, checks }));
} catch (error) {
  // Provider bodies and credentials must never become evidence or console text.
  console.error(JSON.stringify({ live: true, valid: false, phase, code: error.code || 'live_provider_check_failed', status: error.status || null }));
  process.exitCode = 1;
} finally {
  await proxy?.dispose();
  await rm(directory, { recursive: true, force: true });
}
