import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoBuilding, createMultiFloorDemo, validateBuilding } from '../src/spatial/model.js'
import { toV2, insidePolygon } from '../src/spatial/model-v2.js'
import { applySceneEdit } from '../src/spatial/editor-ops.js'
import { nextFloor, populateFloor, connectFloorBelow } from '../src/spatial/floor-plans.js'
import { defaultTourRoomIds, generateTour, getRoomView, sampleTour, validateTour, parseTourIntent } from '../src/spatial/tours.js'
import { validateConnectivity, isWalkable, resolveCollision } from '../src/spatial/navigation.js'
import { cameraFloor, roomOnFloor, roomLabel } from '../src/spatial/workspace-navigation.js'
import { defaultHouseBrief } from '../src/spatial/house-brief.js'
import { generateBriefLayout } from '../src/spatial/brief-layout.js'
import { PerspectiveCamera, Vector3 } from 'three'

function addFloor(scene, layout = 'open') {
  const floor = nextFloor(scene)
  const next = applySceneEdit(scene, { type: 'addFloor', floor })
  return { floor, model: layout ? populateFloor(next, floor.id, { layout }) : next }
}

test('empty or newly populated upper floors never select a room on the ground floor', () => {
  const {floor,model}=addFloor(toV2(createDemoBuilding()),null)
  assert.equal(roomOnFloor(model,floor.id,'living'),null)
  const populated=populateFloor(model,floor.id,{layout:'bedrooms'})
  const selected=roomOnFloor(populated,floor.id,'living')
  assert.equal(selected.floorId,floor.id)
  assert.equal(roomOnFloor(populated,floor.id,selected.id).id,selected.id)
  assert.equal(cameraFloor(populated,getRoomView(populated,selected.id).position),floor.id)
})

test('unfurnished rooms face into the room and allow forward walking at the right elevation', () => {
  for(const layout of ['open','bedrooms','family']) {
    const {floor,model}=addFloor(createMultiFloorDemo(),layout)
    for(const room of model.rooms.filter(r=>r.floorId===floor.id)) {
      const view=getRoomView(model,room.id)
      const horizontal=Math.hypot(view.target[0]-view.position[0],view.target[1]-view.position[1])
      assert.ok(horizontal>=300,`${layout}: ${room.name} must not look vertically down`)
      assert.ok(insidePolygon(view.target,room.polygon))
      const next=view.position.map((v,i)=>i<2?v+(view.target[i]-v)/horizontal*100:v)
      const moved=resolveCollision(model,view.position,next)
      assert.ok(Math.hypot(moved[0]-view.position[0],moved[1]-view.position[1])>50)
      assert.equal(moved[2],floor.elevation+1650)
    }
  }
})

test('stair suggestions cannot block existing doors even when the stair itself is walkable', () => {
  const {floor,model}=addFloor(toV2(createDemoBuilding()))
  const before=JSON.stringify(model)
  // The prior suggestion ran through the narrow Gallery and cut off Kitchen.
  assert.throws(()=>connectFloorBelow(model,floor.id),/without blocking room access/)
  assert.equal(JSON.stringify(model),before)
})

test('tour room limits still include every populated floor on manually added layouts', () => {
  let model=toV2(createDemoBuilding())
  for(let i=0;i<3;i++)model=addFloor(model,'bedrooms').model
  assert.equal(validateBuilding(model).valid,true)
  const ids=defaultTourRoomIds(model)
  assert.equal(ids.length,12)
  assert.equal(new Set(ids).size,12)
  assert.deepEqual(new Set(ids.map(id=>model.rooms.find(r=>r.id===id).floorId)),new Set(model.floors.map(f=>f.id)))
})

test('same-named copied rooms are distinguished by floor in tour controls', () => {
  let model=createMultiFloorDemo()
  const floor=nextFloor(model)
  model=populateFloor(applySceneEdit(model,{type:'addFloor',floor}),floor.id,{layout:'copy',sourceFloorId:'upper'})
  const rooms=model.rooms.filter(r=>r.name==='Upper reading gallery')
  assert.equal(rooms.length,2)
  assert.notEqual(roomLabel(model,rooms[0].id),roomLabel(model,rooms[1].id))
  assert.match(roomLabel(model,rooms[1].id),/Floor 3/)
})

