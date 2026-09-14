import assert from 'node:assert/strict'
import test from 'node:test'
import {createDemoBuilding,createMultiFloorDemo,buildPrimitives,validateBuilding,toV2,resizeBuilding} from '../src/spatial/model.js'
import {doorLeafPrimitive,recalculateBounds} from '../src/spatial/model-v2.js'
import {isWalkable,isRouteClear,isPathClear,findRoute,resolveCollision,validateConnectivity} from '../src/spatial/navigation.js'
import {floorScene} from '../src/spatial/navigation-v2.js'
import {applySceneEdit} from '../src/spatial/editor-ops.js'
import {generateTour,validateTour,parseTourIntent} from '../src/spatial/tours.js'

function fixture(angle){
  const scene=createMultiFloorDemo(),turn=([x,y])=>[3000+Math.cos(angle)*(x-3000)-Math.sin(angle)*(y-3000),3000+Math.sin(angle)*(x-3000)+Math.cos(angle)*(y-3000)]
  scene.floors=scene.floors.slice(0,1);scene.rooms=[{...scene.rooms[0],id:'south-room',polygon:[[0,0],[6000,0],[6000,3000],[0,3000]].map(turn)},{...scene.rooms[0],id:'north-room',polygon:[[0,3000],[6000,3000],[6000,6000],[0,6000]].map(turn)}]
  scene.walls=[{id:'partition',floorId:'ground',roomIds:['south-room','north-room'],start:turn([0,3000]),end:turn([6000,3000]),thickness:180,height:3000,openings:[{id:'passage',kind:'door',offset:2400,width:1200,sill:0,height:2300,open:true}]}]
  scene.furniture=[];scene.stairs=[];recalculateBounds(scene)
  return {scene,turn}
}
const near=(actual,expected)=>assert.ok(actual.every((n,i)=>Math.abs(n-expected[i])<1e-6),`${actual} != ${expected}`)

test('door leaves preserve hinge, side and physical clearance for every wall orientation',()=>{
  for(const angle of[0,Math.PI/2,Math.PI,Math.PI*1.5,Math.PI/4,-Math.PI/6])for(const hinge of['start','end'])for(const swing of[-1,1]){
    const {scene,turn}=fixture(angle),wall=scene.walls[0],opening=wall.openings[0];Object.assign(opening,{hinge,swing})
    assert.equal(validateBuilding(scene).valid,true)
    const leaf=buildPrimitives(scene).find(p=>p.id==='passage-leaf'),pose=doorLeafPrimitive(wall,opening)
    assert.deepEqual(leaf,pose);near(pose.hingePosition,turn([hinge==='start'?2435:3565,3000]));near(pose.openEnd,turn([hinge==='start'?2435:3565,3000+swing*1130]))
    assert.equal(isWalkable(scene,[...turn([3000,3000]),1650]),true)
    assert.equal(isRouteClear(scene,[turn([3000,2200]),turn([3000,3800])].map(p=>[...p,1650])),true)
    assert.equal(isWalkable(scene,[...leaf.position.slice(0,2),1650]),false)
    const across=[Math.cos(angle)*400,Math.sin(angle)*400],start=[leaf.position[0]-across[0],leaf.position[1]-across[1],1650],end=[leaf.position[0]+across[0],leaf.position[1]+across[1],1650]
    assert.ok(Math.hypot(...resolveCollision(scene,start,end).map((n,i)=>n-end[i]))>100)
    const closed=structuredClone(scene);closed.walls[0].openings[0].open=false
    const closedLeaf=buildPrimitives(closed).find(p=>p.id===leaf.id);assert.deepEqual(closedLeaf.size,leaf.size);near(closedLeaf.position,[...turn([3000,3000]),1150]);assert.equal(isWalkable(closed,[...turn([3000,3000]),1650]),false)
  }
})

