import {chromium} from '@playwright/test';import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist','--enable-gpu-rasterization']});
const results=[];
for(const [width,height,quality] of [[1920,1080,'high'],[2560,1440,'high'],[1920,1080,'low']]){
 const page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:4319/?qa&quality='+quality);await page.waitForFunction(()=>!document.querySelector('.enter-button')?.disabled,{timeout:120000});await page.waitForTimeout(2200);
 await page.evaluate(()=>window.__HOME_QA__.start());await page.waitForTimeout(5000);const yard=await page.evaluate(()=>({metrics:window.__HOME_QA__.stop(),snapshot:window.__HOME_QA__}));
 await page.getByRole('button',{name:'敲敲门，进来坐坐'}).click();await page.waitForFunction(()=>location.hash==='#hall'&&!document.querySelector('.traveling'),{timeout:45000});await page.waitForTimeout(1500);
 await page.evaluate(()=>{window.__HOME_QA__.start();const el=document.querySelector('.home-app'),start=performance.now(),duration=20000,max=el.scrollHeight-el.clientHeight;const tick=()=>{const t=(performance.now()-start)/duration;el.scrollTop=(.5-.5*Math.cos(t*Math.PI*4))*max;if(t<1)requestAnimationFrame(tick)};tick()});
 await page.waitForTimeout(20500);const walking=await page.evaluate(()=>({metrics:window.__HOME_QA__.stop(),snapshot:window.__HOME_QA__}));
 results.push({width,height,quality,deviceScaleFactor:1,recording:false,yard,walking});console.log(width,height,quality,walking.metrics);await page.close();await fs.writeFile('.qa/realistic/performance.json',JSON.stringify(results,null,2));
}
await browser.close();

