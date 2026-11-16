import assert from 'node:assert/strict'
import {startBrowserTest,idle} from './browser.mjs'
const app=await startBrowserTest()
try{
  const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
  await page.addInitScript(()=>sessionStorage.setItem('paper-home:local-owner-active','1'))
  await page.route('**/__local-cms/admin-content',async route=>{
    const response=await route.fetch(),data=await response.json()
    await route.fulfill({response,json:{...data,pendingCleanupCount:1}})
  })
  await page.route('**/__local-cms/media-cleanup',async route=>{
    assert.equal(route.request().postDataJSON().sweepOrphans,true)
    await route.fulfill({status:200,json:{cleaned:0,remaining:1,errors:['injected orphan traversal failure']}})
  })
  await page.goto(app.url+'#yard');await idle(page)
  await page.locator('.map-button').click()
  await page.getByRole('button',{name:'重试清理',exact:true}).click()
  await page.getByRole('alert').filter({hasText:'injected orphan traversal failure'}).waitFor()
  assert.equal(await page.getByText('旧素材清理检查完成',{exact:true}).count(),0)
  assert.equal(await page.getByText('待清理旧素材已检查完毕。',{exact:true}).count(),0)
  console.log('F17 PASS: HTTP 200 with cleanup errors shows an error, retains retry and never announces success')
}finally{await app.close()}
