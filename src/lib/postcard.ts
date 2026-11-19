import { create as createQrCode } from 'qrcode'
import type { Locale } from './i18n'
import type { AtmospherePreset, Place, WeatherMode } from '../types/content'

export interface PostcardInput {
  snapshotDataUrl: string | null
  homeName: string
  plaqueTitle: string
  room: Place
  roomName: string
  atmospherePreset: AtmospherePreset
  weather: WeatherMode
  message: string
  itemLabel?: string | null
  deepLinkUrl: string
  deepLinkHash: string
  includeQr: boolean
  date?: Date
  locale?: Locale
}

export interface RenderedPostcard {
  dataUrl: string
  blob: Blob | null
  width: number
  height: number
}

const CARD_W = 1200
const CARD_H = 1560

interface AtmoTheme {
  atmoLabel: string
  atmoLabelEn: string
  stampColor: string
  stampSecondary: string
  accentWash: string
  fallbackSkyTop: string
  fallbackSkyBottom: string
}

const ATMO_THEMES: Record<AtmospherePreset, AtmoTheme> = {
  dawn: {
    atmoLabel: '晨雾微凉',
    atmoLabelEn: 'Misty Dawn',
    stampColor: '#4a6b7c',
    stampSecondary: '#6a8b9c',
    accentWash: 'rgba(207, 220, 224, 0.24)',
    fallbackSkyTop: '#c4d5de',
    fallbackSkyBottom: '#e5ecec',
  },
  daylight: {
    atmoLabel: '晴日暖风',
    atmoLabelEn: 'Warm Daylight',
    stampColor: '#365840',
    stampSecondary: '#587c62',
    accentWash: 'rgba(235, 241, 232, 0.28)',
    fallbackSkyTop: '#b7d0da',
    fallbackSkyBottom: '#eef2e8',
  },
  golden: {
    atmoLabel: '夕照晚霞',
    atmoLabelEn: 'Golden Sunset',
    stampColor: '#a65a2a',
    stampSecondary: '#c77a42',
    accentWash: 'rgba(255, 220, 178, 0.22)',
    fallbackSkyTop: '#e3ad7a',
    fallbackSkyBottom: '#f7dec2',
  },
  night: {
    atmoLabel: '夜灯长明',
    atmoLabelEn: 'Night Glow',
    stampColor: '#2d445c',
    stampSecondary: '#d1984d',
    accentWash: 'rgba(204, 218, 234, 0.2)',
    fallbackSkyTop: '#1f2b3a',
    fallbackSkyBottom: '#3e5368',
  },
}

export const POSTCARD_PRESET_QUOTES: string[] = [
  '推开院门，在光影和纸页里安静待一会儿。',
  '把做出来的东西放进房间，等风吹过窗边。',
  '亮着台灯的时候，这里随时欢迎你进来坐坐。',
  '每一扇门背后，都留着一点慢慢打磨的痕迹。',
]

export const POSTCARD_PRESET_QUOTES_EN: string[] = [
  'Push open the courtyard gate and linger awhile among paper and light.',
  'Each finished piece lives in its own room while the breeze passes the window.',
  'Whenever the green desk lamp is lit, you are welcome to step inside.',
  'Behind every door lies a trace of patient craft.',
]

