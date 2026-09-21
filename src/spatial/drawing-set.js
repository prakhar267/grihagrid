import { buildingSection, sectionPlane } from './building-sections.js'
import { COMPONENTS, DISCIPLINES, componentFootprint, coordinationSchedule } from './coordination.js'
import { toV2, polygonArea, polygonCenter, stairPolygon, doorLeafPrimitive } from './model-v2.js'

export const escapeDrawingText = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
const e = escapeDrawingText, n = value => Number(value.toFixed(3))
const bounds = points => ({x0:Math.min(...points.map(p=>p[0])),x1:Math.max(...points.map(p=>p[0])),y0:Math.min(...points.map(p=>p[1])),y1:Math.max(...points.map(p=>p[1]))})
const line = (x1,y1,x2,y2,extra='') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" ${extra}/>`
const text = (x,y,value,size=2.7,extra='') => `<text x="${n(x)}" y="${n(y)}" font-size="${size}" ${extra}>${e(value)}</text>`
export function dimensionLabel(mm, unit='mm') {
  if (unit==='m') return `${(mm/1000).toFixed(2)} m`
  if (unit==='ft') { const inches=Math.round(mm/25.4); return `${Math.floor(inches/12)}′ ${inches%12}″` }
  return String(Math.round(mm))
}
export function openingSchedule(input, floorId) {
  const model=toV2(input), rows=[]
  model.floors.forEach((floor,level)=>{
    let d=0,w=0
    for (const wall of model.walls.filter(w=>w.floorId===floor.id)) for (const opening of wall.openings) {
      const tag=`${level}-${opening.kind==='door'?`D${String(++d).padStart(2,'0')}`:`W${String(++w).padStart(2,'0')}`}`
      if (!floorId || floorId===floor.id) rows.push({...opening,tag,wallId:wall.id,floorId:floor.id,floor:floor.name,rooms:wall.roomIds.map(id=>model.rooms.find(r=>r.id===id)?.name||id).join(' / ')})
    }
  })
  return rows
}

