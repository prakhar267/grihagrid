import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoBuilding, createMultiFloorDemo, validateBuilding, buildPrimitives } from '../src/spatial/model.js'
import { applySceneEdit } from '../src/spatial/editor-ops.js'
import { FLOOR_LAYOUTS, clearFloor, connectFloorBelow, floorReference, populateFloor, rectangularRoom, suggestedRoomPosition } from '../src/spatial/floor-plans.js'
import { floorScene } from '../src/spatial/navigation-v2.js'
import { validateConnectivity } from '../src/spatial/navigation.js'
import { generateTour, validateTour } from '../src/spatial/tours.js'
import { toV2, recalculateBounds } from '../src/spatial/model-v2.js'

const addLevel = (scene, level) => applySceneEdit(scene, { type: 'addFloor', floor: { id: `level-${level}`, name: `Floor ${level + 1}`, elevation: level * 3200, height: 3000 } })
const floorContents = (scene, floorId) => Object.fromEntries(['rooms', 'walls', 'furniture'].map(key => [key, scene[key].filter(item => item.floorId === floorId)]))

for (const layout of [...FLOOR_LAYOUTS.map(item => item.id), 'copy']) {
  for (const level of [1, 2, 3]) test(`${layout} produces an editable floor ${level + 1} without changing other floors`, () => {
    let scene = toV2(createDemoBuilding())
    for (let n = 1; n <= level; n++) {
      scene = addLevel(scene, n)
      if (n < level) scene = populateFloor(scene, `level-${n}`, { layout, sourceFloorId: 'ground' })
    }
    const before = structuredClone(scene), target = `level-${level}`
    const result = populateFloor(scene, target, { layout, sourceFloorId: 'ground' })
    assert.deepEqual(scene, before)
    for (const floor of scene.floors.filter(f => f.id !== target)) assert.deepEqual(floorContents(result, floor.id), floorContents(before, floor.id))
    assert.equal(result.revision, scene.revision + 1)
    assert.equal(validateBuilding(result).valid, true)
    assert.ok(JSON.stringify(result).length <= 47000, 'The whole four-floor model remains saveable.')
    assert.equal(validateConnectivity(floorScene(result, target)).valid, true, 'Rooms on the floor connect through usable doors.')
    assert.ok(buildPrimitives(result).some(p => p.floorId === target && p.category === 'floor'))
    const room = result.rooms.find(r => r.floorId === target)
    const renamed = applySceneEdit(result, { type: 'updateRoom', roomId: room.id, patch: { name: 'My upstairs room' } })
    assert.equal(renamed.rooms.find(r => r.id === room.id).name, 'My upstairs room')
    const removed = applySceneEdit(renamed, { type: 'removeRoom', roomId: room.id })
    assert.equal(removed.rooms.some(r => r.id === room.id), false)
    assert.deepEqual(floorContents(removed, 'ground'), floorContents(before, 'ground'))
  })
}

test('floor reference excludes outdoor ground and follows the nearest populated lower floor', () => {
  const scene = addLevel(createDemoBuilding(), 1)
  assert.deepEqual(floorReference(scene, 'level-1'), { x: 0, y: 0, width: 12000, depth: 10000, sourceFloorId: 'ground' })
  let result = populateFloor(scene, 'level-1', { layout: 'open' })
  result = addLevel(result, 2)
  assert.equal(floorReference(result, 'level-2').sourceFloorId, 'level-1')
})

test('copy creates independent references, excludes outdoor ground and closes outside entrances', () => {
  const scene = addLevel(createDemoBuilding(), 1), result = populateFloor(scene, 'level-1', { layout: 'copy', sourceFloorId: 'ground' })
  const originalIds = new Set([...scene.rooms, ...scene.walls, ...scene.furniture, ...scene.walls.flatMap(w => w.openings)].map(item => item.id))
  const copied = floorContents(result, 'level-1')
  assert.ok(copied.rooms.every(r => !r.exterior && !originalIds.has(r.id)))
  for (const wall of copied.walls) {
    assert.ok(!originalIds.has(wall.id))
    assert.ok(wall.roomIds.every(id => copied.rooms.some(r => r.id === id)))
    assert.ok(wall.openings.every(o => !originalIds.has(o.id)))
    if (wall.roomIds.length < 2) assert.ok(wall.openings.every(o => o.kind !== 'door'))
  }
  assert.ok(copied.furniture.every(f => copied.rooms.some(r => r.id === f.roomId)))
  assert.deepEqual(result.stairs, scene.stairs)
  copied.rooms[0].polygon[0][0] += 10
  assert.deepEqual(floorContents(scene, 'ground'), floorContents(toV2(createDemoBuilding()), 'ground'))
})

