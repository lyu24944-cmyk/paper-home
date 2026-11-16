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
  let release,uploads=0
  const gate=new Promise(r=>release=r)
  await page.route('**/__local-cms/media-upload?**',async route=>{
    try{const response=await route.fetch();uploads++;await gate;await route.fulfill({response})}catch{/* A canceled request must not be fulfilled. */}
  })
  const cover=app.store.readDb().assets['10000000-0000-4000-8000-000000000101']
  await editor.locator('.media-picker-block',{hasText:'作品封面图'}).locator('input[type=file]').setInputFiles({name:'cover.webp',mimeType:'image/webp',buffer:fs.readFileSync(path.join(app.store.mediaDir,cover.displayPath))})
  await page.waitForTimeout(500)
  assert.equal(uploads,2,'both actual upload responses must be held')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'添加作品',exact:true}).click()
  await editor.getByLabel('作品标题（发布必填）').fill('NEW_SESSION')
  release();await page.waitForTimeout(1500)
  assert.equal(await editor.locator('.picked-image-card').count(),0,'old upload must not enter a new form')
  assert.equal(await editor.getByLabel('作品标题（发布必填）').inputValue(),'NEW_SESSION')
  assert.equal(await editor.getByRole('button',{name:'保存草稿',exact:true}).isEnabled(),true)
  console.log('F08 PASS: old response cannot attach media or lock a newly opened editor')
} finally {await app.close()}