// Local furniture coordinates are in millimetres. Used by the measured sheet
// and the editor so a fixture has the same outline and orientation in both.
export function furnitureSymbol(item) {
  const [w,d]=item.size, stroke=Math.max(12,Math.min(w,d)*.018)
  const rect=(x,y,width,height,extra='')=>`<rect x="${x}" y="${y}" width="${width}" height="${height}" ${extra}/>`
  const ellipse=(x,y,rx,ry)=>`<ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}"/>`
  let body=rect(-w/2,-d/2,w,d,'rx="30"')
  if (item.kind==='bed') body+=rect(-w*.46,-d*.47,w*.92,d*.68)+rect(-w*.43,d*.25,w*.39,d*.2,'rx="60"')+rect(w*.04,d*.25,w*.39,d*.2,'rx="60"')
  else if (['chair','sofa'].includes(item.kind)) {
    body+=rect(-w*.44,d*.3,w*.88,d*.16)+rect(-w*.48,-d*.42,w*.1,d*.72)+rect(w*.38,-d*.42,w*.1,d*.72)
    const count=item.kind==='sofa'?3:1
    for(let i=0;i<count;i++)body+=rect(-w*.36+i*w*.72/count,-d*.37,w*.68/count,d*.6,'rx="25"')
  } else if (['counter','kitchen-counter','island'].includes(item.kind)) {
    for(let i=1;i<Math.ceil(w/600);i++)body+=line(-w/2+i*w/Math.ceil(w/600),-d/2,-w/2+i*w/Math.ceil(w/600),d/2)
    if(item.kind==='kitchen-counter') {body+=rect(w*.08,-d*.32,w*.33,d*.64,'rx="50"');for(const x of [-w*.32,-w*.17])for(const y of [-d*.19,d*.19])body+=ellipse(x,y,w*.045,d*.12)}
  } else if(item.kind==='toilet')body=rect(-w/2,d*.22,w,d*.28,'rx="30"')+ellipse(0,-d*.12,w*.43,d*.35)+ellipse(0,-d*.13,w*.29,d*.24)
  else if(item.kind==='washbasin'||item.kind==='bathtub')body+=ellipse(0,0,w*.36,d*.34)+ellipse(0,d*.4,20,20)
  else if(item.kind==='shower')body+=line(-w/2,-d/2,w/2,d/2)+line(-w/2,d/2,w/2,-d/2)+ellipse(0,0,50,50)
  else if(item.kind==='washing-machine')body+=ellipse(0,0,w*.31,d*.31)+rect(-w*.4,d*.32,w*.8,d*.1)
  else if(item.kind==='refrigerator')body+=line(-w/2,-d*.3,w/2,-d*.3)+text(0,60,'FR',180,'text-anchor="middle" transform="scale(1,-1)"')
  else if(item.kind==='plant'||item.kind==='tree')body=ellipse(0,0,w*.45,d*.45)+line(-w*.3,-d*.3,w*.3,d*.3)+line(-w*.3,d*.3,w*.3,-d*.3)
  else if(item.kind==='wardrobe'||item.kind==='shelf') {for(let i=1;i<4;i++)body+=line(-w/2+i*w/4,-d/2,-w/2+i*w/4,d/2)}
  else if(item.kind==='puja-unit')body+=rect(-w*.4,-d*.3,w*.8,d*.6)+ellipse(0,0,70,70)
  return `<g fill="#faf8f2" stroke="#6f6b60" stroke-width="${stroke}" stroke-linejoin="round">${body}</g>`
}
function frame(model,title,number,scale,content,notes='') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297" role="img" aria-label="${e(title)}"><title>${e(model.name)} — ${e(title)}</title><rect width="420" height="297" fill="#fffefb"/><g font-family="Arial, sans-serif" fill="#26251f" stroke="#68685e" stroke-width=".18"><rect x="8" y="8" width="404" height="281" fill="none"/>${content}<path d="M8 266H412 M285 266V289 M367 266V289" fill="none"/>${text(14,273,'GRIHAGRID  /  ARCHITECTURAL STUDY',2.6)}${text(14,280,model.name,4.2)}${text(14,285,notes||'Concept geometry only. Structure, services and statutory compliance unverified.',2.3)}${text(291,274,title,3.2)}${text(291,281,`Rev ${model.revision} · ${scale}`,2.6)}${text(291,286,'A3 / 420 × 297 mm · print at 100%',2.3)}${text(374,277,number,5)}${text(374,285,'CONCEPT',2.7)}</g></svg>`
}
export function floorPlanSheet(input,floorId,{unit='mm',northDegrees=null,section={axis:'y',percent:50}}={}) {
  const model=toV2(input),floor=model.floors.find(f=>f.id===floorId)||model.floors[0],rooms=model.rooms.filter(r=>r.floorId===floor.id),walls=model.walls.filter(w=>w.floorId===floor.id)
  if (!rooms.length) return frame(model,`${floor.name} plan`,'A-00','No geometry',text(35,70,'This floor is empty. Add rooms in Edit layout.',5))
  const b=bounds(rooms.flatMap(r=>r.polygon)),scale=[50,75,100,125,150,200,250,300,400,500].find(s=>(b.x1-b.x0)/s<=244&&(b.y1-b.y0)/s<=201)||1000
  const ox=36+(244-(b.x1-b.x0)/scale)/2,oy=35+(201-(b.y1-b.y0)/scale)/2
  const xy=p=>[ox+(p[0]-b.x0)/scale,oy+(b.y1-p[1])/scale],poly=points=>points.map(p=>xy(p).map(n).join(',')).join(' ')
  let content=text(20,19,`${floor.name.toUpperCase()} / FURNITURE & DIMENSION PLAN`,3.6)+text(20,25,`FFL +${(floor.elevation/1000).toFixed(3)} m · ${floor.height} mm floor height · Dimensions: ${unit==='ft'?'feet / inches':unit}`,2.6)
  for(const room of rooms)content+=`<polygon points="${poly(room.polygon)}" fill="#f4f1e9" stroke="none"/>`
  for(const item of model.furniture.filter(f=>f.floorId===floor.id)) {const p=xy(item.position);content+=`<g transform="translate(${p}) scale(${1/scale},${-1/scale}) rotate(${item.rotation*180/Math.PI})">${furnitureSymbol(item)}</g>`}
  const schedule=openingSchedule(model,floor.id)
  for(const wall of walls) {
    const a=xy(wall.start),z=xy(wall.end),len=Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1]),angle=Math.atan2(z[1]-a[1],z[0]-a[0])*180/Math.PI
    content+=line(...a,...z,`stroke="#34372f" stroke-width="${wall.thickness/scale}"`)
    for(const opening of wall.openings) {
      const p=[a[0]+(z[0]-a[0])*opening.offset/len,a[1]+(z[1]-a[1])*opening.offset/len],w=opening.width/scale,t=wall.thickness/scale,tag=schedule.find(r=>r.id===opening.id&&r.wallId===wall.id)?.tag
      let shape=`<rect x="0" y="${-t/2-.08}" width="${w}" height="${t+.16}" fill="#fffefb" stroke="none"/>`
      if(opening.kind==='window')shape+=`<rect x="0" y="${-t/2}" width="${w}" height="${t}" fill="#dfebe8"/>`+line(0,0,w,0)+line(w/2,-t/2,w/2,t/2)
      else {
        const leaf=doorLeafPrimitive(wall,opening),h=xy(leaf.hingePosition),closed=xy(leaf.closedEnd),opened=xy(leaf.openEnd),end=opening.open?opened:closed,radius=(opening.width-70)/scale,sweep=(closed[0]-h[0])*(opened[1]-h[1])-(closed[1]-h[1])*(opened[0]-h[0])>0?1:0
        content+=line(...h,...end)+`<path d="M${closed} A${radius} ${radius} 0 0 ${sweep} ${opened}" fill="none" stroke-dasharray=".5 .5"/>`
      }
      content+=`<g transform="translate(${p}) rotate(${angle})">${shape}</g>`
      const middle=[p[0]+Math.cos(angle*Math.PI/180)*w/2,p[1]+Math.sin(angle*Math.PI/180)*w/2]
      content+=`<rect x="${middle[0]-4.2}" y="${middle[1]-1.4}" width="8.4" height="2.8" fill="#fffefb" stroke="#b8bbae" stroke-width=".12"/>`+text(middle[0],middle[1]+.8,tag,2,'text-anchor="middle" stroke="none"')
    }
  }
  for(const stair of model.stairs.filter(s=>s.fromFloorId===floor.id||s.toFloorId===floor.id)) {
    const footprint=stairPolygon(stair),[a,z]=[xy(stair.start),xy(stair.end)],dx=z[0]-a[0],dy=z[1]-a[1],len=Math.hypot(dx,dy),nx=-dy/len*stair.width/scale/2,ny=dx/len*stair.width/scale/2
    content+=`<polygon points="${poly(footprint)}" fill="#eeeee5"/>`
    for(let i=1;i<stair.steps;i++)content+=line(a[0]+dx*i/stair.steps-nx,a[1]+dy*i/stair.steps-ny,a[0]+dx*i/stair.steps+nx,a[1]+dy*i/stair.steps+ny)
    const up=stair.fromFloorId===floor.id,from=up?a:z,to=up?z:a,ux=(to[0]-from[0])/len,uy=(to[1]-from[1])/len,tip=[to[0]-ux*2,to[1]-uy*2]
    content+=line(from[0]+ux*2,from[1]+uy*2,...tip,'stroke-width=".35"')+`<path d="M${tip[0]-ux*2-uy} ${tip[1]-uy*2+ux} L${tip} L${tip[0]-ux*2+uy} ${tip[1]-uy*2-ux}" fill="none"/>`
    content+=text((a[0]+z[0])/2+3,(a[1]+z[1])/2,up?'UP':'DN',2.5,'stroke="#fffefb" stroke-width="1" paint-order="stroke"')
  }
  rooms.forEach((room,i)=>{
    const c=xy(polygonCenter(room.polygon)),r=bounds(room.polygon),words=room.name.split(' '),lines=[''];for(const word of words){if((lines.at(-1)+' '+word).trim().length>22)lines.push(word);else lines[lines.length-1]=(lines.at(-1)+' '+word).trim()}
    const labels=lines.slice(0,3),height=labels.length*3.4+7
    content+=`<rect x="${c[0]-18}" y="${c[1]-height/2}" width="36" height="${height}" rx="1" fill="#fffefb" opacity=".93" stroke="none"/>`
    labels.forEach((label,j)=>{content+=text(c[0],c[1]-height/2+3.1+j*3.4,label,2.8,'text-anchor="middle" stroke="none"')})
    content+=text(c[0],c[1]+height/2-3.8,`${dimensionLabel(r.x1-r.x0,unit)} × ${dimensionLabel(r.y1-r.y0,unit)}`,2.3,'text-anchor="middle" stroke="none"')+text(c[0],c[1]+height/2-.9,`R${String(i+1).padStart(2,'0')} · ${(polygonArea(room.polygon)/1e6).toFixed(2)} m²`,2.3,'text-anchor="middle" stroke="none"')
  })
  const cut=sectionPlane(model,section),start=[...cut.min],end=[...cut.max]
  start[cut.axis]=cut.coordinate;end[cut.axis]=cut.coordinate
  const ca=xy(start),cb=xy(end)
  content+=line(...ca,...cb,'stroke="#a7532f" stroke-width=".45" stroke-dasharray="3 1 .5 1"')
  for(const p of [ca,cb])content+=`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="3.6" fill="#fffefb" stroke="#a7532f"/>`+text(p[0],p[1]+.8,cut.name.slice(0,1),2.7,'text-anchor="middle" stroke="none"')
  content+=text(295,229,`Section ${cut.name} · look ${cut.direction} · see A-${cut.axis===1?'12':'13'}`,2.4)
  function dim(a,z,offset,vertical=false) {
    const p=xy(a),q=xy(z),value=Math.hypot(z[0]-a[0],z[1]-a[1]),mid=[(p[0]+q[0])/2,(p[1]+q[1])/2]
    if(value<1)return ''
    if(vertical)return line(offset,p[1],offset,q[1])+line(p[0]-1,p[1],offset-1,p[1])+line(q[0]-1,q[1],offset-1,q[1])+line(offset-1,p[1]+1,offset+1,p[1]-1)+line(offset-1,q[1]+1,offset+1,q[1]-1)+text(offset-1,mid[1],dimensionLabel(value,unit),2.4,`text-anchor="middle" transform="rotate(-90 ${offset-1} ${mid[1]})" stroke="#fffefb" stroke-width="1" paint-order="stroke"`)
    return line(p[0],offset,q[0],offset)+line(p[0],p[1]+1,p[0],offset+1)+line(q[0],q[1]+1,q[0],offset+1)+line(p[0]-1,offset+1,p[0]+1,offset-1)+line(q[0]-1,offset+1,q[0]+1,offset-1)+text(mid[0],offset-1,dimensionLabel(value,unit),2.4,'text-anchor="middle" stroke="#fffefb" stroke-width="1" paint-order="stroke"')
  }
  const xs=[...new Set(rooms.flatMap(r=>r.polygon.map(p=>p[0])))].sort((a,b)=>a-b),ys=[...new Set(rooms.flatMap(r=>r.polygon.map(p=>p[1])))].sort((a,b)=>a-b)
  content+=dim([b.x0,b.y0],[b.x1,b.y0],oy+(b.y1-b.y0)/scale+16)+dim([b.x0,b.y0],[b.x0,b.y1],ox-17,true)
  for(let i=1;i<xs.length;i++)if(xs[i]-xs[i-1]>=250)content+=dim([xs[i-1],b.y0],[xs[i],b.y0],oy+(b.y1-b.y0)/scale+8)
  for(let i=1;i<ys.length;i++)if(ys[i]-ys[i-1]>=250)content+=dim([b.x0,ys[i-1]],[b.x0,ys[i]],ox-8,true)
  content+=text(295,38,'OPENING SCHEDULE',3.1)+text(295,43,'TAG     WIDTH × HEIGHT     SILL',2.4)+text(295,47,'All schedule dimensions in mm',2.2)
  schedule.slice(0,18).forEach((o,i)=>{content+=text(295,52+i*4,`${o.tag}    ${o.width} × ${o.height}    ${o.sill||0}`,2.5)})
  let yy=59+Math.min(18,schedule.length)*4
  if(schedule.length>18)content+=text(295,yy-3,'More openings: see complete downloaded set.',2.2)
  content+=text(295,yy,'ROOM AREAS',3.1);yy+=5
  rooms.slice(0,10).forEach((r,i)=>{content+=text(295,yy,`R${String(i+1).padStart(2,'0')}  ${r.name.slice(0,26)}`,2.5)+text(404,yy,`${(polygonArea(r.polygon)/1e6).toFixed(2)} m²`,2.5,'text-anchor="end"');yy+=4})
  yy+=5;content+=text(295,yy,'STAIRS / FLOOR CONNECTIONS',2.8);yy+=5
  model.stairs.filter(s=>s.fromFloorId===floor.id||s.toFloorId===floor.id).slice(0,2).forEach(s=>{const rise=model.floors.find(f=>f.id===s.toFloorId).elevation-model.floors.find(f=>f.id===s.fromFloorId).elevation,run=Math.hypot(s.end[0]-s.start[0],s.end[1]-s.start[1]);content+=text(295,yy,`${s.steps} rises @ ${(rise/s.steps).toFixed(1)} · tread ${(run/s.steps).toFixed(0)}`,2.4)+text(295,yy+4,`Width ${s.width} · rise ${rise} mm`,2.4);yy+=11})
  const angle=(northDegrees??0)*Math.PI/180,ax=399,ay=23
  content+=line(ax,ay,ax+Math.sin(angle)*8,ay-Math.cos(angle)*8,'stroke-width=".5"')+text(390,15,northDegrees===null?'N ?':`N ${northDegrees}°`,2.6)
  content+=line(295,234,295+2000/scale,234,'stroke-width="1"')+line(295,232.5,295,235.5)+line(295+2000/scale,232.5,295+2000/scale,235.5)+text(295,240,'0',2.4)+text(295+2000/scale,240,'2 m',2.4,'text-anchor="end"')
  content+=text(295,247,'Dimensions follow room boundary axes.',2.3)+text(295,251,'Room sizes are bounding extents; areas',2.3)+text(295,255,'follow polygons. Check clear sizes on site.',2.3)
  return frame(model,`${floor.name} plan`,`A-${String(model.floors.indexOf(floor)+1).padStart(2,'0')}`,`1:${scale}`,content)
}

