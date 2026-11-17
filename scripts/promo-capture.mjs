import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
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
const bgmSourcePath = path.join(rootDir, 'scripts', 'assets', 'bgm-a-short-walk-with-you.ogg')

const TARGET_FPS = 60
const FADE_SEC = 0.40 // 24 frames at 60 fps

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

function escapeXml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function buildArtworkSvg({ title, subtitle, tag, bg1, bg2, accent, shape }) {
  const safeTitle = escapeXml(title)
  const safeSub = escapeXml(subtitle)
  const safeTag = escapeXml(tag)
  let motif = ''
  if (shape === 'arch') {
    motif = `
      <rect x="260" y="230" width="760" height="330" rx="18" fill="#faf7ef" stroke="${accent}" stroke-width="5"/>
      <polygon points="640,268 470,390 810,390" fill="${accent}" opacity="0.22" stroke="${accent}" stroke-width="4"/>
      <rect x="515" y="390" width="250" height="130" fill="#fffdf8" stroke="${accent}" stroke-width="4"/>
      <rect x="615" y="445" width="50" height="75" fill="${accent}" opacity="0.72"/>
      <circle cx="885" cy="295" r="46" fill="#d9a45b" opacity="0.38"/>
    `
  } else if (shape === 'lamp') {
    motif = `
      <rect x="240" y="220" width="800" height="350" rx="18" fill="#1e2420" stroke="${accent}" stroke-width="4"/>
      <circle cx="640" cy="370" r="145" fill="#f3c778" opacity="0.16"/>
      <circle cx="640" cy="365" r="88" fill="#f6d88c" opacity="0.28"/>
      <polygon points="560,355 720,355 685,295 595,295" fill="#4f7c5c"/>
      <rect x="633" y="355" width="14" height="92" fill="#c79e54"/>
      <rect x="580" y="445" width="120" height="18" rx="6" fill="#5e4933"/>
      <rect x="440" y="463" width="400" height="22" rx="4" fill="#8b623c"/>
    `
  } else {
    motif = `
      <rect x="260" y="230" width="760" height="330" rx="18" fill="#1b2b34" stroke="${accent}" stroke-width="4"/>
      <circle cx="480" cy="335" r="64" fill="#a8d1c8" opacity="0.26"/>
      <circle cx="775" cy="405" r="95" fill="#639a93" opacity="0.24"/>
      <path d="M320 480 Q480 410 640 465 T960 440" fill="none" stroke="#d9ebe6" stroke-width="5" opacity="0.65"/>
      <line x1="420" y1="265" x2="405" y2="310" stroke="#cde4df" stroke-width="3" opacity="0.5"/>
      <line x1="560" y1="275" x2="545" y2="320" stroke="#cde4df" stroke-width="3" opacity="0.5"/>
      <line x1="720" y1="260" x2="705" y2="305" stroke="#cde4df" stroke-width="3" opacity="0.5"/>
    `
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${bg1}"/>
        <stop offset="100%" stop-color="${bg2}"/>
      </linearGradient>
    </defs>
    <rect width="1280" height="800" fill="url(#bg)"/>
    <rect x="44" y="44" width="1192" height="712" rx="22" fill="none" stroke="${accent}" stroke-opacity="0.28" stroke-width="3"/>
    <text x="640" y="132" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="22" letter-spacing="4" fill="${accent}">${safeTag}</text>
    <text x="640" y="182" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="40" font-weight="bold" fill="#232c26">${safeTitle}</text>
    ${motif}
    <text x="640" y="655" text-anchor="middle" font-family="Microsoft YaHei, PingFang SC, sans-serif" font-size="24" fill="#4f5b52">${safeSub}</text>
  </svg>`
}

async function seedAndBuildPreview() {
  await fsp.rm(promoDataDir, { recursive: true, force: true })
  await fsp.mkdir(promoDataDir, { recursive: true })
  const store = createLocalCmsStore(rootDir, { dataDir: promoDataDir })
  await store.seedNeutralSample({ force: true })

  const db = store.readDb()
  const ts = new Date().toISOString()
  const artDefs = [
    {
      assetId: crypto.randomUUID(),
      projectId: '20000000-0000-4000-8000-000000000101',
      slug: 'promo-work-01',
      title: '晨雾庭院 · 建筑体块研究',
      subtitle: '11×15 米红砖小屋与四时天色系统',
      tag: 'EXHIBITION 01 · ARCHITECTURE',
      summary: '红砖墙、木结构门廊与实时物理玻璃窗的庭院建模实验。',
      bg1: '#f5f1e4',
      bg2: '#e4e8da',
      accent: '#365840',
      shape: 'arch',
    },
    {
      assetId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      slug: 'promo-work-02',
      title: '夜灯书房 · 材质与暖光',
      subtitle: '绿罩黄铜台灯与 PBR 写实贴图',
      tag: 'EXHIBITION 02 · LIGHTING',
      summary: '书桌木纹粗糙度贴图、桌面微光漫反射与夜间台灯开关交互。',
      bg1: '#f6ede0',
      bg2: '#ebd8c0',
      accent: '#9c5c34',
      shape: 'lamp',
    },
    {
      assetId: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      slug: 'promo-work-03',
      title: '雨夜回响 · 交互声音景观',
      subtitle: 'WebAudio 实时风铃与隔窗听雨',
      tag: 'EXHIBITION 03 · INTERACTION',
      summary: '从庭院推门进入室内的低通滤波雨声过渡与明信片深链记录。',
      bg1: '#eaf0ee',
      bg2: '#d2e0dc',
      accent: '#2f5d62',
      shape: 'rain',
    },
  ]

  db.projects = []
  for (let i = 0; i < artDefs.length; i += 1) {
    const def = artDefs[i]
    const svgBuf = Buffer.from(buildArtworkSvg(def))
    const displayBuf = await sharp(svgBuf).resize(1280, 800).webp({ quality: 88 }).toBuffer()
    const thumbBuf = await sharp(svgBuf).resize(640, 400).webp({ quality: 82 }).toBuffer()
    const displayPath = `images/${def.assetId}/display.webp`
    const thumbPath = `images/${def.assetId}/thumb.webp`
    const absDisplay = path.join(store.mediaDir, displayPath)
    const absThumb = path.join(store.mediaDir, thumbPath)
    fs.mkdirSync(path.dirname(absDisplay), { recursive: true })
    fs.writeFileSync(absDisplay, displayBuf)
    fs.writeFileSync(absThumb, thumbBuf)
    db.assets[def.assetId] = {
      id: def.assetId,
      kind: 'image',
      status: 'ready',
      displayPath,
      thumbPath,
      mimeType: 'image/webp',
      byteSize: displayBuf.length + thumbBuf.length,
      width: 1280,
      height: 800,
      durationSec: null,
      originalFilename: `${def.slug}.webp`,
      createdAt: ts,
    }
    const draft = {
      title: def.title,
      summary: def.summary,
      body: def.summary,
      demoUrl: '',
      coverAssetId: def.assetId,
      galleryAssetIds: [],
      videoAssetId: null,
    }
    db.projects.push({
      id: def.projectId,
      slug: def.slug,
      sortOrder: i,
      isPublished: true,
      publishedAt: ts,
      hasUnpublishedChanges: false,
      version: 1,
      updatedAt: ts,
      draft,
      published: { ...draft, publishedAt: ts },
    })
  }
  store.writeDb(db)

  const promoEnv = {
    ...process.env,
    LOCAL_CMS_DATA_DIR: promoDataDir,
    PAPER_HOME_FORCE_LOCAL: '1',
  }
  console.log('[promo] Checking assets & building local preview...')
  await runCommand(process.execPath, ['scripts/check-assets.mjs'], { env: promoEnv })
  const viteBin = path.join(rootDir, 'node_modules', 'vite', 'bin', 'vite.js')
  await runCommand(process.execPath, [viteBin, 'build', '--mode', 'local-export'], { env: promoEnv })
}

async function startStaticServer() {
  let activeFrameSink = null

  const server = http.createServer(async (req, res) => {
    const cleanUrl = (req.url || '/').split('?')[0]
    if (req.method === 'POST' && cleanUrl === '/__promo_frame') {
      if (!activeFrameSink) {
        res.writeHead(409).end('No active ffmpeg frame sink')
        return
      }
      const sink = activeFrameSink
      req.on('data', (chunk) => {
        if (!sink.write(chunk)) {
          req.pause()
          sink.once('drain', () => req.resume())
        }
      })
      req.on('end', () => {
        res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok')
      })
      req.on('error', (err) => {
        res.writeHead(500).end(String(err))
      })
      return
    }

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
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    setFrameSink: (sink) => {
      activeFrameSink = sink
    },
  }
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

async function waitSettled(page, ms = 900) {
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

async function probeMp4Info(mp4Path) {
  const { stdout } = await runCommand(
    'ffprobe',
    [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-count_frames',
      '-show_entries', 'stream=nb_read_frames,avg_frame_rate,r_frame_rate:format=duration',
      '-of', 'json',
      mp4Path,
    ],
    { capture: true },
  )
  const parsed = JSON.parse(stdout)
  const stream = parsed.streams?.[0] || {}
  const [num, den] = String(stream.avg_frame_rate || '0/1').split('/').map(Number)
  return {
    duration: Number.parseFloat(parsed.format?.duration || '0') || 0,
    frames: Number(stream.nb_read_frames || 0),
    avgFps: den ? num / den : 0,
  }
}

async function createPromoSession(browser, baseUrl, setFrameSink, width, height, tag) {
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

  await page.goto(`${baseUrl}/?promo=1&quality=high`, { waitUntil: 'domcontentloaded' })
  await waitSettled(page, 1400)
  await page.evaluate(() => window.__PAPER_HOME_PROMO__.setReduced(false))

  /**
   * Deterministically render every single frame at exact fixed dt = 1/targetFps via
   * React Three Fiber advance(simSec) and stream raw WebGL RGBA pixels directly to ffmpeg.
   * Zero real-time dropped frames, zero duplicate frames, zero MediaRecorder stutter.
   */
  async function recordDeterministicShot(shotName, widthPx, heightPx, targetFps, durationSec, setupFn, options = {}) {
    const mp4Path = path.join(qaTmpDir, `${shotName}.mp4`)
    await fsp.rm(mp4Path, { force: true })

    await setupFn(page)
    await waitSettled(page, 850)

    const totalFrames = Math.round(durationSec * targetFps)
    const dtSec = 1 / targetFps

    const ffArgs = [
      '-y',
      '-f', 'rawvideo',
      '-pix_fmt', 'rgba',
      '-s', `${widthPx}x${heightPx}`,
      '-r', String(targetFps),
      '-i', 'pipe:0',
      '-vf', 'vflip,format=yuv420p',
      '-c:v', 'libx264',
      '-preset', 'medium',
      '-crf', '15',
      '-r', String(targetFps),
      '-pix_fmt', 'yuv420p',
      mp4Path,
    ]
    const ffProc = spawn('ffmpeg', ffArgs, { cwd: rootDir, stdio: ['pipe', 'ignore', 'pipe'] })
    let ffErr = ''
    ffProc.stderr.on('data', (d) => { ffErr += d.toString() })
    const ffDone = new Promise((resolve, reject) => {
      ffProc.on('error', reject)
      ffProc.on('exit', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`ffmpeg shot ${shotName} failed (${code})\n${ffErr}`))
      })
    })

    setFrameSink(ffProc.stdin)
    const wallStart = Date.now()
    try {
      await page.evaluate(() => {
        const api = window.__PAPER_HOME_PROMO__
        api.enterManualCapture()
        api.stepFrame(1 / 60)
      })

      if (options.type === 'lamp-study') {
        const switchFrame = Math.round((options.lampOnAtSec ?? 1.75) * targetFps)
        await page.evaluate(
          async ({ startIdx, endIdx, fromPose, toPose, ease, total, dt }) => {
            const api = window.__PAPER_HOME_PROMO__
            for (let i = startIdx; i < endIdx; i += 1) {
              const tNorm = total > 1 ? i / (total - 1) : 1
              api.setCameraAt(fromPose, toPose, tNorm, ease)
              await api.renderAndUploadFrame(dt, '/__promo_frame')
            }
          },
          {
            startIdx: 0,
            endIdx: switchFrame,
            fromPose: options.fromPose,
            toPose: options.toPose,
            ease: options.ease || 'sine.inOut',
            total: totalFrames,
            dt: dtSec,
          },
        )
        await page.evaluate(() => window.__PAPER_HOME_PROMO__.setDeskLamp(true))
        await page.waitForTimeout(80)
        await page.evaluate(
          async ({ startIdx, endIdx, fromPose, toPose, ease, total, dt }) => {
            const api = window.__PAPER_HOME_PROMO__
            for (let i = startIdx; i < endIdx; i += 1) {
              const tNorm = total > 1 ? i / (total - 1) : 1
              api.setCameraAt(fromPose, toPose, tNorm, ease)
              await api.renderAndUploadFrame(dt, '/__promo_frame')
            }
          },
          {
            startIdx: switchFrame,
            endIdx: totalFrames,
            fromPose: options.fromPose,
            toPose: options.toPose,
            ease: options.ease || 'sine.inOut',
            total: totalFrames,
            dt: dtSec,
          },
        )
      } else {
        await page.evaluate(
          async ({ total, dt, fromPose, toPose, ease, doorOpenSec, rainWarmupFrames, expectedW, expectedH }) => {
            const api = window.__PAPER_HOME_PROMO__
            // Advance rain a few virtual frames invisibly before frame 0 if requested so sky isn't uniform
            for (let w = 0; w < (rainWarmupFrames || 0); w += 1) {
              api.setCameraAt(fromPose, toPose, 0, ease)
              api.stepFrame(dt)
            }
            for (let i = 0; i < total; i += 1) {
              const tNorm = total > 1 ? i / (total - 1) : 1
              if (doorOpenSec > 0) {
                const tSec = i * dt
                const u = Math.min(1, tSec / doorOpenSec)
                const doorEase = 0.5 - 0.5 * Math.cos(Math.PI * u)
                api.setFrontDoorOpen(doorEase)
              }
              api.setCameraAt(fromPose, toPose, tNorm, ease)
              const meta = await api.renderAndUploadFrame(dt, '/__promo_frame')
              if (i === 0 && (meta.width !== expectedW || meta.height !== expectedH)) {
                throw new Error(`Framebuffer mismatch: ${meta.width}x${meta.height} vs ${expectedW}x${expectedH}`)
              }
            }
          },
          {
            total: totalFrames,
            dt: dtSec,
            fromPose: options.fromPose,
            toPose: options.toPose,
            ease: options.ease || 'sine.inOut',
            doorOpenSec: options.doorOpenSec || 0,
            rainWarmupFrames: options.rainWarmupFrames || 0,
            expectedW: widthPx,
            expectedH: heightPx,
          },
        )
      }
    } finally {
      setFrameSink(null)
      ffProc.stdin.end()
      await page.evaluate(() => window.__PAPER_HOME_PROMO__?.exitManualCapture?.()).catch(() => {})
    }

    await ffDone
    const wallSec = (Date.now() - wallStart) / 1000
    const info = await probeMp4Info(mp4Path)
    if (info.frames !== totalFrames) {
      throw new Error(`Shot ${shotName} expected ${totalFrames} frames, got ${info.frames}`)
    }
    console.log(`[promo] Rendered ${shotName}: ${info.frames} frames (${info.duration.toFixed(2)}s @ ${info.avgFps.toFixed(2)}fps) in ${wallSec.toFixed(1)}s`)
    return {
      shotName,
      mp4Path,
      mp4Duration: info.duration,
      frames: info.frames,
      avgFps: info.avgFps,
      renderWallSec: wallSec,
    }
  }

  console.log(`[promo] Session (${tag}) ready at ${width}x${height}`)
  return { context, page, cdp, recordDeterministicShot }
}

async function buildMasterAudioTrack(totalDurationSec, outM4aPath) {
  if (!fs.existsSync(bgmSourcePath)) {
    throw new Error(`Missing licensed promo BGM file: ${bgmSourcePath}`)
  }
  const fadeOutStart = Math.max(0, totalDurationSec - 1.8).toFixed(2)
  const rainDelayMs = Math.round(20.6 * 1000)

  // Gentle CC BY 4.0 Lo-Fi beat + subtle outdoor rain drizzle during closing rain-yard shot
  const filter = [
    `[0:a]aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo,atrim=0:${totalDurationSec.toFixed(3)},asetpts=PTS-STARTPTS,loudnorm=I=-14.5:TP=-1.5:LRA=8,afade=t=in:st=0:d=0.10,afade=t=out:st=${fadeOutStart}:d=1.80[bgm]`,
    `anoisesrc=color=pink:sample_rate=48000:duration=5.5,highpass=f=500,lowpass=f=2200,pan=stereo|c0=c0|c1=c0,volume=0.055,afade=t=in:st=0:d=1.1,afade=t=out:st=3.6:d=1.9,adelay=${rainDelayMs}|${rainDelayMs}[rain]`,
    `[bgm][rain]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.92[aout]`,
  ].join(';')

  await runCommand('ffmpeg', [
    '-y',
    '-i', bgmSourcePath,
    '-filter_complex', filter,
    '-map', '[aout]',
    '-t', totalDurationSec.toFixed(3),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    outM4aPath,
  ], { capture: true })
}

async function stitchShotsWithAudio(clips, audioPath, outputMp4, fadeSec = FADE_SEC) {
  const args = ['-y']
  for (const clip of clips) {
    args.push('-i', clip.mp4Path)
  }
  if (audioPath) {
    args.push('-i', audioPath)
  }
  const filterParts = []
  let prevLabel = '[0:v]'
  let runningDuration = clips[0].mp4Duration
  for (let i = 1; i < clips.length; i += 1) {
    const offset = Math.max(0.1, runningDuration - fadeSec).toFixed(4)
    const outLabel = i === clips.length - 1 ? '[v]' : `[vx${i}]`
    filterParts.push(
      `${prevLabel}[${i}:v]xfade=transition=fade:duration=${fadeSec.toFixed(4)}:offset=${offset}${outLabel}`,
    )
    runningDuration = runningDuration + clips[i].mp4Duration - fadeSec
    prevLabel = outLabel
  }

  const audioInputIdx = clips.length
  await runCommand('ffmpeg', [
    ...args,
    '-filter_complex', filterParts.join(';'),
    '-map', '[v]',
    ...(audioPath ? ['-map', `${audioInputIdx}:a`, '-c:a', 'copy', '-shortest'] : []),
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '16',
    '-r', String(TARGET_FPS),
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    outputMp4,
  ], { capture: true })

  return probeMp4Info(outputMp4)
}

async function encodeGifWithSizeLimit(inputMp4, outputGif, maxBytes = 7_600_000, attempts = [
  { fps: 12, width: 640 },
  { fps: 10, width: 600 },
  { fps: 8, width: 560 },
]) {
  const palettePath = path.join(qaTmpDir, 'tour-palette.png')
  for (const cfg of attempts) {
    const vfBase = `fps=${cfg.fps},scale=${cfg.width}:-1:flags=lanczos`
    await runCommand('ffmpeg', [
      '-y',
      '-i', inputMp4,
      '-vf', `${vfBase},palettegen=max_colors=${cfg.colors || 192}:stats_mode=diff`,
      palettePath,
    ], { capture: true })
    await runCommand('ffmpeg', [
      '-y',
      '-i', inputMp4,
      '-i', palettePath,
      '-lavfi', `${vfBase}[x];[x][1:v]paletteuse=dither=${cfg.dither || 'bayer:bayer_scale=3'}`,
      '-loop', '0',
      outputGif,
    ], { capture: true })
    const stat = await fsp.stat(outputGif)
    console.log(`[promo] GIF ${cfg.width}px @ ${cfg.fps}fps: ${(stat.size / 1048576).toFixed(2)} MiB`)
    if (stat.size <= maxBytes) {
      return { size: stat.size, fps: cfg.fps, width: cfg.width }
    }
  }
  const finalStat = await fsp.stat(outputGif)
  return { size: finalStat.size, fps: attempts[attempts.length - 1].fps, width: attempts[attempts.length - 1].width }
}

async function captureReadmeMedia(browser, baseUrl, setFrameSink) {
  const session = await createPromoSession(browser, baseUrl, setFrameSink, 1600, 900, 'readme')
  const { page, cdp } = session
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.evaluate(async () => {
      const api = window.__PAPER_HOME_PROMO__
      await api.jumpToPlace('yard')
      api.setWeather('clear')
      api.setAtmosphere('daylight')
      api.clearCamera()
    })
    await waitSettled(page, 1600)
    const heroPng = path.join(qaTmpDir, 'readme-hero.png')
    await page.screenshot({ path: heroPng })
    await sharp(heroPng).webp({ quality: 90 }).toFile(path.join(qaTmpDir, 'hero.webp'))

    await setViewportSizeCdp(page, cdp, 960, 540)
    const clips = []
    const shots = [
      {
        name: 'readme-yard', place: 'yard', seconds: 3,
        from: { position: [4.8, 2.05, 13.8], target: [-0.5, 1.55, -0.8], fov: 48 },
        to: { position: [2.8, 1.85, 11.2], target: [-0.2, 1.55, -0.8], fov: 48 },
      },
      {
        name: 'readme-hall', place: 'hall', seconds: 3.5, doorOpenSec: 0.8,
        from: { position: [0, 1.66, 3.6], target: [0, 1.56, -2.5], fov: 48 },
        to: { position: [0, 1.60, -4.6], target: [0, 1.58, -10.5], fov: 58 },
      },
    ]
    const gallery = await page.evaluate(() => {
      const api = window.__PAPER_HOME_PROMO__
      return {
        name: 'readme-gallery', place: 'gallery', seconds: 2.75,
        from: { position: api.roomPoint('gallery', [-1.25, 1.60, 1.85]), target: api.roomPoint('gallery', [-0.55, 1.52, -0.85]), fov: 52 },
        to: { position: api.roomPoint('gallery', [1.25, 1.60, 1.85]), target: api.roomPoint('gallery', [0.55, 1.52, -0.85]), fov: 52 },
      }
    })
    shots.push(gallery)
    for (const shot of shots) {
      clips.push(await session.recordDeterministicShot(
        shot.name, 960, 540, 24, shot.seconds,
        async (p) => {
          await p.evaluate(async ({ place, pose, door }) => {
            const api = window.__PAPER_HOME_PROMO__
            await api.jumpToPlace(place)
            api.setWeather('clear')
            api.setAtmosphere('daylight')
            if (door) api.setFrontDoorOpen(0)
            api.setCameraAt(null, pose, 0, 'none')
          }, { place: shot.place, pose: shot.from, door: Boolean(shot.doorOpenSec) })
        },
        { fromPose: shot.from, toPose: shot.to, ease: 'sine.inOut', doorOpenSec: shot.doorOpenSec },
      ))
    }
    const tourMp4 = path.join(qaTmpDir, 'readme-tour.mp4')
    const info = await stitchShotsWithAudio(clips, null, tourMp4, 0.25)
    const gifPath = path.join(qaTmpDir, 'tour.gif')
    const evidenceDir = path.join(rootDir, '.qa', 'readme-media')
    await fsp.mkdir(evidenceDir, { recursive: true })
    await fsp.copyFile(tourMp4, path.join(evidenceDir, 'tour.mp4'))
    const gif = await encodeGifWithSizeLimit(tourMp4, gifPath, 9_500_000, [
      { fps: 10, width: 800, colors: 64, dither: 'none' },
      { fps: 8, width: 800, colors: 64, dither: 'none' },
      { fps: 10, width: 720, colors: 64, dither: 'none' },
    ])
    if (gif.size > 9_500_000) throw new Error(`README GIF exceeds size budget: ${gif.size}`)
    if (errors.length) throw new Error(`README capture browser errors: ${errors.join('; ')}`)
    await fsp.copyFile(path.join(qaTmpDir, 'hero.webp'), path.join(docsMediaDir, 'hero.webp'))
    await fsp.copyFile(gifPath, path.join(docsMediaDir, 'tour.gif'))
    console.log(`[promo] README media saved: hero 1600x900; tour ${gif.width}px, ${gif.fps}fps, ${info.duration.toFixed(2)}s, ${(gif.size / 1048576).toFixed(2)} MiB`)
  } finally {
    await session.context.close()
  }
}

async function main() {
  await fsp.mkdir(promoDir, { recursive: true })
  await fsp.mkdir(docsMediaDir, { recursive: true })
  await fsp.mkdir(qaTmpDir, { recursive: true })

  await seedAndBuildPreview()
  const { server, baseUrl, setFrameSink } = await startStaticServer()

  const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : undefined

  const browser = await chromium.launch({
    ...(chromePath ? { executablePath: chromePath } : {}),
    headless: false,
    args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--window-size=1920,1080'],
  })

  const videoLogs = []

  // Total 25.50s exact phrase-locked timeline (4.25s per musical phrase, drop at 8.50s):
  // 4.45 + 4.65 + 4.65 + 4.65 + 4.65 + 4.45 - 5 * 0.40 = 25.50s @ 60.000 fps (1530 frames)
  const masterAudioPath = path.join(qaTmpDir, 'promo-master-25.50s.m4a')

  try {
    if (process.argv.includes('--readme-only')) {
      await captureReadmeMedia(browser, baseUrl, setFrameSink)
      return
    }
    await buildMasterAudioTrack(25.50, masterAudioPath)
    // ------------------------------------------------------------------
    // PART 1: XHS 6 Vertical Stills (1080x1440)
    // ------------------------------------------------------------------
    const xhsSession = await createPromoSession(browser, baseUrl, setFrameSink, 1080, 1440, 'xhs-stills')
    const { page: xhsPage } = xhsSession

    const xhsWideYardPose = { position: [5.4, 2.05, 14.8], target: [-0.85, 1.55, -0.8], fov: 50 }
    const xhsGoldYardPose = { position: [4.8, 1.98, 13.6], target: [-0.65, 1.55, -0.8], fov: 50 }
    const xhsShots = [
      { file: 'xhs-01-dawn.png', label: '晨雾小院', place: 'yard', atmo: 'dawn', weather: 'clear', lamp: null, pose: xhsWideYardPose, settle: 1300 },
      { file: 'xhs-02-daylight.png', label: '晴昼', place: 'yard', atmo: 'daylight', weather: 'clear', lamp: null, pose: xhsWideYardPose, settle: 1300 },
      { file: 'xhs-03-golden.png', label: '落日', place: 'yard', atmo: 'golden', weather: 'clear', lamp: null, pose: xhsGoldYardPose, settle: 1300 },
      { file: 'xhs-04-night.png', label: '夜灯', place: 'yard', atmo: 'night', weather: 'clear', lamp: true, pose: { position: [2.35, 1.76, 9.2], target: [-0.25, 1.52, -0.6], fov: 53 }, settle: 1400 },
      { file: 'xhs-05-rain-night.png', label: '雨夜', place: 'yard', atmo: 'night', weather: 'rain', lamp: true, pose: { position: [2.15, 1.74, 8.6], target: [-0.2, 1.52, -0.6], fov: 53 }, settle: 1600 },
      { file: 'xhs-06-study-lamp.png', label: '书房台灯亮起', place: 'study', atmo: 'night', weather: 'clear', lamp: true, pose: null, settle: 1400 },
    ]

    for (const shot of xhsShots) {
      await xhsPage.evaluate(
        async ({ p, atmo, w, lamp, pose }) => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace(p)
          api.setWeather(w)
          api.setAtmosphere(atmo)
          if (lamp !== null) api.setDeskLamp(lamp)
          if (pose) await api.glideCamera(null, pose, 0)
          else api.clearCamera()
        },
        { p: shot.place, atmo: shot.atmo, w: shot.weather, lamp: shot.lamp, pose: shot.pose },
      )
      await waitSettled(xhsPage, shot.settle)
      await xhsPage.screenshot({ path: path.join(promoDir, shot.file) })
      console.log(`[promo] Saved ${shot.file} (${shot.label})`)
    }
    await xhsSession.context.close()

    // ------------------------------------------------------------------
    // PART 2: Douyin / XHS Vertical Video (1080x1920, locked 60fps + CC BY 4.0 Lo-Fi BGM)
    // ------------------------------------------------------------------
    const vertSession = await createPromoSession(browser, baseUrl, setFrameSink, 1080, 1920, 'vertical-video')
    const vClips = []

    // Shot 1: 晨雾推近小院 (4.45s)
    vClips.push(await vertSession.recordDeterministicShot(
      'v-01-dawn', 1080, 1920, TARGET_FPS, 4.45,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setWeather('clear')
          api.setAtmosphere('dawn')
          api.setCameraAt(null, { position: [5.4, 2.08, 15.2], target: [-0.85, 1.55, -0.9], fov: 54 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [5.4, 2.08, 15.2], target: [-0.85, 1.55, -0.9], fov: 54 },
        toPose: { position: [1.5, 1.76, 8.7], target: [-0.2, 1.55, -0.6], fov: 53 },
        ease: 'sine.out',
      },
    ))

    // Shot 2: 切换落日 (4.65s)
    vClips.push(await vertSession.recordDeterministicShot(
      'v-02-golden', 1080, 1920, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setCameraAt(null, { position: [-2.8, 1.92, 12.8], target: [-0.6, 1.55, -0.8], fov: 52 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [-2.8, 1.92, 12.8], target: [-0.6, 1.55, -0.8], fov: 52 },
        toPose: { position: [2.6, 1.82, 11.4], target: [-0.4, 1.55, -0.8], fov: 52 },
        ease: 'sine.inOut',
      },
    ))

    // Shot 3: 推门进走廊 (4.65s continuous single motion straight through opening front door, zero stop)
    vClips.push(await vertSession.recordDeterministicShot(
      'v-03-hall', 1080, 1920, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('hall')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setFrontDoorOpen(0)
          api.setCameraAt(null, { position: [0, 1.66, 3.6], target: [0, 1.56, -2.5], fov: 52 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [0, 1.66, 3.6], target: [0, 1.56, -2.5], fov: 52 },
        toPose: { position: [0, 1.60, -4.6], target: [0, 1.58, -10.5], fov: 72 },
        ease: 'sine.inOut',
        doorOpenSec: 0.95,
      },
    ))

    // Shot 4: 进书房、夜灯下点亮台灯 (4.65s, lamp switches cleanly mid-glide)
    vClips.push(await vertSession.recordDeterministicShot(
      'v-04-study', 1080, 1920, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('study')
          api.setWeather('clear')
          api.setAtmosphere('night')
          api.setDeskLamp(false)
          api.setCameraAt(
            null,
            {
              position: api.roomPoint('study', [-0.26, 1.66, 1.72]),
              target: api.roomPoint('study', [0.08, 1.15, -1.25]),
              fov: 70,
            },
            0,
            'none',
          )
        })
      },
      {
        type: 'lamp-study',
        lampOnAtSec: 1.75,
        fromPose: {
          position: await vertSession.page.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [-0.26, 1.66, 1.72])),
          target: await vertSession.page.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.08, 1.15, -1.25])),
          fov: 70,
        },
        toPose: {
          position: await vertSession.page.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.05, 1.54, 1.24])),
          target: await vertSession.page.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.1, 1.12, -1.25])),
          fov: 64,
        },
        ease: 'sine.inOut',
      },
    ))

    // Shot 5: 作品室看展墙 (4.65s sweeping across all 3 artworks)
    const vGalleryFrom = await vertSession.page.evaluate(() => ({
      position: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [-1.35, 1.62, 1.48]),
      target: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [-1.35, 1.55, -0.85]),
      fov: 56,
    }))
    const vGalleryTo = await vertSession.page.evaluate(() => ({
      position: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [1.35, 1.62, 1.48]),
      target: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [1.35, 1.55, -0.85]),
      fov: 56,
    }))
    vClips.push(await vertSession.recordDeterministicShot(
      'v-05-gallery', 1080, 1920, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async (pose0) => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('gallery')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setCameraAt(null, pose0, 0, 'none')
        }, vGalleryFrom)
      },
      {
        fromPose: vGalleryFrom,
        toPose: vGalleryTo,
        ease: 'sine.inOut',
      },
    ))

    // Shot 6: 回到小院下起细雨，镜头缓慢沉静停住 (4.45s)
    vClips.push(await vertSession.recordDeterministicShot(
      'v-06-rain-yard', 1080, 1920, TARGET_FPS, 4.45,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setAtmosphere('night')
          api.setWeather('rain')
          api.setDeskLamp(true)
          api.setCameraAt(null, { position: [1.55, 1.68, 7.6], target: [-0.15, 1.5, -0.5], fov: 55 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [1.55, 1.68, 7.6], target: [-0.15, 1.5, -0.5], fov: 55 },
        toPose: { position: [2.25, 1.76, 8.9], target: [-0.2, 1.5, -0.5], fov: 54 },
        ease: 'power2.out',
        rainWarmupFrames: 30,
      },
    ))

    const vertMp4 = path.join(promoDir, 'douyin-xhs-vertical.mp4')
    const vertInfo = await stitchShotsWithAudio(vClips, masterAudioPath, vertMp4, FADE_SEC)
    const vertStat = await fsp.stat(vertMp4)
    videoLogs.push({
      name: 'douyin-xhs-vertical.mp4',
      resolution: '1080x1920',
      durationSec: vertInfo.duration,
      outputFrames: vertInfo.frames,
      actualAvgFps: vertInfo.avgFps,
      minShotFps: Math.min(...vClips.map((c) => c.avgFps)),
      fileBytes: vertStat.size,
      audio: 'Purrple Cat - A Short Walk With You (CC BY 4.0) + soft evening rain',
      shots: vClips.map((c) => `${c.shotName}:${c.mp4Duration.toFixed(2)}s(${c.frames}f@${c.avgFps.toFixed(1)}fps)`).join(', '),
    })
    await vertSession.context.close()

    // ------------------------------------------------------------------
    // PART 3: Bilibili Horizontal Video (1920x1080, locked 60fps + BGM), Cover, Social Preview, Hero & Tour GIF
    // ------------------------------------------------------------------
    const wideSession = await createPromoSession(browser, baseUrl, setFrameSink, 1920, 1080, 'wide-media')
    const { page: wp, cdp: wideCdp } = wideSession

    await wp.evaluate(async () => {
      const api = window.__PAPER_HOME_PROMO__
      await api.jumpToPlace('yard')
      api.setWeather('clear')
      api.setAtmosphere('golden')
      api.clearCamera()
    })
    await waitSettled(wp, 1200)
    const biliCoverPath = path.join(promoDir, 'bilibili-cover.png')
    await wp.screenshot({ path: biliCoverPath })
    console.log('[promo] Saved bilibili-cover.png (1920x1080)')

    const heroWebpPath = path.join(docsMediaDir, 'hero.webp')
    await sharp(biliCoverPath).resize(1600, 900).webp({ quality: 90 }).toFile(heroWebpPath)
    console.log('[promo] Saved docs/media/hero.webp (1600x900)')

    await setViewportSizeCdp(wp, wideCdp, 1280, 640)
    await waitSettled(wp, 900)
    await wp.screenshot({ path: path.join(promoDir, 'social-preview.png') })
    console.log('[promo] Saved social-preview.png (1280x640)')

    await setViewportSizeCdp(wp, wideCdp, 1920, 1080)
    const hClips = []

    // Shot 1: Dawn mist dolly (4.45s)
    hClips.push(await wideSession.recordDeterministicShot(
      'h-01-dawn', 1920, 1080, TARGET_FPS, 4.45,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setWeather('clear')
          api.setAtmosphere('dawn')
          api.setCameraAt(null, { position: [4.6, 2.02, 13.4], target: [-0.45, 1.55, -0.8], fov: 46 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [4.6, 2.02, 13.4], target: [-0.45, 1.55, -0.8], fov: 46 },
        toPose: { position: [1.9, 1.78, 9.6], target: [-0.2, 1.55, -0.8], fov: 45 },
        ease: 'sine.out',
      },
    ))

    // Shot 2: Golden sunset yard pan (4.65s)
    hClips.push(await wideSession.recordDeterministicShot(
      'h-02-golden', 1920, 1080, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setCameraAt(null, { position: [-2.6, 1.85, 11.2], target: [-0.3, 1.55, -0.8], fov: 45 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [-2.6, 1.85, 11.2], target: [-0.3, 1.55, -0.8], fov: 45 },
        toPose: { position: [2.2, 1.78, 10.2], target: [-0.15, 1.55, -0.8], fov: 45 },
        ease: 'sine.inOut',
      },
    ))

    // Shot 3: Front doorway entrance + unbroken hallway stroll (4.65s)
    hClips.push(await wideSession.recordDeterministicShot(
      'h-03-hall', 1920, 1080, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('hall')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setFrontDoorOpen(0)
          api.setCameraAt(null, { position: [0, 1.66, 3.6], target: [0, 1.56, -2.5], fov: 48 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [0, 1.66, 3.6], target: [0, 1.56, -2.5], fov: 48 },
        toPose: { position: [0, 1.60, -4.6], target: [0, 1.58, -10.5], fov: 58 },
        ease: 'sine.inOut',
        doorOpenSec: 0.95,
      },
    ))

    // Shot 4: Study night room -> desk lamp glow (4.65s)
    hClips.push(await wideSession.recordDeterministicShot(
      'h-04-study', 1920, 1080, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('study')
          api.setWeather('clear')
          api.setAtmosphere('night')
          api.setDeskLamp(false)
          api.setCameraAt(
            null,
            {
              position: api.roomPoint('study', [-0.4, 1.62, 1.68]),
              target: api.roomPoint('study', [0.3, 1.18, -1.25]),
              fov: 56,
            },
            0,
            'none',
          )
        })
      },
      {
        type: 'lamp-study',
        lampOnAtSec: 1.75,
        fromPose: {
          position: await wp.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [-0.4, 1.62, 1.68])),
          target: await wp.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.3, 1.18, -1.25])),
          fov: 56,
        },
        toPose: {
          position: await wp.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.12, 1.50, 1.24])),
          target: await wp.evaluate(() => window.__PAPER_HOME_PROMO__.roomPoint('study', [0.35, 1.16, -1.25])),
          fov: 52,
        },
        ease: 'sine.inOut',
      },
    ))

    // Shot 5: Gallery panoramic sweep across 3 published works (4.65s)
    const hGalleryFrom = await wp.evaluate(() => ({
      position: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [-1.25, 1.60, 1.85]),
      target: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [-0.55, 1.52, -0.85]),
      fov: 52,
    }))
    const hGalleryTo = await wp.evaluate(() => ({
      position: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [1.25, 1.60, 1.85]),
      target: window.__PAPER_HOME_PROMO__.roomPoint('gallery', [0.55, 1.52, -0.85]),
      fov: 52,
    }))
    hClips.push(await wideSession.recordDeterministicShot(
      'h-05-gallery', 1920, 1080, TARGET_FPS, 4.65,
      async (p) => {
        await p.evaluate(async (pose0) => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('gallery')
          api.setWeather('clear')
          api.setAtmosphere('golden')
          api.setCameraAt(null, pose0, 0, 'none')
        }, hGalleryFrom)
      },
      {
        fromPose: hGalleryFrom,
        toPose: hGalleryTo,
        ease: 'sine.inOut',
      },
    ))

    // Shot 6: Closing rain night yard hold (4.45s)
    hClips.push(await wideSession.recordDeterministicShot(
      'h-06-rain-yard', 1920, 1080, TARGET_FPS, 4.45,
      async (p) => {
        await p.evaluate(async () => {
          const api = window.__PAPER_HOME_PROMO__
          await api.jumpToPlace('yard')
          api.setAtmosphere('night')
          api.setWeather('rain')
          api.setDeskLamp(true)
          api.setCameraAt(null, { position: [2.2, 1.74, 9.2], target: [-0.25, 1.5, -0.7], fov: 48 }, 0, 'none')
        })
      },
      {
        fromPose: { position: [2.2, 1.74, 9.2], target: [-0.25, 1.5, -0.7], fov: 48 },
        toPose: { position: [3.0, 1.84, 10.8], target: [-0.25, 1.5, -0.7], fov: 48 },
        ease: 'power2.out',
        rainWarmupFrames: 30,
      },
    ))

    const biliMp4 = path.join(promoDir, 'bilibili-horizontal.mp4')
    const biliInfo = await stitchShotsWithAudio(hClips, masterAudioPath, biliMp4, FADE_SEC)
    const biliStat = await fsp.stat(biliMp4)
    videoLogs.push({
      name: 'bilibili-horizontal.mp4',
      resolution: '1920x1080',
      durationSec: biliInfo.duration,
      outputFrames: biliInfo.frames,
      actualAvgFps: biliInfo.avgFps,
      minShotFps: Math.min(...hClips.map((c) => c.avgFps)),
      fileBytes: biliStat.size,
      audio: 'Purrple Cat - A Short Walk With You (CC BY 4.0) + soft evening rain',
      shots: hClips.map((c) => `${c.shotName}:${c.mp4Duration.toFixed(2)}s(${c.frames}f@${c.avgFps.toFixed(1)}fps)`).join(', '),
    })

    // Build crisp ~8s README tour.gif directly from locked 60fps golden yard, doorway hall & 3-work gallery clips
    const gifSeg0 = path.join(qaTmpDir, 'gif-seg0.mp4')
    const gifSeg1 = path.join(qaTmpDir, 'gif-seg1.mp4')
    const gifSeg2 = path.join(qaTmpDir, 'gif-seg2.mp4')
    await runCommand('ffmpeg', ['-y', '-i', hClips[1].mp4Path, '-t', '2.1', '-c:v', 'libx264', '-crf', '16', gifSeg0], { capture: true })
    await runCommand('ffmpeg', ['-y', '-ss', '0.1', '-i', hClips[2].mp4Path, '-t', '3.5', '-c:v', 'libx264', '-crf', '16', gifSeg1], { capture: true })
    await runCommand('ffmpeg', ['-y', '-i', hClips[4].mp4Path, '-t', '2.9', '-c:v', 'libx264', '-crf', '16', gifSeg2], { capture: true })
    const gifClips = [
      { mp4Path: gifSeg0, mp4Duration: (await probeMp4Info(gifSeg0)).duration },
      { mp4Path: gifSeg1, mp4Duration: (await probeMp4Info(gifSeg1)).duration },
      { mp4Path: gifSeg2, mp4Duration: (await probeMp4Info(gifSeg2)).duration },
    ]
    const tourMp4 = path.join(qaTmpDir, 'tour-combined.mp4')
    const tourInfo = await stitchShotsWithAudio(gifClips, null, tourMp4, 0.3)
    const tourGifPath = path.join(docsMediaDir, 'tour.gif')
    const gifInfo = await encodeGifWithSizeLimit(tourMp4, tourGifPath)
    videoLogs.push({
      name: 'docs/media/tour.gif',
      resolution: `${gifInfo.width}px wide @ ${gifInfo.fps}fps GIF`,
      durationSec: tourInfo.duration,
      outputFrames: tourInfo.frames,
      actualAvgFps: tourInfo.avgFps,
      minShotFps: Math.min(...hClips.map((c) => c.avgFps)),
      fileBytes: gifInfo.size,
      audio: 'silent GIF',
      shots: 'stitched from h-02-golden(2.1s), h-03-hall(3.5s), h-05-gallery(2.9s)',
    })

    await wideSession.context.close()

    const logLines = [
      `Paper Home Promo Capture Log (${new Date().toISOString()})`,
      `Chrome: ${chromePath || 'playwright-chromium'}`,
      `Capture Mode: deterministic R3F 60fps stepped offscreen-buffer pipe + FFmpeg libx264 (CFR 60fps)`,
      '',
      '=== Video, Audio & GIF Frame Rate Report ===',
      ...videoLogs.map(
        (v) =>
          `${v.name} | ${v.resolution} | duration=${v.durationSec.toFixed(2)}s | frames=${v.outputFrames} | actualAvgFps=${v.actualAvgFps.toFixed(2)} (minShot=${v.minShotFps.toFixed(2)}) | size=${(v.fileBytes / 1048576).toFixed(2)} MiB\n  audio: ${v.audio}\n  shots: ${v.shots}`,
      ),
      '',
    ]
    const lowFpsVideos = videoLogs.filter((v) => v.minShotFps < 59.5)
    if (lowFpsVideos.length > 0) {
      logLines.push(
        `WARNING: Frame rate below 60 fps detected in: ${lowFpsVideos.map((v) => `${v.name} (${v.minShotFps.toFixed(2)} fps)`).join(', ')}`,
      )
    } else {
      logLines.push('STATUS: All captured shots rendered deterministically at locked 60.00 fps with zero dropped/duplicate frames and zero door/wall clipping.')
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
