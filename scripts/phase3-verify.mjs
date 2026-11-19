import {
  browserExecutable,
  browserTestArgs,
  browserTestHeadless,
  browserTestTimeout,
  browserTestUrl,
  freePort,
  isolatedLocalEnv,
  stopProcess,
  trackProcess,
} from './test-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const PORT = await freePort()
const BASE_URL = browserTestUrl(`http://127.0.0.1:${PORT}/?qa=1`)

async function waitForServer(url, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

async function waitIdle(page, place) {
  await page.waitForFunction(
    (p) => {
      const app = document.querySelector('.home-app')
      return (
        app?.classList.contains(`place-${p}`) &&
        !document.querySelector('.traveling') &&
        !document.querySelector('.loading-note')
      )
    },
    place,
    { timeout: 60000 },
  )
  await page.waitForTimeout(250)
}

async function main() {
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = trackProcess(
    spawn(
      process.execPath,
      [viteBin, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
      {
        cwd: rootDir,
        env: isolatedLocalEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    ),
  )

  const browser = await chromium.launch({
    ...browserExecutable(),
    headless: browserTestHeadless(),
    args: browserTestArgs(['--enable-gpu-rasterization']),
  })

  const runtimeErrors = []

  try {
    await waitForServer(BASE_URL)
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } })
    const page = await context.newPage()
    page.on('pageerror', (err) => runtimeErrors.push(`pageerror: ${err.message}`))
    page.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`console.error: ${msg.text()}`)
    })

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'yard')

    // 1. Default Chinese UI checks
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN')
    assert.equal(await page.evaluate(() => window.__HOME_QA__?.locale), 'zh')
    const zhEyebrow = await page.locator('.welcome-eyebrow').textContent()
    assert.ok(zhEyebrow?.includes('晴日庭院'), `Expected 晴日庭院, got ${zhEyebrow}`)
    assert.ok((await page.locator('.map-button').textContent())?.includes('小屋地图'))

    // 2. Switch to English UI and verify header, yard, map modal, postcard modal
    await page.locator('.lang-button').click()
    await page.waitForFunction(() => document.documentElement.lang === 'en')
    assert.equal(await page.evaluate(() => window.__HOME_QA__?.locale), 'en')
    const enEyebrow = await page.locator('.welcome-eyebrow').textContent()
    assert.ok(enEyebrow?.includes('Sunlit Courtyard'), `Expected Sunlit Courtyard, got ${enEyebrow}`)
    assert.ok((await page.locator('.map-button').textContent())?.includes('Cottage Map'))
    assert.ok((await page.locator('.enter-button').textContent())?.includes('Knock & Step Inside'))

    await page.locator('.map-button').click()
    const mapDialog = page.locator('dialog.map-dialog[open]')
    await mapDialog.waitFor({ state: 'visible', timeout: browserTestTimeout(5000) })
    const mapHeading = await mapDialog.locator('h2').textContent()
    assert.equal(mapHeading?.trim(), 'Cottage Map')
    const planText = await mapDialog.locator('.floor-plan').textContent()
    for (const roomLabel of ['Courtyard', 'Corridor', 'Gallery', 'Study Notes', 'About Me']) {
      assert.ok(planText?.includes(roomLabel), `Missing English room label "${roomLabel}" in map`)
    }
    await page.keyboard.press('Escape')
    await mapDialog.waitFor({ state: 'hidden', timeout: browserTestTimeout(5000) })

    await page.locator('.postcard-button').click()
    const postcardDialog = page.locator('dialog.postcard-dialog[open]')
    await postcardDialog.waitFor({ state: 'visible', timeout: browserTestTimeout(5000) })
    assert.equal((await postcardDialog.locator('h2').textContent())?.trim(), 'Create a Paper Postcard')
    await postcardDialog.locator('img.postcard-preview-img').waitFor({
      state: 'visible',
      timeout: browserTestTimeout(8000),
    })
    await page.keyboard.press('Escape')
    await postcardDialog.waitFor({ state: 'hidden', timeout: browserTestTimeout(5000) })

    // 3. Check mobile 390x844 layout in English has zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(200)
    const mobileOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    assert.equal(mobileOverflow, false, 'English mobile 390x844 has horizontal overflow')
    assert.ok(await page.locator('.lang-button').isVisible(), 'Expected language button visible on mobile')
    await page.setViewportSize({ width: 1366, height: 860 })
    await page.waitForTimeout(200)

    // 4. Reload and confirm English preference persists via localStorage, then toggle back to Chinese
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'yard')
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'en')
    assert.ok((await page.locator('.map-button').textContent())?.includes('Cottage Map'))

    await page.locator('.lang-button').click()
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN')
    assert.ok((await page.locator('.map-button').textContent())?.includes('小屋地图'))

    // 5. Enter Corridor in normal motion mode and test keyboard roaming (W/A/S/D, Home/End, Enter)
    await page.locator('.enter-button').click()
    await waitIdle(page, 'hall')

    // Blur any focused control so window-level roaming works even when focus is on body/canvas
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })

    const initialProgress = await page.evaluate(() => window.__HOME_QA__?.getHallProgress?.() ?? -1)
    assert.ok(initialProgress >= 0 && initialProgress < 0.05, `Expected start progress near 0, got ${initialProgress}`)

    // Hold W to walk forward smoothly
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(650)
    await page.keyboard.up('KeyW')
    const afterW = await page.evaluate(() => window.__HOME_QA__?.getHallProgress?.() ?? 0)
    assert.ok(afterW > 0.08, `Expected W key to advance corridor progress (>0.08), got ${afterW}`)

    // Hold A / D to glance left & right
    await page.keyboard.down('KeyA')
    await page.waitForTimeout(100)
    const lookLeft = await page.evaluate(() => window.__HOME_QA__?.getHallLook?.() ?? 0)
    assert.ok(lookLeft < -0.3, `Expected A key to glance left (< -0.3), got ${lookLeft}`)
    await page.keyboard.up('KeyA')
    assert.equal(await page.evaluate(() => window.__HOME_QA__?.getHallLook?.() ?? -1), 0)

    await page.keyboard.down('KeyD')
    await page.waitForTimeout(100)
    const lookRight = await page.evaluate(() => window.__HOME_QA__?.getHallLook?.() ?? 0)
    assert.ok(lookRight > 0.3, `Expected D key to glance right (> 0.3), got ${lookRight}`)
    await page.keyboard.up('KeyD')
    assert.equal(await page.evaluate(() => window.__HOME_QA__?.getHallLook?.() ?? -1), 0)

    // Hold S to walk backward
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(450)
    await page.keyboard.up('KeyS')
    const afterS = await page.evaluate(() => window.__HOME_QA__?.getHallProgress?.() ?? 1)
    assert.ok(afterS < afterW, `Expected S key to walk backward (< ${afterW}), got ${afterS}`)

    // Enable reduced motion for deterministic Home/End & door entry check
    const motionBtn = page.locator('.motion-button')
    if ((await motionBtn.getAttribute('aria-pressed')) !== 'true') {
      await motionBtn.click()
    }
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
    })

    // End jumps to corridor end; Home jumps back to threshold
    await page.keyboard.press('End')
    await page.waitForFunction(() => (window.__HOME_QA__?.getHallProgress?.() ?? 0) > 0.95, null, {
      timeout: browserTestTimeout(5000),
    })
    await page.keyboard.press('Home')
    await page.waitForFunction(() => (window.__HOME_QA__?.getHallProgress?.() ?? 1) < 0.05, null, {
      timeout: browserTestTimeout(5000),
    })

    // Walk forward until nearby === 'gallery' and press Enter to open the door
    for (let i = 0; i < 6; i++) {
      const near = await page.evaluate(() => window.__HOME_QA__?.nearby)
      if (near === 'gallery') break
      await page.keyboard.press('KeyW')
      await page.waitForTimeout(120)
    }
    const nearbyDoor = await page.evaluate(() => window.__HOME_QA__?.nearby)
    assert.equal(nearbyDoor, 'gallery', `Expected nearby door to be gallery, got ${nearbyDoor}`)
    assert.ok(await page.locator('.near-door').isVisible(), 'Expected .near-door prompt visible')
    await page.keyboard.press('Enter')
    await waitIdle(page, 'gallery')

    // Return to hall, open Map Modal, focus #home-name, and ensure typing 'wsad' does NOT move corridor
    await page.locator('.back-button').click()
    await waitIdle(page, 'hall')
    const progressBeforeInput = await page.evaluate(() => window.__HOME_QA__?.getHallProgress?.() ?? -1)

    await page.locator('.map-button').click()
    await mapDialog.waitFor({ state: 'visible', timeout: browserTestTimeout(5000) })
    const nameInput = mapDialog.locator('#home-name')
    await nameInput.fill('')
    await nameInput.type('wsad')
    assert.equal(await nameInput.inputValue(), 'wsad')
    const progressAfterInput = await page.evaluate(() => window.__HOME_QA__?.getHallProgress?.() ?? -1)
    assert.equal(progressAfterInput, progressBeforeInput, 'Typing inside modal input must not move corridor')
    await page.keyboard.press('Escape')

    assert.deepEqual(runtimeErrors, [], `Unexpected browser errors: ${runtimeErrors.join(' | ')}`)

    console.log('[phase3-verify] ALL CHECKS PASSED:')
    console.log('  - bilingual ZH <-> EN UI switching across yard, map, postcard, and reload persistence')
    console.log('  - mobile 390x844 English layout with zero horizontal overflow')
    console.log('  - corridor keyboard roaming (W/S walk, A/D glance, Home/End, Enter door entry)')
    console.log('  - keyboard roaming safely suppressed while typing inside modals')
  } finally {
    await browser.close()
    try {
      await stopProcess(server)
    } catch {
      // ignore
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
