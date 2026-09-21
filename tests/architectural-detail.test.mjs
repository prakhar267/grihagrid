import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoBuilding, createMultiFloorDemo, validateBuilding, buildPrimitives, toV2 } from '../src/spatial/model.js'
import { furnishRooms, furniturePolygon } from '../src/spatial/furnish-rooms.js'
import { furnitureSizes } from '../src/spatial/furniture-catalog.js'
import { polygonFitsInside } from '../src/spatial/model-v2.js'
import { defaultHouseBrief } from '../src/spatial/house-brief.js'
import { generateBriefLayout } from '../src/spatial/brief-layout.js'
import { validateConnectivity } from '../src/spatial/navigation.js'
import { defaultTourRoomIds, generateTour, validateTour } from '../src/spatial/tours.js'
import { roomViewV2 } from '../src/spatial/tours-v2.js'
import { isWalkableV2 } from '../src/spatial/navigation-v2.js'
import { floorPlanSheet, openingSchedule, openingScheduleSheets, elevationSheet, stairSectionSheet, dimensionLabel, drawingSetHTML } from '../src/spatial/drawing-set.js'

test('furnishing preserves existing geometry and objects, is deterministic and idempotent',()=>{
  const original=toV2(createDemoBuilding()),copy=structuredClone(original),a=furnishRooms(original),b=furnishRooms(original)
  assert.deepEqual(original,copy);assert.deepEqual(a,b)
  assert.deepEqual(a.model.walls,original.walls);assert.deepEqual(a.model.rooms,original.rooms)
  for(const f of original.furniture)assert.deepEqual(a.model.furniture.find(item=>item.id===f.id),f)
  assert.equal(validateBuilding(a.model).valid,true)
  assert.equal(furnishRooms(a.model).added.length,0)
  for(const id of a.added){const f=a.model.furniture.find(f=>f.id===id);assert.ok(polygonFitsInside(furniturePolygon(f),a.model.rooms.find(r=>r.id===f.roomId).polygon))}
})
test('floor furnishing affects only the requested floor and reports unplaceable items',()=>{
  const model=createMultiFloorDemo(),floor=model.floors[1].id,result=furnishRooms(model,{floorId:floor})
  assert.ok(result.added.every(id=>result.model.furniture.find(f=>f.id===id).floorId===floor))
  const small=toV2(createDemoBuilding());small.rooms[0].name='Kitchen';small.rooms[0].polygon=[[0,0],[1000,0],[1000,1000],[0,1000]]
  assert.ok(furnishRooms(small,{roomId:small.rooms[0].id}).skipped.length>0)
})
for(const city of ['Jaipur','Delhi'])test(`${city} G+2 detailed generation stays walkable and tours all floors`,()=>{
  const brief=defaultHouseBrief({floors:'G+2'});brief.city=city;brief.widthM=15;brief.depthM=24;brief.setbacks={front:2,back:2,left:1,right:1}
  const {model}=generateBriefLayout(brief)
  assert.ok(model.furniture.length>brief.rooms.length)
  assert.deepEqual(validateBuilding(model),{valid:true,errors:[]});assert.deepEqual(validateConnectivity(model),{valid:true,errors:[]})
  const tour=generateTour(model,{roomIds:defaultTourRoomIds(model),duration:45});assert.equal(validateTour(model,tour).valid,true)
  assert.equal(new Set(tour.shots.filter(s=>s.floorId).map(s=>s.floorId)).size,3)
  assert.ok(JSON.stringify(model).length<47000);assert.ok(buildPrimitives(model).length<5000)
})
for(const kind of ['kitchen-counter','washbasin','shower','refrigerator','washing-machine','puja-unit'])test(`${kind} survives strict validation and becomes shared 3D geometry`,()=>{
  const model=toV2(createDemoBuilding()),room=model.rooms.find(r=>r.id==='living');model.furniture=[{id:'fixture',roomId:room.id,floorId:room.floorId,kind,position:[2500,2500,0],size:furnitureSizes[kind],rotation:0,color:'#aabbaa'}]
  assert.equal(validateBuilding(model).valid,true)
  const parts=buildPrimitives(model).filter(p=>p.id.startsWith('fixture-'))
  assert.ok(parts.length>=3);assert.ok(parts.every(p=>p.floorId===room.floorId&&p.roomId===room.id&&p.size.every(n=>n>0)))
  model.furniture[0].kind='unverified-fixture';assert.equal(validateBuilding(model).valid,false)
})
test('measured drawings derive dimensions, levels and opening tags from the actual model',()=>{
  const model=createMultiFloorDemo(),rows=openingSchedule(model),floor=model.floors[1],sheet=floorPlanSheet(model,floor.id,{unit:'mm',northDegrees:90})
  assert.equal(rows.length,model.walls.reduce((n,w)=>n+w.openings.length,0));assert.equal(new Set(rows.map(r=>r.tag)).size,rows.length)
  for(const o of rows.filter(o=>o.floorId===floor.id)){assert.ok(sheet.includes(o.tag));assert.ok(sheet.includes(`${o.width} × ${o.height}`))}
  assert.ok(sheet.includes(`+${(floor.elevation/1000).toFixed(3)} m`));assert.ok(sheet.includes('N 90°'))
  assert.ok(elevationSheet(model).includes('FOUR MODEL ELEVATIONS'));assert.ok(stairSectionSheet(model).includes('18 risers'))
  const wall=model.walls.find(w=>w.openings.length),updated=structuredClone(model);updated.walls.find(w=>w.id===wall.id).openings[0].width=777
  assert.equal(openingSchedule(updated).find(o=>o.wallId===wall.id).width,777)
})
test('drawing export escapes names and paginates all openings without losing rows',()=>{
  const model=createMultiFloorDemo();model.name='<script>alert(1)</script>';model.rooms[0].name='" onload="alert(1)'
  const html=drawingSetHTML(model)
  assert.equal(html.includes('<script>'),false);assert.ok(html.includes('&lt;script&gt;'));assert.ok(html.includes('@page{size:A3 landscape'))
  for(const floor of model.floors)assert.ok(html.includes(`${floor.name} plan`))
  const schedules=openingScheduleSheets(model).join('');for(const o of openingSchedule(model))assert.ok(schedules.includes(o.tag))
})
test('dimension display handles metric and imperial rounding consistently',()=>{
  assert.equal(dimensionLabel(3048,'ft'),'10′ 0″');assert.equal(dimensionLabel(3048,'m'),'3.05 m');assert.equal(dimensionLabel(3048),'3048')
})
test('kitchen fittings follow the long axis of either counter orientation',()=>{
  for(const size of [[2400,600,900],[600,2400,900]]) {
    const model=toV2(createDemoBuilding()),room=model.rooms.find(r=>r.id==='living')
    model.furniture=[{id:'long-counter',roomId:room.id,floorId:room.floorId,kind:'kitchen-counter',position:[2500,2500,0],size,rotation:0,color:'#aabbaa'}]
    const fittings=buildPrimitives(model).filter(p=>/^long-counter-(hob|sink|tap|spout)/.test(p.id))
    assert.ok(fittings.length>=8)
    for(const p of fittings)for(const axis of [0,1])assert.ok(Math.abs(p.position[axis]-2500)+p.size[axis]/2<=size[axis]/2+1)
  }
})
test('furnished room cameras frame the room from a clear position on its own floor',()=>{
  const model=furnishRooms(createMultiFloorDemo()).model
  for(const room of model.rooms.filter(r=>model.furniture.some(f=>f.roomId===r.id))){const view=roomViewV2(model,room.id);assert.equal(view.fov,72);assert.equal(view.floorId,room.floorId);assert.ok(isWalkableV2(model,view.position,220,1650));assert.ok(Math.hypot(view.target[0]-view.position[0],view.target[1]-view.position[1])>500)}
})
