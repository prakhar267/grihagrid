import test from 'node:test'
import assert from 'node:assert/strict'
import {createDemoBuilding,createMultiFloorDemo} from '../src/spatial/model.js'
import {findRoute,getObstacles,isWalkable,validateConnectivity} from '../src/spatial/navigation.js'
import {floorScene} from '../src/spatial/navigation-v2.js'

function partitionScene() {
  // Exercise mutable navigation obstacles directly. The partition spans the
  // room boundary; this is not a claim that it is a valid furniture API payload.
  return {
    schemaVersion:2,
    floors:[{id:'ground',name:'Ground',elevation:0,height:3000}],
    rooms:[
      {id:'west',name:'West',floorId:'ground',polygon:[[0,0],[6000,0],[6000,9000],[0,9000]]},
      {id:'east',name:'East',floorId:'ground',polygon:[[6000,0],[12000,0],[12000,9000],[6000,9000]]},
    ],
    walls:[],stairs:[],
    furniture:[{id:'partition',kind:'console',floorId:'ground',roomId:'west',position:[6000,4500,0],size:[1000,3000,1000],rotation:0}],
  }
}

function probeScene() {
  return {
    schemaVersion:1,walls:[],
    rooms:[{polygon:[[-20000,-20000],[20000,-20000],[20000,20000],[-20000,20000]]}],
    furniture:[{id:'box',kind:'console',position:[0,0,0],size:[1000,1000,1000],rotation:0}],
  }
}

test('connectivity memo ends before exposed obstacles change or camera routes run',()=>{
  const scene=partitionScene(),start=[3000,4500,1650],end=[9000,4500,1650]
  const before=findRoute(scene,start,end)
  assert.ok(before.length>2)
  assert.equal(validateConnectivity(scene).valid,true)
  assert.deepEqual(findRoute(scene,start,end),before)

  const partition=getObstacles(floorScene(scene,'ground')).find(box=>box.id==='partition')
  partition.size[1]=20000
  assert.equal(validateConnectivity(scene).valid,false,'Previously clear cached edges cannot cross the enlarged partition.')
  assert.deepEqual(findRoute(scene,start,end),[])

  partition.size[1]=3000
  assert.equal(validateConnectivity(scene).valid,true)
  assert.deepEqual(findRoute(scene,start,end),before)
})

test('multi-floor camera routes retain their exact coordinates after connectivity validation',()=>{
  const scene=createMultiFloorDemo(),start=[6000,4500,1650],end=[6000,4500,4850]
  const route=findRoute(scene,start,end)
  assert.ok(route.length>20)
  assert.equal(validateConnectivity(scene).valid,true)
  assert.deepEqual(findRoute(scene,start,end),route)
  const disconnected=structuredClone(scene)
  disconnected.stairs=[]
  assert.equal(validateConnectivity(disconnected).valid,false)
  assert.deepEqual(findRoute(disconnected,start,end),[])
})

test('failed and nested connectivity validation cannot leave a walkability snapshot active',()=>{
  const failure=new Error('Synthetic geometry read failure')
  const broken={schemaVersion:1,get rooms(){throw failure}}
  assert.throws(()=>validateConnectivity(broken),error=>error===failure)

  const driver=createDemoBuilding(),rooms=driver.rooms
  let entered=false
  Object.defineProperty(driver,'rooms',{get(){
    if(!entered) {
      entered=true
      assert.equal(validateConnectivity(createMultiFloorDemo()).valid,true)
      assert.throws(()=>validateConnectivity(broken),error=>error===failure)
    }
    return rooms
  }})
  assert.equal(validateConnectivity(driver).valid,true)

  const probe=probeScene()
  assert.equal(isWalkable(probe,[0,0]),false)
  getObstacles(probe)[0].position[0]=5000
  assert.equal(isWalkable(probe,[0,0]),true,'Normal walking must observe mutations after every validation scope has ended.')
})

test('connectivity still evaluates fresh clear and blocked points after its shared memo budget is full',()=>{
  const driver=createDemoBuilding(),rooms=driver.rooms,probe=probeScene()
  let entered=false
  Object.defineProperty(driver,'rooms',{get(){
    if(!entered) {
      entered=true
      // More unique points than the shared point/edge memo budget. The exact
      // rectangle geometry remains the oracle, including allowed tangency.
      for(let i=0;i<17000;i++) {
        const x=i-8500
        assert.equal(isWalkable(probe,[x,0],220),Math.abs(x)>=720)
      }
      assert.equal(isWalkable(probe,[0,1],220),false)
      assert.equal(isWalkable(probe,[9000,1],220),true)
      assert.equal(isWalkable(probe,[NaN,0],220),false)
    }
    return rooms
  }})
  assert.equal(validateConnectivity(driver).valid,true)
  assert.equal(entered,true)
})
