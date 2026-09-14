import assert from 'node:assert/strict'
import test from 'node:test'
import {mkdtemp,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import path from 'node:path'
import {randomBytes} from 'node:crypto'
import {startRenderService} from '../scripts/spatial/service.mjs'
import {createDemoBuilding} from '../src/spatial/model.js'
import {generateTour} from '../src/spatial/tours.js'

const ORIGIN='http://127.0.0.1:5277'
const waitFor=async(fn,predicate)=>{for(let i=0;i<200;i++){const result=await fn();if(predicate(result))return result;await new Promise(resolve=>setTimeout(resolve,10))}throw new Error('Service state did not settle')}

test('rejected resume admission leaves the original attempt and persistent recovery state unchanged',async()=>{
  const rootDirectory=await mkdtemp(path.join(tmpdir(),'grihagrid-resume-admission-'))
  let calls=0
  const code=randomBytes(24).toString('base64url')
  const service=await startRenderService({rootDirectory,port:0,checkDependencies:false,checkDisk:false,allowedOrigins:[ORIGIN],pairingCode:code,executor:async(options,progress,signal)=>{
    if(++calls===1)throw new Error('Synthetic incomplete construction')
    if(signal.aborted)throw new Error('Stopped')
    await new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Error('Stopped')),{once:true}))
  }})
  try {
    const headers={Origin:ORIGIN,'Content-Type':'application/json'}
    assert.equal(await readFile(service.pairingFile,'utf8'),code)
    const paired=await fetch(service.origin+'/pair',{method:'POST',headers,body:JSON.stringify({code})})
    assert.equal(paired.status,200);headers.Authorization='Bearer '+(await paired.json()).token
    const request=(endpoint,body)=>fetch(service.origin+endpoint,{method:body?'POST':'GET',headers,...(body?{body:JSON.stringify(body)}:{})})
    const model=createDemoBuilding(),body={model,tour:generateTour(model,{duration:10}),settings:{mode:'scene',samples:4}}
    const first=await request('/jobs',body);assert.equal(first.status,201)
    const {job}=await first.json(),jobs=async()=> (await(await request('/jobs')).json()).jobs
    await waitFor(async()=> (await jobs()).find(item=>item.id===job.id),item=>item.status==='failed')
    const recordPath=path.join(rootDirectory,'jobs',job.id,'record.json'),recordBefore=await waitFor(()=>readFile(recordPath,'utf8'),value=>JSON.parse(value).status==='failed')
    const before=(await jobs()).find(item=>item.id===job.id)
    for(let i=0;i<4;i++)assert.equal((await request('/jobs',body)).status,201)
    assert.equal((await jobs()).filter(item=>['running','queued','cancelling'].includes(item.status)).length,4)
    for(let i=0;i<3;i++)assert.equal((await request(`/jobs/${job.id}/resume`,{})).status,429)
    assert.deepEqual((await jobs()).find(item=>item.id===job.id),before)
    assert.equal(await readFile(recordPath,'utf8'),recordBefore)
    // Free one queued slot: exactly one admitted restart may advance the attempt.
    const queued=(await jobs()).find(item=>item.status==='queued')
    assert.equal((await request(`/jobs/${queued.id}/cancel`,{})).status,200)
    assert.equal((await request(`/jobs/${job.id}/resume`,{})).status,200)
    const admitted=(await jobs()).find(item=>item.id===job.id)
    assert.equal(admitted.attempt,before.attempt+1);assert.equal(admitted.status,'queued')
    assert.equal(JSON.parse(await readFile(recordPath,'utf8')).attempt,admitted.attempt)
  }finally{await service.close();await rm(rootDirectory,{recursive:true,force:true})}
})
