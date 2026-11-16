import assert from 'node:assert/strict'
import fs from 'node:fs'
import { startBrowserTest, idle } from './browser.mjs'
const app = await startBrowserTest()
fs.mkdirSync('.qa/regression/trees', { recursive: true })
try {
  const page = await app.browser.newPage({ viewport: { width: 1366, height: 860 }, reducedMotion: 'reduce' })
  const errors = []
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if(m.type()==='error')errors.push(m.text()) })
  for(const quality of ['low','high']) {
    await page.goto(app.url.replace('quality=low',`quality=${quality}`)+'#yard')
    await idle(page)
    await page.screenshot({path:`.qa/regression/trees/${quality}-yard.png`})
    await page.getByRole('button',{name:'坐上木椅',exact:true}).click()
    await page.waitForTimeout(150)
    await page.screenshot({path:`.qa/regression/trees/${quality}-bench.png`})
    await page.getByRole('button',{name:'起身看全院',exact:true}).click()
    await page.getByRole('button',{name:'天色：夜灯',exact:true}).click()
    await page.getByRole('button',{name:'开启细雨',exact:true}).click()
    await page.waitForTimeout(150)
    await page.screenshot({path:`.qa/regression/trees/${quality}-night-rain.png`})
    await page.evaluate(()=>location.hash='#gallery')
    await idle(page)
    await page.screenshot({path:`.qa/regression/trees/${quality}-window.png`})
    console.log('F04 browser',quality,await page.evaluate(()=>({programs:window.__HOME_QA__?.programs,triangles:window.__HOME_QA__?.sceneTriangles})))
    await page.getByRole('button',{name:'天色：晴昼',exact:true}).click()
    await page.getByRole('button',{name:'关闭细雨',exact:true}).click()
  }
  assert.deepEqual(errors,[])
  console.log('F04 PASS: high/low courtyard, bench, night/rain, room-window render without shader errors')
} finally { await app.close() }
