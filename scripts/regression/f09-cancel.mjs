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
    const original=document.createElement.bind(document)
    document.createElement=function(tag,...args){
      const el=original(tag,...args)
      if(tag.toLowerCase()==='video'){
        const descriptor=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'src')
        Object.defineProperty(el,'src',{configurable:true,get(){return descriptor.get.call(this)},set(v){setTimeout(()=>descriptor.set.call(this,v),1500)}})
      }
      return el
    }
  })
  await editor.locator('.media-picker-block',{hasText:'演示视频'}).locator('input[type=file]').setInputFiles(prepareTestVideo(app.dataDir))
  await editor.getByRole('button',{name:'取消上传',exact:true}).click()
  await page.waitForTimeout(4500)
  assert.equal(uploads,0,'cancel during metadata check must prevent the upload')
  assert.equal(await editor.locator('.picked-video-chip').count(),0)
  assert.equal(await editor.getByRole('button',{name:'保存草稿',exact:true}).isEnabled(),true)
  console.log('F09 PASS: cancel stops metadata validation and no late controller starts')
} finally {await app.close()}
