import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultHouseBrief, validateHouseBrief, assessHouseBrief, newRoom, ROOM_TYPES, changeFloorCount, roomDirection, briefMarkdown, normalizeHouseBrief, applyVastuPreferences } from '../src/spatial/house-brief.js';
import { generateBriefLayout } from '../src/spatial/brief-layout.js';
import { validateBuilding } from '../src/spatial/model.js';
import { validateConnectivity } from '../src/spatial/navigation.js';
import { generateTour, validateTour } from '../src/spatial/tours.js';
import { __test } from '../worker/index.js';

const ready = (floors = 1) => {
  const b = defaultHouseBrief({ floors: ['G', 'G+1', 'G+2', 'G+3'][floors - 1] });
  b.city = 'Lucknow'; b.setbacks = { front: 1, back: 1, left: 1, right: 1 }; return b;
};
const hasIssue = (review, id) => review.issues.some(i => i.id === id);

const locations = ['Pune', 'Bengaluru', 'Mumbai', 'Delhi', 'Hyderabad', 'Chennai', 'Jaipur', 'Lucknow', 'Noida', 'Gurugram', 'Kochi', 'Kolkata', 'Ahmedabad', 'Surat', 'Indore', 'Bhopal', 'Bhubaneswar', 'Patna', 'Ranchi', 'Guwahati', 'Shillong', 'Shimla', 'Srinagar', 'Leh', 'Panaji', 'Coimbatore', 'Nagpur', 'Visakhapatnam', 'Madurai', 'Thiruvananthapuram', 'Village outside Udaipur', 'पुणे', 'சென்னை', 'ಬೆಂಗಳೂರು'];
for (const city of locations) test(`location: ${city} retains its name without claiming local rules`, () => {
  const b = ready(); b.city = city; b.locality = 'Fictional ward / authority';
  assert.equal(validateHouseBrief(b).valid, true);
  const input = { houseBrief: normalizeHouseBrief(b) };
  assert.equal(input.houseBrief.city, city); assert.equal(input.houseBrief.locality, b.locality);
  assert.equal(hasIssue(assessHouseBrief(b), 'rules'), true);
});

for (let floors = 1; floors <= 4; floors++) for (const roadSide of ['front', 'back', 'left', 'right']) test(`geometry: ${floors} floors with ${roadSide} entry remains connected`, () => {
  const b = ready(floors); b.roadSide = roadSide;
  const { model, review } = generateBriefLayout(b);
  assert.equal(model.floors.length, floors); assert.equal(model.stairs.length, floors - 1);
  assert.equal(validateBuilding(model).valid, true); assert.deepEqual(validateConnectivity(model), { valid: true, errors: [] });
  assert.equal(review.checks.length, b.rooms.length); assert.equal(review.checks.every(c => c.status === 'matched'), true);
  assert.ok(model.bounds.max[0] / 1000 + .18 <= review.width); assert.ok(model.bounds.max[1] / 1000 + .18 <= review.depth);
  assert.equal(new Set(model.rooms.map(r => r.id)).size, model.rooms.length);
  const tour = generateTour(model, { roomIds: [model.rooms[1].id, model.rooms.at(-1).id], duration: 45 });
  assert.equal(validateTour(model, tour).valid, true);
});

for (const kind of Object.keys(ROOM_TYPES)) test(`room programme: ${kind} is retained or requires a measured open-space layout`, () => {
  const b = ready(); b.widthM = 15; b.depthM = 25; b.rooms = [newRoom(kind, 1), newRoom('living', 2)];
  assert.equal(validateHouseBrief(b).valid, true);
  if (['courtyard', 'balcony', 'terrace'].includes(kind)) { assert.throws(() => generateBriefLayout(b), /reviewed drawing/); return; }
  const result = generateBriefLayout(b); assert.equal(result.review.checks.every(c => c.status === 'matched'), true);
  assert.equal(validateConnectivity(result.model).valid, true);
});

for (const climate of ['hot_dry', 'warm_humid', 'composite', 'temperate', 'cold', 'unknown']) test(`climate: ${climate} produces an explicit design review`, () => {
  const b = ready(); b.climate = climate; assert.equal(validateHouseBrief(b).valid, true);
  assert.ok(assessHouseBrief(b).issues.find(i => i.id === 'climate').detail.length > 40);
});

test('a 20-foot narrow plot uses one room bank without dropping the requested rooms', () => {
  const b = ready(); b.widthM = 20 * .3048; b.depthM = 50 * .3048; b.setbacks = { front: .5, back: .5, left: 0, right: 0 };
  b.rooms = [newRoom('living', 1), newRoom('bedroom', 2), newRoom('kitchen', 3), newRoom('bathroom', 4)];
  const { model, review } = generateBriefLayout(b);
  assert.equal(review.checks.every(c => c.status === 'matched'), true); assert.equal(validateConnectivity(model).valid, true);
});

