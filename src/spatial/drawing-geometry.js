// Bounded, browser-local stroke fitting. Coordinates are always returned in the
// original image, so calibration and the review overlay share the same geometry.
const cross = (a, b) => a[0] * b[1] - a[1] * b[0]
const subtract = (a, b) => [a[0] - b[0], a[1] - b[1]]
const signedArea = points => points.reduce((sum, p, i) => sum + cross(p, points[(i + 1) % points.length]), 0) / 2

function skeleton(mask, width, height) {
  // White padding keeps tightly cropped boundary strokes in the thinning graph.
  const originalWidth = width, originalHeight = height
  width += 2; height += 2
  const pixels = new Uint8Array(width * height), remove = []
  for (let y = 0; y < originalHeight; y++) pixels.set(mask.subarray(y * originalWidth, (y + 1) * originalWidth), (y + 1) * width + 1)
  let exhausted = false
  // Limit work even for filled shapes; those are rejected before fitting.
  for (let iteration = 0; iteration < 32; iteration++) {
    let changed = false
    for (let phase = 0; phase < 2; phase++) {
      remove.length = 0
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const i = y * width + x
        if (!pixels[i]) continue
        const p = [pixels[i - width], pixels[i - width + 1], pixels[i + 1], pixels[i + width + 1], pixels[i + width], pixels[i + width - 1], pixels[i - 1], pixels[i - width - 1]]
        const count = p.reduce((a, b) => a + b, 0)
        if (count < 2 || count > 6) continue
        let transitions = 0
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) transitions++
        if (transitions !== 1) continue
        if (phase ? p[0] * p[2] * p[6] || p[0] * p[4] * p[6] : p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) continue
        remove.push(i)
      }
      for (const i of remove) pixels[i] = 0
      changed ||= remove.length > 0
    }
    if (!changed) break
    if (iteration === 31) exhausted = true
  }
  const points = []
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) if (pixels[y * width + x]) points.push([x - 1, y - 1])
  return { points, exhausted }
}

function fitLine(points) {
  const center = points.reduce((s, p) => [s[0] + p[0] / points.length, s[1] + p[1] / points.length], [0, 0])
  let xx = 0, xy = 0, yy = 0
  for (const p of points) { const x = p[0] - center[0], y = p[1] - center[1]; xx += x * x; xy += x * y; yy += y * y }
  let angle = Math.atan2(2 * xy, xx - yy) / 2
  if (angle < 0) angle += Math.PI
  const u = [Math.cos(angle), Math.sin(angle)], n = [-u[1], u[0]], rho = center[0] * n[0] + center[1] * n[1]
  return { u, n, rho }
}

function projectedPieces(points, line, gap) {
  const projected = points.map(p => p[0] * line.u[0] + p[1] * line.u[1]).sort((a, b) => a - b), pieces = []
  for (const t of projected) {
    if (!pieces.length || t - pieces.at(-1)[1] > gap) pieces.push([t, t])
    else pieces.at(-1)[1] = t
  }
  return pieces
}