test('direction editing is versioned and strict while the original v1 film scene is unchanged',()=>{
  const {scene}=fixture(0),edited=applySceneEdit(scene,{type:'upsertOpening',wallId:'partition',opening:{...scene.walls[0].openings[0],hinge:'end',swing:-1}})
  assert.equal(edited.revision,scene.revision+1);assert.equal(scene.walls[0].openings[0].hinge,undefined);assert.equal(edited.walls[0].openings[0].swing,-1)
  for(const patch of[{hinge:'middle'},{swing:0},{swing:'1'},{script:'run'}]){const invalid=structuredClone(scene);Object.assign(invalid.walls[0].openings[0],patch);assert.equal(validateBuilding(invalid).valid,false)}
  const invalidWindow=structuredClone(scene);Object.assign(invalidWindow.walls[0].openings[0],{kind:'window',hinge:'start'});assert.equal(validateBuilding(invalidWindow).valid,false)
  const legacy=createDemoBuilding();assert.equal(buildPrimitives(legacy).length,315);assert.equal(buildPrimitives(legacy).some(p=>p.id==='entrance-leaf'),false)
  assert.equal(buildPrimitives(toV2(legacy)).some(p=>p.id==='entrance-leaf'),true)
  assert.equal(validateConnectivity(toV2(legacy)).valid,true)
})


test('directed living-to-kitchen walks preserve continuous clearance around the door jamb',()=>{
  const model=createDemoBuilding(),tour=generateTour(model,{roomIds:['living','kitchen'],shotPreferences:[{roomId:'kitchen',kind:'hold',pace:'normal'}],duration:30})
  assert.equal(validateTour(model,tour).valid,true)
  const scene=toV2(model),walk=tour.shots.find(shot=>shot.kind==='walk')
  assert.ok(walk)
  for(let i=1;i<walk.path.length;i++){const a=walk.path[i-1],b=walk.path[i],steps=Math.ceil(Math.hypot(...a.map((v,j)=>v-b[j]))/10);for(let n=0;n<=steps;n++)assert.equal(isWalkable(scene,a.map((v,j)=>v+(b[j]-v)*n/steps)),true)}
})

test('changing a directed door into a window clears only inherited door metadata',()=>{
  const {scene}=fixture(0)
  const directed=applySceneEdit(scene,{type:'upsertOpening',wallId:'partition',opening:{id:'passage',hinge:'end',swing:-1}})
  const patch={id:'passage',kind:'window',sill:900,height:1400,open:false}
  const converted=applySceneEdit(directed,{type:'upsertOpening',wallId:'partition',opening:patch})
  const window=converted.walls[0].openings[0]
  assert.equal(window.kind,'window');assert.equal(window.hinge,undefined);assert.equal(window.swing,undefined)
  assert.equal(window.offset,2400);assert.equal(window.width,1200);assert.equal(converted.revision,directed.revision+1)
  assert.equal(directed.walls[0].openings[0].hinge,'end')
  assert.equal(buildPrimitives(converted).some(primitive=>primitive.id==='passage-leaf'),false)
  assert.throws(()=>applySceneEdit(directed,{type:'upsertOpening',wallId:'partition',opening:{...patch,hinge:'end'}}),/Invalid opening/)
})

test('scaled open leaves route through narrow clearance bands without a finer global grid',()=>{
  const model=resizeBuilding(createDemoBuilding(),{width:13000,depth:10000})
  const intent=parseTourIntent('Slowly reveal the kitchen island, orbit the dining table, then linger in the main bedroom for a 40 second tour.',model)
  const tour=generateTour(model,intent),projected=floorScene(toV2(model),'ground')
  assert.equal(tour.duration,40);assert.equal(validateTour(model,tour).valid,true)
  for(const shot of tour.shots.filter(shot=>shot.kind==='walk'))assert.equal(isPathClear(projected,shot.path),true,'Every generated segment preserves exact swept obstacle clearance.')
  const {scene}=fixture(0);scene.walls[0].openings[0].open=false
  assert.deepEqual(findRoute(scene,[3000,2000,1650],[3000,4000,1650]),[],'The fallback must not cross a closed partition.')
})
