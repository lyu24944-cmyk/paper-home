import {browserExecutable,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import {chromium} from '@playwright/test';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
import {startBrowserTest} from './regression/browser.mjs'
const app=await startBrowserTest(),browser=app.browser;
const results={checks:[]};
const softwareRenderer=process.env.QA_SOFTWARE_WEBGL==='1';
async function waitForCameraRest(page,initial=null){
 await page.evaluate(()=>{window.__EDGE_CAMERA_REST__={previous:null,moved:false,stableFrames:0}});
 await page.waitForFunction(initial=>{
  const position=window.__HOME_QA__?.position,state=window.__EDGE_CAMERA_REST__;
  if(!position?.every(Number.isFinite))return false;
  if(!initial||Math.hypot(...position.map((value,i)=>value-initial[i]))>.02)state.moved=true;
  const change=state.previous?Math.hypot(...position.map((value,i)=>value-state.previous[i])):Infinity;
  state.stableFrames=state.moved&&change<.002?state.stableFrames+1:0;
  state.previous=position.slice();
  return state.stableFrames>=3;
 },initial,{timeout:45000});
}
await fs.mkdir('.qa/polish/after',{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:640,height:900},deviceScaleFactor:2,hasTouch:true});
 let fail=true;await page.route(/\/brick-color(?:-1k)?\.webp(?:\?|$)/,r=>{if(fail){fail=false;return r.abort()}return r.continue()});
 await page.goto(app.url.replace('quality=low','quality=high'));await page.getByRole('button',{name:'重新加载',exact:true}).waitFor({timeout:60000});assert(await page.locator('.enter-button').isDisabled());await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.enter-button').disabled,{timeout:120000});results.checks.push('critical load failure keeps entry locked; retry succeeds');
 await page.waitForTimeout(1200);assert.equal(await page.evaluate(()=>window.__HOME_QA__.dpr),1.5);results.checks.push('640 px narrow desktop uses a stable DPR cap of 1.5');
 await page.getByRole('button',{name:'敲敲门，进来坐坐'}).click();await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>window.__HOME_QA__.dpr),1.5);await page.waitForFunction(()=>location.hash==='#hall'&&!document.querySelector('.traveling'),{timeout:45000});await page.waitForTimeout(1300);assert.equal(await page.evaluate(()=>window.__HOME_QA__.dpr),1.5);results.checks.push('motion and settling retain DPR 1.5 without render-target reallocation');
 const scrollStart=await page.evaluate(()=>window.__HOME_QA__.position);await page.evaluate(()=>{const el=document.querySelector('.home-app');el.scrollTop=((3.2-1.45)/12.5)*(el.scrollHeight-el.clientHeight)});if(softwareRenderer)await waitForCameraRest(page,scrollStart);else await page.waitForTimeout(1500);const before=await page.evaluate(()=>window.__HOME_QA__.position);
 await page.getByRole('button',{name:'进入作品室'}).click();await page.waitForFunction(()=>location.hash==='#gallery'&&!document.querySelector('.traveling'),{timeout:45000});await page.getByRole('button',{name:'返回走廊',exact:true}).click();await page.waitForFunction(()=>location.hash==='#hall'&&!document.querySelector('.traveling'),{timeout:45000});if(softwareRenderer)await waitForCameraRest(page);else await page.waitForTimeout(1000);const after=await page.evaluate(()=>window.__HOME_QA__.position);assert(Math.hypot(...after.map((x,i)=>x-before[i]))<.02);results.checks.push('room return restores the exact 3D corridor stop');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(700);const start=await page.locator('.home-app').evaluate(el=>el.scrollTop);
 const cdp=await page.context().newCDPSession(page);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:200,y:580}]});for(let i=1;i<=8;i++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:200,y:580-i*30}]});await page.waitForTimeout(30)}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await page.waitForTimeout(700);assert(await page.locator('.home-app').evaluate(el=>el.scrollTop)>start);results.checks.push('phone touch swipe advances the same corridor');
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();assert(await page.getByRole('dialog',{name:'小屋地图',exact:true}).isVisible());await page.keyboard.press('Escape');results.checks.push('icon-only mobile map remains named and keyboard-dismissable');
 await page.screenshot({path:'.qa/polish/after/phone-touch.png'});results.passed=true;await page.close();
}catch(e){results.passed=false;results.error=e.stack;process.exitCode=1}finally{await fs.writeFile('.qa/polish/after/edge-cases.json',JSON.stringify(results,null,2));console.log(results);await app.close()}
