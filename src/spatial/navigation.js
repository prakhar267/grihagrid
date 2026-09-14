import { pointInPolygon, roomCenter } from './model.js'

const obstacleCache = new WeakMap()
const distance = (a,b) => Math.hypot(a[0]-b[0],a[1]-b[1])

export function getObstacles(scene) {
  if(obstacleCache.has(scene)) return obstacleCache.get(scene)
  const obstacles=[]
  for(const wall of scene.walls) {
    const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy),rotation=Math.atan2(dy,dx)
    const add=(from,to)=>{if(to>from)obstacles.push({id:wall.id,position:[wall.start[0]+dx*(from+to)/2/length,wall.start[1]+dy*(from+to)/2/length],size:[to-from,wall.thickness],rotation})}
    let cursor=0
    for(const opening of [...wall.openings].filter(o=>o.kind==='door'&&o.open&&o.height>=2000&&o.sill===0).sort((a,b)=>a.offset-b.offset)) {
      // Include the visible 50 mm frames in camera clearance.
      add(cursor,opening.offset+50);cursor=opening.offset+opening.width-50
    }
    add(cursor,length)
  }
  for(const f of scene.furniture) {
    if(f.kind==='rug'||f.position[2]>=2000)continue
    const scale=f.kind==='tree'?0.18:f.kind==='plant'?0.68:1
    obstacles.push({id:f.id,position:f.position.slice(0,2),size:[f.size[0]*scale,f.size[1]*scale],rotation:f.rotation||0})
  }
  obstacleCache.set(scene,obstacles);return obstacles
}

function nearBox(p,box,radius) {
  const dx=p[0]-box.position[0],dy=p[1]-box.position[1],c=Math.cos(box.rotation),s=Math.sin(box.rotation)
  const x=Math.abs(dx*c+dy*s)-box.size[0]/2,y=Math.abs(-dx*s+dy*c)-box.size[1]/2
  return Math.hypot(Math.max(0,x),Math.max(0,y)) < radius || (x<=0&&y<=0)
}

export function isWalkable(scene, position, clearance=220) {
  if(!Array.isArray(position)||!Number.isFinite(position[0])||!Number.isFinite(position[1]))return false
  for(const [dx,dy] of [[0,0],[clearance,0],[-clearance,0],[0,clearance],[0,-clearance]]) {
    if(!scene.rooms.some(room=>pointInPolygon([position[0]+dx,position[1]+dy],room.polygon)))return false
  }
  return !getObstacles(scene).some(box=>nearBox(position,box,clearance))
}

export function isSegmentClear(scene, start, end, clearance=220) {
  const steps=Math.max(1,Math.ceil(distance(start,end)/Math.min(70,clearance/2)))
  for(let i=0;i<=steps;i++)if(!isWalkable(scene,[start[0]+(end[0]-start[0])*i/steps,start[1]+(end[1]-start[1])*i/steps],clearance))return false
  return true
}

export function isPathClear(scene,path,clearance=220) {
  return Array.isArray(path)&&path.length>0&&path.every((p,i)=>i?isSegmentClear(scene,path[i-1],p,clearance):isWalkable(scene,p,clearance))
}

export function nearestWalkable(scene, point, {roomId,clearance=220,maxRadius=5000}={}) {
  const room=roomId?scene.rooms.find(r=>r.id===roomId):null
  const okay=p=>(!room||pointInPolygon(p,room.polygon))&&isWalkable(scene,p,clearance)
  if(okay(point))return point.slice(0,2)
  for(let radius=150;radius<=maxRadius;radius+=150) {
    const n=Math.max(12,Math.ceil(2*Math.PI*radius/150))
    for(let i=0;i<n;i++){const p=[point[0]+Math.cos(i/n*Math.PI*2)*radius,point[1]+Math.sin(i/n*Math.PI*2)*radius];if(okay(p))return p}
  }
  return null
}

