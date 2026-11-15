import { spawn } from 'node:child_process'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { createLocalCmsStore } from './local-cms-store.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const promoDir = path.join(rootDir, 'promo')
const docsMediaDir = path.join(rootDir, 'docs', 'media')
const qaTmpDir = path.join(rootDir, '.qa', 'promo-tmp')
const promoDataDir = path.join(rootDir, '.qa', 'promo-data')
const distDir = path.join(rootDir, 'dist')

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.hdr': 'application/octet-stream',
  '.ttf': 'font/ttf',
}

function runCommand(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd: rootDir,
      stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
      ...opts,
    })
    let stdout = ''
    let stderr = ''
    if (opts.capture) {
      child.stdout.on('data', (d) => { stdout += d.toString() })
      child.stderr.on('data', (d) => { stderr += d.toString() })
    }
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve({ stdout, stderr })
      else reject(new Error(`${cmd} ${args.join(' ')} exited with ${code}${stderr ? `\n${stderr}` : ''}`))
    })
  })
}

async function seedAndBuildPreview() {
  await fsp.rm(promoDataDir, { recursive: true, force: true })
  await fsp.mkdir(promoDataDir, { recursive: true })
  const promoEnv = {
    ...process.env,
    LOCAL_CMS_DATA_DIR: promoDataDir,
    PAPER_HOME_FORCE_LOCAL: '1',
  }
  console.log('[promo] Seeding neutral sample content into isolated promo data dir...')
  const store = createLocalCmsStore(rootDir, { dataDir: promoDataDir })
  await store.seedNeutralSample({ force: true })

  console.log('[promo] Checking assets & building local preview...')
  await runCommand(process.execPath, ['scripts/check-assets.mjs'], { env: promoEnv })
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  await runCommand(process.execPath, [viteBin, 'build', '--mode', 'local-export'], { env: promoEnv })
}

async function startStaticServer() {
  const server = http.createServer(async (req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0]
    const rel = cleanUrl === '/' ? 'index.html' : decodeURIComponent(cleanUrl).replace(/^\/+/, '')
    const filePath = path.resolve(distDir, rel)
    if (!filePath.startsWith(distDir)) {
      res.writeHead(403).end('Forbidden')
      return
    }
    try {
      const buf = await fsp.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
      res.end(buf)
    } catch {
      res.writeHead(404).end('Not Found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, baseUrl: `http://127.0.0.1:${port}` }
}

async function waitPromoReady(page) {
  await page.waitForFunction(
    () => {
      const api = window.__PAPER_HOME_PROMO__
      if (!api) return false
      const st = api.getState()
      return Boolean(st?.ready) && !st.busy && Boolean(api.getCanvas())
    },
    null,
    { timeout: 60000 },
  )
}

async function waitSettled(page, ms = 1100) {
  await waitPromoReady(page)
  await page.waitForTimeout(ms)
  await waitPromoReady(page)
}

async function setViewportSizeCdp(page, cdp, width, height) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  })
  await page.setViewportSize({ width, height })
  await page.waitForFunction(
    ({ w, h }) => window.innerWidth === w && window.innerHeight === h,
    { w: width, h: height },
    { timeout: 15000 },
  )
  await page.waitForTimeout(450)
}