export function elevationSheet(input) {
  const model=toV2(input),b=bounds(model.rooms.flatMap(r=>r.polygon)),height=Math.max(...model.floors.map(f=>f.elevation+f.height)),scale=[100,125,150,200,250,400,500].find(s=>Math.max(b.x1-b.x0,b.y1-b.y0)/s<162&&height/s<85)||1000
  let content=text(20,19,'FOUR MODEL ELEVATIONS',4)+text(20,25,'Opening locations and heights from the shared model · roof and floor plates shown schematically',2.6)
  const tags=openingSchedule(model)
  for(const [i,label] of ['FRONT / −Y','REAR / +Y','LEFT / −X','RIGHT / +X'].entries()) {
    const axis=i<2?0:1,depth=1-axis,negative=i===0||i===2,xx=i%2?223:29,base=i<2?126:248,min=axis===0?b.x0:b.y0,max=axis===0?b.x1:b.y1
    content+=text(xx,base+8,label,3)+line(xx-5,base,xx+(max-min)/scale+5,base,'stroke-width=".5"')
    for(const floor of model.floors) {
      const exterior=model.walls.filter(w=>w.floorId===floor.id&&w.roomIds.length===1&&Math.abs(w.start[depth]-w.end[depth])<1).sort((a,z)=>negative?z.start[depth]-a.start[depth]:a.start[depth]-z.start[depth])
      for(const wall of exterior) {
        const lo=Math.min(wall.start[axis],wall.end[axis]),w=Math.abs(wall.end[axis]-wall.start[axis]),x=xx+(lo-min)/scale,y=base-(floor.elevation+wall.height)/scale
        content+=`<rect x="${x}" y="${y}" width="${w/scale}" height="${wall.height/scale}" fill="#eeebe1"/>`
        for(const o of wall.openings) {
          const origin=wall.start[axis]+Math.sign(wall.end[axis]-wall.start[axis])*o.offset,xo=xx+(Math.min(origin,origin+Math.sign(wall.end[axis]-wall.start[axis])*o.width)-min)/scale,yo=base-(floor.elevation+(o.sill||0)+o.height)/scale
          content+=`<rect x="${xo}" y="${yo}" width="${o.width/scale}" height="${o.height/scale}" fill="${o.kind==='window'?'#dce7e4':'#b7a184'}"/>`+line(xo+o.width/scale/2,yo,xo+o.width/scale/2,yo+o.height/scale)+text(xo+o.width/scale/2,yo+o.height/scale/2,tags.find(t=>t.id===o.id&&t.wallId===wall.id)?.tag,2,'text-anchor="middle"')
        }
      }
      content+=line(xx,base-floor.elevation/scale,xx+(max-min)/scale,base-floor.elevation/scale,'stroke-width=".6"')+text(xx+(max-min)/scale+2,base-floor.elevation/scale,`+${(floor.elevation/1000).toFixed(2)}`,2.2)
    }
    content+=text(xx+(max-min)/scale+2,base-height/scale,`+${(height/1000).toFixed(2)}`,2.2)
  }
  return frame(model,'Elevations','A-10',`1:${scale}`,content,'Concept elevations. Finishes, façade design, structure and roof build-up require design development.')
}
export function stairSectionSheet(input) {
  const model=toV2(input);let content=text(20,19,'STAIR SECTIONS / LEVEL COORDINATION',4)+text(20,26,'Each connection projected along its own run. Landings are floor levels; structural build-up is not specified.',2.6)
  if(!model.stairs.length)content+=text(35,80,'No stairs in this model.',5)
  model.stairs.forEach((s,i)=>{
    const from=model.floors.find(f=>f.id===s.fromFloorId),to=model.floors.find(f=>f.id===s.toFloorId),rise=to.elevation-from.elevation,run=Math.hypot(s.end[0]-s.start[0],s.end[1]-s.start[1]),rows=Math.ceil(model.stairs.length/2),panelHeight=214/Math.max(1,rows),scale=Math.max(50,Math.ceil(Math.max(run/145,rise/(panelHeight-30))/25)*25),xx=24+(i%2)*196,base=40+panelHeight-23+Math.floor(i/2)*panelHeight
    let path=`M${xx} ${base}`
    for(let j=0;j<s.steps;j++)path+=`v${-rise/s.steps/scale}h${run/s.steps/scale}`
    content+=`<path d="${path}" fill="none" stroke-width=".8"/>`+line(xx-8,base,xx,base)+line(xx+run/scale,base-rise/scale,xx+run/scale+8,base-rise/scale)
    content+=text(xx,base+7,`${from.name} → ${to.name}`,3)+text(xx,base+12,`${s.steps} risers × ${(rise/s.steps).toFixed(1)} mm · tread ${(run/s.steps).toFixed(1)} mm`,2.6)+text(xx,base+17,`Run ${Math.round(run)} · width ${s.width} · rise ${rise} mm · 1:${n(scale)}`,2.6)
    content+=text(xx,base-3,`FFL +${(from.elevation/1000).toFixed(3)}`,2.3)+text(xx+run/scale,base-rise/scale-3,`FFL +${(to.elevation/1000).toFixed(3)}`,2.3,'text-anchor="end"')
  })
  return frame(model,'Stair sections','A-11','Scale per connection',content,'Geometry coordination only. Headroom, guards, structure and statutory requirements need professional design.')
}
export function buildingSectionSheet(input,options={}) {
  const model=toV2(input),section=buildingSection(model,options.section),unit=options.unit||'mm'
  const lo=section.min[section.across],hi=section.max[section.across]
  const bottom=Math.min(0,...section.parts.map(p=>p.bottom)),top=Math.max(...model.floors.map(f=>f.elevation+f.height),...section.parts.map(p=>p.top))
  const scale=[50,75,100,125,150,200,250,300,400,500,750,1000].find(s=>(hi-lo+1000)/s<=280&&(top-bottom)/s<=195)||2000
  const ox=43+(280-(hi-lo)/scale)/2,base=226,x=v=>ox+(v-lo)/scale,y=v=>base-(v-bottom)/scale
  let content=text(20,19,`BUILDING SECTION ${section.name} / ALL STOREYS`,4)+text(20,26,`Cut ${section.axis===0?'X':'Y'} = ${Math.round(section.coordinate)} mm · looking ${section.direction} · dimensions: ${unit}`,2.7)
  content+=`<defs><pattern id="section-hatch" width="2" height="2" patternUnits="userSpaceOnUse"><path d="M0 2L2 0" stroke="#a59b89" stroke-width=".2"/></pattern></defs>`
  for(const room of section.rooms) {
    const floor=section.floors.find(f=>f.id===room.floorId)
    content+=`<rect x="${n(x(room.left))}" y="${n(y(floor.elevation+floor.height))}" width="${n((room.right-room.left)/scale)}" height="${n(floor.height/scale)}" fill="#f4f1e9" stroke="none"/>`
  }
  for(const part of section.parts) {
    const cut=['wall','floor','roof'].includes(part.category)
    content+=`<rect data-source-id="${e(part.id)}" x="${n(x(part.left))}" y="${n(y(part.top))}" width="${n((part.right-part.left)/scale)}" height="${n((part.top-part.bottom)/scale)}" fill="${cut?'url(#section-hatch)':part.category==='opening'?'#d9e5df':'#cbbba1'}" stroke="#45453a" stroke-width="${cut?.4:.15}"/>`
  }
  section.floors.forEach((floor,i)=>{
    const fy=y(floor.elevation),next=section.floors[i+1],height=next?next.elevation-floor.elevation:floor.height
    content+=line(x(lo)-6,fy,340,fy,'stroke="#b3ada2" stroke-dasharray="2 1"')+text(344,fy-2,floor.name.slice(0,29),2.7)+text(344,fy+2,`FFL +${(floor.elevation/1000).toFixed(3)} m`,2.5)
    const a=y(floor.elevation+height),dx=30
    content+=line(dx,fy,dx,a)+line(dx-2,fy,dx+2,fy)+line(dx-2,a,dx+2,a)+text(dx-2,(fy+a)/2,dimensionLabel(height,unit),2.5,`text-anchor="middle" transform="rotate(-90 ${dx-2} ${(fy+a)/2})" stroke="none"`)
    for(const room of section.rooms.filter(r=>r.floorId===floor.id)) {
      const cx=x((room.left+room.right)/2),cy=y(floor.elevation+floor.height*.58),available=(room.right-room.left)/scale
      if(available<15)continue
      const label=room.name.length>Math.floor(available/1.3)?room.name.slice(0,Math.floor(available/1.3)-1)+'…':room.name
      content+=text(cx,cy,label,2.6,'text-anchor="middle" stroke="#fffefb" stroke-width="1.2" paint-order="stroke"')+text(cx,cy+4,dimensionLabel(room.right-room.left,unit),2.3,'text-anchor="middle" stroke="#fffefb" stroke-width="1" paint-order="stroke"')
    }
  })
  const roof=Math.max(...section.floors.map(f=>f.elevation+f.height))
  content+=text(344,y(roof),'Ceiling datum',2.5)+text(344,y(roof)+4,`+${(roof/1000).toFixed(3)} m`,2.5)
  content+=line(x(lo),240,x(hi),240)+line(x(lo),237,x(lo),243)+line(x(hi),237,x(hi),243)+text((x(lo)+x(hi))/2,238,dimensionLabel(hi-lo,unit),2.8,'text-anchor="middle" stroke="none"')
  content+=text(20,254,'Hatching = cut model surfaces. Stair voids follow the 3D apertures. Room widths are section intersections.',2.5)
  if(!section.parts.length)content+=text(70,120,'This cut does not intersect building geometry. Move the cut position.',3)
  return frame(model,`Building section ${section.name}`,`A-${section.axis===1?'12':'13'}`,`1:${scale}`,content,'Model geometry only. Slab build-up, headroom and structural design require verification.')
}

