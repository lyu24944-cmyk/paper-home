import {browserExecutable,browserTestArgs,browserTestHeadless,browserTestUrl,browserTestTimeout,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const PORT = await freePort()
const BASE_URL = browserTestUrl(`http://127.0.0.1:${PORT}/?qa=1`)

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

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
    (p) => location.hash === `#${p}` && !document.querySelector('.traveling') && !document.querySelector('.loading-note'),
    place,
    { timeout: 60000 },
  )
  await page.waitForTimeout(250)
}

async function readQaAudio(page) {
  return page.evaluate(() => {
    const qa = window.__HOME_QA__ || {}
    return {
      sfxEnabled: qa.sfxEnabled,
      lastSound: qa.lastSound ?? null,
      soundCount: Number(qa.soundCount || 0),
      audioContextCount: Number(qa.audioContextCount || 0),
      soundEvents: Array.isArray(qa.soundEvents) ? qa.soundEvents : [],
    }
  })
}

async function assertLastSound(page, expected, label) {
  const qa = await readQaAudio(page)
  assert(
    qa.lastSound === expected,
    `${label}: expected lastSound=${expected}, got ${qa.lastSound} (events=${JSON.stringify(qa.soundEvents.slice(-8))})`,
  )
  return qa
}

async function main() {
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = trackProcess(spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: rootDir,
      env:isolatedLocalEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ))

    const browser = await chromium.launch({
    ...browserExecutable(),
    headless: browserTestHeadless(),
    args: browserTestArgs(['--enable-gpu-rasterization']),
  })

  const runtimeErrors = []
  let context, page
  const evidenceDir = path.join(rootDir, '.qa', 'sound-verify')
  fs.mkdirSync(evidenceDir, { recursive: true })

  try {
    await waitForServer(`http://127.0.0.1:${PORT}`)
    context = await browser.newContext({ viewport: { width: 1366, height: 860 } })
    // DOM/canvas snapshots can themselves synchronize software WebGL work.
    // Keep action/network tracing lightweight; capture an image only on failure.
    await context.tracing.start({ screenshots: false, snapshots: false, sources: true })
    page = await context.newPage()

    page.on('pageerror', (err) => {
      runtimeErrors.push(`pageerror: ${err.message}`)
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`console.error: ${msg.text()}`)
      }
    })

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'yard')
    console.log('[sound-verify] renderer:', await page.evaluate(() => window.__HOME_QA__?.renderer))

    // 1. Default SFX button state is active
    const sfxBtn = page.locator('.sfx-button')
    assert(await sfxBtn.isVisible(), 'Expected .sfx-button to be visible in footer')
    assert(
      (await sfxBtn.getAttribute('aria-pressed')) === 'true',
      'Expected .sfx-button to be enabled by default',
    )

    // Enable reduced motion for snappy navigation & prime first AudioContext
    const motionBtn = page.locator('.motion-button')
    if ((await motionBtn.getAttribute('aria-pressed')) !== 'true') {
      await motionBtn.click()
      await page.waitForTimeout(100)
    }

    // 2. Click Enter door -> door-knock then delayed door-open + single AudioContext reuse
    await page.locator('.enter-button').click()
    await waitIdle(page, 'hall')
    await page.waitForTimeout(350)

    let qa = await readQaAudio(page)
    const knockIdx = qa.soundEvents.findIndex((e) => e.id === 'door-knock')
    const openIdx = qa.soundEvents.findIndex((e, idx) => idx > knockIdx && e.id === 'door-open')
    assert(knockIdx >= 0, `Expected door-knock sound event, got ${JSON.stringify(qa.soundEvents)}`)
    assert(openIdx > knockIdx, `Expected door-open after door-knock, got ${JSON.stringify(qa.soundEvents)}`)
    assert(qa.audioContextCount === 1, `Expected audioContextCount === 1, got ${qa.audioContextCount}`)

    // 3. Rapid hall footsteps reuse single AudioContext
    const forwardBtn = page.locator('.walk-steps button[aria-label="前进一段"]')
    await forwardBtn.click()
    await page.waitForTimeout(60)
    await forwardBtn.click()
    await page.waitForTimeout(120)
    qa = await readQaAudio(page)
    const stepCount = qa.soundEvents.filter((e) => e.id === 'step').length
    assert(stepCount >= 2, `Expected >= 2 step sounds, got ${stepCount}`)
    assert(qa.audioContextCount === 1, `AudioContext leaked on rapid steps: ${qa.audioContextCount}`)

    // 4. Atmosphere and weather toggles emit matching tactile audio
    await page.getByRole('button', { name: '天色：夜灯' }).click()
    await assertLastSound(page, 'atmo-night', 'Atmosphere night')
    await page.getByRole('button', { name: '开启细雨' }).click()
    await assertLastSound(page, 'rain-on', 'Weather rain on')
    await page.getByRole('button', { name: '关闭细雨' }).click()
    await assertLastSound(page, 'rain-off', 'Weather rain off')
    await page.getByRole('button', { name: '天色：晴昼' }).click()
    await assertLastSound(page, 'atmo-daylight', 'Atmosphere daylight')

    // 5. Map unfold & modal-close
    await page.locator('.map-button').click()
    await page.waitForSelector('.map-dialog', { state: 'visible', timeout: browserTestTimeout(5000) })
    await assertLastSound(page, 'map-unfold', 'Map unfold')
    await page.locator('.map-dialog .dialog-close').click()
    await page.waitForSelector('.map-dialog', { state: 'hidden', timeout: browserTestTimeout(5000) })
    await assertLastSound(page, 'modal-close', 'Map close')

    // 6. Navigate to Study via map -> test desk lamp, bookshelf quote slip, and directory drawer
    await page.locator('.map-button').click()
    await page.waitForSelector('.plan-study', { state: 'visible', timeout: browserTestTimeout(5000) })
    await page.locator('.plan-study').click()
    await waitIdle(page, 'study')

    const lampBtn = page.locator('.tactile-bar').getByRole('button', { name: /台灯/ })
    const initialLampPressed = await lampBtn.getAttribute('aria-pressed')
    await lampBtn.click()
    const firstLampSound = (await readQaAudio(page)).lastSound
    assert(
      firstLampSound === (initialLampPressed === 'true' ? 'lamp-off' : 'lamp-on'),
      `Unexpected desk lamp sound: ${firstLampSound}`,
    )
    await lampBtn.click()
    const secondLampSound = (await readQaAudio(page)).lastSound
    assert(
      secondLampSound === (initialLampPressed === 'true' ? 'lamp-on' : 'lamp-off'),
      `Unexpected second desk lamp sound: ${secondLampSound}`,
    )

    await page.getByRole('button', { name: '抽一张书架灵感签' }).click()
    await page.waitForSelector('.quote-card', { state: 'visible', timeout: browserTestTimeout(5000) })
    assert((await readQaAudio(page)).lastSound === 'paper-flip', 'Expected paper-flip sound for study quote')
    await page.getByRole('button', { name: '合上灵感签' }).click()
    assert((await readQaAudio(page)).lastSound === 'modal-close', 'Expected modal-close for quote dismiss')

    const dirToggle = page.locator('.directory-toggle')
    const dirWasExpanded = (await dirToggle.getAttribute('aria-expanded')) === 'true'
    await dirToggle.click()
    await page.waitForSelector('#room-directory', {
      state: dirWasExpanded ? 'hidden' : 'visible',
      timeout: browserTestTimeout(5000),
    })
    await assertLastSound(page, 'drawer-slide', 'Directory toggle 1')
    await dirToggle.click()
    await page.waitForSelector('#room-directory', {
      state: dirWasExpanded ? 'visible' : 'hidden',
      timeout: browserTestTimeout(5000),
    })
    await assertLastSound(page, 'drawer-slide', 'Directory toggle 2')

    // 7. Navigate to Blank room -> guestbox ink stamp
    await page.locator('.map-button').click()
    await page.waitForSelector('.plan-blank', { state: 'visible', timeout: browserTestTimeout(5000) })
    await page.locator('.plan-blank').click()
    await waitIdle(page, 'blank')

    await page.locator('.tactile-bar').getByRole('button', { name: /桌面近况与寄语匣/ }).click()
    await page.waitForSelector('.guestbox-card', { state: 'visible', timeout: browserTestTimeout(5000) })
    await page.getByRole('radio', { name: /夜灯共鸣/ }).click()
    assert((await readQaAudio(page)).lastSound === 'ui-switch', 'Expected ui-switch for mood radio')
    await page.getByLabel('访客寄语短句').fill('听见纸张与盖章的轻响')
    await page.getByRole('button', { name: '盖章留念' }).click()
    assert((await readQaAudio(page)).lastSound === 'ink-stamp', 'Expected ink-stamp on submit')
    await page.getByRole('button', { name: '收起桌面寄语匣' }).click()
    assert((await readQaAudio(page)).lastSound === 'modal-close', 'Expected modal-close dismissing guestbox')

    // Toggle ambient bed on/off
    const ambientBtn = page.locator('.ambient-button')
    await ambientBtn.click()
    await assertLastSound(page, 'ambient-on', 'Ambient toggle on')
    await ambientBtn.click()
    await assertLastSound(page, 'ambient-off', 'Ambient toggle off')

    // 8. Verify global SFX mute suppresses new SFX & persists across reload
    await sfxBtn.click()
    assert((await sfxBtn.getAttribute('aria-pressed')) === 'false', 'Expected .sfx-button to switch off')
    qa = await readQaAudio(page)
    assert(qa.sfxEnabled === false, 'Expected QA state sfxEnabled === false after mute')
    assert(qa.audioContextCount === 1, `Expected audioContextCount === 1 before reload, got ${qa.audioContextCount}`)

    const countWhenMuted = qa.soundCount
    await page.locator('.map-button').click()
    await page.waitForSelector('.map-dialog', { state: 'visible', timeout: browserTestTimeout(5000) })
    await page.locator('.map-dialog .dialog-close').click()
    await page.waitForSelector('.map-dialog', { state: 'hidden', timeout: browserTestTimeout(5000) })
    await page.getByRole('button', { name: '天色：晨雾' }).click()

    qa = await readQaAudio(page)
    assert(
      qa.soundCount === countWhenMuted,
      `Expected no sounds while muted (was ${countWhenMuted}, became ${qa.soundCount})`,
    )

    // Reload and check persistence
    await page.reload({ waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'blank')
    assert(
      (await page.locator('.sfx-button').getAttribute('aria-pressed')) === 'false',
      'Expected muted state to persist across page reload',
    )

    // Re-enable SFX
    await page.locator('.sfx-button').click()
    assert(
      (await page.locator('.sfx-button').getAttribute('aria-pressed')) === 'true',
      'Expected .sfx-button to re-enable',
    )
    assert((await readQaAudio(page)).lastSound === 'ui-switch', 'Expected ui-switch chime when re-enabling SFX')

    // 9. Verify mobile 390x844 layout has zero horizontal overflow & visible footer sound buttons
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(250)
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    assert(!hasOverflow, 'Mobile 390x844 has horizontal overflow after adding .sfx-button')

    const sfxBox = await page.locator('.sfx-button').boundingBox()
    const ambBox = await page.locator('.ambient-button').boundingBox()
    assert(Boolean(sfxBox && sfxBox.width > 0 && sfxBox.x + sfxBox.width <= 390), 'Invalid mobile .sfx-button layout')
    assert(Boolean(ambBox && ambBox.width > 0 && ambBox.x + ambBox.width <= 390), 'Invalid mobile .ambient-button layout')

    assert(runtimeErrors.length === 0, `Unexpected runtime errors: ${runtimeErrors.join(' | ')}`)

    console.log('[sound-verify] ALL CHECKS PASSED:')
    console.log('  - default active .sfx-button and single AudioContext reuse (count=1) verified')
    console.log('  - door knock + open, footsteps, 4-atmo/rain, map unfold, study lamp, quote flip, drawer slide, ink stamp verified')
    console.log('  - mute toggle suppresses DOM/handler SFX and persists across reload')
    console.log('  - mobile 390x844 footer buttons fit cleanly with zero horizontal overflow')
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(evidenceDir, 'failure.png'), timeout: 10000 }).catch(() => {})
    throw error
  } finally {
    if (context) await context.tracing.stop({ path: path.join(evidenceDir, 'trace.zip') }).catch(() => {})
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
