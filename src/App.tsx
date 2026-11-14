import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import gsap from 'gsap'
import { CameraController, World, doorStops, type CameraHandle } from './World'
import { articles, artworks, rooms, type Place } from './content'
import { artUrl } from './sketch'
import { layout, stopProgress, type TransitionState } from './layout'
import { loadResources, type Quality, type ResourcePack } from './resources'
import { RenderPipeline } from './RenderPipeline'

// Preserve real elapsed time on slow or background browser frames.
gsap.ticker.lagSmoothing(0)

const initialCamera = { position: [0, 1.65, 11.2] as [number, number, number], fov: 43 }

function Icon({ name, size = 22 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    home: <><path d="m3 11 9-8 9 8M5.5 9v12h13V9M10 21v-7h4v7" /><path d="M7 2v4" /></>,
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
    back: <path d="M20 12H5m5-5-5 5 5 5" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    map: <><path d="m3 5 6-2 6 2 6-2v16l-6 2-6-2-6 2zM9 3v16M15 5v16" /></>,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>,
    book: <><path d="M12 5C9 3 5 3 2 4v15c4-1 7-1 10 1 3-2 6-2 10-1V4c-3-1-7-1-10 1v15M5 8h4M5 11h4m6-3h4m-4 3h4" /></>,
    door: <><path d="M5 21V3h14v18M9 21V5l8-1v17M3 21h18" /><circle cx="14" cy="13" r=".6" /></>,
    frame: <><rect x="3" y="3" width="18" height="18" rx="1" /><path d="m5 17 5-6 4 4 2-3 3 5" /><circle cx="16" cy="8" r="1.5" /></>,
    spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z" /></>,
    motion: <><path d="M3 7h8a3 3 0 1 0-3-3M2 12h15a3 3 0 1 1-3 3M5 17h3M19 5l2-2" /></>,
    pencil: <><path d="m4 15 11-11 5 5L9 20l-6 1zM13 6l5 5M4 15l5 5" /></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.home}</svg>
}

function Modal({ open, close, label, children, className = '' }: { open: boolean; close: () => void; label: string; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const el = dialog.current!
    if (open && !el.open) el.showModal()
    else if (!open && el.open) el.close()
  }, [open])
  return <dialog ref={dialog} className={`paper-dialog ${className}`} aria-label={label} onClose={close} onClick={e => { if (e.target === e.currentTarget) close() }}>
    <button className="icon-button dialog-close" onClick={close} aria-label="关闭"><Icon name="close" /></button>
    {children}
  </dialog>
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? <div className="scene-fallback"><Icon name="home" size={60} /><p>三维小屋暂时没有打开。<br />你仍可以通过「小屋地图」浏览所有房间。</p><button onClick={() => window.location.reload()}>重新打开小屋</button></div> : this.props.children }
}

function savedName() {
  try { return localStorage.getItem('paper-home:name')?.trim().slice(0, 12) || '我的小屋' } catch { return '我的小屋' }
}
function startingPlace(): Place {
  const hash = window.location.hash.slice(1)
  return rooms.some(r => r.id === hash) ? hash as Place : 'yard'
}

