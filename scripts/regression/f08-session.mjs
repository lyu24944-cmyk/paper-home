import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { startBrowserTest, idle } from './browser.mjs'
const app=await startBrowserTest()
let release
try {
  const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
  await page.addInitScript(()=>sessionStorage.setItem('paper-home:local-owner-active','1'))
  await page.goto(app.url+'#gallery');await idle(page)
  await page.getByRole('button',{name:'添加作品',exact:true}).click()
  const editor=page.locator('.cms-editor-dialog[open]')
  let uploads=0,settled=0
  const gate=new Promise(r=>release=r)
  await page.route('**/__local-cms/media-upload?**',async route=>{
    if(route.request().method()!=='POST'){await route.continue();return}
    try{const response=await route.fetch();uploads++;await gate;await route.fulfill({response})}catch{/* A canceled request must not be fulfilled. */}finally{settled++}
  })
  const cover=app.store.readDb().assets['10000000-0000-4000-8000-000000000101']
  await editor.locator('.media-picker-block',{hasText:'作品封面图'}).locator('input[type=file]').setInputFiles({name:'cover.webp',mimeType:'image/webp',buffer:fs.readFileSync(path.join(app.store.mediaDir,cover.displayPath))})
  await expect.poll(()=>uploads,{timeout:30000,message:'both actual upload responses must reach the hold gate'}).toBe(2)
  assert.equal(uploads,2,'both actual upload responses must be held')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'添加作品',exact:true}).click()
  await editor.getByLabel('作品标题（发布必填）').fill('NEW_SESSION')
  release()
  await expect.poll(()=>settled,{timeout:30000,message:'both held responses must finish before checking the new editor'}).toBe(2)
  await page.waitForTimeout(1500)
  assert.equal(await editor.locator('.picked-image-card').count(),0,'old upload must not enter a new form')
  assert.equal(await editor.getByLabel('作品标题（发布必填）').inputValue(),'NEW_SESSION')
  assert.equal(await editor.getByRole('button',{name:'保存草稿',exact:true}).isEnabled(),true)
  console.log('F08 PASS: old response cannot attach media or lock a newly opened editor')
} finally {release?.();await app.close()}
