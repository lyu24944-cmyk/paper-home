import {chromium} from '@playwright/test';
import fs from 'node:fs/promises';
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:false,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:2560,height:1440},deviceScaleFactor:1,reducedMotion:'reduce'});
await page.addInitScript(()=>{
  const getContext=HTMLCanvasElement.prototype.getContext,raf=window.requestAnimationFrame.bind(window);
  let gl,ext,count=0;const pending=[],samples=[];
  HTMLCanvasElement.prototype.getContext=function(...args){const c=getContext.apply(this,args);if(args[0]==='webgl2'){gl=c;ext=gl.getExtension('EXT_disjoint_timer_query_webgl2')}return c};
  window.__GPU_PROFILE__={samples,get supported(){return !!ext}};
  window.requestAnimationFrame=callback=>raf(time=>{
    if(gl&&ext){for(let i=pending.length-1;i>=0;i--){const q=pending[i];if(gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE)){if(!gl.getParameter(ext.GPU_DISJOINT_EXT))samples.push(gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6);gl.deleteQuery(q);pending.splice(i,1)}}}
    let query;
    if(gl&&ext&&++count%10===0&&pending.length<4){query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query)}
    try{callback(time)}finally{if(query){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(query)}}
  });
});
await page.goto('http://127.0.0.1:4319/?qa#hall');await page.waitForFunction(()=>!document.querySelector('.loading-note'),{timeout:120000});
await page.waitForTimeout(2000);await page.evaluate(()=>{window.__GPU_PROFILE__.samples.length=0;window.__HOME_QA__.start()});
await page.evaluate(()=>{const el=document.querySelector('.home-app'),start=performance.now(),max=el.scrollHeight-el.clientHeight;const tick=()=>{const t=(performance.now()-start)/12000;el.scrollTop=(.5-.5*Math.cos(t*Math.PI*2))*max;if(t<1)requestAnimationFrame(tick)};tick()});
await page.waitForTimeout(12500);
const result=await page.evaluate(()=>({gpu:window.__GPU_PROFILE__,metrics:window.__HOME_QA__.stop(),qa:window.__HOME_QA__}));
await fs.writeFile('.qa/polish/after/gpu-profile.json',JSON.stringify(result,null,2));
const samples=result.gpu.samples.filter(v=>v>.1).sort((a,b)=>a-b);
console.log(JSON.stringify({supported:result.gpu.supported,samples:samples.length,gpuP50:samples[Math.floor(samples.length*.5)],gpuP95:samples[Math.floor(samples.length*.95)],gpuMax:samples.at(-1),metrics:result.metrics},null,2));await browser.close();