export function openingScheduleSheets(input) {
  const model=toV2(input),rows=openingSchedule(model),sheets=[]
  for(let page=0;page<Math.ceil(rows.length/35);page++) {
    let content=text(20,20,'COMPLETE DOOR & WINDOW SCHEDULE',4)+text(20,27,'Dimensions in millimetres. Tags match the floor plans and elevations.',2.7)
    const columns=[[20,'TAG'],[45,'FLOOR'],[90,'TYPE'],[114,'WIDTH'],[139,'HEIGHT'],[164,'SILL'],[188,'ROOMS']]
    for(const [x,label] of columns)content+=text(x,38,label,2.6)
    rows.slice(page*35,(page+1)*35).forEach((o,i)=>{const y=45+i*6;content+=line(20,y+2,401,y+2,'stroke="#dad7cd"');[o.tag,o.floor,o.kind,o.width,o.height,o.sill||0,o.rooms.slice(0,83)].forEach((value,j)=>{content+=text(columns[j][0],y,value,j===6?2.2:2.6)})})
    sheets.push(frame(model,'Opening schedule',`S-${String(page+1).padStart(2,'0')}`,'Not to scale',content))
  }
  return sheets
}
export function drawingSetHTML(input,options={}) {
  const model=toV2(input),sheets=model.floors.map(f=>floorPlanSheet(model,f.id,options)).concat(elevationSheet(model),stairSectionSheet(model),buildingSectionSheet(model,{...options,section:{...options.section,axis:'y'}}),buildingSectionSheet(model,{...options,section:{...options.section,axis:'x'}}),openingScheduleSheets(model))
  for(const floor of model.floors)for(const discipline of Object.keys(DISCIPLINES))if(coordinationSchedule(model,floor.id,discipline).length)sheets.push(coordinationPlanSheet(model,floor.id,discipline))
  sheets.push(...coordinationScheduleSheets(model))
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(model.name)} — drawing set</title><style>body{margin:0;background:#e9e5dc;font-family:Arial,sans-serif}header{padding:20px}article{width:420mm;max-width:100%;margin:20px auto;background:white}svg{width:100%;height:auto;display:block}@page{size:A3 landscape;margin:0}@media print{header{display:none}body{background:white}article{margin:0;width:420mm;max-width:none;break-after:page;page-break-after:always}article:last-child{break-after:auto}svg{width:420mm;height:297mm}}</style><header><h1>${e(model.name)} — concept drawing set</h1><p>Revision ${model.revision}. Print at actual size on A3 landscape. All sheets derive from the same model. ${sheets.length} sheets.</p><button onclick="window.print()">Print drawing set</button></header>${sheets.map(s=>`<article>${s}</article>`).join('')}</html>`
}

