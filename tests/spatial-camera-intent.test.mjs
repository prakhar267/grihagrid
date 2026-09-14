import assert from 'node:assert/strict'
import test from 'node:test'
import {createDemoBuilding} from '../src/spatial/model.js'
import {validateViewpoints} from '../worker/spatial-viewpoints.js'
import {validateSpatialIntent,providerIntentContext,preservesRequestedDirection,tourIntentResponseSchema,spatialIntentMismatchReasons} from '../worker/spatial-intent.js'
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
test('provider schema requires explicit camera constraints and preserves repeated stop order',()=>{
  const subject=model.furniture.find(f=>f.roomId==='kitchen')
  const intent={roomIds:['kitchen','living','kitchen'],duration:40,eyeHeight:1650,shotPreferences:[{roomId:'kitchen',subjectId:subject.id,kind:'reveal',pace:'slow',duration:8}]}
  const context=providerIntentContext(model,intent).data,schema=tourIntentResponseSchema(context),requested=context.requested
  assert.deepEqual(schema.required,['roomIds','duration','shotPreferences','eyeHeight'])
  assert.deepEqual(schema.properties.duration.enum,[40]);assert.deepEqual(schema.properties.eyeHeight.enum,[1650])
  assert.equal(schema.properties.roomIds.minItems,3);assert.equal(schema.properties.roomIds.maxItems,3)
  assert.deepEqual(schema.properties.roomIds.prefixItems.map(item=>item.enum[0]),requested.roomIds)
  const preferences=schema.properties.shotPreferences,fixed=preferences.prefixItems[0]
  assert.equal(preferences.minItems,1);assert.equal(preferences.maxItems,2)
  assert.deepEqual(fixed.required,['roomId','kind','pace','subjectId','duration'])
  for(const [key,value] of Object.entries(requested.shotPreferences[0]))assert.deepEqual(fixed.properties[key].enum,[value])
  const added=preferences.items.anyOf.find(item=>item.properties.roomId.enum[0]===requested.roomIds[1])
  assert.equal(added.additionalProperties,false);assert.equal(added.properties.duration,undefined,'AI cannot consume travel budget with invented fixed durations')
  assert.ok(added.properties.subjectId.enum.every(id=>context.subjects.some(subject=>subject.id===id&&subject.roomId===requested.roomIds[1])))
  const plain=tourIntentResponseSchema(providerIntentContext(model,{roomIds:['living'],duration:30}).data)
  assert.equal(plain.properties.eyeHeight,undefined);assert.equal(plain.properties.shotPreferences.minItems,0)
  assert.equal(plain.properties.shotPreferences.items.anyOf[0].properties.duration,undefined)
})
test('strict direction diagnostics distinguish omissions and exhausted travel without retaining provider data',()=>{
  const subject=model.furniture.find(f=>f.roomId==='kitchen')
  const requested={roomIds:['kitchen','living'],duration:40,eyeHeight:1650,shotPreferences:[{roomId:'kitchen',subjectId:subject.id,kind:'reveal',pace:'slow'}]}
  assert.deepEqual(spatialIntentMismatchReasons(requested,requested,model),[])
  const omitted={roomIds:requested.roomIds,duration:40}
  assert.equal(validateSpatialIntent(omitted,model),true,'Old permissive schema accepted these missing requested constraints')
  assert.equal(preservesRequestedDirection(omitted,requested),false)
  assert.deepEqual(spatialIntentMismatchReasons(omitted,requested,model),['eye_height_missing_or_changed','requested_preference_missing'])
  const overrun={...requested,shotPreferences:[{...requested.shotPreferences[0],duration:20},{roomId:'living',kind:'hold',pace:'slow',duration:20}]}
  assert.equal(validateSpatialIntent(overrun,model),false)
  assert.deepEqual(spatialIntentMismatchReasons(overrun,requested,model),['travel_budget_exhausted','invalid_intent_constraints'])
  const privateOutput={...requested,shotPreferences:[{roomId:'kitchen',subjectId:'PRIVATE-PROVIDER-TEXT',kind:'hold',pace:'fast'}]}
  assert.deepEqual(spatialIntentMismatchReasons(privateOutput,requested,model),['subject_missing_or_changed','shot_kind_changed','pace_changed','invalid_intent_constraints'])
  assert.ok(!JSON.stringify(spatialIntentMismatchReasons(privateOutput,requested,model)).includes('PRIVATE'))
})
