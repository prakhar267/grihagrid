import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultHouseBrief } from '../src/spatial/house-brief.js';
import { generateBriefLayout } from '../src/spatial/brief-layout.js';
import { briefGenerationGuidance, briefIssueAction } from '../src/spatial/brief-guidance.js';

function enteredBrief() {
  const brief = defaultHouseBrief();
  brief.setbacks = { front: 0, back: 0, left: 0, right: 0 };
  return brief;
}

test('unknown plot edges lead to their fields; explicit zero remains an assumption', () => {
  const unknown = defaultHouseBrief();
  const before = structuredClone(unknown);
  const next = briefGenerationGuidance(unknown);
  assert.equal(next.kind, 'details');
  assert.deepEqual(next.action, { step: 'site', target: 'hb-setbacks', label: 'Review plot-edge spaces' });
  assert.deepEqual(unknown, before);
  assert.throws(() => generateBriefLayout(unknown), /Unknown values are not zero/);
  assert.equal(briefGenerationGuidance(enteredBrief()).kind, 'ready');
  assert.ok(generateBriefLayout(enteredBrief()).model.rooms.length);
});

test('every unsupported automatic project has a drawing path without rewriting requirements', () => {
  for (const patch of [{ shape: 'corner' }, { shape: 'irregular' }, { shape: 'sloping' }, { projectType: 'renovation' }, { projectType: 'apartment' }, { projectType: 'rental' }, { projectType: 'mixed_use' }]) {
    const brief = Object.assign(enteredBrief(), patch);
    const before = structuredClone(brief);
    const next = briefGenerationGuidance(brief);
    assert.equal(next.kind, 'drawing');
    assert.equal(next.action.destination, 'drawing');
    assert.throws(() => generateBriefLayout(brief));
    assert.deepEqual(brief, before);
  }
  for (const kind of ['courtyard', 'balcony', 'terrace']) {
    const brief = enteredBrief(); brief.rooms[0].kind = kind;
    assert.equal(briefGenerationGuidance(brief).kind, 'drawing');
    assert.throws(() => generateBriefLayout(brief), /explicitly reviewed drawing/);
  }
});

test('an empty upper floor points to that floor without moving any rooms', () => {
  const brief = enteredBrief(); brief.floors = 3;
  const before = structuredClone(brief);
  const next = briefGenerationGuidance(brief);
  assert.equal(next.kind, 'details');
  assert.equal(next.action.step, 'rooms');
  assert.equal(next.action.target, 'hb-floor-1');
  assert.deepEqual(brief, before);
  assert.throws(() => generateBriefLayout(brief), /no requested rooms/);
});

test('invalid input and entered development limits are never marked ready', () => {
  const invalid = enteredBrief(); invalid.widthM = null;
  assert.equal(briefGenerationGuidance(invalid).kind, 'invalid');
  const limited = enteredBrief(); limited.rules.heightM = 2;
  assert.equal(briefGenerationGuidance(limited).action.target, 'hb-floors');
  assert.throws(() => generateBriefLayout(limited), /height exceeds/);
});

test('ready is only a preliminary check; geometry failures stay authoritative', () => {
  const narrow = enteredBrief(); narrow.widthM = 4; narrow.depthM = 30;
  assert.equal(briefGenerationGuidance(narrow).kind, 'ready');
  assert.throws(() => generateBriefLayout(narrow), /wider footprint/);
  assert.deepEqual(briefIssueAction('model-envelope'), { destination: 'plan', label: 'Review the floor plan' });
});
