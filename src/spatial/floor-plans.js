import { spatialUUID } from './ids.js'
import { validateBuilding } from './model.js'
import { toV2, recalculateBounds, polygonFitsInside, stairPolygon } from './model-v2.js'
import { isRouteClear } from './navigation-v2.js'
import { validateConnectivity } from './navigation.js'

export const FLOOR_LAYOUTS = [
  { id: 'bedrooms', name: 'Two-bedroom floor', description: 'Two bedrooms, a family lounge, bathroom and central hall.' },
  { id: 'family', name: 'Family & study', description: 'Family lounge, study, guest bedroom, bathroom and central hall.' },
  { id: 'open', name: 'Open floor', description: 'One open room with perimeter walls and windows. Divide it as you like.' },
]
const uid = prefix => `${prefix}-${spatialUUID().replaceAll('-', '').slice(0, 16)}`
const rectangle = (x, y, width, depth) => [[x, y], [x + width, y], [x + width, y + depth], [x, y + depth]]
const bounds = rooms => {
  const points = rooms.flatMap(room => room.polygon), xs = points.map(p => p[0]), ys = points.map(p => p[1])
  return { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) }
}
function floorFor(scene, floorId) {
  const floor = scene.floors.find(f => f.id === floorId)
  if (!floor) throw new Error('Choose an existing floor.')
  return floor
}
function finish(original, scene) {
  scene.revision = original.revision + 1
  recalculateBounds(scene)
  const check = validateBuilding(scene)
  if (!check.valid) throw new Error(check.errors.slice(0, 3).join(' '))
  if (JSON.stringify(scene).length > 47000) throw new Error('This layout is too large to save. Use fewer rooms or furniture pieces.')
  return scene
}
export function floorReference(original, floorId) {
  const scene = toV2(original), floor = floorFor(scene, floorId)
  const usable = f => scene.rooms.filter(r => r.floorId === f.id && !r.exterior)
  const reference = [floor, ...scene.floors.filter(f => f.elevation < floor.elevation).sort((a, b) => b.elevation - a.elevation), ...scene.floors]
    .find(f => usable(f).length)
  if (!reference) throw new Error('Add an indoor room before using a floor layout.')
  return { ...bounds(usable(reference)), sourceFloorId: reference.id }
}
export function suggestedRoomPosition(original, floorId, width = 3000, depth = 3000) {
  const scene = toV2(original), reference = floorReference(scene, floorId)
  const occupied = scene.rooms.filter(r => r.floorId === floorId).map(r => bounds([r]))
  for (let y = reference.y; y + depth <= reference.y + reference.depth; y += 500) {
    for (let x = reference.x; x + width <= reference.x + reference.width; x += 500) {
      if (!occupied.some(b => x < b.x + b.width + 180 && x + width + 180 > b.x && y < b.y + b.depth + 180 && y + depth + 180 > b.y)) return [x, y]
    }
  }
  return [Math.max(reference.x + reference.width, ...occupied.map(b => b.x + b.width)) + 300, reference.y]
}
export function rectangularRoom(original, floorId, { name, x, y, width, depth }) {
  floorFor(original, floorId)
  if (typeof name !== 'string' || !name.trim()) throw new Error('Give the room a name.')
  if (![x, y, width, depth].every(Number.isFinite) || width < 1000 || depth < 1000 || width > 20000 || depth > 20000) throw new Error('Enter room widths and depths between 1 and 20 metres, and finite plan coordinates.')
  return { id: uid('room'), name: name.trim(), floorId, polygon: rectangle(x, y, width, depth), color: '#ddd0bc', exterior: false }
}
export function nextFloor(original) {
  if (original.floors.length >= 4) throw new Error('This studio supports up to four floors.')
  const last = [...original.floors].sort((a, b) => b.elevation - a.elevation)[0]
  let number = original.floors.length + 1
  while (original.floors.some(f => f.name === `Floor ${number}`)) number++
  return { id: uid('floor'), name: `Floor ${number}`, elevation: last.elevation + last.height + 200, height: 3000 }
}
export function clearFloor(original, floorId, remove = false) {
  const scene = toV2(original), floor = floorFor(scene, floorId)
  if (remove && floor.elevation === 0) throw new Error('Keep the ground floor. You can edit its rooms instead.')
  const removed = new Set(scene.rooms.filter(r => r.floorId === floorId).map(r => r.id))
  scene.rooms = scene.rooms.filter(r => !removed.has(r.id))
  scene.walls = scene.walls.filter(w => w.floorId !== floorId)
  scene.furniture = scene.furniture.filter(f => f.floorId !== floorId)
  if(scene.coordination)scene.coordination=scene.coordination.filter(v=>v.floorId!==floorId)
  scene.stairs = scene.stairs.filter(s => ![s.fromFloorId, s.toFloorId].includes(floorId))
  if (!scene.rooms.length) throw new Error('Keep at least one room in the house before clearing this floor.')
  if (remove) scene.floors = scene.floors.filter(f => f.id !== floorId)
  return finish(original, scene)
}
export function populateFloor(original, floorId, { layout, sourceFloorId } = {}) {
  const scene = toV2(original), floor = floorFor(scene, floorId)
  if (scene.rooms.some(r => r.floorId === floorId) || scene.walls.some(w => w.floorId === floorId)) throw new Error('Clear this floor first, or add a new floor. Existing rooms and walls are kept.')
  if (layout === 'copy') {
    floorFor(scene, sourceFloorId)
    if (sourceFloorId === floorId) throw new Error('Choose a different floor to copy.')
    const sourceRooms = scene.rooms.filter(r => r.floorId === sourceFloorId && !r.exterior)
    if (!sourceRooms.length) throw new Error('The source floor has no indoor rooms to copy.')
    const ids = new Map(sourceRooms.map(r => [r.id, uid('room')]))
    scene.rooms.push(...sourceRooms.map(r => ({ ...structuredClone(r), id: ids.get(r.id), floorId })))
    const walls = scene.walls.filter(w => w.floorId === sourceFloorId && (!w.roomIds.length || w.roomIds.some(id => ids.has(id))))
    scene.walls.push(...walls.map(w => {
      const roomIds = w.roomIds.filter(id => ids.has(id)).map(id => ids.get(id))
      const height = Math.min(w.height, floor.height)
      return { ...structuredClone(w), id: uid('wall'), floorId, height, roomIds, openings: w.openings.map(o => {
        // An upper-floor entrance must not become an unguarded opening to outside.
        if (o.kind === 'door' && roomIds.length < 2) return { id: uid('window'), kind: 'window', offset: o.offset, width: o.width, sill: 900, height: Math.min(1300, height - 1000) }
        return { ...structuredClone(o), id: uid(o.kind) }
      }) }
    }))
    scene.furniture.push(...scene.furniture.filter(f => f.floorId === sourceFloorId && ids.has(f.roomId)).map(f => ({ ...structuredClone(f), id: uid(f.kind), roomId: ids.get(f.roomId), floorId })))
    if(scene.coordination)scene.coordination.push(...scene.coordination.filter(v=>v.floorId===sourceFloorId).map(v=>({...structuredClone(v),id:uid('component'),floorId})))
    return finish(original, scene)
  }
  if (!FLOOR_LAYOUTS.some(item => item.id === layout)) throw new Error('Choose one of the floor layouts.')
  const b = floorReference(scene, floorId)
  if (layout !== 'open' && (b.width < 7000 || b.depth < 6000)) throw new Error('These divided layouts need a reference footprint at least 7 × 6 m. Copy a floor, use Open floor, or add rooms to suit your narrower plan.')
  const addRoom = (name, x, y, width, depth, color = '#ddd0bc') => {
    const room = { id: uid('room'), name, floorId, polygon: rectangle(x, y, width, depth), color, exterior: false }
    scene.rooms.push(room); return room
  }
  const wall = (start, end, roomIds, kind) => {
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]), width = Math.min(kind === 'door' ? 1000 : 1400, length - 500)
    const openings = kind && width >= 700 ? [{ id: uid(kind), kind, offset: (length - width) / 2, width, sill: kind === 'door' ? 0 : 900, height: kind === 'door' ? 2100 : Math.min(1300, floor.height - 1100), ...(kind === 'door' ? { open: true, hinge: 'start', swing: 1 } : {}) }] : []
    scene.walls.push({ id: uid('wall'), floorId, start, end, height: floor.height, thickness: 180, roomIds, openings })
  }
  if (layout === 'open') {
    const room = addRoom('Open room', b.x, b.y, b.width, b.depth)
    room.polygon.forEach((p, i) => wall(p, room.polygon[(i + 1) % 4], [room.id], 'window'))
  } else {
    const hallWidth = 2400, side = (b.width - hallWidth) / 2, hallX = b.x + side, rightX = hallX + hallWidth
    const hall = addRoom('Stair hall', hallX, b.y, hallWidth, b.depth, '#e8decb')
    wall([hallX, b.y], [rightX, b.y], [hall.id], 'window')
    wall([hallX, b.y + b.depth], [rightX, b.y + b.depth], [hall.id], 'window')
    const names = layout === 'bedrooms' ? [['Main bedroom', 'Bedroom'], ['Family lounge', 'Bathroom']] : [['Family lounge', 'Guest bedroom'], ['Study', 'Bathroom']]
    for (let bank = 0; bank < 2; bank++) {
      const x = bank ? rightX : b.x, inner = bank ? rightX : hallX, outer = bank ? b.x + b.width : b.x
      const split = Math.round(b.depth * (bank ? .65 : .5)), depths = [split, b.depth - split]
      let y = b.y, previous
      for (let i = 0; i < 2; i++) {
        const room = addRoom(names[bank][i], x, y, side, depths[i], names[bank][i] === 'Bathroom' ? '#cedbd4' : '#ddd0bc')
        wall([inner, y], [inner, y + depths[i]], [room.id, hall.id], 'door')
        wall([outer, y], [outer, y + depths[i]], [room.id], 'window')
        wall([x, y], [x + side, y], previous ? [previous.id, room.id] : [room.id])
        if (i === 1) wall([x, y + depths[i]], [x + side, y + depths[i]], [room.id])
        previous = room; y += depths[i]
      }
    }
  }
  return finish(original, scene)
}

