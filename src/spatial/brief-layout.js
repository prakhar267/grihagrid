import { furnishRooms } from './furnish-rooms.js'
import { assessHouseBrief, FLOOR_NAMES, roomArea } from './house-brief.js';
import { validateBuilding } from './model.js';
import { recalculateBounds } from './model-v2.js';

const MIN_SIDE = { living: 2.7, main_bedroom: 2.7, bedroom: 2.7, elder_bedroom: 2.7, guest_bedroom: 2.7, kids_bedroom: 2.7, kitchen: 2.4, bathroom: 1.7, accessible_bathroom: 2.4, powder: 1.4, puja: 1.5, pantry: 1.4, store: 1.5 };
const outdoor = ['courtyard', 'balcony', 'terrace'];
const rect = (x, y, w, d) => [[x, y], [x + w, y], [x + w, y + d], [x, y + d]];
const mm = n => Math.round(n * 1000);

// A bounded space-allocation starter, not an architectural solver. Every requested
// room is retained; an unplaceable programme fails instead of shrinking bedrooms.
export function generateBriefLayout(brief, { id = 'brief-house', name = 'Your house study', revision = 1 } = {}) {
  const review = assessHouseBrief(brief);
  if (!review.valid) throw new Error(review.issues[0].title);
  if (!review.setbacksKnown) throw new Error('Enter working setbacks on all four sides. Unknown values are not zero.');
  if (brief.shape !== 'rectangular') throw new Error('Import a measured drawing for a corner, irregular or sloping site. The automatic starter uses a flat rectangle.');
  if (brief.projectType !== 'new_build') throw new Error('Import the existing or proposed drawing for renovation, apartment, rental-unit and mixed-use reviews.');
  if (brief.rooms.some(r => outdoor.includes(r.kind))) throw new Error('Courtyards, balconies and terraces need an explicitly reviewed drawing; the starter cannot turn them into enclosed rooms.');
  const blocker = review.issues.find(i => i.status === 'blocked');
  if (blocker) throw new Error(`${blocker.title}. ${blocker.detail}`);
  const hallWidth = brief.floors > 1 ? 4.2 : brief.household.accessibility === 'wheelchair' ? 1.8 : 1.5;
  // Use up to 12 m of available width; a larger site does not force giant rooms.
  const width = Math.min(review.width - .2, 12);
  const largestMinimum = Math.max(...brief.rooms.map(r => MIN_SIDE[r.kind] || 2.4));
  const singleSide = brief.floors === 1 && (width - hallWidth) / 2 - .18 < largestMinimum;
  const sideWidth = (width - hallWidth) / (singleSide ? 1 : 2);
  if (sideWidth - .18 < largestMinimum) throw new Error(`This corridor starter needs a wider footprint for the requested rooms (${largestMinimum.toFixed(1)} m clear room width). Use a different measured layout or revise the programme.`);
  const layouts = [];
  for (let level = 0; level < brief.floors; level++) {
    const sides = [[], []], lengths = [0, 0];
    const rooms = brief.rooms.filter(r => r.floor === level);
    for (const r of [...rooms].sort((a, b) => b.areaM2 - a.areaM2)) {
      let side = singleSide ? 0 : lengths[0] <= lengths[1] ? 0 : 1;
      if (!singleSide && brief.vastu !== 'none' && brief.northDegrees !== null && r.direction !== 'any') {
        const angles = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };
        const dx = Math.sin((angles[r.direction] + brief.northDegrees) * Math.PI / 180);
        if (Math.abs(dx) > .3) side = dx < 0 ? 0 : 1;
      }
      const depth = Math.max(r.areaM2 / (sideWidth - .18) + .18, (MIN_SIDE[r.kind] || 2.4) + .18);
      sides[side].push({ room: r, depth }); lengths[side] += depth;
    }
    for (const side of sides) side.sort((a, b) => {
      const ranks = { S: -1, SE: -1, SW: -1, E: 0, W: 0, any: 0, N: 1, NE: 1, NW: 1 };
      if (brief.northDegrees === 0 && brief.vastu !== 'none') return ranks[a.room.direction] - ranks[b.room.direction];
      return rooms.indexOf(a.room) - rooms.indexOf(b.room);
    });
    layouts.push({ sides, lengths, depth: Math.max(brief.floors > 1 ? 7.8 : 3.8, ...lengths) });
  }
  const depth = Math.max(...layouts.map(l => l.depth));
  if (depth > 40) throw new Error('This starter exceeds the 40 m building-depth limit. Reallocate rooms across floors or import a more compact plan.');
  if (depth + .2 > review.depth) throw new Error(`The room targets need a ${width.toFixed(2)} × ${(depth + .2).toFixed(2)} m working footprint in this starter; only ${review.width.toFixed(2)} × ${review.depth.toFixed(2)} m is available. Move rooms to another floor, reduce targets or import another layout.`);
  const W = mm(width), D = mm(depth), L = mm(sideWidth), R = L + mm(hallWidth);
  const model = { schemaVersion: 2, id, name, revision, seed: 1847, units: 'mm', axes: 'XY-ground-Z-up', bounds: { min: [0, 0, 0], max: [W, D, brief.floors * 3200] },
    floors: [], rooms: [], walls: [], furniture: [], stairs: [], exterior: { groundColor: '#b5bc9e', skyColor: '#e7e5da', sun: [8000, -7000, 14000] } };
  const addRoom = (roomId, roomName, floorId, polygon, color = '#ddd0b8') => {
    const room = { id: roomId, name: roomName, floorId, polygon, color, exterior: false }; model.rooms.push(room); return room;
  };
  const addWall = (floorId, start, end, roomIds, openings = []) => {
    const wallId = `wall-${model.walls.length + 1}`;
    model.walls.push({ id: wallId, floorId, start, end, height: 3000, thickness: 180, roomIds, openings: openings.map((o, i) => ({ id: `${wallId}-opening-${i}`, ...o })) });
  };
  const door = (length, swing = 1) => ({ kind: 'door', offset: (length - 1100) / 2, width: 1100, sill: 0, height: 2200, open: true, hinge: 'start', swing });
  for (let level = 0; level < brief.floors; level++) {
    const floorId = `floor-${level}`, hallId = `hall-${level}`, D = mm(layouts[level].depth);
    model.floors.push({ id: floorId, name: FLOOR_NAMES[level], elevation: level * 3200, height: 3000 });
    addRoom(hallId, brief.floors > 1 ? 'Stair hall' : 'Entrance hall', floorId, rect(L, 0, R - L, D), '#e7decc');
    addWall(floorId, [L, 0], [R, 0], [hallId], level === 0 && brief.roadSide === 'front' ? [door(R - L)] : []);
    addWall(floorId, [L, D], [R, D], [hallId], level === 0 && brief.roadSide === 'back' ? [door(R - L)] : []);
    if (singleSide) addWall(floorId, [W, 0], [W, D], [hallId], level === 0 && brief.roadSide === 'right' ? [door(D)] : []);
    for (let side = 0; side < (singleSide ? 1 : 2); side++) {
      const list = [...layouts[level].sides[side]], x = side === 0 ? 0 : R, outerX = side === 0 ? 0 : W, innerX = side === 0 ? L : R;
      const spare = D / 1000 - list.reduce((n, item) => n + item.depth, 0);
      if (!list.length || spare >= 2.58) list.push({ room: { id: `unassigned-${level}-${side}`, name: 'Unassigned space', kind: 'custom' }, depth: spare });
      let y = 0, previous = null;
      for (let index = 0; index < list.length; index++) {
        const { room: requested } = list[index], h = index === list.length - 1 ? D - y : mm(list[index].depth);
        const room = addRoom(`brief-${requested.id}`, requested.name, floorId, rect(x, y, side === 0 ? L : W - R, h), requested.kind.includes('bath') ? '#d1dcd7' : '#ded0bc');
        addWall(floorId, [innerX, y], [innerX, y + h], [room.id, hallId], [door(h, side === 0 ? 1 : -1)]);
        const entrance = level === 0 && index === 0 && brief.roadSide === (side === 0 ? 'left' : 'right');
        addWall(floorId, [outerX, y], [outerX, y + h], [room.id], entrance ? [door(h)] : [{ kind: 'window', offset: (h - 1200) / 2, width: 1200, sill: requested.kind.includes('bath') ? 1500 : 900, height: requested.kind.includes('bath') ? 800 : 1500 }]);
        addWall(floorId, [x, y], [x + (side === 0 ? L : W - R), y], previous ? [previous.id, room.id] : [room.id]);
        if (index === list.length - 1) addWall(floorId, [x, y + h], [x + (side === 0 ? L : W - R), y + h], [room.id]);

        previous = room; y += h;
      }
    }
  }
  for (let level = 0; level < brief.floors - 1; level++) {
    const x = L + (level % 2 ? 3150 : 1050), startY = level % 2 ? 6500 : 1100, endY = level % 2 ? 1100 : 6500;
    model.stairs.push({ id: `stair-${level}`, name: `Stair to ${FLOOR_NAMES[level + 1].toLowerCase()}`, fromFloorId: `floor-${level}`, toFloorId: `floor-${level + 1}`, start: [x, startY], end: [x, endY], width: 1000, steps: 18, roomIds: [`hall-${level}`, `hall-${level + 1}`] });
  }
  const details = furnishRooms(model);
  model.furniture = details.model.furniture;
  recalculateBounds(model);
  const result = validateBuilding(model);
  if (!result.valid) throw new Error(`The starter could not produce valid geometry: ${result.errors.slice(0, 3).join(' ')}`);
  if (JSON.stringify(model).length > 47000) throw new Error('This programme exceeds the saved model size. Reduce the room count or import a simpler plan.');
  // Validate actual footprint too: generous allocation must not bypass user limits.
  const footprint = (W + 180) * (D + 180) / 1e6, gross = layouts.reduce((sum, layout) => sum + (W + 180) * (mm(layout.depth) + 180) / 1e6, 0);
  if ((brief.rules.coverage !== null && footprint / review.plotArea * 100 > brief.rules.coverage) || (brief.rules.far !== null && gross / review.plotArea > brief.rules.far)) throw new Error('The generated footprint exceeds an entered coverage or FAR limit. Reduce the programme or use another layout.');
  return { model, review: assessHouseBrief(brief, model), grossArea: gross, roomsArea: model.rooms.reduce((sum, room) => sum + roomArea(room), 0) };
}
