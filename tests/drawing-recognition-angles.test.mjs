import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeRaster, roomsFromWalls, recognitionToBuilding } from '../src/spatial/drawing-recognition.js'
import { validateBuilding } from '../src/spatial/model.js'
import { raster, rotatedPlan, polygonPlan, rotate, rotateRaster } from './fixtures/drawing-rasters.mjs'
import { readPng } from './fixtures/read-png.mjs'

const polygonArea = p => Math.abs(p.reduce((n, a, i) => { const b = p[(i + 1) % p.length]; return n + a[0] * b[1] - a[1] * b[0] }, 0)) / 2
function verifySingleRoom(fixture, { tolerance = 5, areaError = 0.04 } = {}) {
  const result = recognizeRaster(fixture.input, { maxGap: 45 })
  assert.equal(result.rooms.length, 1)
  const polygon = result.rooms[0].polygon
  assert.equal(polygon.length, fixture.corners.length, JSON.stringify(polygon))
  for (const corner of fixture.corners) assert.ok(polygon.some(p => Math.hypot(p[0] - corner[0], p[1] - corner[1]) <= tolerance), `Missing observed corner ${corner}; detected ${JSON.stringify(polygon)}`)
  assert.ok(Math.abs(polygonArea(polygon) / polygonArea(fixture.corners) - 1) < areaError)
  const model = recognitionToBuilding(result, { mmPerPixel: 20, buildingId: 'fixture-model' })
  const validation = validateBuilding(model)
  assert.equal(validation.valid, true, validation.errors.join('; '))
  assert.equal(model.furniture.length, 0)
  assert.ok(result.issues.some(issue => issue.id === 'scale' && issue.severity === 'required'))
  assert.ok(result.issues.some(issue => issue.id === 'review'))
  return result
}

test('rotated raster walls retain their observed angle and calibrated room footprint', () => {
  for (const angle of [5, 17, 37, 73, -23]) verifySingleRoom(rotatedPlan(angle))
})

test('skewed and chamfered plans produce simple polygons, not axis-aligned bounds', () => {
  verifySingleRoom(polygonPlan([[80, 75], [485, 110], [535, 390], [55, 435]]))
  verifySingleRoom(polygonPlan([[70, 80], [430, 80], [520, 170], [520, 410], [70, 410]]))
  verifySingleRoom(polygonPlan([[120, 90], [510, 230], [190, 440]]))
})

test('a diagonal concave room preserves its recess and valid shared 3D geometry', () => {
  const corners = [[-170, -130], [170, -130], [170, 0], [0, 0], [0, 170], [-170, 170]].map(p => rotate(p, 13))
  verifySingleRoom(polygonPlan(corners))
})

test('bounded uneven freehand strokes fit observed centerlines without extra corner walls', () => {
  const result = verifySingleRoom(rotatedPlan(17, { thickness: 3, wobble: 2.5, uneven: true }), { tolerance: 6 })
  assert.equal(result.walls.length, 4)
  assert.ok(result.walls.every(w => w.confidence < 1))
})

test('rotated shared partition keeps two rooms and its explicit reviewable gap', () => {
  for (const angle of [17, 37, -23]) {
    const fixture = rotatedPlan(angle, { partition: true }), result = recognizeRaster(fixture.input, { maxGap: 45 })
    assert.equal(result.rooms.length, 2, `rotation ${angle}`)
    assert.equal(result.walls.length, 5)
    assert.equal(result.openings.length, 1)
    assert.ok(Math.abs(result.openings[0].width - 40) <= 5)
    const wall = result.walls.find(w => w.id === result.openings[0].wallId)
    const building = recognitionToBuilding(result, { mmPerPixel: 24, buildingId: 'partition-fixture' })
    assert.equal(building.walls.find(w => w.id === wall.id).roomIds.length, 2)
    assert.equal(validateBuilding(building).valid, true)
  }
})

test('blank, unfinished, excessive-gap and filled raster images produce no rooms', () => {
  assert.equal(recognizeRaster(raster()).rooms.length, 0)
  const open = raster(), corners = [[-180, -125], [180, -125], [180, 125], [-180, 125]].map(p => rotate(p, 17))
  for (let i = 0; i < 3; i++) open.stroke(corners[i], corners[i + 1])
  assert.equal(recognizeRaster(open).rooms.length, 0)
  const gap = raster(); gap.stroke([70, 90], [220, 90]); gap.stroke([350, 90], [520, 90]); gap.stroke([520, 90], [520, 430]); gap.stroke([520, 430], [70, 430]); gap.stroke([70, 430], [70, 90])
  assert.equal(recognizeRaster(gap, { maxGap: 45 }).rooms.length, 0)
  const filled = raster(); for (let i = 0; i < filled.data.length; i += 4) filled.data[i] = filled.data[i + 1] = filled.data[i + 2] = 0
  const rejected = recognizeRaster(filled)
  assert.equal(rejected.rooms.length, 0); assert.equal(rejected.walls.length, 0)
  assert.ok(rejected.issues.some(issue => issue.id === 'dark-image'))
  for (const size of [120, 200]) {
    const smallFill = raster()
    for (let y = 100; y < 100 + size; y++) for (let x = 100; x < 100 + size; x++) { const i = (y * smallFill.width + x) * 4; smallFill.data[i] = smallFill.data[i + 1] = smallFill.data[i + 2] = 0 }
    const result = recognizeRaster(smallFill)
    assert.equal(result.rooms.length, 0); assert.equal(result.walls.length, 0)
    assert.ok(result.issues.some(issue => issue.id === 'complex-image' && issue.severity === 'review'))
  }
})

