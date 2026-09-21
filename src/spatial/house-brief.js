// Requirements are user statements, never municipal approvals or measured surveys.
export const ROOM_TYPES = Object.freeze({
  living: ['Living room', 18], dining: ['Dining room', 10], kitchen: ['Kitchen', 10],
  bedroom: ['Bedroom', 12], main_bedroom: ['Main bedroom', 16], elder_bedroom: ['Elder bedroom', 14],
  guest_bedroom: ['Guest bedroom', 12], kids_bedroom: ['Children’s bedroom', 12],
  bathroom: ['Bathroom', 5], accessible_bathroom: ['Accessible bathroom', 7], powder: ['Powder room', 3],
  puja: ['Puja room', 4], study: ['Study / home office', 9], utility: ['Utility / laundry', 5],
  pantry: ['Pantry', 3], store: ['Store', 4], staff: ['Staff room', 9],
  family: ['Family lounge', 14], gym: ['Gym', 12], media: ['Media room', 16],
  courtyard: ['Courtyard', 12], balcony: ['Balcony', 6], terrace: ['Terrace', 16],
  garage: ['Garage', 18], shop: ['Shop / work space', 16], custom: ['Custom room', 10],
});
export const DIRECTIONS = ['any', 'N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor', 'Third floor'];
export const CLIMATES = { unknown: 'Not confirmed', hot_dry: 'Hot and dry', warm_humid: 'Warm and humid', composite: 'Composite', temperate: 'Temperate', cold: 'Cold' };
export const PERSONAS = { homeowner: 'Homeowner', buyer: 'Homebuyer', architect: 'Architect', builder: 'Builder' };
export const PROJECT_TYPES = { new_build: 'New independent house', renovation: 'Renovation / extension', apartment: 'Review an apartment', rental: 'Home with rental units', mixed_use: 'Home and work / shop' };
export const FEATURES = { solar: 'Solar readiness', rainwater: 'Rainwater harvesting', ev: 'EV charging', water: 'Water storage / supply', drainage: 'Flooding / drainage', privacy: 'Neighbour privacy', acoustics: 'Noise control', future: 'Future expansion' };
export const BRIEF_SOURCES = [
  ['BIS homeowner and homebuyer guides', 'https://www.bis.gov.in/guide-for-homeowners-and-homebuyers/?lang=en'],
  ['BEE Eco-Niwas Samhita 2024', 'https://beeindia.gov.in/sites/default/files/publications/files/BEE%20ENS%202024.pdf'],
  ['Universal accessibility guidelines 2021', 'https://divyangjan.depwd.gov.in/content/upload/uploadfiles/files/HG2021_MOHUAN_merged.pdf'],
];

export function newRoom(kind, index, floor = 0) {
  return { id: `r${index}`, kind, name: ROOM_TYPES[kind][0], floor, areaM2: ROOM_TYPES[kind][1], priority: 'required', direction: 'any' };
}
export function defaultHouseBrief(input = {}) {
  const floors = ({ G: 1, 'G+1': 2, 'G+2': 3, 'G+3': 4 })[input.floors] || 1;
  const rooms = ['living', 'kitchen', 'main_bedroom', 'bedroom', 'bathroom'].map((kind, i) => newRoom(kind, i + 1));
  for (let i = 1; i < floors; i++) rooms.push(newRoom('bedroom', rooms.length + 1, i), newRoom('bathroom', rooms.length + 2, i));
  return { version: 1, persona: 'homeowner', projectType: 'new_build', city: input.city === 'Other' ? '' : input.city || '', locality: '', climate: 'unknown',
    widthM: (Number(input.width) || 40) * .3048, depthM: (Number(input.length) || 50) * .3048,
    floors, northDegrees: null, roadSide: 'front', roadWidthM: null, shape: 'rectangular',
    setbacks: { front: null, back: null, left: null, right: null }, rules: { far: null, coverage: null, heightM: null, source: '' },
    household: { adults: 2, children: 0, elders: 0, accessibility: 'none' },
    vastu: 'none', parking: 0, features: [], rooms, notes: '',
    budget: { budgetLakh: null, rateInrM2: null, contingencyPercent: 10 },
  };
}

