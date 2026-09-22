import assert from 'node:assert/strict'
import test from 'node:test'
import { probeRenderer, RENDER_SERVICE } from '../src/spatial/renderer-health.js'

test('renderer probe recognizes only a successful local service response without credentials',async()=>{
  assert.equal(await probeRenderer({fetchImpl:async(url,options)=>{
    assert.equal(url,`${RENDER_SERVICE}/health`)
    assert.equal(options.credentials,'omit')
    assert.equal(options.headers,undefined)
    return new Response(JSON.stringify({service:'grihagrid-local-renderer'}))
  }}),true)
  for(const response of [new Response('{}'),new Response('bad JSON'),new Response('{"service":"grihagrid-local-renderer"}',{status:403})]) {
    assert.equal(await probeRenderer({fetchImpl:async()=>response}),false)
  }
  assert.equal(await probeRenderer({fetchImpl:async()=>{throw Error('offline')}}),false)
})
test('renderer probe settles when the fetch ignores cancellation',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let signal
  const pending=probeRenderer({fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{})}})
  t.mock.timers.tick(7999)
  assert.equal(signal.aborted,false)
  t.mock.timers.tick(1)
  assert.equal(await pending,false)
  assert.equal(signal.aborted,true)
})
test('renderer probe bounds response-body parsing and ignores late completion',async t=>{
  t.mock.timers.enable({apis:['setTimeout']})
  let finishBody,signal
  const pending=probeRenderer({fetchImpl:async(_url,options)=>{signal=options.signal;return {ok:true,json:()=>new Promise(resolve=>{finishBody=resolve})}}})
  await Promise.resolve()
  t.mock.timers.tick(8000)
  assert.equal(await pending,false)
  assert.equal(signal.aborted,true)
  finishBody({service:'grihagrid-local-renderer'})
  await Promise.resolve()
})
test('renderer probe cancels when its panel closes or pairs; later probes can succeed',async()=>{
  const controller=new AbortController()
  let signal
  const pending=probeRenderer({signal:controller.signal,fetchImpl:async(_url,options)=>{signal=options.signal;return new Promise(()=>{})}})
  controller.abort()
  assert.equal(await pending,false)
  assert.equal(signal.aborted,true)
  assert.equal(await probeRenderer({signal:controller.signal,fetchImpl:()=>{assert.fail('aborted probes must not fetch')}}),false)
  assert.equal(await probeRenderer({fetchImpl:async()=>new Response('{"service":"grihagrid-local-renderer"}')}),true)
})