test('an impossible small plot never receives a substituted sample or silently shrunken rooms', () => {
  const b = ready(); b.widthM = 20 * .3048; b.depthM = 30 * .3048;
  assert.equal(assessHouseBrief(b).issues.some(i => i.status === 'blocked'), true);
  const before = structuredClone(b); assert.throws(() => generateBriefLayout(b)); assert.deepEqual(b, before);
});
test('unknown setbacks differ from explicit zero, and unknown limits never become a pass', () => {
  const b = defaultHouseBrief(); assert.equal(assessHouseBrief(b).setbacksKnown, false);
  assert.throws(() => generateBriefLayout(b), /Unknown values are not zero/);
  b.setbacks = { front: 0, back: 0, left: 0, right: 0 }; assert.equal(assessHouseBrief(b).setbacksKnown, true);
  assert.equal(hasIssue(assessHouseBrief(b), 'rules'), true);
});
test('empty floors and removing occupied upper floors require deliberate correction', () => {
  const b = ready(2); assert.throws(() => changeFloorCount(b, 1), /Move or remove/);
  b.rooms = b.rooms.filter(r => r.floor === 0); assert.equal(hasIssue(assessHouseBrief(b), 'empty-1'), true);
  assert.equal(changeFloorCount(b, 1).floors, 1);
});
test('entered FAR, coverage and height limits block an oversized programme', () => {
  const b = ready(3); b.rules = { far: .2, coverage: 10, heightM: 5, source: 'Synthetic test limits' };
  const review = assessHouseBrief(b); for (const id of ['far', 'coverage', 'height']) assert.ok(hasIssue(review, id));
  assert.throws(() => generateBriefLayout(b));
});
test('editing the actual model can fail a previously fitting brief', () => {
  const b = ready(), { model } = generateBriefLayout(b);
  model.rooms.find(r => r.id === 'brief-r1').polygon[0][0] = -20000;
  assert.ok(hasIssue(assessHouseBrief(b, model), 'model-envelope'));
});
test('matching is floor-specific and duplicate names cannot satisfy two requirements', () => {
  const b = ready(), { model } = generateBriefLayout(b);
  b.rooms.push({ ...b.rooms[0], id: 'r99' });
  const review = assessHouseBrief(b, model); assert.equal(review.checks.at(-1).status, 'missing');
  b.rooms.pop(); b.rooms[0].areaM2 = 100; assert.equal(assessHouseBrief(b, model).checks[0].status, 'undersized');
});
test('elder and wheelchair journeys identify missing daily-living and lift provisions', () => {
  const b = ready(2); b.household.elders = 2; b.household.accessibility = 'wheelchair';
  b.rooms.filter(r => r.kind.includes('bedroom') || r.kind.includes('bathroom')).forEach(r => { r.floor = 1; });
  for (const id of ['ground-bed', 'ground-bath', 'access', 'lift']) assert.ok(hasIssue(assessHouseBrief(b), id));
});
for (const projectType of ['renovation', 'apartment', 'rental', 'mixed_use']) test(`journey: ${projectType} retains a brief and refuses invented replacement geometry`, () => {
  const b = ready(); b.projectType = projectType;
  assert.equal(validateHouseBrief(b).valid, true); assert.throws(() => generateBriefLayout(b), /Import the existing/);
  assert.ok(hasIssue(assessHouseBrief(b), ({ renovation: 'renovation', apartment: 'buyer', rental: 'units', mixed_use: 'units' })[projectType]));
});
for (const persona of ['buyer', 'architect', 'builder']) test(`journey: ${persona} gets the relevant handoff questions`, () => {
  const b = ready(); b.persona = persona; assert.ok(hasIssue(assessHouseBrief(b), persona));
});
for (const shape of ['corner', 'irregular', 'sloping']) test(`site: ${shape} requires survey geometry instead of rectangle substitution`, () => {
  const b = ready(); b.shape = shape; assert.throws(() => generateBriefLayout(b), /measured drawing/);
});
test('Vastu uses survey north, separates unknown from mismatch and never certifies compliance', () => {
  const b = ready(), { model } = generateBriefLayout(b), r = model.rooms.find(r => r.id === 'brief-r1');
  b.vastu = 'strict'; b.rooms[0].direction = 'SE';
  assert.equal(assessHouseBrief(b, model).checks[0].status, 'direction unknown'); assert.ok(hasIssue(assessHouseBrief(b), 'north'));
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const d0 = roomDirection(r, model, 0), d90 = roomDirection(r, model, 90);
  assert.equal(directions.indexOf(d90), (directions.indexOf(d0) + 6) % 8);
  b.northDegrees = 0; b.rooms[0].direction = d0; assert.equal(assessHouseBrief(b, model).checks[0].status, 'matched');
  b.rooms[0].direction = directions[(directions.indexOf(d0) + 4) % 8]; assert.equal(assessHouseBrief(b, model).checks[0].status, 'direction mismatch');
});
test('user-entered budget arithmetic states area, contingency and exclusions', () => {
  const b = ready(); b.budget = { budgetLakh: 1, rateInrM2: 25000, contingencyPercent: 15 };
  const review = assessHouseBrief(b); assert.equal(review.budget.total, review.targetArea * 25000 * 1.15); assert.ok(hasIssue(review, 'budget'));
  assert.match(briefMarkdown(b, review), /tax.*professional fees/i);
});
test('deleting model windows identifies habitable rooms needing daylight review', () => {
  const b = ready(), { model } = generateBriefLayout(b); model.walls.forEach(w => { w.openings = w.openings.filter(o => o.kind !== 'window'); });
  assert.ok(hasIssue(assessHouseBrief(b, model), 'window-r1'));
});
test('all selected site services appear in the handoff rather than implying installed infrastructure', () => {
  const b = ready(); b.features = ['solar', 'rainwater', 'ev', 'water', 'drainage', 'privacy', 'acoustics', 'future']; b.parking = 2;
  const review = assessHouseBrief(b); for (const key of b.features) assert.ok(hasIssue(review, `service-${key}`)); assert.ok(hasIssue(review, 'parking'));
});
test('strict brief validation rejects corrupted exports and dangerous ambiguity', () => {
  for (const mutate of [b => { b.floors = 5; }, b => { b.widthM = null; }, b => { b.depthM = Infinity; }, b => { b.household.adults = '2'; }, b => { b.extra = true; }, b => { b.rules.verified = true; }, b => { b.rooms[0].floor = 3; }, b => { b.rooms[1].id = b.rooms[0].id; }, b => { b.notes = 'bad\u202e'; }, b => { b.rooms = Array(37).fill(b.rooms[0]); }]) {
    const b = ready(); mutate(b); assert.equal(validateHouseBrief(b).valid, false); assert.throws(() => normalizeHouseBrief(b));
  }
});
test('the supporting estimate and report preserve an explicit four-storey input', () => {
  const { input, estimate } = __test.normalizeProjectInput({ width: 40, length: 50, floors: 'G+3' });
  assert.equal(input.floors, 'G+3'); assert.equal(estimate.floors, 'G+3');
  assert.equal(estimate.builtUpSqft, 4160);
});


