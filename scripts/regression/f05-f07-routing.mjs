import assert from 'node:assert/strict'
import { startBrowserTest, idle } from './browser.mjs'
const app=await startBrowserTest(),failures=[]
try {
  for(const id of [5,6,7]){
    if(process.argv[2]&&Number(process.argv[2])!==id)continue
    const page=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:id===5?'no-preference':'reduce'})
    try {
      if(id===5){
        await page.goto(app.url+'#yard');await idle(page)
        await page.getByRole('button',{name:'敲敲门，进来坐坐',exact:true}).click()
        await page.waitForSelector('.traveling')
        await page.evaluate(()=>location.hash='#room=study&at=night&weather=rain&focus=study-shelf&lamp=1')
        await page.waitForTimeout(100)
        await page.waitForFunction(()=>!document.querySelector('.traveling'),null,{timeout:60000})
        // A queued second trip may start on the next React commit.
        await page.waitForTimeout(250)
        await idle(page)
        await page.waitForFunction(()=>window.__HOME_QA__?.focusId==='study-shelf' && window.__HOME_QA__?.weather==='rain',null,{timeout:10000})
        const state=await page.evaluate(()=>({place:document.querySelector('.home-app')?.className,hash:location.hash,focus:window.__HOME_QA__?.focusId}))
        assert(state.place.includes('place-study'),JSON.stringify(state));assert(state.place.includes('weather-rain'));assert.equal(state.focus,'study-shelf');assert(state.hash.includes('room=study'))
      }else if(id===6){
        await page.goto(app.url+'#room=study&item=how-to-customize-your-cottage');await idle(page)
        await page.locator('.note-detail-dialog[open] .linked-pill-btn').click()
        await page.locator('.project-detail-dialog[open]').getByRole('button',{name:'拍明信片',exact:true}).click()
        const hash=await page.locator('.postcard-deeplink-box code').textContent()
        assert(hash.includes('room=gallery'),hash);assert(hash.includes('item=starter-cottage-example'),hash)
        const cold=await app.browser.newPage({viewport:{width:1366,height:860},reducedMotion:'reduce'})
        try{
          await cold.goto(app.url+hash.trim());await idle(cold)
          await cold.locator('.project-detail-dialog[open]').waitFor()
          assert((await cold.locator('.home-app').getAttribute('class')).includes('place-gallery'))
          await cold.locator('.project-detail-dialog[open] .linked-pill-btn').click()
          await cold.locator('.note-detail-dialog[open]').getByRole('button',{name:'拍明信片',exact:true}).click()
          const noteHash=(await cold.locator('.postcard-deeplink-box code').textContent()).trim()
          assert(noteHash.includes('room=study'));assert(noteHash.includes('item=how-to-customize-your-cottage'))
          const noteCold=await app.browser.newPage({reducedMotion:'reduce'})
          try{
            await noteCold.goto(app.url+noteHash);await idle(noteCold)
            await noteCold.locator('.note-detail-dialog[open]').waitFor()
            assert((await noteCold.locator('.home-app').getAttribute('class')).includes('place-study'))
          }finally{await noteCold.close()}

        }finally{await cold.close()}

      }else{
        await page.goto(app.url+'#yard');await idle(page)
        const hash=await page.evaluate(async()=>{localStorage.setItem('paper-home:weather','rain');const m=await import('/src/lib/deeplink.ts');return m.buildDeepLinkHash({room:'yard',at:'daylight',weather:'clear'})})
        assert(hash.includes('weather=clear'),hash)
        await page.goto(app.url+'&cold=7'+hash);await idle(page)
        assert.equal(await page.evaluate(()=>window.__HOME_QA__.weather),'clear')
      }
      console.log(`F0${id} PASS`)
    }catch(e){failures.push(`F0${id}: ${e.message}`);console.log(`F0${id} FAIL`,e.message)}finally{await page.close()}
  }
}finally{await app.close()}
assert.deepEqual(failures,[])
