import assert from 'node:assert/strict'
import { startBrowserTest, idle } from './browser.mjs'
const app = await startBrowserTest()
try {
  for (const name of ['ProjectDetailModal', 'ProjectEditorModal', 'PostcardModal']) {
    if (process.argv[2] && process.argv[2] !== name) continue
    const page = await app.browser.newPage({ viewport: { width: 1366, height: 860 }, reducedMotion: 'reduce' })
    const errors = []
    page.on('pageerror', e => errors.push(e.message)) // Assert recovery, not absence of the injected failure.
    await page.route(`**/src/components/${name}.tsx*`, r => r.abort())
    if (name === 'ProjectEditorModal') await page.addInitScript(() => sessionStorage.setItem('paper-home:local-owner-active', '1'))
    await page.goto(app.url + (name === 'PostcardModal' ? '#yard' : '#gallery'))
    await idle(page)
    if (name === 'ProjectDetailModal') {
      await page.evaluate(() => location.hash = '#room=gallery&item=starter-cottage-example')
    } else {
      await page.getByRole('button', { name: name === 'ProjectEditorModal' ? '添加作品' : '拍一张纸质明信片', exact: true }).click()
    }
    await page.locator('dialog.lazy-error-dialog[open]').waitFor({ timeout: 15000 })
    assert.equal(await page.locator('.home-app').count(), 1)
    await page.locator('.lazy-error-dialog .dialog-close').click()
    assert.equal(await page.locator('.home-app').count(), 1, `Application disappeared on close: ${errors.join('; ')}`)
    assert.equal(await page.locator('dialog.lazy-error-dialog[open]').count(), 0)
    assert.equal(await page.locator('.walking-paused').count(), 0)
    await page.locator('.map-button').click()
    await page.locator('.map-dialog[open]').waitFor()
    await page.close()
    console.log(`F03 PASS ${name}: app survives, error closes, navigation unlocked`)
  }
} finally { await app.close() }
