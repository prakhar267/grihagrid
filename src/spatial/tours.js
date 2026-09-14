import { roomCenter } from './model.js'
import { findPath, getRoomAnchor, isPathClear, isWalkable } from './navigation.js'

const clamp=(n,a,b)=>Math.max(a,Math.min(b,n))
const mix=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t)
const dist=(a,b)=>Math.hypot(...a.map((v,i)=>v-b[i]))
const ease=t=>t*t*(3-2*t)
export const isTourStale=(scene,tour)=>tour.buildingId!==scene.id||tour.sourceRevision!==scene.revision

export function getOverviewView(scene) {
  const max=scene.bounds.max,min=scene.bounds.min,w=max[0]-min[0],d=max[1]-min[1]
  return {position:[max[0]+w*.55,min[1]-d*.6,Math.max(w,d)*1.1],target:[(max[0]+min[0])/2,(max[1]+min[1])/2,400],fov:48}
}

export function getRoomView(scene,roomId) {
  const room=scene.rooms.find(r=>r.id===roomId),anchor=getRoomAnchor(scene,roomId)
  if(!room||!anchor)return getOverviewView(scene)
  const center=roomCenter(room)
  return {position:[...anchor,1650],target:room.exterior?[scene.bounds.max[0]*.45,2400,1600]:[...center,1100],fov:60,roomId}
}
export const getRoomViewpoint=getRoomView

function schedule(shots) {
  let time=0
  return shots.map(shot=>{const next={...shot,startTime:time};time+=shot.duration;return next})
}

export function defaultTourRoomIds(scene) {
  const preferred=['living','kitchen','main-bedroom','bedroom-two','study','garden']
  const demoIds=[...preferred,'bathroom','hallway']
  const isDemoLayout=preferred.every(id=>scene.rooms.some(room=>room.id===id))&&scene.rooms.every(room=>demoIds.includes(room.id))
  return (isDemoLayout?preferred:scene.rooms.map(room=>room.id)).slice(0,12)
}

export function generateTour(scene,{roomIds,duration=30,includeExterior=true,source='deterministic'}={}) {
  if(!Number.isFinite(duration)||duration<8||duration>300)throw new Error('Tour duration must be between 8 and 300 seconds.')
  const requested=roomIds?.length?roomIds:defaultTourRoomIds(scene)
  const unknown=requested.filter(id=>!scene.rooms.some(room=>room.id===id))
  if(unknown.length)throw new Error(`Unknown tour rooms: ${unknown.join(', ')}.`)
  const ids=requested.filter((id,i)=>i===0||id!==requested[i-1])
  const shots=[];let previous=null
  if(includeExterior) {
    const interior=scene.rooms.filter(room=>!room.exterior),points=(interior.length?interior:scene.rooms).flatMap(room=>room.polygon)
    const minX=Math.min(...points.map(p=>p[0])),minY=Math.min(...points.map(p=>p[1])),w=Math.max(...points.map(p=>p[0]))-minX,d=Math.max(...points.map(p=>p[1]))-minY,center=[minX+w/2,minY+d*.35,800]
    // Aerial path stays well above the complete roof and planting envelope.
    const path=Array.from({length:25},(_,i)=>{const angle=-Math.PI*.72+i/24*Math.PI*.28;return [center[0]+Math.cos(angle)*w*1.25,center[1]+Math.sin(angle)*d*1.3,11500]})
    shots.push({id:'establishing',kind:'orbit',roomId:null,path,target:center,duration:4,fov:48,transition:'continuous'})
    const entry=scene.rooms.find(room=>room.exterior)||scene.rooms.find(room=>room.id===ids[0]),view=getRoomView(scene,entry.id)
    previous=view.position
    shots.push({id:entry.id==='garden'?'garden-approach':'arrival',kind:'hold',roomId:entry.id,path:[previous,previous],target:entry.id==='garden'?[w*.45,2500,1500]:view.target,duration:1.5,fov:60,transition:'fade'})
  }
  for(let i=0;i<ids.length;i++) {
    const id=ids[i],view=getRoomView(scene,id)
    if(!isWalkable(scene,view.position))throw new Error(`No accessible viewpoint for ${id}.`)
    if(previous) {
      const path=findPath(scene,previous,view.position)
      if(!path.length)throw new Error(`No traversable route to ${scene.rooms.find(r=>r.id===id).name}.`)
      const length=path.reduce((sum,p,j)=>sum+(j?dist(p,path[j-1]):0),0)
      shots.push({id:`walk-${i}-${id}`,kind:'walk',roomId:id,path:path.map(p=>[...p,1650]),target:view.target,duration:Math.max(2,length/1500+1),fov:60,transition:'continuous'})
    } else shots.push({id:`view-${i}-${id}`,kind:'hold',roomId:id,path:[view.position,view.position],target:view.target,duration:2,fov:60,transition:'fade'})
    shots.push({id:`hold-${i}-${id}`,kind:'hold',roomId:id,path:[view.position,view.position],target:view.target,duration:1.5,fov:60,transition:'continuous'})
    previous=view.position
  }
  const total=shots.reduce((sum,s)=>sum+s.duration,0),scaled=shots.map(s=>({...s,duration:s.duration*duration/total}))
  const tour={schemaVersion:1,id:`${scene.id}-tour-r${scene.revision}`,name:'A walk through the courtyard house',buildingId:scene.id,sourceRevision:scene.revision,source,duration,roomIds:ids,shots:schedule(scaled)}
  const validation=validateTour(scene,tour)
  if(!validation.valid)throw new Error(validation.errors.join(' '))
  return tour
}