export function getRoomAnchor(scene,roomId,clearance=220) {
  const room=scene.rooms.find(r=>r.id===roomId)
  if(!room)return null
  // Entering from the gallery or garden produces a useful view into each space.
  const xs=room.polygon.map(p=>p[0]),ys=room.polygon.map(p=>p[1]),cx=(Math.min(...xs)+Math.max(...xs))/2
  let preferred=room.exterior?[2500*scene.bounds.max[0]/12000,-2400*scene.bounds.max[1]/10000]:roomId==='hallway'?[6500*scene.bounds.max[0]/12000,5000*scene.bounds.max[1]/10000]:[cx,roomId==='main-bedroom'||roomId==='bedroom-two'||roomId==='study'?Math.min(...ys)+1000:Math.max(...ys)-900]
  if(!['living','kitchen','bathroom','hallway','main-bedroom','bedroom-two','study','garden'].includes(roomId)) {
    const center=roomCenter(room),entrances=[]
    for(const wall of scene.walls)for(const opening of wall.openings) {
      if(opening.kind!=='door'||!opening.open)continue
      const dx=wall.end[0]-wall.start[0],dy=wall.end[1]-wall.start[1],length=Math.hypot(dx,dy),t=(opening.offset+opening.width/2)/length
      const p=[wall.start[0]+dx*t,wall.start[1]+dy*t]
      if(!pointInPolygon(p,room.polygon))continue
      const boundary=Math.min(Math.abs(p[0]-Math.min(...xs)),Math.abs(p[0]-Math.max(...xs)),Math.abs(p[1]-Math.min(...ys)),Math.abs(p[1]-Math.max(...ys)))
      if(boundary>1)continue
      const distanceToCenter=distance(p,center)||1,step=Math.min(900,distanceToCenter*.6)
      entrances.push([p[0]+(center[0]-p[0])/distanceToCenter*step,p[1]+(center[1]-p[1])/distanceToCenter*step])
    }
    preferred=entrances.find(p=>isWalkable(scene,p,clearance))||center
  }
  return nearestWalkable(scene,preferred,{roomId,clearance})||nearestWalkable(scene,roomCenter(room),{roomId,clearance})
}

// Swept movement plus axis sliding prevents low frame rates from tunnelling through walls.
export function resolveCollision(scene,current,next,radius=220) {
  const elevation=scene.floors[0]?.elevation||0
  const z=elevation+Math.max(1400,Math.min(1900,Number.isFinite(next[2])?next[2]-elevation:1650))
  if(isSegmentClear(scene,current,next,radius))return [next[0],next[1],z]
  const x=[next[0],current[1]],y=[current[0],next[1]]
  if(isSegmentClear(scene,current,x,radius))return [x[0],x[1],z]
  if(isSegmentClear(scene,current,y,radius))return [y[0],y[1],z]
  return [current[0],current[1],z]
}

const gridCache=new WeakMap()
function gridFor(scene,clearance,step) {
  let scenes=gridCache.get(scene);if(!scenes){scenes=new Map();gridCache.set(scene,scenes)}
  const key=`${clearance}-${step}`;if(scenes.has(key))return scenes.get(key)
  const all=scene.rooms.flatMap(r=>r.polygon),minX=Math.min(...all.map(p=>p[0])),minY=Math.min(...all.map(p=>p[1])),maxX=Math.max(...all.map(p=>p[0])),maxY=Math.max(...all.map(p=>p[1]))
  const width=Math.ceil((maxX-minX)/step)+1,height=Math.ceil((maxY-minY)/step)+1
  const cells=new Uint8Array(width*height),point=i=>[minX+(i%width)*step,minY+Math.floor(i/width)*step]
  for(let i=0;i<cells.length;i++)cells[i]=isWalkable(scene,point(i),clearance)?1:0
  const grid={cells,point,width,height,minX,minY,step};scenes.set(key,grid);return grid
}

class MinHeap {
  constructor(){this.items=[]}
  push(item){let i=this.items.push(item)-1;while(i>0){const p=(i-1)>>1;if(this.items[p].score<=item.score)break;this.items[i]=this.items[p];i=p}this.items[i]=item}
  pop(){const root=this.items[0],end=this.items.pop();if(this.items.length){let i=0;while(true){const l=i*2+1,r=l+1;if(l>=this.items.length)break;const j=r<this.items.length&&this.items[r].score<this.items[l].score?r:l;if(this.items[j].score>=end.score)break;this.items[i]=this.items[j];i=j}this.items[i]=end}return root}
}

