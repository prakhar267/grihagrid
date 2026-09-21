import { buildPrimitives, toV2, floorApertures } from './model.js'

// Sections are presentation derived from the accepted geometry, never new walls.
export function sectionPlane(input, settings = {}) {
  const rooms = input.rooms.filter(room => !room.exterior)
  const points = (rooms.length ? rooms : input.rooms).flatMap(room => room.polygon)
  const min = [0, 1].map(axis => points.length ? Math.min(...points.map(p => p[axis])) : input.bounds.min[axis])
  const max = [0, 1].map(axis => points.length ? Math.max(...points.map(p => p[axis])) : input.bounds.max[axis])
  const axis = settings.axis === 'x' ? 0 : 1
  const percent = Number.isFinite(settings.percent) ? Math.max(5, Math.min(95, settings.percent)) : 50
  return { axis, across: 1 - axis, percent, coordinate: min[axis] + (max[axis] - min[axis]) * percent / 100,
    min, max, name: axis === 1 ? 'A–A' : 'B–B', direction: axis === 1 ? '+Y' : '−X' }
}

// Half-open edge crossings handle concave outlines and shared polygon vertices.
export function sectionIntervals(polygon, axis, coordinate) {
  const crossings = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length]
    if ((a[axis] <= coordinate && b[axis] > coordinate) || (b[axis] <= coordinate && a[axis] > coordinate)) {
      const t = (coordinate - a[axis]) / (b[axis] - a[axis])
      crossings.push(a[1 - axis] + t * (b[1 - axis] - a[1 - axis]))
    }
  }
  crossings.sort((a, b) => a - b)
  const intervals = []
  for (let i = 0; i + 1 < crossings.length; i += 2) if (crossings[i + 1] - crossings[i] > 0.001) intervals.push([crossings[i], crossings[i + 1]])
  return intervals
}
export function subtractIntervals(intervals, holes) {
  return holes.reduce((remaining, [lo, hi]) => remaining.flatMap(([a, b]) => {
    if (hi <= a || lo >= b) return [[a, b]]
    return [...(lo > a ? [[a, lo]] : []), ...(hi < b ? [[hi, b]] : [])]
  }), intervals)
}
function footprint(primitive) {
  const angle = primitive.rotation || primitive.rotationZ || 0, c = Math.cos(angle), s = Math.sin(angle)
  const points = primitive.kind === 'cylinder'
    ? Array.from({ length: 16 }, (_, i) => [Math.cos(i * Math.PI / 8), Math.sin(i * Math.PI / 8)])
    : [[-1, -1], [1, -1], [1, 1], [-1, 1]]
  return points.map(([x, y]) => [primitive.position[0] + x * primitive.size[0] / 2 * c - y * primitive.size[1] / 2 * s,
    primitive.position[1] + x * primitive.size[0] / 2 * s + y * primitive.size[1] / 2 * c])
}
export function buildingSection(input, settings = {}) {
  const model = toV2(input), plane = sectionPlane(model, settings), parts = []
  for (const primitive of buildPrimitives(model)) {
    if (!['wall', 'floor', 'roof', 'opening', 'stairs'].includes(primitive.category)) continue
    let intervals
    if (primitive.kind === 'mesh') {
      const room = model.rooms.find(room => room.id === primitive.roomId)
      if (!room) continue
      const holes = floorApertures(model, room.floorId, primitive.category === 'roof')
      intervals = subtractIntervals(sectionIntervals(room.polygon, plane.axis, plane.coordinate),
        holes.flatMap(hole => sectionIntervals(hole.polygon, plane.axis, plane.coordinate)))
    } else intervals = sectionIntervals(footprint(primitive), plane.axis, plane.coordinate)
    for (const [left, right] of intervals) parts.push({ id: primitive.id, floorId: primitive.floorId, category: primitive.category,
      left, right, bottom: primitive.position[2] - primitive.size[2] / 2, top: primitive.position[2] + primitive.size[2] / 2 })
  }
  const rooms = model.rooms.filter(room => !room.exterior).flatMap(room => sectionIntervals(room.polygon, plane.axis, plane.coordinate)
    .map(([left, right]) => ({ id: room.id, name: room.name, floorId: room.floorId, left, right })))
  return { ...plane, parts, rooms, floors: [...model.floors].sort((a, b) => a.elevation - b.elevation) }
}

export function sectionCamera(input, settings = {}) {
  const plane = sectionPlane(input, settings), top = Math.max(...input.floors.map(f => f.elevation + f.height))
  const target = [(plane.min[0] + plane.max[0]) / 2, (plane.min[1] + plane.max[1]) / 2, top / 2]
  target[plane.axis] = plane.coordinate
  const distance = Math.max(plane.max[plane.across] - plane.min[plane.across], top) * 1.5 + 2000
  const position = [...target]; position[plane.axis] += plane.axis === 0 ? distance : -distance; position[2] += top * .28
  return { position, target, fov: 52 }
}
