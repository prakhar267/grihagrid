// Designer-entered coordination geometry. No structural or services sizing is inferred.
export const DISCIPLINES = { structure: 'Structure', electrical: 'Electrical', plumbing: 'Plumbing' }
export const COMPONENTS = {
  column: { name: 'Column', discipline: 'structure', color: '#887e71', prefix: 'C' },
  beam: { name: 'Beam', discipline: 'structure', color: '#a99b86', prefix: 'B' },
  light: { name: 'Light point', discipline: 'electrical', color: '#ca983c', prefix: 'L' },
  switch: { name: 'Switch', discipline: 'electrical', color: '#ca983c', prefix: 'SW' },
  socket: { name: 'Socket', discipline: 'electrical', color: '#ca983c', prefix: 'SO' },
  panel: { name: 'Distribution board', discipline: 'electrical', color: '#ca983c', prefix: 'DB' },
  'cold-water': { name: 'Cold-water run', discipline: 'plumbing', color: '#477b9f', prefix: 'CW', pipe: true },
  'hot-water': { name: 'Hot-water run', discipline: 'plumbing', color: '#ad6045', prefix: 'HW', pipe: true },
  drain: { name: 'Drain run', discipline: 'plumbing', color: '#687451', prefix: 'D', pipe: true },
  vent: { name: 'Vent run', discipline: 'plumbing', color: '#837497', prefix: 'V', pipe: true },
}
export const MAX_COMPONENTS = 120
const object = v => v && typeof v === 'object' && !Array.isArray(v)
const exact = (v, keys) => object(v) && Object.keys(v).every(k => keys.includes(k))
const id = v => typeof v === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(v)
const label = (v, max, empty = false) => typeof v === 'string' && v.length <= max && (empty || v.trim().length > 0) && !/[\u0000-\u001f]/.test(v)
const vector = v => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 100000)
export const disciplineOf = item => COMPONENTS[item.kind]?.discipline
export function componentFootprint(item) {
  const c = Math.cos(item.rotation), s = Math.sin(item.rotation)
  return [[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,y]) => {
    const dx = x * item.size[0] / 2, dy = y * item.size[1] / 2
    return [item.position[0] + c * dx - s * dy, item.position[1] + s * dx + c * dy]
  })
}
export function validateCoordination(scene) {
  if (!Object.hasOwn(scene, 'coordination')) return []
  const items = scene.coordination, errors = []
  if (!Array.isArray(items) || items.length > MAX_COMPONENTS) return [`Use at most ${MAX_COMPONENTS} structure and service components.`]
  const seen = new Set([...scene.floors,...scene.rooms,...scene.walls,...scene.furniture,...scene.stairs,...scene.walls.flatMap(w => w.openings || [])].map(v => v.id))
  for (const item of items) {
    const floor = scene.floors.find(f => f.id === item?.floorId)
    if (!exact(item, ['id','kind','label','floorId','position','size','rotation','system','notes','loadWatts']) || !id(item.id) || seen.has(item.id) || !Object.hasOwn(COMPONENTS,item.kind) || !label(item.label,60) || !floor || !vector(item.position) || !vector(item.size) || item.size.some(n => n < 10 || n > 40000) || !Number.isFinite(item.rotation) || Math.abs(item.rotation) > Math.PI * 2 || !label(item.system,40,true) || !label(item.notes,300,true)) {
      errors.push('A structure or service component has invalid fields, dimensions or identifiers.'); continue
    }
    seen.add(item.id)
    if (item.position[2] < 0 || item.position[2] + item.size[2] > floor.height + .01) errors.push(`${item.label}: keep the component between this floor and its ceiling datum.`)
    if (componentFootprint(item).some(p => p.some((v,i) => v < scene.bounds.min[i] - .01 || v > scene.bounds.max[i] + .01))) errors.push(`${item.label}: the footprint is outside the building bounds.`)
    if (Object.hasOwn(item,'loadWatts') && (disciplineOf(item) !== 'electrical' || item.loadWatts !== null && (!Number.isFinite(item.loadWatts) || item.loadWatts < 0 || item.loadWatts > 100000))) errors.push(`${item.label}: enter a load from 0 to 100,000 W, or leave it unspecified.`)
    if (COMPONENTS[item.kind].pipe) {
      const sizes = [...item.size].sort((a,b) => a-b)
      if (Math.abs(sizes[0] - sizes[1]) > .01 || sizes[0] > 1000) errors.push(`${item.label}: a straight run needs two equal diameters of 10–1,000 mm.`)
    }
  }
  return errors
}
function pipeMesh(item) {
  const axis = item.size.indexOf(Math.max(...item.size)), cross = [0,1,2].filter(i => i !== axis), vertices = [], indices = []
  for (const end of [-1,1]) for (let i=0;i<16;i++) {
    const p = [0,0,0]; p[axis] = end * item.size[axis]/2
    p[cross[0]] = Math.cos(i*Math.PI/8)*item.size[cross[0]]/2
    p[cross[1]] = Math.sin(i*Math.PI/8)*item.size[cross[1]]/2; vertices.push(p)
  }
  // Right-handed cyclic bases give consistent outward-facing triangles.
  const reversed = axis === 1
  const tri = (a,b,c) => indices.push(...(reversed ? [c,b,a] : [a,b,c]))
  for(let i=0;i<16;i++) { const j=(i+1)%16; tri(i,j,j+16);tri(i,j+16,i+16);if(i>0&&i<15){tri(0,i+1,i);tri(16,i+16,i+17)} }
  return {kind:'mesh',vertices,indices}
}
export function coordinationPrimitives(scene) {
  return (scene.coordination || []).map(item => {
    const spec = COMPONENTS[item.kind], elevation = scene.floors.find(f => f.id === item.floorId).elevation
    return { id:item.id, componentId:item.id, floorId:item.floorId, kind:item.kind === 'light'?'cylinder':'box',
      position:[item.position[0],item.position[1],elevation+item.position[2]+item.size[2]/2],size:[...item.size],rotation:item.rotation,rotationZ:item.rotation,
      color:spec.color,material:spec.discipline==='structure'?'concrete':'metal',category:spec.discipline,
      collidable:spec.discipline==='structure',...(spec.pipe?pipeMesh(item):{}) }
  })
}
export function componentTag(scene, item) {
  const index = (scene.coordination || []).filter(v => v.floorId === item.floorId && v.kind === item.kind).findIndex(v => v.id === item.id)
  return `${scene.floors.findIndex(f => f.id === item.floorId)}-${COMPONENTS[item.kind].prefix}${String(index+1).padStart(2,'0')}`
}
// Separating-axis test for oriented XY boxes; touching surfaces are not interference.
export function boxesIntersect(a,b) {
  if (a.position[2]+a.size[2] <= b.position[2]+.5 || b.position[2]+b.size[2] <= a.position[2]+.5) return false
  const pa=componentFootprint(a),pb=componentFootprint(b)
  for(const angle of [a.rotation,a.rotation+Math.PI/2,b.rotation,b.rotation+Math.PI/2]) {
    const project=p=>p[0]*Math.cos(angle)+p[1]*Math.sin(angle),aa=pa.map(project),bb=pb.map(project)
    if(Math.min(Math.max(...aa),Math.max(...bb))-Math.max(Math.min(...aa),Math.min(...bb))<=.5)return false
  }
  return true
}
export function coordinationIssues(scene) {
  const items=scene.coordination||[],issues=[]
  const add=(code,ids,message)=>issues.push({code,ids,message})
  for(const item of items) {
    if(disciplineOf(item)!=='structure'&&!item.system.trim())add('unassigned-system',[item.id],`${item.label}: assign a circuit or service system.`)
    if(disciplineOf(item)==='electrical'&&item.loadWatts==null)add('unspecified-load',[item.id],`${item.label}: connected load is unspecified.`)
    if(disciplineOf(item)==='structure') {
      for(const wall of scene.walls.filter(w=>w.floorId===item.floorId)) for(const o of wall.openings) {
        const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],len=Math.hypot(dx,dy),t=(o.offset+o.width/2)/len
        const opening={position:[wall.start[0]+dx*t,wall.start[1]+dy*t,o.sill],size:[o.width,wall.thickness,o.height],rotation:Math.atan2(dy,dx)}
        if(boxesIntersect(item,opening))add('opening-interference',[item.id,o.id],`${item.label} intersects a ${o.kind} opening.`)
      }
    }
  }
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++) {
    const a=items[i],b=items[j],da=disciplineOf(a),db=disciplineOf(b)
    if(a.floorId!==b.floorId||da===db&&(da!=='plumbing'||a.kind===b.kind&&a.system===b.system))continue
    if(boxesIntersect(a,b))add('component-interference',[a.id,b.id],`${a.label} intersects ${b.label}. Check the entered envelopes.`)
  }
  return issues
}
export function coordinationSchedule(scene, floorId, discipline) {
  return (scene.coordination||[]).filter(v=>(!floorId||v.floorId===floorId)&&(!discipline||disciplineOf(v)===discipline)).map(item=>({
    ...item,tag:componentTag(scene,item),floor:scene.floors.find(f=>f.id===item.floorId).name,discipline:disciplineOf(item),type:COMPONENTS[item.kind].name,
    length:COMPONENTS[item.kind].pipe?Math.max(...item.size):null,
  }))
}
export function coordinationCSV(scene) {
  // A leading formula marker must remain plain text when opened in a spreadsheet.
  const cell=v=>`"${String(v??'').replace(/^[=+@\-\t\r]/,"'$&").replaceAll('"','""')}"`
  const rows=[['Tag','Floor','Discipline','Type','Label','System','X mm','Y mm','Base above FFL mm','Width mm','Depth mm','Height mm','Rotation deg','Entered load W','Notes'],
    ...coordinationSchedule(scene).map(v=>[v.tag,v.floor,v.discipline,v.type,v.label,v.system,...v.position,...v.size,+(v.rotation*180/Math.PI).toFixed(2),v.loadWatts??'Unspecified',v.notes])]
  return rows.map(row=>row.map(cell).join(',')).join('\r\n')
}