export function defaultPostcardMessage({
  room,
  atmospherePreset,
  weather,
  itemLabel,
  nowNote,
  locale = 'zh',
}: {
  room: Place
  atmospherePreset: AtmospherePreset
  weather: WeatherMode
  itemLabel?: string | null
  nowNote?: string | null
  locale?: Locale
}): string {
  if (locale === 'en') {
    if (itemLabel && itemLabel.trim()) {
      return `Flipping through "${itemLabel.trim()}" inside the cottage, saving this quiet moment.`
    }
    if (weather === 'rain' && room !== 'yard') {
      return 'Gentle rain outside the panes—listening to the quiet drizzle indoors.'
    }
    if (weather === 'rain' && room === 'yard') {
      return 'Soft rain in the courtyard; just past the front door waits a warm corridor.'
    }
    if (atmospherePreset === 'night') {
      return 'As night settles in, the green brass desk lamp glows warmly for visitors.'
    }
    if (atmospherePreset === 'golden') {
      return 'Sunset stretches the old tree shadows while warm amber light grazes the glass.'
    }
    if (atmospherePreset === 'dawn') {
      return 'Cool morning mist lingers over the porch steps and wooden plaque.'
    }
    if (room === 'blank' && nowNote) {
      return nowNote
    }
    if (room === 'study') {
      return 'Opening the study notes to revisit the choices and experiments along the way.'
    }
    if (room === 'gallery') {
      return 'Framed works along the gallery wall, catching the afternoon light.'
    }
    return 'Push open the door and wander through works, notes, and quiet corners.'
  }
  if (itemLabel && itemLabel.trim()) {
    return `在小屋里翻看《${itemLabel.trim()}》，记下这一刻的微光。`
  }
  if (weather === 'rain' && room !== 'yard') {
    return '窗外正下着细雨，坐在屋里听着隔着玻璃的滴答声。'
  }
  if (weather === 'rain' && room === 'yard') {
    return '小院下了些细雨，推门进去就是暖意融融的走廊。'
  }
  if (atmospherePreset === 'night') {
    return '夜色落下来时，书桌那盏绿台灯刚好为来访的人亮着。'
  }
  if (atmospherePreset === 'golden') {
    return '落日把大树的影子拉得很长，窗玻璃泛着柔和的金光。'
  }
  if (atmospherePreset === 'dawn') {
    return '清晨的薄雾还没散，门牌和台阶都带着一点凉意。'
  }
  if (room === 'blank' && nowNote) {
    return nowNote
  }
  if (room === 'study') {
    return '翻开桌上的创作手记，看看当时为什么做出这样的取舍。'
  }
  if (room === 'gallery') {
    return '墙上的画纸一张张挂好，阳光正好落在展框边上。'
  }
  return '推开这扇门，来看看生活、文字和喜欢的事物。'
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

function formatPostmarkDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}.${m}.${d}`
}

function wrapMixedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  fallbackQuote: string,
): string[] {
  const paragraphs = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((p) => p.trim())
    .filter(Boolean)
  const lines: string[] = []
  let truncated = false

  for (let pIdx = 0; pIdx < paragraphs.length; pIdx++) {
    const chars = Array.from(paragraphs[pIdx])
    let current = ''
    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i]
      const candidate = current + ch
      if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
        const lastSpace = current.lastIndexOf(' ')
        if (lastSpace > 0 && /[A-Za-z0-9]/.test(ch)) {
          lines.push(current.slice(0, lastSpace).trimEnd())
          current = (current.slice(lastSpace + 1) + ch).trimStart()
        } else {
          lines.push(current.trimEnd())
          current = ch === ' ' ? '' : ch
        }
        if (lines.length >= maxLines) {
          truncated = true
          break
        }
      } else {
        current = candidate
      }
    }
    if (truncated) break
    if (current.trim()) {
      if (lines.length >= maxLines) {
        truncated = true
        break
      }
      lines.push(current.trim())
      if (lines.length >= maxLines && pIdx < paragraphs.length - 1) {
        truncated = true
        break
      }
    }
  }

  if (truncated && lines.length === maxLines) {
    let last = lines[maxLines - 1]
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = Array.from(last).slice(0, -1).join('')
    }
    lines[maxLines - 1] = `${last}…`
  }

  return lines.length > 0 ? lines : [fallbackQuote]
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r)
    return
  }
  const radius = Math.min(r, w / 2, h / 2)
  ctx.moveTo(x + radius, y)
  ctx.lineTo(x + w - radius, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius)
  ctx.lineTo(x + w, y + h - radius)
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h)
  ctx.lineTo(x + radius, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius)
  ctx.lineTo(x, y + radius)
  ctx.quadraticCurveTo(x, y, x + radius, y)
  ctx.closePath()
}

function drawPaperTexture(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = '#f3efe5'
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Warm ambient radial wash
  const radial = ctx.createRadialGradient(
    CARD_W * 0.5,
    CARD_H * 0.38,
    120,
    CARD_W * 0.5,
    CARD_H * 0.5,
    CARD_W * 0.85,
  )
  radial.addColorStop(0, 'rgba(255, 253, 247, 0.65)')
  radial.addColorStop(1, 'rgba(229, 223, 208, 0.52)')
  ctx.fillStyle = radial
  ctx.fillRect(0, 0, CARD_W, CARD_H)

  // Deterministic subtle paper fibers (no Math.random flicker between previews)
  let seed = 1337
  const nextRand = () => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  ctx.save()
  for (let i = 0; i < 650; i++) {
    const x = nextRand() * CARD_W
    const y = nextRand() * CARD_H
    const r = 0.6 + nextRand() * 1.1
    ctx.fillStyle = i % 3 === 0 ? 'rgba(255,255,255,0.45)' : 'rgba(54, 72, 58, 0.045)'
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}

function drawEditorialBorders(ctx: CanvasRenderingContext2D) {
  ctx.save()
  ctx.strokeStyle = 'rgba(41, 54, 46, 0.16)'
  ctx.lineWidth = 2
  ctx.strokeRect(28, 28, CARD_W - 56, CARD_H - 56)

  ctx.strokeStyle = 'rgba(41, 54, 46, 0.08)'
  ctx.lineWidth = 1.25
  ctx.strokeRect(40, 40, CARD_W - 80, CARD_H - 80)

  // Exhibition corner ticks
  const tick = 16
  ctx.strokeStyle = 'rgba(54, 88, 64, 0.45)'
  ctx.lineWidth = 2
  const corners: [number, number, number, number][] = [
    [28, 28, 1, 1],
    [CARD_W - 28, 28, -1, 1],
    [28, CARD_H - 28, 1, -1],
    [CARD_W - 28, CARD_H - 28, -1, -1],
  ]
  for (const [cx, cy, dx, dy] of corners) {
    ctx.beginPath()
    ctx.moveTo(cx, cy + dy * tick)
    ctx.lineTo(cx, cy)
    ctx.lineTo(cx + dx * tick, cy)
    ctx.stroke()
  }
  ctx.restore()
}

function drawPostageAndPostmark(
  ctx: CanvasRenderingContext2D,
  theme: AtmoTheme,
  weather: WeatherMode,
  roomName: string,
  dateStr: string,
  locale: Locale,
) {
  // Perforated miniature house stamp at top-right over photo edge
  const sx = 982
  const sy = 56
  const sw = 136
  const sh = 160

  ctx.save()
  ctx.translate(sx + sw / 2, sy + sh / 2)
  ctx.rotate(0.035)
  ctx.translate(-sw / 2, -sh / 2)

  ctx.shadowColor = 'rgba(26, 36, 28, 0.14)'
  ctx.shadowBlur = 14
  ctx.shadowOffsetY = 4
  ctx.fillStyle = '#faf7ef'
  ctx.fillRect(0, 0, sw, sh)
  ctx.shadowColor = 'transparent'

  // Stamp perforations along edges
  ctx.fillStyle = '#f3efe5'
  for (let x = 10; x < sw; x += 14) {
    ctx.beginPath(); ctx.arc(x, 0, 3.2, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(x, sh, 3.2, 0, Math.PI * 2); ctx.fill()
  }
  for (let y = 10; y < sh; y += 14) {
    ctx.beginPath(); ctx.arc(0, y, 3.2, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(sw, y, 3.2, 0, Math.PI * 2); ctx.fill()
  }

  // Inner stamp illustration
  ctx.fillStyle = theme.accentWash
  ctx.fillRect(14, 14, sw - 28, sh - 46)
  ctx.strokeStyle = theme.stampColor
  ctx.lineWidth = 1.6
  ctx.strokeRect(14, 14, sw - 28, sh - 46)

  // Minimal cottage roof + window mark
  ctx.strokeStyle = theme.stampColor
  ctx.lineWidth = 2.4
  ctx.lineJoin = 'round'
  ctx.beginPath()
  ctx.moveTo(34, 68)
  ctx.lineTo(sw / 2, 34)
  ctx.lineTo(sw - 34, 68)
  ctx.moveTo(42, 63)
  ctx.lineTo(42, 102)
  ctx.lineTo(sw - 42, 102)
  ctx.lineTo(sw - 42, 63)
  ctx.stroke()

  ctx.fillStyle = theme.stampSecondary
  ctx.fillRect(sw / 2 - 8, 72, 16, 30)

  ctx.fillStyle = theme.stampColor
  ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, sans-serif'
  ctx.textAlign = 'center'
  ctx.fillText(weather === 'rain' ? 'RAIN · 6MM' : 'AIR MAIL', sw / 2, sh - 14)
  ctx.restore()

  // Circular wavy cancellation postmark intersecting the left side of the stamp
  const px = 944
  const py = 148
  const rOuter = 68
  ctx.save()
  ctx.translate(px, py)
  ctx.rotate(-0.14)

  // Wavy cancel bars
  ctx.strokeStyle = `${theme.stampColor}88`
  ctx.lineWidth = 1.6
  for (let row = -1; row <= 1; row++) {
    const wy = row * 12
    ctx.beginPath()
    for (let wx = 50; wx <= 152; wx += 4) {
      const yOff = Math.sin(wx * 0.22) * 3.2
      if (wx === 50) ctx.moveTo(wx, wy + yOff)
      else ctx.lineTo(wx, wy + yOff)
    }
    ctx.stroke()
  }

  ctx.strokeStyle = theme.stampColor
  ctx.lineWidth = 2.1
  ctx.beginPath()
  ctx.arc(0, 0, rOuter, 0, Math.PI * 2)
  ctx.stroke()

  ctx.setLineDash([4, 4])
  ctx.lineWidth = 1.3
  ctx.beginPath()
  ctx.arc(0, 0, rOuter - 9, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])

  const atmoLabel = locale === 'en' ? theme.atmoLabelEn : theme.atmoLabel
  const weatherBadge =
    locale === 'en'
      ? weather === 'rain'
        ? `${atmoLabel} · Rain`
        : atmoLabel
      : weather === 'rain'
        ? `${theme.atmoLabel.slice(0, 2)}细雨`
        : theme.atmoLabel
  ctx.fillStyle = theme.stampColor
  ctx.textAlign = 'center'
  ctx.font = locale === 'en' ? '600 13px Georgia, serif' : '600 15px "KaiTi", "STKaiti", serif'
  ctx.fillText(weatherBadge, 0, -20)
  ctx.font = '600 15px ui-monospace, SFMono-Regular, Menlo, sans-serif'
  ctx.fillText(dateStr, 0, 5)
  ctx.font = locale === 'en' ? '600 14px Georgia, serif' : '600 15px "KaiTi", "STKaiti", serif'
  ctx.fillText(roomName, 0, 30)
  ctx.restore()
}

function drawQrCode(
  ctx: CanvasRenderingContext2D,
  url: string,
  x: number,
  y: number,
  size: number,
): boolean {
  let qr: ReturnType<typeof createQrCode>
  try {
    qr = createQrCode(url, { errorCorrectionLevel: 'M' })
  } catch {
    return false
  }
  const count = qr.modules.size
  const pad = 10
  const inner = size - pad * 2
  const cell = inner / count

  ctx.save()
  ctx.fillStyle = '#fcfaf4'
  ctx.fillRect(x, y, size, size)
  ctx.strokeStyle = 'rgba(41, 54, 46, 0.2)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(x, y, size, size)

  ctx.fillStyle = '#29362e'
  for (let row = 0; row < count; row++) {
    for (let col = 0; col < count; col++) {
      if (qr.modules.get(row, col)) {
        const rx = x + pad + col * cell
        const ry = y + pad + row * cell
        ctx.fillRect(rx, ry, Math.ceil(cell), Math.ceil(cell))
      }
    }
  }
  ctx.restore()
  return true
}

export async function renderPostcardCanvas(input: PostcardInput): Promise<RenderedPostcard> {
  const locale = input.locale ?? 'zh'
  const canvas = document.createElement('canvas')
  canvas.width = CARD_W
  canvas.height = CARD_H
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error(locale === 'en' ? 'Unable to create postcard canvas context' : '无法创建明信片画布上下文')
  }

  const theme = ATMO_THEMES[input.atmospherePreset]
  const atmoLabel = locale === 'en' ? theme.atmoLabelEn : theme.atmoLabel
  const dateStr = formatPostmarkDate(input.date ?? new Date())

  // Wait briefly for handwriting font when supported
  if (typeof document !== 'undefined' && document.fonts?.load) {
    try {
      await document.fonts.load('42px HomeHand')
    } catch {
      // Fallback to KaiTi/serif silently
    }
  }

  drawPaperTexture(ctx)
  drawEditorialBorders(ctx)

  // Photo viewport frame
  const matX = 72
  const matY = 74
  const matW = CARD_W - 144
  const matH = 788

  ctx.save()
  ctx.shadowColor = 'rgba(26, 36, 28, 0.10)'
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  ctx.fillStyle = '#fffdf8'
  ctx.fillRect(matX, matY, matW, matH)
  ctx.restore()

  const photoPad = 14
  const photoX = matX + photoPad
  const photoY = matY + photoPad
  const photoW = matW - photoPad * 2
  const photoH = matH - photoPad * 2

  ctx.save()
  ctx.beginPath()
  ctx.rect(photoX, photoY, photoW, photoH)
  ctx.clip()

  const snapshot = input.snapshotDataUrl ? await loadImage(input.snapshotDataUrl) : null
  if (snapshot && snapshot.width > 0 && snapshot.height > 0) {
    // Aspect-cover crop so landscape & portrait captures both frame cleanly
    const scale = Math.max(photoW / snapshot.width, photoH / snapshot.height)
    const drawW = snapshot.width * scale
    const drawH = snapshot.height * scale
    const drawX = photoX + (photoW - drawW) / 2
    const drawY = photoY + (photoH - drawH) / 2
    ctx.drawImage(snapshot, drawX, drawY, drawW, drawH)
  } else {
    const grad = ctx.createLinearGradient(0, photoY, 0, photoY + photoH)
    grad.addColorStop(0, theme.fallbackSkyTop)
    grad.addColorStop(1, theme.fallbackSkyBottom)
    ctx.fillStyle = grad
    ctx.fillRect(photoX, photoY, photoW, photoH)

    ctx.fillStyle = 'rgba(255, 253, 248, 0.85)'
    ctx.font = '32px "HomeHand", "KaiTi", serif'
    ctx.textAlign = 'center'
    ctx.fillText(`${input.homeName} · ${input.roomName}`, photoX + photoW / 2, photoY + photoH / 2)
  }

  // Subtle film edge vignette
  const edgeGrad = ctx.createLinearGradient(0, photoY + photoH - 130, 0, photoY + photoH)
  edgeGrad.addColorStop(0, 'rgba(20, 29, 22, 0)')
  edgeGrad.addColorStop(1, 'rgba(20, 29, 22, 0.36)')
  ctx.fillStyle = edgeGrad
  ctx.fillRect(photoX, photoY + photoH - 130, photoW, 130)

  // Bottom-right photo caption
  const weatherWord = input.weather === 'rain' ? (locale === 'en' ? ' · Rain' : ' · 细雨') : ''
  ctx.fillStyle = 'rgba(252, 250, 244, 0.92)'
  ctx.font = '500 18px ui-monospace, SFMono-Regular, Menlo, sans-serif'
  ctx.textAlign = 'right'
  ctx.fillText(
    `${input.roomName} · ${atmoLabel}${weatherWord}`,
    photoX + photoW - 22,
    photoY + photoH - 20,
  )
  ctx.restore()

  ctx.strokeStyle = 'rgba(41, 54, 46, 0.14)'
  ctx.lineWidth = 1.5
  ctx.strokeRect(photoX, photoY, photoW, photoH)

  // Overlay stamp & postmark on top-right
  drawPostageAndPostmark(ctx, theme, input.weather, input.roomName, dateStr, locale)

  // Editorial text & greeting section
  const textX = 86
  let cursorY = 930

  // Room + optional item pill label
  const tagText = input.itemLabel?.trim()
    ? locale === 'en'
      ? `${input.roomName} · "${input.itemLabel.trim()}"`
      : `${input.roomName} · 《${input.itemLabel.trim()}》`
    : `${input.roomName} · ${atmoLabel}${weatherWord}`

  ctx.font = locale === 'en' ? '500 20px Georgia, serif' : '500 21px "KaiTi", "STKaiti", serif'
  const pillWidth = Math.min(matW - 40, ctx.measureText(tagText).width + 40)
  ctx.fillStyle = 'rgba(54, 88, 64, 0.09)'
  ctx.beginPath()
  drawRoundedRectPath(ctx, textX, cursorY - 28, pillWidth, 40, 20)
  ctx.fill()
  ctx.fillStyle = '#365840'
  ctx.textAlign = 'left'
  ctx.fillText(tagText, textX + 20, cursorY - 1)

  cursorY += 68

  // Main greeting copy
  ctx.fillStyle = '#29362e'
  ctx.font = locale === 'en' ? '38px Georgia, "HomeHand", serif' : '44px "HomeHand", "KaiTi", "STKaiti", Georgia, serif'
  const fallbackQuote = locale === 'en' ? POSTCARD_PRESET_QUOTES_EN[0] : POSTCARD_PRESET_QUOTES[0]
  const bodyLines = wrapMixedText(ctx, input.message, matW - 56, 4, fallbackQuote)
  for (const line of bodyLines) {
    ctx.fillText(line, textX, cursorY)
    cursorY += 64
  }

  // Horizontal dotted divider near footer
  const dividerY = 1288
  ctx.save()
  ctx.strokeStyle = 'rgba(41, 54, 46, 0.15)'
  ctx.lineWidth = 1.5
  ctx.setLineDash([4, 6])
  ctx.beginPath()
  ctx.moveTo(76, dividerY)
  ctx.lineTo(CARD_W - 76, dividerY)
  ctx.stroke()
  ctx.restore()

  // Signature + deep link + optional scannable QR block
  const footerLeftX = 86
  const qrSize = 152
  const qrX = CARD_W - 76 - qrSize
  const qrY = 1324

  ctx.fillStyle = '#29362e'
  ctx.font = '34px "HomeHand", "KaiTi", "STKaiti", serif'
  ctx.textAlign = 'left'
  ctx.fillText(`—— ${input.homeName}`, footerLeftX, 1368)

  ctx.fillStyle = '#536154'
  ctx.font = '20px "KaiTi", "STKaiti", serif'
  ctx.fillText(`${input.plaqueTitle} · ${dateStr}`, footerLeftX, 1408)

  // Deep-link preview line (ellipsized cleanly to stay clear of QR block)
  const linkMaxW = (input.includeQr ? qrX - 36 : CARD_W - 86) - footerLeftX
  ctx.font = '500 17px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
  ctx.fillStyle = '#365840'
  let linkDisplay = input.deepLinkHash
  if (ctx.measureText(linkDisplay).width > linkMaxW) {
    while (linkDisplay.length > 8 && ctx.measureText(`${linkDisplay}…`).width > linkMaxW) {
      linkDisplay = linkDisplay.slice(0, -1)
    }
    linkDisplay = `${linkDisplay}…`
  }
  ctx.fillText(linkDisplay, footerLeftX, 1456)

  if (input.includeQr) {
    const drewQr = drawQrCode(ctx, input.deepLinkUrl, qrX, qrY, qrSize)
    if (drewQr) {
      ctx.fillStyle = '#536154'
      ctx.font = locale === 'en' ? '500 13px Georgia, serif' : '500 14px "KaiTi", "STKaiti", serif'
      ctx.textAlign = 'center'
      ctx.fillText(locale === 'en' ? 'Scan to revisit this room' : '扫码直达此刻房间', qrX + qrSize / 2, qrY + qrSize + 22)
    }
  }

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((b) => resolve(b), 'image/png')
  })
  const dataUrl = blob
    ? await new Promise<string>((resolve) => {
        const reader = new FileReader()
        reader.onload = () =>
          resolve(typeof reader.result === 'string' ? reader.result : canvas.toDataURL('image/png'))
        reader.onerror = () => resolve(canvas.toDataURL('image/png'))
        reader.readAsDataURL(blob)
      })
    : canvas.toDataURL('image/png')

  return { dataUrl, blob, width: CARD_W, height: CARD_H }
}
