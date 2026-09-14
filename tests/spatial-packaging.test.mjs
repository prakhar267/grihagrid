import assert from 'node:assert/strict';
import test from 'node:test';
import {cp,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import worker from '../worker/index.js';

test('packaged spatial Worker resolves without checkout dependencies',async t=>{
  const directory=await mkdtemp(path.join(tmpdir(),'grihagrid-isolated-package-'));t.after(()=>rm(directory,{recursive:true,force:true}));
  for(const name of ['server','src','vendor'])await cp(new URL(`../dist/${name}/`,import.meta.url),path.join(directory,name),{recursive:true});
  await writeFile(path.join(directory,'package.json'),JSON.stringify({type:'module'}));
  const packaged=await import(pathToFileURL(path.join(directory,'server/index.js')));
  assert.equal(typeof packaged.default.fetch,'function');
  const model=await import(pathToFileURL(path.join(directory,'src/spatial/model.js')));
  assert.equal(model.validateBuilding(model.createMultiFloorDemo()).valid,true);
  assert.ok(model.buildPrimitives(model.createMultiFloorDemo()).some(p=>p.kind==='mesh'));
  assert.match(await readFile(path.join(directory,'vendor/three/extras/LICENSE-EARCUT.txt'),'utf8'),/ISC License/);
});

test('studio document CSP permits local OCR and paired renderer without enabling foreign scripts',async()=>{
  const response=await worker.fetch(new Request('https://app.example.test/explore'),{ASSETS:{fetch:async()=>new Response('<!doctype html><html><head><title>GrihaGrid</title></head><body><div id="root"></div></body></html>',{headers:{'content-type':'text/html'}})}});
  assert.equal(response.status,200);
  const policy=response.headers.get('content-security-policy'),directives=Object.fromEntries(policy.split(';').map(value=>value.trim().split(/\s+/)).filter(a=>a[0]).map(([name,...values])=>[name,values]));
  assert.deepEqual(directives['script-src'],["'self'","'wasm-unsafe-eval'"]);
  assert.deepEqual(directives['worker-src'],["'self'",'blob:']);
  assert.deepEqual(directives['connect-src'],["'self'",'http://127.0.0.1:43127']);
  assert.deepEqual(directives['object-src'],["'none'"]);
  assert.deepEqual(directives['frame-ancestors'],["'none'"]);
});
