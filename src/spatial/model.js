// Canonical geometry: millimetres, XY ground plane, Z up. Every primitive is centre-based.
export const toBrowser = ([x, y, z = 0]) => [x / 1000, z / 1000, -y / 1000]
export const fromBrowser = ([x, y, z]) => [x * 1000, -z * 1000, y * 1000]
export const roomArea = (room) => Math.abs(room.polygon.reduce((sum, p, i, poly) => {
  const next = poly[(i + 1) % poly.length]; return sum + p[0] * next[1] - next[0] * p[1]
}, 0)) / 2 / 1e6
export const roomCenter = (room) => room.polygon.reduce((sum, p) => [sum[0] + p[0] / room.polygon.length, sum[1] + p[1] / room.polygon.length], [0, 0])

export function createDemoBuilding() {
  const rect = (id, name, x, y, w, d, color, exterior = false) => ({ id, name, floorId: 'ground', polygon: [[x, y], [x + w, y], [x + w, y + d], [x, y + d]], color, exterior })
  const door = (id, offset, width = 1200) => ({ id, kind: 'door', offset, width, sill: 0, height: 2350, open: true })
  const window = (id, offset, width = 2200) => ({ id, kind: 'window', offset, width, sill: 900, height: 1550 })
  const wall = (id, start, end, roomIds, openings = []) => ({ id, start, end, roomIds, openings, height: 3000, thickness: 180 })
  const furniture = []
  const add = (id, roomId, kind, x, y, w, d, h, color = '#9b7150', rotation = 0, z = 0) => furniture.push({ id, roomId, kind, position: [x, y, z], size: [w, d, h], rotation, color })
  add('living-rug', 'living', 'rug', 2350, 2250, 3200, 2000, 18, '#bcae92')
  add('living-sofa', 'living', 'sofa', 800, 2400, 950, 2650, 850, '#dbccb5', Math.PI / 2)
  // The sofa's canonical footprint stays clear of the entrance at x=2500.
  furniture.at(-1).size = [2650, 950, 850]
  add('living-table', 'living', 'coffee-table', 2100, 2100, 1000, 650, 400, '#765540')
  add('living-chair', 'living', 'chair', 3950, 1550, 750, 750, 780, '#a65f40', -0.25)
  add('living-console', 'living', 'console', 4700, 2400, 360, 1800, 550, '#765540')
  add('living-plant', 'living', 'plant', 500, 500, 500, 500, 1600, '#55724c')
  add('living-lamp', 'living', 'lamp', 700, 3500, 360, 360, 1850, '#c3a47f')
  add('kitchen-run', 'kitchen', 'counter', 6750, 400, 2900, 600, 900, '#cfbfa6')
  add('kitchen-side', 'kitchen', 'counter', 8075, 1550, 550, 1700, 900, '#cfbfa6')
  add('kitchen-island', 'kitchen', 'island', 6850, 1900, 1450, 750, 900, '#927052')
  add('kitchen-stool-1', 'kitchen', 'stool', 6400, 2750, 370, 370, 620, '#977553')
  add('kitchen-stool-2', 'kitchen', 'stool', 7300, 2750, 370, 370, 620, '#977553')
  add('bath-vanity', 'bathroom', 'counter', 11450, 2100, 650, 1400, 850, '#a89d88')
  add('bath-tub', 'bathroom', 'bathtub', 10200, 700, 1650, 750, 580, '#ede9e1')
  add('bath-toilet', 'bathroom', 'toilet', 9150, 1400, 500, 700, 750, '#f1eee7')
  add('main-rug', 'main-bedroom', 'rug', 2400, 8350, 3300, 2700, 15, '#d4c9b3')
  add('main-bed', 'main-bedroom', 'bed', 2500, 8550, 1900, 2200, 650, '#ded4bf')
  add('main-nightstand-1', 'main-bedroom', 'nightstand', 1120, 9250, 520, 500, 500, '#806348')
  add('main-nightstand-2', 'main-bedroom', 'nightstand', 3880, 9250, 520, 500, 500, '#806348')
  add('main-wardrobe', 'main-bedroom', 'wardrobe', 4600, 8100, 500, 2000, 2500, '#b69c7a')
  add('main-plant', 'main-bedroom', 'plant', 500, 9450, 450, 450, 1350, '#55724c')
  add('guest-bed', 'bedroom-two', 'bed', 7200, 8550, 1600, 2150, 620, '#b7bba9')
  add('guest-nightstand', 'bedroom-two', 'nightstand', 6000, 9275, 450, 450, 480, '#806348')
  add('guest-desk', 'bedroom-two', 'desk', 8500, 7450, 650, 1450, 750, '#aa8b63')
  add('study-desk', 'study', 'desk', 10600, 9425, 1900, 650, 750, '#a1845c')
  add('study-chair', 'study', 'chair', 10600, 8550, 600, 600, 850, '#8e9d86', Math.PI)
  add('study-shelf', 'study', 'shelf', 11600, 7600, 400, 1800, 2200, '#967855')
  add('hall-console', 'hallway', 'console', 11400, 5000, 650, 800, 850, '#977553')
  add('hall-plant', 'hallway', 'plant', 500, 5000, 400, 400, 1450, '#55724c')
  add('garden-table', 'garden', 'table', 8500, -2300, 1800, 900, 760, '#8d7252')
  add('garden-chair-1', 'garden', 'chair', 8500, -3250, 650, 650, 800, '#987d59')
  add('garden-chair-2', 'garden', 'chair', 8500, -1350, 650, 650, 800, '#987d59', Math.PI)
  add('garden-tree-1', 'garden', 'tree', 800, -2800, 1800, 1800, 3700, '#546b42')
  add('garden-tree-2', 'garden', 'tree', 11300, -2800, 1700, 1700, 3300, '#65784b')
  return {
    schemaVersion: 1, id: 'courtyard-house', name: 'The Courtyard House', revision: 1, seed: 1847,
    units: 'mm', axes: 'XY-ground-Z-up', bounds: { min: [0, -4000, 0], max: [12000, 10000, 3000] },
    floors: [{ id: 'ground', name: 'Ground floor', elevation: 0, height: 3000 }],
    rooms: [rect('living', 'Living room', 0, 0, 5000, 4000, '#d6c4a9'), rect('kitchen', 'Kitchen & dining', 5000, 0, 3500, 4000, '#c8baa3'), rect('bathroom', 'Bathroom', 8500, 0, 3500, 4000, '#bdc1b5'), rect('hallway', 'Gallery', 0, 4000, 12000, 2000, '#e0d5bf'), rect('main-bedroom', 'Main bedroom', 0, 6000, 5000, 4000, '#d0c3ad'), rect('bedroom-two', 'Bedroom two', 5000, 6000, 4000, 4000, '#bbc1b0'), rect('study', 'Study', 9000, 6000, 3000, 4000, '#cfc4ae'), rect('garden', 'Garden terrace', 0, -4000, 12000, 4000, '#bcc49e', true)],
    walls: [
      wall('south', [0, 0], [12000, 0], ['living', 'kitchen', 'bathroom', 'garden'], [window('living-window', 300, 1250), door('entrance', 1850, 1400), window('kitchen-window', 5600, 2400), window('bath-window', 9300, 1800)]),
      wall('north', [0, 10000], [12000, 10000], ['main-bedroom', 'bedroom-two', 'study'], [window('main-window', 1200, 2700), window('guest-window', 5600, 2600), window('study-window', 9650, 1700)]),
      wall('west', [0, 0], [0, 10000], ['living', 'hallway', 'main-bedroom'], [window('west-living', 1800, 1500), window('west-bedroom', 7000, 1900)]),
      wall('east', [12000, 0], [12000, 10000], ['bathroom', 'hallway', 'study'], [window('east-gallery', 4300, 1400), window('east-study', 7500, 1600)]),
      wall('gallery-south', [0, 4000], [12000, 4000], ['living', 'kitchen', 'bathroom', 'hallway'], [door('living-door', 1850, 1400), door('kitchen-door', 6000, 1400), door('bath-door', 9700, 1100)]),
      wall('gallery-north', [0, 6000], [12000, 6000], ['main-bedroom', 'bedroom-two', 'study', 'hallway'], [door('main-door', 1850, 1400), door('guest-door', 6000, 1400), door('study-door', 9700, 1200)]),
      wall('living-kitchen', [5000, 0], [5000, 4000], ['living', 'kitchen']), wall('kitchen-bath', [8500, 0], [8500, 4000], ['kitchen', 'bathroom']),
      wall('bedrooms', [5000, 6000], [5000, 10000], ['main-bedroom', 'bedroom-two']), wall('guest-study', [9000, 6000], [9000, 10000], ['bedroom-two', 'study']),
    ], furniture, exterior: { groundColor: '#b5bc9e', skyColor: '#e7e5da', sun: [8000, -7000, 14000] },
  }
}