test('templates and copies refuse occupied or missing floors and never overwrite a plan', () => {
  const scene = addLevel(createDemoBuilding(), 1), before = structuredClone(scene)
  assert.throws(() => populateFloor(scene, 'ground', { layout: 'open' }), /Clear this floor/)
  assert.throws(() => populateFloor(scene, 'missing', { layout: 'open' }), /existing floor/)
  assert.throws(() => populateFloor(scene, 'level-1', { layout: 'copy', sourceFloorId: 'level-1' }), /different floor/)
  assert.throws(() => populateFloor(scene, 'level-1', { layout: 'invented' }), /Choose one/)
  const loose = applySceneEdit(scene, { type: 'addWall', wall: { id: 'loose', floorId: 'level-1', start: [0, 0], end: [1000, 0], height: 3000, thickness: 180, roomIds: [], openings: [] } })
  assert.throws(() => populateFloor(loose, 'level-1', { layout: 'open' }), /Clear this floor/)
  assert.equal(validateBuilding(populateFloor(clearFloor(loose, 'level-1'), 'level-1', { layout: 'open' })).valid, true)
  assert.deepEqual(scene, before)
})

test('a narrow reference retains a usable open-floor option and gives a clear divided-layout limit', () => {
  let scene = toV2(createMultiFloorDemo())
  scene.rooms = [{ id: 'small', name: 'Narrow room', floorId: 'ground', polygon: [[-2000, 1000], [3000, 1000], [3000, 6000], [-2000, 6000]], color: '#ddd0bc', exterior: false }]
  scene.walls = []; scene.furniture = []; scene.stairs = []; recalculateBounds(scene)
  const before = structuredClone(scene)
  assert.throws(() => populateFloor(scene, 'upper', { layout: 'bedrooms' }), /7 × 6 m/)
  const result = populateFloor(scene, 'upper', { layout: 'open' })
  assert.deepEqual(result.rooms.at(-1).polygon, scene.rooms[0].polygon)
  assert.equal(validateBuilding(result).valid, true)
  assert.deepEqual(scene, before)
})

test('rectangular room entry supports explicit coordinates and rejects invalid or overlapping geometry', () => {
  const scene = addLevel(createDemoBuilding(), 1), before = structuredClone(scene)
  assert.deepEqual(suggestedRoomPosition(scene, 'level-1'), [0, 0])
  const room = rectangularRoom(scene, 'level-1', { name: ' Study ', x: 1000, y: 1000, width: 3000, depth: 4000 })
  let result = applySceneEdit(scene, { type: 'addRoom', room, withWalls: true })
  assert.equal(room.name, 'Study'); assert.equal(result.walls.filter(w => w.floorId === 'level-1').length, 4)
  const overlap = rectangularRoom(result, 'level-1', { name: 'Overlap', x: 1200, y: 1200, width: 2000, depth: 2000 })
  assert.throws(() => applySceneEdit(result, { type: 'addRoom', room: overlap, withWalls: true }), /overlap/)
  for (const width of [NaN, Infinity, 0, 999, 20001]) assert.throws(() => rectangularRoom(scene, 'level-1', { name: 'Bad', x: 0, y: 0, width, depth: 3000 }), /between 1 and 20/)
  assert.throws(() => rectangularRoom(scene, 'level-1', { name: ' ', x: 0, y: 0, width: 3000, depth: 3000 }), /name/)
  assert.deepEqual(scene, before)
})

