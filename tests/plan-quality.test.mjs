import test from 'node:test'
import assert from 'node:assert/strict'
import { defaultHouseBrief, assessHouseBrief } from '../src/spatial/house-brief.js'
import { generateBriefLayout } from '../src/spatial/brief-layout.js'
import { buildPrimitives, validateBuilding } from '../src/spatial/model.js'
import { validateConnectivity } from '../src/spatial/navigation.js'
import { roomViewV2 } from '../src/spatial/tours-v2.js'
import { isWalkableV2 } from '../src/spatial/navigation-v2.js'
import { subjectVisibility, cameraClearance } from '../src/spatial/camera-composition.js'
import { generateTour, validateTour, sampleTour } from '../src/spatial/tours.js'
import { floorPlanSheet, drawingAreaLabel } from '../src/spatial/drawing-set.js'

function brief() {
  const b = defaultHouseBrief({ city: 'Jaipur' })
  b.setbacks = { front: 4 * .3048, back: 3 * .3048, left: .3048, right: 3 * .3048 }
  b.vastu = 'strict'
  b.rooms.forEach((r, i) => { r.direction = ['SE', 'E', 'E', 'NE', 'SE'][i] })
  return b
}

test('a 40 × 50 ft programme gets compact named rooms, beds and connected circulation', () => {
  const b = brief(), original = structuredClone(b), { model, review } = generateBriefLayout(b)
  assert.deepEqual(b, original)
  assert.deepEqual(validateBuilding(model), { valid: true, errors: [] })
  assert.deepEqual(validateConnectivity(model), { valid: true, errors: [] })
  for (const c of review.checks) {
    assert.ok(c.actualArea >= c.targetArea - .05)
    assert.ok(c.actualArea <= c.targetArea * 1.2 + .1, `${c.name} was enlarged`)
    assert.equal(c.status, 'direction unknown')
  }
  for (const [id, kind] of [['r1', 'sofa'], ['r2', 'kitchen-counter'], ['r3', 'bed'], ['r4', 'bed'], ['r5', 'shower']]) {
    assert.ok(model.furniture.some(f => f.roomId === `brief-${id}` && f.kind === kind), `${id} needs its ${kind}`)
  }
  assert.ok(model.rooms.some(r => r.name === 'Entrance hall'))
})

test('small trial targets are explained instead of silently reported as exact matches', () => {
  const b = brief(); b.rooms[0].areaM2 = 5
  const { model, review } = generateBriefLayout(b)
  assert.equal(review.checks[0].areaStatus, 'larger than target')
  assert.equal(review.checks[0].status, 'direction unknown')
  assert.ok(review.issues.some(i => i.id === 'model-area-r1'))
  assert.ok(model.furniture.some(f => f.roomId === 'brief-r3' && f.kind === 'bed'))
  const bed = model.furniture.find(f => f.roomId === 'brief-r3' && f.kind === 'bed')
  const view = roomViewV2(model, bed.roomId)
  assert.equal(subjectVisibility(model, bed, view.position), 1)
  assert.ok(cameraClearance(model, bed, view.position) > 800, 'A foreground wardrobe dominates the bedroom view')
  assert.ok(review.checks.find(c => c.id === 'r5').actualArea < 6.5)
})

test('making the plot wider does not force larger rooms and a stretched bathroom', () => {
  const b = brief(), a = generateBriefLayout(b)
  b.widthM = 80; b.depthM = 80
  const larger = generateBriefLayout(b)
  for (const c of larger.review.checks) assert.ok(c.actualArea < c.targetArea * 1.2 + .1)
  assert.ok(larger.roomsArea < a.roomsArea * 1.1)
})

test('furnished rooms have usable compositions and default motion stays collision checked', () => {
  const { model } = generateBriefLayout(brief())
  for (const room of model.rooms.filter(r => r.id.startsWith('brief-r'))) {
    const view = roomViewV2(model, room.id)
    assert.ok(isWalkableV2(model, view.position))
    assert.ok(view.fov >= 50 && view.fov <= 65)
    assert.ok(Math.hypot(view.target[0] - view.position[0], view.target[1] - view.position[1]) > 500)
    const bed = model.furniture.find(f => f.roomId === room.id && f.kind === 'bed')
    if (bed) assert.ok(subjectVisibility(model, bed, view.position) >= .8, 'Wardrobe hides the bed')
  }
  const tour = generateTour(model, { duration: 60 })
  assert.deepEqual(validateTour(model, tour), { valid: true, errors: [] })
  assert.ok(tour.shots.some(s => s.kind === 'reveal'))
  for (let t = 0; t <= tour.duration; t += .5) {
    const sample = sampleTour(tour, t)
    if (sample.roomId) assert.ok(isWalkableV2(model, sample.position))
  }
})

test('imperial sheets use imperial room areas, crisp type and honest north information', () => {
  const { model } = generateBriefLayout(brief())
  const ft = floorPlanSheet(model, model.floors[0].id, { unit: 'ft' })
  assert.equal(drawingAreaLabel(929030.4, 'ft'), '10.0 sq ft')
  assert.equal(drawingAreaLabel(1000000, 'm'), '1.00 m²')
  assert.match(ft, /ROOM SCHEDULE \/ SQ FT/)
  assert.match(ft, /NORTH UNCONFIRMED/)
  assert.match(ft, /GENERAL ARRANGEMENT/)
  assert.match(ft, /font-size="[^\"]+" stroke="none"/)
  assert.ok(!ft.includes('m²'))
  const floors = buildPrimitives(model).filter(p => p.category === 'floor')
  assert.equal(floors.find(p => p.roomId === 'brief-r5').material, 'stone')
  assert.equal(floors.find(p => p.roomId === 'brief-r3').material, 'wood')
  const changed = structuredClone(model); changed.rooms.find(r => r.id === 'brief-r1').polygon[1][0] += 2500
  assert.ok(assessHouseBrief(brief(), changed).checks[0].actualArea !== assessHouseBrief(brief(), model).checks[0].actualArea)
})
