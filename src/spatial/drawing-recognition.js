// Browser-local geometry recognition. No provider request, sample geometry, or image persistence.
// Arbitrary-angle stroke support + a planar graph keep results tied to observed pixels.
import { fitRasterWalls, planarRooms } from './drawing-geometry.js'
import { alignedWalls } from './drawing-orthogonal.js'

const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

// General bounded planar faces also power manual wall/endpoint corrections.
// Door gaps are sealed only in the segmentation graph and remain explicit.
export const roomsFromWalls = planarRooms

export function recognizeRaster({ data, width, height }, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width * height > 4000000 || !data || data.length < width * height * 4) throw new Error('Use an image between 8 pixels and four million pixels for recognition.')
  for (const key of ['threshold', 'minWallLength', 'maxGap']) if (options[key] !== undefined && !Number.isFinite(options[key])) throw new Error('Recognition settings must be finite numbers.')
  const threshold = clamp(options.threshold ?? 180, 20, 245), minimum = clamp(options.minWallLength ?? Math.min(width, height) * 0.045, 12, 300)
  const maxGap = clamp(options.maxGap ?? Math.min(width, height) * 0.105, 3, Math.max(width, height) * 0.2)
  const mask = new Uint8Array(width * height); let ink = 0
  for (let i = 0; i < mask.length; i++) { const j = i * 4, alpha = data[j + 3] / 255, light = (data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722) * alpha + 255 * (1 - alpha); mask[i] = light < threshold ? 1 : 0; ink += mask[i] }
  const dark = ink / mask.length > 0.35
  const fitted = dark ? { walls: [], limited: false } : fitRasterWalls(mask, width, height, { minimum, maxGap })
  let walls = fitted.walls, openings = []
  for (const wall of walls) {
    const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy)
    for (const gap of wall.gaps || []) {
      const start = ((gap.start[0] - wall.start[0]) * dx + (gap.start[1] - wall.start[1]) * dy) / length
      const end = ((gap.end[0] - wall.start[0]) * dx + (gap.end[1] - wall.start[1]) * dy) / length
      if (end - start >= 7 && end - start <= maxGap + 1 && start > 0 && end < length) openings.push({ id: `recognized-opening-${openings.length + 1}`, wallId: wall.id, offset: start, width: end - start, kind: 'door', confidence: 0.45 })
    }
  }
  let rooms = roomsFromWalls(walls, width, height), method = 'local-angle-fit'
  // Keep the established text-resistant scan for strongly orthogonal drawings.
  // The arbitrary-angle fits decide alignment; projected row runs alone cannot
  // distinguish a rotated stroke from a thick horizontal/vertical one.
  const dominant = walls.filter(w => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1]) >= Math.max(width, height) * 0.2).sort((a, b) => Math.hypot(b.end[0] - b.start[0], b.end[1] - b.start[1]) - Math.hypot(a.end[0] - a.start[0], a.end[1] - a.start[1])).slice(0, 8)
  const length = w => Math.hypot(w.end[0] - w.start[0], w.end[1] - w.start[1])
  const direction = w => Math.atan2(w.end[1] - w.start[1], w.end[0] - w.start[0])
  const angle = Math.atan2(dominant.reduce((sum, w) => sum + Math.sin(direction(w) * 4) * length(w), 0), dominant.reduce((sum, w) => sum + Math.cos(direction(w) * 4) * length(w), 0)) / 4
  const aligned = dominant.filter(w => Math.abs(Math.sin((direction(w) - angle) * 2)) < 0.02)
  if (!dark && dominant.length >= 3 && aligned.reduce((sum, w) => sum + length(w), 0) / dominant.reduce((sum, w) => sum + length(w), 0) > 0.9) {
    const orthogonal = alignedWalls(mask, width, height, { minimum, maxGap }, angle), candidates = roomsFromWalls(orthogonal.walls, width, height)
    if (candidates.length && orthogonal.walls.every(w => w.thickness <= Math.max(8, Math.max(width, height) * 0.025))) {
      walls = orthogonal.walls; openings = orthogonal.openings; rooms = candidates; method = Math.abs(angle) < 0.005 ? 'local-orthogonal-scan' : 'local-aligned-scan'
    }
  }
  const issues = [
    { id: 'scale', severity: 'required', text: 'Calibrate a known dimension before converting pixels to a building.' },
    { id: 'review', severity: 'review', text: 'Review every wall and room. Text, furniture and overlapping strokes can be mistaken for architecture. Curves and heavy perspective distortion need manual correction.' },
  ]
  if (!rooms.length) issues.push({ id: 'open-contours', severity: 'required', text: 'No unambiguous enclosed rooms were found. Correct missing walls, separate nested outlines, adjust the threshold, or trace room polygons over this drawing.' })
  if (openings.length) issues.push({ id: 'openings', severity: 'review', text: `${openings.length} gaps are proposed as doors. Confirm their type and width; window symbols are not reliably distinguishable from gaps.` })
  if (walls.some(w => w.confidence < 0.65)) issues.push({ id: 'weak-walls', severity: 'review', text: 'Dashed copper walls have weak pixel support. Remove dimension lines and correct ambiguous edges.' })
  if (fitted.limited && method === 'local-angle-fit') issues.push({ id: 'complex-image', severity: 'review', text: 'The bounded line detector reached its complexity limit. Crop a smaller floor plan and review missing edges.' })
  if (dark) issues.push({ id: 'dark-image', severity: 'review', text: 'This image contains too much dark ink for reliable line recognition. Use a clearer plan crop or adjust the threshold; no rooms were inferred.' })
  return { version: 1, source: 'offline-raster', width, height, walls, rooms, openings, issues, statistics: { inkFraction: ink / mask.length, wallCount: walls.length, roomCount: rooms.length, method, analysisMaxDimension: Math.min(640, Math.max(width, height)) } }
}

