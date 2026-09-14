import test from 'node:test'
import assert from 'node:assert/strict'
import {createDemoBuilding,validateBuilding,buildPrimitives,toBrowser,fromBrowser,roomArea,resizeBuilding} from '../src/spatial/model.js'
import {isWalkable,isSegmentClear,isPathClear,findPath,getRoomAnchor,resolveCollision,validateConnectivity,smoothPath} from '../src/spatial/navigation.js'
import {generateTour,sampleTour,validateTour,retimeTour,isTourStale,parseTourIntent} from '../src/spatial/tours.js'

test('demo has deterministic geometry, exact transforms and shared floor dimensions',()=>{
  const model=createDemoBuilding()
  assert.deepEqual(model,createDemoBuilding())
  assert.deepEqual(validateBuilding(model),{valid:true,errors:[]})
  assert.deepEqual(fromBrowser(toBrowser([1234,-5600,1650])),[1234,-5600,1650])
  assert.deepEqual(toBrowser([1000,2000,3000]),[1,3,-2])
  assert.equal(roomArea(model.rooms.find(r=>r.id==='living')),20)
  const primitives=buildPrimitives(model)
  assert.ok(primitives.length>250)
  assert.equal(new Set(primitives.map(p=>p.id)).size,primitives.length)
  assert.ok(primitives.every(p=>p.position.every(Number.isFinite)&&p.size.every(n=>Number.isFinite(n)&&n>0)))
  assert.deepEqual(primitives.find(p=>p.id==='living-floor').size,[5000,4000,140])
  assert.ok(primitives.some(p=>p.id==='entrance-frame-top'))
  assert.ok(!primitives.some(p=>p.id==='entrance-leaf'))
  assert.ok(primitives.some(p=>p.id==='living-window-glass'&&p.material==='glass'))
})

test('building validation rejects invalid topology, overlapping openings and bad references',()=>{
  const overlap=createDemoBuilding();overlap.rooms[1].polygon=structuredClone(overlap.rooms[0].polygon)
  assert.match(validateBuilding(overlap).errors.join(' '),/overlap/)
  const bow=createDemoBuilding();bow.rooms[0].polygon=[[0,0],[5000,4000],[5000,0],[0,4000]]
  assert.match(validateBuilding(bow).errors.join(' '),/Self-intersecting/)
  const opening=createDemoBuilding();opening.walls[0].openings[1].offset=500
  assert.match(validateBuilding(opening).errors.join(' '),/opening/)
  const reference=createDemoBuilding();reference.furniture[0].roomId='absent'
  assert.equal(validateBuilding(reference).valid,false)
  const malformed=createDemoBuilding();malformed.walls[0].openings=[null]
  assert.equal(validateBuilding(malformed).valid,false)
  const units=createDemoBuilding();units.units='metres'
  assert.equal(validateBuilding(units).valid,false)
})

test('open doors are traversable while walls, windows, closed doors and furniture block',()=>{
  const model=createDemoBuilding()
  assert.equal(isWalkable(model,[2550,0]),true)
  assert.equal(isWalkable(model,[1000,0]),false)
  assert.equal(isWalkable(model,[2100,2100]),false)
  assert.equal(isWalkable(model,[-5000,2000]),false)
  assert.equal(isSegmentClear(model,[2550,-500],[2550,500]),true)
  const closed=createDemoBuilding();closed.walls[0].openings.find(o=>o.id==='entrance').open=false
  assert.equal(isWalkable(closed,[2550,0]),false)
  assert.equal(findPath(closed,getRoomAnchor(closed,'garden'),getRoomAnchor(closed,'living')).length,0)
})

test('every demo room connects through physical passages and smoothed paths retain clearance',()=>{
  const model=createDemoBuilding()
  assert.deepEqual(validateConnectivity(model),{valid:true,errors:[]})
  const garden=getRoomAnchor(model,'garden')
  for(const room of model.rooms) {
    const target=getRoomAnchor(model,room.id),route=findPath(model,garden,target)
    assert.ok(route.length,`No route to ${room.name}`)
    assert.ok(isPathClear(model,route),`Clipping route to ${room.name}`)
    assert.deepEqual(route[0],garden)
    assert.deepEqual(route.at(-1),target)
    assert.ok(isPathClear(model,smoothPath(model,route)))
  }
})

test('swept walking prevents tunnelling and constrains eye height to the supported floor',()=>{
  const model=createDemoBuilding(),start=[4400,3600,1650]
  assert.equal(isWalkable(model,start),true)
  const result=resolveCollision(model,start,[5600,3600,1650])
  assert.ok(result[0]<5000)
  assert.ok(isWalkable(model,result))
  assert.ok(isSegmentClear(model,start,result))
  assert.equal(resolveCollision(model,start,[4400,3600,-1000])[2],1400)
  assert.equal(resolveCollision(model,start,[4400,3600,20000])[2],1900)
})

test('plan resize is immutable, updates walls/floors and marks previous camera routes stale',()=>{
  const original=createDemoBuilding(),tour=generateTour(original),edited=resizeBuilding(original,{width:15000,depth:12000})
  assert.equal(original.revision,1);assert.equal(edited.revision,2)
  assert.equal(original.walls[0].end[0],12000);assert.equal(edited.walls[0].end[0],15000)
  assert.equal(roomArea(edited.rooms[0]),30)
  assert.equal(buildPrimitives(edited).find(p=>p.id==='living-floor').size[0],6250)
  assert.equal(isTourStale(edited,tour),true)
  assert.equal(validateTour(edited,tour).valid,false)
  assert.equal(validateTour(edited,generateTour(edited)).valid,true)
  assert.throws(()=>resizeBuilding(original,{width:5000}),/dimensions/)
  for(const [width,depth] of [[11000,9500],[11000,15000],[18000,9500],[18000,15000]])assert.ok(validateTour(resizeBuilding(original,{width,depth}),generateTour(resizeBuilding(original,{width,depth}))).valid)
})

