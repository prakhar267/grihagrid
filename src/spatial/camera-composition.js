import { doorLeafPrimitive } from './model-v2.js'

// Camera-to-subject visibility in the canonical model. A walkable camera alone
// is not enough: a tall wardrobe can still hide the bed from that position.
function intersectsBox(from, to, item, elevation) {
  const ca = Math.cos(item.rotation || 0), sa = Math.sin(item.rotation || 0)
  const local = p => {
    const x = p[0] - item.position[0], y = p[1] - item.position[1]
    return [x * ca + y * sa, -x * sa + y * ca, p[2] - elevation - item.position[2]]
  }
  const a = local(from), b = local(to)
  const min = [-item.size[0] / 2, -item.size[1] / 2, 0], max = [item.size[0] / 2, item.size[1] / 2, item.size[2]]
  let entry = 0, exit = 1
  for (let axis = 0; axis < 3; axis++) {
    const delta = b[axis] - a[axis]
    if (Math.abs(delta) < .00001) { if (a[axis] < min[axis] || a[axis] > max[axis]) return false; continue }
    const t0 = (min[axis] - a[axis]) / delta, t1 = (max[axis] - a[axis]) / delta
    entry = Math.max(entry, Math.min(t0, t1)); exit = Math.min(exit, Math.max(t0, t1))
    if (entry > exit) return false
  }
  return entry < .99 && exit > .01
}

function obstaclesFor(scene, subject) {
  const furniture = scene.furniture.filter(f => f.id !== subject.id && f.floorId === subject.floorId && !['rug', 'plant', 'lamp'].includes(f.kind))
  const doors = scene.walls.filter(w => w.floorId === subject.floorId).flatMap(w => w.openings.filter(o => o.kind === 'door').map(o => {
    const p = doorLeafPrimitive(w, o)
    return { ...p, position: [p.position[0], p.position[1], p.position[2] - p.size[2] / 2] }
  }))
  return [...furniture, ...doors]
}

export function subjectVisibility(scene, subject, camera) {
  const elevation = scene.floors.find(f => f.id === subject.floorId)?.elevation || 0
  const ca = Math.cos(subject.rotation || 0), sa = Math.sin(subject.rotation || 0)
  const points = [[0, 0], [-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]].map(([u, v]) => {
    const x = u * subject.size[0], y = v * subject.size[1]
    return [subject.position[0] + x * ca - y * sa, subject.position[1] + x * sa + y * ca, elevation + subject.position[2] + subject.size[2] * .8]
  })
  const obstacles = obstaclesFor(scene, subject)
  return points.filter(p => !obstacles.some(f => intersectsBox(camera, p, f, elevation))).length / points.length
}

// A door leaf can fill half the image without crossing a ray to the bed itself.
// Sample the composition, not only the subject, to avoid such foreground screens.
export function foregroundCoverage(scene, subject, camera, target, fov = 58, aspect = 16 / 9) {
  const elevation = scene.floors.find(f => f.id === subject.floorId)?.elevation || 0
  const delta = target.map((v, i) => v - camera[i]), distance = Math.hypot(...delta)
  if (distance < 1) return 1
  const forward = delta.map(v => v / distance), length = Math.hypot(forward[0], forward[1]) || 1
  const right = [forward[1] / length, -forward[0] / length, 0]
  const up = [right[1] * forward[2], -right[0] * forward[2], right[0] * forward[1] - right[1] * forward[0]]
  const height = Math.tan(fov * Math.PI / 360) * distance, obstacles = obstaclesFor(scene, subject)
  let blocked = 0, count = 0
  for (const x of [-.8, -.4, 0, .4, .8]) for (const y of [-.6, 0, .6]) {
    const end = target.map((v, i) => v + right[i] * x * height * aspect + up[i] * y * height)
    count++
    if (obstacles.some(f => intersectsBox(camera, end, f, elevation))) blocked++
  }
  return blocked / count
}

// Tall furniture beside the lens can dominate the frame even when the subject
// itself is visible. Prefer some breathing room around the camera as well.
export function cameraClearance(scene, subject, camera) {
  const elevation = scene.floors.find(f => f.id === subject.floorId)?.elevation || 0
  const distances = scene.furniture.filter(f => f.id !== subject.id && f.floorId === subject.floorId && elevation + f.position[2] + f.size[2] > camera[2] - 300).map(f => {
    const dx = camera[0] - f.position[0], dy = camera[1] - f.position[1], a = f.rotation || 0
    const x = dx * Math.cos(a) + dy * Math.sin(a), y = -dx * Math.sin(a) + dy * Math.cos(a)
    return Math.hypot(Math.max(0, Math.abs(x) - f.size[0] / 2), Math.max(0, Math.abs(y) - f.size[1] / 2))
  })
  return distances.length ? Math.min(...distances) : 10000
}
