// Preserved axis-aligned extraction for clearly orthogonal labeled plans.
// Arbitrary-angle fitting selects this path only when dominant observed strokes agree.
const clamp = (x, a, b) => Math.max(a, Math.min(b, x))

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

export function orthogonalWalls(mask, width, height, { minimum, maxGap }) {
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
  return { walls, openings }
}

export function alignedWalls(mask, width, height, options, angle) {
  if (Math.abs(angle) < 0.005) return orthogonalWalls(mask, width, height, options)
  const cosine = Math.cos(angle), sine = Math.sin(angle)
  const corners = [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]].map(([x, y]) => [x * cosine + y * sine, -x * sine + y * cosine])
  const minX = Math.floor(Math.min(...corners.map(p => p[0]))) - 2, minY = Math.floor(Math.min(...corners.map(p => p[1]))) - 2
  const w = Math.ceil(Math.max(...corners.map(p => p[0]))) - minX + 3, h = Math.ceil(Math.max(...corners.map(p => p[1]))) - minY + 3
  const upright = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const u = x + minX, v = y + minY, ox = Math.round(u * cosine - v * sine), oy = Math.round(u * sine + v * cosine)
    if (ox >= 0 && oy >= 0 && ox < width && oy < height) upright[y * w + x] = mask[oy * width + ox]
  }
  const result = orthogonalWalls(upright, w, h, options)
  const original = ([x, y]) => [(x + minX) * cosine - (y + minY) * sine, (x + minX) * sine + (y + minY) * cosine]
  result.walls = result.walls.map(wall => ({ ...wall, start: original(wall.start), end: original(wall.end) }))
  return result
}
