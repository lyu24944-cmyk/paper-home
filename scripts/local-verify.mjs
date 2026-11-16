import {browserExecutable,browserTestArgs,browserTestUrl,freePort,isolatedLocalEnv,prepareTestVideo,trackProcess,stopProcess} from './test-runtime.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const qaOutDir = path.join(rootDir, '.qa', 'local-verify')
const localDataDir = path.join(qaOutDir, 'local-data')
const exportDistDir = path.join(qaOutDir, 'export-dist')
let DEV_PORT = 4328
let STATIC_PORT = 4329

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
  })
}

fs.rmSync(qaOutDir, { recursive: true, force: true })
fs.mkdirSync(localDataDir, { recursive: true })

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // Wait for server startup.
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function startViteDevServer() {
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  const proc = trackProcess(spawn(
    process.execPath,
    [viteBin, '--host', '127.0.0.1', '--port', String(DEV_PORT), '--strictPort'],
    {
      cwd: rootDir,
      env: {
        ...isolatedLocalEnv(localDataDir),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ))
  let stderr = ''
  proc.stderr.on('data', (chunk) => {
    stderr += chunk.toString()
  })
  return {
    proc,
    getStderr: () => stderr,
  }
}

function createStaticServer(dir, port) {
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.jpg': 'image/jpeg',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.ttf': 'font/ttf',
    '.woff2': 'font/woff2',
    '.hdr': 'application/octet-stream',
    '.ktx2': 'application/octet-stream',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
  }
  const server = http.createServer((req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0]
    let filePath = path.join(dir, cleanUrl === '/' ? 'index.html' : decodeURIComponent(cleanUrl))
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dir, 'index.html')
    }
    const ext = path.extname(filePath).toLowerCase()
    res.setHeader('Content-Type', mimeMap[ext] || 'application/octet-stream')
    res.end(fs.readFileSync(filePath))
  })
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server))
  })
}

async function waitIdle(page, place) {
  await page.waitForFunction(
    (p) => location.hash === `#${p}` && !document.querySelector('.traveling') && !document.querySelector('.loading-note'),
    place,
    { timeout: 60000 },
  )
  await page.waitForTimeout(300)
}

async function goRoom(page, place) {
  if ((await page.evaluate(() => location.hash)) === `#${place}`) return
  await page.getByRole('button', { name: /小屋地图/ }).click()
  const label = { yard: '小院', hall: '走廊', gallery: '作品室', study: '创作手记', blank: '关于我' }[place]
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await waitIdle(page, place)
}

