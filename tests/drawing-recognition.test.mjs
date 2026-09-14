import test from 'node:test'
import assert from 'node:assert/strict'
import { recognizeRaster, roomsFromWalls, recognitionToBuilding, calibrateScale, dimensionCandidates } from '../src/spatial/drawing-recognition.js'

function image(width = 320, height = 240) {
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  const line = (x1, y1, x2, y2, thickness = 3) => {
    const steps = Math.ceil(Math.hypot(x2 - x1, y2 - y1))
    for (let i = 0; i <= steps; i++) {
      const x = Math.round(x1 + (x2 - x1) * i / steps), y = Math.round(y1 + (y2 - y1) * i / steps)
      for (let dy = -Math.floor(thickness / 2); dy <= Math.floor(thickness / 2); dy++) for (let dx = -Math.floor(thickness / 2); dx <= Math.floor(thickness / 2); dx++) {
        const px = x + dx, py = y + dy
        if (px >= 0 && px < width && py >= 0 && py < height) { const j = (py * width + px) * 4; data[j] = data[j + 1] = data[j + 2] = 20 }
      }
    }
  }
  return { data, width, height, line }
}

test('offline recognition derives two rooms and a door gap from actual pixels', () => {
  const input = image(); input.line(30, 30, 290, 30); input.line(30, 210, 290, 210); input.line(30, 30, 30, 210); input.line(290, 30, 290, 210)
  input.line(160, 30, 160, 100); input.line(160, 121, 160, 210)
  const result = recognizeRaster(input, { maxGap: 30 })
  assert.equal(result.rooms.length, 2)
  assert.equal(result.walls.length, 5)
  assert.equal(result.openings.length, 1)
  assert.ok(result.openings[0].width >= 16 && result.openings[0].width <= 24)
  const scale = calibrateScale([30, 30], [290, 30], 10000)
  const building = recognitionToBuilding(result, { mmPerPixel: scale, buildingId: 'pixel-plan' })
  assert.equal(building.rooms.length, 2); assert.equal(building.furniture.length, 0); assert.equal(building.schemaVersion, 2)
  assert.ok(Math.abs(building.bounds.max[0] - 10000) < 100)
})

test('blank or unclosed drawings never load a substitute house', () => {
  const blank = recognizeRaster(image()); assert.equal(blank.rooms.length, 0); assert.equal(blank.walls.length, 0)
  const open = image(); open.line(30, 30, 290, 30); open.line(30, 30, 30, 210); open.line(290, 30, 290, 210)
  assert.equal(recognizeRaster(open).rooms.length, 0)
  assert.throws(() => recognitionToBuilding(blank, { mmPerPixel: 10 }), /enclosed room/)
})

test('segmentation preserves an L-shaped room instead of its bounding rectangle', () => {
  const points = [[20, 20], [220, 20], [220, 100], [120, 100], [120, 200], [20, 200]]
  const walls = points.map((start, i) => ({ id: `wall-${i}`, start, end: points[(i + 1) % points.length] }))
  const rooms = roomsFromWalls(walls, 260, 240)
  assert.equal(rooms.length, 1); assert.equal(rooms[0].polygon.length, 6)
})

test('moderately uneven pencil strokes still produce reviewed room candidates', () => {
  const input = image(); input.line(30, 30, 290, 31, 4); input.line(30, 210, 290, 209, 4); input.line(30, 30, 31, 210, 4); input.line(290, 30, 289, 210, 4)
  const result = recognizeRaster(input)
  assert.equal(result.rooms.length, 1)
  assert.ok(result.issues.some(issue => issue.id === 'review'))
})

test('scale requires real points and OCR candidates retain unverified status', () => {
  assert.throws(() => calibrateScale([1, 1], [2, 2], 3000), /five pixels/)
  assert.throws(() => calibrateScale([1, 1], [20, 20], -2), /positive/)
  assert.equal(calibrateScale([0, 0], [100, 0], 4000), 40)
  assert.deepEqual(dimensionCandidates('ROOM 4.2 m, width 350 cm, door 900mm').map(d => d.distanceMm), [4200, 3500, 900])
  assert.ok(dimensionCandidates('12 ft 6 in').every(d => d.confidence === 'unverified'))
})
