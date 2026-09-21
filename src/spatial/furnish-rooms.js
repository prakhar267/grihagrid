import { toV2, polygonFitsInside, polygonCenter, insidePolygon, stairPolygon } from './model-v2.js'
import { furnitureSizes } from './furniture-catalog.js'

export function roomProgramme(room) {
  const name = room.name.toLowerCase()
  if (/bath|powder|toilet/.test(name)) return ['toilet', 'washbasin', 'shower']
  if (/bedroom|bed room|staff/.test(name)) return ['bed', 'wardrobe', 'nightstand', 'nightstand']
  if (/kitchen/.test(name)) return ['kitchen-counter', 'refrigerator']
  if (/utility|laundry/.test(name)) return ['washing-machine', 'counter', 'shelf']
  if (/puja|prayer/.test(name)) return ['puja-unit']
  if (/study|office/.test(name)) return ['desk', 'chair', 'shelf']
  if (/living|lounge|family|media/.test(name)) return ['sofa', 'coffee-table', 'chair', 'console', 'plant']
  if (/dining/.test(name)) return ['table', 'chair', 'chair', 'chair', 'chair']
  return []
}
const box = points => ({ x0: Math.min(...points.map(p => p[0])), x1: Math.max(...points.map(p => p[0])), y0: Math.min(...points.map(p => p[1])), y1: Math.max(...points.map(p => p[1])) })
export function furniturePolygon(item) {
  const [w,d] = item.size, a = item.rotation || 0
  return [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].map(([x,y]) => [item.position[0]+x*Math.cos(a)-y*Math.sin(a),item.position[1]+x*Math.sin(a)+y*Math.cos(a)])
}
const overlaps = (a,b,gap=100) => a.x0 < b.x1+gap && a.x1 > b.x0-gap && a.y0 < b.y1+gap && a.y1 > b.y0-gap
const inBox = (p,b,pad=0) => p[0] >= b.x0-pad && p[0] <= b.x1+pad && p[1] >= b.y0-pad && p[1] <= b.y1+pad

// Keep room-centre-to-door circulation free. This is a bounded furnishing aid,
// not a substitute for an accessibility or professional furniture-layout review.
export function furnishRooms(input, { floorId, roomId } = {}) {
  const model = toV2(input), added = [], skipped = []
  for (const room of model.rooms.filter(r => (!floorId || r.floorId === floorId) && (!roomId || r.id === roomId))) {
    const programme = roomProgramme(room), bounds = box(room.polygon), center = polygonCenter(room.polygon)
    if (!insidePolygon(center, room.polygon, true)) { if (programme.length) skipped.push(`${room.name}: arrange this irregular room manually`); continue }
    const doors = model.walls.filter(w => w.roomIds.includes(room.id)).flatMap(w => {
      const length = Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1])
      return w.openings.filter(o => o.kind === 'door').map(o => ({point:w.start.map((n,i)=>n+(w.end[i]-n)*(o.offset+o.width/2)/length),width:o.width}))
    })
    const routes = doors.flatMap(({point}) => Array.from({length:21},(_,i)=>point.map((n,k)=>n+(center[k]-n)*i/20)))
    const stairBoxes = model.stairs.filter(s => s.roomIds.includes(room.id)).map(s=>box(stairPolygon(s)))
    const consumed = new Map()
    for (const kind of programme) {
      const count = (consumed.get(kind) || 0) + 1; consumed.set(kind,count)
      const existing = model.furniture.filter(f=>f.roomId===room.id && (f.kind===kind || kind==='kitchen-counter' && f.kind==='counter'))
      if (existing.length >= count) continue
      const size = furnitureSizes[kind].slice(), candidates = []
      for (const rotation of [0,Math.PI/2,Math.PI,-Math.PI/2]) {
        const w = Math.abs(Math.cos(rotation))*size[0]+Math.abs(Math.sin(rotation))*size[1], d = Math.abs(Math.sin(rotation))*size[0]+Math.abs(Math.cos(rotation))*size[1]
        const x0=bounds.x0+180+w/2,x1=bounds.x1-180-w/2,y0=bounds.y0+180+d/2,y1=bounds.y1-180-d/2
        if (x1<x0 || y1<y0) continue
        for (const t of [0,1,.5,.25,.75]) for (const p of [[x0+(x1-x0)*t,y1],[x0,y0+(y1-y0)*t],[x1,y0+(y1-y0)*t],[x0+(x1-x0)*t,y0]]) {
          candidates.push({id:`detail-${room.id.slice(0,55)}-${kind}-${count}`,roomId:room.id,floorId:room.floorId,kind,position:[...p,0],size,rotation,color:['washbasin','shower','refrigerator','washing-machine'].includes(kind)?'#e4e2d9':kind==='plant'?'#667957':'#b99e7e'})
        }
      }
      const placed = candidates.find(item => {
        const poly=furniturePolygon(item), b=box(poly)
        return polygonFitsInside(poly,room.polygon) && !model.furniture.filter(f=>f.roomId===room.id&&f.kind!=='rug').some(f=>overlaps(b,box(furniturePolygon(f)),120)) &&
          !routes.some(p=>inBox(p,b,380)) && !inBox(center,b,450) && !doors.some(({point,width})=>inBox(point,b,Math.min(width,1000))) && !stairBoxes.some(s=>overlaps(b,s,450))
      })
      if (!placed) { skipped.push(`${room.name}: ${kind} needs manual placement`); continue }
      // Keep the existing storage contract and identifier uniqueness intact.
      if (model.furniture.some(f=>f.id===placed.id)) { skipped.push(`${room.name}: ${kind} already has a detail identifier`); continue }
      model.furniture.push(placed)
      if (model.furniture.length > 512 || JSON.stringify(model).length > 47000) { model.furniture.pop(); skipped.push(`${room.name}: saved-model size limit reached`); continue }
      added.push(placed.id)
    }
  }
  if (added.length) model.revision = input.revision + 1
  return { model, added, skipped }
}
