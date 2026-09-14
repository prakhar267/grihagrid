import test from 'node:test'
import assert from 'node:assert/strict'
import {createDemoBuilding,createMultiFloorDemo,toV2,validateBuilding,buildPrimitives,floorApertures,resizeBuilding} from '../src/spatial/model.js'
import {polygonArea,insidePolygon,polygonFitsInside,recalculateBounds} from '../src/spatial/model-v2.js'
import {validateConnectivity,findRoute,isRouteClear,isWalkable,resolveCollision,floorAtPosition,getSurfaceHeight} from '../src/spatial/navigation.js'
import {generateTour,validateTour,sampleTour,isTourStale,getShotStatuses,parseTourIntent,retimeTour} from '../src/spatial/tours.js'
import {applySceneEdit} from '../src/spatial/editor-ops.js'

function topArea(mesh){let area=0;for(let i=0;i<mesh.indices.length;i+=3){const p=mesh.indices.slice(i,i+3).map(j=>mesh.vertices[j]);if(p.every(v=>Math.abs(v[2]-mesh.size[2]/2)<.001))area+=Math.abs((p[1][0]-p[0][0])*(p[2][1]-p[0][1])-(p[1][1]-p[0][1])*(p[2][0]-p[0][0]))/2}return area}

test('version 1 scenes upgrade without lost IDs, and polygon slabs preserve an L-shaped room',()=>{
  const legacy=createDemoBuilding(),upgraded=toV2(legacy)
  assert.equal(validateBuilding(upgraded).valid,true)
  assert.deepEqual(upgraded.rooms.map(r=>r.id),legacy.rooms.map(r=>r.id))
  const scene=createMultiFloorDemo();scene.floors=scene.floors.slice(0,1);scene.rooms=scene.rooms.slice(0,1);scene.rooms[0].polygon=[[0,0],[6000,0],[6000,2000],[2000,2000],[2000,6000],[0,6000]];scene.walls=[];scene.furniture=[];scene.stairs=[];recalculateBounds(scene)
  assert.equal(validateBuilding(scene).valid,true)
  const floor=buildPrimitives(scene).find(p=>p.id==='ground-gallery-floor')
  assert.equal(floor.kind,'mesh');assert.equal(topArea(floor),20_000_000)
  assert.equal(isWalkable(scene,[4000,4000,1650]),false)
  const path=findRoute(scene,[4000,1000,1650],[1000,4000,1650]);assert.ok(path.length>2);assert.ok(isRouteClear(scene,path));assert.ok(path.every(p=>insidePolygon(p,scene.rooms[0].polygon)))
  scene.rooms[0].polygon=[[0,0],[6000,6000],[6000,0],[0,6000]];assert.equal(validateBuilding(scene).valid,false)
})

test('upper floors and lower ceilings contain real triangulated stair apertures',()=>{
  const scene=createMultiFloorDemo(),primitives=buildPrimitives(scene),room=scene.rooms[1],hole=floorApertures(scene,'upper')[0].polygon
  assert.equal(validateBuilding(scene).valid,true)
  const floor=primitives.find(p=>p.id==='upper-gallery-floor'),ceiling=primitives.find(p=>p.id==='ground-gallery-ceiling')
  assert.equal(topArea(floor),polygonArea(room.polygon)-polygonArea(hole))
  assert.equal(topArea(ceiling),topArea(floor))
  assert.equal(floor.position[2]+floor.size[2]/2,3200)
  const steps=primitives.filter(p=>p.stairId==='gallery-stair'&&p.kind==='box')
  assert.equal(steps.length,18);assert.equal(steps.at(-1).position[2]+steps.at(-1).size[2]/2,3200)
  assert.ok(primitives.every(p=>p.floorId&&p.position.every(Number.isFinite)))
})

test('version 2 overall resizing moves stairs and preserves elevations and all exterior bounds',()=>{
  const original=createMultiFloorDemo(),scene=resizeBuilding(original,{width:15000,depth:10000})
  assert.equal(scene.revision,original.revision+1);assert.equal(scene.bounds.max[2],6200)
  assert.deepEqual(scene.stairs[0].start,[10000,2000]);assert.equal(scene.stairs[0].width,1750)
  assert.equal(scene.floors[1].elevation,3200);assert.equal(original.stairs[0].start[0],8000)
  assert.equal(validateBuilding(scene).valid,true);assert.equal(validateConnectivity(scene).valid,true)
  const garden=resizeBuilding(toV2(createDemoBuilding()),{width:15000,depth:16800})
  assert.equal(garden.bounds.max[1]-garden.bounds.min[1],16800)
  assert.equal(garden.rooms.find(r=>r.id==='garden').polygon[0][1],-4000)
  assert.equal(validateConnectivity(garden).valid,true)
  const padded=structuredClone(original);padded.bounds.max[0]=14000
  const measured=resizeBuilding(padded,{width:15000});assert.equal(measured.bounds.max[0]-measured.bounds.min[0],15000)
  const truncated=structuredClone(scene);truncated.bounds.max[2]=3000
  assert.equal(validateBuilding(truncated).valid,false)
})

