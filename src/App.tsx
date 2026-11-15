import {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import gsap from 'gsap'
import { CameraController, World, doorStops, type CameraHandle } from './World'
import type { PromoCameraWaypoint } from './Camera'
import {
  ATMOSPHERE_OPTIONS,
  DEFAULT_NOW_NOTES,
  DEFAULT_STUDY_QUOTES,
  getAtmosphereLighting,
  isValidAtmosphereMode,
  isValidWeatherMode,
  resolveAtmospherePreset,
} from './atmosphere'
import { rooms, type Place } from './content'
import { qaEnabled } from './diagnostics'
import { layout, roomPoint, stopProgress, type FocusSubPoseId, type TransitionState } from './layout'
import { clearResourcePacks, disposeResourcePack, loadResources, type Quality, type ResourcePack } from './resources'
import { resolveInitialQuality, saveQualityPreference } from './lib/quality'
import { RenderPipeline } from './RenderPipeline'
import {
  cleanupMediaAssetsApi,
  fetchAdminCottage,
  fetchPublicCottage,
  initLocalSampleApi,
  reorderNotesApi,
  reorderProjectsApi,
  saveSiteSettingsApi,
  signOutAdmin,
} from './lib/api'
import { isLocalOwnerActive, resolveBackendHealth } from './lib/backend'
import { buildDeepLinkHash, buildDeepLinkUrl, parseDeepLinkHash } from './lib/deeplink'
import { clearSignedUrlCache, evictSignedUrl, getCachedUrl, refreshSignedUrl, seedSignedUrls } from './lib/media'
import {
  installGlobalClickSoundDelegator,
  isSfxEnabled,
  playSound,
  setAcousticSpace,
  setSfxEnabled as persistSfxEnabled,
  type SoundEffectId,
} from './lib/sound'
import { getSupabaseClient, isCloudConfigured } from './lib/supabase'
import {
  ApiError,
  ConflictError,
  DEFAULT_SITE_SETTINGS,
  type AdminCottageData,
  type AdminNote,
  type AdminProfile,
  type AdminProject,
  type AtmosphereMode,
  type GalleryDisplayItem,
  type LocalStudioHealth,
  type MediaAsset,
  type NotePayload,
  type ProjectPayload,
  type PublicCottageData,
  type SiteSettingsPayload,
  type WeatherMode,
} from './types/content'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { AdminAuthPanel } from './components/AdminAuthPanel'
import { RoomDirectory } from './components/RoomDirectory'
import type { LinkedNoteRef } from './components/ProjectDetailModal'
import type { LinkedProjectRef } from './components/NoteDetailModal'
import type { SaveActionKind } from './components/ProjectEditorModal'
import type { ConflictContext } from './components/ConflictDialog'
import { ToastHost, type ToastItem } from './components/ToastHost'

const ProjectDetailModal = lazy(() =>
  import('./components/ProjectDetailModal').then((m) => ({ default: m.ProjectDetailModal })),
)
const NoteDetailModal = lazy(() =>
  import('./components/NoteDetailModal').then((m) => ({ default: m.NoteDetailModal })),
)
const ProjectEditorModal = lazy(() =>
  import('./components/ProjectEditorModal').then((m) => ({ default: m.ProjectEditorModal })),
)
const NoteEditorModal = lazy(() =>
  import('./components/NoteEditorModal').then((m) => ({ default: m.NoteEditorModal })),
)
const PostcardModal = lazy(() =>
  import('./components/PostcardModal').then((m) => ({ default: m.PostcardModal })),
)
const ProfileEditorModal = lazy(() =>
  import('./components/ProfileEditorModal').then((m) => ({ default: m.ProfileEditorModal })),
)
const ConflictDialog = lazy(() =>
  import('./components/ConflictDialog').then((m) => ({ default: m.ConflictDialog })),
)

function useEverTrue(active: boolean): boolean {
  const [ever, setEver] = useState(active)
  useEffect(() => {
    if (active) setEver(true)
  }, [active])
  return active || ever
}

function handleMenuArrowNavigation(container: HTMLElement | null, e: ReactKeyboardEvent) {
  if (!container) return
  if (
    e.key !== 'ArrowDown' &&
    e.key !== 'ArrowRight' &&
    e.key !== 'ArrowUp' &&
    e.key !== 'ArrowLeft' &&
    e.key !== 'Home' &&
    e.key !== 'End'
  ) {
    return
  }
  const items = Array.from(container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
  if (items.length === 0) return
  e.preventDefault()
  const currentIdx = items.indexOf(document.activeElement as HTMLButtonElement)
  if (e.key === 'Home') {
    items[0]?.focus()
    return
  }
  if (e.key === 'End') {
    items[items.length - 1]?.focus()
    return
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
    items[(currentIdx + 1 + items.length) % items.length]?.focus()
    return
  }
  const base = currentIdx >= 0 ? currentIdx : 0
  items[(base - 1 + items.length) % items.length]?.focus()
}

// Preserve real elapsed time on slow or background browser frames.
gsap.ticker.lagSmoothing(0)

const initialCamera = { position: [0, 1.65, 11.2] as [number, number, number], fov: 43 }
const emptyPublicData: PublicCottageData = { projects: [], notes: [], profile: null, signedUrls: {} }

type ViewingProjectState = {
  project: ProjectPayload & { id: string; publishedAt?: string | null }
  scope: 'public' | 'admin'
  isPreview: boolean
  publicIndex: number | null
  adminItem?: AdminProject
}

type ViewingNoteState = {
  note: NotePayload & { id: string; publishedAt?: string | null }
  scope: 'public' | 'admin'
  isPreview: boolean
  publicIndex: number | null
  adminItem?: AdminNote
}

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() {
    return this.state.failed ? (
      <div className="scene-fallback">
        <Icon name="home" size={60} />
        <p>三维小屋暂时没有打开。<br />你仍可以通过「小屋地图」浏览所有房间。</p>
        <button type="button" onClick={() => window.location.reload()}>重新打开小屋</button>
      </div>
    ) : this.props.children
  }
}

function savedName() {
  try { return localStorage.getItem('paper-home:name')?.trim().slice(0, 12) || '我的小屋' } catch { return '我的小屋' }
}

function initialAtmosphereMode(): AtmosphereMode {
  const dl = parseDeepLinkHash()
  if (dl.at) return dl.at
  try {
    const saved = localStorage.getItem('paper-home:atmosphere')
    if (isValidAtmosphereMode(saved)) return saved
  } catch {
    // Ignore storage restriction
  }
  return 'daylight'
}

function initialWeatherMode(): WeatherMode {
  const dl = parseDeepLinkHash()
  if (dl.weather) return dl.weather
  try {
    const saved = localStorage.getItem('paper-home:weather')
    if (isValidWeatherMode(saved)) return saved
  } catch {
    // Ignore storage restriction
  }
  return 'clear'
}

interface GuestStampEntry {
  id: string
  mood: string
  message: string
  createdAt: string
}

const STAMP_MOODS = [
  { id: '☀️ 晴日来访', reply: '谢谢你在晴天推门进来，愿你今天也有好心情。' },
  { id: '🌧️ 听雨路过', reply: '屋檐下的雨声留给你，累了随时来坐坐。' },
  { id: '🕯️ 夜灯共鸣', reply: '深夜亮着的那盏绿台灯，很高兴被你看见。' },
  { id: '🌱 留下一颗松果', reply: '已收进木匣里，下次来小院一起看树长大。' },
]

function loadGuestStamps(): GuestStampEntry[] {
  try {
    const raw = localStorage.getItem('paper-home:guestbook')
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.slice(0, 12) : []
  } catch {
    return []
  }
}

const ATMO_SOUND_MAP: Record<AtmosphereMode, SoundEffectId> = {
  dawn: 'atmo-dawn',
  daylight: 'atmo-daylight',
  golden: 'atmo-golden',
  night: 'atmo-night',
  auto: 'atmo-auto',
}

function startingPlace(): Place {
  return parseDeepLinkHash().room
}

type PromoBridge = {
  enterManual: () => void
  exitManual: () => void
  renderFlush: (dtSec: number) => void
  renderAndUpload: (dtSec: number, uploadUrl: string) => Promise<{ width: number; height: number }>
}

function PromoRenderBridge({ bridgeRef }: { bridgeRef: React.MutableRefObject<PromoBridge | null> }) {
  const { gl, setFrameloop, advance, clock } = useThree()
  useEffect(() => {
    let simSec = clock.elapsedTime
    let pixelBuf: Uint8Array | null = null
    let active = false
    bridgeRef.current = {
      enterManual: () => {
        active = true
        setFrameloop('never')
        gl.shadowMap.autoUpdate = true
        simSec = clock.elapsedTime
      },
      exitManual: () => {
        active = false
        gl.shadowMap.autoUpdate = false
        gl.shadowMap.needsUpdate = true
        setFrameloop('always')
      },
      renderFlush: (dtSec: number) => {
        if (!active) return
        simSec += Math.max(0, dtSec)
        advance(simSec)
      },
      renderAndUpload: async (dtSec: number, uploadUrl: string) => {
        if (!active) {
          active = true
          setFrameloop('never')
          gl.shadowMap.autoUpdate = true
          simSec = clock.elapsedTime
        }
        simSec += Math.max(0, dtSec)
        advance(simSec)
        const ctx = gl.getContext()
        const w = ctx.drawingBufferWidth
        const h = ctx.drawingBufferHeight
        const needed = w * h * 4
        if (!pixelBuf || pixelBuf.length !== needed) {
          pixelBuf = new Uint8Array(needed)
        }
        ctx.readPixels(0, 0, w, h, ctx.RGBA, ctx.UNSIGNED_BYTE, pixelBuf)
        const resp = await fetch(uploadUrl, {
          method: 'POST',
          body: pixelBuf as unknown as BodyInit,
        })
        if (!resp.ok) {
          throw new Error(`Promo frame upload failed (${resp.status})`)
        }
        return { width: w, height: h }
      },
    }
    return () => {
      bridgeRef.current = null
      pixelBuf = null
    }
  }, [gl, setFrameloop, advance, clock, bridgeRef])
  return null
}

export default function App() {
  const promoMode = useMemo(
    () => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('promo') === '1',
    [],
  )
  const initialDeepLink = useMemo(() => parseDeepLinkHash(), [])
  const richHashActiveRef = useRef(initialDeepLink.isRich)
  const pendingDeepLinkItemRef = useRef<string | null>(initialDeepLink.item)
  const [place, setPlace] = useState<Place>(startingPlace)
  const [opening, setOpening] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [destination, setDestination] = useState<Place | null>(null)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [fontReady, setFontReady] = useState(false)
  const [pack, setPack] = useState<ResourcePack | null>(null)
  const [quality, setQuality] = useState<Quality>(resolveInitialQuality)
  const [loadProgress, setLoadProgress] = useState(0)
  const [preparing, setPreparing] = useState('')
  const [loadError, setLoadError] = useState('')
  const [contextLost, setContextLost] = useState(false)
  const [canvasKey, setCanvasKey] = useState(0)
  const [retryTarget, setRetryTarget] = useState<Place | null>(null)
  const [retry, setRetry] = useState(0)
  const prevPackRef = useRef<ResourcePack | null>(null)
  const canvasCleanupRef = useRef<(() => void) | null>(null)
  const loseContextForQaRef = useRef<(() => boolean) | null>(null)
  const transition = useRef<TransitionState | null>(null)
  const prepare = useRef<(() => Promise<void>) | null>(null)
  const captureCanvas = useRef<(() => string | null) | null>(null)
  const promoBridgeRef = useRef<PromoBridge | null>(null)
  const promoFrontDoorProgressRef = useRef<number | null>(null)

  const [mapOpen, setMapOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [siteSettings, setSiteSettings] = useState<SiteSettingsPayload>(() => ({
    ...DEFAULT_SITE_SETTINGS,
    homeName: savedName(),
  }))
  const [settingsDraft, setSettingsDraft] = useState<SiteSettingsPayload>(() => ({
    ...DEFAULT_SITE_SETTINGS,
    homeName: savedName(),
  }))
  const [settingsExpanded, setSettingsExpanded] = useState(false)
  const [settingsBusy, setSettingsBusy] = useState(false)
  const [nameMessage, setNameMessage] = useState('')
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ambient, setAmbient] = useState(false)
  const [sfxEnabled, setSfxEnabled] = useState<boolean>(isSfxEnabled)
  const sfxEnabledRef = useRef(sfxEnabled)
  sfxEnabledRef.current = sfxEnabled
  const doorKnockTimerRef = useRef<number | null>(null)
  const [atmosphereMode, setAtmosphereMode] = useState<AtmosphereMode>(initialAtmosphereMode)
  const [weather, setWeather] = useState<WeatherMode>(initialWeatherMode)
  const weatherRef = useRef(weather)
  weatherRef.current = weather
  const [autoClockTick, setAutoClockTick] = useState(0)
  const userTouchedAtmoRef = useRef(Boolean(initialDeepLink.at || initialDeepLink.weather))
  const atmospherePreset = useMemo(
    () => resolveAtmospherePreset(atmosphereMode, new Date()),
    [atmosphereMode, autoClockTick],
  )
  const [deskLampOn, setDeskLampOn] = useState<boolean>(
    () => initialDeepLink.lamp ?? (atmospherePreset === 'golden' || atmospherePreset === 'night' || weather === 'rain'),
  )
  const deskLampOnRef = useRef(deskLampOn)
  deskLampOnRef.current = deskLampOn
  const userTouchedLampRef = useRef(initialDeepLink.lamp !== null)
  const [focusId, setFocusId] = useState<FocusSubPoseId | null>(initialDeepLink.focus)
  const focusIdRef = useRef(focusId)
  focusIdRef.current = focusId
  const [studyQuote, setStudyQuote] = useState<string | null>(null)
  const [quoteIdx, setQuoteIdx] = useState(0)
  const quoteIdxRef = useRef(quoteIdx)
  quoteIdxRef.current = quoteIdx
  const [guestStamps, setGuestStamps] = useState<GuestStampEntry[]>(loadGuestStamps)
  const guestStampsRef = useRef(guestStamps)
  guestStampsRef.current = guestStamps
  const [selectedStampMood, setSelectedStampMood] = useState(STAMP_MOODS[0].id)
  const [guestNoteInput, setGuestNoteInput] = useState('')
  const [latestStampReply, setLatestStampReply] = useState('')
  const [atmoPopoverOpen, setAtmoPopoverOpen] = useState(false)
  const atmoAnchorRef = useRef<HTMLDivElement>(null)
  const atmoTriggerRef = useRef<HTMLButtonElement>(null)
  const atmoPopoverRef = useRef<HTMLDivElement>(null)
  const tactileBarRef = useRef<HTMLDivElement>(null)
  const moodGroupRef = useRef<HTMLDivElement>(null)
  const pendingFocusAfterNavRef = useRef<FocusSubPoseId | null>(null)
  const camera = useRef<CameraHandle>(null)
  const progress = useRef(place === 'yard' || place === 'hall' ? 0 : stopProgress(doorStops.find((d) => d.id === place)!.depth))
  const [nearby, setNearby] = useState<Place | null>(null)
  const [atEnd, setAtEnd] = useState(false)
  const [isNarrowViewport, setIsNarrowViewport] = useState(() =>
    matchMedia('(max-width: 650px)').matches,
  )
  const isNarrowViewportRef = useRef(isNarrowViewport)
  isNarrowViewportRef.current = isNarrowViewport
  const [directoryOpen, setDirectoryOpen] = useState(
    () => startingPlace() !== 'gallery' && !matchMedia('(max-width: 650px)').matches,
  )
  const [studioMenuOpen, setStudioMenuOpen] = useState(false)
  const [signOutBusy, setSignOutBusy] = useState(false)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const toastIdRef = useRef(0)
  const toastTimersRef = useRef<Map<number, number>>(new Map())
  const studioAnchorRef = useRef<HTMLDivElement>(null)
  const studioTriggerRef = useRef<HTMLButtonElement>(null)
  const studioPopoverRef = useRef<HTMLDivElement>(null)
  const placeRef = useRef(place)
  placeRef.current = place
  const title = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const animation = useRef<gsap.core.Tween | null>(null)

  // Cloud / Local Studio CMS state
  const [backendHealth, setBackendHealth] = useState<LocalStudioHealth>(() => ({
    mode: isCloudConfigured ? 'cloud' : 'unconfigured-readonly',
    writable: isCloudConfigured,
    isLoopback: false,
    hasContent: false,
  }))
  const [publicData, setPublicData] = useState<PublicCottageData>(emptyPublicData)
  const [cloudLoading, setCloudLoading] = useState(true)
  const [cloudError, setCloudError] = useState('')
  const [signedUrlRevision, setSignedUrlRevision] = useState(0)

  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [adminData, setAdminData] = useState<AdminCottageData | null>(null)
  const [adminError, setAdminError] = useState('')
  const [reorderBusy, setReorderBusy] = useState(false)

  const homeName = siteSettings.homeName

  // Detail & editor modals
  const [viewingProject, setViewingProject] = useState<ViewingProjectState | null>(null)
  const [viewingNote, setViewingNote] = useState<ViewingNoteState | null>(null)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<AdminProject | null>(null)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<AdminNote | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [postcardOpen, setPostcardOpen] = useState(false)
  const [postcardSnapshot, setPostcardSnapshot] = useState<string | null>(null)
  const [postcardSeedItem, setPostcardSeedItem] = useState<{ slug?: string | null; title: string } | null>(null)
  const [conflict, setConflict] = useState<ConflictContext | null>(null)

  const isAdmin = Boolean(adminEmail && adminData)
  const canPersistSiteSettings =
    isAdmin && (backendHealth.mode === 'local-studio' || backendHealth.mode === 'cloud')
  const anyModalOpen =
    mapOpen ||
    postcardOpen ||
    viewingProject !== null ||
    viewingNote !== null ||
    projectEditorOpen ||
    noteEditorOpen ||
    profileEditorOpen ||
    conflict !== null
  const modalOpenRef = useRef(anyModalOpen)
  modalOpenRef.current = anyModalOpen
  const projectEditorMounted = useEverTrue(projectEditorOpen)
  const noteEditorMounted = useEverTrue(noteEditorOpen)
  const profileEditorMounted = useEverTrue(profileEditorOpen)
  const projectDetailMounted = useEverTrue(viewingProject !== null)
  const noteDetailMounted = useEverTrue(viewingNote !== null)
  const postcardMounted = useEverTrue(postcardOpen)
  const conflictMounted = useEverTrue(conflict !== null)

  const publicSeqRef = useRef(0)
  const adminSeqRef = useRef(0)

  const loadPublic = useCallback(async () => {
    const seq = ++publicSeqRef.current
    setCloudLoading(true)
    setCloudError('')
    try {
      const health = await resolveBackendHealth()
      if (seq !== publicSeqRef.current) return
      setBackendHealth(health)
      if (health.mode === 'unconfigured-readonly') {
        setPublicData(emptyPublicData)
        return
      }
      const data = await fetchPublicCottage()
      if (seq !== publicSeqRef.current) return
      seedSignedUrls(data.signedUrls, 'public')
      setPublicData(data)
      if (data.siteSettings) {
        setSiteSettings(data.siteSettings)
        if (!userTouchedAtmoRef.current) {
          const hasStoredAtmo = (() => {
            try { return Boolean(localStorage.getItem('paper-home:atmosphere')) } catch { return false }
          })()
          if (!hasStoredAtmo && isValidAtmosphereMode(data.siteSettings.defaultAtmosphere)) {
            setAtmosphereMode(data.siteSettings.defaultAtmosphere)
          }
          const hasStoredWeather = (() => {
            try { return Boolean(localStorage.getItem('paper-home:weather')) } catch { return false }
          })()
          if (!hasStoredWeather && isValidWeatherMode(data.siteSettings.defaultWeather)) {
            setWeather(data.siteSettings.defaultWeather)
          }
        }
      }
      setSignedUrlRevision((r) => r + 1)
    } catch (err) {
      if (seq !== publicSeqRef.current) return
      setCloudError(err instanceof Error ? err.message : '公开内容读取失败，请稍后重试。')
    } finally {
      if (seq === publicSeqRef.current) {
        setCloudLoading(false)
      }
    }
  }, [])

  const loadAdmin = useCallback(async () => {
    const seq = ++adminSeqRef.current
    setAdminError('')
    try {
      const health = await resolveBackendHealth()
      if (seq !== adminSeqRef.current) return
      setBackendHealth(health)

      if (health.mode === 'local-studio') {
        if (!health.writable || !isLocalOwnerActive()) {
          setAdminEmail(null)
          setAdminData(null)
          return
        }
        const data = await fetchAdminCottage()
        if (seq !== adminSeqRef.current) return
        seedSignedUrls(data.signedUrls, 'admin')
        setAdminData(data)
        setAdminEmail('本地主人')
        if (data.siteSettings) {
          setSiteSettings(data.siteSettings)
          setSettingsDraft(data.siteSettings)
        }
        setSignedUrlRevision((r) => r + 1)
        return
      }

      if (health.mode !== 'cloud') {
        setAdminEmail(null)
        setAdminData(null)
        return
      }

      const client = getSupabaseClient()
      const { data: sess } = await client.auth.getSession()
      if (seq !== adminSeqRef.current) return
      if (!sess.session?.access_token) {
        setAdminEmail(null)
        setAdminData(null)
        return
      }
      const data = await fetchAdminCottage()
      if (seq !== adminSeqRef.current) return
      seedSignedUrls(data.signedUrls, 'admin')
      setAdminData(data)
      setAdminEmail(sess.session.user?.email ?? '主人')
      if (data.siteSettings) {
        setSiteSettings(data.siteSettings)
        setSettingsDraft(data.siteSettings)
      }
      setSignedUrlRevision((r) => r + 1)
    } catch (err) {
      if (seq !== adminSeqRef.current) return
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await signOutAdmin().catch(() => {})
        clearSignedUrlCache()
        setAdminEmail(null)
        setAdminData(null)
        setAdminError('当前无管理权限或登录已失效，已恢复访客视图。')
      } else {
        setAdminError(err instanceof Error ? err.message : '管理数据读取失败。')
      }
    }
  }, [])

  const refreshCloud = useCallback(async () => {
    await loadPublic()
    const health = await resolveBackendHealth(true)
    setBackendHealth(health)
    if (health.mode === 'local-studio') {
      if (health.writable && isLocalOwnerActive()) {
        await loadAdmin()
      }
      return
    }
    if (health.mode === 'cloud') {
      const client = getSupabaseClient()
      const { data } = await client.auth.getSession()
      if (data.session?.access_token) {
        await loadAdmin()
      }
    }
  }, [loadAdmin, loadPublic])

  useEffect(() => {
    void loadPublic()
    let active = true
    let unsubscribe: (() => void) | null = null

    void resolveBackendHealth().then((health) => {
      if (!active) return
      setBackendHealth(health)
      if (health.mode === 'local-studio') {
        if (health.writable && isLocalOwnerActive()) {
          setAdminEmail('本地主人')
          void loadAdmin()
        }
        return
      }
      if (health.mode !== 'cloud') return
      const client = getSupabaseClient()
      void client.auth.getSession().then(({ data }) => {
        if (active && data.session?.access_token) {
          setAdminEmail(data.session.user?.email ?? '主人')
          void loadAdmin()
        }
      })
      const { data: sub } = client.auth.onAuthStateChange((event, session) => {
        if (!session || event === 'SIGNED_OUT') {
          adminSeqRef.current += 1
          clearSignedUrlCache()
          setAdminEmail(null)
          setAdminData(null)
          setProjectEditorOpen(false)
          setNoteEditorOpen(false)
          setProfileEditorOpen(false)
          void loadPublic()
        } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
          setAdminEmail(session.user?.email ?? '主人')
          if (event === 'SIGNED_IN') void loadAdmin()
        }
      })
      unsubscribe = () => sub.subscription.unsubscribe()
    })

    return () => {
      active = false
      unsubscribe?.()
    }
  }, [loadAdmin, loadPublic])

  // Clamp galleryIndex smoothly when published project count changes
  useEffect(() => {
    setGalleryIndex((idx) => Math.max(0, Math.min(idx, Math.max(0, publicData.projects.length - 1))))
  }, [publicData.projects.length])

  useEffect(() => {
    let active = true
    setReady(false); setLoadError(''); setPreparing('')
    void loadResources(quality, (v) => { if (active) setLoadProgress(v) })
      .then((value) => { if (active) { setPack(value); setLoadProgress(1) } })
      .catch(() => { if (active) setLoadError('小屋素材没有加载完成。请重试。') })
    return () => { active = false }
  }, [quality, retry])

  useEffect(() => {
    const prev = prevPackRef.current
    prevPackRef.current = pack
    if (!prev || prev === pack) return
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        disposeResourcePack(prev)
      })
    })
    return () => {
      cancelAnimationFrame(raf1)
      cancelAnimationFrame(raf2)
    }
  }, [pack])

  useEffect(() => () => {
    canvasCleanupRef.current?.()
    canvasCleanupRef.current = null
  }, [])

  useEffect(() => {
    let active = true
    const finish = () => { if (active) setFontReady(true) }
    document.fonts.load('24px HomeHand').then(finish, finish)
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.title = `${homeName} · ${rooms.find((r) => r.id === place)?.name}`
    if (!richHashActiveRef.current) {
      history.replaceState(null, '', `#${place}`)
    }
  }, [homeName, place])

  useEffect(() => {
    if (!ready || cloudLoading || cloudError || !pendingDeepLinkItemRef.current) return
    const targetItem = pendingDeepLinkItemRef.current
    pendingDeepLinkItemRef.current = null
    if (place === 'gallery') {
      const idx = publicData.projects.findIndex((p) => p.slug === targetItem || p.id === targetItem)
      if (idx >= 0) openPublicProject(idx)
    } else if (place === 'study') {
      const idx = publicData.notes.findIndex((n) => n.slug === targetItem || n.id === targetItem)
      if (idx >= 0) openPublicNote(idx)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, cloudLoading, cloudError, place, publicData.projects, publicData.notes])

  const applyHashDeepLinkRef = useRef<(dl: ReturnType<typeof parseDeepLinkHash>) => void>(() => {})
  applyHashDeepLinkRef.current = (dl) => {
    if (dl.at) {
      userTouchedAtmoRef.current = true
      setAtmosphereMode(dl.at)
    }
    if (dl.weather) {
      userTouchedAtmoRef.current = true
      setWeather(dl.weather)
    }
    if (dl.lamp !== null) {
      userTouchedLampRef.current = true
      setDeskLampOn(dl.lamp)
    }
    if (dl.room !== placeRef.current) {
      if (busyRef.current || !ready) return
      richHashActiveRef.current = dl.isRich
      pendingFocusAfterNavRef.current = dl.focus
      pendingDeepLinkItemRef.current = dl.item
      void navigate(dl.room, { preserveRichHash: dl.isRich, skipOpenSound: true })
      return
    }
    richHashActiveRef.current = dl.isRich
    setFocusId(dl.focus)
    if (dl.item) {
      if (dl.room === 'gallery') {
        const idx = publicData.projects.findIndex((p) => p.slug === dl.item || p.id === dl.item)
        if (idx >= 0) openPublicProject(idx)
      } else if (dl.room === 'study') {
        const idx = publicData.notes.findIndex((n) => n.slug === dl.item || n.id === dl.item)
        if (idx >= 0) openPublicNote(idx)
      }
    } else {
      setViewingProject(null)
      setViewingNote(null)
    }
  }

  useEffect(() => {
    const onHashChange = () => {
      applyHashDeepLinkRef.current(parseDeepLinkHash())
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)')
    const listener = () => setReduced(media.matches)
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  useEffect(() => {
    const media = matchMedia('(max-width: 650px)')
    const listener = () => {
      setIsNarrowViewport(media.matches)
      if (media.matches) {
        setDirectoryOpen(false)
      } else if (placeRef.current === 'study' || placeRef.current === 'blank') {
        setDirectoryOpen(true)
      }
    }
    media.addEventListener('change', listener)
    return () => media.removeEventListener('change', listener)
  }, [])

  const dismissToast = useCallback((id: number) => {
    const timer = toastTimersRef.current.get(id)
    if (timer !== undefined) {
      window.clearTimeout(timer)
      toastTimersRef.current.delete(id)
    }
    setToasts((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const showToast = useCallback(
    (message: string, tone: ToastItem['tone'] = 'success') => {
      const id = ++toastIdRef.current
      setToasts((prev) => [...prev.slice(-2), { id, message, tone }])
      const timer = window.setTimeout(() => {
        toastTimersRef.current.delete(id)
        setToasts((prev) => prev.filter((item) => item.id !== id))
      }, 3200)
      toastTimersRef.current.set(id, timer)
    },
    [],
  )

  useEffect(() => {
    return () => {
      for (const timer of toastTimersRef.current.values()) {
        window.clearTimeout(timer)
      }
      toastTimersRef.current.clear()
    }
  }, [])

  useEffect(() => {
    if (!isAdmin || anyModalOpen) {
      setStudioMenuOpen(false)
    }
  }, [isAdmin, anyModalOpen])

  useEffect(() => {
    if (!studioMenuOpen) return
    const rafId = requestAnimationFrame(() => {
      studioPopoverRef.current
        ?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
        ?.focus()
    })
    const onPointerDown = (e: PointerEvent) => {
      if (studioAnchorRef.current && e.target instanceof Node && !studioAnchorRef.current.contains(e.target)) {
        setStudioMenuOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setStudioMenuOpen(false)
        requestAnimationFrame(() => studioTriggerRef.current?.focus())
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [studioMenuOpen])

  useEffect(() => {
    if (!root.current) return
    const ctx = gsap.context(() => {
      gsap.from('.welcome-copy > *', { y: reduced ? 0 : 12, opacity: 0.3, stagger: 0.09, duration: 0.65, ease: 'power2.out' })
    }, root)
    return () => ctx.revert()
  }, [place, reduced])

  useEffect(() => () => {
    animation.current?.kill()
    if (doorKnockTimerRef.current !== null) window.clearTimeout(doorKnockTimerRef.current)
    document.body.style.cursor = ''
  }, [])

  useEffect(() => {
    if (!userTouchedLampRef.current) {
      setDeskLampOn(atmospherePreset === 'golden' || atmospherePreset === 'night' || weather === 'rain')
    }
  }, [atmospherePreset, weather])

  useEffect(() => {
    if (atmosphereMode !== 'auto') return
    const timer = window.setInterval(() => setAutoClockTick((t) => t + 1), 60_000)
    return () => window.clearInterval(timer)
  }, [atmosphereMode])

  useEffect(() => installGlobalClickSoundDelegator(), [])

  useEffect(() => {
    setAcousticSpace(place === 'yard' ? 'yard' : 'indoor')
  }, [place])

  useEffect(() => {
    if (!qaEnabled) return
    const w = window as unknown as { __HOME_QA__?: Record<string, unknown> }
    if (!w.__HOME_QA__) w.__HOME_QA__ = {}
    Object.assign(w.__HOME_QA__, {
      atmosphereMode,
      atmospherePreset,
      weather,
      deskLampOn,
      focusId,
      sfxEnabled,
      quality,
      contextLost,
      loseWebglContext: () => loseContextForQaRef.current?.() ?? false,
    })
  }, [atmosphereMode, atmospherePreset, weather, deskLampOn, focusId, sfxEnabled, quality, contextLost])

  const navigatePromoRef = useRef(navigate)
  navigatePromoRef.current = navigate

  useEffect(() => {
    if (!promoMode) return
    const w = window as unknown as { __PAPER_HOME_PROMO__?: Record<string, unknown> }
    w.__PAPER_HOME_PROMO__ = {
      getState: () => ({
        ready,
        busy: busyRef.current,
        place,
        atmospherePreset,
        weather,
        deskLampOn,
        focusId,
        galleryIndex,
        quality,
      }),
      navigate: (target: Place) => navigatePromoRef.current(target, { skipOpenSound: true }),
      setAtmosphere: (mode: AtmosphereMode) => setAtmosphereMode(mode),
      setWeather: (mode: WeatherMode) => {
        weatherRef.current = mode
        setWeather(mode)
      },
      setDeskLamp: (on: boolean) => {
        userTouchedLampRef.current = true
        deskLampOnRef.current = on
        setDeskLampOn(on)
      },
      setFocus: (id: FocusSubPoseId | null) => {
        focusIdRef.current = id
        setFocusId(id)
      },
      setGalleryIndex: (index: number) => setGalleryIndex(index),
      setHallProgress: (value: number) => {
        const clamped = Math.max(0, Math.min(1, value))
        progress.current = clamped
        const el = root.current
        if (el) {
          el.scrollTop = clamped * Math.max(0, el.scrollHeight - el.clientHeight)
        }
      },
      jumpToPlace: async (target: Place) => {
        camera.current?.clearPromoOverride?.()
        setFocusId(null)
        setStudyQuote(null)
        if (target !== 'yard' && target !== 'hall') {
          progress.current = stopProgress(doorStops.find((d) => d.id === target)!.depth)
        } else {
          progress.current = 0
        }
        await prepare.current?.()
        setPlace(target)
        await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
        camera.current?.snapPlace?.(target)
      },
      glideCamera: async (from: PromoCameraWaypoint | null, to: PromoCameraWaypoint, durationSec: number, ease = 'power1.inOut') => {
        await camera.current?.glidePromo?.(from, to, durationSec, ease)
      },
      setCameraAt: (from: PromoCameraWaypoint | null, to: PromoCameraWaypoint, tNorm: number, ease = 'sine.inOut') => {
        camera.current?.setPromoPose?.(from, to, tNorm, ease)
      },
      clearCamera: () => {
        camera.current?.clearPromoOverride?.()
      },
      setFrontDoorOpen: (value: number | null) => {
        promoFrontDoorProgressRef.current = value
      },
      enterManualCapture: () => {
        promoBridgeRef.current?.enterManual()
      },
      exitManualCapture: () => {
        promoFrontDoorProgressRef.current = null
        promoBridgeRef.current?.exitManual()
      },
      stepFrame: (dtSec: number) => {
        promoBridgeRef.current?.renderFlush(dtSec)
      },
      renderAndUploadFrame: async (dtSec: number, uploadUrl: string) => {
        if (!promoBridgeRef.current) throw new Error('Promo render bridge is not ready')
        return promoBridgeRef.current.renderAndUpload(dtSec, uploadUrl)
      },
      roomPoint: (id: Place, p: [number, number, number]) => {
        const pt = roomPoint(id, p)
        return [pt.x, pt.y, pt.z] as [number, number, number]
      },
      setReduced: (value: boolean) => setReduced(value),
      getCanvas: () => document.querySelector<HTMLCanvasElement>('.world canvas'),
    }
  }, [promoMode, ready, place, atmospherePreset, weather, deskLampOn, focusId, galleryIndex, quality])

  useEffect(() => {
    if (!atmoPopoverOpen) return
    const rafId = requestAnimationFrame(() => {
      const box = atmoPopoverRef.current
      const target =
        box?.querySelector<HTMLButtonElement>('button.active:not(:disabled)') ??
        box?.querySelector<HTMLButtonElement>('button:not(:disabled)')
      target?.focus()
    })
    const onPointerDown = (e: PointerEvent) => {
      if (atmoAnchorRef.current && e.target instanceof Node && !atmoAnchorRef.current.contains(e.target)) {
        setAtmoPopoverOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        setAtmoPopoverOpen(false)
        requestAnimationFrame(() => atmoTriggerRef.current?.focus())
      }
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      cancelAnimationFrame(rafId)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [atmoPopoverOpen])

  useEffect(() => {
    if (focusId === null && studyQuote === null) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (modalOpenRef.current || document.querySelector('dialog[open]')) return
      if (studioMenuOpen || atmoPopoverOpen) return
      const active = document.activeElement
      const wasInsideCard =
        active instanceof Element && Boolean(active.closest('.tactile-floating-card'))
      setStudyQuote(null)
      setFocusId(null)
      playSound('modal-close')
      if (wasInsideCard) {
        requestAnimationFrame(() => {
          tactileBarRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
        })
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [focusId, studyQuote, studioMenuOpen, atmoPopoverOpen])

  // Ambient sound is synthesized locally and starts only after explicit user gesture.
  useEffect(() => {
    if (!ambient) return
    const audio = new AudioContext()
    const master = audio.createGain(); master.gain.value = 0.042; master.connect(audio.destination)
    const length = audio.sampleRate * 2, buffer = audio.createBuffer(1, length, audio.sampleRate)
    const channel = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; channel[i] = last * 3.5 }
    const wind = audio.createBufferSource(); wind.buffer = buffer; wind.loop = true
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass'
    const isIndoor = place !== 'yard'
    filter.frequency.value = isIndoor ? 340 : 520
    wind.connect(filter); filter.connect(master); wind.start()

    // Procedural rain layer when weather === 'rain'
    let rainSource: AudioBufferSourceNode | null = null
    if (weather === 'rain') {
      const rainBuffer = audio.createBuffer(1, length, audio.sampleRate)
      const rainData = rainBuffer.getChannelData(0)
      let b0 = 0, b1 = 0, b2 = 0
      for (let i = 0; i < length; i++) {
        const white = Math.random() * 2 - 1
        b0 = 0.997 * b0 + white * 0.029
        b1 = 0.985 * b1 + white * 0.032
        b2 = 0.95 * b2 + white * 0.045
        rainData[i] = (b0 + b1 + b2 + white * 0.12) * 0.65
      }
      rainSource = audio.createBufferSource()
      rainSource.buffer = rainBuffer
      rainSource.loop = true
      const rainFilter = audio.createBiquadFilter()
      rainFilter.type = 'lowpass'
      // Muffle high frequencies when inside the cottage ("listening to rain behind 6mm glass")
      rainFilter.frequency.value = isIndoor ? 680 : 1750
      const rainGain = audio.createGain()
      rainGain.gain.value = isIndoor ? 0.48 : 0.85
      rainSource.connect(rainFilter)
      rainFilter.connect(rainGain)
      rainGain.connect(master)
      rainSource.start()
    }

    const chimeOrNote = () => {
      if (document.hidden || audio.state !== 'running') return
      const osc = audio.createOscillator(), volume = audio.createGain(), now = audio.currentTime
      if (atmospherePreset === 'night' || atmospherePreset === 'golden') {
        // Warm wooden pentatonic overtones for sunset & night
        const notes = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25]
        const freq = notes[Math.floor(Math.random() * notes.length)]
        osc.type = 'triangle'
        osc.frequency.setValueAtTime(freq, now)
        osc.frequency.exponentialRampToValueAtTime(freq * 0.996, now + 0.85)
        volume.gain.setValueAtTime(0, now)
        volume.gain.linearRampToValueAtTime(0.09, now + 0.04)
        volume.gain.exponentialRampToValueAtTime(0.001, now + 0.9)
        osc.connect(volume); volume.connect(master); osc.start(now); osc.stop(now + 0.95)
      } else if (weather === 'rain') {
        // Soft eave droplet pluck
        const baseFreq = 580 + Math.random() * 280
        osc.type = 'sine'
        osc.frequency.setValueAtTime(baseFreq, now)
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.45, now + 0.09)
        volume.gain.setValueAtTime(0, now)
        volume.gain.linearRampToValueAtTime(0.07, now + 0.015)
        volume.gain.exponentialRampToValueAtTime(0.001, now + 0.14)
        osc.connect(volume); volume.connect(master); osc.start(now); osc.stop(now + 0.16)
      } else {
        osc.type = 'sine'; osc.frequency.setValueAtTime(1700 + Math.random() * 900, now)
        osc.frequency.exponentialRampToValueAtTime(3400, now + 0.1); osc.frequency.exponentialRampToValueAtTime(1800, now + 0.25)
        volume.gain.setValueAtTime(0, now); volume.gain.linearRampToValueAtTime(0.12, now + 0.03); volume.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
        osc.connect(volume); volume.connect(master); osc.start(); osc.stop(now + 0.3)
      }
    }
    const timer = window.setInterval(chimeOrNote, weather === 'rain' ? 2600 : 3800)
    const visibility = () => { if (document.hidden) void audio.suspend(); else void audio.resume() }
    document.addEventListener('visibilitychange', visibility)
    void audio.resume()
    return () => {
      clearInterval(timer)
      wind.stop()
      rainSource?.stop()
      void audio.close()
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [ambient, atmospherePreset, weather, place])

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
    const blocked = (target: EventTarget | null) =>
      busyRef.current ||
      modalOpenRef.current ||
      !!el.querySelector('dialog[open]') ||
      (target instanceof Element && !!target.closest('button,input,textarea,select,a,dialog'))
    const wheel = (e: WheelEvent) => {
      if (blocked(e.target)) return
      e.preventDefault()
      el.scrollTop += e.deltaY * (e.deltaMode === 1 ? 18 : e.deltaMode === 2 ? el.clientHeight : 1)
    }
    const start = (e: TouchEvent) => { touchY = blocked(e.target) ? null : e.touches[0]?.clientY ?? null }
    const move = (e: TouchEvent) => {
      if (touchY === null || blocked(e.target)) return
      e.preventDefault()
      const y = e.touches[0]?.clientY
      if (y !== undefined) { el.scrollTop += touchY - y; touchY = y }
    }
    const end = () => { touchY = null }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('touchstart', start, { passive: true })
    el.addEventListener('touchmove', move, { passive: false })
    el.addEventListener('touchend', end)
    el.addEventListener('touchcancel', end)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('touchstart', start)
      el.removeEventListener('touchmove', move)
      el.removeEventListener('touchend', end)
      el.removeEventListener('touchcancel', end)
    }
  }, [place])

  function onWalkScroll() {
    if (place !== 'hall' || busyRef.current || anyModalOpen) return
    const el = root.current!
    progress.current = Math.max(0, Math.min(1, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)))
    const depth = 0.85 + progress.current * layout.walkLength
    setNearby(doorStops.find((d) => Math.abs(depth - (d.depth - 0.6)) < 0.85)?.id || null)
    setAtEnd(progress.current > 0.98)
  }

  function step(direction: number) {
    const el = root.current
    if (el && !anyModalOpen) {
      playSound('step')
      el.scrollBy({
        top: (direction * (el.scrollHeight - el.clientHeight) * layout.stepDistance) / layout.walkLength,
        behavior: reduced ? 'instant' : 'smooth',
      })
    }
  }

  async function navigate(target: Place, opts?: { skipOpenSound?: boolean; preserveRichHash?: boolean }) {
    if (busyRef.current || !ready) return
    richHashActiveRef.current = Boolean(opts?.preserveRichHash)
    setStudioMenuOpen(false)
    setAtmoPopoverOpen(false)
    setFocusId(null)
    setStudyQuote(null)
    setMapOpen(false)
    setPostcardOpen(false)
    setViewingProject(null)
    setViewingNote(null)
    setProjectEditorOpen(false)
    setNoteEditorOpen(false)
    setProfileEditorOpen(false)
    setConflict(null)
    const defaultDirOpen =
      (target === 'study' || target === 'blank') && !matchMedia('(max-width: 650px)').matches
    setDirectoryOpen(defaultDirOpen)
    if (target === place) return
    if (!opts?.skipOpenSound) {
      const goingBack = target === 'yard' || (place !== 'yard' && place !== 'hall' && target === 'hall')
      playSound(goingBack ? 'door-close' : 'door-open')
    }
    const resumeProgress = place === 'hall' && nearby === target ? progress.current : null
    if (place === 'yard') progress.current = 0
    busyRef.current = true; setBusy(true); setDestination(target)
    setOpening(place === 'yard' ? 'hall' : place !== 'hall' ? place : target)
    document.body.style.cursor = ''
    try {
      transition.current = { from: place, to: target, phase: 'loading', progress: 0 }
      await loadResources(quality)
      await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())))
      await prepare.current?.()
      if (target !== 'yard' && target !== 'hall') {
        progress.current = stopProgress(doorStops.find((d) => d.id === target)!.depth)
      }
      if (camera.current) await camera.current.travel(target, reduced, () => setPlace(target))
      else setPlace(target)
      if (pendingFocusAfterNavRef.current) {
        const nextFocus = pendingFocusAfterNavRef.current
        pendingFocusAfterNavRef.current = null
        setFocusId(nextFocus)
      }
      title.current?.focus({ preventScroll: true })
    } catch {
      transition.current = { from: place, to: target, phase: 'failed', progress: 0 }
      setRetryTarget(target)
      setLoadError('目的地没有准备好，已留在当前房间。请重试。')
    } finally {
      if (resumeProgress !== null) progress.current = resumeProgress
      busyRef.current = false; setBusy(false); setOpening(null); setDestination(null)
      const depth = 0.85 + progress.current * layout.walkLength
      setAtEnd(progress.current > 0.98)
      setNearby(doorStops.find((d) => Math.abs(depth - (d.depth - 0.6)) < 0.85)?.id || null)
      requestAnimationFrame(() => {
        if (root.current) root.current.scrollTop = progress.current * Math.max(0, root.current.scrollHeight - root.current.clientHeight)
      })
    }
  }

  function openPublicProject(index: number) {
    const item = publicData.projects[index]
    if (!item) return
    setGalleryIndex(index)
    setViewingNote(null)
    setViewingProject({
      project: item,
      scope: 'public',
      isPreview: false,
      publicIndex: index,
      adminItem: adminData?.projects.find((p) => p.id === item.id),
    })
  }

  function openAdminProjectPreview(project: AdminProject) {
    setViewingNote(null)
    setViewingProject({
      project: { id: project.id, publishedAt: project.publishedAt, ...project.draft },
      scope: 'admin',
      isPreview: true,
      publicIndex: null,
      adminItem: project,
    })
  }

  function openPublicNote(index: number) {
    const item = publicData.notes[index]
    if (!item) return
    setViewingProject(null)
    setViewingNote({
      note: item,
      scope: 'public',
      isPreview: false,
      publicIndex: index,
      adminItem: adminData?.notes.find((n) => n.id === item.id),
    })
  }

  function openAdminNotePreview(note: AdminNote) {
    setViewingProject(null)
    setViewingNote({
      note: { id: note.id, publishedAt: note.publishedAt, ...note.draft },
      scope: 'admin',
      isPreview: true,
      publicIndex: null,
      adminItem: note,
    })
  }

  function interact(index: number) {
    if (busyRef.current) return
    if (place === 'study') {
      if (publicData.notes[index]) openPublicNote(index)
      else if (isAdmin && adminData) {
        if (adminData.notes[0]) openAdminNotePreview(adminData.notes[0])
        else { setEditingNote(null); setNoteEditorOpen(true) }
      }
    } else if (place === 'gallery') {
      if (publicData.projects[index]) {
        openPublicProject(index)
      } else if (isAdmin && adminData) {
        if (adminData.projects[0]) openAdminProjectPreview(adminData.projects[0])
        else { setEditingProject(null); setProjectEditorOpen(true) }
      }
    }
  }

  const handleCoverExpired = useCallback((assetId: string) => {
    evictSignedUrl(assetId, 'public')
    void refreshSignedUrl(assetId, 'public', true).then((entry) => {
      if (entry) setSignedUrlRevision((r) => r + 1)
    })
  }, [])

  const galleryProjects: GalleryDisplayItem[] = useMemo(() => {
    return publicData.projects.slice(0, 3).map((p) => ({
      id: p.id,
      title: p.title,
      summary: p.summary,
      coverAssetId: p.coverAssetId,
      coverThumbUrl: getCachedUrl(p.coverAssetId, 'thumb', 'public'),
    }))
  }, [publicData.projects, signedUrlRevision])

  function registerUploadedAsset(asset: MediaAsset) {
    setAdminData((prev) =>
      prev ? { ...prev, assets: { ...prev.assets, [asset.id]: asset } } : prev,
    )
  }

  const handleCopyEmail = useCallback(
    async (email: string) => {
      if (!email) return
      try {
        await navigator.clipboard.writeText(email)
        playSound('success-seal')
        showToast(`已复制联系邮箱：${email}`, 'success')
      } catch {
        showToast('浏览器未授权剪贴板，请长按或右键复制邮箱', 'info')
      }
    },
    [showToast],
  )

  async function handleQuickSignOut() {
    setSignOutBusy(true)
    try {
      await signOutAdmin()
      adminSeqRef.current += 1
      clearSignedUrlCache()
      setAdminEmail(null)
      setAdminData(null)
      setStudioMenuOpen(false)
      await loadPublic()
      showToast(
        backendHealth.mode === 'local-studio' ? '已退出编辑，切换为访客浏览视图' : '已切换为访客浏览视图',
        'info',
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : '退出失败，请重试', 'error')
    } finally {
      setSignOutBusy(false)
    }
  }

  function handleProjectSaved(saved: AdminProject, pendingCleanupCount: number, action?: SaveActionKind) {
    setEditingProject((prev) => (prev && prev.id === saved.id ? saved : prev))
    setAdminData((prev) => {
      if (!prev) return prev
      const exists = prev.projects.some((p) => p.id === saved.id)
      const projects = exists
        ? prev.projects.map((p) => (p.id === saved.id ? saved : p))
        : [...prev.projects, saved]
      return { ...prev, projects, pendingCleanupCount }
    })
    void loadPublic()
    if (action === 'draft') showToast('作品草稿已保存', 'success')
    else if (action === 'publish') { playSound('success-seal'); showToast('作品已发布到作品室', 'success') }
    else if (action === 'unpublish') showToast('已撤回发布，草稿仍保留', 'info')
  }

  function handleProjectDeleted(deletedId: string, pendingCleanupCount: number) {
    setAdminData((prev) =>
      prev
        ? {
            ...prev,
            projects: prev.projects.filter((p) => p.id !== deletedId),
            notes: prev.notes.map((n) =>
              n.draft.projectId === deletedId
                ? { ...n, draft: { ...n.draft, projectId: null } }
                : n,
            ),
            pendingCleanupCount,
          }
        : prev,
    )
    void loadPublic()
    showToast('已删除作品', 'info')
  }

  function handleNoteSaved(saved: AdminNote, pendingCleanupCount: number, action?: SaveActionKind) {
    setEditingNote((prev) => (prev && prev.id === saved.id ? saved : prev))
    setAdminData((prev) => {
      if (!prev) return prev
      const exists = prev.notes.some((n) => n.id === saved.id)
      const notes = exists
        ? prev.notes.map((n) => (n.id === saved.id ? saved : n))
        : [...prev.notes, saved]
      return { ...prev, notes, pendingCleanupCount }
    })
    void loadPublic()
    if (action === 'draft') showToast('手记草稿已保存', 'success')
    else if (action === 'publish') { playSound('success-seal'); showToast('手记已发布到创作手记', 'success') }
    else if (action === 'unpublish') showToast('已撤回发布，草稿仍保留', 'info')
  }

  function handleNoteDeleted(deletedId: string, pendingCleanupCount: number) {
    setAdminData((prev) =>
      prev ? { ...prev, notes: prev.notes.filter((n) => n.id !== deletedId), pendingCleanupCount } : prev,
    )
    void loadPublic()
    showToast('已删除手记', 'info')
  }

  function handleProfileSaved(saved: AdminProfile, pendingCleanupCount: number, action?: SaveActionKind) {
    setAdminData((prev) => (prev ? { ...prev, profile: saved, pendingCleanupCount } : prev))
    void loadPublic()
    if (action === 'draft') showToast('个人介绍草稿已保存', 'success')
    else if (action === 'publish') { playSound('success-seal'); showToast('“关于我”公开内容已更新', 'success') }
    else if (action === 'unpublish') showToast('已撤回“关于我”公开展示', 'info')
  }

  async function handleReorderProject(index: number, delta: -1 | 1) {
    if (!adminData) return
    const nextIdx = index + delta
    if (nextIdx < 0 || nextIdx >= adminData.projects.length) return
    const reordered = [...adminData.projects]
    ;[reordered[index], reordered[nextIdx]] = [reordered[nextIdx], reordered[index]]
    setReorderBusy(true)
    setAdminError('')
    try {
      const res = await reorderProjectsApi(
        reordered.map((p) => p.id),
        adminData.orderVersions.projects,
      )
      setAdminData((prev) =>
        prev
          ? {
              ...prev,
              projects: reordered.map((p, idx) => ({ ...p, sortOrder: idx })),
              orderVersions: {
                ...prev.orderVersions,
                projects: res.orderVersion ?? prev.orderVersions.projects + 1,
              },
            }
          : prev,
      )
      await loadPublic()
      showToast('作品展示顺序已调整', 'success')
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflict({
          title: '作品排序',
          localCopyText: reordered.map((p, i) => `${i + 1}. ${p.draft.title}`).join('\n'),
          cloudSummaryLines: [
            `另一台设备刚调整过作品顺序（最新排序版本 v${err.orderVersion ?? '?'}）。`,
            '请刷新后查看最新排序再重新调整。',
          ],
          onUseCloud: () => {
            setConflict(null)
            void refreshCloud()
          },
        })
      } else {
        setAdminError(err instanceof Error ? err.message : '调整作品顺序失败，请重试。')
      }
    } finally {
      setReorderBusy(false)
    }
  }

  async function handleReorderNote(index: number, delta: -1 | 1) {
    if (!adminData) return
    const nextIdx = index + delta
    if (nextIdx < 0 || nextIdx >= adminData.notes.length) return
    const reordered = [...adminData.notes]
    ;[reordered[index], reordered[nextIdx]] = [reordered[nextIdx], reordered[index]]
    setReorderBusy(true)
    setAdminError('')
    try {
      const res = await reorderNotesApi(
        reordered.map((n) => n.id),
        adminData.orderVersions.notes,
      )
      setAdminData((prev) =>
        prev
          ? {
              ...prev,
              notes: reordered.map((n, idx) => ({ ...n, sortOrder: idx })),
              orderVersions: {
                ...prev.orderVersions,
                notes: res.orderVersion ?? prev.orderVersions.notes + 1,
              },
            }
          : prev,
      )
      await loadPublic()
      showToast('手记排序已调整', 'success')
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflict({
          title: '手记排序',
          localCopyText: reordered.map((n, i) => `${i + 1}. ${n.draft.title}`).join('\n'),
          cloudSummaryLines: [
            `另一台设备刚调整过手记顺序（最新排序版本 v${err.orderVersion ?? '?'}）。`,
            '请刷新后查看最新排序再重新调整。',
          ],
          onUseCloud: () => {
            setConflict(null)
            void refreshCloud()
          },
        })
      } else {
        setAdminError(err instanceof Error ? err.message : '调整手记顺序失败，请重试。')
      }
    } finally {
      setReorderBusy(false)
    }
  }

  const room = rooms.find((r) => r.id === place)!
  const inside = place !== 'yard' && place !== 'hall'
  const backPlace: Place = place === 'hall' ? 'yard' : 'hall'

  const viewingProjectLinkedNotes: LinkedNoteRef[] = useMemo(() => {
    if (!viewingProject) return []
    const pid = viewingProject.project.id
    if (viewingProject.scope === 'admin' && adminData) {
      return adminData.notes
        .filter((n) => n.draft.projectId === pid)
        .map((n) => ({ id: n.id, title: n.draft.title || '未命名手记', isDraftOnly: !n.isPublished }))
    }
    return publicData.notes
      .filter((n) => n.projectId === pid)
      .map((n) => ({ id: n.id, title: n.title }))
  }, [adminData, publicData.notes, viewingProject])

  const viewingNoteLinkedProject: LinkedProjectRef | null = useMemo(() => {
    if (!viewingNote?.note.projectId) return null
    const pid = viewingNote.note.projectId
    if (viewingNote.scope === 'admin' && adminData) {
      const match = adminData.projects.find((p) => p.id === pid)
      return match
        ? { id: match.id, title: match.draft.title || '未命名作品', isDraftOnly: !match.isPublished }
        : null
    }
    const pubMatch = publicData.projects.find((p) => p.id === pid)
    return pubMatch ? { id: pubMatch.id, title: pubMatch.title } : null
  }, [adminData, publicData.projects, viewingNote])

  const publishedProjects = publicData.projects
  const activeMobileProject = publishedProjects[galleryIndex] ?? null

  const activeQuotesPool = useMemo(() => {
    const ownerQuotes = isAdmin
      ? adminData?.profile?.draft?.quotes
      : publicData.profile?.quotes
    const cleaned = (ownerQuotes ?? []).map((q) => q.trim()).filter(Boolean)
    return cleaned.length > 0 ? cleaned : DEFAULT_STUDY_QUOTES
  }, [isAdmin, adminData?.profile?.draft?.quotes, publicData.profile?.quotes])

  const activeNowNotes = useMemo(() => {
    const ownerNow = isAdmin
      ? adminData?.profile?.draft?.nowNotes
      : publicData.profile?.nowNotes
    const cleaned = (ownerNow ?? []).map((n) => n.trim()).filter(Boolean)
    return cleaned.length > 0 ? cleaned : DEFAULT_NOW_NOTES
  }, [isAdmin, adminData?.profile?.draft?.nowNotes, publicData.profile?.nowNotes])

  const handleSelectAtmosphere = useCallback((mode: AtmosphereMode) => {
    userTouchedAtmoRef.current = true
    playSound(ATMO_SOUND_MAP[mode])
    setAtmosphereMode(mode)
    try { localStorage.setItem('paper-home:atmosphere', mode) } catch {}
  }, [])

  const handleToggleWeather = useCallback(() => {
    userTouchedAtmoRef.current = true
    const next: WeatherMode = weatherRef.current === 'rain' ? 'clear' : 'rain'
    weatherRef.current = next
    setWeather(next)
    playSound(next === 'rain' ? 'rain-on' : 'rain-off')
    try { localStorage.setItem('paper-home:weather', next) } catch {}
  }, [])

  const handleToggleSfx = useCallback(() => {
    const next = !sfxEnabledRef.current
    sfxEnabledRef.current = next
    setSfxEnabled(next)
    persistSfxEnabled(next)
    if (next) playSound('ui-switch', { force: true })
    showToast(next ? '已开启交互触感音效' : '已静音交互触感音效', 'info')
  }, [showToast])

  const handleTapProp = useCallback((msg: string) => {
    showToast(msg, 'info')
  }, [showToast])

  const handleToggleDeskLamp = useCallback(() => {
    userTouchedLampRef.current = true
    const next = !deskLampOnRef.current
    deskLampOnRef.current = next
    setDeskLampOn(next)
    playSound(next ? 'lamp-on' : 'lamp-off')
    showToast(next ? '已点亮书房黄铜绿台灯' : '已关上书桌台灯', 'info')
  }, [showToast])

  const handleDrawStudyQuote = useCallback(() => {
    if (busyRef.current) return
    playSound('paper-flip')
    if (isNarrowViewportRef.current) setDirectoryOpen(false)
    setFocusId('study-shelf')
    const nextIdx = (quoteIdxRef.current + 1) % activeQuotesPool.length
    quoteIdxRef.current = nextIdx
    setQuoteIdx(nextIdx)
    setStudyQuote(activeQuotesPool[nextIdx] ?? DEFAULT_STUDY_QUOTES[0])
  }, [activeQuotesPool])

  const handleToggleFocus = useCallback((targetFocus: FocusSubPoseId) => {
    if (busyRef.current) return
    playSound(targetFocus === 'yard-bench' ? 'bench' : 'paper-card')
    const next = focusIdRef.current === targetFocus ? null : targetFocus
    focusIdRef.current = next
    setFocusId(next)
    if (next !== 'study-shelf') setStudyQuote(null)
    if (next !== null && isNarrowViewportRef.current) setDirectoryOpen(false)
  }, [])

  function handleTriggerMailbox() {
    if (busyRef.current) return
    playSound('mailbox')
    showToast('已打开信箱，带去「关于我」木桌寄语匣盖章留念…', 'info')
    pendingFocusAfterNavRef.current = 'blank-table'
    void navigate('blank', { skipOpenSound: true })
  }

  const handleLeaveStamp = useCallback(() => {
    playSound('ink-stamp')
    const moodItem = STAMP_MOODS.find((m) => m.id === selectedStampMood) ?? STAMP_MOODS[0]
    const entry: GuestStampEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mood: moodItem.id,
      message: guestNoteInput.trim().slice(0, 48),
      createdAt: new Date().toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }),
    }
    const nextStamps = [entry, ...guestStampsRef.current].slice(0, 12)
    guestStampsRef.current = nextStamps
    setGuestStamps(nextStamps)
    try { localStorage.setItem('paper-home:guestbook', JSON.stringify(nextStamps)) } catch {}
    setGuestNoteInput('')
    setLatestStampReply(moodItem.reply)
    showToast(`已盖下「${moodItem.id}」访客印章`, 'success')
  }, [selectedStampMood, guestNoteInput, showToast])

  const activeDeepLinkItemSlug = useMemo(() => {
    if (postcardSeedItem?.slug) return postcardSeedItem.slug
    if (viewingProject?.scope === 'public') {
      const pub = publicData.projects.find((p) => p.id === viewingProject.project.id)
      return pub?.slug || viewingProject.project.id
    }
    if (viewingNote?.scope === 'public') {
      const pub = publicData.notes.find((n) => n.id === viewingNote.note.id)
      return pub?.slug || viewingNote.note.id
    }
    return null
  }, [postcardSeedItem, viewingProject, viewingNote, publicData.projects, publicData.notes])

  const activeDeepLinkOptions = useMemo(
    () => ({
      room: place,
      item: activeDeepLinkItemSlug,
      at: atmosphereMode,
      weather,
      focus: focusId,
      lamp: place === 'study' ? deskLampOn : undefined,
    }),
    [place, activeDeepLinkItemSlug, atmosphereMode, weather, focusId, deskLampOn],
  )

  const activeDeepLinkHash = useMemo(() => buildDeepLinkHash(activeDeepLinkOptions), [activeDeepLinkOptions])
  const activeDeepLinkUrl = useMemo(() => buildDeepLinkUrl(activeDeepLinkOptions), [activeDeepLinkOptions])

  const copyTextToClipboard = useCallback(async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand('copy')
        ta.remove()
        return ok
      } catch {
        return false
      }
    }
  }, [])

  const handleCopyDeepLink = useCallback(
    (overrideOpts?: Partial<Parameters<typeof buildDeepLinkUrl>[0]>) => {
      const opts = { ...activeDeepLinkOptions, ...overrideOpts }
      const url = buildDeepLinkUrl(opts)
      void copyTextToClipboard(url).then((ok) => {
        if (ok) {
          playSound('success-seal')
          showToast('已复制直达深链，打开即可回到此刻房间与天色', 'success')
        } else {
          showToast(`深链地址：${buildDeepLinkHash(opts)}`, 'info')
        }
      })
    },
    [activeDeepLinkOptions, copyTextToClipboard, showToast],
  )

  const handleOpenPostcard = useCallback(
    (seed?: { slug?: string | null; title: string } | null) => {
      if (busyRef.current || !ready) return
      const snap = captureCanvas.current?.() ?? null
      playSound('shutter')
      setViewingProject(null)
      setViewingNote(null)
      setMapOpen(false)
      setStudioMenuOpen(false)
      setAtmoPopoverOpen(false)
      setPostcardSeedItem(seed ?? null)
      setPostcardSnapshot(snap)
      setPostcardOpen(true)
    },
    [ready],
  )

  const handleSelectQuality = useCallback((next: Quality) => {
    saveQualityPreference(next)
    setQuality(next)
  }, [])

  const handleRecoverContextLoss = useCallback(() => {
    const stalePack = prevPackRef.current
    prevPackRef.current = null
    if (stalePack) disposeResourcePack(stalePack)
    clearResourcePacks()
    saveQualityPreference('low')
    setPack(null)
    setQuality('low')
    setContextLost(false)
    setReady(false)
    setLoadError('')
    setRetryTarget(null)
    setCanvasKey((k) => k + 1)
    setRetry((r) => r + 1)
  }, [])

  const activeAtmoMeta =
    ATMOSPHERE_OPTIONS.find((o) => o.id === atmospherePreset) ?? ATMOSPHERE_OPTIONS[1]

  return (
    <div
      className={`home-app place-${place} atmo-${atmospherePreset} weather-${weather} ${reduced ? 'reduced-motion' : ''} ${busy || anyModalOpen ? 'walking-paused' : ''} ${busy ? 'traveling' : ''} ${promoMode ? 'promo-clean' : ''}`}
      ref={root}
      onScroll={onWalkScroll}
      onKeyDown={(e) => {
        if (
          place !== 'hall' ||
          busy ||
          anyModalOpen ||
          (e.target instanceof Element && e.target.closest('button,input,textarea,select,a,dialog'))
        ) {
          return
        }
        if (['ArrowDown', 'PageDown', ' ', 'ArrowUp', 'PageUp'].includes(e.key)) {
          e.preventDefault()
          step(['ArrowUp', 'PageUp'].includes(e.key) ? -1 : 1)
        }
      }}
    >
      {place === 'hall' && <div className="walk-track" aria-hidden="true" />}
      <div className="world">
        <SceneBoundary onFailure={() => setReady(true)}>
          {fontReady && pack && !contextLost && (
            <Canvas
              key={canvasKey}
              role="img"
              aria-label="自然白昼中的住宅与庭院，可进入走廊及作品室、创作手记、关于我三个房间"
              shadows="percentage"
              dpr={[1, 1.5]}
              camera={{ ...initialCamera, near: 0.05, far: 200 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              onCreated={({ gl }) => {
                canvasCleanupRef.current?.()
                const dom = gl.domElement
                const onLost = (event: Event) => {
                  event.preventDefault()
                  setContextLost(true)
                }
                dom.addEventListener('webglcontextlost', onLost, false)
                loseContextForQaRef.current = qaEnabled
                  ? () => {
                      const ext = gl.getContext().getExtension('WEBGL_lose_context')
                      if (ext) {
                        ext.loseContext()
                        return true
                      }
                      const evt = new Event('webglcontextlost', { cancelable: true })
                      dom.dispatchEvent(evt)
                      return true
                    }
                  : null
                canvasCleanupRef.current = () => {
                  dom.removeEventListener('webglcontextlost', onLost, false)
                  loseContextForQaRef.current = null
                }
              }}
              fallback={
                <div className="scene-fallback">
                  小屋三维场景。使用「小屋地图」也可浏览所有房间。
                </div>
              }
            >
              <CameraController
                ref={camera}
                place={place}
                focusId={focusId}
                busy={busy}
                reduced={reduced}
                galleryIndex={galleryIndex}
                galleryCount={galleryProjects.length}
                progress={progress}
                onTransition={(value) => { transition.current = value }}
              />
              <World
                place={place}
                opening={opening}
                destination={destination}
                navigate={navigate}
                interact={interact}
                homeName={homeName}
                plaqueTitle={siteSettings.plaqueTitle}
                plaqueSubtitle={siteSettings.plaqueSubtitle}
                reduced={reduced}
                pack={pack}
                galleryProjects={galleryProjects}
                onCoverExpired={handleCoverExpired}
                atmospherePreset={atmospherePreset}
                weather={weather}
                deskLampOn={deskLampOn}
                onToggleDeskLamp={handleToggleDeskLamp}
                onDrawStudyQuote={handleDrawStudyQuote}
                onSelectFocus={handleToggleFocus}
                onTriggerMailbox={handleTriggerMailbox}
                onTapProp={handleTapProp}
                nowNotes={activeNowNotes}
                promoFrontDoorProgress={promoMode ? promoFrontDoorProgressRef : undefined}
              />
              {promoMode && <PromoRenderBridge bridgeRef={promoBridgeRef} />}
              <RenderPipeline
                quality={pack.quality}
                clearColor={getAtmosphereLighting(atmospherePreset, weather).clearColor}
                transition={transition}
                prepare={prepare}
                capture={captureCanvas}
                onPreparing={setPreparing}
                onReady={() => setReady(true)}
              />
            </Canvas>
          )}
        </SceneBoundary>
      </div>

      <header className="site-header">
        <button
          type="button"
          className="brand"
          onClick={() => void navigate('yard')}
          aria-label={`${homeName}，返回小院`}
          disabled={busy || !ready}
        >
          <Icon name="home" size={28} />
          <span>{homeName}</span>
        </button>

        {place !== 'yard' && (
          <nav className="room-switcher" aria-label="房间快捷切换">
            {rooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`room-switcher-btn ${place === r.id ? 'active' : ''}`}
                aria-label={`前往${r.name}`}
                aria-current={place === r.id ? 'page' : undefined}
                disabled={busy || !ready}
                onClick={() => void navigate(r.id)}
              >
                <Icon name={r.icon} size={14} />
                <span>{r.name}</span>
              </button>
            ))}
          </nav>
        )}

        <div className="header-actions">
          <div className="atmosphere-anchor" ref={atmoAnchorRef}>
            <div className="atmosphere-segmented" role="group" aria-label="小屋时光天色">
              {ATMOSPHERE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`atmo-option ${atmosphereMode === opt.id ? 'active' : ''}`}
                  aria-pressed={atmosphereMode === opt.id}
                  aria-label={`天色：${opt.label}`}
                  title={opt.id === 'auto' ? `跟随当地时间（当前：${activeAtmoMeta.label}）` : opt.label}
                  onClick={() => handleSelectAtmosphere(opt.id)}
                >
                  <Icon name={opt.icon} size={13} />
                  <span>{opt.label}</span>
                </button>
              ))}
              <button
                type="button"
                className={`weather-pill ${weather === 'rain' ? 'active' : ''}`}
                aria-pressed={weather === 'rain'}
                aria-label={weather === 'rain' ? '关闭细雨' : '开启细雨'}
                title="切换庭院细雨与雨声"
                onClick={handleToggleWeather}
              >
                <Icon name="rain" size={13} />
                <span>细雨</span>
              </button>
            </div>
            <button
              ref={atmoTriggerRef}
              type="button"
              className={`atmo-compact-trigger ${atmoPopoverOpen ? 'open' : ''}`}
              aria-expanded={atmoPopoverOpen}
              aria-haspopup="dialog"
              aria-label={`天色与天气（当前：${activeAtmoMeta.label}${weather === 'rain' ? '·细雨' : ''}）`}
              onClick={() => setAtmoPopoverOpen((v) => !v)}
            >
              <Icon name={weather === 'rain' ? 'rain' : activeAtmoMeta.icon} size={16} />
              <span>{activeAtmoMeta.label}{weather === 'rain' ? '·雨' : ''}</span>
            </button>
            {atmoPopoverOpen && (
              <div
                ref={atmoPopoverRef}
                className="atmo-popover"
                role="dialog"
                aria-label="切换天色与细雨"
                onKeyDown={(e) => handleMenuArrowNavigation(atmoPopoverRef.current, e)}
              >
                <div className="atmo-popover-grid">
                  {ATMOSPHERE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className={`atmo-popover-btn ${atmosphereMode === opt.id ? 'active' : ''}`}
                      onClick={() => {
                        handleSelectAtmosphere(opt.id)
                        setAtmoPopoverOpen(false)
                        requestAnimationFrame(() => atmoTriggerRef.current?.focus())
                      }}
                    >
                      <Icon name={opt.icon} size={14} />
                      <span>{opt.label}</span>
                    </button>
                  ))}
                  <button
                    type="button"
                    className={`atmo-popover-btn ${weather === 'rain' ? 'active' : ''}`}
                    onClick={() => {
                      handleToggleWeather()
                      setAtmoPopoverOpen(false)
                      requestAnimationFrame(() => atmoTriggerRef.current?.focus())
                    }}
                  >
                    <Icon name="rain" size={14} />
                    <span>{weather === 'rain' ? '细雨中' : '晴朗无雨'}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="quality-segmented" role="group" aria-label="画面质量">
            <button
              type="button"
              className={`quality-option ${quality === 'high' ? 'active' : ''}`}
              aria-pressed={quality === 'high'}
              disabled={busy}
              onClick={() => handleSelectQuality('high')}
            >
              <span className="quality-label-full">细致画质</span>
              <span className="quality-label-short" aria-hidden="true">细致</span>
            </button>
            <button
              type="button"
              className={`quality-option ${quality === 'low' ? 'active' : ''}`}
              aria-pressed={quality === 'low'}
              disabled={busy}
              onClick={() => handleSelectQuality('low')}
            >
              <span className="quality-label-full">兼容画质</span>
              <span className="quality-label-short" aria-hidden="true">兼容</span>
            </button>
          </div>
          <button
            type="button"
            className="motion-button"
            onClick={() => setReduced(!reduced)}
            aria-label={reduced ? '轻柔模式' : '漫游模式'}
            aria-pressed={reduced}
            title="减少镜头移动"
          >
            <Icon name="motion" size={18} />
            <span>{reduced ? '轻柔模式' : '漫游模式'}</span>
          </button>
          {isAdmin && (
            <div className="studio-anchor" ref={studioAnchorRef}>
              <button
                ref={studioTriggerRef}
                type="button"
                className={`admin-status-pill ${studioMenuOpen ? 'open' : ''}`}
                aria-expanded={studioMenuOpen}
                aria-haspopup="menu"
                aria-label="创作者工作台快捷菜单"
                onClick={() => setStudioMenuOpen((v) => !v)}
              >
                <span className="admin-live-dot" aria-hidden="true" />
                <span>编辑中</span>
                <Icon name={studioMenuOpen ? 'chevronUp' : 'chevronDown'} size={13} />
              </button>
              {studioMenuOpen && (
                <div
                  ref={studioPopoverRef}
                  className="studio-quick-popover"
                  role="menu"
                  aria-label="快捷创作入口"
                  onKeyDown={(e) => handleMenuArrowNavigation(studioPopoverRef.current, e)}
                >
                  <div className="studio-popover-head">
                    <strong>
                      {backendHealth.mode === 'local-studio' ? '本地编辑工作室' : '云端主人工作台'}
                    </strong>
                    <small>
                      {backendHealth.mode === 'local-studio'
                        ? '保存即写入 local-data/'
                        : adminEmail || '已登录'}
                    </small>
                  </div>
                  <div className="studio-popover-list">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStudioMenuOpen(false)
                        setEditingProject(null)
                        setProjectEditorOpen(true)
                      }}
                    >
                      <Icon name="frame" size={15} />
                      <span>新建作品</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStudioMenuOpen(false)
                        setEditingNote(null)
                        setNoteEditorOpen(true)
                      }}
                    >
                      <Icon name="book" size={15} />
                      <span>写新手记</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStudioMenuOpen(false)
                        setProfileEditorOpen(true)
                      }}
                    >
                      <Icon name="user" size={15} />
                      <span>编辑「关于我」</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setStudioMenuOpen(false)
                        setSettingsDraft({ ...siteSettings })
                        setSettingsExpanded(true)
                        setNameMessage('')
                        setMapOpen(true)
                      }}
                    >
                      <Icon name="sliders" size={15} />
                      <span>小屋名称与门牌设置</span>
                    </button>
                  </div>
                  <div className="studio-popover-foot">
                    <button
                      type="button"
                      role="menuitem"
                      className="studio-signout-btn"
                      disabled={signOutBusy}
                      onClick={() => void handleQuickSignOut()}
                    >
                      <span>
                        {signOutBusy
                          ? '正在退出…'
                          : backendHealth.mode === 'local-studio'
                            ? '退出编辑（访客预览）'
                            : '退出管理登录'}
                      </span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <button
            type="button"
            className={`map-button ${isAdmin ? 'admin-active' : ''}`}
            aria-label={isAdmin ? '小屋地图（主人已登录）' : '小屋地图'}
            onClick={() => {
              playSound('map-unfold')
              setStudioMenuOpen(false)
              setMapOpen(true)
              setSettingsDraft({ ...siteSettings })
              setSettingsExpanded(false)
              setNameMessage('')
            }}
            disabled={busy || !ready}
          >
            <Icon name="map" size={18} />
            <span>小屋地图</span>
          </button>
        </div>
      </header>

      <main>
        <div className="welcome-copy" key={place}>
          {place === 'yard' ? (
            <>
              <span className="welcome-eyebrow">
                {activeAtmoMeta.eyebrow}{weather === 'rain' ? ' · 细雨' : ''}
              </span>
              <h1 ref={title} tabIndex={-1}>{siteSettings.yardHeading}</h1>
              <p>{siteSettings.yardSubtitle}</p>
            </>
          ) : (
            <>
              <span className="welcome-eyebrow">{room.note}</span>
              <h1 ref={title} tabIndex={-1}>{room.name}</h1>
              <p>
                {place === 'hall' ? (
                  <>向上滑动，往家里走。<br />反向滑动可以退回来。</>
                ) : place === 'study' ? (
                  <>翻开一篇手记，<br />看看制作时的判断与调整。</>
                ) : place === 'gallery' ? (
                  <>点开墙上的作品纸张，<br />或从目录查看详情与演示。</>
                ) : (
                  <>认识小屋的主人，<br />和正在专注的事。</>
                )}
              </p>
            </>
          )}
        </div>

        {ready && !busy && !(isNarrowViewport && directoryOpen) && (place === 'yard' || place === 'study' || place === 'blank') && (
          <div ref={tactileBarRef} className="tactile-bar" role="group" aria-label="房间互动小物件">
            {place === 'yard' && (
              <>
                <button
                  type="button"
                  className={`tactile-pill ${focusId === 'yard-bench' ? 'active' : ''}`}
                  aria-pressed={focusId === 'yard-bench'}
                  onClick={() => handleToggleFocus('yard-bench')}
                >
                  <Icon name="bench" size={14} />
                  <span>{focusId === 'yard-bench' ? '起身看全院' : '坐上木椅'}</span>
                </button>
                <button
                  type="button"
                  className="tactile-pill"
                  onClick={handleTriggerMailbox}
                >
                  <Icon name="mail" size={14} />
                  <span>寄语信箱</span>
                </button>
              </>
            )}
            {place === 'study' && (
              <>
                <button
                  type="button"
                  className={`tactile-pill ${deskLampOn ? 'active' : ''}`}
                  aria-pressed={deskLampOn}
                  onClick={handleToggleDeskLamp}
                >
                  <Icon name="lamp" size={14} />
                  <span>{deskLampOn ? '台灯：已点亮' : '点亮书桌台灯'}</span>
                </button>
                <button
                  type="button"
                  className={`tactile-pill ${studyQuote !== null ? 'active' : ''}`}
                  onClick={handleDrawStudyQuote}
                >
                  <Icon name="book" size={14} />
                  <span>抽一张书架灵感签</span>
                </button>
              </>
            )}
            {place === 'blank' && (
              <button
                type="button"
                className={`tactile-pill ${focusId === 'blank-table' ? 'active' : ''}`}
                aria-pressed={focusId === 'blank-table'}
                onClick={() => handleToggleFocus('blank-table')}
              >
                <Icon name="stamp" size={14} />
                <span>
                  {focusId === 'blank-table'
                    ? '收起桌面近况与寄语匣'
                    : `桌面近况与寄语匣 (${guestStamps.length})`}
                </span>
              </button>
            )}
          </div>
        )}

        {place === 'yard' && focusId === 'yard-bench' && (
          <div className="tactile-floating-card bench-card" role="region" aria-label="庭院木椅视角">
            <div className="tactile-card-head">
              <strong>庭院木长椅 · 仰望屋檐</strong>
              <button
                type="button"
                className="tactile-card-close"
                data-sound="modal-close"
                aria-label="起身回到小院全景"
                onClick={() => setFocusId(null)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <p>
              坐在老树下的长椅往上看，窗子后面就是真实的走廊、书桌与画架。你可以试着在顶栏切换「落日」「夜灯」或「细雨」，看屋里亮起的暖光。
            </p>
          </div>
        )}

        {place === 'study' && studyQuote && (
          <div className="tactile-floating-card quote-card" role="region" aria-label="书架灵感签">
            <div className="tactile-card-head">
              <strong>书架夹页灵感签</strong>
              <div className="tactile-card-actions">
                <button
                  type="button"
                  className="tactile-mini-btn"
                  onClick={handleDrawStudyQuote}
                >
                  换一张
                </button>
                <button
                  type="button"
                  className="tactile-card-close"
                  data-sound="modal-close"
                  aria-label="合上灵感签"
                  onClick={() => {
                    setStudyQuote(null)
                    if (focusId === 'study-shelf') setFocusId(null)
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
            <blockquote>「{studyQuote}」</blockquote>
          </div>
        )}

        {place === 'blank' && focusId === 'blank-table' && (
          <div className="tactile-floating-card guestbox-card" role="region" aria-label="木桌近况便签与访客寄语匣">
            <div className="tactile-card-head">
              <strong>木桌近况便签 · 访客寄语匣</strong>
              <button
                type="button"
                className="tactile-card-close"
                data-sound="modal-close"
                aria-label="收起桌面寄语匣"
                onClick={() => setFocusId(null)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="now-notes-strip" aria-label="主人近况便签">
              {activeNowNotes.map((note, idx) => (
                <div key={idx} className="now-note-chip">
                  <small>NOW · 0{idx + 1}</small>
                  <span>{note}</span>
                </div>
              ))}
            </div>

            <div className="guestbox-section">
              <div className="guestbox-head">
                <span>选一枚印章，留在木匣里</span>
                <small>已收集 {guestStamps.length} 枚足迹</small>
              </div>
              <div ref={moodGroupRef} className="guestbox-moods" role="radiogroup" aria-label="选择印章心情">
                {STAMP_MOODS.map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    tabIndex={selectedStampMood === m.id ? 0 : -1}
                    aria-checked={selectedStampMood === m.id}
                    className={`stamp-mood-btn ${selectedStampMood === m.id ? 'active' : ''}`}
                    onClick={() => setSelectedStampMood(m.id)}
                    onKeyDown={(e) => {
                      let nextIdx = -1
                      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                        nextIdx = (idx + 1) % STAMP_MOODS.length
                      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                        nextIdx = (idx - 1 + STAMP_MOODS.length) % STAMP_MOODS.length
                      } else if (e.key === 'Home') {
                        nextIdx = 0
                      } else if (e.key === 'End') {
                        nextIdx = STAMP_MOODS.length - 1
                      }
                      if (nextIdx < 0) return
                      e.preventDefault()
                      setSelectedStampMood(STAMP_MOODS[nextIdx].id)
                      moodGroupRef.current
                        ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                        [nextIdx]?.focus()
                    }}
                  >
                    {m.id}
                  </button>
                ))}
              </div>
              <div className="guestbox-input-row">
                <input
                  type="text"
                  maxLength={36}
                  value={guestNoteInput}
                  onChange={(e) => setGuestNoteInput(e.target.value)}
                  placeholder="附一句简短纸条（可选，最多 36 字）"
                  aria-label="访客寄语短句"
                />
                <button type="button" className="stamp-submit-btn" onClick={handleLeaveStamp}>
                  盖章留念
                </button>
              </div>
              {latestStampReply && (
                <p className="stamp-reply-banner" role="status">{latestStampReply}</p>
              )}
              {guestStamps.length > 0 && (
                <ul className="guest-stamp-list" aria-label="最近的访客印章">
                  {guestStamps.slice(0, 4).map((item) => (
                    <li key={item.id}>
                      <span className="stamp-badge">{item.mood}</span>
                      <span className="stamp-text">{item.message || '轻轻路过，盖下一枚印章'}</span>
                      <time>{item.createdAt.slice(0, 10)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {inside && directoryOpen && (
          <aside
            id="room-directory"
            className={`room-content ${isNarrowViewport ? 'mobile-drawer' : ''}`}
            aria-label={`${room.name}的内容`}
          >
            <RoomDirectory
              place={place}
              isAdmin={isAdmin}
              cloudLoading={cloudLoading}
              cloudError={cloudError}
              adminError={adminError}
              publicData={publicData}
              adminData={adminData}
              reorderBusy={reorderBusy}
              onCloseDirectory={() => setDirectoryOpen(false)}
              onRetryCloud={() => void loadPublic()}
              onOpenPublicProject={openPublicProject}
              onOpenAdminProjectPreview={openAdminProjectPreview}
              onOpenProjectEditor={(project) => { setEditingProject(project); setProjectEditorOpen(true) }}
              onReorderProject={(idx, delta) => void handleReorderProject(idx, delta)}
              onOpenPublicNote={openPublicNote}
              onOpenAdminNotePreview={openAdminNotePreview}
              onOpenNoteEditor={(note) => { setEditingNote(note); setNoteEditorOpen(true) }}
              onReorderNote={(idx, delta) => void handleReorderNote(idx, delta)}
              onOpenProfileEditor={() => setProfileEditorOpen(true)}
              onCopyEmail={(email) => void handleCopyEmail(email)}
              onNavigateHall={() => void navigate('hall')}
            />
          </aside>
        )}

        {place === 'gallery' && !directoryOpen && (
          <div className="gallery-viewer" role="group" aria-label="逐件浏览作品">
            {publishedProjects.length === 0 ? (
              <div className="gallery-empty-pill">
                <span>{cloudLoading ? '正在加载作品…' : '暂无已发布作品'}</span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  aria-label="上一件作品"
                  data-sound="paper-card"
                  disabled={busy || galleryIndex <= 0}
                  onClick={() => setGalleryIndex((i) => Math.max(0, i - 1))}
                >
                  <Icon name="back" size={20} />
                </button>
                <button
                  type="button"
                  className="gallery-current"
                  data-sound="paper-flip"
                  onClick={() => openPublicProject(galleryIndex)}
                  disabled={busy || !activeMobileProject}
                  aria-label={`展开《${activeMobileProject?.title ?? ''}》`}
                >
                  <span aria-live="polite">
                    {activeMobileProject?.title}
                    <small>{galleryIndex + 1} / {publishedProjects.length}</small>
                  </span>
                  <Icon name="frame" size={18} />
                </button>
                <button
                  type="button"
                  aria-label="下一件作品"
                  data-sound="paper-card"
                  disabled={busy || galleryIndex >= publishedProjects.length - 1}
                  onClick={() => setGalleryIndex((i) => Math.min(publishedProjects.length - 1, i + 1))}
                >
                  <Icon name="arrow" size={20} />
                </button>
              </>
            )}
          </div>
        )}

        <nav className={`journey-nav ${place === 'yard' ? 'yard-nav' : ''}`} aria-label="房间导航">
          {place === 'yard' ? (
            <button
              key="yard-enter"
              type="button"
              className="enter-button"
              onClick={() => {
                playSound('door-knock')
                if (doorKnockTimerRef.current !== null) window.clearTimeout(doorKnockTimerRef.current)
                doorKnockTimerRef.current = window.setTimeout(() => {
                  doorKnockTimerRef.current = null
                  playSound('door-open')
                }, 220)
                void navigate('hall', { skipOpenSound: true })
              }}
              disabled={busy || !ready}
            >
              <span>{busy ? '门开了，进来吧…' : '敲敲门，进来坐坐'}</span>
              <Icon name="arrow" />
            </button>
          ) : (
            <>
              <button key="inside-back" type="button" className="back-button" onClick={() => void navigate(backPlace)} disabled={busy || !ready}>
                <Icon name="back" size={18} />
                <span>{place === 'hall' ? '回到小院' : '返回走廊'}</span>
              </button>

              {inside && (
                <div className="gallery-nav-actions">
                  {isAdmin && !directoryOpen && place === 'gallery' && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => { setEditingProject(null); setProjectEditorOpen(true) }}
                    >
                      <Icon name="plus" size={16} />
                      <span>添加作品</span>
                    </button>
                  )}
                  {isAdmin && !directoryOpen && place === 'study' && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => { setEditingNote(null); setNoteEditorOpen(true) }}
                    >
                      <Icon name="plus" size={16} />
                      <span>写手记</span>
                    </button>
                  )}
                  {isAdmin && !directoryOpen && place === 'blank' && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => setProfileEditorOpen(true)}
                    >
                      <Icon name="pencil" size={15} />
                      <span>编辑介绍</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className={`directory-toggle ${directoryOpen ? 'active' : ''}`}
                    data-sound="drawer-slide"
                    aria-expanded={directoryOpen}
                    aria-controls="room-directory"
                    onClick={() => {
                      const next = !directoryOpen
                      if (next && isNarrowViewport) {
                        setFocusId(null)
                        setStudyQuote(null)
                      }
                      setDirectoryOpen(next)
                    }}
                  >
                    <Icon name={room.icon} size={17} />
                    <span>
                      {place === 'gallery'
                        ? isAdmin
                          ? '作品管理'
                          : '作品目录'
                        : place === 'study'
                          ? isAdmin
                            ? '手记管理'
                            : '手记目录'
                          : isAdmin
                            ? '介绍管理'
                            : '个人介绍'}
                    </span>
                  </button>
                </div>
              )}

              {place === 'hall' && (
                <div className="walk-actions">
                  <div className="walk-steps">
                    <button type="button" onClick={() => step(-1)} disabled={busy || !ready} aria-label="后退一段">
                      <Icon name="back" size={18} />
                    </button>
                    <button type="button" onClick={() => step(1)} disabled={busy || !ready || atEnd} aria-label="前进一段">
                      <Icon name="arrow" size={18} />
                    </button>
                  </div>
                  {nearby && (
                    <button type="button" className="near-door" onClick={() => void navigate(nearby)} disabled={busy || !ready}>
                      进入{rooms.find((r) => r.id === nearby)?.name}
                      <Icon name="arrow" size={19} />
                    </button>
                  )}
                  {!nearby && (
                    <span className="walk-hint">{atEnd ? '走到家的深处了，可以慢慢往回逛' : '滚动或上滑，继续往里走'}</span>
                  )}
                </div>
              )}
            </>
          )}
        </nav>

        {!ready && !loadError && !contextLost && (
          <div className="loading-note" role="status">
            {preparing || `正在准备小屋与庭院… ${Math.round(loadProgress * 100)}%`}
          </div>
        )}
        {contextLost && (
          <div className="load-error context-lost-card" role="alertdialog" aria-labelledby="webgl-lost-title">
            <h2 id="webgl-lost-title">三维画面暂时中断</h2>
            <p>
              当前浏览器的图形显存暂时被释放或设备内存偏紧，切换至轻量的「兼容画质」可以更流畅地打开小屋。
            </p>
            <div className="context-lost-actions">
              <button type="button" onClick={handleRecoverContextLoss}>
                切换兼容画质并重试
              </button>
              <button
                type="button"
                className="context-lost-secondary"
                onClick={() => setMapOpen(true)}
              >
                用小屋地图浏览
              </button>
            </div>
          </div>
        )}
        {loadError && !contextLost && (
          <div className="load-error" role="alert">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={() => {
                setLoadError('')
                if (retryTarget) { const target = retryTarget; setRetryTarget(null); void navigate(target) }
                else setRetry((v) => v + 1)
              }}
            >
              重新加载
            </button>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div className="place-indicator">
          <Icon name={place === 'yard' ? (weather === 'rain' ? 'rain' : activeAtmoMeta.icon) : room.icon} size={18} />
          <span>
            {place === 'yard'
              ? `${activeAtmoMeta.footerText}${weather === 'rain' ? ' · 细雨微凉' : ''}`
              : `你在${room.name}`}
          </span>
        </div>
        <div className="footer-right">
          <span className="interaction-hint">
            {place === 'yard' ? '点一下门，故事就开始了' : place === 'hall' ? '沿走廊走走，遇见一扇喜欢的门' : '在这里，待一会儿也没关系'}
          </span>
          <button
            type="button"
            className="postcard-button"
            data-sound="shutter"
            aria-label="拍一张纸质明信片"
            title="生成纸质明信片与此刻深链"
            disabled={busy || !ready}
            onClick={() => handleOpenPostcard()}
          >
            <Icon name="postcard" size={16} />
            <span>拍明信片</span>
          </button>
          <button
            type="button"
            className={`sfx-button ${sfxEnabled ? 'active' : ''}`}
            aria-label={sfxEnabled ? '关闭交互音效' : '开启交互音效'}
            aria-pressed={sfxEnabled}
            title={sfxEnabled ? '交互触感音效：开启' : '交互触感音效：静音'}
            onClick={handleToggleSfx}
          >
            <Icon name={sfxEnabled ? 'sfxOn' : 'sfxOff'} size={17} />
          </button>
          <button
            type="button"
            className={`ambient-button ${ambient ? 'active' : ''}`}
            aria-label={ambient ? '关闭环境声' : '开启环境声'}
            aria-pressed={ambient}
            title={ambient ? '环境声与雨声：开启' : '环境声与雨声：关闭'}
            onClick={() => {
              const next = !ambient
              playSound(next ? 'ambient-on' : 'ambient-off')
              setAmbient(next)
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path d="M4 9h4l5-4v14l-5-4H4z" />
              {ambient ? <path d="M16 8c3 2 3 6 0 8m3-11c5 4 5 10 0 14" /> : <path d="m17 9 5 6m-5 0 5-6" />}
            </svg>
          </button>
        </div>
      </footer>
      <p className="sr-only" role="status" aria-live="polite">
        {busy ? `正在前往${rooms.find((r) => r.id === destination)?.name || '下一个房间'}` : `已来到${room.name}`}
      </p>

      <Modal open={mapOpen} close={() => setMapOpen(false)} label="小屋地图" className="map-dialog">
        <h2>小屋地图</h2>
        <p className="dialog-intro">想去哪儿，推门就好。</p>
        <div className="floor-plan">
          {rooms.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`plan-${r.id} ${place === r.id ? 'current' : ''}`}
              onClick={() => void navigate(r.id)}
              aria-current={place === r.id ? 'location' : undefined}
            >
              <Icon name={r.icon} size={27} />
              <strong>{r.name}</strong>
              <span>{place === r.id ? '你在这里' : r.note}</span>
            </button>
          ))}
        </div>

        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmedName = settingsDraft.homeName.trim().slice(0, 12)
            if (!trimmedName) {
              setNameMessage('先为小屋写一个名字吧。')
              return
            }
            const nextPayload: SiteSettingsPayload = {
              ...settingsDraft,
              homeName: trimmedName,
              plaqueTitle: settingsDraft.plaqueTitle.trim().slice(0, 12) || DEFAULT_SITE_SETTINGS.plaqueTitle,
              plaqueSubtitle: settingsDraft.plaqueSubtitle.trim().slice(0, 24),
              yardHeading: settingsDraft.yardHeading.trim().slice(0, 24) || DEFAULT_SITE_SETTINGS.yardHeading,
              yardSubtitle: settingsDraft.yardSubtitle.trim().slice(0, 80),
              defaultAtmosphere: settingsDraft.defaultAtmosphere ?? 'daylight',
              defaultWeather: settingsDraft.defaultWeather ?? 'clear',
            }
            if (canPersistSiteSettings) {
              const savedHint =
                backendHealth.mode === 'local-studio'
                  ? '小屋名称与外观文字已保存到本机 local-data/。'
                  : '小屋名称与外观文字已保存到云端。'
              void (async () => {
                setSettingsBusy(true)
                setNameMessage('')
                try {
                  const res = await saveSiteSettingsApi(adminData?.siteSettingsVersion, nextPayload)
                  setSiteSettings(res.siteSettings)
                  setSettingsDraft(res.siteSettings)
                  await refreshCloud()
                  playSound('success-seal')
                  setNameMessage(savedHint)
                  showToast('小屋名称与外观文字已保存', 'success')
                } catch (err) {
                  if (err instanceof ConflictError) {
                    await refreshCloud()
                    setNameMessage('小屋设置在另一窗口已被修改，已为你同步最新内容。')
                  } else {
                    setNameMessage(err instanceof Error ? err.message : '保存失败，请重试。')
                  }
                } finally {
                  setSettingsBusy(false)
                }
              })()
              return
            }

            setSiteSettings((prev) => ({ ...prev, homeName: trimmedName }))
            try {
              localStorage.setItem('paper-home:name', trimmedName)
              playSound('success-seal')
              setNameMessage('小屋的名字记住了。')
              showToast('小屋的名字已记住', 'success')
            } catch {
              setNameMessage('名字已更新；当前浏览器无法保存，下次打开会恢复默认。')
            }
          }}
        >
          <div className="name-form-head">
            <label htmlFor="home-name">
              <Icon name="pencil" size={17} />
              给小屋起个名字
            </label>
            <span className="cms-char-count">{settingsDraft.homeName.length} / 12</span>
          </div>
          <div className="name-form-row">
            <input
              id="home-name"
              maxLength={12}
              value={settingsDraft.homeName}
              onChange={(e) => {
                setSettingsDraft((prev) => ({ ...prev, homeName: e.target.value }))
                setNameMessage('')
              }}
              placeholder="最多 12 个字"
              disabled={settingsBusy}
            />
            <button type="submit" disabled={settingsBusy}>
              {settingsBusy
                ? '保存中…'
                : canPersistSiteSettings
                  ? backendHealth.mode === 'local-studio'
                    ? '保存本机'
                    : '保存设置'
                  : '记住'}
            </button>
          </div>
          {canPersistSiteSettings && (
            <section className="site-extra-settings" aria-label="小屋文字外观设置">
              <button
                type="button"
                className="cms-ghost-btn"
                onClick={() => setSettingsExpanded((v) => !v)}
              >
                {settingsExpanded ? '收起门牌与迎客语设置' : '自定义门牌与小院迎客语'}
              </button>
              {settingsExpanded && (
                <div className="site-extra-fields">
                  <div className="cms-field">
                    <div className="cms-field-head">
                      <label htmlFor="plaque-title">门厅牌匾主标题</label>
                      <span className="cms-char-count">{settingsDraft.plaqueTitle.length} / 12</span>
                    </div>
                    <input
                      id="plaque-title"
                      maxLength={12}
                      value={settingsDraft.plaqueTitle}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, plaqueTitle: e.target.value }))}
                      placeholder={DEFAULT_SITE_SETTINGS.plaqueTitle}
                    />
                  </div>
                  <div className="cms-field">
                    <div className="cms-field-head">
                      <label htmlFor="plaque-subtitle">门厅牌匾副标题</label>
                      <span className="cms-char-count">{settingsDraft.plaqueSubtitle.length} / 24</span>
                    </div>
                    <input
                      id="plaque-subtitle"
                      maxLength={24}
                      value={settingsDraft.plaqueSubtitle}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, plaqueSubtitle: e.target.value }))}
                      placeholder={DEFAULT_SITE_SETTINGS.plaqueSubtitle}
                    />
                  </div>
                  <div className="cms-field">
                    <div className="cms-field-head">
                      <label htmlFor="yard-heading">小院欢迎大标题</label>
                      <span className="cms-char-count">{settingsDraft.yardHeading.length} / 24</span>
                    </div>
                    <input
                      id="yard-heading"
                      maxLength={24}
                      value={settingsDraft.yardHeading}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, yardHeading: e.target.value }))}
                      placeholder={DEFAULT_SITE_SETTINGS.yardHeading}
                    />
                  </div>
                  <div className="cms-field">
                    <div className="cms-field-head">
                      <label htmlFor="yard-subtitle">小院欢迎导语</label>
                      <span className="cms-char-count">{settingsDraft.yardSubtitle.length} / 80</span>
                    </div>
                    <input
                      id="yard-subtitle"
                      maxLength={80}
                      value={settingsDraft.yardSubtitle}
                      onChange={(e) => setSettingsDraft((prev) => ({ ...prev, yardSubtitle: e.target.value }))}
                      placeholder={DEFAULT_SITE_SETTINGS.yardSubtitle}
                    />
                  </div>
                  <div className="cms-field-row">
                    <div className="cms-field">
                      <div className="cms-field-head">
                        <label htmlFor="default-atmosphere">访客默认天色</label>
                      </div>
                      <select
                        id="default-atmosphere"
                        value={settingsDraft.defaultAtmosphere ?? 'daylight'}
                        onChange={(e) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            defaultAtmosphere: e.target.value as AtmosphereMode,
                          }))
                        }
                      >
                        <option value="daylight">晴昼（推荐）</option>
                        <option value="dawn">晨雾</option>
                        <option value="golden">落日</option>
                        <option value="night">夜灯</option>
                        <option value="auto">跟随访客当地时间</option>
                      </select>
                    </div>
                    <div className="cms-field">
                      <div className="cms-field-head">
                        <label htmlFor="default-weather">访客默认天气</label>
                      </div>
                      <select
                        id="default-weather"
                        value={settingsDraft.defaultWeather ?? 'clear'}
                        onChange={(e) =>
                          setSettingsDraft((prev) => ({
                            ...prev,
                            defaultWeather: e.target.value as WeatherMode,
                          }))
                        }
                      >
                        <option value="clear">晴朗无雨</option>
                        <option value="rain">细雨微凉</option>
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}
          <p className="name-message" role="status">
            {nameMessage ||
              (canPersistSiteSettings
                ? backendHealth.mode === 'local-studio'
                  ? '在本地编辑模式下保存后，会写入本机 local-data/ 并应用到所有页面。'
                  : '在主人登录状态下保存后，会同步到云端并应用给所有访客。'
                : '名字会保存在这台设备的浏览器里。')}
          </p>
        </form>

        <AdminAuthPanel
          adminEmail={adminEmail}
          pendingCleanupCount={adminData?.pendingCleanupCount ?? 0}
          backendHealth={backendHealth}
          hasContent={Boolean(
            (adminData?.projects.length ?? 0) > 0 ||
              (adminData?.notes.length ?? 0) > 0 ||
              adminData?.profile?.draft?.displayName ||
              adminData?.profile?.draft?.bio ||
              publicData.projects.length > 0 ||
              publicData.notes.length > 0 ||
              publicData.profile,
          )}
          onSignedIn={async () => {
            await refreshCloud()
            showToast(
              backendHealth.mode === 'local-studio' ? '已进入本地编辑模式' : '已登录主人管理模式',
              'success',
            )
          }}
          onSignedOut={async () => {
            adminSeqRef.current += 1
            clearSignedUrlCache()
            setAdminEmail(null)
            setAdminData(null)
            await loadPublic()
            showToast('已切换为访客浏览视图', 'info')
          }}
          onRetryCleanup={async () => {
            const res = await cleanupMediaAssetsApi({ sweepOrphans: true })
            setAdminData((prev) => (prev ? { ...prev, pendingCleanupCount: res.remaining } : prev))
            showToast('旧素材清理检查完成', 'info')
          }}
          onImportSample={async () => {
            await initLocalSampleApi(false)
            await refreshCloud()
            showToast('已导入初始示例内容', 'success')
          }}
        />
      </Modal>

      <Suspense fallback={null}>
        {projectEditorMounted && (
          <ProjectEditorModal
            open={projectEditorOpen}
            initialProject={editingProject}
            assets={adminData?.assets ?? {}}
            onAssetUploaded={registerUploadedAsset}
            onSaved={handleProjectSaved}
            onDeleted={handleProjectDeleted}
            onPreview={(draft) => {
              setViewingProject({
                project: draft,
                scope: 'admin',
                isPreview: true,
                publicIndex: null,
                adminItem: editingProject ?? undefined,
              })
            }}
            onConflict={(c) => setConflict(c)}
            onClose={() => setProjectEditorOpen(false)}
          />
        )}

        {noteEditorMounted && (
          <NoteEditorModal
            open={noteEditorOpen}
            initialNote={editingNote}
            projects={adminData?.projects ?? []}
            assets={adminData?.assets ?? {}}
            onAssetUploaded={registerUploadedAsset}
            onSaved={handleNoteSaved}
            onDeleted={handleNoteDeleted}
            onPreview={(draft) => {
              setViewingNote({
                note: draft,
                scope: 'admin',
                isPreview: true,
                publicIndex: null,
                adminItem: editingNote ?? undefined,
              })
            }}
            onConflict={(c) => setConflict(c)}
            onClose={() => setNoteEditorOpen(false)}
          />
        )}

        {profileEditorMounted && (
          <ProfileEditorModal
            open={profileEditorOpen}
            initialProfile={adminData?.profile ?? null}
            assets={adminData?.assets ?? {}}
            onAssetUploaded={registerUploadedAsset}
            onSaved={handleProfileSaved}
            onConflict={(c) => setConflict(c)}
            onClose={() => setProfileEditorOpen(false)}
          />
        )}

        {projectDetailMounted && (
          <ProjectDetailModal
            open={viewingProject !== null}
            project={viewingProject?.project ?? null}
            scope={viewingProject?.scope ?? 'public'}
            isPreview={viewingProject?.isPreview ?? false}
            linkedNotes={viewingProjectLinkedNotes}
            totalCount={viewingProject?.publicIndex !== null ? publishedProjects.length : 1}
            currentIndex={viewingProject?.publicIndex ?? 0}
            onStep={
              viewingProject?.publicIndex !== null && publishedProjects.length > 1
                ? (delta) => {
                    const idx = viewingProject?.publicIndex ?? 0
                    const next = (idx + delta + publishedProjects.length) % publishedProjects.length
                    openPublicProject(next)
                  }
                : undefined
            }
            onOpenNote={(noteId) => {
              if (viewingProject?.scope === 'admin' && adminData) {
                const match = adminData.notes.find((n) => n.id === noteId)
                if (match) openAdminNotePreview(match)
              } else {
                const pubIdx = publicData.notes.findIndex((n) => n.id === noteId)
                if (pubIdx >= 0) openPublicNote(pubIdx)
              }
            }}
            onCopyDeepLink={
              viewingProject?.scope === 'public'
                ? () => {
                    const pub = publicData.projects.find((p) => p.id === viewingProject.project.id)
                    handleCopyDeepLink({ room: 'gallery', item: pub?.slug || viewingProject.project.id })
                  }
                : undefined
            }
            onOpenPostcard={
              viewingProject?.scope === 'public'
                ? () => {
                    const pub = publicData.projects.find((p) => p.id === viewingProject.project.id)
                    handleOpenPostcard({
                      slug: pub?.slug || viewingProject.project.id,
                      title: viewingProject.project.title || '作品',
                    })
                  }
                : undefined
            }
            onEdit={
              isAdmin && viewingProject && !projectEditorOpen
                ? () => {
                    const target =
                      viewingProject.adminItem ??
                      adminData?.projects.find((p) => p.id === viewingProject.project.id) ??
                      null
                    if (target) {
                      setViewingProject(null)
                      setEditingProject(target)
                      setProjectEditorOpen(true)
                    }
                  }
                : undefined
            }
            onClose={() => setViewingProject(null)}
          />
        )}

        {noteDetailMounted && (
          <NoteDetailModal
            open={viewingNote !== null}
            note={viewingNote?.note ?? null}
            scope={viewingNote?.scope ?? 'public'}
            isPreview={viewingNote?.isPreview ?? false}
            linkedProject={viewingNoteLinkedProject}
            totalCount={viewingNote?.publicIndex !== null ? publicData.notes.length : 1}
            currentIndex={viewingNote?.publicIndex ?? 0}
            onStep={
              viewingNote?.publicIndex !== null && publicData.notes.length > 1
                ? (delta) => {
                    const idx = viewingNote?.publicIndex ?? 0
                    const next = (idx + delta + publicData.notes.length) % publicData.notes.length
                    openPublicNote(next)
                  }
                : undefined
            }
            onOpenProject={(projectId) => {
              if (viewingNote?.scope === 'admin' && adminData) {
                const match = adminData.projects.find((p) => p.id === projectId)
                if (match) openAdminProjectPreview(match)
              } else {
                const pubIdx = publicData.projects.findIndex((p) => p.id === projectId)
                if (pubIdx >= 0) openPublicProject(pubIdx)
              }
            }}
            onCopyDeepLink={
              viewingNote?.scope === 'public'
                ? () => {
                    const pub = publicData.notes.find((n) => n.id === viewingNote.note.id)
                    handleCopyDeepLink({ room: 'study', item: pub?.slug || viewingNote.note.id })
                  }
                : undefined
            }
            onOpenPostcard={
              viewingNote?.scope === 'public'
                ? () => {
                    const pub = publicData.notes.find((n) => n.id === viewingNote.note.id)
                    handleOpenPostcard({
                      slug: pub?.slug || viewingNote.note.id,
                      title: viewingNote.note.title || '手记',
                    })
                  }
                : undefined
            }
            onEdit={
              isAdmin && viewingNote && !noteEditorOpen
                ? () => {
                    const target =
                      viewingNote.adminItem ??
                      adminData?.notes.find((n) => n.id === viewingNote.note.id) ??
                      null
                    if (target) {
                      setViewingNote(null)
                      setEditingNote(target)
                      setNoteEditorOpen(true)
                    }
                  }
                : undefined
            }
            onClose={() => setViewingNote(null)}
          />
        )}

        {postcardMounted && (
          <PostcardModal
            open={postcardOpen}
            snapshotDataUrl={postcardSnapshot}
            homeName={homeName}
            plaqueTitle={siteSettings.plaqueTitle}
            room={place}
            roomName={room.name}
            atmospherePreset={atmospherePreset}
            weather={weather}
            itemLabel={postcardSeedItem?.title ?? null}
            nowNote={activeNowNotes[0] ?? null}
            deepLinkUrl={activeDeepLinkUrl}
            deepLinkHash={activeDeepLinkHash}
            onCopyDeepLink={() => handleCopyDeepLink()}
            onNotify={showToast}
            onClose={() => {
              setPostcardOpen(false)
              setPostcardSeedItem(null)
              setPostcardSnapshot(null)
            }}
          />
        )}

        {conflictMounted && (
          <ConflictDialog conflict={conflict} onClose={() => setConflict(null)} />
        )}
      </Suspense>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
