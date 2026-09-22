import assert from 'node:assert/strict'
import test from 'node:test'
import { createDemoBuilding, createMultiFloorDemo, toV2, validateBuilding, buildPrimitives, resizeBuilding } from '../src/spatial/model.js'
import { applySceneEdit } from '../src/spatial/editor-ops.js'
import { clearFloor, populateFloor } from '../src/spatial/floor-plans.js'
import { COMPONENTS, coordinationPrimitives, coordinationIssues, coordinationCSV, boxesIntersect } from '../src/spatial/coordination.js'
import { coordinationPlanSheet, coordinationScheduleSheets, drawingSetHTML } from '../src/spatial/drawing-set.js'
import { isWalkableV2 } from '../src/spatial/navigation-v2.js'
import { generateTour, validateTour, isTourStale } from '../src/spatial/tours.js'
import { shotSignature } from '../src/spatial/tours-v2.js'
import { parseSceneFile } from '../src/spatial/scene-file.js'
import { serializeScene } from '../scripts/spatial/run.mjs'
import { buildingSection } from '../src/spatial/building-sections.js'

const item=(patch={})=>({id:'component-one',kind:'column',label:'C1',floorId:'ground',position:[2000,2000,0],size:[300,300,3000],rotation:0,system:'Frame A',notes:'Entered from design reference',...patch})
const model=(items=[item()])=>({...createMultiFloorDemo(),coordination:items})