test('large rural sites can contain a smaller house without a false maximum-plot rejection', () => {
  const b = ready(); b.widthM = 60; b.depthM = 75;
  const result = generateBriefLayout(b);
  assert.equal(validateBuilding(result.model).valid, true);
  assert.ok(result.model.bounds.max[0] <= 12000);
  assert.equal(result.review.checks.every(c => c.status === 'matched'), true);
});
test('required Vastu preferences remain required when applying the preset', () => {
  const b = ready(); b.vastu = 'strict';
  const changed = applyVastuPreferences(b);
  assert.equal(changed.vastu, 'strict');
  assert.equal(changed.rooms.find(r => r.kind === 'kitchen').direction, 'SE');
});
test('renaming a generated room cannot silently keep satisfying a different named requirement', () => {
  const b = ready(), { model } = generateBriefLayout(b);
  model.rooms.find(r => r.id === 'brief-r1').name = 'Storage';
  assert.equal(assessHouseBrief(b, model).checks[0].status, 'name differs');
});


test('the default generated-house tour reaches every floor and prioritizes requested rooms', () => {
  const { model } = generateBriefLayout(ready(4));
  const tour = generateTour(model, { duration: 120 });
  assert.equal(validateTour(model, tour).valid, true);
  assert.equal(new Set(tour.roomIds.map(id => model.rooms.find(r => r.id === id).floorId)).size, 4);
  assert.ok(tour.roomIds.every(id => /^brief-r[0-9]+$/.test(id)));
});
test('upper floors keep their own footprint and show spare space instead of inflating bathrooms', () => {
  const b = ready(4), { model, review } = generateBriefLayout(b);
  assert.ok(model.rooms.some(r => r.name === 'Unassigned space'));
  const ground = model.rooms.filter(r => r.floorId === model.floors[0].id).flatMap(r => r.polygon);
  const upper = model.rooms.filter(r => r.floorId === model.floors[1].id).flatMap(r => r.polygon);
  assert.ok(Math.max(...upper.map(p => p[1])) < Math.max(...ground.map(p => p[1])));
  assert.ok(review.checks.filter(c => c.name === 'Bathroom').every(c => c.actualArea < 10));
  b.budget = { budgetLakh: 1, rateInrM2: 25000, contingencyPercent: 10 };
  assert.ok(hasIssue(assessHouseBrief(b, model), 'model-budget'));
});


test('side entries through sleeping or bathing rooms surface a privacy design issue', () => {
  const b = ready(); b.roadSide = 'right';
  const { review } = generateBriefLayout(b);
  assert.ok(review.issues.some(issue => issue.id.startsWith('entry-')));
});