async function run() {
  const results = { checks: [], consoleErrors: [], pageErrors: [], failedRequests: [] }
  DEV_PORT = await getFreePort()

  // Prepare deterministic test PNG cover
  const testPng = await sharp({
    create: { width: 1200, height: 750, channels: 3, background: { r: 235, g: 232, b: 214 } },
  }).png().toBuffer()

  let dev = startViteDevServer()
  let browser
  let staticServer

  try {
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/__local-cms/health`)
    const healthRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/health`)
    const health = await healthRes.json()
    assert.equal(health.ok, true)
    assert.equal(health.mode, 'local-studio')
    assert.equal(health.writable, true)
    results.checks.push('local studio health check passed cleanly without cloud env')

        browser = await chromium.launch({
      ...browserExecutable(),
      headless: true,
      args: browserTestArgs(['--enable-gpu-rasterization']),
    })
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const page = await context.newPage()
    page.on('console', (msg) => {
      if (msg.type() === 'error') results.consoleErrors.push(msg.text())
    })
    page.on('pageerror', (err) => {
      results.pageErrors.push(err.message)
    })
    page.on('requestfailed', (req) => {
      const url = req.url()
      // Ignore Chromium internal blob: seek aborts emitted while probing MP4 metadata.
      if (url.startsWith('blob:')) return
      results.failedRequests.push(`${req.method()} ${url}: ${req.failure()?.errorText || 'failed'}`)
    })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(browserTestUrl(`http://127.0.0.1:${DEV_PORT}/?qa`))
    await waitIdle(page, 'yard')

    // 1. Visitor clean empty baseline without auth
    await goRoom(page, 'gallery')
    await page.getByRole('button', { name: /作品目录/ }).click()
    assert(await page.getByText('作品正在整理中').isVisible())
    assert.equal(await page.getByRole('button', { name: '添加作品' }).count(), 0)
    results.checks.push('fresh unconfigured visitor sees clean empty state with no write controls')

    // 2. Enter Local Edit Mode
    await page.getByRole('button', { name: /小屋地图/ }).click()
    assert(await page.getByText('本地工作室（本机自用）').isVisible())
    await page.getByRole('button', { name: '进入编辑模式' }).click()
    await page.getByText('本地编辑模式', { exact: true }).waitFor({ timeout: 10000 })

    // 3. Customize cottage name + yard heading
    await page.getByLabel(/给小屋起个名字/).fill('松果小屋')
    await page.getByRole('button', { name: '自定义门牌与小院迎客语' }).click()
    await page.getByLabel('小院欢迎大标题').fill('欢迎来到松果小屋。')
    await page.getByRole('button', { name: '保存本机' }).click()
    await page.getByText('小屋名称与外观文字已保存到本机 local-data/。').waitFor()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await goRoom(page, 'yard')
    assert(await page.getByRole('heading', { name: '欢迎来到松果小屋。' }).isVisible())
    results.checks.push('cottage name and yard greeting customize and persist')

    // 4. Add project draft -> upload cover & optional video -> check visitor isolation -> publish
    await goRoom(page, 'gallery')
    await page.getByRole('button', { name: '添加作品' }).click()
    const ed = page.locator('dialog.cms-editor-dialog[open]')
    await ed.getByLabel('作品标题（发布必填）').fill('本地自建作品 A')
    await ed.getByLabel('作品简介（发布必填）').fill('无需云端即可在自己电脑保存与展示的作品。')
    await ed.getByLabel('作品正文（发布必填，支持分段纯文本）').fill('第一段。\n\n第二段。')

    await ed.locator('.media-picker-block', { hasText: '作品封面图' }).locator('input[type="file"]').setInputFiles({
      name: 'cover.png',
      mimeType: 'image/png',
      buffer: testPng,
    })
    await ed.getByText(/已上传 1 张图片/).waitFor({ timeout: 15000 })

    const demoVideoPath = prepareTestVideo(qaOutDir)
    {
      await ed.locator('.media-picker-block', { hasText: '演示视频' }).locator('input[type="file"]').setInputFiles(demoVideoPath)
      await ed.getByText('视频上传并校验完成。').waitFor({ timeout: 30000 })
      results.checks.push('local chunked video upload succeeded')
    }

    await ed.getByRole('button', { name: '保存草稿' }).click()
    await ed.getByText(/草稿已保存到本机/).waitFor()

    // Check public isolation BEFORE publish
    const pubBeforeRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/public-content`)
    const pubBefore = await pubBeforeRes.json()
    assert.equal(pubBefore.projects.length, 0)
    const adminRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/admin-content`, {
      headers: { 'X-Local-Owner': '1' },
    })
    const adminJson = await adminRes.json()
    const draftAssetId = adminJson.projects[0].draft.coverAssetId
    assert(draftAssetId)
    const deniedMediaRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/media/public/${draftAssetId}/display`)
    assert.equal(deniedMediaRes.status, 403)
    results.checks.push('draft content and draft media remain hidden (403) from public before publish')

    // Verify 409 conflict guard via stale version mutation
    const conflictRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/admin-mutate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Local-Owner': '1' },
      body: JSON.stringify({
        action: 'project.save_draft',
        payload: { id: adminJson.projects[0].id, expectedVersion: 999, title: 'stale' },
      }),
    })
    assert.equal(conflictRes.status, 409)
    results.checks.push('optimistic locking conflict check returns 409 in local mode')

    // Now publish project
    await ed.getByRole('button', { name: '发布作品' }).click()
    await ed.getByText(/作品已发布到作品室/).waitFor({ timeout: 15000 })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog.cms-editor-dialog[open]'))

    const pubAfterRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/public-content`)
    const pubAfter = await pubAfterRes.json()
    assert.equal(pubAfter.projects.length, 1)
    assert.equal(pubAfter.siteSettings.homeName, '松果小屋')
    const okMediaRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/media/public/${draftAssetId}/display`)
    assert.equal(okMediaRes.status, 200)

    {
      const videoId = adminJson.projects[0].draft.videoAssetId
      const rangeRes = await fetch(`http://127.0.0.1:${DEV_PORT}/__local-cms/media/public/${videoId}/display`, {
        headers: { Range: 'bytes=0-1023' },
      })
      assert.equal(rangeRes.status, 206)
      assert(rangeRes.headers.get('content-range')?.startsWith('bytes 0-1023/'))
      results.checks.push('published video supports HTTP 206 Range streaming')
    }

    // 5. Add and publish a Study note & About Me profile
    await goRoom(page, 'study')
    await page.getByRole('button', { name: '写手记' }).click()
    const ned = page.locator('dialog.cms-editor-dialog[open]')
    await ned.getByLabel('手记标题（发布必填）').fill('本地第一篇手记')
    await ned.getByLabel('手记正文（发布必填）').fill('手记内容已保存在本地磁盘。')
    await ned.getByRole('button', { name: '发布手记' }).click()
    await ned.getByText(/手记已发布到创作手记/).waitFor({ timeout: 15000 })
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => !document.querySelector('dialog.cms-editor-dialog[open]'))

    // 6. Restart Vite Dev server & verify persistence across server restarts + visitor isolation
    await stopProcess(dev.proc)
    dev = startViteDevServer()
    await waitForHttp(`http://127.0.0.1:${DEV_PORT}/__local-cms/health`)

    const visitorContext = await browser.newContext({ viewport: { width: 1280, height: 800 } })
    const visitorPage = await visitorContext.newPage()
    await visitorPage.emulateMedia({ reducedMotion: 'reduce' })
    await visitorPage.goto(`http://127.0.0.1:${DEV_PORT}/?qa`)
    await waitIdle(visitorPage, 'yard')
    assert(await visitorPage.getByRole('heading', { name: '欢迎来到松果小屋。' }).isVisible())
    await goRoom(visitorPage, 'gallery')
    await visitorPage.getByRole('button', { name: /作品目录/ }).click()
    assert(await visitorPage.getByText('本地自建作品 A').isVisible())
    await goRoom(visitorPage, 'study')
    assert(await visitorPage.getByText('本地第一篇手记').isVisible())
    assert.equal(await visitorPage.getByRole('button', { name: '写手记' }).count(), 0)
    await visitorContext.close()
    results.checks.push('data and site branding survive full server restart')

    await stopProcess(dev.proc)

    // 7. Build static snapshot (build:local equivalent) & verify zero write/draft exposure
    const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
    execFileSync(
      process.execPath,
      [viteBin, 'build', '--mode', 'local-export', '--outDir', exportDistDir],
      {
        cwd: rootDir,
        env: {
          ...process.env,
          PAPER_HOME_FORCE_LOCAL: '1',
          LOCAL_CMS_DATA_DIR: localDataDir,
        },
        stdio: 'inherit',
      },
    )

    const snapshotJson = JSON.parse(fs.readFileSync(path.join(exportDistDir, 'local-snapshot', 'cottage.json'), 'utf8'))
    assert.equal(snapshotJson.snapshot, true)
    assert.equal(snapshotJson.projects.length, 1)
    assert.equal(snapshotJson.notes.length, 1)
    assert.equal(snapshotJson.siteSettings.homeName, '松果小屋')

    staticServer = await createStaticServer(exportDistDir, 0)
    const staticAddr = staticServer.address()
    STATIC_PORT = typeof staticAddr === 'object' && staticAddr ? staticAddr.port : STATIC_PORT
    const snapPage = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await snapPage.emulateMedia({ reducedMotion: 'reduce' })
    await snapPage.goto(`http://127.0.0.1:${STATIC_PORT}/?qa`)
    await waitIdle(snapPage, 'yard')
    assert(await snapPage.getByRole('heading', { name: '欢迎来到松果小屋。' }).isVisible())
    await snapPage.getByRole('button', { name: /小屋地图/ }).click()
    assert(await snapPage.getByText('纯静态展馆模式').isVisible())
    assert.equal(await snapPage.getByRole('button', { name: /进入编辑模式/ }).count(), 0)
    await snapPage.keyboard.press('Escape')
    await snapPage.waitForTimeout(200)
    await goRoom(snapPage, 'gallery')
    await snapPage.getByRole('button', { name: /作品目录/ }).click()
    assert(await snapPage.getByText('本地自建作品 A').isVisible())
    await snapPage.close()
    results.checks.push('static snapshot build exports published content & media with readonly visitor UI')

    // Assert zero unexpected console/page/network errors
    assert.equal(results.consoleErrors.length, 0, `Console errors: ${results.consoleErrors.join('\n')}`)
    assert.equal(results.pageErrors.length, 0, `Page errors: ${results.pageErrors.join('\n')}`)
    assert.equal(results.failedRequests.length, 0, `Failed requests: ${results.failedRequests.join('\n')}`)

    fs.writeFileSync(path.join(qaOutDir, 'report.json'), JSON.stringify(results, null, 2), 'utf8')
    console.log('\n[check:local] ALL CHECKS PASSED:')
    for (const c of results.checks) console.log(`  - ${c}`)
  } finally {
    await browser?.close().catch(() => {})
    await stopProcess(dev?.proc)
    staticServer?.close()
  }
}

run().catch((err) => {
  console.error('[check:local] FAILED:', err)
  process.exit(1)
})
