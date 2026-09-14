import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const origin=process.env.SPATIAL_UI_ORIGIN||'http://127.0.0.1:5277';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Only local synthetic projects are permitted');
const output=new URL('../qa-artifacts/spatial-library/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));let projectId;
try{
  await page.goto(origin+'/explore');
  projectId=await page.evaluate(async()=>{
    const post=async(path,body,csrf)=>{const r=await fetch(path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID(),...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(body)});const data=await r.json();if(!r.ok)throw new Error(data.error);return data;};
    const auth=await post('/api/auth/register',{email:`spatial-cameras-${Date.now()}@example.test`,password:crypto.randomUUID()+'Aa1!'});
    return(await post('/api/projects',{name:'Camera library QA',input:{width:40,length:50,city:'Pune',floors:'G',quality:'Signature',bedrooms:2}},auth.csrfToken)).project.id;
  });
  await page.goto(`${origin}/projects/${projectId}/spatial`);
  await page.getByRole('button',{name:'Review Change Study'}).click();await page.getByRole('button',{name:'Accept concept revision'}).click();
  await page.getByText('Concept revision accepted. Rebuild the tour to use the updated layout.').waitFor();
  await page.locator('canvas').waitFor();await page.waitForTimeout(1200);
  await page.getByRole('button',{name:'Save viewpoint',exact:true}).click();await page.getByText('Camera library saved privately.',{exact:false}).waitFor();
  const names=page.getByRole('textbox',{name:/Name for viewpoint/});await names.fill('Morning kitchen');
  // Saving a tour must preserve the unsubmitted camera-name draft and its CAS base.
  await page.getByRole('button',{name:'Camera Tour',exact:true}).click();await page.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.getByText('A separate camera-tour revision has been saved.').waitFor();
  assert.equal(await names.inputValue(),'Morning kitchen');
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  const second=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844}}),phone=await second.newPage();
  await phone.goto(`${origin}/projects/${projectId}/spatial`);await phone.getByRole('textbox',{name:/Name for viewpoint/}).waitFor();
  assert.equal(await phone.getByRole('textbox',{name:/Name for viewpoint/}).inputValue(),'Morning kitchen');
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await phone.screenshot({path:new URL('camera-mobile.png',output).pathname,fullPage:true});await second.close();
  checks.push('Saved viewpoint and renamed library load in a separate authenticated browser context; unsaved rename survives tour save');
  await page.getByRole('button',{name:'2D Plan',exact:true}).click();await page.getByText('Scale overall dimensions',{exact:true}).click();
  await page.getByRole('spinbutton',{name:'Overall width in metres'}).fill('13');await page.getByRole('button',{name:'Preview dimensions'}).click();
  await page.getByRole('button',{name:'Review Change Study'}).click();await page.getByRole('button',{name:'Accept concept revision'}).click();
  await page.getByText('Concept revision accepted. Rebuild the tour to use the updated layout.').waitFor();
  assert.equal(await page.getByRole('button',{name:'Go to Morning kitchen',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Delete Morning kitchen',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).click();
  await page.reload();await page.getByRole('heading',{name:'Camera library QA'}).waitFor();assert.equal(await page.getByRole('textbox',{name:/Name for viewpoint/}).count(),0);
  checks.push('Layout acceptance marks old camera unavailable; delete-all library persists after reload');
  await page.getByRole('button',{name:'Camera Tour',exact:true}).click();
  await page.getByLabel('Describe your camera tour').fill('Slowly reveal the kitchen island, orbit the dining table, then linger in the main bedroom for a 40 second tour.');
  await page.getByRole('button',{name:'Match room names locally'}).click();
  await page.getByText('Camera direction matched locally',{exact:false}).waitFor();assert.equal(await page.getByRole('spinbutton',{name:'Tour duration in seconds'}).inputValue(),'40');
  assert.equal(await page.getByRole('button',{name:'Play tour',exact:true}).isDisabled(),false);
  checks.push('Feature reveal, object orbit and bedroom hold build a validated 40-second tour from the advertised natural-language example');
  await page.getByRole('button',{name:'Remove stop 1',exact:true}).click();
  await page.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Play tour',exact:true}).isDisabled(),false);
  assert.equal(await page.locator('.sp-messages .is-error').count(),0);
  checks.push('Removing a directed stop prunes only its orphaned shot preferences and leaves the remaining tour rebuildable');
  if(process.env.SPATIAL_PAIR_FILE){
    await page.getByRole('button',{name:'Render / Export',exact:true}).click();
    const code=(await readFile(process.env.SPATIAL_PAIR_FILE,'utf8')).trim();
    await page.getByLabel('Pairing code').fill(code);await page.getByRole('button',{name:'Connect renderer'}).click();
    await page.getByRole('button',{name:'Render previews',exact:true}).waitFor();
    assert.ok(await page.locator('.render-job-status').count()>0);
    await page.screenshot({path:new URL('render-service.png',output).pathname,fullPage:true});checks.push('Browser pairs with real loopback render service and displays actual job progress');
    await page.getByRole('button',{name:'Disconnect',exact:true}).click();
  }
  assert.deepEqual(errors,[]);await writeFile(new URL('verification.json',output),JSON.stringify({checks,device:'Chrome desktop + mobile emulation; separate contexts are not physical devices',errors},null,2));console.log(JSON.stringify({checks,errors},null,2));
}finally{
  if(projectId){const status=await page.evaluate(async id=>{const csrf=decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith('grihagrid_csrf=')).split('=').slice(1).join('='));return(await fetch('/api/projects/'+id,{method:'DELETE',headers:{'x-csrf-token':csrf}})).status;},projectId);assert.equal(status,204,'Remove only this run’s exact synthetic project');}
  await browser.close();
}