test('walking climbs and descends stairs with actual floor support and no floor teleportation',()=>{
  const scene=createMultiFloorDemo(),start=[8000,1400,1650],finish=[8000,8000,4850]
  assert.equal(validateConnectivity(scene).valid,true)
  const route=findRoute(scene,[6000,4500,1650],[6000,4500,4850])
  assert.ok(route.length>20);assert.ok(isRouteClear(scene,route));assert.ok(route.some(p=>p[2]>2000&&p[2]<4500))
  let position=start
  for(let i=0;i<110;i++)position=resolveCollision(scene,position,[position[0],position[1]+60,position[2]])
  assert.deepEqual(position,finish);assert.equal(floorAtPosition(scene,position).id,'upper');assert.equal(getSurfaceHeight(scene,position),3200)
  for(let i=0;i<110;i++)position=resolveCollision(scene,position,[position[0],position[1]-60,position[2]])
  assert.ok(Math.abs(position[2]-1650)<.001);assert.equal(floorAtPosition(scene,position).id,'ground')
  const noStairs=structuredClone(scene);noStairs.stairs=[]
  assert.equal(findRoute(noStairs,[6000,4500,1650],[6000,4500,4850]).length,0)
  assert.equal(validateConnectivity(noStairs).valid,false)
  const blocked=resolveCollision(scene,[6000,4500,4850],[8000,4500,4850]);assert.ok(blocked[0]<7300)
  const upstairsEmpty=structuredClone(scene);upstairsEmpty.furniture=upstairsEmpty.furniture.filter(f=>f.floorId==='ground')
  assert.equal(isWalkable(upstairsEmpty,[3000,7000,1650]),false);assert.equal(isWalkable(upstairsEmpty,[3000,7000,4850]),true)
})

test('editor operations update shared geometry atomically and reject broken openings or stairs',()=>{
  const initial=createDemoBuilding(),moved=applySceneEdit(initial,{type:'moveVertex',roomId:'living',index:0,point:[100,100]})
  assert.deepEqual(initial.rooms[0].polygon[0],[0,0]);assert.equal(moved.schemaVersion,2);assert.equal(moved.revision,2)
  assert.ok(moved.rooms.find(r=>r.id==='garden').polygon.some(p=>p[0]===100&&p[1]===100))
  assert.ok(moved.walls.some(w=>w.start[0]===100&&w.start[1]===100));assert.equal(validateBuilding(moved).valid,true)
  const furnished=applySceneEdit(moved,{type:'upsertFurniture',furniture:{...moved.furniture.find(f=>f.id==='living-table'),position:[2200,2100,0]}})
  assert.equal(furnished.revision,3);assert.throws(()=>applySceneEdit(furnished,{type:'upsertOpening',wallId:'south',opening:{id:'bad-door',kind:'door',offset:99999,width:1000,sill:0,height:2300,open:true}}),/opening/)
  assert.throws(()=>applySceneEdit(createMultiFloorDemo(),{type:'upsertStair',stair:{id:'gallery-stair',width:500}}),/stair/i)
  assert.throws(()=>applySceneEdit(createMultiFloorDemo(),{type:'removeFloor',floorId:'upper'}),/Remove rooms/)
  const single=toV2(initial);single.rooms=single.rooms.filter(r=>r.id==='living');single.furniture=single.furniture.filter(f=>f.roomId==='living');single.walls=[];single.stairs=[];recalculateBounds(single)
  const replaced=applySceneEdit(single,{type:'replaceRoomPolygon',roomId:'living',polygon:[[0,0],[6000,0],[6000,4000],[0,4000]]})
  assert.equal(replaced.walls.length,4)
  const inserted=applySceneEdit(replaced,{type:'insertVertex',roomId:'living',index:0,point:[3000,0]});assert.equal(inserted.rooms[0].polygon.length,5)
  const removed=applySceneEdit(inserted,{type:'removeVertex',roomId:'living',index:1});assert.equal(removed.rooms[0].polygon.length,4)
})

