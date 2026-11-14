import { CanvasTexture, SRGBColorSpace } from 'three'

type Drawing = 'door-entry' | 'door-gallery' | 'door-study' | 'door-blank' | 'skyline' | 'botanical' | 'arrow' | 'cloud'
const textures = new Map<string, CanvasTexture>()
function surface(key: string, width: number, height: number, draw: (c: CanvasRenderingContext2D) => void) {
  if (textures.has(key)) return textures.get(key)!
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const c = canvas.getContext('2d')!; c.strokeStyle = '#353632'; c.lineWidth = 2.2; c.lineCap = 'round'; c.lineJoin = 'round'
  draw(c)
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace; texture.anisotropy = 4
  textures.set(key, texture); return texture
}
const path = (c: CanvasRenderingContext2D, points: number[][]) => {
  c.beginPath(); points.forEach(([x,y],i) => i ? c.lineTo(x,y) : c.moveTo(x,y)); c.stroke()
}
function outlined(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  path(c, [[x,y],[x+w,y+1],[x+w-1,y+h],[x+1,y+h+1],[x,y]])
  c.save(); c.globalAlpha = .35; c.lineWidth = 1; path(c,[[x+3,y-2],[x+w+2,y],[x+w+3,y+h-2]]); c.restore()
}
function label(c: CanvasRenderingContext2D, text: string, x: number, y: number, size = 36) {
  c.fillStyle = '#33342e'; c.font = `${size}px HomeHand, KaiTi, serif`; c.textAlign = 'center'; c.fillText(text,x,y)
}
export function inkTexture(kind: Drawing) {
  const w = kind === 'skyline' ? 2048 : 768, h = kind === 'skyline' ? 512 : 1024
  return surface(kind,w,h,c => {
    if (kind === 'skyline') {
      c.strokeStyle = '#96968b'; c.lineWidth = 1.1
      c.fillStyle = '#f5f4ef'
      path(c, [[0,479],[2048,479]])
      for(let i=0;i<42;i++) {
        const x=i*50, bh=35+(Math.sin(i*3.27)+1)*54, top=475-bh
        c.fillRect(x,top,44,bh); outlined(c,x,top,44,bh)
        if(i%3===0) path(c,[[x-4,top],[x+22,top-22],[x+49,top]])
        for(let wy=top+10;wy<465;wy+=17) for(let wx=x+8;wx<x+40;wx+=13) {c.globalAlpha=.38; outlined(c,wx,wy,5,8); c.globalAlpha=1}
      }
      c.fillStyle='#efeee8'; c.fillRect(815,128,62,347); outlined(c,815,128,62,347)
      path(c,[[827,128],[827,107],[865,107],[865,128],[846,107],[846,54]])
      for(let y=146;y<460;y+=15) path(c,[[824,y],[868,y+1]])
      path(c,[[1270,475],[1302,208],[1334,475],[1270,475],[1318,343],[1286,343],[1328,418],[1278,418],[1302,208],[1302,166]])
      return
    }
    if(kind==='cloud') {
      c.lineWidth=4
      c.beginPath(); c.moveTo(90,612); c.bezierCurveTo(12,592,42,485,142,489); c.bezierCurveTo(130,367,304,340,358,448); c.bezierCurveTo(423,298,602,389,582,481); c.bezierCurveTo(724,427,766,592,638,611); c.closePath(); c.fillStyle='#fbfaf6'; c.fill(); c.stroke()
      c.globalAlpha=.25; path(c,[[76,624],[216,628],[414,624],[620,627]]); return
    }
    if(kind==='arrow') {
      c.lineWidth=3; c.beginPath(); c.moveTo(100,410); c.bezierCurveTo(262,397,322,493,603,548); c.stroke(); path(c,[[550,484],[613,550],[526,552]]); return
    }
    if(kind==='botanical') {
      c.lineWidth=2.5; path(c,[[388,936],[391,698],[378,504],[402,267],[396,125]])
      for(let i=0;i<11;i++) {
        const y=210+i*58, side=i%2?1:-1, x=390+Math.sin(i)*10
        c.beginPath(); c.moveTo(x,y+80); c.bezierCurveTo(x+side*145,y+30,x+side*162,y-47,x+side*104,y-86); c.bezierCurveTo(x+side*27,y-60,x+side*12,y+35,x,y+80); c.stroke()
        path(c,[[x,y+80],[x+side*105,y-80]])
      }
      return
    }
    if(kind==='door-entry') {
      c.fillStyle='#814d3d';c.fillRect(0,0,768,1024);c.strokeStyle='#3c362b';c.lineWidth=3
      outlined(c,18,17,732,990);outlined(c,40,38,687,944)
      c.strokeStyle='#b7966d';outlined(c,79,82,605,556);outlined(c,79,685,605,253)
      c.save();c.translate(386,350);c.rotate(-.055);c.fillStyle='#f9f5e7';c.fillRect(-180,-195,360,390);c.strokeStyle='#3d3c33';outlined(c,-180,-195,360,390)
      label(c,'你好，',0,-89,66);label(c,'远道而来的朋友',0,-13,34)
      path(c,[[-70,117],[-70,55],[0,-8],[70,55],[70,117],[-70,117],[-15,117],[-15,70],[17,70],[17,117]])
      c.restore();c.fillStyle='#e5d1a0';c.font='48px HomeHand,KaiTi,serif';c.textAlign='center';c.fillText('请进',384,836)
      c.lineWidth=1;c.globalAlpha=.25
      for(let i=0;i<22;i++)path(c,[[112+i*25,700],[117+i*25,921]])
      return
    }
    c.fillStyle = kind==='door-gallery' ? '#f8f6ed' : kind==='door-study' ? '#eee5d0' : '#f8f7f1'; c.fillRect(0,0,768,1024)
    outlined(c,25,22,718,978); outlined(c,46,44,675,936)
    if(kind==='door-gallery') {
      outlined(c,108,100,534,614)
      c.save(); c.translate(380,382); c.rotate(-.07)
      c.fillStyle='#fdfcf6'; c.fillRect(-184,-218,368,436); outlined(c,-184,-218,368,436)
      c.fillStyle='#7e9782'; c.fillRect(-153,-183,306,207)
      c.fillStyle='#e4cd91'; c.beginPath(); c.arc(55,-119,32,0,Math.PI*2); c.fill()
      c.fillStyle='#dbe2d6'; c.beginPath(); c.moveTo(-153,24); c.lineTo(-51,-108); c.lineTo(40,3); c.lineTo(102,-71); c.lineTo(153,24); c.fill()
      path(c,[[-153,24],[-51,-108],[40,3],[102,-71],[153,24]])
      label(c,'一些喜欢的瞬间',0,98,34); label(c,'把日常挂起来',0,151,24); c.restore()
      c.fillStyle='#b65242'; c.save(); c.translate(572,210); c.rotate(.15); c.fillRect(-55,-43,110,86); c.strokeRect(-55,-43,110,86); c.fillStyle='#fff9ef'; c.font='32px HomeHand,serif'; c.fillText('收藏',-32,10); c.restore()
      label(c,'推门，去看一看',384,841,42)
      path(c,[[212,884],[553,887],[518,870],[553,887],[521,899]])
    } else if(kind==='door-study') {
      for(let i=0;i<3;i++) {
        c.save(); c.translate(384,235+i*223); c.rotate([-.06,.055,-.025][i]); c.fillStyle='#fffdf7'; c.fillRect(-217,-94,434,188); outlined(c,-217,-94,434,188)
        label(c,['一页文字','几句随想','慢慢写，慢慢读'][i],0,-22,39)
        for(let j=0;j<4;j++) {c.globalAlpha=.35;path(c,[[-174,8+j*22],[155-(j%2)*38,7+j*22]])}; c.globalAlpha=1; c.restore()
      }
      label(c,'有空，读一会儿',384,900,35)
    } else {
      outlined(c,112,126,536,598); c.save(); c.translate(389,430); c.rotate(-.08); outlined(c,-140,-175,280,350); label(c,'还没想好',0,-13,45); label(c,'也很好',0,51,43); c.restore(); label(c,'留给下一次灵感',384,854,38)
    }
    // Small pencil hatching follows the door edges rather than covering the paper.
    c.lineWidth=1; c.globalAlpha=.25
    for(let i=0;i<28;i++) {const y=68+i*32;path(c,[[53,y+13],[72,y-3]]);path(c,[[693,y+16],[713,y]])}
  })
}
export function welcomeTexture(name: string) {
  return surface(`welcome:${name}`,1536,640,c=>{
    c.textAlign='center'; c.textBaseline='middle'; c.font='146px HomeHand, KaiTi, serif'; c.lineWidth=12
    c.strokeText(name,768,247,1100); c.fillStyle='#fcfbf7'; c.fillText(name,768,247,1100)
    c.font='54px HomeHand, KaiTi, serif'; c.fillStyle='#42453b'; c.fillText('欢迎，来家里坐坐。',768,409)
    c.lineWidth=1.6; path(c,[[653,498],[874,498],[856,483],[874,498],[856,513]])
    c.beginPath(); c.arc(1230,125,20,0,Math.PI*2); c.stroke(); path(c,[[204,377],[220,358],[240,374],[225,391],[204,377]])
  })
}
export function paperTexture(title: string, caption: string) {
  return surface(`paper:${title}`,768,1024,c=>{
    c.fillStyle='#fffefa'; c.fillRect(0,0,768,1024); outlined(c,12,12,744,999)
    label(c,title,384,115,53); label(c,caption,384,868,29); label(c,'小屋的示例收藏 · 点击展开',384,934,25)
    c.globalAlpha=.45;path(c,[[38,1004],[216,1006],[381,1003],[712,1006]])
  })
}
