import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';

const origin=process.env.SPATIAL_UI_ORIGIN||'http://127.0.0.1:5277';
const pairFile=process.env.SPATIAL_PAIR_FILE,jobId=process.env.SPATIAL_RENDER_JOB_ID;
assert.ok(['127.0.0.1','localhost'].includes(new URL(origin).hostname),'Local preview only');
assert.ok(pairFile,'Provide the private pairing file path, never its contents');
assert.match(jobId||'',/^[0-9a-f-]{36}$/,'Provide the exact completed synthetic film job');
const output=new URL('../qa-artifacts/spatial-film-ui/',import.meta.url);await mkdir(output,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.setDefaultTimeout(30000);page.on('pageerror',error=>errors.push(error.message));
try{
  await page.goto(origin+'/explore');
  await page.getByRole('button',{name:'Render / Export',exact:true}).click();
  await page.getByLabel('Pairing code').fill((await readFile(pairFile,'utf8')).trim());
  await page.getByRole('button',{name:'Connect renderer',exact:true}).click();
  const job=page.locator(`[data-render-job-id="${jobId}"]`);
  await job.getByRole('button',{name:'View film',exact:true}).click();
  const video=page.locator('.render-media video');await video.waitFor();
  await page.waitForFunction(()=>document.querySelector('.render-media video')?.readyState>=2);
  const metadata=await video.evaluate(el=>({duration:el.duration,width:el.videoWidth,height:el.videoHeight,sourceScheme:new URL(el.src).protocol}));
  assert.equal(metadata.width,1920);assert.equal(metadata.height,1080);assert.ok(Math.abs(metadata.duration-20)<.05);assert.equal(metadata.sourceScheme,'blob:');
  await video.evaluate(el=>el.play());
  await page.waitForFunction(()=>document.querySelector('.render-media video')?.ended,undefined,{timeout:40000});
  const playback=await video.evaluate(el=>({ended:el.ended,currentTime:el.currentTime,decodedFrames:el.getVideoPlaybackQuality?.().totalVideoFrames??null,droppedFrames:el.getVideoPlaybackQuality?.().droppedVideoFrames??null,error:el.error?.code??null}));
  assert.equal(playback.error,null);assert.ok(playback.currentTime>=19.9);
  if(playback.decodedFrames!==null)assert.ok(playback.decodedFrames>0);
  const inspectedTimes=[.5,5,10,15,19.5];
  for(const time of inspectedTimes){
    await video.evaluate((el,time)=>new Promise(resolve=>{el.addEventListener('seeked',resolve,{once:true});el.currentTime=time}),time);
    await video.screenshot({path:new URL(`frame-${String(time).replace('.','-')}.png`,output).pathname});
  }
  await page.screenshot({path:new URL('completed-film-in-app.png',output).pathname,fullPage:true});
  assert.deepEqual(errors,[]);
  const result={jobId,metadata,playback,inspectedTimes,errors};
  await writeFile(new URL('verification.json',output),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{
  await page.getByRole('button',{name:'Disconnect',exact:true}).click({timeout:2000}).catch(()=>{});
  await browser.close();
}