// A bounded straight-stair suggestion. It never moves rooms or furniture to force a fit.
export function connectFloorBelow(original, floorId) {
  const scene = toV2(original), upper = floorFor(scene, floorId)
  const lower = scene.floors.filter(f => f.elevation < upper.elevation).sort((a, b) => b.elevation - a.elevation)[0]
  if (!lower) throw new Error('This is the ground floor; add a floor above it first.')
  if (scene.stairs.some(s => s.fromFloorId === lower.id && s.toFloorId === upper.id)) throw new Error('These floors already have a stair connection.')
  const lowerRooms = scene.rooms.filter(r => r.floorId === lower.id && !r.exterior), upperRooms = scene.rooms.filter(r => r.floorId === upper.id && !r.exterior)
  const steps = Math.ceil((upper.elevation - lower.elevation) / 185), run = steps * 280, width = 1000
  for (const top of [...upperRooms].sort((a, b) => Number(/hall/i.test(b.name)) - Number(/hall/i.test(a.name)))) for (const bottom of lowerRooms) {
    const a = bounds([bottom]), b = bounds([top]), x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y), x1 = Math.min(a.x + a.width, b.x + b.width), y1 = Math.min(a.y + a.depth, b.y + b.depth)
    for (const vertical of [true, false]) {
      const short0 = vertical ? x0 : y0, short1 = vertical ? x1 : y1, long0 = vertical ? y0 : x0, long1 = vertical ? y1 : x1
      for (let short = short0 + width / 2 + 350; short <= short1 - width / 2 - 350; short += 600) for (let long = long0 + 900; long + run + 900 <= long1; long += 900) {
        const start = vertical ? [short, long] : [long, short], end = vertical ? [short, long + run] : [long + run, short]
        const stair = { id: uid('stair'), name: `Stair to ${upper.name}`.slice(0, 100), fromFloorId: lower.id, toFloorId: upper.id, start, end, width, steps, roomIds: [bottom.id, top.id] }
        const landing = { ...stair, start: vertical ? [short, long - 700] : [long - 700, short], end: vertical ? [short, long + run + 700] : [long + run + 700, short] }
        const footprint = stairPolygon(landing)
        if (![bottom, top].every(room => polygonFitsInside(footprint, room.polygon, true))) continue
        // Standalone partition walls inside either room must not cross the run.
        if (scene.walls.some(w => [lower.id, upper.id].includes(w.floorId) && segmentIntersectsBox(w.start, w.end, bounds([{ polygon: footprint }]), w.thickness / 2))) continue
        const next = { ...scene, stairs: [...scene.stairs, stair] }
        if (validateBuilding(next).valid) {
          const ux = (end[0] - start[0]) / run, uy = (end[1] - start[1]) / run
          const path = [[start[0] - ux * 400, start[1] - uy * 400, lower.elevation + 1650]]
          for (let i = 0; i <= steps * 2; i++) { const t = i / (steps * 2); path.push([start[0] + ux * run * t, start[1] + uy * run * t, lower.elevation + (upper.elevation - lower.elevation) * t + 1650]) }
          path.push([end[0] + ux * 400, end[1] + uy * 400, upper.elevation + 1650])
          if (isRouteClear(next, path) && validateConnectivity(connectedFloors(next, lower.id)).valid) return finish(original, next)
        }
      }
    }
  }
  throw new Error('No clear straight stair fits without blocking room access. Move obstructing furniture, align a larger stair hall with landing space, or use the Stairs drawing tool from the lower floor.')
}
// Check every room reached by this connection, while allowing other new floors
// to remain unfinished. A locally walkable stair must not cut off a doorway.
function connectedFloors(scene, start) {
  const ids = new Set([start])
  for (let i = 0; i < scene.floors.length; i++) for (const stair of scene.stairs) {
    if (ids.has(stair.fromFloorId) || ids.has(stair.toFloorId)) { ids.add(stair.fromFloorId); ids.add(stair.toFloorId) }
  }
  return { ...scene, floors: scene.floors.filter(f => ids.has(f.id)), rooms: scene.rooms.filter(r => ids.has(r.floorId)), walls: scene.walls.filter(w => ids.has(w.floorId)), furniture: scene.furniture.filter(f => ids.has(f.floorId)), stairs: scene.stairs.filter(s => ids.has(s.fromFloorId) && ids.has(s.toFloorId)) }
}
function segmentIntersectsBox(a, b, box, pad) {
  let t0 = 0, t1 = 1
  for (let axis = 0; axis < 2; axis++) {
    const min = (axis ? box.y : box.x) - pad, max = min + (axis ? box.depth : box.width) + 2 * pad, delta = b[axis] - a[axis]
    if (Math.abs(delta) < .001) { if (a[axis] < min || a[axis] > max) return false }
    else { const first = (min - a[axis]) / delta, last = (max - a[axis]) / delta; t0 = Math.max(t0, Math.min(first, last)); t1 = Math.min(t1, Math.max(first, last)); if (t0 > t1) return false }
  }
  return true
}
