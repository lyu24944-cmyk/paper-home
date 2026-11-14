import {chromium} from '@playwright/test';import fs from 'node:fs/promises';import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:'.qa/realistic/video-final',size:{width:1440,height:900}}});const page=await context.newPage();
const result={routes:[],errors:[]};page.on('pageerror',e=>result.errors.push(e.message));
await page.goto('http://127.0.0.1:4319/?qa');await page.waitForFunction(()=>!document.querySelector('.enter-button').disabled,{timeout:120000});await page.waitForTimeout(1200);
await page.evaluate(()=>{window.__BUDGET__={maxCalls:0,maxSceneTriangles:0,frames:0};const tick=()=>{const a=window.__HOME_QA__,b=window.__BUDGET__;if(a){b.maxCalls=Math.max(b.maxCalls,a.calls);b.maxSceneTriangles=Math.max(b.maxSceneTriangles,a.sceneTriangles);b.frames++}requestAnimationFrame(tick)};tick()});
for(const target of ['hall','yard','gallery','hall','study','yard','blank','yard','gallery','study','blank','gallery','yard']){
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();const name={hall:'走廊',yard:'小院',gallery:'收藏展廊',study:'书房',blank:'空白房间'}[target];await page.getByRole('button',{name:new RegExp('^'+name)}).click();await page.waitForFunction(p=>location.hash==='#'+p&&!document.querySelector('.traveling'),target,{timeout:45000});await page.waitForTimeout(800);result.routes.push(target);console.log('FINAL',target);
 if(['yard','gallery','study','blank','hall'].includes(target))await page.screenshot({path:'.qa/realistic/final-'+target+'.png'});
}
result.budget=await page.evaluate(()=>window.__BUDGET__);
await page.getByRole('button',{name:'漫游模式'}).click();await page.getByRole('button',{name:'小屋地图',exact:true}).click();await page.getByRole('button',{name:/^收藏展廊/}).click();await page.waitForFunction(()=>location.hash==='#gallery'&&!document.querySelector('.traveling'));
for(const [width,height] of [[390,844],[640,900],[768,1024]]){await page.setViewportSize({width,height});await page.waitForTimeout(800);await page.screenshot({path:`.qa/realistic/gallery-${width}x${height}.png`});const qa=await page.evaluate(()=>window.__HOME_QA__);result.routes.push({width,height,fov:qa.fov,position:qa.position})}
result.passed=result.errors.length===0&&result.budget.maxCalls<=200&&result.budget.maxSceneTriangles<=500000;
await fs.writeFile('.qa/realistic/final-tour.json',JSON.stringify(result,null,2));const video=page.video();await context.close();await video.saveAs('.qa/realistic/complete-transitions.webm');await browser.close();console.log(result);assert(result.passed);