async function createPromoSession(browser, baseUrl, width, height, tag) {
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  })

  const chunkQueue = []
  let writeError = null
  let activeFile = null

  await page.exposeFunction('__promoWriteChunk', async (b64) => {
    if (!activeFile) return
    const task = (chunkQueue[chunkQueue.length - 1] || Promise.resolve()).then(async () => {
      try {
        await fsp.appendFile(activeFile, Buffer.from(b64, 'base64'))
      } catch (err) {
        writeError = err
      }
    })
    chunkQueue.push(task)
    await task
  })

  await page.goto(`${baseUrl}/?promo=1&quality=high`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page, 1400)
  await page.evaluate(() => window.__PAPER_HOME_PROMO__.setReduced(false))

  async function startCanvasRecording(webmPath, targetFps = 30) {
    activeFile = webmPath
    await fsp.rm(webmPath, { force: true })
    await fsp.writeFile(webmPath, Buffer.alloc(0))
    chunkQueue.length = 0
    writeError = null

    await page.evaluate((fps) => {
      const api = window.__PAPER_HOME_PROMO__
      const canvas = api.getCanvas()
      if (!canvas || typeof canvas.captureStream !== 'function') {
        throw new Error('Canvas.captureStream is unavailable')
      }
      const stream = canvas.captureStream(fps)
      const candidates = [
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ]
      const mimeType = candidates.find((t) => MediaRecorder.isTypeSupported(t)) || ''
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 14_000_000,
      })

      let rafCount = 0
      let running = true
      const startTs = performance.now()
      const tick = () => {
        if (!running) return
        rafCount += 1
        requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)

      const pendingWrites = []
      const stopPromise = new Promise((resolve, reject) => {
        recorder.ondataavailable = (e) => {
          if (!e.data || e.data.size === 0) return
          const p = e.data.arrayBuffer().then((buf) => {
            const bytes = new Uint8Array(buf)
            let bin = ''
            const step = 0x8000
            for (let i = 0; i < bytes.length; i += step) {
              bin += String.fromCharCode(...bytes.subarray(i, i + step))
            }
            return window.__promoWriteChunk(btoa(bin))
          })
          pendingWrites.push(p)
        }
        recorder.onerror = (ev) => reject(new Error(ev?.error?.message || 'MediaRecorder error'))
        recorder.onstop = async () => {
          running = false
          const endTs = performance.now()
          await Promise.all(pendingWrites)
          stream.getTracks().forEach((tr) => tr.stop())
          resolve({
            rafFrames: rafCount,
            elapsedMs: endTs - startTs,
            mimeType: recorder.mimeType,
          })
        }
      })

      recorder.start(250)
      window.__ACTIVE_RECORDER__ = { recorder, stopPromise }
    }, targetFps)
  }

  async function stopCanvasRecording() {
    const meta = await page.evaluate(async () => {
      const rec = window.__ACTIVE_RECORDER__
      if (!rec) throw new Error('No active recorder')
      rec.recorder.stop()
      const result = await rec.stopPromise
      delete window.__ACTIVE_RECORDER__
      return result
    })
    await Promise.all(chunkQueue)
    activeFile = null
    if (writeError) throw writeError
    return meta
  }

  console.log(`[promo] Session (${tag}) ready at ${width}x${height}`)
  return { context, page, cdp, startCanvasRecording, stopCanvasRecording }
}

async function probeVideoStats(videoPath, fallbackDurationSec) {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_packets',
      '-show_entries', 'stream=nb_read_packets,width,height',
      '-of', 'json',
      videoPath,
    ],
    { capture: true },
  )
  const parsed = JSON.parse(stdout)
  const stream = parsed.streams?.[0] || {}
  const packets = Number(stream.nb_read_packets || 0)
  const avgFps = fallbackDurationSec > 0 ? packets / fallbackDurationSec : 0
  return {
    packets,
    width: Number(stream.width || 0),
    height: Number(stream.height || 0),
    avgFps,
  }
}

async function transcodeToMp4(inputWebm, outputMp4, width, height, targetFps = 30) {
  await runCommand('ffmpeg', [
    '-y',
    '-fflags', '+genpts',
    '-i', inputWebm,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-vf', `scale=${width}:${height}:flags=lanczos,fps=${targetFps},format=yuv420p`,
    '-movflags', '+faststart',
    outputMp4,
  ])
}

async function encodeGifWithSizeLimit(inputWebm, outputGif, maxBytes = 7_600_000) {
  const palettePath = path.join(qaTmpDir, 'tour-palette.png')
  const attempts = [
    { fps: 11, width: 720 },
    { fps: 10, width: 640 },
    { fps: 8, width: 560 },
  ]
  for (const cfg of attempts) {
    const vfBase = `fps=${cfg.fps},scale=${cfg.width}:-1:flags=lanczos`
    await runCommand('ffmpeg', [
      '-y',
      '-i', inputWebm,
      '-vf', `${vfBase},palettegen=max_colors=192:stats_mode=diff`,
      palettePath,
    ])
    await runCommand('ffmpeg', [
      '-y',
      '-i', inputWebm,
      '-i', palettePath,
      '-lavfi', `${vfBase}[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3`,
      '-loop', '0',
      outputGif,
    ])
    const stat = await fsp.stat(outputGif)
    if (stat.size <= maxBytes) {
      return { size: stat.size, fps: cfg.fps, width: cfg.width }
    }
  }
  const finalStat = await fsp.stat(outputGif)
  return { size: finalStat.size, fps: attempts[attempts.length - 1].fps, width: attempts[attempts.length - 1].width }
}

