import assert from 'node:assert/strict'
import test from 'node:test'
import {createDemoBuilding} from '../src/spatial/model.js'
import {validateViewpoints} from '../worker/spatial-viewpoints.js'
import {validateSpatialIntent,providerIntentContext,preservesRequestedDirection} from '../worker/spatial-intent.js'
const model=createDemoBuilding()
const camera={id:'camera-one',name:'Kitchen reveal',buildingId:model.id,sourceRevision:model.revision,floorId:model.floors[0].id,position:[6000,3000,1650],target:[6000,4000,1200],fov:60}
test('camera library permits current viewpoints and only unchanged historical poses',()=>{
  assert.equal(validateViewpoints([camera],model),true)
  assert.equal(validateViewpoints([camera,camera],model),false)
  for(const patch of [{position:[NaN,0,0]},{fov:120},{floorId:'unknown'},{target:camera.position},{script:'run'},{name:'\u0000secret'}])assert.equal(validateViewpoints([{...camera,...patch}],model),false)
  const newer={...model,revision:model.revision+1}
  assert.equal(validateViewpoints([camera],newer),false)
  assert.equal(validateViewpoints([{name:'Renamed old view',...Object.fromEntries(Object.entries(camera).filter(([key])=>key!=='name').reverse())}],newer,[camera]),true)
  assert.equal(validateViewpoints([{...camera,position:[100,200,300]}],newer,[camera]),false)
  assert.equal(validateViewpoints([],newer,[camera]),true)
  assert.equal(validateViewpoints(Array.from({length:41},(_,i)=>({...camera,id:`view-${i}`})),model),false)
})
test('rich camera intent validates subjects, pacing, durations and bounded references',()=>{
  const subject=model.furniture.find(f=>f.roomId==='kitchen')
  const intent={roomIds:['kitchen'],duration:30,eyeHeight:1650,shotPreferences:[{roomId:'kitchen',subjectId:subject.id,kind:'reveal',pace:'slow',duration:6}]}
  assert.equal(validateSpatialIntent(intent,model),true)
  for(const patch of [{roomId:'living'},{subjectId:'unknown'},{kind:'execute'},{pace:'ludicrous'},{duration:61},{rawNotes:'private'}])assert.equal(validateSpatialIntent({...intent,shotPreferences:[{...intent.shotPreferences[0],...patch}]},model),false)
  assert.equal(validateSpatialIntent({...intent,roomIds:['kitchen','living','kitchen'],duration:15,shotPreferences:[{...intent.shotPreferences[0],duration:10}]},model),false)
  assert.equal(validateSpatialIntent({...intent,roomIds:['kitchen','living','kitchen'],duration:25,shotPreferences:[{...intent.shotPreferences[0],duration:10}]},model),true)
  assert.equal(validateSpatialIntent({...intent,eyeHeight:1000},model),false)
  assert.equal(validateSpatialIntent({...intent,shotPreferences:[{...intent.shotPreferences[0],duration:31}]},model),false)
  assert.equal(validateSpatialIntent({...intent,shotPreferences:[{...intent.shotPreferences[0],duration:30}]},model),false)
  assert.equal(validateSpatialIntent({...intent,shotPreferences:[{...intent.shotPreferences[0],duration:29.5}]},model),false)
  assert.equal(validateSpatialIntent({...intent,shotPreferences:[{...intent.shotPreferences[0],duration:29}]},model),true)
})
test('provider boundary sends anonymous aliases and maps validated preferences back',()=>{
  const scene=structuredClone(model),room=scene.rooms.find(r=>r.id==='kitchen'),subject=scene.furniture.find(f=>f.roomId===room.id)
  room.name='PRIVATE ADDRESS';subject.name='PRIVATE PERSON';subject.kind='PRIVATE CUSTOM OBJECT'
  const intent={roomIds:[room.id],duration:30,eyeHeight:1700,shotPreferences:[{roomId:room.id,subjectId:subject.id,kind:'reveal',pace:'slow'}]}
  const context=providerIntentContext(scene,intent),serialized=JSON.stringify(context.data)
  assert.ok(!serialized.includes('PRIVATE'));assert.ok(!serialized.includes(subject.id));assert.ok(!serialized.includes('kitchen'))
  assert.equal(context.data.subjects.find(f=>f.id===context.data.requested.shotPreferences[0].subjectId).kind,'object')
  assert.deepEqual(context.fromProvider(context.data.requested),intent)
  assert.equal(validateSpatialIntent(context.fromProvider({...context.data.requested,shotPreferences:[null]}),scene),false)
  assert.equal(validateSpatialIntent(context.fromProvider({...context.data.requested,shotPreferences:[{roomId:'room-2',subjectId:'subject-unknown',kind:'reveal',pace:'slow'}]}),scene),false)
  assert.equal(preservesRequestedDirection(intent,intent),true)
  assert.equal(preservesRequestedDirection({...intent,shotPreferences:[]},intent),false)
  assert.equal(preservesRequestedDirection({...intent,duration:31},intent),false)
})
