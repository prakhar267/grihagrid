import assert from 'node:assert/strict'
import test from 'node:test'
import { createMultiFloorDemo, resizeBuilding } from '../src/spatial/model.js'
import { componentForm, newComponentForm } from '../src/spatial/component-drafts.js'
import { MAX_COMPONENT_FORM_BYTES, componentFormFile, parseComponentFormFile, reviewComponentFormFile, restoreComponentFormFile } from '../src/spatial/component-form-file.js'

const column={id:'column-one',kind:'column',label:'C1',floorId:'ground',position:[2000,2000,0],size:[300,300,2800],rotation:0,system:'Frame A',notes:'Drawing S1'}
const house=()=>({...createMultiFloorDemo(),coordination:[structuredClone(column)]})
const forms=model=>({
  ground:{...componentForm(model.coordination[0]),size:['450','','3000'],notes:'Revised drawing\nKeep unfinished dimension',pending:true},
  upper:{...newComponentForm(model,'upper','socket'),label:'Study socket',loadWatts:'0',pending:true},
})
const packet=model=>parseComponentFormFile(componentFormFile(model,forms(model)))

test('download and reopen retains independent floor forms, incomplete values, notes and zero load without geometry changes',()=>{
  const model=house(),drafts=forms(model),before=structuredClone({model,drafts})
  const saved=componentFormFile(model,drafts),opened=parseComponentFormFile(saved)
  assert.deepEqual(reviewComponentFormFile(model,opened),drafts)
  assert.deepEqual(restoreComponentFormFile(model,{},opened),drafts)
  assert.deepEqual({model,drafts},before)
  assert.equal(opened.forms.length,2)
  assert.equal(opened.forms[0].size[1],'')
  assert.equal(opened.forms[1].loadWatts,'0')
  assert.equal('model' in opened,false,'form files do not claim to save geometry')
})

test('earlier single-form downloads reopen with their original source fingerprint',()=>{
  const model=house(),form=forms(model).ground
  const opened=parseComponentFormFile(JSON.stringify({kind:'grihagrid-component-form',buildingId:model.id,form}))
  assert.deepEqual(reviewComponentFormFile(model,opened),{ground:form})
  assert.throws(()=>restoreComponentFormFile(model,{},opened),/no house name/)
  assert.deepEqual(restoreComponentFormFile(model,{},opened,{legacyConfirmed:true}),{ground:form})
})

test('restoration rechecks changed and removed sources and never trusts a file conflict flag',()=>{
  const model=house(),file=packet(model),before=structuredClone(file)
  const resized=resizeBuilding(model,{width:15000,depth:10000})
  const moved=restoreComponentFormFile(resized,{},file)
  assert.equal(moved.ground.conflict,'changed')
  assert.equal(moved.ground.notes,forms(model).ground.notes)
  assert.deepEqual(moved.ground.size,['450','','3000'])
  const removed=reviewComponentFormFile({...model,coordination:[]},file)
  assert.equal(removed.ground.conflict,'removed')
  file.forms[0].conflict='removed'
  assert.equal(reviewComponentFormFile(model,file).ground.conflict,null,'matching source resolves a stale file flag')
  assert.deepEqual({...file,forms:file.forms.map(f=>({...f,conflict:null}))},before)
})

test('restoring a file cannot overwrite any pending floor and keeps clean selections on other floors',()=>{
  const model=house(),single={kind:'grihagrid-component-form',buildingId:model.id,form:forms(model).ground}
  const current={upper:{...newComponentForm(model,'upper'),label:'My unsaved work',pending:true}},before=structuredClone(current)
  assert.throws(()=>restoreComponentFormFile(model,current,single),/current component forms/)
  assert.deepEqual(current,before)
  current.upper.pending=false
  const restored=restoreComponentFormFile(model,current,single,{legacyConfirmed:true})
  assert.deepEqual(restored.upper,current.upper)
  assert.equal(restored.ground.pending,true)
})