async function resetToYard(page, atmosphere, weather = 'clear') {
  await page.evaluate(
    async ({ atmo, w }) => {
      const api = window.__PAPER_HOME_PROMO__
      api.setFocus(null)
      api.setWeather(w)
      api.setAtmosphere(atmo)
      if (api.getState().place !== 'yard') {
        await api.navigate('yard')
      }
    },
    { atmo: atmosphere, w: weather },
  )
  await waitSettled(page, 1200)
}

async function main() {
  await fsp.mkdir(promoDir, { recursive: true })
  await fsp.mkdir(docsMediaDir, { recursive: true })
  await fsp.mkdir(qaTmpDir, { recursive: true })

  await seedAndBuildPreview()
  const { server, baseUrl } = await startStaticServer()

  const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: false,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1920,1080'],
  })

  const videoLogs = []

  try {
    // ------------------------------------------------------------------
    // PART 1: XHS 6 Vertical Stills (1080x1440)
    // ------------------------------------------------------------------
    const xhsSession = await createPromoSession(browser, baseUrl, 1080, 1440, 'xhs-stills')
    const { page: xhsPage } = xhsSession

    const xhsShots = [
      { file: 'xhs-01-dawn.png', label: '晨雾小院', place: 'yard', atmo: 'dawn', weather: 'clear', lamp: null, settle: 1300 },
      { file: 'xhs-02-daylight.png', label: '晴昼', place: 'yard', atmo: 'daylight', weather: 'clear', lamp: null, settle: 1300 },
      { file: 'xhs-03-golden.png', label: '落日', place: 'yard', atmo: 'golden', weather: 'clear', lamp: null, settle: 1300 },
      { file: 'xhs-04-night.png', label: '夜灯', place: 'yard', atmo: 'night', weather: 'clear', lamp: true, settle: 1300 },
      { file: 'xhs-05-rain-night.png', label: '雨夜', place: 'yard', atmo: 'night', weather: 'rain', lamp: true, settle: 1600 },
      { file: 'xhs-06-study-lamp.png', label: '书房台灯亮起', place: 'study', atmo: 'night', weather: 'clear', lamp: true, settle: 1400 },
    ]

    for (const shot of xhsShots) {
      await xhsPage.evaluate(
        async ({ p, atmo, w, lamp }) => {
          const api = window.__PAPER_HOME_PROMO__
          api.setFocus(null)
          api.setWeather(w)
          api.setAtmosphere(atmo)
          if (lamp !== null) api.setDeskLamp(lamp)
          if (api.getState().place !== p) {
            await api.navigate(p)
          }
        },
        { p: shot.place, atmo: shot.atmo, w: shot.weather, lamp: shot.lamp },
      )
      await waitSettled(xhsPage, shot.settle)
      const outPath = path.join(promoDir, shot.file)
      await xhsPage.screenshot({ path: outPath })
      console.log(`[promo] Saved ${shot.file} (${shot.label})`)
    }
    await xhsSession.context.close()

    // ------------------------------------------------------------------
    // PART 2: Douyin / XHS Vertical Video (1080x1920, ~25s)
    // Storyboard:
    //  晨雾推近小院 -> 切换落日 -> 推门进走廊 -> 进书房、夜灯下点亮台灯 -> 作品室看展墙 -> 回到小院下起细雨，镜头停住
    // ------------------------------------------------------------------
    const vertSession = await createPromoSession(browser, baseUrl, 1080, 1920, 'vertical-video')
    const { page: vp } = vertSession
    await resetToYard(vp, 'dawn', 'clear')
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setDeskLamp(false))
    await vp.waitForTimeout(800)

    const vertWebm = path.join(qaTmpDir, 'douyin-xhs-vertical.webm')
    await vertSession.startCanvasRecording(vertWebm, 30)

    // 1. 晨雾推近小院
    await vp.waitForTimeout(500)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setFocus('yard-bench'))
    await vp.waitForTimeout(1600)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setFocus(null))
    await vp.waitForTimeout(350)

    // 2. 切换落日
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setAtmosphere('golden'))
    await vp.waitForTimeout(1500)

    // 3. 推门进走廊
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('hall'))
    await waitPromoReady(vp)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setHallProgress(0.35))
    await vp.waitForTimeout(800)

    // 4. 进书房、夜灯下点亮台灯
    await vp.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      api.setAtmosphere('night')
      api.setDeskLamp(false)
    })
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('study'))
    await waitPromoReady(vp)
    await vp.waitForTimeout(500)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setDeskLamp(true))
    await vp.waitForTimeout(1150)

    // 5. 作品室看展墙
    await vp.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      api.setAtmosphere('golden')
      api.setGalleryIndex(0)
    })
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('gallery'))
    await waitPromoReady(vp)
    await vp.waitForTimeout(550)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setGalleryIndex(1))
    await vp.waitForTimeout(550)
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.setGalleryIndex(2))
    await vp.waitForTimeout(600)

    // 6. 回到小院下起细雨，镜头停住
    await vp.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      api.setAtmosphere('night')
      api.setWeather('rain')
    })
    await vp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('yard'))
    await waitPromoReady(vp)
    await vp.waitForTimeout(1600)

    const vertRecMeta = await vertSession.stopCanvasRecording()
    const vertMp4 = path.join(promoDir, 'douyin-xhs-vertical.mp4')
    await transcodeToMp4(vertWebm, vertMp4, 1080, 1920, 30)
    const vertProbe = await probeVideoStats(vertWebm, vertRecMeta.elapsedMs / 1000)
    const vertMp4Stat = await fsp.stat(vertMp4)
    videoLogs.push({
      name: 'douyin-xhs-vertical.mp4',
      resolution: '1080x1920',
      durationSec: vertRecMeta.elapsedMs / 1000,
      rafFps: vertRecMeta.rafFrames / (vertRecMeta.elapsedMs / 1000),
      encodedPackets: vertProbe.packets,
      encodedAvgFps: vertProbe.avgFps,
      fileBytes: vertMp4Stat.size,
    })
    await vertSession.context.close()

    // ------------------------------------------------------------------
    // PART 3: Bilibili Cover, Social Preview, README Hero, Horizontal Video & Tour GIF
    // ------------------------------------------------------------------
    const wideSession = await createPromoSession(browser, baseUrl, 1920, 1080, 'wide-media')
    const { page: wp, cdp: wideCdp } = wideSession

    // Hero still + Bilibili cover at 1920x1080 (golden hour warm glow)
    await resetToYard(wp, 'golden', 'clear')
    const biliCoverPath = path.join(promoDir, 'bilibili-cover.png')
    await wp.screenshot({ path: biliCoverPath })
    console.log('[promo] Saved bilibili-cover.png (1920x1080)')

    // Convert/resize hero.webp at 1600x900 for crisp README load
    const heroWebpPath = path.join(docsMediaDir, 'hero.webp')
    await sharp(biliCoverPath).resize(1600, 900).webp({ quality: 90 }).toFile(heroWebpPath)
    console.log('[promo] Saved docs/media/hero.webp (1600x900)')

    // GitHub Social Preview (1280x640)
    await setViewportSizeCdp(wp, wideCdp, 1280, 640)
    await waitSettled(wp, 900)
    const socialPreviewPath = path.join(promoDir, 'social-preview.png')
    await wp.screenshot({ path: socialPreviewPath })
    console.log('[promo] Saved social-preview.png (1280x640)')

    // Switch back to 1920x1080 for Bilibili horizontal video
    await setViewportSizeCdp(wp, wideCdp, 1920, 1080)
    await resetToYard(wp, 'dawn', 'clear')
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setDeskLamp(false))
    await wp.waitForTimeout(900)

    const biliWebm = path.join(qaTmpDir, 'bilibili-horizontal.webm')
    await wideSession.startCanvasRecording(biliWebm, 30)

    // Dawn -> Golden -> Hall -> Study lamp on -> Gallery -> Rain night yard
    await wp.waitForTimeout(600)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setFocus('yard-bench'))
    await wp.waitForTimeout(1600)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setFocus(null))
    await wp.waitForTimeout(400)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setAtmosphere('golden'))
    await wp.waitForTimeout(1600)

    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('hall'))
    await waitPromoReady(wp)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setHallProgress(0.4))
    await wp.waitForTimeout(900)

    await wp.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      api.setAtmosphere('night')
      api.setDeskLamp(false)
    })
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('study'))
    await waitPromoReady(wp)
    await wp.waitForTimeout(600)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setDeskLamp(true))
    await wp.waitForTimeout(1400)

    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.setAtmosphere('golden'))
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('gallery'))
    await waitPromoReady(wp)
    await wp.waitForTimeout(1500)

    await wp.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      api.setAtmosphere('night')
      api.setWeather('rain')
    })
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('yard'))
    await waitPromoReady(wp)
    await wp.waitForTimeout(1700)

    const biliRecMeta = await wideSession.stopCanvasRecording()
    const biliMp4 = path.join(promoDir, 'bilibili-horizontal.mp4')
    await transcodeToMp4(biliWebm, biliMp4, 1920, 1080, 30)
    const biliProbe = await probeVideoStats(biliWebm, biliRecMeta.elapsedMs / 1000)
    const biliMp4Stat = await fsp.stat(biliMp4)
    videoLogs.push({
      name: 'bilibili-horizontal.mp4',
      resolution: '1920x1080',
      durationSec: biliRecMeta.elapsedMs / 1000,
      rafFps: biliRecMeta.rafFrames / (biliRecMeta.elapsedMs / 1000),
      encodedPackets: biliProbe.packets,
      encodedAvgFps: biliProbe.avgFps,
      fileBytes: biliMp4Stat.size,
    })

    // Record compact ~8s highlight reel for README tour.gif (960x540 -> scaled nicely)
    await setViewportSizeCdp(wp, wideCdp, 960, 540)
    await resetToYard(wp, 'golden', 'clear')
    const tourWebm = path.join(qaTmpDir, 'tour-gif-src.webm')
    await wideSession.startCanvasRecording(tourWebm, 24)
    await wp.waitForTimeout(800)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('hall'))
    await waitPromoReady(wp)
    await wp.evaluate(() => window.__PAPER_HOME_PROMO__.navigate('gallery'))
    await waitPromoReady(wp)
    await wp.waitForTimeout(700)

    const tourRecMeta = await wideSession.stopCanvasRecording()
    const tourProbe = await probeVideoStats(tourWebm, tourRecMeta.elapsedMs / 1000)
    const tourGifPath = path.join(docsMediaDir, 'tour.gif')
    const gifInfo = await encodeGifWithSizeLimit(tourWebm, tourGifPath)
    videoLogs.push({
      name: 'docs/media/tour.gif',
      resolution: `${gifInfo.width}px wide @ ${gifInfo.fps}fps GIF`,
      durationSec: tourRecMeta.elapsedMs / 1000,
      rafFps: tourRecMeta.rafFrames / (tourRecMeta.elapsedMs / 1000),
      encodedPackets: tourProbe.packets,
      encodedAvgFps: tourProbe.avgFps,
      fileBytes: gifInfo.size,
    })

    await wideSession.context.close()

    // Write detailed FPS & artifact log
    const logLines = [
      `Paper Home Promo Capture Log (${new Date().toISOString()})`,
      `Chrome: ${chromePath || 'playwright-chromium'}`,
      '',
      '=== Video & GIF Frame Rate Report ===',
      ...videoLogs.map(
        (v) =>
          `${v.name} | ${v.resolution} | duration=${v.durationSec.toFixed(2)}s | capturedPackets=${v.encodedPackets} | actualAvgFps=${v.encodedAvgFps.toFixed(2)} (rAF=${v.rafFps.toFixed(2)}) | size=${(v.fileBytes / 1048576).toFixed(2)} MiB`,
      ),
      '',
    ]
    const lowFpsVideos = videoLogs.filter((v) => v.encodedAvgFps < 20)
    if (lowFpsVideos.length > 0) {
      logLines.push(
        `WARNING: Frame drop detected (<20 fps) in: ${lowFpsVideos.map((v) => `${v.name} (${v.encodedAvgFps.toFixed(2)} fps)`).join(', ')}`,
      )
    } else {
      logLines.push('STATUS: All captured videos recorded cleanly at >= 20 fps.')
    }
    const logPath = path.join(promoDir, 'capture.log')
    await fsp.writeFile(logPath, `${logLines.join('\n')}\n`, 'utf8')
    console.log(`\n${logLines.join('\n')}`)
  } finally {
    await browser.close()
    server.close()
    await fsp.rm(qaTmpDir, { recursive: true, force: true }).catch(() => {})
    await fsp.rm(promoDataDir, { recursive: true, force: true }).catch(() => {})
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