export function retimeTour(tour,shotId,duration) {
  if(!Number.isFinite(duration)||duration<.5||duration>60)throw new Error('A shot must last between 0.5 and 60 seconds.')
  if(!tour.shots.some(s=>s.id===shotId))throw new Error('Unknown tour shot.')
  const shots=schedule(tour.shots.map(s=>s.id===shotId?{...s,duration}:s))
  return {...tour,shots,duration:shots.reduce((sum,s)=>sum+s.duration,0)}
}

function pointAlong(path,fraction) {
  const lengths=path.slice(1).map((p,i)=>dist(p,path[i])),total=lengths.reduce((a,b)=>a+b,0)
  if(!total)return path[0].slice()
  let remaining=clamp(fraction,0,1)*total
  for(let i=0;i<lengths.length;i++) {if(remaining<=lengths[i]||i===lengths.length-1)return mix(path[i],path[i+1],lengths[i]?clamp(remaining/lengths[i],0,1):0);remaining-=lengths[i]}
  return path.at(-1).slice()
}

export function sampleTour(tour,timeSeconds) {
  if(!tour?.shots?.length)return null
  const time=clamp(Number.isFinite(timeSeconds)?timeSeconds:0,0,tour.duration)
  const shot=tour.shots.find(s=>time<s.startTime+s.duration)||tour.shots.at(-1)
  const local=clamp((time-shot.startTime)/shot.duration,0,1),progress=ease(local),position=pointAlong(shot.path,progress)
  let target=shot.target
  if(shot.kind==='walk') {
    const ahead=pointAlong(shot.path,Math.min(1,progress+.075))
    let direction=[ahead[0]-position[0],ahead[1]-position[1]]
    if(Math.hypot(...direction)<1){const before=pointAlong(shot.path,Math.max(0,progress-.075));direction=[position[0]-before[0],position[1]-before[1]]}
    const length=Math.hypot(...direction)||1
    const forward=[position[0]+direction[0]/length*1800,position[1]+direction[1]/length*1800,1550]
    target=mix(forward,shot.target,ease(clamp((local-.72)/.28,0,1)))
    // Begin by facing the previous held view, then smoothly turn toward the route.
    const index=tour.shots.indexOf(shot),previous=tour.shots[index-1]
    if(previous&&local<.2)target=mix(previous.target,target,ease(local/.2))
  }
  let fade=shot.transition==='fade'?1-clamp(local*shot.duration/.35,0,1):0
  const next=tour.shots[tour.shots.indexOf(shot)+1]
  if(next?.transition==='fade')fade=Math.max(fade,clamp((local*shot.duration-shot.duration+.35)/.35,0,1))
  return {position,target,roomId:shot.roomId,shotId:shot.id,fov:shot.fov||60,transition:shot.transition,fade,timeSeconds:time,progress:tour.duration?time/tour.duration:0}
}

