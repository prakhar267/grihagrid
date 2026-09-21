import test from 'node:test'
import assert from 'node:assert/strict'
import {createDemoBuilding} from '../src/spatial/model.js'
import {getObstacles,isSegmentClear,validateConnectivity} from '../src/spatial/navigation.js'

function sceneFor(box) {
  return {schemaVersion:1,exactClearance:true,walls:[],furniture:[{id:'obstacle',kind:'console',position:[...box.position,0],size:[...box.size,1000],rotation:box.rotation}],rooms:[{polygon:[[-200000,-200000],[200000,-200000],[200000,200000],[-200000,200000]]}]}
}

// Independent reference: clip a segment against a local rectangle, then find
// the closest endpoint/rectangle or corner/segment distance. No cached bounds.
function referenceClear(start,end,box,clearance) {
  const c=Math.cos(box.rotation),s=Math.sin(box.rotation),local=p=>[(p[0]-box.position[0])*c+(p[1]-box.position[1])*s,-(p[0]-box.position[0])*s+(p[1]-box.position[1])*c]
  const a=local(start),b=local(end),half=box.size.map(v=>v/2),delta=b.map((v,i)=>v-a[i])
  let enter=0,leave=1,intersects=true
  for(let axis=0;axis<2;axis++) {
    if(delta[axis]===0) {if(Math.abs(a[axis])>half[axis])intersects=false;continue}
    const first=(-half[axis]-a[axis])/delta[axis],last=(half[axis]-a[axis])/delta[axis]
    enter=Math.max(enter,Math.min(first,last));leave=Math.min(leave,Math.max(first,last))
  }
  if(intersects&&enter<=leave)return false
  const rectangleDistance=p=>Math.hypot(...p.map((v,i)=>Math.max(0,Math.abs(v)-half[i])))
  const segmentDistance=p=>{const length=delta[0]**2+delta[1]**2,t=length?Math.max(0,Math.min(1,((p[0]-a[0])*delta[0]+(p[1]-a[1])*delta[1])/length)):0;return Math.hypot(...p.map((v,i)=>v-a[i]-t*delta[i]))}
  const distances=[rectangleDistance(a),rectangleDistance(b)]
  for(const x of[-half[0],half[0]])for(const y of[-half[1],half[1]])distances.push(segmentDistance([x,y]))
  return Math.min(...distances)>=clearance
}

test('exact sweeps retain tangent, rounded-corner, and zero-length clearance semantics',()=>{
  const box={position:[0,0],size:[1000,500],rotation:0},scene=sceneFor(box),clearance=100
  const cases=[
    {a:[-1000,350],b:[1000,350],clear:true}, // Exact tangent is allowed.
    {a:[-1000,350-1e-7],b:[1000,350-1e-7],clear:false},
    {a:[-1000,350+1e-7],b:[1000,350+1e-7],clear:true},
    {a:[-1000,0],b:[1000,0],clear:false},
    {a:[0,0],b:[0,0],clear:false},
    {a:[600,0],b:[600,0],clear:true},
    {a:[600-1e-7,0],b:[600-1e-7,0],clear:false},
    {a:[575,325],b:[575,325],clear:true}, // Inside inflated AABB, outside round corner.
    {a:[560,310],b:[560,310],clear:false},
    {a:[-1000,900],b:[1000,900],clear:true},
  ]
  for(const {a,b,clear} of cases) {
    assert.equal(referenceClear(a,b,box,clearance),clear)
    assert.equal(isSegmentClear(scene,a,b,clearance),clear,JSON.stringify({a,b}))
    assert.equal(isSegmentClear(scene,b,a,clearance),clear,'Reversing the sweep preserves clearance.')
  }
  assert.equal(isSegmentClear(scene,[500,0],[500,0],0),false,'A zero-radius point on the box still collides.')
  assert.equal(isSegmentClear(scene,[501,0],[501,0],0),true)
})

test('rotated, translated and very thin obstacles keep their swept clearance',()=>{
  for(const rotation of[0,1e-12,Math.PI/2,Math.PI/4,-Math.PI/6,Math.PI,2*Math.PI-1e-12]) {
    const box={position:[95000,-95000],size:[1200,0.001],rotation},scene=sceneFor(box)
    const world=([x,y])=>[box.position[0]+x*Math.cos(rotation)-y*Math.sin(rotation),box.position[1]+x*Math.sin(rotation)+y*Math.cos(rotation)]
    for(const clearance of[20,100,220,900])for(const offset of[-1e-4,1e-4,1000]) {
      const a=world([-1800,box.size[1]/2+clearance+offset]),b=world([1800,box.size[1]/2+clearance+offset])
      assert.equal(isSegmentClear(scene,a,b,clearance),offset>0,JSON.stringify({rotation,clearance,offset}))
    }
    assert.equal(isSegmentClear(scene,world([0,-1000]),world([0,1000]),20),false,'A sweep cannot tunnel through a thin rotated obstacle.')
  }
})

test('cached obstacle bounds refresh after position, dimensions or rotation change',()=>{
  const scene=sceneFor({position:[0,550],size:[1000,40],rotation:0}),box=getObstacles(scene)[0],a=[-2000,0],b=[2000,0]
  const check=expected=>assert.equal(isSegmentClear(scene,a,b,100),expected)
  check(true)
  box.position[1]=0;check(false)
  box.position=[0,550];check(true)
  box.size[1]=1000;check(false)
  box.size=[1000,40];check(true)
  box.rotation=Math.PI/2;check(false)
  box.rotation=0;check(true)
  box.position[1]=-550;check(true)
  box.size=[1000,1000];check(false)
})

test('seeded rotated-obstacle sweeps agree with independent continuous geometry',()=>{
  let seed=0x90311
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
  for(let i=0;i<20000;i++) {
    const box={position:[random()*20000-10000,random()*20000-10000],size:[0.01+random()*5000,0.01+random()*5000],rotation:random()*Math.PI*2}
    const point=()=>[box.position[0]+random()*12000-6000,box.position[1]+random()*12000-6000]
    const a=point(),b=i%7===0?a.slice():point(),clearance=20+random()*900,scene=sceneFor(box)
    assert.equal(isSegmentClear(scene,a,b,clearance),referenceClear(a,b,box,clearance),JSON.stringify({i,a,b,box,clearance}))
  }
})


test('prepared connectivity sweeps retain the independent continuous-geometry oracle',()=>{
  const driver=createDemoBuilding(),rooms=driver.rooms
  let entered=false,seed=0x174311
  const random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296)
  Object.defineProperty(driver,'rooms',{get(){
    if(!entered){
      entered=true
      for(let i=0;i<3000;i++){
        const box={position:[random()*20000-10000,random()*20000-10000],size:[.01+random()*5000,.01+random()*5000],rotation:random()*Math.PI*2}
        const point=()=>[box.position[0]+random()*12000-6000,box.position[1]+random()*12000-6000]
        const a=point(),b=i%7===0?a.slice():point(),clearance=20+random()*900,scene=sceneFor(box)
        assert.equal(isSegmentClear(scene,a,b,clearance),referenceClear(a,b,box,clearance),`prepared sweep ${i}`)
      }
    }
    return rooms
  }})
  assert.equal(validateConnectivity(driver).valid,true)
  assert.equal(entered,true)
})
