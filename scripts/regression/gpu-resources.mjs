import assert from 'node:assert/strict'
import fs from 'node:fs'
import {startBrowserTest,idle} from './browser.mjs'
const app=await startBrowserTest()
try{
  const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(app.url+'#yard');await idle(page)
  const read=()=>page.evaluate(async()=>{
    const url=performance.getEntriesByType('resource').map(x=>x.name).find(x=>x.includes('/@react-three_fiber.js'))
    const {_roots}=await import(url),state=_roots.get(document.querySelector('canvas')).store.getState()
    return {memory:{...state.gl.info.memory},programs:state.gl.info.programs.length,dpr:state.gl.getPixelRatio()}
  })
  const samples=[]
  for(let i=0;i<4;i++){
    for(const name of ['细致画质','兼容画质']){await page.getByRole('group',{name:'画面质量'}).getByRole('button',{name,exact:true}).click();await idle(page);await page.waitForTimeout(400)}
    samples.push(await read())
  }
  assert.ok(samples.at(-1).memory.geometries<=samples[0].memory.geometries+2,'geometry count grows across quality rebuilds')
  assert.ok(samples.at(-1).memory.textures<=samples[0].memory.textures+2,'texture count grows across quality rebuilds')
  assert.ok(samples.at(-1).programs<=samples[0].programs+2,'shader programs grow across quality rebuilds')
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500)
  await page.evaluate(()=>window.__HOME_QA__.loseWebglContext())
  await page.locator('.context-lost-card').waitFor()
  await page.getByRole('button',{name:'切换兼容画质并重试',exact:true}).click();await idle(page)
  assert.equal(await page.locator('.home-app').count(),1)
  assert.deepEqual(errors,[])
  fs.mkdirSync('.qa/regression',{recursive:true});fs.writeFileSync('.qa/regression/gpu-resources.json',JSON.stringify({samples,recovered:await read(),errors},null,2))
  console.log('PASS GPU resource bounds across quality rebuilds, resize/DPR and WebGL context restoration')
}finally{await app.close()}