export function validateTour(scene,tour) {
  const errors=[]
  if(!tour||tour.schemaVersion!==1||!Array.isArray(tour.shots)||!tour.shots.length)return {valid:false,errors:['A versioned tour with shots is required.']}
  const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key))
  const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}$/.test(value)
  if(!exact(tour,['schemaVersion','id','name','buildingId','sourceRevision','source','duration','roomIds','shots'])||!identifier(tour.id)||typeof tour.name!=='string'||tour.name.length<1||tour.name.length>100||!['deterministic','local','manual','local-rules','gemini'].includes(tour.source)||!Array.isArray(tour.roomIds)||tour.roomIds.length<1||tour.roomIds.length>12||tour.roomIds.some(id=>!scene.rooms.some(r=>r.id===id)))return {valid:false,errors:['Unsupported tour fields, source or room stops.']}
  if(tour.shots.length>100||tour.shots.some(s=>!s||typeof s!=='object'))return {valid:false,errors:['The tour has invalid shots or exceeds 100 shots.']}
  if(isTourStale(scene,tour))errors.push('The tour belongs to an older building revision. Regenerate its routes.')
  if(!Number.isFinite(tour.duration)||tour.duration<=0||tour.duration>600)errors.push('Invalid tour duration.')
  let expected=0,totalPathLength=0,totalPoints=0;const ids=new Set()
  for(const shot of tour.shots) {
    if(!exact(shot,['id','kind','roomId','path','target','duration','startTime','fov','transition'])||!identifier(shot.id)||ids.has(shot.id))errors.push('Unsupported fields or duplicate/missing shot identifier.');ids.add(shot.id)
    if(!Number.isFinite(shot.duration)||shot.duration<=0||!Number.isFinite(shot.startTime)||Math.abs(shot.startTime-expected)>.001)errors.push(`Invalid timing for ${shot.id}.`)
    expected+=shot.duration
    if(shot.roomId&&!scene.rooms.some(r=>r.id===shot.roomId))errors.push(`Unknown room in ${shot.id}.`)
    if(!['walk','hold','orbit'].includes(shot.kind)||!['continuous','fade','cut'].includes(shot.transition))errors.push(`Unsupported shot ${shot.id}.`)
    const validPoint=p=>Array.isArray(p)&&p.length===3&&p.every(n=>Number.isFinite(n)&&Math.abs(n)<=100000)
    if(!Array.isArray(shot.path)||!shot.path.length||shot.path.length>2000||!shot.path.every(validPoint)||!validPoint(shot.target)){errors.push(`Invalid camera coordinates in ${shot.id}.`);continue}
    totalPoints+=shot.path.length;totalPathLength+=shot.path.reduce((sum,p,i)=>sum+(i?dist(p,shot.path[i-1]):0),0)
    if(totalPoints>4000||totalPathLength>300000)return {valid:false,errors:['The tour exceeds supported path limits.']}
    if(!Number.isFinite(shot.fov)||shot.fov<25||shot.fov>100)errors.push(`Unsupported lens in ${shot.id}.`)
    if(shot.kind==='walk'||shot.kind==='hold') {
      if(shot.path.some(p=>p[2]<1400||p[2]>1900)||!isPathClear(scene,shot.path.map(p=>p.slice(0,2))))errors.push(`Camera path hits an obstacle in ${shot.id}.`)
    } else if(shot.path.some(p=>p[2]<Math.max(...scene.walls.map(w=>w.height))+2000))errors.push(`Aerial camera clearance is too low in ${shot.id}.`)
  }
  if(Math.abs(expected-tour.duration)>.001)errors.push('Shot timing does not match the tour duration.')
  for(let i=1;i<tour.shots.length;i++) {
    const prev=tour.shots[i-1],shot=tour.shots[i]
    if(shot.transition==='continuous'&&Array.isArray(prev.path?.at(-1))&&Array.isArray(shot.path?.[0])&&dist(prev.path.at(-1),shot.path[0])>2)errors.push(`A discontinuous move in ${shot.id} needs an explicit cut or fade.`)
  }
  return {valid:errors.length===0,errors}
}

export function parseTourIntent(text,scene) {
  if(typeof text!=='string'||text.trim().length<3||text.length>1200)throw new Error('Describe a tour in 3–1,200 characters.')
  const input=text.toLowerCase(),aliases={living:['living','lounge'],kitchen:['kitchen','dining'],bathroom:['bathroom','bath'],hallway:['gallery','hallway'],'main-bedroom':['main bedroom','master bedroom'],'bedroom-two':['bedroom two','second bedroom','guest bedroom'],study:['study','office'],garden:['garden','courtyard','terrace']}
  const matches=[]
  for(const room of scene.rooms)for(const alias of aliases[room.id]||[room.name.toLowerCase()]) {
    let at=input.indexOf(alias)
    while(at>=0){matches.push({id:room.id,at});at=input.indexOf(alias,at+alias.length)}
  }
  matches.sort((a,b)=>a.at-b.at)
  const roomIds=matches.map(m=>m.id).filter((id,i,all)=>i===0||id!==all[i-1]),time=input.match(/\b(\d{1,3})\s*(?:seconds?|secs?|s)\b/),warnings=[]
  if(!roomIds.length)warnings.push('No named rooms matched; using the standard route.')
  const duration=time?Number(time[1]):30
  if(duration<8||duration>300)throw new Error('Choose a duration between 8 and 300 seconds.')
  if(/\b(pool|upstairs|rooftop|basement)\b/.test(input))warnings.push('This demonstration has no pool, upper floor, roof access or basement.')
  return {roomIds:roomIds.length?roomIds:defaultTourRoomIds(scene),duration,includeExterior:!input.includes('skip exterior'),source:'local',warnings}
}