test('multi-floor subject tours use validated routes, configurable eye height and per-shot signatures',()=>{
  const scene=createMultiFloorDemo(),tour=generateTour(scene,{roomIds:['ground-gallery','upper-gallery'],eyeHeight:1700,duration:40,shotPreferences:[{roomId:'upper-gallery',subjectId:'reading-desk',kind:'reveal',pace:'slow',duration:5}]})
  assert.equal(tour.schemaVersion,2);assert.equal(tour.eyeHeight,1700);assert.equal(validateTour(scene,tour).valid,true)
  assert.equal(tour.shots.find(s=>s.kind==='reveal').duration,5)
  const walk=tour.shots.find(s=>s.kind==='walk');assert.ok(walk.path.some(p=>p[2]>2000&&p[2]<4500))
  for(let t=0;t<=tour.duration;t+=.1){const p=sampleTour(tour,t);assert.ok(p.position.every(Number.isFinite));assert.ok(p.target.every(Number.isFinite))}
  assert.equal(validateTour(scene,retimeTour(tour,tour.shots.at(-1).id,6)).valid,true)
  const changed=structuredClone(scene);changed.furniture.find(f=>f.id==='reading-desk').position[0]+=100
  assert.equal(changed.revision,scene.revision);assert.equal(isTourStale(changed,tour),true)
  const statuses=getShotStatuses(changed,tour);assert.ok(statuses.some(s=>s.stale));assert.ok(statuses.some(s=>!s.stale))
  assert.equal(validateTour(changed,tour).valid,false)
  assert.throws(()=>generateTour(scene,{shotPreferences:[{roomId:'upper-gallery',subjectId:'missing',kind:'orbit',pace:'normal'}]}),/unavailable/)
  const bad=structuredClone(tour);bad.shotPreferences[0].script='execute code';assert.equal(validateTour(scene,bad).valid,false)
})

test('local directing resolves subjects, shot styles, pacing and fixed dwell time honestly',()=>{
  const scene=createDemoBuilding(),intent=parseTourIntent('Slowly reveal the kitchen island, orbit the dining table, linger in the main bedroom for 5 seconds, in 30 seconds.',scene)
  assert.equal(intent.source,'local');assert.deepEqual(intent.roomIds,['kitchen','garden','main-bedroom'])
  assert.deepEqual(intent.shotPreferences.map(p=>[p.kind,p.pace]),[['reveal','slow'],['orbit','normal'],['hold','normal']])
  assert.equal(intent.shotPreferences[0].subjectId,'kitchen-island');assert.equal(intent.shotPreferences[1].subjectId,'garden-table');assert.equal(intent.shotPreferences[2].duration,5)
  const tour=generateTour(scene,intent);assert.equal(validateTour(scene,tour).valid,true)
  assert.ok(tour.shots.some(s=>s.kind==='orbit'&&s.subjectId==='garden-table'))
  const advertised=parseTourIntent('Slowly reveal the kitchen island, orbit the dining table, then linger in the main bedroom for a 40 second tour.',scene)
  assert.equal(advertised.duration,40);assert.equal(advertised.shotPreferences.at(-1).duration,undefined)
  assert.equal(generateTour(scene,advertised).duration,40)
  assert.equal(parseTourIntent('Visit upstairs at eye height 1.7m in 40 seconds',createMultiFloorDemo()).eyeHeight,1700)
})


test('whole footprints stay inside concave rooms and stair apertures cannot overlap',()=>{
  const polygon=[[0,0],[6000,0],[6000,6000],[4000,6000],[4000,2000],[2000,2000],[2000,6000],[0,6000]]
  const footprint=[[1000,3000],[5000,3000],[5000,5000],[1000,5000]]
  assert.ok(footprint.every(p=>insidePolygon(p,polygon)))
  assert.equal(polygonFitsInside(footprint,polygon),false)
  assert.equal(polygonFitsInside([[500,500],[5500,500],[5500,1500],[500,1500]],polygon),true)
  const scene=createMultiFloorDemo();scene.floors=scene.floors.slice(0,1);scene.rooms=scene.rooms.slice(0,1);scene.rooms[0].polygon=polygon;scene.walls=[];scene.stairs=[]
  scene.furniture=[{id:'notch-table',roomId:scene.rooms[0].id,floorId:scene.floors[0].id,kind:'table',position:[3000,4000,0],size:[4000,2000,700],rotation:0,color:'#a78a63'}];recalculateBounds(scene)
  assert.match(validateBuilding(scene).errors.join(' '),/crosses its room boundary/)
  const overlapping=createMultiFloorDemo();overlapping.stairs.push({...overlapping.stairs[0],id:'second-stair'})
  assert.match(validateBuilding(overlapping).errors.join(' '),/Stair apertures overlap/)
  const blocking=createMultiFloorDemo();blocking.furniture.push({id:'shaft-side-table',roomId:'ground-gallery',floorId:'ground',kind:'table',position:[7200,4000,0],size:[800,700,700],rotation:0,color:'#a78a63'})
  assert.match(validateBuilding(blocking).errors.join(' '),/blocks stair/)
})

test('rich tours from legacy scenes normalize provenance before checking staleness',()=>{
  const scene=createDemoBuilding(),intent=parseTourIntent('Slowly reveal the kitchen island, orbit the dining table, then linger in the main bedroom for a 40 second tour.',scene),tour=generateTour(scene,intent)
  assert.equal(tour.schemaVersion,2);assert.equal(isTourStale(scene,tour),false)
  assert.ok(getShotStatuses(scene,tour).every(shot=>!shot.stale))
  const changed=structuredClone(scene);changed.furniture[0].position[0]+=100
  assert.equal(changed.revision,scene.revision);assert.equal(isTourStale(changed,tour),true)
})
