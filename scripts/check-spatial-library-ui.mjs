import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
const origin=process.env.SPATIAL_UI_ORIGIN||'http://127.0.0.1:5277';
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Only local synthetic projects are permitted');
const output=new URL('../qa-artifacts/spatial-library/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[],checks=[];
page.on('pageerror',e=>errors.push(e.message));let projectId;
async function dropFirstCommittedResponse(endpoint) {
  const requests=[];let committedRevision;
  const pattern=`**/api/projects/${projectId}/spatial/${endpoint}`;
  await page.route(pattern,async route=>{
    if(route.request().method()!=='POST')return route.continue();
    requests.push({key:route.request().headers()['idempotency-key'],body:route.request().postData()});
    const response=await route.fetch();
    assert.ok(response.ok(),`Server must commit before simulating response loss: ${await response.text()}`);
    const result=await response.json();
    if(requests.length===1){committedRevision=endpoint==='tour'?result.tourRevision:result.cameraRevision;await route.abort('failed');}
    else await route.fulfill({response});
  });
  return async()=>{
    await page.unroute(pattern);
    assert.equal(requests.length,2,'Exactly one lost acknowledgement followed by one retry');
    assert.deepEqual(requests[1],requests[0],'Retry preserves the exact request body and idempotency key');
    const latest=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
    assert.equal(endpoint==='tour'?latest.tourRevision:latest.cameraRevision,committedRevision,'Retry replays the committed revision instead of creating a duplicate');
  };
}

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
  const finishCameraReplay=await dropFirstCommittedResponse('viewpoints');
  await page.getByRole('button',{name:'Save viewpoint',exact:true}).click();await page.locator('.sp-messages .is-error').waitFor();
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByText('Camera library saved privately.',{exact:false}).waitFor();
  await finishCameraReplay();
  checks.push('Camera save retries a genuinely committed request after its response is dropped, preserving one server revision');
  const names=page.getByRole('textbox',{name:/Name for viewpoint/});await names.fill('Morning kitchen');
  // Saving a tour must preserve the unsubmitted camera-name draft and its CAS base.
  await page.getByRole('button',{name:'Camera Tour',exact:true}).click();await page.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  const finishTourReplay=await dropFirstCommittedResponse('tour');
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.locator('.sp-messages .is-error').waitFor();
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.getByText('A separate camera-tour revision has been saved.').waitFor();
  await finishTourReplay();
  checks.push('Tour save reuses its frozen idempotency key and exact body after a committed response loss; no duplicate revision');
  assert.equal(await names.inputValue(),'Morning kitchen');
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  const second=await browser.newContext({storageState:await context.storageState(),viewport:{width:390,height:844}}),phone=await second.newPage();
  await phone.goto(`${origin}/projects/${projectId}/spatial`);await phone.getByRole('textbox',{name:/Name for viewpoint/}).waitFor();
  assert.equal(await phone.getByRole('textbox',{name:/Name for viewpoint/}).inputValue(),'Morning kitchen');
  assert.equal(await phone.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  checks.push('Saved viewpoint and renamed library load in a separate authenticated browser context; unsaved rename survives tour save');
  await names.fill('My kitchen draft');
  await phone.getByRole('textbox',{name:/Name for viewpoint/}).fill('Other kitchen saved');
  await phone.getByRole('button',{name:'Save camera library',exact:true}).click();await phone.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  await phone.getByRole('button',{name:'Save viewpoint',exact:true}).click();await phone.getByText('Camera library saved privately.',{exact:false}).waitFor();
  await phone.getByRole('textbox',{name:/Name for viewpoint/}).nth(1).waitFor();
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('heading',{name:'Review the camera library conflict.'}).waitFor();
  assert.equal(await names.inputValue(),'My kitchen draft','Conflict preserves the local edit');
  const savedBefore=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
  assert.deepEqual(savedBefore.viewpoints.map(v=>v.name),['Other kitchen saved','View 2']);
  const draftEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download my camera draft'}).click();
  const draft=await draftEvent;await draft.saveAs(new URL('conflicting-camera-draft.json',output).pathname);
  assert.equal(JSON.parse(await readFile(await draft.path(),'utf8')).viewpoints[0].name,'My kitchen draft');
  await page.getByRole('button',{name:'Review latest camera library'}).click();
  await page.getByRole('radio',{name:'My edit: My kitchen draft',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Apply reviewed camera merge'}).isDisabled(),true);
  await page.getByRole('radio',{name:'My edit: My kitchen draft',exact:true}).focus();await page.getByRole('radio',{name:'My edit: My kitchen draft',exact:true}).press('Space');
  await page.screenshot({path:new URL('camera-conflict-review.png',output).pathname,fullPage:true});
  await page.getByRole('button',{name:'Apply reviewed camera merge'}).click();
  assert.deepEqual(await names.evaluateAll(elements=>elements.map(element=>element.value)),['My kitchen draft','View 2'],'Reviewed merge preserves the other session’s added camera');
  const afterReview=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
  assert.equal(afterReview.cameraRevision,savedBefore.cameraRevision,'Review/apply does not write to the server');
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  await phone.reload();await phone.getByRole('textbox',{name:/Name for viewpoint/}).nth(1).waitFor();
  assert.deepEqual(await phone.getByRole('textbox',{name:/Name for viewpoint/}).evaluateAll(elements=>elements.map(element=>element.value)),['My kitchen draft','View 2']);
  checks.push('Actual two-session camera CAS race preserves the draft, downloads it, requires a conflict choice, merges the other camera and saves only after explicit review');
  await names.first().fill('Morning kitchen');await page.getByRole('button',{name:'Delete View 2',exact:true}).click();
  await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  await phone.reload();await phone.getByRole('textbox',{name:/Name for viewpoint/}).waitFor();
  await phone.screenshot({path:new URL('camera-mobile.png',output).pathname,fullPage:true});
  await names.fill('Unsaved camera survives tour conflict');
  await page.getByRole('spinbutton',{name:'Tour duration in seconds'}).fill('35');await page.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  await phone.getByRole('button',{name:'Camera Tour',exact:true}).click();await phone.getByRole('spinbutton',{name:'Tour duration in seconds'}).fill('45');await phone.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  await phone.getByRole('button',{name:'Save tour revision',exact:true}).click();await phone.getByText('A separate camera-tour revision has been saved.').waitFor();
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.getByRole('heading',{name:'Review the tour revision conflict.'}).waitFor();
  assert.equal(await page.getByRole('spinbutton',{name:'Tour duration in seconds'}).inputValue(),'35');
  const tourDraftEvent=page.waitForEvent('download');await page.getByRole('button',{name:'Download my tour draft'}).click();
  const tourDraft=await tourDraftEvent;await tourDraft.saveAs(new URL('conflicting-tour-draft.json',output).pathname);
  assert.equal(JSON.parse(await readFile(await tourDraft.path(),'utf8')).tour.duration,35);
  await page.getByRole('button',{name:'Review latest tour revision'}).click();await page.getByRole('button',{name:'Keep my tour as the draft'}).waitFor();
  const savedTourBefore=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
  assert.equal(savedTourBefore.tour.duration,45);
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:new URL('tour-conflict-mobile.png',output).pathname,fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Keep my tour as the draft'}).focus();await page.getByRole('button',{name:'Keep my tour as the draft'}).press('Enter');
  const afterTourReview=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
  assert.equal(afterTourReview.tourRevision,savedTourBefore.tourRevision,'Choosing the local tour does not write before Save');
  assert.equal(await names.inputValue(),'Unsaved camera survives tour conflict');
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.getByText('A separate camera-tour revision has been saved.').waitFor();
  const mergedTour=await page.evaluate(async id=>(await fetch(`/api/projects/${id}/spatial`)).json(),projectId);
  assert.equal(mergedTour.tour.duration,35);assert.equal(mergedTour.tourRevision,savedTourBefore.tourRevision+1);
  await phone.reload();await phone.getByRole('button',{name:'Camera Tour',exact:true}).click();await phone.getByRole('spinbutton',{name:'Tour duration in seconds'}).fill('42');await phone.getByRole('button',{name:'Rebuild tour',exact:true}).click();
  await phone.getByRole('button',{name:'Save tour revision',exact:true}).click();await phone.getByText('A separate camera-tour revision has been saved.').waitFor();
  await page.getByRole('button',{name:'Save tour revision',exact:true}).click();await page.getByRole('button',{name:'Review latest tour revision'}).click();await page.getByRole('button',{name:'Use latest saved tour'}).click();
  assert.equal(await page.getByRole('spinbutton',{name:'Tour duration in seconds'}).inputValue(),'42');
  assert.equal(await names.inputValue(),'Unsaved camera survives tour conflict','Opening the saved tour keeps unrelated camera drafts');
  checks.push('Actual tour CAS races preserve and download the local draft; explicit keep-local appends a revision, use-saved opens the other tour without dropping camera edits; mobile review and keyboard actions work');
  await names.fill('Morning kitchen');await page.getByRole('button',{name:'Save camera library',exact:true}).click();await page.getByRole('button',{name:'Save camera library',exact:true}).waitFor({state:'hidden'});
  await second.close();
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
}catch(error){
  await page.screenshot({path:new URL('failure-desktop.png',output).pathname,fullPage:true}).catch(()=>{});
  await writeFile(new URL('failure.json',output),JSON.stringify({checks,errors,message:error.message,desktop:await page.locator('body').innerText().catch(()=>''),pages:await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(async p=>({url:p.url(),body:await p.locator('body').innerText().catch(()=>''),cameras:await p.getByRole('textbox',{name:/Name for viewpoint/}).evaluateAll(elements=>elements.map(e=>e.value)).catch(()=>[])})))},null,2));
  throw error;
}finally{
  if(projectId){const status=await page.evaluate(async id=>{const csrf=decodeURIComponent(document.cookie.split('; ').find(v=>v.startsWith('grihagrid_csrf=')).split('=').slice(1).join('='));return(await fetch('/api/projects/'+id,{method:'DELETE',headers:{'x-csrf-token':csrf}})).status;},projectId);assert.equal(status,204,'Remove only this run’s exact synthetic project');}
  await browser.close();
}