test('wrong houses and missing floors fail atomically, including a changed model after preview',()=>{
  const model=house(),file=packet(model),before=structuredClone(file)
  assert.throws(()=>reviewComponentFormFile({...model,id:'another-house'},file),/different house/)
  assert.throws(()=>restoreComponentFormFile({...model,floors:model.floors.filter(f=>f.id!=='upper')},{},file),/floor missing/)
  assert.deepEqual(file,before)
  assert.deepEqual(reviewComponentFormFile({...model,revision:model.revision+1},file),forms(model),'a revision counter alone does not create a conflict')
})

test('only pending entries are downloaded and numeric zero from a selected component survives',()=>{
  const model=house(),drafts=forms(model)
  drafts.upper.pending=false
  drafts.ground.loadWatts=0
  const opened=parseComponentFormFile(componentFormFile(model,drafts))
  assert.equal(opened.forms.length,1)
  assert.equal(opened.forms[0].loadWatts,0)
  drafts.ground.pending=false
  assert.throws(()=>componentFormFile(model,drafts),/one to four/)
})

test('bounded strict file schema rejects unsupported fields, malformed entries and duplicate floor claims',()=>{
  const model=house(),valid=packet(model)
  const mutations=[
    v=>({...v,version:2}),v=>({...v,kind:'scene'}),v=>({...v,extra:true}),v=>({...v,forms:[]}),
    v=>({...v,forms:[...v.forms,v.forms[0]]}),v=>({...v,forms:Array(5).fill(v.forms[0])}),
    v=>({...v,forms:[{...v.forms[0],pending:false}]}),v=>({...v,forms:[{...v.forms[0],source:null}]}),
    v=>({...v,forms:[{...v.forms[0],kind:['column']}]}),v=>({...v,forms:[{...v.forms[0],kind:'constructor'}]}),v=>({...v,forms:[{...v.forms[0],floorId:'__proto__'}]}),
    v=>({...v,forms:[{...v.forms[0],label:'x'.repeat(61)}]}),v=>({...v,forms:[{...v.forms[0],notes:'x'.repeat(301)}]}),
    v=>({...v,forms:[{...v.forms[0],position:['2','3']}]}),v=>({...v,forms:[{...v.forms[0],size:['3',{},'8']}]}),
    v=>({...v,forms:[{...v.forms[0],rotation:'NaN'}]}),v=>({...v,forms:[{...v.forms[0],loadWatts:null}]}),
    v=>({...v,forms:[{...v.forms[0],source:'x'.repeat(4097)}]}),v=>({...v,forms:[{...v.forms[0],unexpected:'field'}]}),
  ]
  for(const mutate of mutations)assert.throws(()=>parseComponentFormFile(JSON.stringify(mutate(structuredClone(valid)))))
  for(const value of [null,[],{},true,42])assert.throws(()=>parseComponentFormFile(JSON.stringify(value)))
  assert.throws(()=>parseComponentFormFile('{'),/not valid JSON/)
  assert.throws(()=>parseComponentFormFile(JSON.stringify(valid).replace('"version":1','"version":1,"__proto__":{}')))
  assert.equal({}.polluted,undefined)
})

test('file size is bounded by UTF-8 bytes before parsing',()=>{
  assert.throws(()=>parseComponentFormFile(' '.repeat(MAX_COMPONENT_FORM_BYTES+1)),/64 KB/)
  const wide='ह'.repeat(Math.ceil(MAX_COMPONENT_FORM_BYTES/3))
  assert.ok(wide.length<MAX_COMPONENT_FORM_BYTES)
  assert.throws(()=>parseComponentFormFile(wide),/64 KB/)
})

test('generated studies sharing an ID cannot silently exchange differently named house forms',()=>{
  const jaipur={...house(),name:'Jaipur house study'},delhi={...house(),name:'Delhi house study'}
  const file=packet(jaipur)
  assert.equal(jaipur.id,delhi.id)
  assert.throws(()=>reviewComponentFormFile(delhi,file),/different house/)
  assert.throws(()=>restoreComponentFormFile(delhi,{},file),/different house/)
  assert.equal(file.buildingName,jaipur.name)
})