export function pointInPolygon([x, y], polygon) {
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j]
    const cross = (x - xi) * (yj - yi) - (y - yi) * (xj - xi)
    if (Math.abs(cross) < 0.01 && x >= Math.min(xi, xj) && x <= Math.max(xi, xj) && y >= Math.min(yi, yj) && y <= Math.max(yi, yj)) return true
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

export function validateBuilding(scene) {
  const errors = []
  const finite = (value) => Number.isFinite(value)
  const point = (value, length = 2) => Array.isArray(value) && value.length === length && value.every(v=>finite(v)&&Math.abs(v)<=100000)
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key))
  const id=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)
  const name=value=>typeof value==='string'&&value.length>=1&&value.length<=100&&!/[\u0000-\u001f]/.test(value)
  const color=value=>typeof value==='string'&&/^#[0-9a-fA-F]{6}$/.test(value)
  if (!scene || scene.schemaVersion !== 1) return { valid: false, errors: ['Unsupported building schema.'] }
  if(!exact(scene,['schemaVersion','id','name','revision','seed','units','axes','bounds','floors','rooms','walls','furniture','exterior'])||!id(scene.id)||!name(scene.name)||!Number.isSafeInteger(scene.seed)||scene.seed<0||scene.seed>4294967295)return {valid:false,errors:['Unsupported building fields, identifier, name or seed.']}
  if(scene.units!=='mm'||scene.axes!=='XY-ground-Z-up')errors.push('The canonical building must use millimetres and XY-ground-Z-up axes.')
  if(!exact(scene.bounds,['min','max'])||!point(scene.bounds.min,3)||!point(scene.bounds.max,3)||scene.bounds.min.some((v,i)=>v>=scene.bounds.max[i])||scene.bounds.max.slice(0,2).some((v,i)=>v-scene.bounds.min[i]>40000))errors.push('Valid building bounds of at most 40 metres per horizontal axis are required.')
  if(!exact(scene.exterior,['groundColor','skyColor','sun'])||!color(scene.exterior?.groundColor)||!color(scene.exterior?.skyColor)||!point(scene.exterior?.sun,3))errors.push('Valid exterior colours and sun position are required.')
  if (!Number.isInteger(scene.revision) || scene.revision < 1) errors.push('A positive revision is required.')
  if (!Array.isArray(scene.rooms) || !Array.isArray(scene.walls) || !Array.isArray(scene.furniture) || !Array.isArray(scene.floors)) return { valid: false, errors: ['Rooms, walls, floors and furniture are required.'] }
  if([...scene.rooms,...scene.walls,...scene.furniture,...scene.floors].some(item=>!item||typeof item!=='object'))return {valid:false,errors:['Scene entries must be objects.']}
  if(scene.floors.length!==1)errors.push('The current generator supports one complete floor.')
  if(!scene.rooms.length||scene.rooms.length>32||scene.walls.length>128||scene.furniture.length>256)return {valid:false,errors:['The building exceeds supported scene limits.']}
  for(const floor of scene.floors)if(!exact(floor,['id','name','elevation','height'])||!id(floor.id)||!name(floor.name)||floor.elevation!==0||!finite(floor.height)||floor.height<2200||floor.height>6000)errors.push('A named ground floor at zero elevation with valid height is required.')
  const ids = new Set()
  for (const item of [...scene.floors, ...scene.rooms, ...scene.walls, ...scene.furniture]) {
    if (!id(item.id) || ids.has(item.id)) errors.push('Scene identifiers must be unique, bounded letters, numbers, underscores or hyphens.')
    ids.add(item.id)
  }
  const roomIds = new Set(scene.rooms.map(r => r.id)), floorIds = new Set(scene.floors.map(f => f.id))
  for (const room of scene.rooms) {
    if(!exact(room,['id','name','floorId','polygon','color','exterior'])||!name(room.name)||!color(room.color)||typeof room.exterior!=='boolean')errors.push(`Unsupported room fields or metadata for ${room.id}.`)
    if (!floorIds.has(room.floorId)) errors.push(`Unknown floor for ${room.id}.`)
    if (!Array.isArray(room.polygon) || room.polygon.length < 3 || !room.polygon.every(p => point(p))) { errors.push(`Invalid polygon for ${room.id}.`); continue }
    if(room.polygon.length!==4||room.polygon.some((p,i)=>{const q=room.polygon[(i+1)%room.polygon.length];return p[0]!==q[0]&&p[1]!==q[1]}))errors.push(`Room ${room.id}: the current generator supports rectangular room polygons.`)
    if(point(scene.bounds?.min,3)&&point(scene.bounds?.max,3)&&room.polygon.some(p=>p.some((v,i)=>v<scene.bounds.min[i]||v>scene.bounds.max[i])))errors.push(`Room ${room.id} exceeds the building bounds.`)
    if (roomArea(room) < 0.5) errors.push(`Room ${room.id} has no usable area.`)
    const p = room.polygon
    const orient = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    for (let i=0;i<p.length;i++) for(let j=i+2;j<p.length;j++) {
      if (i===0 && j===p.length-1) continue
      const a=p[i],b=p[(i+1)%p.length],c=p[j],d=p[(j+1)%p.length]
      if(orient(a,b,c)*orient(a,b,d)<0 && orient(c,d,a)*orient(c,d,b)<0) errors.push(`Self-intersecting polygon: ${room.id}.`)
    }
  }
  const validRooms=scene.rooms.filter(r=>Array.isArray(r.polygon)&&r.polygon.length>=3&&r.polygon.every(p=>point(p)))
  for(let i=0;i<validRooms.length;i++)for(let j=i+1;j<validRooms.length;j++) {
    const a=validRooms[i],b=validRooms[j];if(a.floorId!==b.floorId)continue
    const extent=r=>[Math.min(...r.polygon.map(p=>p[0])),Math.max(...r.polygon.map(p=>p[0])),Math.min(...r.polygon.map(p=>p[1])),Math.max(...r.polygon.map(p=>p[1]))]
    const aa=extent(a),bb=extent(b)
    if(Math.min(aa[1],bb[1])-Math.max(aa[0],bb[0])>1&&Math.min(aa[3],bb[3])-Math.max(aa[2],bb[2])>1)errors.push(`Room polygons overlap: ${a.id} and ${b.id}.`)
  }
  for (const wall of scene.walls) {
    if(!exact(wall,['id','start','end','roomIds','openings','height','thickness']))errors.push(`Unsupported fields on wall ${wall.id}.`)
    if (!point(wall.start) || !point(wall.end) || !finite(wall.height) || !finite(wall.thickness) || wall.height < 2200 || wall.height >6000 || wall.thickness < 20 || wall.thickness >1500 || !Array.isArray(wall.openings) || wall.openings.length>100 || wall.openings.some(o=>!o||typeof o!=='object') || !Array.isArray(wall.roomIds)) { errors.push(`Invalid wall ${wall.id}.`); continue }
    const length = Math.hypot(wall.end[0] - wall.start[0], wall.end[1] - wall.start[1])
    if (length < 100) errors.push(`Wall ${wall.id} is too short.`)
    let previousEnd = -1
    for (const opening of [...(wall.openings || [])].sort((a,b) => a.offset-b.offset)) {
      if(!exact(opening,['id','kind','offset','width','sill','height','open'])||!id(opening.id)||ids.has(opening.id)||(opening.open!==undefined&&typeof opening.open!=='boolean'))errors.push('Opening identifiers and fields must be valid and unique.')
      ids.add(opening.id)
      if (!['door','window'].includes(opening.kind) || ![opening.offset,opening.width,opening.sill,opening.height].every(finite) || opening.width <= 0 || opening.height <= 0 || opening.sill < 0 || opening.offset < 0 || opening.offset + opening.width > length || opening.sill + opening.height > wall.height || opening.offset < previousEnd) errors.push(`Invalid or overlapping opening ${opening.id}.`)
      if (opening.kind==='door' && (opening.sill!==0 || opening.width<700)) errors.push(`Door ${opening.id} has no usable passage.`)
      previousEnd = opening.offset + opening.width
    }
    if ((wall.roomIds || []).some(id => !roomIds.has(id))) errors.push(`Unknown room attached to ${wall.id}.`)
  }
  for(const item of scene.furniture) {
    if(!exact(item,['id','roomId','kind','position','size','rotation','color'])||!color(item.color)||!['rug','sofa','chair','coffee-table','console','plant','tree','lamp','counter','island','stool','bathtub','toilet','bed','nightstand','wardrobe','desk','shelf','table'].includes(item.kind))errors.push(`Unsupported furniture fields or type for ${item.id}.`)
    if(!roomIds.has(item.roomId) || !point(item.position,3) || !point(item.size,3) || item.size.some(v=>v<=0||v>20000) || !finite(item.rotation) || Math.abs(item.rotation)>Math.PI*2) errors.push(`Invalid furniture ${item.id}.`)
    else {
      const room=validRooms.find(r=>r.id===item.roomId)
      if(!room||!pointInPolygon(item.position,room.polygon))errors.push(`Furniture ${item.id} is outside its room.`)
    }
  }
  return { valid: errors.length === 0, errors }
}