export function simplifyPath(scene,path,clearance=220) {
  if(path.length<=2)return path
  const result=[path[0]];let i=0
  while(i<path.length-1){let j=path.length-1;while(j>i+1&&!isSegmentClear(scene,path[i],path[j],clearance))j--;result.push(path[j]);i=j}
  return result
}

export function smoothPath(scene,path,clearance=220) {
  if(path.length<3)return path
  let result=path
  // Corner-cutting only survives if the entire resulting path retains body clearance.
  for(let pass=0;pass<2;pass++) {
    const candidate=[result[0]]
    for(let i=0;i<result.length-1;i++){const a=result[i],b=result[i+1];candidate.push([a[0]*.8+b[0]*.2,a[1]*.8+b[1]*.2],[a[0]*.2+b[0]*.8,a[1]*.2+b[1]*.8])}
    candidate.push(result.at(-1));if(!isPathClear(scene,candidate,clearance))break;result=candidate
  }
  return result
}

export function findPath(scene,start,end,{clearance=220,step=200,smooth=true}={}) {
  if(!isWalkable(scene,start,clearance)||!isWalkable(scene,end,clearance))return []
  if(isSegmentClear(scene,start,end,clearance))return [start.slice(0,2),end.slice(0,2)]
  const grid=gridFor(scene,clearance,step),{cells,point,width,height,minX,minY}=grid
  const closest=p=>{
    const gx=Math.round((p[0]-minX)/step),gy=Math.round((p[1]-minY)/step),options=[]
    for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){const x=gx+dx,y=gy+dy,i=y*width+x;if(x>=0&&x<width&&y>=0&&y<height&&cells[i])options.push({i,d:distance(p,point(i))})}
    options.sort((a,b)=>a.d-b.d);return options.find(o=>isSegmentClear(scene,p,point(o.i),clearance))?.i
  }
  const first=closest(start),last=closest(end);if(first===undefined||last===undefined)return []
  const costs=new Float64Array(cells.length).fill(Infinity),parents=new Int32Array(cells.length).fill(-1),closed=new Uint8Array(cells.length),heap=new MinHeap()
  costs[first]=0;heap.push({i:first,score:distance(point(first),end)})
  while(heap.items.length) {
    const {i}=heap.pop();if(closed[i])continue
    if(i===last){const path=[];for(let j=i;j!==-1;j=parents[j])path.push(point(j));path.reverse();path.unshift(start.slice(0,2));path.push(end.slice(0,2));const simple=simplifyPath(scene,path,clearance);return smooth?smoothPath(scene,simple,clearance):simple}
    closed[i]=1;const x=i%width,y=Math.floor(i/width)
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++) {
      if(!dx&&!dy)continue
      const nx=x+dx,ny=y+dy,j=ny*width+nx;if(nx<0||nx>=width||ny<0||ny>=height||!cells[j]||closed[j])continue
      if(!isSegmentClear(scene,point(i),point(j),clearance))continue
      const cost=costs[i]+step*Math.hypot(dx,dy)
      if(cost<costs[j]){costs[j]=cost;parents[j]=i;heap.push({i:j,score:cost+distance(point(j),point(last))})}
    }
  }
  return []
}

export function validateConnectivity(scene,{clearance=220}={}) {
  const rooms=scene.rooms,root=getRoomAnchor(scene,'hallway',clearance)||getRoomAnchor(scene,rooms.find(r=>!r.exterior)?.id||rooms[0]?.id,clearance),errors=[]
  for(const room of rooms){const anchor=getRoomAnchor(scene,room.id,clearance);if(!root||!anchor||!findPath(scene,root,anchor,{clearance}).length)errors.push(`No traversable route to ${room.name}.`)}
  return {valid:errors.length===0,errors}
}
