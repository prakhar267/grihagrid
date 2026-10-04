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

export function subjectVisibility(scene, subject, camera) {
  const elevation = scene.floors.find(f => f.id === subject.floorId)?.elevation || 0
  const ca = Math.cos(subject.rotation || 0), sa = Math.sin(subject.rotation || 0)
  const points = [[0, 0], [-.4, -.4], [.4, -.4], [-.4, .4], [.4, .4]].map(([u, v]) => {
    const x = u * subject.size[0], y = v * subject.size[1]
    return [subject.position[0] + x * ca - y * sa, subject.position[1] + x * sa + y * ca, elevation + subject.position[2] + subject.size[2] * .8]
  })
  const obstacles = scene.furniture.filter(f => f.id !== subject.id && f.floorId === subject.floorId && !['rug', 'plant', 'lamp'].includes(f.kind))
  return points.filter(p => !obstacles.some(f => intersectsBox(camera, p, f, elevation))).length / points.length
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
