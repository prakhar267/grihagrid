// Browser-local geometry recognition. No provider request, sample geometry, or image persistence.
// Orthogonal line support + a planar cell graph keeps every result tied to observed pixels.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))
const area = polygon => Math.abs(polygon.reduce((sum, p, i) => { const q = polygon[(i + 1) % polygon.length]; return sum + p[0] * q[1] - q[0] * p[1] }, 0)) / 2
const simplify = polygon => polygon.filter((p, i, all) => { const a = all[(i + all.length - 1) % all.length], b = all[(i + 1) % all.length]; return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 0.01 })

function scanRuns(mask, width, height, horizontal, minimum) {
  const result = [], outer = horizontal ? height : width, inner = horizontal ? width : height
  for (let row = 0; row < outer; row++) {
    let start = -1, last = -1
    for (let col = 0; col <= inner + 2; col++) {
      const dark = col < inner && mask[horizontal ? row * width + col : col * width + row]
      if (dark) { if (start < 0) start = col; last = col }
      else if (start >= 0 && col - last > 2) {
        if (last - start + 1 >= minimum) result.push({ axis: horizontal ? 'h' : 'v', coordinate: row, start, end: last, support: 1 })
        start = -1
      }
    }
  }
  return result
}

function mergeRuns(runs, tolerance) {
  const groups = []
  for (const run of runs) {
    const match = groups.find(group => Math.abs(group.coordinate - run.coordinate) <= tolerance && Math.min(group.end, run.end) - Math.max(group.start, run.start) > Math.min(group.end - group.start, run.end - run.start) * 0.4)
    if (match) {
      match.coordinate = (match.coordinate * match.support + run.coordinate) / (match.support + 1)
      match.support++; match.low = Math.min(match.low, run.coordinate); match.high = Math.max(match.high, run.coordinate)
      match.start = Math.min(match.start, run.start); match.end = Math.max(match.end, run.end)
    } else groups.push({ ...run, low: run.coordinate, high: run.coordinate })
  }
  return groups.map(group => ({ ...group, thickness: Math.max(1, group.high - group.low + 1) }))
}

function joinCollinear(groups, maxGap) {
  const output = []
  for (const group of groups.sort((a, b) => a.coordinate - b.coordinate || a.start - b.start)) {
    const match = output.find(item => item.axis === group.axis && Math.abs(item.coordinate - group.coordinate) <= Math.max(4, (item.thickness + group.thickness) / 2) && group.start <= item.end + maxGap + 1 && group.end >= item.start - maxGap - 1)
    if (match) {
      match.pieces.push([group.start, group.end]); match.start = Math.min(match.start, group.start); match.end = Math.max(match.end, group.end)
      const n = match.support + group.support
      match.coordinate = (match.coordinate * match.support + group.coordinate * group.support) / n; match.support = n
      match.thickness = Math.max(match.thickness, group.thickness)
    } else output.push({ ...group, pieces: [[group.start, group.end]] })
  }
  return output
}

function snapJunctions(lines) {
  for (const line of lines) for (const other of lines) {
    if (line.axis === other.axis) continue
    const reach = Math.max(7, line.thickness + other.thickness)
    if (line.coordinate < other.start - reach || line.coordinate > other.end + reach) continue
    if (Math.abs(line.start - other.coordinate) <= reach) line.start = other.coordinate
    if (Math.abs(line.end - other.coordinate) <= reach) line.end = other.coordinate
  }
}

function uniqueCoordinates(values) {
  const sorted = [...values].sort((a, b) => a - b), out = []
  for (const value of sorted) {
    if (out.length && value - out.at(-1) < 3) out[out.length - 1] = (out.at(-1) + value) / 2
    else out.push(value)
  }
  return out
}

// Enclosed faces of the observed wall graph; openings are temporarily sealed only
// for room segmentation and remain explicit openings in the resulting model.
export function roomsFromWalls(walls, width, height) {
  if (!walls.length) return []
  const xs = uniqueCoordinates([-10, width + 10, ...walls.flatMap(w => [w.start[0], w.end[0]])])
  const ys = uniqueCoordinates([-10, height + 10, ...walls.flatMap(w => [w.start[1], w.end[1]])])
  if (xs.length > 130 || ys.length > 130) return []
  const cols = xs.length - 1, rows = ys.length - 1, visited = new Uint8Array(cols * rows), rooms = []
  const blocked = (x, y, dx, dy) => {
    const a = dx ? [xs[x + (dx > 0 ? 1 : 0)], (ys[y] + ys[y + 1]) / 2] : [(xs[x] + xs[x + 1]) / 2, ys[y + (dy > 0 ? 1 : 0)]]
    return walls.some(w => dx ? Math.abs(w.start[0] - w.end[0]) < 0.1 && Math.abs(w.start[0] - a[0]) < 4 && a[1] >= Math.min(w.start[1], w.end[1]) - 2 && a[1] <= Math.max(w.start[1], w.end[1]) + 2 : Math.abs(w.start[1] - w.end[1]) < 0.1 && Math.abs(w.start[1] - a[1]) < 4 && a[0] >= Math.min(w.start[0], w.end[0]) - 2 && a[0] <= Math.max(w.start[0], w.end[0]) + 2)
  }
  for (let first = 0; first < visited.length; first++) {
    if (visited[first]) continue
    const queue = [first], members = new Set([first]); visited[first] = 1; let outside = false
    for (let index = 0; index < queue.length; index++) {
      const cell = queue[index], x = cell % cols, y = Math.floor(cell / cols)
      if (!x || !y || x === cols - 1 || y === rows - 1) outside = true
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, next = ny * cols + nx
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || visited[next] || blocked(x, y, dx, dy)) continue
        visited[next] = 1; members.add(next); queue.push(next)
      }
    }
    if (outside) continue
    const edges = new Map(), add = (a, b) => edges.set(a.join(','), b)
    for (const cell of members) {
      const x = cell % cols, y = Math.floor(cell / cols)
      if (y === 0 || !members.has(cell - cols)) add([xs[x], ys[y]], [xs[x + 1], ys[y]])
      if (x === cols - 1 || !members.has(cell + 1)) add([xs[x + 1], ys[y]], [xs[x + 1], ys[y + 1]])
      if (y === rows - 1 || !members.has(cell + cols)) add([xs[x + 1], ys[y + 1]], [xs[x], ys[y + 1]])
      if (x === 0 || !members.has(cell - 1)) add([xs[x], ys[y + 1]], [xs[x], ys[y]])
    }
    const loops = []
    while (edges.size) {
      const start = edges.keys().next().value, polygon = [], seen = new Set(); let key = start
      while (edges.has(key) && !seen.has(key)) { seen.add(key); polygon.push(key.split(',').map(Number)); const next = edges.get(key); edges.delete(key); key = next.join(',') }
      if (key === start && polygon.length >= 4) loops.push(simplify(polygon))
    }
    const polygon = loops.sort((a, b) => area(b) - area(a))[0]
    if (polygon && area(polygon) >= Math.max(250, width * height * 0.001)) rooms.push({ id: `recognized-room-${rooms.length + 1}`, name: `Room ${rooms.length + 1}`, polygon, confidence: 0.75 })
  }
  return rooms.sort((a, b) => a.polygon[0][1] - b.polygon[0][1] || a.polygon[0][0] - b.polygon[0][0])
}

