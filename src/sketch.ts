import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three'

type Kind = 'brick' | 'roof' | 'wood' | 'wall' | 'stone' | 'grass' | 'paper'
const cache = new Map<string, CanvasTexture>()

function random(seed: number) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

export function sketchTexture(kind: Kind): CanvasTexture {
  const existing = cache.get(kind)
  if (existing) return existing
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 512
  const c = canvas.getContext('2d')!
  const r = random(93 + kind.length)
  const colors: Record<Kind, string> = { brick: '#c49b77', roof: '#687c78', wood: '#eee4ce', wall: '#fcfbf8', stone: '#d2cebf', grass: '#81925d', paper: '#fffefa' }
  c.fillStyle = colors[kind]; c.fillRect(0, 0, 512, 512)
  function line(x: number, y: number, ex: number, ey: number, alpha = .33) {
    c.strokeStyle = `rgba(51,58,47,${alpha})`; c.lineWidth = .7 + r() * .8
    c.beginPath(); c.moveTo(x, y); c.lineTo((x + ex) / 2 + r() * 2 - 1, (y + ey) / 2 + r() * 2 - 1); c.lineTo(ex, ey); c.stroke()
  }
  if (kind === 'brick') {
    for (let y = 0; y < 512; y += 32) {
      line(0, y, 512, y, .6); line(0, y + 3, 512, y + 3, .18)
      for (let x = (y % 64 ? -48 : 0); x < 512; x += 96) {
        c.fillStyle = `rgba(255,246,217,${r() * .12})`; c.fillRect(x + 3, y + 5, 88, 23)
        line(x, y, x, y + 32, .5)
        for (let i = 0; i < 3; i++) { const px = x + r() * 80, py = y + r() * 25; line(px, py, px + 9, py - 3, .16) }
      }
    }
  } else if (kind === 'wood') {
    for (let x = 0; x <= 512; x += 64) {
      line(x, 0, x, 512, .55)
      for (let y = (x % 128 ? 120 : 0); y < 512; y += 256) line(x, y, x + 64, y, .45)
      for (let i = 0; i < 8; i++) { const y = r() * 512, px = x + 8 + r() * 40; line(px, y, px + r() * 4, y + 25 + r() * 80, .12) }
    }
  } else if (kind === 'roof') {
    for (let y = 0; y < 512; y += 48) {
      line(0, y, 512, y, .5)
      for (let x = y % 96 ? -42 : 0; x < 512; x += 85) {
        line(x, y, x + 5, y + 48, .55); line(x + 6, y + 5, x + 11, y + 40, .22)
      }
    }
  } else if (kind === 'stone') {
    for (let i = 0; i < 32; i++) {
      const x = r() * 512, y = r() * 512
      line(x, y, x + 30, y - 15, .25); line(x + 30, y - 15, x + 48, y + 8, .2)
    }
  } else if (kind === 'wall') {
    for (let i = 0; i < 12; i++) {
      const x = r() * 512, y = r() * 512
      c.fillStyle = `rgba(140,136,125,${.015 + r() * .022})`; c.fillRect(x, y, 12 + r() * 45, 20 + r() * 50)
    }
  } else if (kind === 'grass') {
    for (let i = 0; i < 800; i++) { const x = r() * 512, y = r() * 512; line(x, y, x - 3, y - 7, .12); line(x, y, x + 3, y - 9, .12) }
  }
  for (let i = 0; i < 9000; i++) {
    c.fillStyle = r() > .5 ? `rgba(255,255,255,${r() * .11})` : `rgba(63,57,42,${r() * .045})`
    c.fillRect(r() * 512, r() * 512, 1, 1)
  }
  const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace
  t.wrapS = t.wrapT = RepeatWrapping
  t.anisotropy = 4
  cache.set(kind, t)
  return t
}

export function signTexture(text: string, sub = '', color = '#fdfbf5') {
  const key = `${text}:${sub}:${color}`
  const existing = cache.get(key)
  if (existing) return existing
  const canvas = document.createElement('canvas'); canvas.width = 768; canvas.height = 256
  const c = canvas.getContext('2d')!
  c.fillStyle = color; c.fillRect(0, 0, 768, 256)
  c.strokeStyle = '#484d41'; c.lineWidth = 3
  c.strokeRect(9, 11, 750, 234); c.lineWidth = 1; c.strokeRect(16, 17, 736, 222)
  c.fillStyle = '#343b32'; c.textAlign = 'center'; c.textBaseline = 'middle'
  c.font = 'bold 108px HomeHand, KaiTi, STKaiti, "Microsoft YaHei", serif'; c.fillText(text, 384, sub ? 99 : 130, 690)
  if (sub) { c.font = '32px "Microsoft YaHei", sans-serif'; c.fillStyle = '#434d3b'; c.fillText(sub, 384, 190, 690) }
  const t = new CanvasTexture(canvas); t.colorSpace = SRGBColorSpace; cache.set(key, t)
  return t
}

