import assert from 'node:assert/strict'
import test from 'node:test'
import { createMultiFloorDemo, resizeBuilding, validateBuilding } from '../src/spatial/model.js'
import { applySceneEdit } from '../src/spatial/editor-ops.js'
import { clearFloor, populateFloor } from '../src/spatial/floor-plans.js'
import { componentForm, newComponentForm, reconcileComponentForms } from '../src/spatial/component-drafts.js'

const column=(patch={})=>({id:'column-one',kind:'column',label:'C1',floorId:'ground',position:[2000,2000,0],size:[300,300,2800],rotation:0,system:'Frame A',notes:'Design reference',...patch})
const model=()=>({...createMultiFloorDemo(),coordination:[column(),column({id:'column-two',floorId:'upper'})]})
const draftFor=(scene,floorId='ground')=>componentForm(scene.coordination.find(c=>c.floorId===floorId))

test('a clean selected form tracks scaling without reverting geometry when later edited',()=>{
  const original=model(),drafts={ground:draftFor(original)}
  const resized=resizeBuilding(original,{width:15000,depth:10000})
  const next=reconcileComponentForms(resized,drafts)
  assert.deepEqual(next.ground.position,resized.coordination[0].position.map(String))
  assert.notDeepEqual(next.ground.position,drafts.ground.position)
  assert.deepEqual(next.ground.size,['300','300','2800'])
  assert.equal(next.ground.pending,false)
  assert.equal(next.ground.conflict,null)
  assert.equal(validateBuilding(resized).valid,true)
  assert.deepEqual(reconcileComponentForms(original,next).ground,drafts.ground,'undo restores the original coordinates')
})

test('discarded and cleared components cannot remain selected as implicit upserts',()=>{
  const scene=model(),drafts={ground:draftFor(scene),upper:draftFor(scene,'upper')}
  const cleared=clearFloor(scene,'upper'),next=reconcileComponentForms(cleared,drafts)
  assert.equal(next.upper.id,null)
  assert.equal(next.upper.label,'')
  assert.deepEqual(next.upper.size,['','',''])
  assert.equal(next.ground,drafts.ground)
  const discarded=reconcileComponentForms(createMultiFloorDemo(),drafts)
  assert.equal(discarded.ground.id,null)
  assert.equal(discarded.upper.id,null)
})

test('pending entries survive a resize with an explicit conflict, including incomplete numbers',()=>{
  const scene=model(),draft={...draftFor(scene),label:'Entered revision',size:['450','','3000'],notes:'Keep this reference',pending:true}
  const before=structuredClone(draft),resized=resizeBuilding(scene,{width:15000,depth:10000})
  const next=reconcileComponentForms(resized,{ground:draft}).ground
  assert.equal(next.conflict,'changed')
  assert.equal(next.pending,true)
  assert.deepEqual({...next,conflict:null},before)
  assert.deepEqual(draft,before,'reconciliation does not mutate input')
  const current=componentForm(resized.coordination[0])
  assert.equal(current.conflict,null)
  assert.equal(current.pending,false)
  assert.deepEqual(current.position,resized.coordination[0].position.map(String))
})

test('pending deleted component remains recoverable but never binds to a replacement component',()=>{
  const scene=model(),draft={...draftFor(scene,'upper'),notes:'Keep me',pending:true}
  const cleared=clearFloor(scene,'upper')
  const removed=reconcileComponentForms(cleared,{upper:draft}).upper
  assert.equal(removed.conflict,'removed')
  assert.equal(removed.notes,'Keep me')
  const copied=populateFloor(cleared,'upper',{layout:'copy',sourceFloorId:'ground'})
  assert.equal(reconcileComponentForms(copied,{upper:removed}).upper.conflict,'removed')
  assert.notEqual(copied.coordination.find(c=>c.floorId==='upper').id,draft.id)
  const restored=reconcileComponentForms(scene,{upper:removed}).upper
  assert.equal(restored.conflict,null,'restoring the exact source resolves its conflict')
  assert.equal(restored.pending,true)
  assert.equal(restored.notes,'Keep me')
})

test('independent floor changes and model revisions do not invalidate pending forms',()=>{
  const scene=model(),drafts={ground:{...draftFor(scene),pending:true,label:'Draft'},upper:{...newComponentForm(scene,'upper','socket'),pending:true,loadWatts:'0'}}
  const changed=applySceneEdit(scene,{type:'upsertComponent',component:{...scene.coordination[1],label:'Upper changed'}})
  assert.equal(reconcileComponentForms(changed,drafts),drafts)
  assert.equal(reconcileComponentForms({...scene,revision:scene.revision+1},drafts),drafts)
  assert.equal(drafts.upper.loadWatts,'0')
})

test('every edited source field detects a pending conflict without depending on object key order',()=>{
  const scene=model(),drafts={ground:{...draftFor(scene),pending:true}}
  for(const patch of [{label:'Changed'},{kind:'beam'},{position:[2500,2000,0]},{size:[400,300,2800]},{rotation:1},{system:'Frame B'},{notes:'Revised'}]) {
    const changed={...scene,coordination:[{...scene.coordination[0],...patch},scene.coordination[1]]}
    assert.equal(reconcileComponentForms(changed,drafts).ground.conflict,'changed',JSON.stringify(patch))
  }
  const reordered={...scene,coordination:scene.coordination.map(c=>Object.fromEntries(Object.entries(c).reverse()))}
  assert.equal(reconcileComponentForms(reordered,drafts),drafts)
  const electrical={...scene,coordination:[column({kind:'socket',loadWatts:0})]}
  const loadDraft={ground:{...draftFor(electrical),pending:true}}
  assert.equal(reconcileComponentForms({...electrical,coordination:[{...electrical.coordination[0],loadWatts:null}]},loadDraft).ground.conflict,'changed')
})

test('explicit floor deletion removes only that floor form and never reassigns its draft',()=>{
  const scene=model(),drafts={ground:draftFor(scene),upper:{...draftFor(scene,'upper'),pending:true}}
  const next=reconcileComponentForms({...scene,floors:scene.floors.filter(f=>f.id!=='upper')},drafts)
  assert.deepEqual(Object.keys(next),['ground'])
  assert.equal(next.ground,drafts.ground)
  assert.equal(drafts.upper.pending,true)
})
