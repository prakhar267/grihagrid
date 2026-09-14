import assert from 'node:assert/strict'
import {readFile,readdir} from 'node:fs/promises'
import test from 'node:test'
import {Miniflare} from 'miniflare'
import worker from '../worker/index.js'
import {createDemoBuilding,resizeBuilding} from '../src/spatial/model.js'
import {generateTour,retimeTour} from '../src/spatial/tours.js'

const ORIGIN='https://app.example.test'
class MemoryKv {constructor(){this.data=new Map()}async get(k){return this.data.get(k)||null}async put(k,v){this.data.set(k,v)}}
function statements(source) {
  const result=[];let lines=[],trigger=false
  for(const raw of source.split(/\r?\n/)){const line=raw.trim();if(!line||line.startsWith('--')||/^PRAGMA\s+/i.test(line))continue;if(!lines.length)trigger=/^CREATE\s+TRIGGER\b/i.test(line);lines.push(raw);if(trigger?/\bEND;\s*$/i.test(line):/;\s*$/.test(line)){result.push(lines.join('\n'));lines=[];trigger=false}}
  assert.equal(lines.length,0,'Incomplete migration statement');return result
}
function request(path,owner,body,{method=body===undefined?'GET':'POST',key=crypto.randomUUID(),origin=ORIGIN,csrf=owner?.csrfToken}={}) {
  const headers={origin,'content-type':'application/json','idempotency-key':key}
  if(owner){headers.cookie=owner.cookies;if(csrf)headers['x-csrf-token']=csrf}
  return new Request(ORIGIN+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function expect(response,status){assert.equal(response.status,status,JSON.stringify(await response.clone().json()));return response.json()}
async function owner(env,email) {
  const registered=await worker.fetch(request('/api/auth/register',null,{email,password:'correct horse battery staple'}),env)
  const registration=await expect(registered,201)
  const auth={cookies:registered.headers.getSetCookie().map(v=>v.split(';',1)[0]).join('; '),csrfToken:registration.csrfToken}
  const created=await worker.fetch(request('/api/projects',auth,{name:'Private spatial test house',input:{width:30,length:50,floors:'G+1',city:'Pune',quality:'Signature',style:'PRIVATE-NOTE-NOT-FOR-AI'}}),env)
  auth.project=(await expect(created,201)).project;return auth
}
const providerResponse=intent=>new Response(JSON.stringify({status:'completed',steps:[{type:'model_output',content:[{type:'text',text:JSON.stringify(intent)}]}]}),{headers:{'content-type':'application/json'}})

test('spatial workspace enforces authenticated ownership, immutable real-D1 revisions and safe AI intent',async context=>{
  const mf=new Miniflare({workers:[{config:{name:'spatial-api-test',type:'worker',compatibilityDate:'2026-08-01',manifest:{mainModule:'index.mjs',modulesRoot:process.cwd(),modules:{'index.mjs':{type:'esm',contents:'export default {}'}}},env:{DB:{type:'d1',name:'spatial-api-test-db'}}}}]})
  context.after(()=>mf.dispose())
  const db=await mf.getD1Database('DB')
  const migrationRoot=new URL('../migrations/',import.meta.url)
  for(const file of (await readdir(migrationRoot)).filter(f=>f.endsWith('.sql')).sort())for(const sql of statements(await readFile(new URL(file,migrationRoot),'utf8')))await db.prepare(sql).run()
  const env={DB:db,ASSETS:{fetch:async()=>new Response('missing',{status:404})},GRIHAGRID_CACHE:new MemoryKv()}
  const user=await owner(env,'spatial-owner@example.test'),other=await owner(env,'spatial-other@example.test'),path=`/api/projects/${user.project.id}/spatial`
  const count=async table=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first()).n
  let savedModel,savedTour,spatialRevision=0,tourRevision=0
  const base=()=>({expectedInputRevision:1,expectedSpatialRevision:spatialRevision})

  await context.test('empty GET never creates a concept and origin, CSRF and ownership fail closed',async()=>{
    await expect(await worker.fetch(request(path),env),401)
    await expect(await worker.fetch(request(path,other),env),404)
    const empty=await expect(await worker.fetch(request(path,user),env),200)
    assert.equal(empty.model,null);assert.equal(empty.spatialRevision,0);assert.deepEqual(empty.history,[])
    assert.equal(await count('spatial_revisions'),0)
    await expect(await worker.fetch(request(path+'/preview',user,{...base(),model:createDemoBuilding()},{csrf:''}),env),403)
    await expect(await worker.fetch(request(path+'/preview',user,{...base(),model:createDemoBuilding()},{origin:'https://evil.example'}),env),403)
    await expect(await worker.fetch(request(path+'/preview',other,{...base(),model:createDemoBuilding()}),env),404)
    assert.equal(await count('spatial_revisions'),0)
  })

  await context.test('Change Study, explicit acceptance, idempotency and immutable source revision',async()=>{
    const model=createDemoBuilding(),preview=await expect(await worker.fetch(request(path+'/preview',user,{...base(),model}),env),200)
    assert.equal(preview.changeStudy.estimateUnchanged,true);assert.equal(preview.proposedRevision,1)
    assert.equal(await count('spatial_revisions'),0)
    await expect(await worker.fetch(request(path,user,{...base(),model,acceptedImpact:false}),env),400)
    const unknown=structuredClone(model);unknown.privateInstructions='must be rejected'
    await expect(await worker.fetch(request(path+'/preview',user,{...base(),model:unknown}),env),400)
    const body={...base(),model,acceptedImpact:true},key='initial-spatial-save'
    const saved=await expect(await worker.fetch(request(path,user,body,{key}),env),201)
    savedModel=saved.model;spatialRevision=saved.spatialRevision
    assert.equal(spatialRevision,1);assert.equal(saved.sourceInputRevision,1)
    assert.equal((await expect(await worker.fetch(request(path,user,body,{key}),env),200)).spatialRevision,1)
    await expect(await worker.fetch(request(path,user,{...body,model:{...model,name:'A different concept'}},{key}),env),409)
    await expect(await worker.fetch(request(path,user,body),env),409)
    assert.equal(await count('spatial_revisions'),1)
    await assert.rejects(()=>db.prepare('UPDATE spatial_revisions SET model_json=? WHERE project_id=?').bind('{}',user.project.id).run(),/immutable/)
    assert.equal((await db.prepare('SELECT input_revision FROM projects WHERE id=?').bind(user.project.id).first()).input_revision,1)
  })

  await context.test('tours save separately, reject fabricated data and fence concurrent edits',async()=>{
    savedTour=generateTour(savedModel,{roomIds:['living','kitchen','main-bedroom'],duration:24,includeExterior:false})
    const malicious=structuredClone(savedTour);malicious.shots[0].script='arbitrary code'
    await expect(await worker.fetch(request(path+'/tour',user,{...base(),expectedTourRevision:0,tour:malicious}),env),400)
    const body={...base(),expectedTourRevision:0,tour:savedTour},key='initial-camera-save'
    const saved=await expect(await worker.fetch(request(path+'/tour',user,body,{key}),env),201)
    tourRevision=saved.tourRevision;assert.equal(tourRevision,1)
    await expect(await worker.fetch(request(path+'/tour',user,body,{key}),env),200)
    const results=await Promise.all([4,5].map(seconds=>worker.fetch(request(path+'/tour',user,{...base(),expectedTourRevision:1,tour:retimeTour(savedTour,savedTour.shots[0].id,seconds)}),env)))
    assert.deepEqual(results.map(r=>r.status).sort(),[201,409])
    assert.equal(await count('spatial_tour_revisions'),2);tourRevision=2
    await assert.rejects(()=>db.prepare('UPDATE spatial_tour_revisions SET tour_json=? WHERE project_id=?').bind('{}',user.project.id).run(),/immutable/)
  })

  await context.test('Gemini fails closed without config, validates aliases and sends no private metadata',async()=>{
    const body={...base(),acceptedAiTerms:true,intent:{roomIds:['living','kitchen'],duration:30}}
    const absent=await expect(await worker.fetch(request(path+'/tour-intent',user,body),env),503)
    assert.equal(absent.code,'ai_unavailable')
    env.GEMINI_API_KEY='server-only-spatial-gemini-key'
    await expect(await worker.fetch(request(path+'/tour-intent',user,{...body,acceptedAiTerms:false}),env),400)
    await expect(await worker.fetch(request(path+'/tour-intent',user,{...body,intent:{roomIds:['pool'],duration:30}}),env),400)
    env.GEMINI_FETCH=async()=>providerResponse({roomIds:['room-999'],duration:30})
    await expect(await worker.fetch(request(path+'/tour-intent',user,body),env),502)
    let providerBody
    env.GEMINI_FETCH=async(_url,init)=>{providerBody=init.body;return providerResponse({roomIds:['room-1','room-2'],duration:30})}
    const result=await expect(await worker.fetch(request(path+'/tour-intent',user,body),env),200)
    assert.deepEqual(result.intent.roomIds,['living','kitchen']);assert.equal(result.source,'gemini')
    assert.ok(!providerBody.includes('PRIVATE-NOTE'));assert.ok(!providerBody.includes('Private spatial'));assert.ok(!providerBody.includes('Living room'));assert.ok(!providerBody.includes('main-bedroom'))
    assert.equal(JSON.parse(providerBody).store,false)
    env.GEMINI_FETCH=async()=>{throw new Error('upstream private detail')}
    const failed=await expect(await worker.fetch(request(path+'/tour-intent',user,body),env),503)
    assert.equal(failed.code,'tour_ai_unavailable');assert.ok(!JSON.stringify(failed).includes('private detail'))
    assert.equal(await count('ai_generation_leases'),0)
  })

  await context.test('concurrent layout saves have one winner and old tours become stale',async()=>{
    const firstStored=await db.prepare('SELECT model_json FROM spatial_revisions WHERE project_id=? AND revision=1').bind(user.project.id).first()
    const responses=await Promise.all([13000,14000].map(width=>worker.fetch(request(path,user,{...base(),model:resizeBuilding(savedModel,{width}),acceptedImpact:true}),env)))
    assert.deepEqual(responses.map(r=>r.status).sort(),[201,409])
    const current=await expect(await worker.fetch(request(path,user),env),200)
    spatialRevision=current.spatialRevision;savedModel=current.model
    assert.equal(spatialRevision,2);assert.equal(current.tourStale,true);assert.equal(current.history.length,2)
    assert.equal((await db.prepare('SELECT model_json FROM spatial_revisions WHERE project_id=? AND revision=1').bind(user.project.id).first()).model_json,firstStored.model_json)
    await expect(await worker.fetch(request(path+'/tour',user,{...base(),expectedTourRevision:tourRevision,tour:savedTour}),env),400)
  })

  await context.test('brief changes mark concepts stale and prevent tour saves until reviewed',async()=>{
    let notifyStarted,releaseProvider
    const started=new Promise(resolve=>{notifyStarted=resolve}),gate=new Promise(resolve=>{releaseProvider=resolve})
    env.GEMINI_FETCH=async()=>{notifyStarted();await gate;return providerResponse({roomIds:['room-1','room-2'],duration:30})}
    const inFlight=worker.fetch(request(path+'/tour-intent',user,{...base(),acceptedAiTerms:true,intent:{roomIds:['living','kitchen'],duration:30}}),env)
    await started
    const revised=await expect(await worker.fetch(request(`/api/projects/${user.project.id}`,user,{expectedInputRevision:1,input:{bathrooms:4}},{method:'PATCH'}),env),200)
    releaseProvider()
    const superseded=await expect(await inFlight,409)
    assert.equal(superseded.code,'spatial_revision_conflict')
    assert.equal(await count('ai_generation_leases'),0)
    assert.equal(revised.project.inputRevision,2)
    const current=await expect(await worker.fetch(request(path,user),env),200)
    assert.equal(current.stale,true);assert.equal(current.tourStale,true)
    const freshTour=generateTour(savedModel,{roomIds:['living','kitchen'],includeExterior:false})
    const failed=await expect(await worker.fetch(request(path+'/tour',user,{expectedInputRevision:2,expectedSpatialRevision:spatialRevision,expectedTourRevision:tourRevision,tour:freshTour}),env),409)
    assert.equal(failed.code,'spatial_source_stale')
    const ai=await expect(await worker.fetch(request(path+'/tour-intent',user,{expectedInputRevision:2,expectedSpatialRevision:spatialRevision,acceptedAiTerms:true,intent:{roomIds:['living'],duration:30}}),env),409)
    assert.equal(ai.code,'spatial_source_stale')
  })

  await context.test('archived projects remain readable but cannot accept spatial writes',async()=>{
    await expect(await worker.fetch(request(`/api/projects/${user.project.id}`,user,{status:'archived'},{method:'PATCH'}),env),200)
    assert.equal((await expect(await worker.fetch(request(path,user),env),200)).project.status,'archived')
    const before=await count('spatial_revisions')
    await expect(await worker.fetch(request(path+'/preview',user,{expectedInputRevision:2,expectedSpatialRevision:2,model:savedModel}),env),409)
    assert.equal(await count('spatial_revisions'),before)
  })
})