test('old scenes and an empty coordination layer keep identical geometry and shot signatures',()=>{
  const original=createMultiFloorDemo(),empty={...original,coordination:[]},shot={kind:'walk'}
  assert.deepEqual(buildPrimitives(empty),buildPrimitives(original))
  assert.equal(shotSignature(empty,shot),shotSignature(original,shot))
  assert.equal(validateBuilding(createDemoBuilding()).valid,true)
})
test('every component kind accepts bounded explicit dimensions without altering architectural records',()=>{
  for(const [kind,spec] of Object.entries(COMPONENTS)) {
    const input=createMultiFloorDemo(),next=applySceneEdit(input,{type:'upsertComponent',component:item({kind,size:spec.pipe?[2000,50,50]:[300,300,300],...(spec.discipline==='electrical'?{loadWatts:12}:{})})})
    assert.equal(validateBuilding(next).valid,true,kind)
    for(const field of ['floors','rooms','walls','furniture','stairs'])assert.deepEqual(next[field],input[field])
    assert.equal(next.revision,input.revision+1)
  }
})
test('strict component schema rejects malformed imports and duplicate identifiers',()=>{
  for(const patch of [{id:'upper'},{id:'ground-window-0'},{floorId:'missing'},{kind:'__proto__'},{label:''},{notes:'a'.repeat(301)},{loadWatts:20},{extra:true},{position:[NaN,2,0]},{position:[2000,2000,-1]},{position:[2000,2000,2900]},{size:[-1,300,300]},{size:[10,0,30]},{rotation:Infinity},{position:[-1000,2000,0]}])assert.equal(validateBuilding(model([item(patch)])).valid,false,JSON.stringify(patch))
  for(const value of [null,{},[null],Array.from({length:121},(_,i)=>item({id:`c-${i}`}))])assert.equal(validateBuilding({...createMultiFloorDemo(),coordination:value}).valid,false)
  assert.equal(validateBuilding(model([item(),item()])).valid,false)
  assert.equal(validateBuilding({...createDemoBuilding(),coordination:[]}).valid,false,'legacy schema is unchanged')
})
test('pipe sizes and electrical loads are explicit and bounded',()=>{
  assert.equal(validateBuilding(model([item({kind:'cold-water',size:[2000,50,50]})])).valid,true)
  assert.equal(validateBuilding(model([item({kind:'cold-water',size:[2000,50,60]})])).valid,false)
  for(const loadWatts of [null,0,100000])assert.equal(validateBuilding(model([item({kind:'socket',size:[90,25,90],loadWatts})])).valid,true)
  for(const loadWatts of [-1,'15',Infinity,100001])assert.equal(validateBuilding(model([item({kind:'socket',size:[90,25,90],loadWatts})])).valid,false)
})
test('upper floor primitive positions include FFL exactly once and pipe meshes retain dimensions',()=>{
  const scene=model([item({floorId:'upper',position:[2000,2000,2400],size:[3000,50,50],kind:'cold-water'})]),p=coordinationPrimitives(scene)[0]
  assert.deepEqual(p.position,[2000,2000,5625]);assert.equal(p.kind,'mesh');assert.equal(p.vertices.length,32)
  for(let axis=0;axis<3;axis++)assert.equal(Math.max(...p.vertices.map(v=>v[axis]))-Math.min(...p.vertices.map(v=>v[axis])),p.size[axis])
  assert.ok(buildPrimitives(scene).some(v=>v.id===p.id&&v.floorId==='upper'))
})
test('pipe mesh normals point outwards for all three axes',()=>{
  for(let axis=0;axis<3;axis++){
    const size=[50,50,50];size[axis]=1000
    const p=coordinationPrimitives(model([item({kind:'drain',size})]))[0]
    for(let i=0;i<p.indices.length;i+=3){const [a,b,c]=p.indices.slice(i,i+3).map(k=>p.vertices[k]),u=b.map((v,k)=>v-a[k]),v=c.map((n,k)=>n-a[k]),normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],center=a.map((n,k)=>(n+b[k]+c[k])/3);assert.ok(normal.reduce((sum,n,k)=>sum+n*center[k],0)>0,`axis ${axis} triangle ${i}`)}
  }
})
test('building sections include pipe envelopes rather than treating them as room slabs',()=>{
  const scene=model([item({kind:'cold-water',floorId:'upper',position:[2000,2000,2400],size:[2000,50,50]})])
  const section=buildingSection(scene,{axis:'x',percent:2000/12000*100}),part=section.parts.find(p=>p.id==='component-one')
  assert.ok(part);assert.equal(part.category,'plumbing');assert.equal(part.bottom,5600);assert.equal(part.top,5650)
  assert.equal(part.right-part.left,50)
})
test('columns and low beams obstruct walking; high beams allow the existing clearance',()=>{
  const clear={...createMultiFloorDemo(),furniture:[]},point=[2000,2000,1650]
  assert.equal(isWalkableV2(clear,point),true)
  assert.equal(isWalkableV2({...clear,coordination:[item()]},point),false)
  assert.equal(isWalkableV2({...clear,coordination:[item({kind:'beam',position:[2000,2000,2600],size:[2000,300,400]})]},point),true)
  assert.equal(isWalkableV2({...clear,coordination:[item({kind:'beam',position:[2000,2000,1600],size:[2000,300,400]})]},point),false)
})
test('coordination mutations stale previous tours even when a caller keeps the source revision',()=>{
  const input=createMultiFloorDemo(),tour=generateTour(input,{duration:20}),next={...input,coordination:[item({kind:'light',size:[200,200,40],position:[2000,2000,2700]})]}
  assert.equal(isTourStale(next,tour),true);assert.equal(validateTour(next,tour).valid,false)
  const updated=generateTour(next,{duration:20});assert.equal(validateTour(next,updated).valid,true)
})
test('scene JSON and native serialization preserve all component geometry',()=>{
  const scene=model([item({kind:'light',position:[2000,2000,2700],size:[200,200,40],loadWatts:15})]),tour=generateTour(scene,{duration:20}),file={model:scene,tour,viewpoints:[]}
  assert.deepEqual(parseSceneFile(JSON.stringify(file)),file)
  const native=serializeScene(scene,20,tour,[]),p=native.primitives.find(v=>v.id==='component-one')
  assert.deepEqual(p,buildPrimitives(scene).find(v=>v.id==='component-one'))
})
test('clear and copy preserve independent floors and assign fresh component identifiers',()=>{
  const source=model([item(),item({id:'component-two',floorId:'upper',position:[2000,2000,2700],kind:'light',size:[200,200,40]})]),cleared=clearFloor(source,'upper')
  assert.deepEqual(cleared.coordination,[source.coordination[0]])
  const copied=populateFloor(cleared,'upper',{layout:'copy',sourceFloorId:'ground'})
  assert.equal(copied.coordination.length,2);assert.notEqual(copied.coordination[0].id,copied.coordination[1].id)
  assert.deepEqual(copied.coordination[1].size,source.coordination[0].size)
  assert.equal(copied.coordination[1].floorId,'upper');assert.equal(validateBuilding(copied).valid,true)
})
test('overall scaling relocates components but never silently sizes engineered members',()=>{
  const source=model(),next=resizeBuilding(source,{width:15000,depth:10000})
  assert.deepEqual(next.coordination[0].size,source.coordination[0].size)
  assert.notDeepEqual(next.coordination[0].position,source.coordination[0].position)
})
test('interference checks honor Z, rotation, systems and floor isolation',()=>{
  const a=item(),pipe=item({id:'component-two',kind:'cold-water',position:[2000,2000,1500],size:[2000,50,50]})
  assert.ok(coordinationIssues(model([a,pipe])).some(v=>v.code==='component-interference'))
  assert.equal(coordinationIssues(model([a,{...pipe,floorId:'upper'}])).filter(v=>v.code==='component-interference').length,0)
  assert.equal(boxesIntersect(a,{...pipe,position:[2000,2000,3000]}),false)
  assert.equal(boxesIntersect({...a,size:[3000,20,50],rotation:Math.PI/4},{...a,position:[1000,3000,0],size:[50,50,50]}),false)
  assert.ok(coordinationIssues(model([item({position:[2600,100,0],size:[200,200,3000]})])).some(v=>v.code==='opening-interference'))
})
test('entered columns identify intersected furniture and its room without changing geometry',()=>{
  const scene=model(),room=scene.rooms.find(r=>r.floorId==='ground')
  scene.furniture=[{id:'test-bed',kind:'bed',roomId:room.id,floorId:'ground',position:[2000,2000,0],size:[1500,2000,600],rotation:0,color:'#ba9c77'}]
  const before=structuredClone(scene),issue=coordinationIssues(scene).find(v=>v.code==='furniture-interference')
  assert.deepEqual(issue.ids,['component-one','test-bed'])
  assert.ok(issue.message.includes(`bed in ${room.name}`))
  assert.deepEqual(scene,before)
  const moved=applySceneEdit(scene,{type:'upsertComponent',component:item({position:[4000,2000,0]})})
  assert.equal(coordinationIssues(moved).filter(v=>v.code==='furniture-interference').length,0)
})
test('furniture interference respects floor, vertical separation, touch tolerance and rotated envelopes',()=>{
  const scene=model(),room=scene.rooms.find(r=>r.floorId==='ground')
  const furnishing={id:'test-unit',kind:'wardrobe',roomId:room.id,floorId:'ground',position:[2000,2000,0],size:[2000,200,600],rotation:Math.PI/2,color:'#ba9c77'}
  const found=(component,furniture=furnishing)=>coordinationIssues({...scene,coordination:[component],furniture:[furniture]}).filter(v=>v.code==='furniture-interference').length
  assert.equal(found(item({position:[2000,2800,0]})),1,'rotation places the long edge along Y')
  assert.equal(found(item({position:[2800,2000,0]})),0,'axis-aligned bounds must not invent a hit')
  assert.equal(found(item(),{...furnishing,floorId:'upper'}),0)
  assert.equal(found(item({kind:'beam',position:[2000,2000,600],size:[2000,300,300]})),0,'touching top is clear')
  assert.equal(found(item({kind:'beam',position:[2000,2000,599],size:[2000,300,300]})),1)
  assert.equal(found(item({position:[2250,2000,0]})),0,'touching XY edge is clear')
  assert.equal(found(item({position:[2249,2000,0]})),1)
  assert.equal(found(item({kind:'cold-water',position:[2000,2000,200],size:[2000,50,50]})),1,'services use the same entered envelopes')
})
test('drawing and CSV exports escape user text, retain notes and include only populated disciplines',()=>{
  const note='Reference '+('long specification notes '.repeat(11)),scene=model([item({label:'<script>alert(1)</script>',system:'=1+1',notes:note}),item({id:'component-two',kind:'socket',label:'Socket',size:[90,25,90],loadWatts:null,system:''})])
  const svg=coordinationPlanSheet(scene,'ground','structure'),schedules=coordinationScheduleSheets(scene).join(''),html=drawingSetHTML(scene),csv=coordinationCSV(scene)
  assert.ok(svg.includes('0-C01'));assert.ok(schedules.includes('&lt;script&gt;'));assert.ok(!schedules.includes('<script>'))
  assert.ok(schedules.includes('unspecified'));assert.ok(csv.includes("'=1+1"));assert.ok(csv.includes(note))
  assert.equal((html.match(/<article>/g)||[]).length,10)
  assert.ok(html.includes('ST-1'));assert.ok(html.includes('EL-1'));assert.ok(!html.includes('PL-1'))
})
test('component schedules paginate all records and long reference notes without losing entries',()=>{
  const scene=model(Array.from({length:60},(_,i)=>item({id:`component-${i}`,label:`Member ${i}`,notes:'reference '.repeat(29)})))
  const pages=coordinationScheduleSheets(scene)
  assert.ok(pages.length>3)
  for(let i=0;i<60;i++)assert.ok(pages.join('').includes(`Member ${i}</text>`))
})
