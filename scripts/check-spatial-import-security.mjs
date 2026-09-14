import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const origin=process.env.SPATIAL_UI_ORIGIN||'http://127.0.0.1:5277';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname));
const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
page.on('request',r=>{if(r.url().startsWith('http')&&new URL(r.url()).origin!==origin)external.push(new URL(r.url()).origin)});
try{
  // A blank local route keeps this security check independent of WebGL/HMR UI state.
  await page.route(origin+'/__spatial_security_test',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Local drawing security check</title>'}));
  await page.goto(origin+'/__spatial_security_test');
  const result=await page.evaluate(async()=>{
    const {sanitizedSvg}=await import('/src/spatial/drawing-svg.js');
    const plain='<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect x="20" y="20" width="360" height="260" fill="white" stroke="black" stroke-width="8"/></svg>';
    const hostile=plain.replace('<rect','<script>window.__drawingExecuted=true</script><foreignObject><iframe src="https://blocked.example.test/frame"/></foreignObject><image href="https://blocked.example.test/pixel"/><use href="https://blocked.example.test/use"/><style>@import "https://blocked.example.test/style";</style><rect onload="window.__drawingExecuted=true" style="fill:url(https://blocked.example.test/fill)"');
    const safe= sanitizedSvg(hostile),doc=new DOMParser().parseFromString(safe,'image/svg+xml');
    const forbidden=doc.querySelectorAll('script,foreignObject,iframe,image,use,style,object,embed').length;
    const activeAttributes=[...doc.querySelectorAll('*')].flatMap(node=>[...node.attributes]).filter(a=>/^on|href|src|style/i.test(a.name)||a.value.includes('blocked.example.test')).length;
    const rasterize=async text=>{const url=URL.createObjectURL(new Blob([text],{type:'image/svg+xml'}));try{const img=new Image();await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;img.src=url});const canvas=document.createElement('canvas');canvas.width=400;canvas.height=300;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return [...ctx.getImageData(20,50,1,1).data]}finally{URL.revokeObjectURL(url)}};
    const normalPixel=await rasterize(sanitizedSvg('<?xml version="1.0" encoding="UTF-8"?>'+plain)),sanitizedPixel=await rasterize(safe);
    let rejectedEntities=false,rejectedNonSvg=false;
    try{sanitizedSvg('<!DOCTYPE svg [<!ENTITY test "secret">]>'+plain)}catch{rejectedEntities=true}
    try{sanitizedSvg('<html><body>not a plan</body></html>')}catch{rejectedNonSvg=true}
    return {forbidden,activeAttributes,normalPixel,sanitizedPixel,rejectedEntities,rejectedNonSvg,executed:window.__drawingExecuted===true};
  });
  assert.equal(result.forbidden,0);assert.equal(result.activeAttributes,0);assert.equal(result.executed,false);
  assert.deepEqual(result.sanitizedPixel,result.normalPixel);assert.ok(result.normalPixel[0]<20&&result.normalPixel[3]===255);
  assert.equal(result.rejectedEntities,true);assert.equal(result.rejectedNonSvg,true);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  const output=new URL('../qa-artifacts/spatial-import-security/',import.meta.url);await mkdir(output,{recursive:true});
  await writeFile(new URL('verification.json',output),JSON.stringify({result,errors,external},null,2));console.log(JSON.stringify({result,errors,external},null,2));
}finally{await browser.close()}