export default function App() {
  const [place, setPlace] = useState<Place>(startingPlace)
  const [opening, setOpening] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [destination, setDestination] = useState<Place | null>(null)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [fontReady, setFontReady] = useState(false)
  const [pack,setPack]=useState<ResourcePack|null>(null)
  const [quality,setQuality]=useState<Quality>(()=>new URLSearchParams(location.search).get('quality')==='low'?'low':'high')
  const [loadProgress,setLoadProgress]=useState(0)
  const [preparing,setPreparing]=useState('')
  const [loadError,setLoadError]=useState('')
  const [retryTarget,setRetryTarget]=useState<Place|null>(null)
  const [retry,setRetry]=useState(0)
  const transition=useRef<TransitionState|null>(null)
  const prepare=useRef<(()=>Promise<void>)|null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [article, setArticle] = useState<number | null>(null)
  const [artwork, setArtwork] = useState<number | null>(null)
  const [galleryIndex,setGalleryIndex]=useState(1)
  const [homeName, setHomeName] = useState(savedName)
  const [nameDraft, setNameDraft] = useState(homeName)
  const [nameMessage, setNameMessage] = useState('')
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ambient, setAmbient] = useState(false)
  const camera = useRef<CameraHandle>(null)
  const progress = useRef(place==='yard'||place==='hall'?0:stopProgress(doorStops.find(d=>d.id===place)!.depth))
  const [nearby, setNearby] = useState<Place | null>(null)
  const [atEnd, setAtEnd] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const animation = useRef<gsap.core.Tween | null>(null)

  useEffect(()=>{
    let active=true;setReady(false);setLoadError('');setPreparing('')
    void loadResources(quality,v=>{if(active)setLoadProgress(v)}).then(value=>{if(active){setPack(value);setLoadProgress(1)}}).catch(()=>{if(active)setLoadError('小屋素材没有加载完成。请重试。')})
    return()=>{active=false}
  },[quality,retry])

  useEffect(() => {
    let active = true
    const finish = () => { if (active) setFontReady(true) }
    document.fonts.load('24px HomeHand').then(finish, finish)
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.title = `${homeName} · ${rooms.find(r => r.id === place)?.name}`
    history.replaceState(null, '', `#${place}`)
  }, [homeName, place])
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const listener = () => setReduced(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])
  useEffect(() => {
    if (!root.current) return
    const ctx = gsap.context(() => { gsap.from('.welcome-copy > *', { y: reduced ? 0 : 12, opacity: .3, stagger: .09, duration: .65, ease: 'power2.out' }) }, root)
    return () => ctx.revert()
  }, [place, reduced])
  useEffect(() => () => { animation.current?.kill(); document.body.style.cursor = '' }, [])

  // Ambient sound is synthesized locally and starts only after this explicit user gesture.
  useEffect(() => {
    if (!ambient) return
    const audio = new AudioContext()
    const master = audio.createGain(); master.gain.value = .04; master.connect(audio.destination)
    const length = audio.sampleRate * 2, buffer = audio.createBuffer(1, length, audio.sampleRate)
    const channel = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) { last = (last + (Math.random() * 2 - 1) * .02) / 1.02; channel[i] = last * 3.5 }
    const wind = audio.createBufferSource(); wind.buffer = buffer; wind.loop = true
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500
    wind.connect(filter); filter.connect(master); wind.start()
    const chirp = () => {
      if (document.hidden || audio.state !== 'running') return
      const osc = audio.createOscillator(), volume = audio.createGain(), now = audio.currentTime
      osc.type = 'sine'; osc.frequency.setValueAtTime(1700 + Math.random() * 900, now); osc.frequency.exponentialRampToValueAtTime(3400, now + .1); osc.frequency.exponentialRampToValueAtTime(1800, now + .25)
      volume.gain.setValueAtTime(0, now); volume.gain.linearRampToValueAtTime(.12, now + .03); volume.gain.exponentialRampToValueAtTime(.001, now + .25)
      osc.connect(volume); volume.connect(master); osc.start(); osc.stop(now + .3)
    }
    const timer = window.setInterval(chirp, 4000)
    const visibility = () => { if (document.hidden) void audio.suspend(); else void audio.resume() }
    document.addEventListener('visibilitychange', visibility)
    void audio.resume()
    return () => { clearInterval(timer); wind.stop(); void audio.close(); document.removeEventListener('visibilitychange', visibility) }
  }, [ambient])

  useLayoutEffect(() => {
    if (place !== 'hall' || !root.current) return
    const el = root.current
    const restore = () => { el.scrollTop = progress.current * Math.max(0, el.scrollHeight - el.clientHeight) }
    restore()
    const observer = new ResizeObserver(restore); observer.observe(el)
    return () => observer.disconnect()
  }, [place])

  useEffect(() => {
    if (place !== 'hall' || !root.current) return
    const el = root.current
    let touchY: number | null = null
    const blocked = (target: EventTarget | null) => busyRef.current || !!el.querySelector('dialog[open]') || (target instanceof Element && !!target.closest('button,input,dialog'))
    const wheel = (e: WheelEvent) => { if (blocked(e.target)) return; e.preventDefault(); el.scrollTop += e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? el.clientHeight : 1) }
    const start = (e: TouchEvent) => { touchY = blocked(e.target) ? null : e.touches[0]?.clientY ?? null }
    const move = (e: TouchEvent) => { if (touchY === null || blocked(e.target)) return; e.preventDefault(); const y = e.touches[0]?.clientY; if (y !== undefined) { el.scrollTop += touchY - y; touchY = y } }
    const end = () => { touchY = null }
    el.addEventListener('wheel', wheel, { passive: false }); el.addEventListener('touchstart', start, { passive: true }); el.addEventListener('touchmove', move, { passive: false }); el.addEventListener('touchend', end); el.addEventListener('touchcancel', end)
    return () => { el.removeEventListener('wheel', wheel); el.removeEventListener('touchstart', start); el.removeEventListener('touchmove', move); el.removeEventListener('touchend', end); el.removeEventListener('touchcancel', end) }
  }, [place])

  function onWalkScroll() {
    if (place !== 'hall' || busyRef.current || mapOpen) return
    const el = root.current!
    progress.current = Math.max(0, Math.min(1, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)))
    const depth = .85+progress.current * layout.walkLength
    setNearby(doorStops.find(d => Math.abs(depth - (d.depth-.6)) < .85)?.id || null)
    setAtEnd(progress.current > .98)
  }
  function step(direction: number) { const el=root.current;if(el)el.scrollBy({ top: direction*(el.scrollHeight-el.clientHeight)*layout.stepDistance/layout.walkLength, behavior: reduced ? 'instant' : 'smooth' }) }

  async function navigate(target: Place) {
    if (busyRef.current || !ready) return
    setMapOpen(false); setArticle(null); setArtwork(null); setDirectoryOpen(false)
    if (target === place) return
    const resumeProgress = place === 'hall' && nearby === target ? progress.current : null
    if (place === 'yard') progress.current = 0
    busyRef.current = true; setBusy(true); setDestination(target); setOpening(place === 'yard' ? 'hall' : place !== 'hall' ? place : target); document.body.style.cursor = ''
    try {
      transition.current={from:place,to:target,phase:'loading',progress:0}
      await loadResources(quality)
      await new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r())))
      await prepare.current?.()
      if(target!=='yard'&&target!=='hall')progress.current=stopProgress(doorStops.find(d=>d.id===target)!.depth)
      if (camera.current) await camera.current.travel(target, reduced, () => setPlace(target))
      else setPlace(target)
      title.current?.focus({ preventScroll: true })
    } catch {
      transition.current={from:place,to:target,phase:'failed',progress:0}
      setRetryTarget(target)
      setLoadError('目的地没有准备好，已留在当前房间。请重试。')
    } finally {
      if (resumeProgress !== null) progress.current = resumeProgress
      busyRef.current = false; setBusy(false); setOpening(null); setDestination(null)
      const depth = .85+progress.current * layout.walkLength
      setAtEnd(progress.current > .98)
      setNearby(doorStops.find(d => Math.abs(depth - (d.depth-.6)) < .85)?.id || null)
      requestAnimationFrame(() => { if (root.current) root.current.scrollTop = progress.current * Math.max(0, root.current.scrollHeight - root.current.clientHeight) })
    }
  }

  function interact(index: number) { if (!busyRef.current) { if (place === 'study') setArticle(index); if (place === 'gallery') {setArtwork(index);setGalleryIndex(index)} } }
  const room = rooms.find(r => r.id === place)!
  const inside = place !== 'yard' && place !== 'hall'
  const backPlace: Place = place === 'hall' ? 'yard' : 'hall'

  return <div className={`home-app place-${place} ${reduced ? 'reduced-motion' : ''} ${busy || mapOpen || article !== null || artwork !== null ? 'walking-paused' : ''} ${busy ? 'traveling' : ''}`} ref={root} onScroll={onWalkScroll} onKeyDown={e => {
      if (place !== 'hall' || busy || mapOpen || (e.target instanceof Element && e.target.closest('button,input,dialog'))) return
      if (['ArrowDown','PageDown',' ','ArrowUp','PageUp'].includes(e.key)) { e.preventDefault(); step(['ArrowUp','PageUp'].includes(e.key) ? -1 : 1) }
    }}>
    {place === 'hall' && <div className="walk-track" aria-hidden="true" />}
    <div className="world">
      <SceneBoundary onFailure={() => setReady(true)}>{fontReady && pack && <Canvas role="img" aria-label="自然白昼中的住宅与庭院，可进入走廊及三个房间" shadows="percentage" dpr={[1, 1.5]} camera={{...initialCamera,near:.05,far:200}} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} fallback={<div className="scene-fallback">小屋三维场景。使用「小屋地图」也可浏览所有房间。</div>}>
        <CameraController ref={camera} place={place} busy={busy} reduced={reduced} galleryIndex={galleryIndex} progress={progress} onTransition={value=>{transition.current=value}} />
        <World place={place} opening={opening} destination={destination} navigate={navigate} interact={interact} homeName={homeName} reduced={reduced} pack={pack} />
        <RenderPipeline quality={pack.quality} transition={transition} prepare={prepare} onPreparing={setPreparing} onReady={()=>setReady(true)}/>
      </Canvas>}</SceneBoundary>
    </div>
    <div className="paper-grain" aria-hidden="true" />
    <header className="site-header">
      <button className="brand" onClick={() => void navigate('yard')} aria-label={`${homeName}，返回小院`} disabled={busy || !ready}>
        <Icon name="home" size={31} /><span>{homeName}</span>
      </button>
      <div className="header-actions">
        <label className="quality-control"><span className="sr-only">画面质量</span><select aria-label="画面质量" value={quality} disabled={busy} onChange={e=>setQuality(e.target.value as Quality)}><option value="high">细致画质</option><option value="low">兼容画质</option></select></label>
        <button className="motion-button" onClick={() => setReduced(!reduced)} aria-label={reduced?'轻柔模式':'漫游模式'} aria-pressed={reduced} title="减少镜头移动"><Icon name="motion" size={19} /><span>{reduced ? '轻柔模式' : '漫游模式'}</span></button>
        <button className="map-button" aria-label="小屋地图" onClick={() => { setMapOpen(true); setNameDraft(homeName); setNameMessage('') }} disabled={busy || !ready}><Icon name="map" size={19} /><span>小屋地图</span></button>
      </div>
    </header>

    <main>
      <div className="welcome-copy" key={place}>
        {place === 'yard' ? <>
          <h1 ref={title} tabIndex={-1}>来家里坐坐。</h1>
          <p>推开门，里面是我的日常与收藏。</p>

        </> : <>
          <h1 ref={title} tabIndex={-1}>{room.name}</h1>
          <p>{place === 'hall' ? <>向上滑动，往家里走。<br />反向滑动可以退回来。</> : place === 'study' ? <>翻开一本书，<br />把时间留给自己。</> : place === 'gallery' ? <>点一下悬挂的纸张，展开收藏。</> : <>这里还很空，<br />刚好装下新的可能。</>}</p>
        </>}
      </div>

      {inside && (place !== 'gallery' || directoryOpen) && <aside id="room-directory" className="room-content" aria-label={`${room.name}的内容`}>
        {place === 'study' && <>
          <h2>桌上的几页文字</h2>
          <div className="article-list">{articles.map((item, i) => <button key={item.title} onClick={() => setArticle(i)}><span>{item.title}</span><Icon name="arrow" size={19} /></button>)}</div>
          <p className="content-note">先读一篇小屋随笔，<br />以后换上你的故事。</p>
        </>}
        {place === 'gallery' && <>
          <div className="directory-heading"><h2>小屋的示例收藏</h2><button className="icon-button" aria-label="收起收藏目录" onClick={() => setDirectoryOpen(false)}><Icon name="close" size={18} /></button></div>
          <div className="art-list">{artworks.map((item, i) => <button key={item.kind} onClick={() => interact(i)}><img src={artUrl(item.kind)} alt="" /><span>{item.title}</span><Icon name="arrow" size={17} /></button>)}</div>
          <p className="content-note">点开一幅，慢慢看。<br />这三幅画是小屋的示例收藏。</p>
        </>}
        {place === 'blank' && <>
          <Icon name="spark" size={32} /><h2>还没想好，也很好。</h2>
          <p className="blank-note">这里可以是一间相册、<br />一个收藏室，或一个新点子。<br />等你有了想法，再来布置。</p>
          <button className="text-link" onClick={() => void navigate('hall')}>再去别处逛逛<Icon name="arrow" size={18} /></button>
        </>}
      </aside>}

      {place==='gallery'&&!directoryOpen&&<div className="gallery-viewer" role="group" aria-label="逐幅浏览收藏">
        <button aria-label="上一幅作品" disabled={busy||galleryIndex===0} onClick={()=>setGalleryIndex(i=>Math.max(0,i-1))}><Icon name="back" size={20}/></button>
        <button className="gallery-current" onClick={()=>setArtwork(galleryIndex)} disabled={busy} aria-label={`展开《${artworks[galleryIndex].title}》`}><span aria-live="polite">{artworks[galleryIndex].title}<small>{galleryIndex+1} / {artworks.length}</small></span><Icon name="frame" size={18}/></button>
        <button aria-label="下一幅作品" disabled={busy||galleryIndex===artworks.length-1} onClick={()=>setGalleryIndex(i=>Math.min(artworks.length-1,i+1))}><Icon name="arrow" size={20}/></button>
      </div>}
      <nav className={`journey-nav ${place === 'yard' ? 'yard-nav' : ''}`} aria-label="房间导航">
        {place === 'yard' ? <button className="enter-button" onClick={() => void navigate('hall')} disabled={busy || !ready}><span>{busy ? '门开了，进来吧…' : '敲敲门，进来坐坐'}</span><Icon name="arrow" /></button> : <>
          <button className="back-button" onClick={() => void navigate(backPlace)} disabled={busy || !ready}><Icon name="back" size={19} /><span>{place === 'hall' ? '回到小院' : '返回走廊'}</span></button>
          {place === 'gallery' && <button className="directory-toggle" aria-expanded={directoryOpen} aria-controls="room-directory" onClick={() => setDirectoryOpen(!directoryOpen)}><Icon name="frame" size={18} />收藏目录</button>}
          {place === 'hall' && <div className="walk-actions">
            <div className="walk-steps"><button onClick={() => step(-1)} disabled={busy || !ready} aria-label="后退一段"><Icon name="back" size={18} /></button><button onClick={() => step(1)} disabled={busy || !ready || atEnd} aria-label="前进一段"><Icon name="arrow" size={18} /></button></div>
            {nearby && <button className="near-door" onClick={() => void navigate(nearby)} disabled={busy || !ready}>进入{rooms.find(r => r.id === nearby)?.name}<Icon name="arrow" size={19} /></button>}
            {!nearby && <span className="walk-hint">{atEnd ? '走到家的深处了，可以慢慢往回逛' : '滚动或上滑，继续往里走'}</span>}
          </div>}
        </>}
      </nav>
      {!ready && !loadError && <div className="loading-note" role="status">{preparing||`正在准备小屋与庭院… ${Math.round(loadProgress*100)}%`}</div>}
      {loadError && <div className="load-error" role="alert"><p>{loadError}</p><button onClick={()=>{setLoadError('');if(retryTarget){const target=retryTarget;setRetryTarget(null);void navigate(target)}else setRetry(v=>v+1)}}>重新加载</button></div>}
    </main>

    <footer className="site-footer">
      <div className="place-indicator"><Icon name={place === 'yard' ? 'sun' : room.icon} size={18} /><span>{place === 'yard' ? '门外，是个晴天' : `你在${room.name}`}</span></div>
      <div className="footer-right"><span className="interaction-hint">{place === 'yard' ? '点一下门，故事就开始了' : place === 'hall' ? '沿走廊走走，遇见一扇喜欢的门' : '在这里，待一会儿也没关系'}</span><button className={`ambient-button ${ambient ? 'active' : ''}`} aria-label={ambient ? '关闭环境声' : '开启环境声'} aria-pressed={ambient} onClick={() => setAmbient(!ambient)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 9h4l5-4v14l-5-4H4z" />{ambient ? <path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" /> : <path d="m17 9 5 6m-5 0 5-6" />}</svg></button></div>
    </footer>
    <p className="sr-only" role="status" aria-live="polite">{busy ? `正在前往${rooms.find(r => r.id === destination)?.name || '下一个房间'}` : `已来到${room.name}`}</p>

    <Modal open={mapOpen} close={() => setMapOpen(false)} label="小屋地图" className="map-dialog">
      <h2>小屋地图</h2><p className="dialog-intro">想去哪儿，推门就好。</p>
      <div className="floor-plan">{rooms.map(r => <button key={r.id} className={`plan-${r.id} ${place === r.id ? 'current' : ''}`} onClick={() => void navigate(r.id)} aria-current={place === r.id ? 'location' : undefined}><Icon name={r.icon} size={27} /><strong>{r.name}</strong><span>{place === r.id ? '你在这里' : r.note}</span></button>)}</div>
      <form className="name-form" onSubmit={e => { e.preventDefault(); const value = nameDraft.trim().slice(0, 12); if (!value) { setNameMessage('先为小屋写一个名字吧。'); return }; setHomeName(value); try { localStorage.setItem('paper-home:name', value); setNameMessage('小屋的名字记住了。') } catch { setNameMessage('名字已更新；当前浏览器无法保存，下次打开会恢复默认。') } }}>
        <label htmlFor="home-name"><Icon name="pencil" size={17} />给小屋起个名字</label>
        <div><input id="home-name" maxLength={12} value={nameDraft} onChange={e => { setNameDraft(e.target.value); setNameMessage('') }} placeholder="最多 12 个字" /><button type="submit">记住</button></div>
        <p className="name-message" role="status">{nameMessage || '名字会保存在这台设备的浏览器里。'}</p>
      </form>
    </Modal>

    <Modal open={article !== null} close={() => setArticle(null)} label={article !== null ? articles[article].title : '小屋随笔'} className="reading-dialog">
      {article !== null && <article><Icon name="book" size={29} /><h2>{articles[article].title}</h2><p className="article-subtitle">{articles[article].subtitle}</p>{articles[article].paragraphs.map(p => <p key={p}>{p}</p>)}<div className="reading-end" aria-hidden="true"><span />一页日常<span /></div></article>}
    </Modal>
    <Modal open={artwork !== null} close={() => setArtwork(null)} label={artwork !== null ? artworks[artwork].title : '画作'} className="art-dialog">
      {artwork !== null && <><figure><img src={artUrl(artworks[artwork].kind)} alt={`${artworks[artwork].title}，小屋原创示例插画`} /><figcaption><h2>{artworks[artwork].title}</h2><p>{artworks[artwork].caption}</p><span>小屋的示例收藏</span></figcaption></figure><nav className="art-pagination" aria-label="切换画作"><button aria-label="上一幅画作" disabled={artwork===0} onClick={()=>{setArtwork(artwork-1);setGalleryIndex(artwork-1)}}><Icon name="back" size={18}/>上一幅</button><span aria-live="polite">{artwork+1} / {artworks.length}</span><button aria-label="下一幅画作" disabled={artwork===artworks.length-1} onClick={()=>{setArtwork(artwork+1);setGalleryIndex(artwork+1)}}>下一幅<Icon name="arrow" size={18}/></button></nav></>}
    </Modal>
  </div>
}
