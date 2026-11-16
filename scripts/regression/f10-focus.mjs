import assert from 'node:assert/strict'
import {startBrowserTest,idle} from './browser.mjs'
const app=await startBrowserTest()
try{
 const page=await app.browser.newPage({viewport:{width:1366,height:860}})
 await page.goto(app.url+'#yard');await idle(page)
 await page.getByRole('button',{name:'坐上木椅',exact:true}).click()
 await page.waitForTimeout(120)
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))})
 await page.waitForTimeout(150)
 const result=await page.evaluate(async()=>{const {focusSubPose}=await import('/src/layout.ts');return{actual:window.__HOME_QA__.position,expected:focusSubPose('yard-bench',innerWidth/innerHeight).position.toArray(),focus:window.__HOME_QA__.focusId}})
 assert.equal(result.focus,'yard-bench')
 assert.ok(Math.hypot(...result.actual.map((v,i)=>v-result.expected[i]))<0.01,'hidden focus must finish at the target: '+JSON.stringify(result))
 await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'))})
 await page.getByRole('button',{name:'起身看全院',exact:true}).click();await page.waitForTimeout(750)
 await page.getByRole('button',{name:'坐上木椅',exact:true}).click();await page.waitForTimeout(100)
 await page.setViewportSize({width:900,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.waitForTimeout(850)
 const resized=await page.evaluate(async()=>{const {focusSubPose}=await import('/src/layout.ts');return{actual:window.__HOME_QA__.position,expected:focusSubPose('yard-bench',innerWidth/innerHeight).position.toArray()}})
 assert.ok(Math.hypot(...resized.actual.map((v,i)=>v-resized.expected[i]))<0.01,'resize/reduced focus must use current aspect')
 console.log('F10 PASS: visibility, resize and reduced motion finish at the deterministic focus endpoint')
}finally{await app.close()}