export function resizeBuilding(scene, { width, depth } = {}) {
  const copy = structuredClone(scene)
  const inside = scene.rooms.filter(r => !r.exterior).flatMap(r=>r.polygon)
  const oldW = Math.max(...inside.map(p=>p[0])), oldD = Math.max(...inside.map(p=>p[1]))
  const newW = width ?? oldW, newD = depth ?? oldD
  if (!Number.isFinite(newW) || !Number.isFinite(newD) || newW < 11000 || newW > 18000 || newD < 9500 || newD > 15000) throw new Error('Demo dimensions must be 11–18 m wide and 9.5–15 m deep.')
  const sx=newW/oldW,sy=newD/oldD
  copy.rooms.forEach(r=>{r.polygon=r.polygon.map(([x,y])=>[Math.round(x*sx),Math.round(y*sy)])})
  copy.walls.forEach(w=>{
    const oldLength=Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1])
    w.start=[w.start[0]*sx,w.start[1]*sy];w.end=[w.end[0]*sx,w.end[1]*sy]
    const scale=Math.hypot(w.end[0]-w.start[0],w.end[1]-w.start[1])/oldLength
    w.openings.forEach(o=>{o.offset*=scale;o.width*=scale})
  })
  copy.furniture.forEach(f=>{f.position[0]*=sx;f.position[1]*=sy})
  copy.bounds={min:[0,-4000*sy,0],max:[newW,newD,3000]};copy.revision++
  const validation=validateBuilding(copy)
  if(!validation.valid) throw new Error(validation.errors.join(' '))
  return copy
}

