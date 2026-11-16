import {browserExecutable,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const PORT = await freePort()
const BASE_URL = `http://127.0.0.1:${PORT}`

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
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  })

  try {
    await waitForServer(BASE_URL)
    const context = await browser.newContext({ viewport: { width: 1366, height: 860 } })
    const page = await context.newPage()

    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'yard')

    // Enable reduced motion for snappy navigation in tests
    const motionBtn = page.locator('.motion-button')
    if ((await motionBtn.getAttribute('aria-pressed')) !== 'true') {
      await motionBtn.click()
    }

    // 1. Verify default daylight atmosphere
    const rootClass = await page.locator('.home-app').getAttribute('class')
    assert(rootClass?.includes('atmo-daylight'), `Expected default atmo-daylight, got ${rootClass}`)
    const yardEyebrow = await page.locator('.welcome-eyebrow').textContent()
    assert(yardEyebrow?.includes('晴日庭院'), `Expected 晴日庭院 eyebrow, got ${yardEyebrow}`)

    // 2. Switch atmospheres: Dawn -> Golden -> Night + Rain
    await page.getByRole('button', { name: '天色：晨雾' }).click()
    assert(
      (await page.locator('.home-app').getAttribute('class'))?.includes('atmo-dawn'),
      'Dawn class not applied',
    )
    await page.getByRole('button', { name: '天色：落日' }).click()
    assert(
      (await page.locator('.home-app').getAttribute('class'))?.includes('atmo-golden'),
      'Golden class not applied',
    )
    await page.getByRole('button', { name: '天色：夜灯' }).click()
    assert(
      (await page.locator('.home-app').getAttribute('class'))?.includes('atmo-night'),
      'Night class not applied',
    )
    await page.getByRole('button', { name: '开启细雨' }).click()
    assert(
      (await page.locator('.home-app').getAttribute('class'))?.includes('weather-rain'),
      'Rain class not applied',
    )
    const nightRainEyebrow = await page.locator('.welcome-eyebrow').textContent()
    assert(
      nightRainEyebrow?.includes('夜灯庭院') && nightRainEyebrow?.includes('细雨'),
      `Expected 夜灯庭院 · 细雨, got ${nightRainEyebrow}`,
    )

    // 3. Yard tactile bench focus
    await page.getByRole('button', { name: '坐上木椅' }).click()
    await page.waitForSelector('.bench-card', { state: 'visible', timeout: 5000 })
    await page.getByRole('button', { name: '起身看全院' }).click()
    await page.waitForSelector('.bench-card', { state: 'hidden', timeout: 5000 })

    // 4. Yard mailbox jumps to Blank room and opens Guestbox + Now notes
    await page.getByRole('button', { name: '寄语信箱' }).click()
    await waitIdle(page, 'blank')
    await page.waitForSelector('.guestbox-card', { state: 'visible', timeout: 8000 })

    const nowChipCount = await page.locator('.now-note-chip').count()
    assert(nowChipCount === 3, `Expected 3 Now sticky notes, got ${nowChipCount}`)

    await page.getByRole('radio', { name: /夜灯共鸣/ }).click()
    await page.getByLabel('访客寄语短句').fill('今晚窗里的绿台灯很温暖')
    await page.getByRole('button', { name: '盖章留念' }).click()
    await page.waitForSelector('.guest-stamp-list li', { timeout: 5000 })
    const stampText = await page.locator('.guest-stamp-list li').first().textContent()
    assert(
      stampText?.includes('今晚窗里的绿台灯很温暖'),
      `Expected guest stamp note to render, got ${stampText}`,
    )

    // 5. Navigate to Study room and test Desk Lamp + Bookshelf Quote slip
    await page.getByRole('button', { name: '前往创作手记' }).click()
    await waitIdle(page, 'study')
    const lampBtn = page.locator('.tactile-bar').getByRole('button', { name: /台灯/ })
    const initialPressed = await lampBtn.getAttribute('aria-pressed')
    await lampBtn.click()
    const afterPressed = await lampBtn.getAttribute('aria-pressed')
    assert(initialPressed !== afterPressed, 'Desk lamp toggle did not change aria-pressed state')

    await page.getByRole('button', { name: '抽一张书架灵感签' }).click()
    await page.waitForSelector('.quote-card blockquote', { state: 'visible', timeout: 5000 })
    const quoteText = await page.locator('.quote-card blockquote').textContent()
    assert(Boolean(quoteText && quoteText.length > 4), 'Expected non-empty study quote')

    // 6. Verify mobile 390x844 layout has zero horizontal overflow and compact popover works
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(250)
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    assert(!hasOverflow, 'Mobile 390x844 has horizontal overflow')

    const compactTrigger = page.locator('.atmo-compact-trigger')
    assert(await compactTrigger.isVisible(), 'Expected compact atmosphere trigger on mobile')
    await compactTrigger.click()
    await page.waitForSelector('.atmo-popover', { state: 'visible', timeout: 3000 })
    await page.locator('.atmo-popover-btn', { hasText: '晴昼' }).click()
    assert(
      (await page.locator('.home-app').getAttribute('class'))?.includes('atmo-daylight'),
      'Mobile popover failed to switch back to daylight',
    )

    console.log('[phase1-verify] ALL CHECKS PASSED:')
    console.log('  - default daylight atmosphere and 4-time + rain switching verified')
    console.log('  - yard wooden bench sub-pose and mailbox jump to #blank verified')
    console.log('  - blank room 3 Now sticky notes and visitor stamp persistence verified')
    console.log('  - study brass-green desk lamp toggle and bookshelf quote slip verified')
    console.log('  - mobile 390x844 compact atmosphere popover and zero horizontal overflow verified')
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