export function fitRasterWalls(mask, width, height, { minimum, maxGap }) {
  const scale = Math.min(1, 640 / Math.max(width, height)), w = Math.ceil(width * scale), h = Math.ceil(height * scale), small = new Uint8Array(w * h)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) small[Math.min(h - 1, Math.floor(y * scale)) * w + Math.min(w - 1, Math.floor(x * scale))] = 1
  const { points, exhausted } = skeleton(small, w, h)
  // A solid fill can retain a dense interior at the iteration ceiling. Those
  // pixels are not centerline evidence and must never become invented walls.
  if (exhausted || points.length > 24000) return { walls: [], limited: true }
  if (!points.length) return { walls: [], limited: false }
  const angles = 180, rhoStep = 1.5, radius = Math.ceil(Math.hypot(w, h) / rhoStep) + 2, bins = radius * 2 + 1, votes = new Uint16Array(angles * bins)
  const directions = Array.from({ length: angles }, (_, i) => { const theta = i * Math.PI / angles; return { u: [Math.cos(theta), Math.sin(theta)], n: [-Math.sin(theta), Math.cos(theta)] } })
  for (let a = 0; a < angles; a++) {
    const n = directions[a].n, offset = a * bins
    for (const p of points) votes[offset + Math.round((p[0] * n[0] + p[1] * n[1]) / rhoStep) + radius]++
  }
  const peaks = [], required = Math.max(10, minimum * scale * 0.55)
  for (let a = 0; a < angles; a++) for (let r = 1; r < bins - 1; r++) {
    const count = votes[a * bins + r]
    if (count < required || count < votes[a * bins + r - 1] || count < votes[a * bins + r + 1]) continue
    peaks.push({ a, rho: (r - radius) * rhoStep, count })
  }
  peaks.sort((a, b) => b.count - a.count)
  const candidates = [], acceptedPeaks = [], tolerance = 3.2
  // A fixed peak/line ceiling bounds fitting independently of image complexity.
  for (const peak of peaks) {
    if (acceptedPeaks.length >= 160) break
    const initial = { ...directions[peak.a], rho: peak.rho }
    if (acceptedPeaks.some(p => Math.abs(cross(p.u, initial.u)) < 0.045 && Math.abs(p.rho * Math.sign(p.n[0] * initial.n[0] + p.n[1] * initial.n[1]) - peak.rho) < 4)) continue
    acceptedPeaks.push(initial)
    const supported = points.filter(p => Math.abs(p[0] * initial.n[0] + p[1] * initial.n[1] - initial.rho) <= tolerance)
    const groups = projectedPieces(supported, initial, Math.max(3, maxGap * scale + 1))
    for (const group of groups) {
      if (group[1] - group[0] < minimum * scale) continue
      let selected = supported.filter(p => { const t = p[0] * initial.u[0] + p[1] * initial.u[1]; return t >= group[0] && t <= group[1] })
      if (selected.length < 2) continue
      let line = fitLine(selected)
      // Refit against nearby observed centerline pixels, never extrapolated ink.
      selected = points.filter(p => { const t = p[0] * initial.u[0] + p[1] * initial.u[1]; return t >= group[0] - 2 && t <= group[1] + 2 && Math.abs(p[0] * line.n[0] + p[1] * line.n[1] - line.rho) <= tolerance })
      if (selected.length < 2) continue
      line = fitLine(selected)
      const pieces = projectedPieces(selected, line, 3.5)
      if (!pieces.length) continue
      const start = pieces[0][0], end = pieces.at(-1)[1], length = end - start
      const occupied = new Set(selected.map(p => Math.round(p[0] * line.u[0] + p[1] * line.u[1]))).size
      const coverage = occupied / Math.max(1, length)
      if (length < minimum * scale || coverage < 0.55 || selected.length < minimum * scale * 0.65) continue
      const residual = Math.sqrt(selected.reduce((sum, p) => sum + (p[0] * line.n[0] + p[1] * line.n[1] - line.rho) ** 2, 0) / selected.length)
      candidates.push({ ...line, start, end, pieces, coverage, residual, selected, score: occupied * coverage / (1 + residual * 0.3) })
    }
  }
  const retained = []
  const explains = (line, p, tolerance = 3.6) => {
    const t = p[0] * line.u[0] + p[1] * line.u[1]
    return t >= line.start - 3 && t <= line.end + 3 && Math.abs(p[0] * line.n[0] + p[1] * line.n[1] - line.rho) <= tolerance
  }
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const middle = [(candidate.u[0] * (candidate.start + candidate.end) / 2 + candidate.n[0] * candidate.rho), (candidate.u[1] * (candidate.start + candidate.end) / 2 + candidate.n[1] * candidate.rho)]
    const match = retained.find(line => {
      if (Math.abs(cross(line.u, candidate.u)) > 0.07 || Math.abs(middle[0] * line.n[0] + middle[1] * line.n[1] - line.rho) > 4) return false
      const a = candidate.u[0] * line.u[0] + candidate.u[1] * line.u[1], offset = candidate.rho * (candidate.n[0] * line.u[0] + candidate.n[1] * line.u[1])
      const ends = [candidate.start * a + offset, candidate.end * a + offset].sort((x, y) => x - y)
      return Math.min(line.end, ends[1]) - Math.max(line.start, ends[0]) > Math.min(line.end - line.start, candidate.end - candidate.start) * 0.4
    })
    if (match) {
      // Recover a complete stroke from overlapping fits before suppressing
      // corner fragments. Keep the union of observed pixels, not a filled span.
      const selected = [...new Map([...match.selected, ...candidate.selected].map(p => [p.join(','), p])).values()]
      const fit = fitLine(selected), pieces = projectedPieces(selected, fit, 3.5)
      Object.assign(match, fit, { selected, pieces, start: pieces[0][0], end: pieces.at(-1)[1] })
      continue
    }
    const unexplained = candidate.selected.filter(p => !retained.some(line => explains(line, p)))
    if (unexplained.length < Math.max(minimum * scale * 0.6, candidate.selected.length * 0.48)) continue
    retained.push(candidate)
    if (retained.length >= 100) break
  }
  const walls = retained.map((line, i) => {
    const at = t => [(line.u[0] * t + line.n[0] * line.rho) / scale, (line.u[1] * t + line.n[1] * line.rho) / scale]
    return { id: `recognized-wall-${i + 1}`, start: at(line.start), end: at(line.end), thickness: 3 / scale, confidence: Math.min(0.91, 0.5 + line.coverage * 0.3 - line.residual * 0.045), gaps: line.pieces.slice(1).map((piece, i) => ({ start: at(line.pieces[i][1]), end: at(piece[0]) })).filter(gap => Math.hypot(...subtract(gap.start, gap.end)) >= 7 / scale), residual: line.residual / scale }
  })
  snapWallJunctions(walls)
  return { walls, limited: retained.length >= 100 || acceptedPeaks.length >= 160 }
}

function intersection(a, b) {
  const u = subtract(a.end, a.start), v = subtract(b.end, b.start), delta = subtract(b.start, a.start), d = cross(u, v)
  if (Math.abs(d) < 0.0001) return null
  const t = cross(delta, v) / d, s = cross(delta, u) / d
  return { point: [a.start[0] + u[0] * t, a.start[1] + u[1] * t], t, s }
}