export function tiledTexture(kind: Kind, x: number, y: number) {
  const key = `${kind}:${x}:${y}`
  if (!cache.has(key)) { const texture = sketchTexture(kind).clone(); texture.repeat.set(x, y); texture.needsUpdate = true; cache.set(key, texture) }
  return cache.get(key)!
}

export function artSvg(kind: 'mountain' | 'plant' | 'house') {
  const common = '<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900"><rect width="720" height="900" fill="#eee8d9"/><filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope=".09"/></feComponentTransfer></filter>'
  const drawing = kind === 'mountain' ? '<circle cx="510" cy="230" r="75" fill="#c99a62"/><path d="M0 600 235 260 460 600 620 380 720 590V900H0" fill="#819285"/><path d="m0 740 310-360 260 320 150-120v320H0" fill="#506d66"/><path d="m30 590 205-330 225 340M135 435l100-175 100 176-70-33-30 38-35-33z" fill="none" stroke="#354e46" stroke-width="3"/><path d="M290 900q180-140 170-245t90-100" fill="none" stroke="#e5d6b6" stroke-width="35"/><path d="M35 816h100m380-55h140M64 700h80" stroke="#b4c0aa" stroke-width="3"/>' : kind === 'plant' ? '<path d="M0 150h720M160 0v900M560 0v900M0 550h720" stroke="#bcb4a0" stroke-width="7"/><path d="m410 570 210-230v330" fill="#e5c88e" opacity=".6"/><path d="m265 615 35 190h140l35-190z" fill="#b97658" stroke="#6b5545" stroke-width="4"/><path d="M370 620V335m0 200-100-110m100 60 100-110" fill="none" stroke="#4b6951" stroke-width="9"/><path d="M363 460q-160-10-130-130 150 0 130 130m18-50q130 0 120-115-140 0-120 115m-14-60q-95-110 15-175 80 110-15 175" fill="#718c65" stroke="#4f6852" stroke-width="3"/><path d="M236 630q137 26 262-3" fill="none" stroke="#6b5545" stroke-width="4"/>' : '<path d="M0 630q200-130 380-40t340-20v330H0" fill="#a4ae8b"/><path d="m215 460 145-125 145 125v220H215z" fill="#d4ad8b" stroke="#4c5b4b" stroke-width="4"/><path d="m180 465 180-160 180 160z" fill="#607b72" stroke="#4c5b4b" stroke-width="4"/><path d="M325 680V535h80v145M245 495h55v60h-55m175-60h55v60h-55" fill="#eee3be" stroke="#4c5b4b" stroke-width="4"/><path d="M330 900q-50-100 35-220" fill="none" stroke="#e8d8b6" stroke-width="74"/><circle cx="540" cy="210" r="53" fill="#d8ae68"/><path d="M110 680V420m0 40-50-75m50 160 70-90" stroke="#4c5b4b" stroke-width="8"/><path d="M40 400q-40-140 100-145t65 150" fill="#7f956e" stroke="#4c5b4b" stroke-width="3"/>'
  return common + drawing + '<rect width="720" height="900" filter="url(#grain)" opacity=".7"/></svg>'
}

export function artUrl(kind: 'mountain' | 'plant' | 'house') { return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(artSvg(kind))}` }

export function artTexture(kind: 'mountain' | 'plant' | 'house') {
  const key = `art:${kind}`
  if (cache.has(key)) return cache.get(key)!
  // Draw the same composition on canvas so initial scene rendering needs no network or image decode.
  const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 450
  const c = canvas.getContext('2d')!; c.fillStyle = '#eee8d9'; c.fillRect(0, 0, 360, 450)
  const img = new Image(), t = new CanvasTexture(canvas)
  t.colorSpace = SRGBColorSpace; img.onload = () => { c.drawImage(img, 0, 0, 360, 450); t.needsUpdate = true }; img.src = artUrl(kind)
  cache.set(key, t); return t
}