test('clear and delete floor are atomic, remove its loose walls and stairs, and preserve other-floor geometry', () => {
  const original = createMultiFloorDemo()
  const withLoose = applySceneEdit(original, { type: 'addWall', wall: { id: 'loose-upper', floorId: 'upper', start: [13000, 0], end: [14000, 0], height: 3000, thickness: 180, roomIds: [], openings: [] } })
  const before = structuredClone(withLoose), cleared = clearFloor(withLoose, 'upper')
  assert.equal(cleared.rooms.some(r => r.floorId === 'upper'), false)
  assert.equal(cleared.walls.some(w => w.floorId === 'upper'), false)
  assert.equal(cleared.furniture.some(f => f.floorId === 'upper'), false)
  assert.equal(cleared.stairs.length, 0)
  assert.equal(cleared.floors.length, 2)
  assert.deepEqual(floorContents(cleared, 'ground'), floorContents(withLoose, 'ground'))
  const deleted = clearFloor(withLoose, 'upper', true)
  assert.equal(deleted.floors.length, 1)
  assert.equal(validateBuilding(deleted).valid, true)
  assert.deepEqual(withLoose, before, 'Undo can use the untouched original snapshot.')
  assert.throws(() => clearFloor(original, 'ground', true), /Keep the ground floor/)
  assert.throws(() => clearFloor(deleted, 'ground'), /at least one room/)
})

test('removing a room retains unrelated loose walls, including on other floors', () => {
  let scene = addLevel(createDemoBuilding(), 1)
  const wall = { id: 'independent-wall', floorId: 'level-1', start: [100, 100], end: [100, 2100], height: 3000, thickness: 180, roomIds: [], openings: [] }
  scene = applySceneEdit(scene, { type: 'addWall', wall })
  const removed = applySceneEdit(scene, { type: 'removeRoom', roomId: 'main-bedroom' })
  assert.deepEqual(removed.walls.find(w => w.id === wall.id), wall)
})

test('suggested stairs connect copied rooms and produce a traversable multi-floor camera tour', () => {
  let scene = populateFloor(clearFloor(createMultiFloorDemo(), 'upper'), 'upper', { layout: 'copy', sourceFloorId: 'ground' })
  const before = structuredClone(scene)
  scene = connectFloorBelow(scene, 'upper')
  assert.equal(validateBuilding(scene).valid, true)
  assert.equal(validateConnectivity(scene).valid, true)
  assert.deepEqual(floorContents(scene, 'ground'), floorContents(before, 'ground'))
  assert.deepEqual(floorContents(scene, 'upper'), floorContents(before, 'upper'))
  const tour = generateTour(scene, { roomIds: scene.rooms.map(r => r.id), duration: 40 })
  assert.equal(validateTour(scene, tour).valid, true)
  assert.ok(tour.shots.some(shot => shot.kind === 'walk' && shot.path.some(point => point[2] > 2000 && point[2] < 4500)))
  assert.throws(() => connectFloorBelow(scene, 'upper'), /already have/)
  assert.throws(() => connectFloorBelow(scene, 'ground'), /ground floor/)
})

test('suggested stairs refuse blocked plans without moving furniture or editing lower rooms', () => {
  const scene = populateFloor(addLevel(createDemoBuilding(), 1), 'level-1', { layout: 'bedrooms' })
  const before = structuredClone(scene)
  assert.throws(() => connectFloorBelow(scene, 'level-1'), /No clear straight stair/)
  assert.deepEqual(scene, before)
})

test('four levels retain separate non-overlapping stair apertures and valid routes', () => {
  let scene = clearFloor(createMultiFloorDemo(), 'upper', true)
  for (let n = 1; n < 4; n++) {
    scene = addLevel(scene, n)
    scene = populateFloor(scene, `level-${n}`, { layout: 'copy', sourceFloorId: 'ground' })
    scene = connectFloorBelow(scene, `level-${n}`)
  }
  assert.equal(scene.stairs.length, 3)
  assert.equal(validateBuilding(scene).valid, true)
  assert.equal(validateConnectivity(scene).valid, true)
})
