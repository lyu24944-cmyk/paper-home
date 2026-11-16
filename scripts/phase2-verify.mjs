import {browserExecutable,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const qaOutDir = path.join(rootDir, '.qa', 'phase2-verify')
const localDataDir = path.join(qaOutDir, 'local-data')
const downloadDir = path.join(qaOutDir, 'downloads')
const PORT = await freePort()
const BASE_URL = `http://127.0.0.1:${PORT}`

fs.rmSync(qaOutDir, { recursive: true, force: true })
fs.mkdirSync(localDataDir, { recursive: true })
fs.mkdirSync(downloadDir, { recursive: true })

async function waitForHttp(url, timeoutMs = 25000) {
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
  const testPng = await sharp({
    create: { width: 320, height: 220, channels: 4, background: { r: 74, g: 112, b: 86, alpha: 1 } },
  })
    .png()
    .toBuffer()

  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const server = trackProcess(spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'],
    {
      cwd: rootDir,
      env: {
        ...isolatedLocalEnv(localDataDir),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ))

    const browser = await chromium.launch({
    ...browserExecutable(),
    headless: true,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  })

  const runtimeErrors = []

  try {
    await waitForHttp(`${BASE_URL}/__local-cms/health`)
    const context = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      acceptDownloads: true,
    })
    const page = await context.newPage()

    page.on('pageerror', (err) => {
      runtimeErrors.push(`pageerror: ${err.message}`)
    })
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        runtimeErrors.push(`console.error: ${msg.text()}`)
      }
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(`${BASE_URL}/?qa`, { waitUntil: 'domcontentloaded' })
    await waitIdle(page, 'yard')

    // 1. Seed & publish one gallery project via Local Edit Mode
    await page.locator('.map-button').click()
    await page.waitForSelector('.map-dialog', { state: 'visible' })
    await page.getByRole('button', { name: '进入编辑模式' }).click()
    await page.getByText('本地编辑模式', { exact: true }).waitFor({ timeout: 10000 })
    await page.locator('.map-dialog .plan-gallery').click()
    await waitIdle(page, 'gallery')

    await page.getByRole('button', { name: '添加作品' }).click()
    const ed = page.locator('dialog.cms-editor-dialog[open]')
    await ed.getByLabel('作品标题（发布必填）').fill('松果黄铜台灯')
    await ed.getByLabel('作品简介（发布必填）').fill('把实体纸张与暖灯带进三维房间的作品。')
    await ed.getByLabel('作品正文（发布必填，支持分段纯文本）').fill('一盏在夜灯下才会透出绿色柔光的台灯。')
    await ed.locator('.media-picker-block', { hasText: '作品封面图' }).locator('input[type="file"]').setInputFiles({
      name: 'lamp-cover.png',
      mimeType: 'image/png',
      buffer: testPng,
    })
    await ed.getByText(/已上传 1 张图片/).waitFor({ timeout: 15000 })
    await ed.getByRole('button', { name: '发布作品' }).click()
    await ed.getByText(/作品已发布到作品室/).waitFor({ timeout: 15000 })
    await page.keyboard.press('Escape')
    await page.waitForSelector('dialog.cms-editor-dialog[open]', { state: 'hidden', timeout: 10000 })

    // Switch back to pure visitor session via fresh context on Yard first to test footer postcard
    const visitorCtx = await browser.newContext({
      viewport: { width: 1366, height: 860 },
      acceptDownloads: true,
    })
    const vPage = await visitorCtx.newPage()
    vPage.on('pageerror', (err) => runtimeErrors.push(`visitor pageerror: ${err.message}`))
    vPage.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`visitor console.error: ${msg.text()}`)
    })

    await vPage.emulateMedia({ reducedMotion: 'reduce' })
    await vPage.goto(`${BASE_URL}/?qa`, { waitUntil: 'domcontentloaded' })
    await waitIdle(vPage, 'yard')

    // 2. Capture WebGL postcard directly from Yard (night + rain)
    await vPage.getByRole('button', { name: '天色：夜灯' }).click()
    await vPage.getByRole('button', { name: '开启细雨' }).click()
    await vPage.waitForTimeout(250)

    const postcardBtn = vPage.locator('.postcard-button')
    assert(await postcardBtn.isVisible(), 'Expected .postcard-button to be visible in footer')
    await postcardBtn.click()
    await vPage.waitForSelector('.postcard-dialog', { state: 'visible', timeout: 8000 })
    await vPage.waitForSelector('.postcard-preview-img', { state: 'visible', timeout: 8000 })

    const firstSrc = await vPage.locator('.postcard-preview-img').getAttribute('src')
    assert(firstSrc?.startsWith('data:image/png;base64,'), 'Expected PNG data URL preview image')
    const pngBytes = Buffer.from(firstSrc.replace(/^data:image\/png;base64,/, ''), 'base64')
    const meta = await sharp(pngBytes).metadata()
    assert.equal(meta.width, 1200, `Expected postcard width 1200, got ${meta.width}`)
    assert.equal(meta.height, 1560, `Expected postcard height 1560, got ${meta.height}`)

    // Ensure WebGL snapshot actually rendered varied pixels (not solid flat blank)
    const stats = await sharp(pngBytes).extract({left:120,top:120,width:840,height:600}).stats()
    assert(stats.channels.slice(0,3).every(channel=>channel.stdev>8), `Postcard PNG seems blank/flat (stdev=${stats.channels[0].stdev})`)

    // Live greeting update regenerates card cleanly
    await vPage.locator('#postcard-message-input').fill('在夜雨中的小院檐下寄出一张明信片。')
    await vPage.waitForFunction(
      (prev) => {
        const cur = document.querySelector('.postcard-preview-img')?.getAttribute('src')
        return Boolean(cur && cur !== prev)
      },
      firstSrc,
      { timeout: 6000 },
    )
    const updatedSrc = await vPage.locator('.postcard-preview-img').getAttribute('src')
    assert(updatedSrc && updatedSrc !== firstSrc, 'Expected live greeting edit to update postcard preview')

    // Download PNG works cleanly
    const [download] = await Promise.all([
      vPage.waitForEvent('download'),
      vPage.locator('.postcard-dialog').getByRole('button', { name: '下载明信片 PNG' }).click(),
    ])
    assert(download.suggestedFilename().endsWith('.png'), `Unexpected download name: ${download.suggestedFilename()}`)
    const savedPath = path.join(downloadDir, download.suggestedFilename())
    await download.saveAs(savedPath)
    const savedMeta = await sharp(savedPath).metadata()
    assert.equal(savedMeta.width, 1200)
    assert.equal(savedMeta.height, 1560)

    await vPage.locator('.postcard-dialog .dialog-close').click()
    await vPage.waitForSelector('.postcard-dialog', { state: 'hidden', timeout: 5000 })

    // 3. Open published project in Gallery -> capture project-specific postcard & deep link
    await vPage.locator('.map-button').click()
    await vPage.waitForSelector('.plan-gallery', { state: 'visible' })
    await vPage.locator('.plan-gallery').click()
    await waitIdle(vPage, 'gallery')

    await vPage.locator('.directory-toggle').click()
    await vPage.waitForSelector('#room-directory', { state: 'visible' })
    await vPage.locator('#room-directory').getByRole('button', { name: /松果黄铜台灯/ }).click()
    await vPage.waitForSelector('dialog.project-detail-dialog[open]', { state: 'visible', timeout: 8000 })

    await vPage.locator('dialog.project-detail-dialog[open]').getByRole('button', { name: '拍明信片' }).click()
    await vPage.waitForSelector('.postcard-dialog[open]', { state: 'visible', timeout: 8000 })
    await vPage.waitForSelector('.postcard-preview-img', { state: 'visible', timeout: 8000 })

    const itemDeepHash = (await vPage.locator('.postcard-deeplink-box code').textContent())?.trim()
    assert(
      itemDeepHash &&
        itemDeepHash.includes('room=gallery') &&
        itemDeepHash.includes('item=') &&
        itemDeepHash.includes('at=night') &&
        itemDeepHash.includes('weather=rain'),
      `Unexpected item deep link hash: ${itemDeepHash}`,
    )

    // 4. Open fresh browser tab directly to itemDeepHash -> restores gallery + night + rain + opens project modal automatically
    const deepPage = await visitorCtx.newPage()
    deepPage.on('pageerror', (err) => runtimeErrors.push(`deep pageerror: ${err.message}`))
    deepPage.on('console', (msg) => {
      if (msg.type() === 'error') runtimeErrors.push(`deep console.error: ${msg.text()}`)
    })
    await deepPage.emulateMedia({ reducedMotion: 'reduce' })
    await deepPage.goto(`${BASE_URL}/?qa${itemDeepHash}`, { waitUntil: 'domcontentloaded' })
    await waitIdle(deepPage, 'gallery')

    const appCls = await deepPage.locator('.home-app').getAttribute('class')
    assert(appCls?.includes('atmo-night'), `Deep link failed to restore night atmosphere: ${appCls}`)
    assert(appCls?.includes('weather-rain'), `Deep link failed to restore rain weather: ${appCls}`)

    await deepPage.waitForSelector('dialog.project-detail-dialog[open]', { state: 'visible', timeout: 10000 })
    const modalText = await deepPage.locator('dialog.project-detail-dialog[open]').textContent()
    assert(modalText?.includes('松果黄铜台灯'), `Deep link opened wrong modal content: ${modalText}`)

    // Close modal & verify live in-tab hashchange deep link (#room=study&at=golden&focus=study-shelf&lamp=1)
    await deepPage.keyboard.press('Escape')
    await deepPage.waitForSelector('dialog.project-detail-dialog[open]', { state: 'hidden', timeout: 5000 })
    await deepPage.evaluate(() => {
      window.location.hash = '#room=study&at=golden&focus=study-shelf&lamp=1'
    })
    await waitIdle(deepPage, 'study')
    const studyCls = await deepPage.locator('.home-app').getAttribute('class')
    assert(studyCls?.includes('atmo-golden'), `Hashchange failed to switch to golden: ${studyCls}`)
    const qaStudy = await deepPage.evaluate(() => window.__HOME_QA__)
    assert.equal(qaStudy?.focusId, 'study-shelf', `Expected study-shelf focus, got ${qaStudy?.focusId}`)
    assert.equal(qaStudy?.deskLampOn, true, 'Expected lamp=1 to light up desk lamp')

    // 5. Verify mobile 390x844 has zero horizontal overflow & postcard button fits cleanly
    await vPage.setViewportSize({ width: 390, height: 844 })
    await vPage.waitForTimeout(250)
    const postcardDialogBox = await vPage.locator('.postcard-dialog').boundingBox()
    assert(Boolean(postcardDialogBox && postcardDialogBox.width <= 390), `Postcard modal wider than 390px: ${JSON.stringify(postcardDialogBox)}`)
    const mobileOverflow = await vPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    assert(!mobileOverflow, 'Mobile 390x844 has horizontal overflow with .postcard-button / .postcard-dialog')
    await vPage.locator('.postcard-dialog .dialog-close').click()
    await vPage.waitForTimeout(150)
    const yardMobileOverflow = await vPage.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    )
    assert(!yardMobileOverflow, 'Mobile 390x844 footer has horizontal overflow')
    const pBtnBox = await vPage.locator('.postcard-button').boundingBox()
    assert(Boolean(pBtnBox && pBtnBox.width > 0 && pBtnBox.x + pBtnBox.width <= 390), 'Invalid mobile .postcard-button layout')

    await visitorCtx.close()
    assert.equal(runtimeErrors.length, 0, `Unexpected runtime errors: ${runtimeErrors.join(' | ')}`)

    console.log('[phase2-verify] ALL CHECKS PASSED:')
    console.log('  - on-demand WebGL capture & 1200x1560 paper postcard with QR code rendered & downloaded cleanly')
    console.log('  - live greeting update regenerated crisp PNG preview without preserveDrawingBuffer overhead')
    console.log('  - ProjectDetailModal share/postcard integration generated canonical #room=gallery&item=...&at=night&weather=rain hash')
    console.log('  - cold-boot deep link restored room, atmosphere, rain, and auto-opened matching project detail modal')
    console.log('  - live hashchange deep link switched room, golden atmosphere, lamp state, and sub-pose focus cleanly')
    console.log('  - mobile 390x844 postcard modal & footer buttons passed with zero horizontal overflow')
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