test('tour samples stay on validated walking routes and explicit fades separate aerial shots',()=>{
  const model=createDemoBuilding(),tour=generateTour(model,{roomIds:['living','kitchen','main-bedroom','garden'],duration:24})
  assert.equal(validateTour(model,tour).valid,true)
  assert.equal(tour.duration,24)
  assert.equal(tour.shots[1].transition,'fade')
  for(let t=0;t<=tour.duration;t+=.05){const sample=sampleTour(tour,t),shot=tour.shots.find(s=>s.id===sample.shotId);assert.ok(sample.position.every(Number.isFinite)&&sample.target.every(Number.isFinite));if(shot.kind!=='orbit')assert.ok(isWalkable(model,sample.position),`Collision at ${t}`)}
  const last=sampleTour(tour,1000)
  assert.deepEqual(last.position,tour.shots.at(-1).path.at(-1))
  const retimed=retimeTour(tour,tour.shots[2].id,4)
  assert.equal(validateTour(model,retimed).valid,true)
  assert.equal(retimed.shots[2].duration,4)
  assert.notEqual(retimed.duration,tour.duration)
})

test('tour validation rejects fabricated rooms, collision paths, invalid coordinates and teleporting walks',()=>{
  const model=createDemoBuilding(),tour=generateTour(model,{roomIds:['living','kitchen'],includeExterior:false})
  const badRoom=structuredClone(tour);badRoom.shots[0].roomId='pool'
  assert.match(validateTour(model,badRoom).errors.join(' '),/Unknown room/)
  const blocked=structuredClone(tour);blocked.shots[0].path=[[2100,2100,1650]]
  assert.match(validateTour(model,blocked).errors.join(' '),/obstacle/)
  const invalid=structuredClone(tour);invalid.shots[0].path=[null]
  assert.equal(validateTour(model,invalid).valid,false)
  const jump=structuredClone(tour);jump.shots[1].path=[[2550,500,1650]]
  assert.match(validateTour(model,jump).errors.join(' '),/discontinuous/)
  assert.throws(()=>generateTour(model,{roomIds:['not-a-room']}),/Unknown/)
})

test('local instruction parsing is labelled honestly and preserves a return to the garden',()=>{
  const model=createDemoBuilding(),intent=parseTourIntent('Start in the garden, visit the living room, kitchen, main bedroom, finish in the garden in 30 seconds.',model)
  assert.equal(intent.source,'local')
  assert.deepEqual(intent.roomIds,['garden','living','kitchen','main-bedroom','garden'])
  assert.equal(intent.duration,30)
  assert.equal(validateTour(model,generateTour(model,intent)).valid,true)
  assert.ok(parseTourIntent('Visit the pool then upstairs',model).warnings.length)
  assert.throws(()=>parseTourIntent('Show kitchen in 999 seconds',model),/duration/)
})

test('closed exterior entrances fail connectivity even when every interior room connects',()=>{
  const model=createDemoBuilding()
  model.walls[0].openings.find(opening=>opening.id==='entrance').open=false
  assert.equal(validateBuilding(model).valid,true)
  const connectivity=validateConnectivity(model)
  assert.equal(connectivity.valid,false)
  assert.match(connectivity.errors.join(' '),/Garden terrace/)
})

test('renamed room IDs generate tours and viewpoints from actual scene rooms',()=>{
  const model=createDemoBuilding(),mapping=new Map(model.rooms.map((room,i)=>[room.id,`custom-space-${i+1}`]))
  model.rooms.forEach(room=>{room.id=mapping.get(room.id)})
  model.walls.forEach(wall=>{wall.roomIds=wall.roomIds.map(id=>mapping.get(id))})
  model.furniture.forEach(item=>{item.roomId=mapping.get(item.roomId)})
  assert.equal(validateBuilding(model).valid,true)
  assert.equal(validateConnectivity(model).valid,true)
  const tour=generateTour(model)
  assert.equal(validateTour(model,tour).valid,true)
  assert.deepEqual(tour.roomIds,model.rooms.map(room=>room.id))
  assert.equal(tour.shots[1].roomId,mapping.get('garden'))
  assert.ok(buildPrimitives(model).every(primitive=>primitive.roomId===null||model.rooms.some(room=>room.id===primitive.roomId)))
  const fallback=parseTourIntent('Show the house in 30 seconds',model)
  assert.ok(fallback.roomIds.every(id=>model.rooms.some(room=>room.id===id)))
})

test('a model without an exterior room fades from the aerial shot into a valid room',()=>{
  const model=createDemoBuilding()
  model.rooms=model.rooms.filter(room=>!room.exterior)
  model.furniture=model.furniture.filter(item=>item.roomId!=='garden')
  model.walls.forEach(wall=>{wall.roomIds=wall.roomIds.filter(id=>id!=='garden')})
  model.bounds.min[1]=0
  assert.equal(validateBuilding(model).valid,true)
  assert.equal(validateConnectivity(model).valid,true)
  const tour=generateTour(model)
  assert.equal(validateTour(model,tour).valid,true)
  assert.equal(tour.shots[0].kind,'orbit')
  assert.equal(tour.shots[1].roomId,'living')
  assert.equal(tour.shots[1].transition,'fade')
  assert.ok(!tour.roomIds.includes('garden'))
  assert.ok(buildPrimitives(model).every(primitive=>primitive.roomId===null||model.rooms.some(room=>room.id===primitive.roomId)))
  assert.ok(sampleTour(tour,tour.shots[1].startTime).position.every(Number.isFinite))
})