export function calibrateScale(first, second, distanceMm) {
  const pixels = Math.hypot(first[0] - second[0], first[1] - second[1])
  if (!Number.isFinite(distanceMm) || distanceMm <= 0 || distanceMm > 1000000 || pixels < 5) throw new Error('Select two points at least five pixels apart and enter their real positive distance.')
  return distanceMm / pixels
}

function touchesWall(room, wall) {
  const dx = wall.end[0] - wall.start[0], dy = wall.end[1] - wall.start[1], length = Math.hypot(dx, dy)
  return room.polygon.some((p, index) => {
    const q = room.polygon[(index + 1) % room.polygon.length], middle = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2]
    const d = Math.abs((middle[0] - wall.start[0]) * dy - (middle[1] - wall.start[1]) * dx) / length
    const t = ((middle[0] - wall.start[0]) * dx + (middle[1] - wall.start[1]) * dy) / (length * length)
    return d < 5 && t >= -0.01 && t <= 1.01
  })
}

export function recognitionToBuilding(result, { mmPerPixel, name = 'Imported drawing', wallHeight = 3000, wallThickness = 180, buildingId = `drawing-${Date.now().toString(36)}` } = {}) {
  if (!Number.isFinite(mmPerPixel) || mmPerPixel <= 0) throw new Error('Calibrate the drawing before creating the model.')
  if (!result.rooms?.length) throw new Error('Trace or recognize at least one enclosed room.')
  const floorId = 'ground', sourcePoints = result.rooms.flatMap(r => r.polygon), ox = Math.min(...sourcePoints.map(p => p[0])), oy = Math.min(...sourcePoints.map(p => p[1]))
  const point = p => [Math.round((p[0] - ox) * mmPerPixel), Math.round((p[1] - oy) * mmPerPixel)]
  const colors = ['#d6c4a9', '#c8baa3', '#bdc1b5', '#e0d5bf', '#d0c3ad', '#bbc1b0']
  const rooms = result.rooms.map((room, index) => ({ id: room.id, name: String(room.name || `Room ${index + 1}`).slice(0, 80), floorId, polygon: room.polygon.map(point), color: colors[index % colors.length], exterior: false }))
  const walls = result.walls.map(wall => {
    const roomIds = result.rooms.filter(room => touchesWall(room, wall)).map(room => room.id)
    return { id: wall.id, floorId, start: point(wall.start), end: point(wall.end), roomIds, height: wallHeight, thickness: wallThickness, openings: (result.openings || []).filter(o => o.wallId === wall.id).map(o => ({ id: o.id, kind: o.kind, offset: Math.round(o.offset * mmPerPixel), width: Math.round(o.width * mmPerPixel), sill: o.kind === 'window' ? 900 : 0, height: o.kind === 'window' ? 1400 : Math.min(2350, wallHeight - 100), open: o.kind === 'door' })) }
  }).filter(wall => wall.roomIds.length)
  const all = rooms.flatMap(room => room.polygon), max = [Math.max(...all.map(p => p[0])), Math.max(...all.map(p => p[1])), wallHeight]
  return { schemaVersion: 2, id: buildingId, name: name.slice(0, 100), revision: 1, seed: 1847, units: 'mm', axes: 'XY-ground-Z-up', bounds: { min: [0, 0, 0], max }, floors: [{ id: floorId, name: 'Ground floor', elevation: 0, height: wallHeight }], rooms, walls, furniture: [], stairs: [], exterior: { groundColor: '#b5bc9e', skyColor: '#e7e5da', sun: [max[0] * 0.7, -7000, 14000] } }
}

export function dimensionCandidates(text) {
  const result = [], pattern = /(?:\b|^)(\d{1,4}(?:\.\d{1,3})?)\s*(mm|cm|metres?|meters?|m|feet|ft|′|')\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:inches|in|″|"))?/gi
  let match
  while ((match = pattern.exec(text || ''))) {
    const value = Number(match[1]), unit = match[2].toLowerCase(), mm = unit === 'mm' ? value : unit === 'cm' ? value * 10 : ['ft', 'feet', '′', "'"].includes(unit) ? value * 304.8 + Number(match[3] || 0) * 25.4 : value * 1000
    if (mm >= 100 && mm <= 1000000) result.push({ text: match[0], distanceMm: Math.round(mm), confidence: 'unverified' })
  }
  return result
}