test('disconnected nested contours are ambiguous, not overlapping rooms or invented holes', () => {
  const input = raster(); input.polygon([[60, 60], [540, 60], [540, 480], [60, 480]]); input.polygon([[200, 180], [400, 180], [400, 360], [200, 360]])
  assert.equal(recognizeRaster(input).rooms.length, 0)
})

test('general face graph handles diagonal junctions and does not close large endpoint gaps', () => {
  const p = [[30, 30], [250, 70], [270, 220], [50, 250]], walls = p.map((start, i) => ({ start, end: p[(i + 1) % p.length] }))
  walls.push({ start: p[0], end: p[2] })
  const rooms = roomsFromWalls(walls, 320, 300)
  assert.equal(rooms.length, 2); assert.ok(rooms.every(r => r.polygon.length === 3))
  assert.ok(Math.abs(rooms.reduce((a, r) => a + polygonArea(r.polygon), 0) - polygonArea(p)) < 0.01)
  assert.equal(roomsFromWalls(walls.slice(0, 3), 320, 300).length, 0)
  const withStub = [...walls.slice(0, 4), { start: p[0], end: [100, 120] }]
  assert.equal(roomsFromWalls(withStub, 320, 300).length, 1)
})

test('small annotation strokes and a curved outline do not become invented rooms', () => {
  const labels = raster()
  for (let y = 80; y < 400; y += 70) for (let x = 80; x < 550; x += 45) {
    labels.stroke([x, y], [x, y + 15]); labels.stroke([x, y], [x + 8, y]); labels.stroke([x, y + 8], [x + 8, y + 8]); labels.stroke([x, y + 15], [x + 8, y + 15])
  }
  assert.equal(recognizeRaster(labels).rooms.length, 0)
  const curved = raster()
  for (let i = 0; i < 100; i++) { const a = i / 100 * Math.PI * 2, b = (i + 1) / 100 * Math.PI * 2; curved.stroke([320 + 160 * Math.cos(a), 280 + 160 * Math.sin(a)], [320 + 160 * Math.cos(b), 280 + 160 * Math.sin(b)]) }
  assert.equal(recognizeRaster(curved).rooms.length, 0)
})

test('bounded analysis maps large images back to original pixels before calibration', () => {
  const input = raster(1400, 1000), corners = [[-520, -320], [520, -320], [520, 320], [-520, 320]].map(p => rotate(p, 17, [700, 500]))
  input.polygon(corners, { thickness: 8, wobble: 3, uneven: true })
  const result = verifySingleRoom({ input, corners }, { tolerance: 9 })
  assert.equal(result.statistics.analysisMaxDimension, 640)
  assert.ok(result.walls.length <= 100)
  assert.throws(() => recognizeRaster(input, { maxGap: NaN }), /finite numbers/)
  assert.throws(() => recognizeRaster({ width: 2001, height: 2000, data: [] }), /four million/)
})

test('deterministic sparse noise and an open jagged stroke neither crash nor infer rooms', () => {
  for (let seed = 1; seed <= 4; seed++) {
    const input = raster(400, 320); let value = seed
    for (let i = 0; i < 1200; i++) {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0; const x = value % input.width
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0; const y = value % input.height
      const j = (y * input.width + x) * 4; input.data[j] = input.data[j + 1] = input.data[j + 2] = 30
    }
    const result = recognizeRaster(input)
    assert.equal(result.rooms.length, 0)
    assert.ok(result.walls.every(w => [...w.start, ...w.end, w.confidence].every(Number.isFinite)))
  }
  const jagged = raster(), points = Array.from({ length: 14 }, (_, i) => [45 + i * 40, i % 2 ? 390 : 150])
  for (let i = 1; i < points.length; i++) jagged.stroke(points[i - 1], points[i], { thickness: 3 })
  assert.equal(recognizeRaster(jagged).rooms.length, 0)
})

test('retained actual labeled PNG keeps two rooms, five walls and one door, also when rotated', () => {
  // Produced by check-spatial-import-editor.mjs from its authored SVG; contains
  // actual rendered "Living room", "Kitchen" and "10.00 m" text, not mock OCR.
  const input = readPng(new URL('./fixtures/labeled-floorplan.png', import.meta.url))
  for (const angle of [0, 17, 37]) {
    const result = recognizeRaster(angle ? rotateRaster(input, angle) : input, { maxGap: 75 })
    assert.equal(result.rooms.length, 2, `labeled PNG rotation ${angle}`)
    assert.equal(result.walls.length, 5)
    assert.equal(result.openings.length, 1)
    const model = recognitionToBuilding(result, { mmPerPixel: 12.5, buildingId: 'labeled-png' })
    assert.equal(validateBuilding(model).valid, true)
  }
})

test('a tightly cropped one-pixel boundary remains an observed closed room', () => {
  const input = raster(320, 240)
  for (let y = 0; y < input.height; y++) for (let x = 0; x < input.width; x++) if (!x || !y || x === input.width - 1 || y === input.height - 1) {
    const i = (y * input.width + x) * 4; input.data[i] = input.data[i + 1] = input.data[i + 2] = 0
  }
  const result = recognizeRaster(input)
  assert.equal(result.rooms.length, 1); assert.equal(result.walls.length, 4)
  for (const p of [[0, 0], [319, 0], [319, 239], [0, 239]]) assert.ok(result.rooms[0].polygon.some(q => Math.hypot(q[0] - p[0], q[1] - p[1]) < 1))
})
