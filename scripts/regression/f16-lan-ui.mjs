import assert from 'node:assert/strict'
import {startBrowserTest,idle} from './browser.mjs'
const app=await startBrowserTest({lan:true})
try{
  const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
  await page.goto(app.url+'#gallery');await idle(page)
  await page.locator('.map-button').click()
  await page.getByLabel('局域网编辑 PIN').fill('regression-pin-only')
  let failLogin=true
  await page.route('**/__local-cms/session',route=>{
    if(failLogin && route.request().method()==='POST'){failLogin=false;return route.abort('failed')}
    return route.continue()
  })
  await page.getByRole('button',{name:'使用 PIN 进入编辑',exact:true}).click()
  await page.locator('.admin-auth-section').getByRole('alert').waitFor()
  assert.equal(await page.getByLabel('局域网编辑 PIN').inputValue(),'regression-pin-only','failed login keeps input for an explicit retry')
  let releaseOld,started,holdNext=true
  const held=new Promise(resolve=>releaseOld=resolve),waiting=new Promise(resolve=>started=resolve)
  await page.route('**/__local-cms/health',async route=>{
    if(!holdNext)return route.continue()
    holdNext=false
    const response=await route.fetch();started();await held;await route.fulfill({response})
  })
  await page.evaluate(()=>{window.__delayedHealth=import('/src/lib/backend.ts').then(m=>m.resolveBackendHealth(true))})
  await waiting
  await page.getByRole('button',{name:'使用 PIN 进入编辑',exact:true}).click()
  await page.getByText('本地编辑模式',{exact:true}).waitFor()
  assert.equal(await page.getByLabel('局域网编辑 PIN').count(),0)
  const state=await page.evaluate(async()=>({pin:sessionStorage.getItem('paper-home:local-pin'),health:await(await fetch('/__local-cms/health')).json()}))
  assert.equal(state.pin,null);assert.equal(state.health.writable,true)
  releaseOld();await page.evaluate(()=>window.__delayedHealth)
  assert.equal(await page.evaluate(async()=>(await(await import('/src/lib/backend.ts')).resolveBackendHealth()).writable),true,'a delayed pre-login health response cannot refill the cache')
  await page.keyboard.press('Escape')
  await page.getByRole('button',{name:'添加作品',exact:true}).click()
  await page.locator('.cms-editor-dialog[open]').waitFor()
  await page.keyboard.press('Escape');await page.locator('.map-button').click()
  await page.getByRole('button',{name:'退出编辑（访客预览）',exact:true}).click()
  await page.getByLabel('局域网编辑 PIN').waitFor()
  assert.equal((await page.evaluate(async()=>(await fetch('/__local-cms/admin-content',{headers:{'X-Local-Owner':'1'}})).status)),403)
  console.log('F16 PASS: LAN PIN UI, fresh writable health, no persisted PIN and server logout, network failure and stale health invalidation')
}finally{await app.close()}
