import {browserExecutable,browserTestArgs,browserTestHeadless,browserTestUrl,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {createLocalCmsStore} from './local-cms-store.mjs';
const __dirname=path.dirname(fileURLToPath(import.meta.url)),rootDir=path.resolve(__dirname,'..'),dir=path.join(rootDir,'.qa','polish','after');
await fs.mkdir(dir,{recursive:true});
const MIME={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml','.ttf':'font/ttf','.woff2':'font/woff2','.hdr':'application/octet-stream','.glb':'model/gltf-binary','.bin':'application/octet-stream'};
async function startSeededServer(){
 if(process.env.QA_URL)return{url:process.env.QA_URL,close:()=>{}};
 const seedDataDir=path.join(rootDir,'.qa','verify-data'),seedDistDir=path.join(rootDir,'.qa','verify-dist');
 await fs.rm(seedDataDir,{recursive:true,force:true});
 const store=createLocalCmsStore(rootDir,{dataDir:seedDataDir});await store.seedNeutralSample({force:true});
 for(const item of [{title:'示例作品 · 窗边光影实验',summary:'测试画廊切换。',body:'正文二。',asset:'10000000-0000-4000-8000-000000000102'},{title:'示例作品 · 四时天色手稿',summary:'第三幅作品。',body:'正文三。',asset:'10000000-0000-4000-8000-000000000101'}]){
  const saved=await store.mutate('project.save_draft',{expectedVersion:0,title:item.title,summary:item.summary,body:item.body,coverAssetId:item.asset,galleryAssetIds:[]});
  assert.equal(saved.status,200,'Seed creation must use version zero');
  const published=await store.mutate('project.publish',{id:saved.body.project.id,expectedVersion:saved.body.project.version});
  assert.equal(published.status,200,'Seed publication must succeed');
 }
 execFileSync(process.execPath,[path.join(rootDir,'node_modules','vite','bin','vite.js'),'build','--mode','local-export','--outDir',seedDistDir],{cwd:rootDir,env:{...process.env,PAPER_HOME_FORCE_LOCAL:'1',LOCAL_CMS_DATA_DIR:seedDataDir},stdio:'inherit'});
 const server=http.createServer((req,res)=>{const cleanUrl=(req.url||'/').split('?')[0];let filePath=path.join(seedDistDir,cleanUrl==='/'?'index.html':decodeURIComponent(cleanUrl));if(!fsSync.existsSync(filePath)||fsSync.statSync(filePath).isDirectory())filePath=path.join(seedDistDir,'index.html');res.setHeader('Content-Type',MIME[path.extname(filePath).toLowerCase()]||'application/octet-stream');res.end(fsSync.readFileSync(filePath))});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const addr=server.address();const port=typeof addr==='object'&&addr?addr.port:4319;
 return{url:`http://127.0.0.1:${port}/?qa`,close:()=>server.close()};
}
const serverHandle=await startSeededServer(),url=serverHandle.url;
const browser=await chromium.launch({...browserExecutable(),headless:browserTestHeadless(),args:browserTestArgs(['--enable-gpu-rasterization'])});
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1,recordVideo:{dir:dir+'/video',size:{width:1440,height:900}}});
const page=await context.newPage(),errors=[],results={transitions:[],operations:[],viewports:[],errors};
page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
const status=()=>page.evaluate(()=>({hash:location.hash,busy:!!document.querySelector('.traveling'),qa:window.__HOME_QA__}));
const softwareRenderer=process.env.QA_SOFTWARE_WEBGL==='1';
async function observeTransition(target){
 await page.evaluate(target=>{
  const record=window.__VERIFY_TRANSITION__={samples:[],completed:false};
  const fractions=[.25,.5,.75];
  const read=(fraction,actualProgress)=>{
   const qa=window.__HOME_QA__;
   return{fraction,actualProgress,at:performance.now(),hash:location.hash,busy:!!document.querySelector('.traveling'),qa:{position:qa?.position?.slice(),quaternion:qa?.quaternion?.slice(),fov:qa?.fov,transition:qa?.transition?{...qa.transition}:null}};
  };
  const tick=()=>{
   const completed=location.hash==='#'+target&&!document.querySelector('.traveling');
   const progress=completed?1:window.__HOME_QA__?.transition?.progress;
   if(typeof progress==='number')while(fractions.length&&progress>=fractions[0])record.samples.push(read(fractions.shift(),progress));
   record.completed=completed;
   if(!completed)requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
 },target);
}
async function idle(place){await page.waitForFunction(p=>location.hash==='#'+p&&!document.querySelector('.traveling')&&!document.querySelector('.loading-note'),place,{timeout:45000});await page.waitForTimeout(350)}
async function go(target,label,quartiles=true){
 const from=(await status()).hash.slice(1),name={yard:'小院',hall:'走廊',gallery:'作品室',study:'创作手记',blank:'关于我'}[target];
 if(from===target)return;
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();
 const origin=await status();if(quartiles&&softwareRenderer)await observeTransition(target);await page.getByRole('button',{name:new RegExp('^'+name)}).click();
 const samples=[{fraction:0,...origin}];
 if(quartiles&&softwareRenderer){
  await page.screenshot({path:dir+'/'+label+'-000.png'});
  await page.waitForFunction(()=>window.__VERIFY_TRANSITION__?.completed,null,{timeout:45000});
  const observed=await page.evaluate(()=>window.__VERIFY_TRANSITION__.samples);
  assert.deepEqual(observed.map(row=>row.fraction),[.25,.5,.75]);
  assert(observed.some(row=>row.actualProgress>0&&row.actualProgress<1),'Expected an actual intermediate rendered transition frame');
  assert(observed.every((row,i)=>row.actualProgress>=row.fraction&&(!i||row.actualProgress>=observed[i-1].actualProgress)),'Transition samples must progress monotonically');
  assert(observed.every(row=>row.qa.position?.length===3&&row.qa.position.every(Number.isFinite)&&row.qa.quaternion?.length===4&&row.qa.quaternion.every(Number.isFinite)),'Transition camera samples must be finite');
  samples.push(...observed);
 }else if(quartiles){await page.screenshot({path:dir+'/'+label+'-000.png'});for(const fraction of [.25,.5,.75]){
  await page.waitForFunction(f=>window.__HOME_QA__?.transition?.progress>=f,fraction,{timeout:40000});const value=await status();samples.push({fraction,...value});await page.screenshot({path:dir+'/'+label+'-'+String(fraction*100).padStart(3,'0')+'.png'});
 }}
 await idle(target);const endpoint=await status();samples.push({fraction:1,...endpoint});
 if(quartiles)await page.screenshot({path:dir+'/'+label+'-100.png'});
 assert.equal(endpoint.hash,'#'+target);assert(!endpoint.busy);assert(!await page.getByRole('button',{name:'小屋地图',exact:true}).isDisabled());
 results.transitions.push({label,from,target,samples});console.log('PASS',label);
 await fs.writeFile(dir+'/verification.json',JSON.stringify(results,null,2));
}
try{
 await page.goto(browserTestUrl(url));await page.waitForFunction(()=>!document.querySelector('.enter-button')?.disabled,{timeout:120000});await page.waitForTimeout(1800);
 await page.screenshot({path:dir+'/yard-desktop.png'});results.renderer=(await status()).qa.renderer;
 await go('hall','yard-hall');await go('yard','hall-yard');
 await go('gallery','yard-gallery',false);await go('yard','gallery-yard');
 await go('study','yard-study',false);await page.screenshot({path:dir+'/study-desktop.png'});
 await page.locator('#room-directory').getByRole('button',{name:/如何把这座小屋变成你自己的/}).click();const noteDialog=page.locator('dialog.note-detail-dialog[open]');await noteDialog.waitFor();assert(await noteDialog.getByRole('heading',{name:'如何把这座小屋变成你自己的'}).isVisible());await page.screenshot({path:dir+'/reading-desktop.png'});await page.keyboard.press('Escape');assert(!await page.locator('dialog[open]').count());results.operations.push('article reading and Escape');
 await go('yard','study-yard');await go('blank','yard-blank',false);await page.screenshot({path:dir+'/blank-desktop.png'});await go('yard','blank-yard');
 await go('gallery','map-gallery',false);await page.screenshot({path:dir+'/gallery-desktop.png'});
 await page.mouse.click(720,365);await page.locator('dialog.project-detail-dialog[open]').waitFor();assert(await page.locator('dialog.project-detail-dialog[open]').count());await page.screenshot({path:dir+'/artwork-desktop.png'});await page.keyboard.press('Escape');results.operations.push('3D artwork picking and Escape');
 await go('hall','gallery-hall');
 await page.mouse.move(780,520);await page.mouse.wheel(0,470);await page.waitForTimeout(900);const walked=await status();assert(walked.qa.position[2]<-1);await page.screenshot({path:dir+'/hall-walking.png'});
 const nearby=page.locator('.near-door');if(await nearby.count()){
  const before=walked.qa.position;await nearby.click();await page.waitForFunction(()=>!document.querySelector('.traveling'),{timeout:45000});await page.getByRole('button',{name:'返回走廊',exact:true}).click();await idle('hall');const after=(await status()).qa.position;assert(Math.hypot(...after.map((x,i)=>x-before[i]))<.07);results.operations.push('return to the same corridor position');
 }
 await page.mouse.move(800,500);await page.mouse.wheel(0,-300);await page.waitForTimeout(900);const stopped=(await status()).qa.position;await page.waitForTimeout(1000);const later=(await status()).qa.position;assert(Math.hypot(...later.map((x,i)=>x-stopped[i]))<.02);results.operations.push('forward, reverse and stop scrolling');
 await go('study','hall-study',false);await go('hall','study-hall',false);await go('blank','hall-blank',false);await go('hall','blank-hall',false);
 await go('gallery','cross-start',false);await go('study','gallery-study');await go('blank','study-blank',false);await go('gallery','blank-gallery',false);
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();await page.getByRole('textbox',{name:'给小屋起个名字'}).fill('晴日小屋');await page.getByRole('button',{name:'记住',exact:true}).click();assert(await page.getByText('小屋的名字记住了。').isVisible());assert.equal(await page.evaluate(()=>localStorage.getItem('paper-home:name')),'晴日小屋');await page.keyboard.press('Escape');results.operations.push('rename and local persistence');
 await page.getByRole('button',{name:'开启环境声'}).click();assert.equal(await page.getByRole('button',{name:'关闭环境声'}).getAttribute('aria-pressed'),'true');await page.getByRole('button',{name:'关闭环境声'}).click();results.operations.push('sound toggle');
 await page.getByRole('button',{name:'漫游模式'}).click();await go('yard','reduced-yard',false);await go('blank','reduced-blank',false);await page.getByRole('button',{name:'轻柔模式'}).click();results.operations.push('reduced motion stable endpoints');
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();await page.getByRole('button',{name:/^小院/}).click();await page.waitForTimeout(1300);await page.setViewportSize({width:1120,height:820});await idle('yard');assert(!(await status()).busy);results.operations.push('resize during transition');
 // Simulate a background lifecycle while a transition is running.
 await page.getByRole('button',{name:'小屋地图',exact:true}).click();await page.getByRole('button',{name:/^创作手记/}).click();await page.waitForTimeout(900);
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});await idle('study');await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))});assert(!(await status()).busy);results.operations.push('background lifecycle stable endpoint');
 await page.getByRole('button',{name:'漫游模式'}).click();await go('yard','viewport-start',false);
 for(const [width,height] of [[1440,900],[1920,1080],[2560,1440],[768,1024],[390,844],[640,900]]){
  await page.setViewportSize({width,height});await page.waitForTimeout(600);await page.screenshot({path:dir+`/yard-${width}x${height}.png`});
  const data=await status();results.viewports.push({width,height,qa:data.qa,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)});
  await go('gallery',`gallery-${width}`,false);await page.screenshot({path:dir+`/gallery-${width}x${height}.png`});await go('yard',`yard-${width}`,false);
 }
 await page.setViewportSize({width:1440,height:900});await page.getByRole('button',{name:'小屋地图',exact:true}).click();await page.getByRole('textbox',{name:'给小屋起个名字'}).fill('我的小屋');await page.getByRole('button',{name:'记住',exact:true}).click();await page.keyboard.press('Escape');
 await page.getByRole('group',{name:'画面质量'}).getByRole('button',{name:'兼容画质'}).click();await page.waitForTimeout(300);await page.waitForFunction(()=>!document.querySelector('.loading-note'),{timeout:60000});await page.waitForTimeout(1000);await page.screenshot({path:dir+'/yard-low.png'});results.lowQuality=(await status()).qa;await go('study','low-study',false);assert(await page.locator('#room-directory').getByRole('button',{name:/如何把这座小屋变成你自己的/}).isVisible());results.operations.push('compatible quality retains navigation and content');
 assert.equal(errors.length,0);assert(results.viewports.every(v=>!v.overflow));results.passed=true;
}catch(e){results.passed=false;results.failure=e.stack;await page.screenshot({path:dir+'/failure.png'}).catch(()=>{});console.error(e);process.exitCode=1}
finally{await fs.writeFile(dir+'/verification.json',JSON.stringify(results,null,2));const video=page.video();await context.close();await video.saveAs(dir+'/complete-transitions.webm');await browser.close();serverHandle.close();console.log('DONE',results.passed,results.operations)}