export function buildPrimitives(scene) {
  const out=[]
  const add=(id,roomId,kind,position,size,color,category='furniture',rotation=0,material='matte',collidable=false)=>out.push({id,roomId,kind,position,size,color,category,rotation,rotationZ:rotation,material,collidable})
  const box=(...args)=>add(args[0],args[1],'box',...args.slice(2))
  const floorZ=scene.floors[0]?.elevation||0
  for(const room of scene.rooms) {
    const xs=room.polygon.map(p=>p[0]),ys=room.polygon.map(p=>p[1]);const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys)
    box(`${room.id}-floor`,room.id,[(x0+x1)/2,(y0+y1)/2,floorZ-70],[x1-x0,y1-y0,140],room.exterior?'#b8aa90':room.color,'floor',0,room.exterior?'stone':'wood')
    if(!room.exterior) box(`${room.id}-ceiling`,room.id,[(x0+x1)/2,(y0+y1)/2,floorZ+(scene.floors[0]?.height||3000)+70],[x1-x0,y1-y0,140],'#ded8cc','roof')
  }
  for(const wall of scene.walls) {
    const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy),angle=Math.atan2(dy,dx)
    const pos=(along,z,side=0)=>[wall.start[0]+along*dx/length-side*dy/length,wall.start[1]+along*dy/length+side*dx/length,z+floorZ]
    const segment=(id,start,width,z,height)=>{if(width>0&&height>0)box(id,wall.roomIds[0],pos(start+width/2,z+height/2),[width,wall.thickness,height],'#e9e1d4','wall',angle,'plaster',true)}
    let cursor=0
    for(const op of [...wall.openings].sort((a,b)=>a.offset-b.offset)) {
      segment(`${wall.id}-${op.id}-side`,cursor,op.offset-cursor,0,wall.height)
      segment(`${wall.id}-${op.id}-sill`,op.offset,op.width,0,op.sill)
      segment(`${wall.id}-${op.id}-header`,op.offset,op.width,op.sill+op.height,wall.height-op.sill-op.height)
      const frame='#826a4b'
      box(`${op.id}-frame-a`,wall.roomIds[0],pos(op.offset+25,op.sill+op.height/2),[50,wall.thickness+20,op.height],frame,'opening',angle,'wood')
      box(`${op.id}-frame-b`,wall.roomIds[0],pos(op.offset+op.width-25,op.sill+op.height/2),[50,wall.thickness+20,op.height],frame,'opening',angle,'wood')
      box(`${op.id}-frame-top`,wall.roomIds[0],pos(op.offset+op.width/2,op.sill+op.height-25),[op.width,wall.thickness+20,50],frame,'opening',angle,'wood')
      if(op.kind==='window') {
        box(`${op.id}-glass`,wall.roomIds[0],pos(op.offset+op.width/2,op.sill+op.height/2),[op.width-80,12,op.height-80],'#b9d0cc','opening',angle,'glass',true)
        box(`${op.id}-mullion`,wall.roomIds[0],pos(op.offset+op.width/2,op.sill+op.height/2),[35,wall.thickness+20,op.height],frame,'opening',angle,'wood')
      } else if(!op.open) box(`${op.id}-leaf`,wall.roomIds[0],pos(op.offset+op.width/2,op.height/2),[op.width-70,45,op.height-50],'#987755','opening',angle,'wood',true)
      cursor=op.offset+op.width
    }
    segment(`${wall.id}-end`,cursor,length-cursor,0,wall.height)
  }
  for(const f of scene.furniture) {
    const [x,y,z]=f.position,[w,d,h]=f.size,a=f.rotation||0,ca=Math.cos(a),sa=Math.sin(a)
    const loc=(lx,ly,lz)=>[x+lx*ca-ly*sa,y+lx*sa+ly*ca,z+lz]
    const part=(suffix,lx,ly,lz,pw,pd,ph,color=f.color,mat='wood',kind='box')=>add(`${f.id}-${suffix}`,f.roomId,kind,loc(lx,ly,lz),[pw,pd,ph],color,'furniture',a,mat)
    const legs=(top)=>{for(const lx of [-w*.38,w*.38])for(const ly of [-d*.35,d*.35])part(`leg-${lx}-${ly}`,lx,ly,top/2,55,55,top,'#73583d')}
    if(f.kind==='rug') {part('weave',0,0,h/2,w,d,h,f.color,'fabric');continue}
    if(f.kind==='plant'||f.kind==='tree') {
      const tree=f.kind==='tree';part('pot',0,0,tree?100:h*.15,tree?w*.22:w*.65,tree?d*.22:d*.65,tree?200:h*.3,'#a78362','clay','cylinder')
      part('trunk',0,0,h*.42,tree?130:45,tree?130:45,h*.65,'#7f6947','wood','cylinder')
      for(let n=0;n<4;n++)part(`leaves-${n}`,Math.cos(n*2.4)*w*.17,Math.sin(n*2.4)*d*.17,h*(.65+n*.075),w*(.7-n*.08),d*(.7-n*.08),h*.35,f.color,'leaves','sphere')
      continue
    }
    if(f.kind==='bed') {
      part('base',0,0,210,w,d,350,'#896f51');part('mattress',0,0,450,w-40,d-50,220,'#eeeadf','fabric')
      part('headboard',0,d/2-70,650,w+80,120,1200,'#ad987d','fabric');part('duvet',0,-d*.13,580,w,d*.69,100,f.color,'fabric')
      for(const lx of [-w*.25,w*.25])part(`pillow-${lx}`,lx,d*.31,615,w*.42,400,130,'#f4f0e6','fabric')
    } else if(f.kind==='sofa'||f.kind==='chair') {
      legs(180);part('base',0,0,290,w,d,240,f.color,'fabric');part('back',0,d*.4,h*.68,w,d*.2,h*.62,f.color,'fabric')
      for(const lx of [-w*.45,w*.45])part(`arm-${lx}`,lx,0,h*.56,w*.1,d,h*.45,f.color,'fabric')
      const n=f.kind==='sofa'?3:1;for(let i=0;i<n;i++)part(`cushion-${i}`,(i-(n-1)/2)*w*.27,-d*.06,450,w*.8/n,d*.68,120,'#e0d5c2','fabric')
    } else if(['table','desk','coffee-table','stool'].includes(f.kind)) {
      legs(h-65);part('top',0,0,h-35,w,d,70)
      if(f.kind==='desk') {part('book',-w*.25,0,h+18,w*.2,d*.3,35,'#a7532f');part('notebook',0,0,h+15,w*.23,d*.38,25,'#e5deca')}
      if(f.kind==='coffee-table')part('bowl',w*.22,0,h+45,230,230,80,'#c1aa85','clay','cylinder')
    } else if(f.kind==='counter'||f.kind==='island') {
      part('base',0,0,(h-80)/2,w-40,d-40,h-80);part('stone',0,0,h-40,w,d,80,'#e5dece','stone')
      for(let i=1;i<Math.ceil(w/650);i++)part(`seam-${i}`,-w/2+i*w/Math.ceil(w/650),-d/2-1,h*.45,8,4,h*.7,'#947e60')
      if(f.id==='kitchen-run') {part('hob',-w*.25,0,h+8,600,450,15,'#302d28','metal');for(const lx of [-w*.25-150,-w*.25+150])part(`hob-ring-${lx}`,lx,0,h+20,130,130,15,'#777168','metal','cylinder');part('sink',w*.26,0,h+5,500,350,12,'#8c9690','metal')}
    } else if(f.kind==='bathtub') {
      part('body',0,0,h/2,w,d,h,'#edeae2','ceramic');part('basin',0,0,h+1,w*.8,d*.65,12,'#b4c7c0','water')
    } else if(f.kind==='toilet') {
      part('base',0,0,h*.25,w*.75,d*.8,h*.5,'#f4f0e8','ceramic','cylinder');part('cistern',0,d*.33,h*.6,w,d*.3,h*.8,'#f4f0e8','ceramic')
    } else if(f.kind==='lamp') {
      part('foot',0,0,30,w*.7,d*.7,60,'#6e5b44','metal','cylinder');part('stem',0,0,h*.45,25,25,h*.9,'#8c765b','metal','cylinder');part('shade',0,0,h*.87,w,d,h*.25,'#ece0c9','fabric','cylinder')
    } else {
      part('body',0,0,h/2,w,d,h)
      if(f.kind==='shelf')for(let i=1;i<5;i++) {part(`shelf-${i}`,0,0,i*h/5,w+10,d+10,35,'#bda583');part(`books-${i}`,0,0,i*h/5+120,w*.7,d*.75,210,i%2?'#b6b69e':'#b18c6d')}
      if(f.kind==='wardrobe')for(let i=1;i<4;i++)part(`door-line-${i}`,0,-d/2-1,i*h/4,w*.8,4,8,'#88714f')
    }
  }
  const max=scene.bounds.max,min=scene.bounds.min
  const exteriorRoomId=scene.rooms.find(room=>room.exterior)?.id||null
  box('site-ground',exteriorRoomId,[(max[0]+min[0])/2,(max[1]+min[1])/2,-180],[max[0]-min[0]+6500,max[1]-min[1]+5500,200],scene.exterior.groundColor,'exterior',0,'grass')
  // A low garden edge and stepping stones remain outside the entrance route.
  if(exteriorRoomId)for(let i=0;i<5;i++)box(`garden-step-${i}`,exteriorRoomId,[2500*max[0]/12000,-500-i*680,-3],[1450,480,20],'#d9d0bd','exterior',0,'stone')
  return out
}