function exact(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)) || keys.some(key => !Object.hasOwn(value, key))) throw new Error(`Invalid ${label} fields.`);
}
function number(value, min, max, label, nullable = false, integer = false) {
  if (nullable && value === null) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) throw new Error(`${label} must be ${integer ? 'a whole number ' : ''}between ${min} and ${max}.`);
}
function text(value, max, label, empty = true) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\p{Cc}\p{Cf}]/u.test(value)) throw new Error(`Enter valid ${label} (up to ${max} characters).`);
}
function choice(value, options, label) { if (!options.includes(value)) throw new Error(`Choose a supported ${label}.`); }
export function validateHouseBrief(b) {
  try {
    exact(b, Object.keys(defaultHouseBrief()), 'house brief');
    if (b.version !== 1) throw new Error('Unsupported house brief version.');
    choice(b.persona, Object.keys(PERSONAS), 'role'); choice(b.projectType, Object.keys(PROJECT_TYPES), 'project type');
    text(b.city, 100, 'city'); text(b.locality, 120, 'locality'); text(b.notes, 1200, 'notes');
    choice(b.climate, Object.keys(CLIMATES), 'climate'); choice(b.shape, ['rectangular', 'corner', 'irregular', 'sloping'], 'site shape');
    number(b.widthM, 3.048, 152.4, 'Plot width'); number(b.depthM, 3.048, 152.4, 'Plot depth');
    number(b.floors, 1, 4, 'Floor count', false, true); number(b.northDegrees, 0, 359.99, 'North angle', true);
    choice(b.roadSide, ['front', 'right', 'back', 'left'], 'road side'); number(b.roadWidthM, 1, 80, 'Road width', true);
    exact(b.setbacks, ['front', 'back', 'left', 'right'], 'setback');
    for (const [side, value] of Object.entries(b.setbacks)) number(value, 0, 100, `${side} setback`, true);
    exact(b.rules, ['far', 'coverage', 'heightM', 'source'], 'local rule');
    number(b.rules.far, .1, 20, 'FAR / FSI', true); number(b.rules.coverage, 1, 100, 'Coverage percentage', true); number(b.rules.heightM, 2, 200, 'Height limit', true); text(b.rules.source, 240, 'rule source');
    exact(b.household, ['adults', 'children', 'elders', 'accessibility'], 'household');
    for (const key of ['adults', 'children', 'elders']) number(b.household[key], 0, 30, key, false, true);
    choice(b.household.accessibility, ['none', 'step_free', 'wheelchair'], 'access needs');
    choice(b.vastu, ['none', 'flexible', 'strict'], 'Vastu preference'); number(b.parking, 0, 4, 'Parking spaces', false, true);
    if (!Array.isArray(b.features) || b.features.length > Object.keys(FEATURES).length || new Set(b.features).size !== b.features.length || b.features.some(key => !Object.hasOwn(FEATURES, key))) throw new Error('Choose supported site and service needs.');
    exact(b.budget, ['budgetLakh', 'rateInrM2', 'contingencyPercent'], 'budget');
    number(b.budget.budgetLakh, 1, 100000, 'Budget in lakh', true); number(b.budget.rateInrM2, 1000, 1000000, 'Entered rate per m²', true); number(b.budget.contingencyPercent, 0, 100, 'Contingency');
    if (!Array.isArray(b.rooms) || b.rooms.length < 1 || b.rooms.length > 36) throw new Error('Add between 1 and 36 rooms.');
    const ids = new Set();
    for (const r of b.rooms) {
      exact(r, ['id', 'kind', 'name', 'floor', 'areaM2', 'priority', 'direction'], 'room');
      if (typeof r.id !== 'string' || !/^r[0-9]{1,8}$/.test(r.id) || ids.has(r.id)) throw new Error('Room identifiers must be unique.'); ids.add(r.id);
      choice(r.kind, Object.keys(ROOM_TYPES), 'room type'); text(r.name, 80, 'room name', false);
      number(r.floor, 0, b.floors - 1, `${r.name} floor`, false, true); number(r.areaM2, 2, 300, `${r.name} target area`);
      choice(r.priority, ['required', 'optional'], 'room priority'); choice(r.direction, DIRECTIONS, 'room direction');
    }
    return { valid: true, errors: [] };
  } catch (error) { return { valid: false, errors: [error.message] }; }
}
export function normalizeHouseBrief(value) {
  const result = validateHouseBrief(value);
  if (!result.valid) throw new Error(result.errors[0]);
  return structuredClone(value);
}
export function changeFloorCount(brief, floors) {
  // Never silently relocate or delete a room when reducing storeys.
  if (brief.rooms.some(r => r.floor >= floors)) throw new Error('Move or remove rooms on the upper floors before reducing the floor count.');
  return { ...brief, floors };
}
export function applyVastuPreferences(brief) {
  const preferences = { kitchen: 'SE', puja: 'NE', main_bedroom: 'SW' };
  return { ...brief, vastu: brief.vastu === 'none' ? 'flexible' : brief.vastu, rooms: brief.rooms.map(room => ({ ...room, direction: preferences[room.kind] || room.direction })) };
}
export const roomArea = r => Math.abs(r.polygon.reduce((sum, p, i, points) => { const q = points[(i + 1) % points.length]; return sum + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2e6;
export function roomDirection(room, model, northDegrees) {
  if (northDegrees === null) return 'unknown';
  const rooms = model.rooms.filter(r => r.floorId === room.floorId && !r.exterior), points = rooms.flatMap(r => r.polygon);
  if (!points.length) return 'unknown';
  const min = [0, 1].map(i => Math.min(...points.map(p => p[i]))), max = [0, 1].map(i => Math.max(...points.map(p => p[i])));
  let twiceArea = 0; const center = [0, 0];
  room.polygon.forEach((p, i, polygon) => { const q = polygon[(i + 1) % polygon.length], cross = p[0] * q[1] - q[0] * p[1]; twiceArea += cross; center[0] += (p[0] + q[0]) * cross; center[1] += (p[1] + q[1]) * cross; });
  center[0] /= 3 * twiceArea; center[1] /= 3 * twiceArea;
  const dx = center[0] - (min[0] + max[0]) / 2, dy = center[1] - (min[1] + max[1]) / 2;
  if (Math.hypot(dx, dy) < Math.min(max[0] - min[0], max[1] - min[1]) * .12) return 'centre';
  const angle = ((Math.atan2(dx, dy) * 180 / Math.PI - northDegrees) % 360 + 360) % 360;
  return DIRECTIONS[1 + Math.round(angle / 45) % 8];
}

export function assessHouseBrief(b, model = null) {
  const validation = validateHouseBrief(b);
  if (!validation.valid) return { valid: false, issues: validation.errors.map((message, i) => ({ id: `invalid-${i}`, status: 'blocked', title: message, detail: 'Correct the brief to run its checks.' })), floors: [], checks: [] };
  const issues = [], add = (id, status, title, detail) => issues.push({ id, status, title, detail });
  const setbacksKnown = Object.values(b.setbacks).every(n => n !== null);
  const width = b.widthM - (b.setbacks.left || 0) - (b.setbacks.right || 0), depth = b.depthM - (b.setbacks.front || 0) - (b.setbacks.back || 0);
  const plotArea = b.widthM * b.depthM, envelopeArea = Math.max(0, width) * Math.max(0, depth);
  const floors = Array.from({ length: b.floors }, (_, index) => {
    const rooms = b.rooms.filter(r => r.floor === index), net = rooms.reduce((sum, r) => sum + r.areaM2, 0);
    // An explicit allowance, not a code minimum or guaranteed fit.
    const allowance = net * .25 + (b.floors > 1 ? 24 : 0);
    return { index, name: FLOOR_NAMES[index], rooms: rooms.length, net, allowance, target: net + allowance, envelope: envelopeArea };
  });
  if (!b.city.trim()) add('city', 'review', 'City or town is not stated', 'Enter any Indian city, town or village and identify the local authority.');
  if (!setbacksKnown) add('setbacks', 'review', 'Setbacks are not confirmed', 'Blank setbacks remain unknown. Enter working assumptions on all four sides before generating a layout.');
  if (width <= 0 || depth <= 0) add('envelope', 'blocked', 'Setbacks consume the plot', 'Reduce the proposed footprint or correct the entered setbacks.');
  for (const f of floors) {
    if (!f.rooms) add(`empty-${f.index}`, 'blocked', `${f.name} has no requested rooms`, 'Add a room or reduce the storey count.');
    if (setbacksKnown && f.target > envelopeArea) add(`fit-${f.index}`, 'blocked', `${f.name} exceeds the working envelope`, `${f.target.toFixed(1)} m² including a 25% walls/circulation allowance${b.floors > 1 ? ' and 24 m² stair allowance' : ''}; ${envelopeArea.toFixed(1)} m² available. Change the programme or floor allocation.`);
  }
  const targetArea = floors.reduce((sum, f) => sum + f.target, 0), targetFar = targetArea / plotArea, targetCoverage = Math.max(...floors.map(f => f.target)) / plotArea * 100;
  if (b.rules.far !== null && targetFar > b.rules.far) add('far', 'blocked', 'Programme exceeds the entered FAR / FSI', `${targetFar.toFixed(2)} provisional gross ratio versus ${b.rules.far}. Local exclusions need professional calculation.`);
  if (b.rules.coverage !== null && targetCoverage > b.rules.coverage) add('coverage', 'blocked', 'Programme exceeds entered coverage', `${targetCoverage.toFixed(1)}% provisional footprint versus ${b.rules.coverage}%.`);
  if (b.rules.heightM !== null && b.floors * 3.2 > b.rules.heightM) add('height', 'blocked', 'Concept height exceeds the entered limit', `${(b.floors * 3.2).toFixed(1)} m assumed for ${b.floors} levels, before parapet and roof equipment.`);
  if (!b.rules.source.trim() || [b.rules.far, b.rules.coverage, b.rules.heightM].some(n => n === null)) add('rules', 'review', 'Local development rules need verification', 'Record the authority, adopted rules, date and plot-specific conditions. A city name cannot establish setbacks, FAR, height or permission.');
  if (['irregular', 'sloping'].includes(b.shape)) add('survey', 'review', 'Use a measured drawing for this site', 'The rectangular starter cannot model irregular boundaries or terrain. Import the survey and review its geometry.');
  if (b.shape === 'corner') add('corner', 'review', 'Check both road frontages', 'Confirm road widening, sight lines, access and setbacks along the second road.');
  if (b.roadWidthM === null) add('road', 'review', 'Road width and access are unknown', 'Measure the approach, entry, fire-service access and any widening reservation.');
  if (b.parking) add('parking', 'review', `Plan ${b.parking} parking space${b.parking > 1 ? 's' : ''} and manoeuvring`, 'Parking is a site requirement, not included in the room-area total unless you add garage rooms. Check actual vehicles, gate, turning, pedestrians and EV services.');
  const hasGround = kind => b.rooms.some(r => kind(r.kind) && r.floor === 0);
  if (b.household.elders || b.household.accessibility !== 'none') {
    if (!hasGround(kind => kind.includes('bedroom'))) add('ground-bed', 'review', 'Ground-floor sleeping space is missing', 'Provide step-free daily living or an independently verified lift strategy.');
    if (!hasGround(kind => kind.includes('bathroom'))) add('ground-bath', 'review', 'Ground-floor bathing space is missing', 'Check a continuous accessible route from sleeping and living spaces to a usable bathroom.');
    add('access', 'review', 'Verify access beyond the room area', 'Review thresholds, clear door widths, turning space, bed transfers, wet-area fit-out and entrance levels. The walking camera does not certify wheelchair access.');
    if (b.floors > 1) add('lift', 'review', 'Upper floors need a vertical-access strategy', 'Stairs alone do not provide step-free access. Reserve and professionally design a lift if upper floors must be accessible.');
  }
  if (b.vastu !== 'none' && b.northDegrees === null) add('north', 'review', 'Confirm north before checking Vastu preferences', 'Room directions are measured from the floor centre and your entered north angle. Road facing is a separate fact.');
  if (b.vastu !== 'none') add('vastu', 'review', 'Vastu is a household preference', 'Review your chosen room directions alongside daylight, ventilation, accessibility and structure. This is not a safety or compliance score.');
  const climateAdvice = {
    unknown: 'Confirm the site climate and exposure before choosing envelope, glazing and shading.',
    hot_dry: 'Study solar shading, roof heat gain and night ventilation using local weather and security conditions.',
    warm_humid: 'Study cross ventilation, shading, rain protection and moisture management.',
    composite: 'Study both summer heat and winter comfort, seasonal shading and controllable ventilation.',
    temperate: 'Study daylight, shading, airflow and weather protection for the actual site.',
    cold: 'Study insulation, air leakage, useful winter sun, condensation and safe ventilation.',
  };
  add('climate', 'review', `${CLIMATES[b.climate]} climate`, climateAdvice[b.climate]);
  for (const feature of b.features) add(`service-${feature}`, 'review', FEATURES[feature], ({ solar: 'Reserve roof area, maintenance access and structural/electrical coordination.', rainwater: 'Size storage and overflow from local rainfall and drainage conditions.', ev: 'Coordinate electrical load, charger protection and parking access.', water: 'Check water availability, pressure, treatment, storage and maintenance.', drainage: 'Obtain flood history, site levels and an approved storm-water route.', privacy: 'Review overlooking, boundary openings and family/visitor circulation.', acoustics: 'Locate noisy services and buffers around bedrooms and work spaces.', future: 'Have an engineer design foundations, structure and services for the proposed future loads.' })[feature]);
  if (b.persona === 'buyer' || b.projectType === 'apartment') add('buyer', 'review', 'Homebuyer document and site review', 'Compare the sanctioned plan with the offered unit, declared carpet area, completion/occupancy documents, project registration where applicable, ventilation, defects and shared maintenance. Room polygon area is not a certified carpet area.');
  if (b.persona === 'builder') add('builder', 'review', 'Builder coordination and quantities', 'Agree scope, specifications, measured quantities, exclusions, services, milestones and quality inspections before pricing. This concept does not produce a construction BOQ.');
  if (b.persona === 'architect') add('architect', 'review', 'Architect survey and coordination', 'Validate site levels, structure, egress, fire strategy, wet stacks, shafts, services and approval drawings against the adopted local rules.');
  if (b.projectType === 'renovation') add('renovation', 'review', 'Survey the existing building before changes', 'Record retained walls, columns, services and occupancy during works. Extensions and wall removal require structural review.');
  if (['rental', 'mixed_use'].includes(b.projectType)) add('units', 'review', 'Resolve separate access and occupancy', 'Design independent entries, privacy, metering, fire separation, egress and permissible use. A generic room grid cannot establish separate dwellings.');
  let budget = null;
  if (b.budget.rateInrM2 !== null) {
    const base = targetArea * b.budget.rateInrM2, total = base * (1 + b.budget.contingencyPercent / 100);
    budget = { base, total, targetArea };
    if (b.budget.budgetLakh !== null && total > b.budget.budgetLakh * 100000) add('budget', 'review', 'Entered allowance exceeds your budget', `₹${(total / 100000).toFixed(1)} lakh from your rate, programme area and contingency. Land, tax, statutory fees, professional fees, interiors and abnormal site costs are excluded.`);
  }
  const checks = [], used = new Set();
  if (model) for (const requested of b.rooms) {
    const floor = [...model.floors].sort((a, c) => a.elevation - c.elevation)[requested.floor];
    const room = model.rooms.find(r => !used.has(r.id) && r.floorId === floor?.id && (r.id === `brief-${requested.id}` || r.name.trim().toLowerCase() === requested.name.trim().toLowerCase()));
    if (room) used.add(room.id);
    const actualArea = room ? roomArea(room) : null, direction = room ? roomDirection(room, model, b.northDegrees) : 'unknown';
    const areaMet = room && actualArea + .05 >= requested.areaM2;
    const directionMet = b.vastu === 'none' || requested.direction === 'any' || direction === requested.direction;
    checks.push({ id: requested.id, name: requested.name, floor: FLOOR_NAMES[requested.floor], roomId: room?.id || null, targetArea: requested.areaM2, actualArea, direction, wantedDirection: requested.direction,
      status: !room ? 'missing' : room.name.trim().toLowerCase() !== requested.name.trim().toLowerCase() ? 'name differs' : !areaMet ? 'undersized' : !directionMet ? (direction === 'unknown' ? 'direction unknown' : 'direction mismatch') : 'matched', priority: requested.priority });
  }
  if (model) {
    if (model.floors.length !== b.floors) add('model-floors', 'review', 'The model has a different floor count', `${model.floors.length} modelled; ${b.floors} requested. Review the floor schedule.`);
    for (const requested of b.rooms.filter(r => r.kind.includes('bedroom') || r.kind.includes('bathroom') || ['puja', 'staff'].includes(r.kind))) {
      const check = checks.find(c => c.id === requested.id);
      if (check?.roomId && model.walls.some(w => w.roomIds.length === 1 && w.roomIds[0] === check.roomId && w.openings.some(o => o.kind === 'door'))) add(`entry-${requested.id}`, 'review', `${requested.name}: exterior door enters a private room`, 'Check the visitor route, security and privacy. A side-road starter may need a separate entrance lobby before this can be a family plan.');
    }
    const inside = model.rooms.filter(r => !r.exterior), points = inside.flatMap(r => r.polygon);
    if (points.length && setbacksKnown) {
      const span = [0, 1].map(i => (Math.max(...points.map(p => p[i])) - Math.min(...points.map(p => p[i]))) / 1000);
      if (span[0] > width || span[1] > depth) add('model-envelope', 'blocked', 'Current model exceeds the working envelope', `Model extents ${span[0].toFixed(2)} × ${span[1].toFixed(2)} m; envelope ${width.toFixed(2)} × ${depth.toFixed(2)} m. Check exterior wall faces and surveyed placement separately.`);
    }
    const modelFloorAreas = model.floors.map(f => inside.filter(r => r.floorId === f.id).reduce((n, r) => n + roomArea(r), 0));
    if (budget) {
      budget.modelArea = modelFloorAreas.reduce((a, c) => a + c, 0);
      budget.modelTotal = budget.modelArea * b.budget.rateInrM2 * (1 + b.budget.contingencyPercent / 100);
      if (b.budget.budgetLakh !== null && budget.modelTotal > b.budget.budgetLakh * 100000) add('model-budget', 'review', 'Current model exceeds your entered budget allowance', `₹${(budget.modelTotal / 100000).toFixed(1)} lakh using ${budget.modelArea.toFixed(1)} m² of model room polygons, your rate and contingency. Full wall areas and scope exclusions still need a measured estimate.`);
    }
    if (b.rules.far !== null && modelFloorAreas.reduce((a, c) => a + c, 0) / plotArea > b.rules.far) add('model-far', 'blocked', 'Current model exceeds the entered FAR', 'Even the model room polygons exceed the entered ratio. Count wall faces and local area exclusions with your professional.');
    if (b.rules.coverage !== null && Math.max(...modelFloorAreas) / plotArea * 100 > b.rules.coverage) add('model-coverage', 'blocked', 'Current model exceeds the entered coverage', 'Recheck the full footprint and local coverage definition.');
    if (b.rules.heightM !== null && model.bounds.max[2] / 1000 > b.rules.heightM) add('model-height', 'blocked', 'Current model exceeds the entered height limit', 'Roof, parapet and equipment may add further height.');
    for (const requested of b.rooms.filter(r => ['living', 'family', 'kitchen', 'study'].includes(r.kind) || r.kind.includes('bedroom'))) {
      const check = checks.find(c => c.id === requested.id);
      if (check?.roomId && !model.walls.some(w => w.roomIds.includes(check.roomId) && w.openings.some(o => o.kind === 'window'))) add(`window-${requested.id}`, 'review', `${requested.name}: no window recorded`, 'Review daylight and ventilation, including any borrowed light, open courtyard, mechanical system and obstructing neighbours. A window alone does not prove adequate performance.');
    }
  }
  const canGenerate = !issues.some(i => i.status === 'blocked') && setbacksKnown && b.shape === 'rectangular' && b.projectType === 'new_build' && !b.rooms.some(r => ['courtyard', 'balcony', 'terrace'].includes(r.kind));
  return { valid: true, issues, floors, checks, width, depth, plotArea, envelopeArea, targetArea, targetFar, targetCoverage, setbacksKnown, budget, canGenerate };
}

export function briefMarkdown(b, assessment) {
  const safe = value => String(value).replace(/[|\r\n]/g, ' ');
  return [`# House design brief`, '', `${PERSONAS[b.persona]} · ${PROJECT_TYPES[b.projectType]}`, `${safe(b.city || 'City not stated')} · ${safe(b.locality)}`, '',
    `Plot: ${b.widthM.toFixed(2)} × ${b.depthM.toFixed(2)} m (${(b.widthM * b.depthM).toFixed(1)} m²). Floors: ${b.floors}.`,
    `North: ${b.northDegrees === null ? 'unknown' : `${b.northDegrees}° clockwise from model +Y`}. Vastu: ${b.vastu}.`, '',
    '## Site and household assumptions',
    `Climate: ${CLIMATES[b.climate]}. Shape: ${b.shape}. Road edge: ${b.roadSide}; width ${b.roadWidthM ?? 'unknown'} m.`,
    `Setbacks (m): ${Object.entries(b.setbacks).map(([key, n]) => `${key} ${n ?? 'unknown'}`).join(', ')}.`,
    `Local limits: FAR/FSI ${b.rules.far ?? 'unknown'}; coverage ${b.rules.coverage ?? 'unknown'}%; height ${b.rules.heightM ?? 'unknown'} m. Source: ${safe(b.rules.source || 'unconfirmed')}.`,
    `Household: ${b.household.adults} adults, ${b.household.children} children, ${b.household.elders} elders. Access: ${b.household.accessibility}. Parking: ${b.parking}.`,
    `Services: ${b.features.map(key => FEATURES[key]).join(', ') || 'none specified'}.`,
    `Budget: ${b.budget.budgetLakh ?? 'unknown'} lakh INR; entered rate ${b.budget.rateInrM2 ?? 'unknown'} INR/m²; contingency ${b.budget.contingencyPercent}%.`, '',
    '| Room | Floor | Target m² | Priority | Direction preference |', '| --- | --- | ---: | --- | --- |',
    ...b.rooms.map(r => `| ${safe(r.name)} | ${FLOOR_NAMES[r.floor]} | ${r.areaM2} | ${r.priority} | ${r.direction} |`), '',
    '## Questions to resolve', ...assessment.issues.map(i => `- ${i.title}: ${i.detail}`), '',
    ...(assessment.checks.length ? ['## Current model check', ...assessment.checks.map(c => `- ${safe(c.name)} / ${c.floor}: ${c.status}; ${c.actualArea === null ? 'not found' : `${c.actualArea.toFixed(1)} m²`} (target ${c.targetArea} m²).`), ''] : []),
    '## Notes', safe(b.notes), '', 'Concept-stage working brief. No municipal, structural, accessibility or Vastu certification. Areas are schematic and not certified carpet areas.', '',
    '## Reference material', ...BRIEF_SOURCES.map(([name, url]) => `- [${name}](${url})`), '',
  ].join('\n');
}
