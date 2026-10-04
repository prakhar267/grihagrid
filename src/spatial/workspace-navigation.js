import { floorAtPosition } from './navigation.js'
import { pointInPolygon } from './model.js'

export function roomAtCamera(model, position) {
  if (!Array.isArray(position) || position.length !== 3 || !position.every(Number.isFinite)) return null
  const floor = model.floors.find(f => position[2] >= f.elevation && position[2] < f.elevation + f.height)
  return floor ? model.rooms.find(r => r.floorId === floor.id && pointInPolygon(position, r.polygon)) || null : null
}

export function roomOnFloor(model, floorId, selectedId) {
  const rooms = model.rooms.filter(room => room.floorId === floorId)
  return rooms.find(room => room.id === selectedId) || rooms.find(room => !room.exterior) || rooms[0] || null
}

export function cameraFloor(model, position, eyeHeight = 1650) {
  if (!position) return null
  return model.schemaVersion === 2 ? floorAtPosition(model, position, eyeHeight)?.id || null : model.floors[0]?.id || null
}

export function roomLabel(model, roomId) {
  const room = model.rooms.find(item => item.id === roomId)
  if (!room) return 'Unavailable room'
  const floor = model.floors.find(item => item.id === room.floorId)
  return model.floors.length > 1 && floor ? `${room.name} · ${floor.name}` : room.name
}
