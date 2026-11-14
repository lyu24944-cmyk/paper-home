import fs from 'node:fs/promises';import {chromium} from '@playwright/test';import sharp from 'sharp';
const folder='.qa/realistic/baseline-src';await fs.mkdir(folder,{recursive:true});
for(const file of ['content.ts','ink.ts','sketch.ts','style.css'])await fs.copyFile('src/'+file,folder+'/'+file);
await fs.copyFile('bak/World.before.tsx',folder+'/World.tsx');await fs.copyFile('bak/experience.before.css',folder+'/experience.css');
let app=await fs.readFile('bak/App.before.tsx','utf8');
app="import {ComparisonCamera} from './comparison-camera'\n"+app.replace('</Canvas>','<ComparisonCamera place={place}/></Canvas>');
await fs.writeFile(folder+'/App.tsx',app);
await fs.writeFile(folder+'/comparison-camera.tsx',`import {useFrame,useThree} from '@react-three/fiber';import {stablePose} from '../../../src/layout';export function ComparisonCamera({place}:any){const {camera,size}=useThree();useFrame(()=>{const p=stablePose(place,0,size.width/size.height);camera.position.copy(p.position);camera.quaternion.copy(p.orientation);(camera as any).fov=p.fov;camera.updateProjectionMatrix()});return null}`);
await fs.writeFile(folder+'/main.tsx',"import React from 'react';import{createRoot}from'react-dom/client';import App from './App';import './style.css';import './experience.css';createRoot(document.getElementById('root')!).render(<App/>);");
await fs.writeFile(folder+'/index.html','<!doctype html><html><meta charset="utf-8"><div id="root"></div><script type="module" src="./main.tsx"></script></html>');
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--enable-webgl','--ignore-gpu-blocklist']});
const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
for(const place of ['yard','hall']){
 await page.goto('http://127.0.0.1:4318/'+folder+'/index.html#'+place);await page.waitForTimeout(3500);await page.screenshot({path:'.qa/realistic/same-pose-before-'+place+'.png'});
 await page.goto('http://127.0.0.1:4319/?qa#'+place);await page.waitForFunction(()=>!!window.__HOME_QA__,{timeout:120000});await page.waitForTimeout(2500);await page.screenshot({path:'.qa/realistic/same-pose-after-'+place+'.png'});
 const pose=await page.evaluate(()=>({position:window.__HOME_QA__.position,quaternion:window.__HOME_QA__.quaternion,fov:window.__HOME_QA__.fov}));await fs.writeFile('.qa/realistic/comparison-'+place+'-pose.json',JSON.stringify(pose,null,2));
 const labels=Buffer.from('<svg width="2880" height="65"><rect width="2880" height="65" fill="#f4f4ed"/><text x="30" y="43" font-family="Microsoft YaHei" font-size="28" fill="#29362e">重构前 · 相同相机姿态</text><text x="1470" y="43" font-family="Microsoft YaHei" font-size="28" fill="#29362e">重构后 · 相同相机姿态</text></svg>');
 await sharp({create:{width:2880,height:965,channels:3,background:'#f4f4ed'}}).composite([{input:labels,left:0,top:0},{input:'.qa/realistic/same-pose-before-'+place+'.png',left:0,top:65},{input:'.qa/realistic/same-pose-after-'+place+'.png',left:1440,top:65}]).png().toFile('.qa/realistic/comparison-'+place+'.png');
}
await browser.close();