export function coordinationPlanSheet(input,floorId,discipline='structure') {
  const model=toV2(input),floor=model.floors.find(f=>f.id===floorId)||model.floors[0],rooms=model.rooms.filter(r=>r.floorId===floor.id),rows=coordinationSchedule(model,floor.id,discipline)
  const points=rooms.flatMap(r=>r.polygon).concat(rows.flatMap(componentFootprint)),b=bounds(points.length?points:model.rooms.flatMap(r=>r.polygon))
  const scale=[50,75,100,125,150,200,250,300,400,500,750,1000].find(s=>(b.x1-b.x0)/s<=272&&(b.y1-b.y0)/s<=194)||2000
  const ox=25+(272-(b.x1-b.x0)/scale)/2,oy=40+(194-(b.y1-b.y0)/scale)/2,xy=p=>[ox+(p[0]-b.x0)/scale,oy+(b.y1-p[1])/scale],poly=p=>p.map(v=>xy(v).map(n).join(',')).join(' ')
  let content=text(20,19,`${floor.name.toUpperCase()} / ${DISCIPLINES[discipline].toUpperCase()}`,4)+text(20,26,`Entered coordination geometry · FFL +${(floor.elevation/1000).toFixed(3)} m · all sizes in mm`,2.7)
  for(const room of rooms) {
    content+=`<polygon points="${poly(room.polygon)}" fill="#f7f5ee" stroke="#b7b2a7"/>`
    const p=xy(polygonCenter(room.polygon));content+=text(...p,room.name.slice(0,32),2.4,'fill="#948e82" text-anchor="middle" stroke="none"')
  }
  for(const wall of model.walls.filter(w=>w.floorId===floor.id)) {
    const a=xy(wall.start),z=xy(wall.end),len=Math.hypot(wall.end[0]-wall.start[0],wall.end[1]-wall.start[1])
    content+=line(...a,...z,`stroke="#9e9b90" stroke-width="${wall.thickness/scale}"`)
    for(const o of wall.openings)content+=line(a[0]+(z[0]-a[0])*o.offset/len,a[1]+(z[1]-a[1])*o.offset/len,a[0]+(z[0]-a[0])*(o.offset+o.width)/len,a[1]+(z[1]-a[1])*(o.offset+o.width)/len,`stroke="${o.kind==='door'?'#fffefb':'#c8dad8'}" stroke-width="${wall.thickness/scale+.15}"`)
  }
  const labels=[]
  for(const item of rows) {
    const p=xy(item.position),spec=COMPONENTS[item.kind],foot=poly(componentFootprint(item))
    content+=`<g data-component-id="${e(item.id)}"><polygon points="${foot}" fill="${spec.color}" fill-opacity=".25" stroke="${spec.color}" stroke-width=".4"/>`
    if(discipline==='electrical')content+=`<circle cx="${n(p[0])}" cy="${n(p[1])}" r="1.6" fill="#fffefb" stroke="${spec.color}"/>`+text(p[0],p[1]+.7,spec.prefix,1.7,'text-anchor="middle" stroke="none"')
    let ly=p[1]-3,lx=p[0]
    for(let attempt=0;attempt<12&&labels.some(q=>Math.abs(q[0]-lx)<24&&Math.abs(q[1]-ly)<6);attempt++){ly+=6;if(ly>240){ly=p[1]-9-attempt*6;lx=Math.min(288,p[0]+20)}}
    labels.push([lx,ly]);content+=line(...p,lx,ly+1,`stroke="${spec.color}" stroke-width=".15"`)
    const dims=spec.pipe?`Ø${Math.min(...item.size)} · L${Math.max(...item.size)}`:item.size.map(Math.round).join(' × ')
    content+=text(lx,ly,item.tag,2.7,`fill="${spec.color}" text-anchor="middle" stroke="#fffefb" stroke-width="1.2" paint-order="stroke"`)+text(lx,ly+3.4,dims,2.1,'text-anchor="middle" stroke="#fffefb" stroke-width="1" paint-order="stroke"')+'</g>'
  }
  const a=xy([b.x0,b.y0]),z=xy([b.x1,b.y0]);content+=line(a[0],246,z[0],246)+line(a[0],243,a[0],249)+line(z[0],243,z[0],249)+text((a[0]+z[0])/2,244,Math.round(b.x1-b.x0),2.6,'text-anchor="middle"')
  content+=text(308,43,`${rows.length} ENTERED COMPONENTS`,2.6)+text(308,50,'Tag → full component schedule',2.5)+text(308,57,'Positions use the model origin.',2.4)+text(308,63,'Base heights are above this FFL.',2.4)
  let y=76
  for(const [kind,spec] of Object.entries(COMPONENTS).filter(([,v])=>v.discipline===discipline)) {content+=line(308,y-1,315,y-1,`stroke="${spec.color}" stroke-width=".8"`)+text(318,y,`${spec.prefix} · ${spec.name}`,2.3);y+=7}
  const notes=discipline==='structure'?['Member sizes are entered inputs.','No reinforcement or capacity analysis.','Check supports and foundations.']:discipline==='electrical'?['Point locations and entered loads.','Circuit labels group these points.','No wire or protection sizing.']:['Straight runs with entered diameters.','Envelopes do not define fittings.','Verify slope, connections and sizing.']
  notes.forEach((v,i)=>content+=text(308,Math.max(y+10,125)+i*6,v,2.3))
  if(!rows.length)content+=text(60,120,'No components entered. Add them in Structure & services.',3.5)
  content+=text(20,257,'Review geometric interference in the studio. Unverified design inputs; not a construction issue.',2.6)
  return frame(model,`${DISCIPLINES[discipline]} · ${floor.name}`,`${discipline==='structure'?'ST':discipline==='electrical'?'EL':'PL'}-${model.floors.indexOf(floor)+1}`,`1:${scale}`,content)
}
export function coordinationScheduleSheets(input) {
  const model=toV2(input),rows=coordinationSchedule(model),pages=[];let content='',y=0,page=0
  const start=()=>{content=text(20,19,'STRUCTURE & SERVICES / COMPONENT SCHEDULE',4)+text(20,26,'Designer-entered sizes and system labels. Heights above local finished floor. Quantities are modeled, not a priced BOQ.',2.5);y=38}
  const finish=()=>pages.push(frame(model,'Component schedule',`CS-${++page}`,'All dimensions mm',content))
  const wrap=(value,max)=>{const lines=[];let rest=value;while(rest.length>max){let end=rest.lastIndexOf(' ',max);if(end<max/2)end=max;lines.push(rest.slice(0,end));rest=rest.slice(end).trimStart()}if(rest)lines.push(rest);return lines}
  start()
  for(const row of rows) {
    const notes=wrap(row.notes,140),height=19+notes.length*4
    if(y+height>257){finish();start()}
    content+=text(20,y,`${row.tag} · ${row.label}`,3)+text(210,y,`${row.floor} / ${row.type}`,2.6)
    content+=text(20,y+5,`X ${row.position[0]} · Y ${row.position[1]} · base ${row.position[2]} · W×D×H ${row.size.join(' × ')} · rotation ${Math.round(row.rotation*180/Math.PI)}°`,2.5)
    content+=text(20,y+10,`System: ${row.system||'Unassigned'}${row.discipline==='electrical'?` · entered load: ${row.loadWatts==null?'unspecified':`${row.loadWatts} W`}`:''}`,2.5)
    notes.forEach((note,i)=>content+=text(20,y+15+i*4,note,2.4));content+=line(20,y+height-3,400,y+height-3,'stroke="#d8d3c8"');y+=height
  }
  if(rows.length)finish()
  return pages
}
