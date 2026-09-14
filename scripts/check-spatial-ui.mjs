import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

const origin = process.env.SPATIAL_UI_ORIGIN || 'http://127.0.0.1:5277';
const output = new URL('../qa-artifacts/spatial-ui/', import.meta.url);
await mkdir(output, {recursive: true});
const browser = await chromium.launch({channel:'chrome',headless:true});
const findings = {origin,device:'Chrome on local host; mobile viewport emulation',checks:[],errors:[]};
try {
  const page = await browser.newPage({viewport:{width:1440,height:1080}});
  page.on('pageerror', error => findings.errors.push(error.message));
  await page.goto(origin + '/explore');
  await page.getByRole('heading',{name:'The Courtyard House.'}).waitFor();
  await page.locator('canvas').waitFor();
  await page.waitForTimeout(1000);
  assert.equal(await page.title(),'Spatial studio — GrihaGrid');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const studyRoom = page.locator('.sp-room-list').getByRole('button',{name:/Study/});
  await studyRoom.focus();
  await studyRoom.press('Enter');
  assert.equal(await studyRoom.getAttribute('aria-pressed'),'true');
  assert.equal(await studyRoom.evaluate(element=>document.activeElement===element),true);
  await page.getByRole('button',{name:'Reset overview',exact:true}).click();
  await page.screenshot({path:new URL('desktop.png',output).pathname,fullPage:true});
  findings.checks.push('Desktop 1440px: live scene, correct title and no overflow');
  await page.getByRole('button',{name:'2D Plan',exact:true}).click();
  await page.getByRole('spinbutton',{name:'Overall width in metres'}).fill('13');
  await page.getByRole('button',{name:'Preview dimensions'}).click();
  await page.getByRole('button',{name:'Review Change Study'}).click();
  await page.getByRole('button',{name:'Accept concept revision'}).click();
  assert.match(await page.locator('.sp-heading-meta').innerText(),/CONCEPT 02/);
  await page.screenshot({path:new URL('plan.png',output).pathname,fullPage:true});
  await page.getByRole('button',{name:'Camera Tour',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Play tour',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Rebuild tour'}).click();
  await page.getByRole('button',{name:'Play tour',exact:true}).click();
  await page.waitForTimeout(1200);
  assert.ok(Number(await page.getByRole('slider',{name:'Tour progress'}).inputValue())>0);
  await page.getByRole('button',{name:'Pause tour',exact:true}).click();
  const paused = await page.getByRole('slider',{name:'Tour progress'}).inputValue();
  await page.waitForTimeout(500);
  assert.equal(await page.getByRole('slider',{name:'Tour progress'}).inputValue(),paused);
  await page.getByRole('button',{name:'Resume tour',exact:true}).click();
  await page.waitForTimeout(500);
  assert.ok(Number(await page.getByRole('slider',{name:'Tour progress'}).inputValue())>Number(paused));
  await page.getByRole('button',{name:'Pause tour',exact:true}).click();
  findings.checks.push('Shared dimension edit, accepted revision, stale tour fence, rebuild, play and exact pause');
  await page.getByRole('button',{name:'Move stop 2 up',exact:true}).click();
  assert.equal(await page.getByRole('button',{name:'Resume tour',exact:true}).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Save tour revision',exact:true}).isDisabled(),true);
  await page.getByLabel('Describe your camera tour').fill('Show living room, kitchen and the garden in 25 seconds.');
  await page.getByRole('button',{name:'Match room names locally'}).click();
  assert.match(await page.locator('.sp-messages').innerText(),/No AI request was made/);
  assert.equal(await page.getByRole('spinbutton',{name:'Tour duration in seconds'}).inputValue(),'25');
  findings.checks.push('Pending itinerary cannot play/save stale tour; local language mapping is labelled honestly');
  await page.screenshot({path:new URL('tour-editor.png',output).pathname,fullPage:true});
  await page.getByRole('button',{name:'Render / Export',exact:true}).click();
  const exported = page.waitForEvent('download');
  await page.getByRole('button',{name:'Download scene JSON'}).click();
  const sceneDownload = await exported;
  await sceneDownload.saveAs(new URL('scene.json',output).pathname);
  findings.checks.push('Scene bundle download');
  if (process.env.SPATIAL_UI_PRIVATE === '1') {
    assert.ok(['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname),'Synthetic account verification requires a local origin');
    const context = await browser.newContext();
    const privatePage = await context.newPage({viewport:{width:1440,height:1080}});
    let projectId;
    try {
      await privatePage.goto(origin + '/explore');
      projectId = await privatePage.evaluate(async () => {
        const post = async (path,body,csrf) => {
          const response = await fetch(path,{method:'POST',headers:{'content-type':'application/json','idempotency-key':crypto.randomUUID(),...(csrf?{'x-csrf-token':csrf}:{})},body:JSON.stringify(body)});
          const result = await response.json();
          if(!response.ok)throw new Error(`Synthetic setup failed: ${response.status} ${result.error?.code||result.error||''}`);
          return result;
        };
        const auth = await post('/api/auth/register',{name:'Spatial Browser QA',email:`spatial-ui-${Date.now()}@example.test`,password:crypto.randomUUID()+'Aa1!'});
        return (await post('/api/projects',{name:'Spatial QA House',input:{width:40,length:50,city:'Pune',quality:'Signature',floors:'G',bedrooms:2}},auth.csrfToken)).project.id;
      });
      await privatePage.goto(origin + '/projects/' + projectId + '/spatial');
      await privatePage.getByRole('button',{name:'Review Change Study'}).click();
      await privatePage.getByRole('button',{name:'Accept concept revision'}).click();
      await privatePage.getByText('Concept revision accepted. Rebuild the tour to use the updated layout.').waitFor();
      await privatePage.getByRole('button',{name:'Camera Tour',exact:true}).click();
      await privatePage.getByRole('button',{name:'Rebuild tour',exact:true}).click();
      await privatePage.getByRole('button',{name:'Save tour revision',exact:true}).click();
      await privatePage.getByText('A separate camera-tour revision has been saved.').waitFor();
      await privatePage.reload();
      await privatePage.getByRole('heading',{name:'Spatial QA House'}).waitFor();
      const saved = await privatePage.evaluate(async id => (await fetch('/api/projects/'+id+'/spatial')).json(),projectId);
      assert.equal(saved.spatialRevision,1);
      assert.equal(saved.tourRevision,1);
      assert.equal(saved.stale,false);
      assert.equal(saved.history.length,1);
      await privatePage.screenshot({path:new URL('private-project.png',output).pathname,fullPage:true});
      findings.checks.push('Private browser session: concept and separate tour saved, reloaded, and immutable history retained');
    } finally {
      if(projectId) {
        const status = await privatePage.evaluate(async id => {
          const csrf = decodeURIComponent(document.cookie.split('; ').find(value=>value.startsWith('grihagrid_csrf=')).split('=').slice(1).join('='));
          return (await fetch('/api/projects/'+id,{method:'DELETE',headers:{'x-csrf-token':csrf}})).status;
        },projectId);
        assert.equal(status,204,'Exact synthetic project cleanup');
      }
      await context.close();
    }
  }
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'3D Explore',exact:true}).click();
  await page.getByRole('button',{name:'Reset overview',exact:true}).click();
  await page.waitForTimeout(700);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:new URL('mobile.png',output).pathname,fullPage:true});
  await page.getByRole('button',{name:'Walk inside',exact:true}).click();
  assert.equal(await page.locator('[data-camera-mode]').getAttribute('data-camera-mode'),'walk');
  findings.checks.push('390px touch layout and walking mode without horizontal overflow');
  await page.emulateMedia({reducedMotion:'reduce'});
  assert.equal(await page.getByRole('button',{name:'Reduced motion on'}).getAttribute('aria-pressed'),'true');
  await page.setViewportSize({width:720,height:540});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  findings.checks.push('Reduced motion and 200%-equivalent CSS viewport reflow');
  const fallback = await browser.newPage();
  fallback.on('pageerror', error => findings.errors.push(error.message));
  await fallback.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type,...args) {
      return /webgl/i.test(type) ? null : getContext.call(this,type,...args);
    };
  });
  await fallback.goto(origin + '/explore');
  await fallback.getByText('3D graphics are unavailable.',{exact:true}).waitFor();
  assert.equal(await fallback.getByRole('button',{name:'Play tour',exact:true}).isDisabled(),true);
  await fallback.getByRole('button',{name:'2D Plan',exact:true}).click();
  await fallback.getByRole('group',{name:'Editable concept floor plan; choose a room to inspect'}).waitFor();
  await fallback.screenshot({path:new URL('webgl-fallback.png',output).pathname,fullPage:true});
  await fallback.close();
  findings.checks.push('Missing WebGL cleanly falls back to a usable 2D plan without uncaught errors');
  assert.deepEqual(findings.errors,[]);
  await writeFile(new URL('verification.json',output),JSON.stringify(findings,null,2)+'\n');
  console.log(JSON.stringify(findings,null,2));
} finally { await browser.close(); }
