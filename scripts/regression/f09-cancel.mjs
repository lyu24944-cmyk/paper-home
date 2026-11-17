import {prepareTestVideo} from '../test-runtime.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { startBrowserTest, idle } from './browser.mjs'
const app=await startBrowserTest()
try {
  const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
  await page.addInitScript(()=>sessionStorage.setItem('paper-home:local-owner-active','1'))
  await page.goto(app.url+'#gallery');await idle(page)
  await page.getByRole('button',{name:'添加作品',exact:true}).click()
  const editor=page.locator('.cms-editor-dialog[open]')
  let uploads=0
  page.on('request',r=>{if(r.url().includes('/__local-cms/media-upload?') && r.method()==='POST') uploads++})
  await page.evaluate(()=>{
    // Hold the real metadata load until cancellation is acknowledged. A fixed
    // delay can expire before Playwright's click on a software-rendered page.
    const gate={pending:[],captured:0,released:0,settled:0,checkingAtCancel:false}
    gate.release=()=>{
      for(const assign of gate.pending.splice(0)){assign();gate.released++}
    }
    window.__F09_VIDEO_GATE__=gate
    document.addEventListener('click',event=>{
      const button=event.target.closest?.('button')
      if(button?.textContent.trim()==='取消上传'){
        gate.checkingAtCancel=button.closest('.media-picker-block')?.querySelector('[role="status"]')?.textContent==='正在检查视频格式、大小与可播放性…'
      }
    },true)
    const original=document.createElement.bind(document)
    document.createElement=function(tag,...args){
      const el=original(tag,...args)
      if(tag.toLowerCase()==='video'){
        const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src')
        let settled=false
        const record=()=>{if(!settled){settled=true;gate.settled++}}
        el.addEventListener('loadedmetadata',record,{once:true})
        el.addEventListener('error',record,{once:true})
        Object.defineProperty(el,'src',{configurable:true,get(){return descriptor.get.call(this)},set(v){gate.captured++;gate.pending.push(()=>descriptor.set.call(this,v))}})
      }
      return el
    }
  })
  if(process.argv.includes('--slow-cancel')){
    const cdp=await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate',{rate:4})
  }
  const file=prepareTestVideo(app.dataDir)
  const input=editor.locator('.media-picker-block',{hasText:'演示视频'}).locator('input[type=file]')
  await input.setInputFiles(file)
  await page.waitForFunction(()=>window.__F09_VIDEO_GATE__?.captured===1,null,{timeout:30000})
  assert.equal(await editor.getByText('正在检查视频格式、大小与可播放性…',{exact:true}).isVisible(),true,'must still be checking metadata before cancellation')
  assert.equal(await page.evaluate(()=>window.__F09_VIDEO_GATE__.released),0,'metadata must remain held until cancellation')
  assert.equal(uploads,0,'no upload may start while metadata is held')
  await editor.getByRole('button',{name:'取消上传',exact:true}).click()
  assert.equal(await page.evaluate(()=>window.__F09_VIDEO_GATE__.checkingAtCancel),true,'cancel click must occur during metadata checking, before any validation timeout')
  await editor.getByText('已取消本次视频上传（其余文字内容已保留）。',{exact:true}).waitFor({timeout:30000})
  await page.evaluate(()=>window.__F09_VIDEO_GATE__.release())
  await page.waitForFunction(()=>window.__F09_VIDEO_GATE__.settled===1,null,{timeout:30000})
  await page.waitForTimeout(4500)
  assert.equal(uploads,0,'cancel during metadata check must prevent the upload')
  assert.equal(await editor.locator('.picked-video-chip').count(),0)
  assert.equal(await editor.getByRole('button',{name:'保存草稿',exact:true}).isEnabled(),true)
  // Prove the gate can complete actual validation and upload when not canceled.
  // This prevents a broken fixture or a permanently blocked load from passing.
  await input.setInputFiles(file)
  await page.waitForFunction(()=>window.__F09_VIDEO_GATE__?.captured===2,null,{timeout:30000})
  await page.evaluate(()=>window.__F09_VIDEO_GATE__.release())
  await editor.locator('.picked-video-chip').waitFor({timeout:30000})
  assert(uploads>0,'the uncanceled control must issue actual upload requests')
  assert.equal(await page.evaluate(()=>window.__F09_VIDEO_GATE__.settled),2)
  fs.mkdirSync('.qa/regression',{recursive:true})
  fs.writeFileSync('.qa/regression/f09-cancel.json',JSON.stringify({canceledUploadRequests:0,controlUploadRequests:uploads,gate:await page.evaluate(()=>({captured:window.__F09_VIDEO_GATE__.captured,released:window.__F09_VIDEO_GATE__.released,settled:window.__F09_VIDEO_GATE__.settled,checkingAtCancel:window.__F09_VIDEO_GATE__.checkingAtCancel}))},null,2))
  console.log('F09 PASS: metadata held through cancellation; no late upload; uncanceled control uploads successfully')
} finally {await app.close()}