export function snapWallJunctions(walls) {
  // Only absorb stroke end caps/jitter. maxGap is never used to invent corners.
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const a = walls[i], b = walls[j], hit = intersection(a, b)
    if (!hit) continue
    const al = Math.hypot(...subtract(a.end, a.start)), bl = Math.hypot(...subtract(b.end, b.start)), reach = Math.min(10, Math.max(5, (a.thickness || 1) + (b.thickness || 1)))
    if (hit.t < -reach / al || hit.t > 1 + reach / al || hit.s < -reach / bl || hit.s > 1 + reach / bl) continue
    for (const wall of [a, b]) for (const endpoint of ['start', 'end']) if (Math.hypot(...subtract(wall[endpoint], hit.point)) <= reach) wall[endpoint] = [...hit.point]
  }
}

const inside = (point, polygon) => {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) result = !result
  }
  return result
}

export function planarRooms(input, width, height) {
  if (!input.length || input.length > 128) return []
  const walls = input.map(w => ({ ...w, start: [...w.start], end: [...w.end] }))
  snapWallJunctions(walls)
  const cuts = walls.map(w => [{ t: 0, point: w.start }, { t: 1, point: w.end }])
  for (let i = 0; i < walls.length; i++) for (let j = i + 1; j < walls.length; j++) {
    const hit = intersection(walls[i], walls[j])
    if (hit && hit.t >= -0.0001 && hit.t <= 1.0001 && hit.s >= -0.0001 && hit.s <= 1.0001) { cuts[i].push({ t: hit.t, point: hit.point }); cuts[j].push({ t: hit.s, point: hit.point }) }
  }
  const nodes = [], edges = []
  const node = point => { let index = nodes.findIndex(n => Math.hypot(...subtract(n.point, point)) < 0.5); if (index < 0) { index = nodes.length; nodes.push({ point, edges: [] }) } return index }
  for (const segments of cuts) {
    segments.sort((a, b) => a.t - b.t)
    for (let i = 1; i < segments.length; i++) {
      const a = node(segments[i - 1].point), b = node(segments[i].point)
      if (a === b || nodes[a].edges.some(e => edges[e].to === b)) continue
      const first = edges.length
      edges.push({ from: a, to: b, twin: first + 1 }, { from: b, to: a, twin: first })
      nodes[a].edges.push(first); nodes[b].edges.push(first + 1)
    }
  }
  // An unfinished partition or attached annotation cannot define a face. Peel
  // its dangling edges rather than losing the surrounding observed room.
  const degrees = nodes.map(n => n.edges.length), removed = new Set(), leaves = degrees.flatMap((degree, i) => degree === 1 ? [i] : [])
  for (let i = 0; i < leaves.length; i++) for (const edgeId of nodes[leaves[i]].edges) {
    if (removed.has(edgeId)) continue
    const edge = edges[edgeId]; removed.add(edgeId); removed.add(edge.twin)
    if (--degrees[edge.to] === 1) leaves.push(edge.to)
  }
  for (const n of nodes) {
    n.edges = n.edges.filter(e => !removed.has(e))
    n.edges.sort((a, b) => { const p = subtract(nodes[edges[a].to].point, n.point), q = subtract(nodes[edges[b].to].point, n.point); return Math.atan2(p[1], p[0]) - Math.atan2(q[1], q[0]) })
  }
  const polygons = [], visited = new Set()
  for (let first = 0; first < edges.length; first++) {
    if (visited.has(first) || removed.has(first)) continue
    const path = [], seen = new Set(); let current = first
    while (!seen.has(current) && path.length <= edges.length) {
      seen.add(current); visited.add(current)
      const edge = edges[current], n = nodes[edge.to]
      path.push(edge.from)
      current = n.edges[(n.edges.indexOf(edge.twin) + n.edges.length - 1) % n.edges.length]
    }
    if (current !== first || new Set(path).size !== path.length) continue
    const points = path.map(n => nodes[n].point), polygon = points.filter((p, i) => { const a = points[(i + points.length - 1) % points.length], b = points[(i + 1) % points.length]; return Math.abs(cross(subtract(p, a), subtract(b, p))) > 0.01 })
    if (polygon.length >= 3 && polygon.length <= 64 && signedArea(polygon) >= Math.max(250, width * height * 0.001)) polygons.push(polygon)
  }
  // A nested disconnected contour implies an unsupported hole, furniture or
  // annotation. Reject its surrounding candidate instead of overlapping rooms.
  return polygons.filter(polygon => !polygons.some(other => other !== polygon && (other.every(p => inside(p, polygon)) || polygon.every(p => inside(p, other)))))
    .sort((a, b) => Math.min(...a.map(p => p[1])) - Math.min(...b.map(p => p[1])) || Math.min(...a.map(p => p[0])) - Math.min(...b.map(p => p[0])))
    .map((polygon, i) => ({ id: `recognized-room-${i + 1}`, name: `Room ${i + 1}`, polygon, confidence: 0.72 }))
}