test('a floor added after brief generation joins the whole-house itinerary', () => {
  const brief=defaultHouseBrief()
  brief.city='Pune'; brief.setbacks={front:1,back:1,left:1,right:1}
  const {model:generated}=generateBriefLayout(brief)
  const {model,floor}=addFloor(generated)
  const ids=defaultTourRoomIds(model)
  assert.ok(ids.some(id=>model.rooms.find(r=>r.id===id).floorId===floor.id))
  assert.ok(ids.some(id=>/^brief-r\d+$/.test(id)))
  assert.ok(ids.every(id=>!/^hall-\d+$|^brief-unassigned-/.test(id)))
})

test('four-floor tours have clear routes and scrubbing resolves the actual camera floor', () => {
  let model=createMultiFloorDemo()
  for(let i=0;i<2;i++){
    const added=addFloor(model)
    model=connectFloorBelow(added.model,added.floor.id)
  }
  assert.equal(validateConnectivity(model).valid,true)
  const tour=generateTour(model,{duration:40})
  assert.equal(validateTour(model,tour).valid,true)
  for(const floor of model.floors){
    const shot=tour.shots.find(s=>s.floorId===floor.id&&s.kind==='hold')
    const pose=sampleTour(tour,shot.startTime+shot.duration/2)
    assert.equal(cameraFloor(model,pose.position,tour.eyeHeight),floor.id)
    assert.equal(isWalkable(model,pose.position),true)
  }
  const aerial=sampleTour(tour,0)
  assert.equal(cameraFloor(model,aerial.position,tour.eyeHeight),null,'An aerial view has no interior floor')
})

test('connecting one new floor still works while a higher floor is unfinished', () => {
  const third=addFloor(createMultiFloorDemo())
  const fourth=addFloor(third.model)
  const connected=connectFloorBelow(fourth.model,third.floor.id)
  assert.equal(connected.stairs.length,2)
  assert.equal(connected.rooms.filter(r=>r.floorId===fourth.floor.id).length,1)
  assert.equal(validateConnectivity(connected).valid,false,'The unfinished fourth floor still needs its own connection')
})

test('the establishing orbit frames the full height of a four-floor house', () => {
  let model=createMultiFloorDemo()
  for(let i=0;i<2;i++){const added=addFloor(model);model=connectFloorBelow(added.model,added.floor.id)}
  const shot=generateTour(model).shots[0]
  const camera=new PerspectiveCamera(shot.fov,16/9,50,250000)
  camera.up.set(0,0,1)
  const z=Math.max(...model.floors.map(f=>f.elevation+f.height))
  for(const position of shot.path){
    camera.position.set(...position);camera.lookAt(...shot.target);camera.updateMatrixWorld()
    for(const room of model.rooms)for(const point of room.polygon)for(const height of [0,z]){
      const projected=new Vector3(...point,height).project(camera)
      assert.ok(Math.abs(projected.x)<.95&&Math.abs(projected.y)<.95,'The roof and base must remain inside the film frame')
    }
  }
})

test('local camera direction scopes identical room names to the requested floor', () => {
  const third=addFloor(createMultiFloorDemo())
  const fourth=addFloor(third.model)
  const result=parseTourIntent('Show Open room on Floor 4 in 20 seconds.',fourth.model)
  assert.deepEqual(result.roomIds,fourth.model.rooms.filter(r=>r.floorId===fourth.floor.id).map(r=>r.id))
  assert.equal(result.duration,20)
  const upstairs=parseTourIntent('Show Open room upstairs in 20 seconds.',fourth.model)
  assert.deepEqual(upstairs.roomIds,result.roomIds)
})

test('a named upper floor is not confused with a newer highest floor', () => {
  const third=addFloor(createMultiFloorDemo())
  const result=parseTourIntent('Show Upper reading gallery on Upper floor, then Open room on Floor 3 in 30 seconds.',third.model)
  assert.deepEqual(result.roomIds,['upper-gallery',third.model.rooms.find(r=>r.floorId===third.floor.id).id])
})