export function recognizeRaster({ data, width, height }, options = {}) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 8 || height < 8 || width * height > 4000000 || !data || data.length < width * height * 4) throw new Error('Use an image between 8 pixels and four million pixels for recognition.')
  const threshold = clamp(options.threshold ?? 180, 20, 245), minimum = clamp(options.minWallLength ?? Math.min(width, height) * 0.045, 12, 300)
  const maxGap = clamp(options.maxGap ?? Math.min(width, height) * 0.105, 3, Math.max(width, height) * 0.2)
  const mask = new Uint8Array(width * height); let ink = 0
  for (let i = 0; i < mask.length; i++) { const j = i * 4, alpha = data[j + 3] / 255, light = (data[j] * 0.2126 + data[j + 1] * 0.7152 + data[j + 2] * 0.0722) * alpha + 255 * (1 - alpha); mask[i] = light < threshold ? 1 : 0; ink += mask[i] }
  const groups = [...mergeRuns(scanRuns(mask, width, height, true, minimum), 6), ...mergeRuns(scanRuns(mask, width, height, false, minimum), 6)]
  const lines = joinCollinear(groups, maxGap).filter(line => line.end - line.start >= minimum).sort((a, b) => (b.end - b.start) * b.support - (a.end - a.start) * a.support).slice(0, 100)
  snapJunctions(lines)
  const walls = lines.map((line, index) => ({ id: `recognized-wall-${index + 1}`, start: line.axis === 'h' ? [line.start, line.coordinate] : [line.coordinate, line.start], end: line.axis === 'h' ? [line.end, line.coordinate] : [line.coordinate, line.end], thickness: line.thickness, confidence: clamp(0.48 + Math.min(line.support, 12) * 0.025 + (line.end - line.start) / Math.max(width, height) * 0.15, 0, 0.95), pieces: line.pieces, axis: line.axis }))
  const openings = []
  for (const wall of walls) {
    const pieces = wall.pieces.sort((a, b) => a[0] - b[0]); let end = pieces[0]?.[1]
    for (let i = 1; i < pieces.length; i++) {
      const gap = pieces[i][0] - end
      if (gap >= Math.max(7, wall.thickness * 1.2) && gap <= maxGap + 1) openings.push({ id: `recognized-opening-${openings.length + 1}`, wallId: wall.id, offset: end - (wall.axis === 'h' ? wall.start[0] : wall.start[1]), width: gap, kind: 'door', confidence: 0.45 })
      end = Math.max(end, pieces[i][1])
    }
  }
  const rooms = roomsFromWalls(walls, width, height)
  const issues = [
    { id: 'scale', severity: 'required', text: 'Calibrate a known dimension before converting pixels to a building.' },
    { id: 'review', severity: 'review', text: 'Review every wall and room. Dimensions, text, furniture and unusual wall angles can be mistaken for architecture.' },
  ]
  if (!rooms.length) issues.push({ id: 'open-contours', severity: 'required', text: 'No enclosed rooms were found. Correct missing walls, lower the threshold, or trace room polygons over this drawing.' })
  if (openings.length) issues.push({ id: 'openings', severity: 'review', text: `${openings.length} gaps are proposed as doors. Confirm their type and width; window symbols are not reliably distinguishable from gaps.` })
  if (walls.some(w => w.confidence < 0.65)) issues.push({ id: 'weak-walls', severity: 'review', text: 'Dashed copper walls have weak pixel support. Remove dimension lines and correct ambiguous edges.' })
  if (ink / mask.length > 0.4) issues.push({ id: 'dark-image', severity: 'review', text: 'This image is very dark. Adjust the ink threshold or use a clearer plan crop.' })
  return { version: 1, source: 'offline-raster', width, height, walls, rooms, openings, issues, statistics: { inkFraction: ink / mask.length, wallCount: walls.length, roomCount: rooms.length } }
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
