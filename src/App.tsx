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
  DEFAULT_NOW_NOTES,
  DEFAULT_NOW_NOTES_EN,
  DEFAULT_STUDY_QUOTES,
  DEFAULT_STUDY_QUOTES_EN,
  getAtmosphereLighting,
  getLocalizedAtmosphereOptions,
  isValidAtmosphereMode,
  isValidWeatherMode,
  resolveAtmospherePreset,
} from './atmosphere'
import { getLocalizedRooms, type Place } from './content'
import {
  I18nContext,
  resolveInitialLocale,
  saveLocalePreference,
  type Locale,
} from './lib/i18n'
import { qaEnabled } from './diagnostics'
import { layout, roomPoint, stopProgress, type FocusSubPoseId, type TransitionState } from './layout'
import { clearResourcePacks, disposeResourcePack, loadResources, type Quality, type ResourcePack } from './resources'
import { resolveInitialQuality, saveQualityPreference } from './lib/quality'
import { RenderPipeline } from './RenderPipeline'
import {
  cleanupMediaAssetsApi,
  exportLocalSnapshotApi,
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
import { LazyModalBoundary } from './components/LazyModalBoundary'
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

class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void; locale?: Locale }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() {
    const isEn = this.props.locale === 'en'
    return this.state.failed ? (
      <div className="scene-fallback">
        <Icon name="home" size={60} />
        <p>
          {isEn ? (
            <>The 3D cottage could not be opened.<br />You can still browse all rooms via the Cottage Map.</>
          ) : (
            <>三维小屋暂时没有打开。<br />你仍可以通过「小屋地图」浏览所有房间。</>
          )}
        </p>
        <button type="button" onClick={() => window.location.reload()}>
          {isEn ? 'Reopen Cottage' : '重新打开小屋'}
        </button>
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
  {
    id: '☀️ 晴日来访',
    labelEn: '☀️ Sunlit Visit',
    reply: '谢谢你在晴天推门进来，愿你今天也有好心情。',
    replyEn: 'Thanks for stopping by on a sunny day—wishing you a bright mood ahead.',
  },
  {
    id: '🌧️ 听雨路过',
    labelEn: '🌧️ Rainy Drop-in',
    reply: '屋檐下的雨声留给你，累了随时来坐坐。',
    replyEn: 'The rain under the eaves is yours—drop by and rest anytime.',
  },
  {
    id: '🕯️ 夜灯共鸣',
    labelEn: '🕯️ Night Lamp Glow',
    reply: '深夜亮着的那盏绿台灯，很高兴被你看见。',
    replyEn: 'Glad you spotted the green desk lamp glowing late into the night.',
  },
  {
    id: '🌱 留下一颗松果',
    labelEn: '🌱 Left a Pinecone',
    reply: '已收进木匣里，下次来小院一起看树长大。',
    replyEn: 'Tucked safely in the wooden box—let’s watch the courtyard tree grow next time.',
  },
]

const PROP_TAP_EN: Record<string, string> = {
  '枝叶在房间光线里微微摇晃': 'Leaves sway gently in the room light',
  '实木铭牌微凉沉稳，推开窗就是小院': 'Cool solid wood plaque—the courtyard lies just outside the window',
  '轻叩手捏素烧陶罐，传出温和清脆的窑音': 'A gentle tap on the unglazed ceramic jar rings with a warm tone',
  '轻叩门牌，木纹温润沉稳': 'Warm, steady wood grain beneath your fingertips',
  '风吹过院子里的老树，叶片沙沙作响': 'A breeze rustles through the old courtyard tree',
  '门廊旁的绿植轻轻晃了晃': 'The porch foliage sways softly',
  '窗边花盆的叶片轻轻晃动': 'The windowsill leaves gently nod',
}

function localizedSiteDefault(value: string, defaultZh: string, defaultEn: string, locale: Locale): string {
  const trimmed = value.trim()
  if (!trimmed) return locale === 'en' ? defaultEn : defaultZh
  if (locale === 'en' && trimmed === defaultZh) return defaultEn
  return value
}

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
  const [pendingHash, setPendingHash] = useState<ReturnType<typeof parseDeepLinkHash> | null>(null)
  const pendingDeepLinkItemRef = useRef<string | null>(initialDeepLink.item)
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale)
  const localeRef = useRef<Locale>(locale)
  localeRef.current = locale
  const setLocale = useCallback((next: Locale) => {
    localeRef.current = next
    setLocaleState(next)
    saveLocalePreference(next)
  }, [])
  const toggleLocale = useCallback(() => {
    const next: Locale = localeRef.current === 'zh' ? 'en' : 'zh'
    setLocale(next)
  }, [setLocale])
  const tr = useCallback((zh: string, en: string) => (locale === 'en' ? en : zh), [locale])
  const trLive = useCallback((zh: string, en: string) => (localeRef.current === 'en' ? en : zh), [])
  const i18nValue = useMemo(
    () => ({ locale, setLocale, toggleLocale, tr }),
    [locale, setLocale, toggleLocale, tr],
  )
  const localizedRooms = useMemo(() => getLocalizedRooms(locale), [locale])
  const localizedAtmoOptions = useMemo(() => getLocalizedAtmosphereOptions(locale), [locale])

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
  const hallLook = useRef(0)
  const [nearby, setNearby] = useState<Place | null>(null)
  const nearbyRef = useRef<Place | null>(nearby)
  nearbyRef.current = nearby
  const [atEnd, setAtEnd] = useState(false)
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  const readyRef = useRef(ready)
  readyRef.current = ready
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
  const [postcardSeedItem, setPostcardSeedItem] = useState<{ room: Place; slug?: string | null; title: string } | null>(null)
  const [conflict, setConflict] = useState<ConflictContext | null>(null)

  const isAdmin = Boolean(adminEmail && adminData)
  useEffect(() => {
    if (isAdmin) return
    setProjectEditorOpen(false)
    setNoteEditorOpen(false)
    setProfileEditorOpen(false)
    setConflict(null)
  }, [isAdmin])
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
      setCloudError(
        err instanceof Error
          ? err.message
          : trLive('公开内容读取失败，请稍后重试。', 'Failed to load public content. Please try again.'),
      )
    } finally {
      if (seq === publicSeqRef.current) {
        setCloudLoading(false)
      }
    }
  }, [trLive])

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
        setAdminEmail(trLive('本地主人', 'Local Owner'))
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

      const client = await getSupabaseClient()
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
      setAdminEmail(sess.session.user?.email ?? trLive('主人', 'Owner'))
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
        setAdminError(
          trLive(
            '当前无管理权限或登录已失效，已恢复访客视图。',
            'Editor permissions missing or session expired—switched back to visitor view.',
          ),
        )
      } else {
        setAdminError(
          err instanceof Error ? err.message : trLive('管理数据读取失败。', 'Failed to load owner data.'),
        )
      }
    }
  }, [trLive])

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
      const client = await getSupabaseClient()
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

    void resolveBackendHealth().then(async (health) => {
      if (!active) return
      setBackendHealth(health)
      if (health.mode === 'local-studio') {
        if (health.writable && isLocalOwnerActive()) {
          setAdminEmail(trLive('本地主人', 'Local Owner'))
          void loadAdmin()
        }
        return
      }
      if (health.mode !== 'cloud') return
      const client = await getSupabaseClient()
      if (!active) return
      void client.auth.getSession().then(({ data }) => {
        if (active && data.session?.access_token) {
          setAdminEmail(data.session.user?.email ?? trLive('主人', 'Owner'))
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
          setAdminEmail(session.user?.email ?? trLive('主人', 'Owner'))
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
      .catch(() => {
        if (active) {
          setLoadError(trLive('小屋素材没有加载完成。请重试。', 'Cottage assets failed to finish loading. Please retry.'))
        }
      })
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
    document.documentElement.lang = locale === 'en' ? 'en' : 'zh-CN'
  }, [locale])

  useEffect(() => {
    const rawName = siteSettings.homeName.trim() || DEFAULT_SITE_SETTINGS.homeName
    const rawPlaque = siteSettings.plaqueTitle.trim() || DEFAULT_SITE_SETTINGS.plaqueTitle
    const activeName = locale === 'en' && rawName === DEFAULT_SITE_SETTINGS.homeName ? 'My Cottage' : rawName
    const activePlaque = locale === 'en' && rawPlaque === DEFAULT_SITE_SETTINGS.plaqueTitle ? 'Welcome Home' : rawPlaque
    document.title = `${activeName} · ${activePlaque}`
  }, [siteSettings.homeName, siteSettings.plaqueTitle, locale])

  useEffect(() => {
    if (!richHashActiveRef.current && !pendingHash) {
      history.replaceState(null, '', `#${place}`)
    }
  }, [place, pendingHash])

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
    // Latest complete request wins; never partially apply a request during travel.
    richHashActiveRef.current = dl.isRich
    pendingDeepLinkItemRef.current = null
    setPendingHash(dl)
  }

  useEffect(() => {
    const dl = pendingHash
    if (!dl || busy || !ready) return
    if (dl.room !== place) {
      void navigate(dl.room, { preserveRichHash: dl.isRich, skipOpenSound: true, fromHash: true })
      return
    }
    if (dl.item && (cloudLoading || cloudError)) return
    if (dl.at) { userTouchedAtmoRef.current = true; setAtmosphereMode(dl.at) }
    if (dl.weather) { userTouchedAtmoRef.current = true; setWeather(dl.weather) }
    if (dl.lamp !== null) { userTouchedLampRef.current = true; setDeskLampOn(dl.lamp) }
    setFocusId(dl.focus)
    setViewingProject(null)
    setViewingNote(null)
    if (dl.item && dl.room === 'gallery') {
      const index = publicData.projects.findIndex(p => p.slug === dl.item || p.id === dl.item)
      if (index >= 0) openPublicProject(index)
    } else if (dl.item && dl.room === 'study') {
      const index = publicData.notes.findIndex(n => n.slug === dl.item || n.id === dl.item)
      if (index >= 0) openPublicNote(index)
    }
    setPendingHash(current => current === dl ? null : current)
    // navigate/open helpers use this render's current state; all readiness inputs are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingHash, busy, ready, place, cloudLoading, cloudError, publicData.projects, publicData.notes])

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
      locale,
      atmosphereMode,
      atmospherePreset,
      weather,
      deskLampOn,
      focusId,
      sfxEnabled,
      quality,
      contextLost,
      nearby,
      getHallProgress: () => progress.current,
      getHallLook: () => hallLook.current,
      loseWebglContext: () => loseContextForQaRef.current?.() ?? false,
    })
  }, [locale, atmosphereMode, atmospherePreset, weather, deskLampOn, focusId, sfxEnabled, quality, contextLost, nearby])

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

  useEffect(() => {
    if (place !== 'hall') {
      hallLook.current = 0
      return
    }
    const heldKeys = new Set<string>()
    let rafId: number | null = null
    let lastFrameTime = 0
    let lastStepSoundTime = 0
    let walkHoldStart = 0

    const isEditableTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('input,textarea,select,[contenteditable="true"],[contenteditable=""],dialog'))

    const isInteractiveTarget = (target: EventTarget | null) =>
      target instanceof Element &&
      Boolean(target.closest('button,a,input,textarea,select,[contenteditable="true"],[contenteditable=""],dialog,[role="menu"],[role="dialog"]'))

    const isBlocked = () =>
      busyRef.current ||
      !readyRef.current ||
      modalOpenRef.current ||
      Boolean(root.current?.querySelector('dialog[open]')) ||
      studioMenuOpen ||
      atmoPopoverOpen

    const updateLookTarget = () => {
      const lookLeft = heldKeys.has('KeyA') || heldKeys.has('ArrowLeft')
      const lookRight = heldKeys.has('KeyD') || heldKeys.has('ArrowRight')
      hallLook.current = lookLeft && !lookRight ? -0.45 : lookRight && !lookLeft ? 0.45 : 0
    }

    const getWalkDir = () => {
      const forward = heldKeys.has('KeyW') || heldKeys.has('ArrowUp')
      const backward = heldKeys.has('KeyS') || heldKeys.has('ArrowDown')
      return (forward ? 1 : 0) - (backward ? 1 : 0)
    }

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      lastFrameTime = 0
    }

    const clearHeld = () => {
      heldKeys.clear()
      hallLook.current = 0
      stopLoop()
    }

    const syncWalkProgress = (el: HTMLElement) => {
      progress.current = Math.max(0, Math.min(1, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)))
      const depth = 0.85 + progress.current * layout.walkLength
      setNearby(doorStops.find((d) => Math.abs(depth - (d.depth - 0.6)) < 0.85)?.id || null)
      setAtEnd(progress.current > 0.98)
    }

    const tick = (now: number) => {
      if (isBlocked() || !root.current) {
        clearHeld()
        return
      }
      const dir = getWalkDir()
      if (dir === 0) {
        stopLoop()
        return
      }
      const dt = lastFrameTime ? Math.min(0.08, (now - lastFrameTime) / 1000) : 0
      lastFrameTime = now
      // Start continuous glide after initial tap kick (~120ms)
      if (dt > 0 && now - walkHoldStart >= 120) {
        const el = root.current
        const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
        if (maxScroll > 0) {
          const walkSpeedMetersPerSec = 2.8
          const deltaPx = (dir * walkSpeedMetersPerSec * dt * maxScroll) / layout.walkLength
          const prevTop = el.scrollTop
          const nextTop = Math.max(0, Math.min(maxScroll, prevTop + deltaPx))
          if (Math.abs(nextTop - prevTop) > 0.25) {
            el.scrollTop = nextTop
            syncWalkProgress(el)
            if (now - lastStepSoundTime >= 480) {
              playSound('step')
              lastStepSoundTime = now
            }
          }
        }
      }
      rafId = requestAnimationFrame(tick)
    }

    const ensureLoop = () => {
      if (rafId === null) {
        lastFrameTime = performance.now()
        rafId = requestAnimationFrame(tick)
      }
    }

    const nudgeScroll = (meters: number) => {
      const el = root.current
      if (!el) return
      const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight)
      if (maxScroll <= 0) return
      const deltaPx = (meters * maxScroll) / layout.walkLength
      const prevTop = el.scrollTop
      const nextTop = Math.max(0, Math.min(maxScroll, prevTop + deltaPx))
      if (Math.abs(nextTop - prevTop) < 0.5) return
      playSound('step')
      lastStepSoundTime = performance.now()
      el.scrollTop = nextTop
      syncWalkProgress(el)
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isBlocked() || isEditableTarget(e.target)) return
      const code = e.code

      if (code === 'KeyW' || code === 'KeyS' || code === 'ArrowUp' || code === 'ArrowDown') {
        if (e.target instanceof Element && e.target.closest('[role="menu"],[role="dialog"]')) return
        e.preventDefault()
        const dir = code === 'KeyW' || code === 'ArrowUp' ? 1 : -1
        if (reducedRef.current) {
          step(dir)
          return
        }
        if (!heldKeys.has(code)) {
          heldKeys.add(code)
          walkHoldStart = performance.now()
          // Immediate responsive tap step; CameraController smooths the glide.
          nudgeScroll(dir * 0.55)
          ensureLoop()
        }
        return
      }

      if (code === 'KeyA' || code === 'KeyD' || code === 'ArrowLeft' || code === 'ArrowRight') {
        if (e.target instanceof Element && e.target.closest('[role="menu"],[role="dialog"]')) return
        e.preventDefault()
        if (!heldKeys.has(code)) {
          heldKeys.add(code)
          updateLookTarget()
        }
        return
      }

      if (code === 'PageDown' || code === 'PageUp') {
        if (isInteractiveTarget(e.target)) return
        e.preventDefault()
        step(code === 'PageUp' ? -1 : 1)
        return
      }

      if (code === 'Space') {
        if (isInteractiveTarget(e.target)) return
        e.preventDefault()
        step(e.shiftKey ? -1 : 1)
        return
      }

      if (code === 'Home' || code === 'End') {
        if (isInteractiveTarget(e.target)) return
        const el = root.current
        if (!el) return
        e.preventDefault()
        const targetTop = code === 'Home' ? 0 : Math.max(0, el.scrollHeight - el.clientHeight)
        playSound('step')
        if (reducedRef.current) {
          el.scrollTop = targetTop
          syncWalkProgress(el)
        } else {
          el.scrollTo({ top: targetTop, behavior: 'smooth' })
        }
        return
      }

      if (code === 'Enter' || code === 'KeyE') {
        if (code === 'Enter' && isInteractiveTarget(e.target)) return
        if (nearbyRef.current) {
          e.preventDefault()
          clearHeld()
          void navigatePromoRef.current(nearbyRef.current)
        }
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (heldKeys.delete(e.code)) {
        updateLookTarget()
        if (getWalkDir() === 0) stopLoop()
      }
    }

    const onVisibility = () => {
      if (document.hidden) clearHeld()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', clearHeld)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearHeld()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', clearHeld)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [place, studioMenuOpen, atmoPopoverOpen])

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

  async function navigate(target: Place, opts?: { skipOpenSound?: boolean; preserveRichHash?: boolean; fromHash?: boolean }) {
    if (busyRef.current || !ready) return
    if (!opts?.fromHash) setPendingHash(null)
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
      setLoadError(
        trLive(
          '目的地没有准备好，已留在当前房间。请重试。',
          'Destination is not ready yet—stayed in the current room. Please retry.',
        ),
      )
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
        showToast(trLive(`已复制联系邮箱：${email}`, `Copied email: ${email}`), 'success')
      } catch {
        showToast(
          trLive('浏览器未授权剪贴板，请长按或右键复制邮箱', 'Clipboard permission blocked—please copy the email manually'),
          'info',
        )
      }
    },
    [showToast, trLive],
  )

  async function handleQuickSignOut() {
    setProjectEditorOpen(false)
    setNoteEditorOpen(false)
    setProfileEditorOpen(false)
    setConflict(null)
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
        backendHealth.mode === 'local-studio'
          ? trLive('已退出编辑，切换为访客浏览视图', 'Exited Studio—switched to visitor view')
          : trLive('已切换为访客浏览视图', 'Switched to visitor view'),
        'info',
      )
    } catch (err) {
      showToast(err instanceof Error ? err.message : trLive('退出失败，请重试', 'Sign-out failed, please retry'), 'error')
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
    if (action === 'draft') showToast(trLive('作品草稿已保存', 'Project draft saved'), 'success')
    else if (action === 'publish') {
      playSound('success-seal')
      showToast(trLive('作品已发布到作品室', 'Project published to Gallery'), 'success')
    } else if (action === 'unpublish') {
      showToast(trLive('已撤回发布，草稿仍保留', 'Unpublished—draft kept safely'), 'info')
    }
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
    showToast(trLive('已删除作品', 'Project deleted'), 'info')
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
    if (action === 'draft') showToast(trLive('手记草稿已保存', 'Note draft saved'), 'success')
    else if (action === 'publish') {
      playSound('success-seal')
      showToast(trLive('手记已发布到创作手记', 'Note published to Study Notes'), 'success')
    } else if (action === 'unpublish') {
      showToast(trLive('已撤回发布，草稿仍保留', 'Unpublished—draft kept safely'), 'info')
    }
  }

  function handleNoteDeleted(deletedId: string, pendingCleanupCount: number) {
    setAdminData((prev) =>
      prev ? { ...prev, notes: prev.notes.filter((n) => n.id !== deletedId), pendingCleanupCount } : prev,
    )
    void loadPublic()
    showToast(trLive('已删除手记', 'Note deleted'), 'info')
  }

  function handleProfileSaved(saved: AdminProfile, pendingCleanupCount: number, action?: SaveActionKind) {
    setAdminData((prev) => (prev ? { ...prev, profile: saved, pendingCleanupCount } : prev))
    void loadPublic()
    if (action === 'draft') showToast(trLive('个人介绍草稿已保存', 'Profile draft saved'), 'success')
    else if (action === 'publish') {
      playSound('success-seal')
      showToast(trLive('“关于我”公开内容已更新', 'About Me page updated'), 'success')
    } else if (action === 'unpublish') {
      showToast(trLive('已撤回“关于我”公开展示', 'Unpublished About Me page'), 'info')
    }
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
      showToast(trLive('作品展示顺序已调整', 'Project order updated'), 'success')
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflict({
          title: trLive('作品排序', 'Project Order'),
          localCopyText: reordered.map((p, i) => `${i + 1}. ${p.draft.title}`).join('\n'),
          cloudSummaryLines: [
            trLive(
              `另一台设备刚调整过作品顺序（最新排序版本 v${err.orderVersion ?? '?'}）。`,
              `Another session just updated the project order (v${err.orderVersion ?? '?'}).`,
            ),
            trLive('请刷新后查看最新排序再重新调整。', 'Refresh to inspect the latest order before reordering.'),
          ],
          onUseCloud: () => {
            setConflict(null)
            void refreshCloud()
          },
        })
      } else {
        setAdminError(
          err instanceof Error
            ? err.message
            : trLive('调整作品顺序失败，请重试。', 'Failed to reorder projects. Please retry.'),
        )
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
      showToast(trLive('手记排序已调整', 'Note order updated'), 'success')
    } catch (err) {
      if (err instanceof ConflictError) {
        setConflict({
          title: trLive('手记排序', 'Note Order'),
          localCopyText: reordered.map((n, i) => `${i + 1}. ${n.draft.title}`).join('\n'),
          cloudSummaryLines: [
            trLive(
              `另一台设备刚调整过手记顺序（最新排序版本 v${err.orderVersion ?? '?'}）。`,
              `Another session just updated the note order (v${err.orderVersion ?? '?'}).`,
            ),
            trLive('请刷新后查看最新排序再重新调整。', 'Refresh to inspect the latest order before reordering.'),
          ],
          onUseCloud: () => {
            setConflict(null)
            void refreshCloud()
          },
        })
      } else {
        setAdminError(
          err instanceof Error
            ? err.message
            : trLive('调整手记顺序失败，请重试。', 'Failed to reorder notes. Please retry.'),
        )
      }
    } finally {
      setReorderBusy(false)
    }
  }

  const room = localizedRooms.find((r) => r.id === place)!
  const inside = place !== 'yard' && place !== 'hall'
  const backPlace: Place = place === 'hall' ? 'yard' : 'hall'

  const viewingProjectLinkedNotes: LinkedNoteRef[] = useMemo(() => {
    if (!viewingProject) return []
    const pid = viewingProject.project.id
    if (viewingProject.scope === 'admin' && adminData) {
      return adminData.notes
        .filter((n) => n.draft.projectId === pid)
        .map((n) => ({ id: n.id, title: n.draft.title || tr('未命名手记', 'Untitled Note'), isDraftOnly: !n.isPublished }))
    }
    return publicData.notes
      .filter((n) => n.projectId === pid)
      .map((n) => ({ id: n.id, title: n.title }))
  }, [adminData, publicData.notes, viewingProject, tr])

  const viewingNoteLinkedProject: LinkedProjectRef | null = useMemo(() => {
    if (!viewingNote?.note.projectId) return null
    const pid = viewingNote.note.projectId
    if (viewingNote.scope === 'admin' && adminData) {
      const match = adminData.projects.find((p) => p.id === pid)
      return match
        ? { id: match.id, title: match.draft.title || tr('未命名作品', 'Untitled Project'), isDraftOnly: !match.isPublished }
        : null
    }
    const pubMatch = publicData.projects.find((p) => p.id === pid)
    return pubMatch ? { id: pubMatch.id, title: pubMatch.title } : null
  }, [adminData, publicData.projects, viewingNote, tr])

  const publishedProjects = publicData.projects
  const activeMobileProject = publishedProjects[galleryIndex] ?? null

  const activeQuotesPool = useMemo(() => {
    const ownerQuotes = isAdmin
      ? adminData?.profile?.draft?.quotes
      : publicData.profile?.quotes
    const cleaned = (ownerQuotes ?? []).map((q) => q.trim()).filter(Boolean)
    if (cleaned.length > 0) return cleaned
    return locale === 'en' ? DEFAULT_STUDY_QUOTES_EN : DEFAULT_STUDY_QUOTES
  }, [isAdmin, adminData?.profile?.draft?.quotes, publicData.profile?.quotes, locale])

  const activeNowNotes = useMemo(() => {
    const ownerNow = isAdmin
      ? adminData?.profile?.draft?.nowNotes
      : publicData.profile?.nowNotes
    const cleaned = (ownerNow ?? []).map((n) => n.trim()).filter(Boolean)
    if (cleaned.length > 0) return cleaned
    return locale === 'en' ? DEFAULT_NOW_NOTES_EN : DEFAULT_NOW_NOTES
  }, [isAdmin, adminData?.profile?.draft?.nowNotes, publicData.profile?.nowNotes, locale])

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
    showToast(
      next
        ? trLive('已开启交互触感音效', 'Tactile sound effects enabled')
        : trLive('已静音交互触感音效', 'Tactile sound effects muted'),
      'info',
    )
  }, [showToast, trLive])

  const handleTapProp = useCallback((msg: string) => {
    const localized = localeRef.current === 'en' ? (PROP_TAP_EN[msg] ?? msg) : msg
    showToast(localized, 'info')
  }, [showToast])

  const handleToggleDeskLamp = useCallback(() => {
    userTouchedLampRef.current = true
    const next = !deskLampOnRef.current
    deskLampOnRef.current = next
    setDeskLampOn(next)
    playSound(next ? 'lamp-on' : 'lamp-off')
    showToast(
      next
        ? trLive('已点亮书房黄铜绿台灯', 'Green brass desk lamp turned on')
        : trLive('已关上书桌台灯', 'Desk lamp turned off'),
      'info',
    )
  }, [showToast, trLive])

  const handleDrawStudyQuote = useCallback(() => {
    if (busyRef.current) return
    playSound('paper-flip')
    if (isNarrowViewportRef.current) setDirectoryOpen(false)
    setFocusId('study-shelf')
    const nextIdx = (quoteIdxRef.current + 1) % activeQuotesPool.length
    quoteIdxRef.current = nextIdx
    setQuoteIdx(nextIdx)
    setStudyQuote(activeQuotesPool[nextIdx] ?? activeQuotesPool[0])
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
    showToast(
      trLive('已打开信箱，带去「关于我」木桌寄语匣盖章留念…', 'Mailbox opened—heading to the guestbook table in About Me…'),
      'info',
    )
    pendingFocusAfterNavRef.current = 'blank-table'
    void navigate('blank', { skipOpenSound: true })
  }

  const handleLeaveStamp = useCallback(() => {
    playSound('ink-stamp')
    const moodItem = STAMP_MOODS.find((m) => m.id === selectedStampMood) ?? STAMP_MOODS[0]
    const isEn = localeRef.current === 'en'
    const entry: GuestStampEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      mood: moodItem.id,
      message: guestNoteInput.trim().slice(0, 48),
      createdAt: new Date().toLocaleDateString(isEn ? 'en-US' : 'zh-CN', { month: 'short', day: 'numeric' }),
    }
    const nextStamps = [entry, ...guestStampsRef.current].slice(0, 12)
    guestStampsRef.current = nextStamps
    setGuestStamps(nextStamps)
    try { localStorage.setItem('paper-home:guestbook', JSON.stringify(nextStamps)) } catch {}
    setGuestNoteInput('')
    setLatestStampReply(isEn ? moodItem.replyEn : moodItem.reply)
    showToast(
      isEn ? `Stamped "${moodItem.labelEn}" in the guestbook` : `已盖下「${moodItem.id}」访客印章`,
      'success',
    )
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
      room: postcardSeedItem?.room ?? place,
      item: activeDeepLinkItemSlug,
      at: atmosphereMode,
      weather,
      focus: focusId,
      lamp: place === 'study' ? deskLampOn : undefined,
    }),
    [place, postcardSeedItem, activeDeepLinkItemSlug, atmosphereMode, weather, focusId, deskLampOn],
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
          showToast(
            trLive('已复制直达深链，打开即可回到此刻房间与天色', 'Deep link copied—open it to return to this exact room & sky'),
            'success',
          )
        } else {
          showToast(`${trLive('深链地址：', 'Deep link: ')}${buildDeepLinkHash(opts)}`, 'info')
        }
      })
    },
    [activeDeepLinkOptions, copyTextToClipboard, showToast, trLive],
  )

  const handleOpenPostcard = useCallback(
    (seed?: { room: Place; slug?: string | null; title: string } | null) => {
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
    if (next === quality) return
    saveQualityPreference(next)
    setReady(false)
    setPreparing('')
    setQuality(next)
  }, [quality])

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
    localizedAtmoOptions.find((o) => o.id === atmospherePreset) ?? localizedAtmoOptions[1]
  const displayHomeName = localizedSiteDefault(homeName, DEFAULT_SITE_SETTINGS.homeName, 'My Cottage', locale)
  const displayYardHeading = localizedSiteDefault(siteSettings.yardHeading, DEFAULT_SITE_SETTINGS.yardHeading, 'Come sit by the cottage.', locale)
  const displayYardSubtitle = localizedSiteDefault(
    siteSettings.yardSubtitle,
    DEFAULT_SITE_SETTINGS.yardSubtitle,
    'Push open the door to explore my projects, study notes, and story.',
    locale,
  )

  return (
    <I18nContext.Provider value={i18nValue}>
    <div
      className={`home-app place-${place} atmo-${atmospherePreset} weather-${weather} ${reduced ? 'reduced-motion' : ''} ${busy || anyModalOpen ? 'walking-paused' : ''} ${busy ? 'traveling' : ''} ${promoMode ? 'promo-clean' : ''}`}
      ref={root}
      onScroll={onWalkScroll}
    >
      {place === 'hall' && <div className="walk-track" aria-hidden="true" />}
      <div className="world">
        <SceneBoundary onFailure={() => setReady(true)} locale={locale}>
          {fontReady && pack && !contextLost && (
            <Canvas
              key={canvasKey}
              role="img"
              aria-label={tr(
                '自然白昼中的住宅与庭院，可进入走廊及作品室、创作手记、关于我三个房间',
                'Interactive 3D cottage and courtyard with corridor leading to Gallery, Study Notes, and About Me',
              )}
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
                  {tr(
                    '小屋三维场景。使用「小屋地图」也可浏览所有房间。',
                    '3D cottage scene. Use Cottage Map to browse every room.',
                  )}
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
                hallLook={hallLook}
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
          aria-label={tr(`${displayHomeName}，返回小院`, `${displayHomeName}, return to Courtyard`)}
          disabled={busy || !ready}
        >
          <Icon name="home" size={28} />
          <span>{displayHomeName}</span>
        </button>

        {place !== 'yard' && (
          <nav className="room-switcher" aria-label={tr('房间快捷切换', 'Quick room navigation')}>
            {localizedRooms.map((r) => (
              <button
                key={r.id}
                type="button"
                className={`room-switcher-btn ${place === r.id ? 'active' : ''}`}
                aria-label={tr(`前往${r.name}`, `Go to ${r.name}`)}
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
            <div className="atmosphere-segmented" role="group" aria-label={tr('小屋时光天色', 'Cottage sky & time of day')}>
              {localizedAtmoOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={`atmo-option ${atmosphereMode === opt.id ? 'active' : ''}`}
                  aria-pressed={atmosphereMode === opt.id}
                  aria-label={tr(`天色：${opt.label}`, `Sky: ${opt.label}`)}
                  title={
                    opt.id === 'auto'
                      ? tr(`跟随当地时间（当前：${activeAtmoMeta.label}）`, `Follow local time (currently: ${activeAtmoMeta.label})`)
                      : opt.label
                  }
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
                aria-label={weather === 'rain' ? tr('关闭细雨', 'Turn off rain') : tr('开启细雨', 'Turn on rain')}
                title={tr('切换庭院细雨与雨声', 'Toggle courtyard drizzle and rain sound')}
                onClick={handleToggleWeather}
              >
                <Icon name="rain" size={13} />
                <span>{tr('细雨', 'Rain')}</span>
              </button>
            </div>
            <button
              ref={atmoTriggerRef}
              type="button"
              className={`atmo-compact-trigger ${atmoPopoverOpen ? 'open' : ''}`}
              aria-expanded={atmoPopoverOpen}
              aria-haspopup="dialog"
              aria-label={tr(
                `天色与天气（当前：${activeAtmoMeta.label}${weather === 'rain' ? '·细雨' : ''}）`,
                `Sky & weather (${activeAtmoMeta.label}${weather === 'rain' ? ' · Rain' : ''})`,
              )}
              onClick={() => setAtmoPopoverOpen((v) => !v)}
            >
              <Icon name={weather === 'rain' ? 'rain' : activeAtmoMeta.icon} size={16} />
              <span>{activeAtmoMeta.label}{weather === 'rain' ? tr('·雨', ' · Rain') : ''}</span>
            </button>
            {atmoPopoverOpen && (
              <div
                ref={atmoPopoverRef}
                className="atmo-popover"
                role="dialog"
                aria-label={tr('切换天色与细雨', 'Switch sky and rain')}
                onKeyDown={(e) => handleMenuArrowNavigation(atmoPopoverRef.current, e)}
              >
                <div className="atmo-popover-grid">
                  {localizedAtmoOptions.map((opt) => (
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
                    <span>{weather === 'rain' ? tr('细雨中', 'Raining') : tr('晴朗无雨', 'Clear Sky')}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
          <div className="quality-segmented" role="group" aria-label={tr('画面质量', 'Graphics quality')}>
            <button
              type="button"
              className={`quality-option ${quality === 'high' ? 'active' : ''}`}
              aria-pressed={quality === 'high'}
              disabled={busy || !ready}
              onClick={() => handleSelectQuality('high')}
            >
              <span className="quality-label-full">{tr('细致画质', 'High Quality')}</span>
              <span className="quality-label-short" aria-hidden="true">{tr('细致', 'High')}</span>
            </button>
            <button
              type="button"
              className={`quality-option ${quality === 'low' ? 'active' : ''}`}
              aria-pressed={quality === 'low'}
              disabled={busy || !ready}
              onClick={() => handleSelectQuality('low')}
            >
              <span className="quality-label-full">{tr('兼容画质', 'Lite Quality')}</span>
              <span className="quality-label-short" aria-hidden="true">{tr('兼容', 'Lite')}</span>
            </button>
          </div>
          <button
            type="button"
            className="motion-button"
            onClick={() => setReduced(!reduced)}
            aria-label={reduced ? tr('轻柔模式', 'Gentle Motion') : tr('漫游模式', 'Smooth Roam')}
            aria-pressed={reduced}
            title={tr('减少镜头移动', 'Reduce camera motion')}
          >
            <Icon name="motion" size={18} />
            <span>{reduced ? tr('轻柔模式', 'Gentle') : tr('漫游模式', 'Motion')}</span>
          </button>
          <button
            type="button"
            className="lang-button"
            data-sound="ui-switch"
            onClick={toggleLocale}
            aria-label={locale === 'en' ? '切换为中文界面' : 'Switch to English interface'}
            title={locale === 'en' ? '切换为中文界面' : 'Switch to English'}
          >
            <Icon name="globe" size={16} />
            <span>{locale === 'en' ? '中文' : 'EN'}</span>
          </button>
          {isAdmin && (
            <div className="studio-anchor" ref={studioAnchorRef}>
              <button
                ref={studioTriggerRef}
                type="button"
                className={`admin-status-pill ${studioMenuOpen ? 'open' : ''}`}
                aria-expanded={studioMenuOpen}
                aria-haspopup="menu"
                aria-label={tr('创作者工作台快捷菜单', 'Creator Studio quick menu')}
                onClick={() => setStudioMenuOpen((v) => !v)}
              >
                <span className="admin-live-dot" aria-hidden="true" />
                <span>{tr('编辑中', 'Editing')}</span>
                <Icon name={studioMenuOpen ? 'chevronUp' : 'chevronDown'} size={13} />
              </button>
              {studioMenuOpen && (
                <div
                  ref={studioPopoverRef}
                  className="studio-quick-popover"
                  role="menu"
                  aria-label={tr('快捷创作入口', 'Quick creator actions')}
                  onKeyDown={(e) => handleMenuArrowNavigation(studioPopoverRef.current, e)}
                >
                  <div className="studio-popover-head">
                    <strong>
                      {backendHealth.mode === 'local-studio'
                        ? tr('本地编辑工作室', 'Local Editing Studio')
                        : tr('云端主人工作台', 'Cloud Owner Studio')}
                    </strong>
                    <small>
                      {backendHealth.mode === 'local-studio'
                        ? tr('保存即写入 local-data/', 'Saves directly to local-data/')
                        : adminEmail || tr('已登录', 'Signed in')}
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
                      <span>{tr('新建作品', 'New Project')}</span>
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
                      <span>{tr('写新手记', 'New Study Note')}</span>
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
                      <span>{tr('编辑「关于我」', 'Edit About Me')}</span>
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
                      <span>{tr('小屋名称与门牌设置', 'Cottage Name & Plaque')}</span>
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
                          ? tr('正在退出…', 'Signing out…')
                          : backendHealth.mode === 'local-studio'
                            ? tr('退出编辑（访客预览）', 'Exit Editing (Visitor View)')
                            : tr('退出管理登录', 'Sign Out')}
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
            aria-label={
              isAdmin
                ? tr('小屋地图（主人已登录）', 'Cottage Map (Owner signed in)')
                : tr('小屋地图', 'Cottage Map')
            }
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
            <span>{tr('小屋地图', 'Cottage Map')}</span>
          </button>
        </div>
      </header>

      <main>
        <div className="welcome-copy" key={place}>
          {place === 'yard' ? (
            <>
              <span className="welcome-eyebrow">
                {activeAtmoMeta.eyebrow}{weather === 'rain' ? tr(' · 细雨', ' · Rain') : ''}
              </span>
              <h1 ref={title} tabIndex={-1}>{displayYardHeading}</h1>
              <p>{displayYardSubtitle}</p>
            </>
          ) : (
            <>
              <span className="welcome-eyebrow">{room.note}</span>
              <h1 ref={title} tabIndex={-1}>{room.name}</h1>
              <p>
                {place === 'hall' ? (
                  locale === 'en' ? (
                    <>Scroll or press W / ↑ to walk inward, A / D to glance.<br />S / ↓ to step back, Enter to open a nearby door.</>
                  ) : (
                    <>滚轮上滑或按 W / ↑ 往家里走，A / D 左右张望。<br />S / ↓ 退回，靠近房门按 Enter 推门。</>
                  )
                ) : place === 'study' ? (
                  locale === 'en' ? (
                    <>Open a study note to see the thinking,<br />experiments, and decisions along the way.</>
                  ) : (
                    <>翻开一篇手记，<br />看看制作时的判断与调整。</>
                  )
                ) : place === 'gallery' ? (
                  locale === 'en' ? (
                    <>Click a framed work on the wall,<br />or browse full details & demos in the list.</>
                  ) : (
                    <>点开墙上的作品纸张，<br />或从目录查看详情与演示。</>
                  )
                ) : locale === 'en' ? (
                  <>Meet the maker behind the cottage,<br />and what is currently in focus.</>
                ) : (
                  <>认识小屋的主人，<br />和正在专注的事。</>
                )}
              </p>
            </>
          )}
        </div>

        {ready && !busy && !(isNarrowViewport && directoryOpen) && (place === 'yard' || place === 'study' || place === 'blank') && (
          <div ref={tactileBarRef} className="tactile-bar" role="group" aria-label={tr('房间互动小物件', 'Interactive room objects')}>
            {place === 'yard' && (
              <>
                <button
                  type="button"
                  className={`tactile-pill ${focusId === 'yard-bench' ? 'active' : ''}`}
                  aria-pressed={focusId === 'yard-bench'}
                  onClick={() => handleToggleFocus('yard-bench')}
                >
                  <Icon name="bench" size={14} />
                  <span>{focusId === 'yard-bench' ? tr('起身看全院', 'Stand Up') : tr('坐上木椅', 'Sit on Bench')}</span>
                </button>
                <button
                  type="button"
                  className="tactile-pill"
                  onClick={handleTriggerMailbox}
                >
                  <Icon name="mail" size={14} />
                  <span>{tr('寄语信箱', 'Mailbox')}</span>
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
                  <span>{deskLampOn ? tr('台灯：已点亮', 'Lamp: On') : tr('点亮书桌台灯', 'Turn On Desk Lamp')}</span>
                </button>
                <button
                  type="button"
                  className={`tactile-pill ${studyQuote !== null ? 'active' : ''}`}
                  onClick={handleDrawStudyQuote}
                >
                  <Icon name="book" size={14} />
                  <span>{tr('抽一张书架灵感签', 'Draw Inspiration Slip')}</span>
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
                    ? tr('收起桌面近况与寄语匣', 'Close Table & Guestbook')
                    : tr(`桌面近况与寄语匣 (${guestStamps.length})`, `Now Notes & Guestbook (${guestStamps.length})`)}
                </span>
              </button>
            )}
          </div>
        )}

        {place === 'yard' && focusId === 'yard-bench' && (
          <div className="tactile-floating-card bench-card" role="region" aria-label={tr('庭院木椅视角', 'Courtyard bench view')}>
            <div className="tactile-card-head">
              <strong>{tr('庭院木长椅 · 仰望屋檐', 'Wooden Bench · Looking Up')}</strong>
              <button
                type="button"
                className="tactile-card-close"
                data-sound="modal-close"
                aria-label={tr('起身回到小院全景', 'Stand up to courtyard overview')}
                onClick={() => setFocusId(null)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>
            <p>
              {tr(
                '坐在老树下的长椅往上看，窗子后面就是真实的走廊、书桌与画架。你可以试着在顶栏切换「落日」「夜灯」或「细雨」，看屋里亮起的暖光。',
                'Looking up from under the old tree, the real corridor, study desk, and easels sit right behind the windows. Try Sunset, Night, or Rain in the top bar to see the warm indoor glow.',
              )}
            </p>
          </div>
        )}

        {place === 'study' && studyQuote && (
          <div className="tactile-floating-card quote-card" role="region" aria-label={tr('书架灵感签', 'Shelf inspiration slip')}>
            <div className="tactile-card-head">
              <strong>{tr('书架夹页灵感签', 'Shelf Inspiration Slip')}</strong>
              <div className="tactile-card-actions">
                <button
                  type="button"
                  className="tactile-mini-btn"
                  onClick={handleDrawStudyQuote}
                >
                  {tr('换一张', 'Draw Another')}
                </button>
                <button
                  type="button"
                  className="tactile-card-close"
                  data-sound="modal-close"
                  aria-label={tr('合上灵感签', 'Close inspiration slip')}
                  onClick={() => {
                    setStudyQuote(null)
                    if (focusId === 'study-shelf') setFocusId(null)
                  }}
                >
                  <Icon name="close" size={14} />
                </button>
              </div>
            </div>
            <blockquote>{locale === 'en' ? studyQuote : `「${studyQuote}」`}</blockquote>
          </div>
        )}

        {place === 'blank' && focusId === 'blank-table' && (
          <div className="tactile-floating-card guestbox-card" role="region" aria-label={tr('木桌近况便签与访客寄语匣', 'Now notes and guest stamp box')}>
            <div className="tactile-card-head">
              <strong>{tr('木桌近况便签 · 访客寄语匣', 'Tabletop Now Notes · Guestbook')}</strong>
              <button
                type="button"
                className="tactile-card-close"
                data-sound="modal-close"
                aria-label={tr('收起桌面寄语匣', 'Close tabletop guestbook')}
                onClick={() => setFocusId(null)}
              >
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="now-notes-strip" aria-label={tr('主人近况便签', 'Owner now notes')}>
              {activeNowNotes.map((note, idx) => (
                <div key={idx} className="now-note-chip">
                  <small>NOW · 0{idx + 1}</small>
                  <span>{note}</span>
                </div>
              ))}
            </div>

            <div className="guestbox-section">
              <div className="guestbox-head">
                <span>{tr('选一枚印章，留在木匣里', 'Pick a stamp to leave in the box')}</span>
                <small>{tr(`已收集 ${guestStamps.length} 枚足迹`, `${guestStamps.length} collected`)}</small>
              </div>
              <div ref={moodGroupRef} className="guestbox-moods" role="radiogroup" aria-label={tr('选择印章心情', 'Choose stamp mood')}>
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
                    {locale === 'en' ? m.labelEn : m.id}
                  </button>
                ))}
              </div>
              <div className="guestbox-input-row">
                <input
                  type="text"
                  maxLength={36}
                  value={guestNoteInput}
                  onChange={(e) => setGuestNoteInput(e.target.value)}
                  placeholder={tr('附一句简短纸条（可选，最多 36 字）', 'Add a short note (optional, max 36 chars)')}
                  aria-label={tr('访客寄语短句', 'Guestbook short note')}
                />
                <button type="button" className="stamp-submit-btn" onClick={handleLeaveStamp}>
                  {tr('盖章留念', 'Leave Stamp')}
                </button>
              </div>
              {latestStampReply && (
                <p className="stamp-reply-banner" role="status">{latestStampReply}</p>
              )}
              {guestStamps.length > 0 && (
                <ul className="guest-stamp-list" aria-label={tr('最近的访客印章', 'Recent guest stamps')}>
                  {guestStamps.slice(0, 4).map((item) => {
                    const matchedMood = STAMP_MOODS.find((m) => m.id === item.mood)
                    const badgeLabel = locale === 'en' ? (matchedMood?.labelEn ?? item.mood) : item.mood
                    return (
                      <li key={item.id}>
                        <span className="stamp-badge">{badgeLabel}</span>
                        <span className="stamp-text">
                          {item.message || tr('轻轻路过，盖下一枚印章', 'Passed by quietly and left a stamp')}
                        </span>
                        <time>{item.createdAt.slice(0, 10)}</time>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        )}

        {inside && directoryOpen && (
          <aside
            id="room-directory"
            className={`room-content ${isNarrowViewport ? 'mobile-drawer' : ''}`}
            aria-label={tr(`${room.name}的内容`, `${room.name} contents`)}
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
          <div className="gallery-viewer" role="group" aria-label={tr('逐件浏览作品', 'Browse projects one by one')}>
            {publishedProjects.length === 0 ? (
              <div className="gallery-empty-pill">
                <span>
                  {cloudLoading
                    ? tr('正在加载作品…', 'Loading projects…')
                    : tr('暂无已发布作品', 'No published projects yet')}
                </span>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  aria-label={tr('上一件作品', 'Previous project')}
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
                  aria-label={tr(`展开《${activeMobileProject?.title ?? ''}》`, `Open "${activeMobileProject?.title ?? ''}"`)}
                >
                  <span aria-live="polite">
                    {activeMobileProject?.title}
                    <small>{galleryIndex + 1} / {publishedProjects.length}</small>
                  </span>
                  <Icon name="frame" size={18} />
                </button>
                <button
                  type="button"
                  aria-label={tr('下一件作品', 'Next project')}
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

        <nav className={`journey-nav ${place === 'yard' ? 'yard-nav' : ''}`} aria-label={tr('房间导航', 'Room navigation')}>
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
              <span>{busy ? tr('门开了，进来吧…', 'Door opening, come on in…') : tr('敲敲门，进来坐坐', 'Knock & Step Inside')}</span>
              <Icon name="arrow" />
            </button>
          ) : (
            <>
              <button key="inside-back" type="button" className="back-button" onClick={() => void navigate(backPlace)} disabled={busy || !ready}>
                <Icon name="back" size={18} />
                <span>{place === 'hall' ? tr('回到小院', 'Back to Courtyard') : tr('返回走廊', 'Back to Corridor')}</span>
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
                      <span>{tr('添加作品', 'Add Project')}</span>
                    </button>
                  )}
                  {isAdmin && !directoryOpen && place === 'study' && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => { setEditingNote(null); setNoteEditorOpen(true) }}
                    >
                      <Icon name="plus" size={16} />
                      <span>{tr('写手记', 'Write Note')}</span>
                    </button>
                  )}
                  {isAdmin && !directoryOpen && place === 'blank' && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => setProfileEditorOpen(true)}
                    >
                      <Icon name="pencil" size={15} />
                      <span>{tr('编辑介绍', 'Edit Bio')}</span>
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
                          ? tr('作品管理', 'Manage Gallery')
                          : tr('作品目录', 'Projects')
                        : place === 'study'
                          ? isAdmin
                            ? tr('手记管理', 'Manage Notes')
                            : tr('手记目录', 'Study Notes')
                          : isAdmin
                            ? tr('介绍管理', 'Manage Bio')
                            : tr('个人介绍', 'About Me')}
                    </span>
                  </button>
                </div>
              )}

              {place === 'hall' && (
                <div className="walk-actions">
                  <div className="walk-steps">
                    <button type="button" onClick={() => step(-1)} disabled={busy || !ready} aria-label={tr('后退一段', 'Step backward')}>
                      <Icon name="back" size={18} />
                    </button>
                    <button type="button" onClick={() => step(1)} disabled={busy || !ready || atEnd} aria-label={tr('前进一段', 'Step forward')}>
                      <Icon name="arrow" size={18} />
                    </button>
                  </div>
                  {nearby && (
                    <button type="button" className="near-door" onClick={() => void navigate(nearby)} disabled={busy || !ready}>
                      <span>{tr(`进入${localizedRooms.find((r) => r.id === nearby)?.name ?? ''}`, `Enter ${localizedRooms.find((r) => r.id === nearby)?.name ?? ''}`)}</span>
                      <kbd className="kbd-cap" aria-hidden="true">Enter</kbd>
                      <Icon name="arrow" size={19} />
                    </button>
                  )}
                  {!nearby && (
                    <span className="walk-hint">
                      {atEnd
                        ? tr('走到家的深处了，按 S / ↓ 或反向滑动慢慢往回逛', 'End of the corridor—press S / ↓ or scroll back')
                        : tr('滚轮滑动，或按 W/S、方向键漫游走廊', 'Scroll, or press W/S & Arrow keys to roam')}
                    </span>
                  )}
                </div>
              )}
            </>
          )}
        </nav>

        {!ready && !loadError && !contextLost && (
          <div className="loading-note" role="status">
            {preparing || tr(`正在准备小屋与庭院… ${Math.round(loadProgress * 100)}%`, `Preparing cottage & courtyard… ${Math.round(loadProgress * 100)}%`)}
          </div>
        )}
        {contextLost && (
          <div className="load-error context-lost-card" role="alertdialog" aria-labelledby="webgl-lost-title">
            <h2 id="webgl-lost-title">{tr('三维画面暂时中断', '3D view interrupted')}</h2>
            <p>
              {tr(
                '当前浏览器的图形显存暂时被释放或设备内存偏紧，切换至轻量的「兼容画质」可以更流畅地打开小屋。',
                'Your browser temporarily released WebGL graphics memory. Switching to Lite Quality keeps the cottage running smoothly.',
              )}
            </p>
            <div className="context-lost-actions">
              <button type="button" onClick={handleRecoverContextLoss}>
                {tr('切换兼容画质并重试', 'Switch to Lite Quality & Retry')}
              </button>
              <button
                type="button"
                className="context-lost-secondary"
                onClick={() => setMapOpen(true)}
              >
                {tr('用小屋地图浏览', 'Browse via Map')}
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
              {tr('重新加载', 'Reload')}
            </button>
          </div>
        )}
      </main>

      <footer className="site-footer">
        <div className="place-indicator">
          <Icon name={place === 'yard' ? (weather === 'rain' ? 'rain' : activeAtmoMeta.icon) : room.icon} size={18} />
          <span>
            {place === 'yard'
              ? `${activeAtmoMeta.footerText}${weather === 'rain' ? tr(' · 细雨微凉', ' · Gentle rain') : ''}`
              : tr(`你在${room.name}`, `In ${room.name}`)}
          </span>
        </div>
        <div className="footer-right">
          <span className="interaction-hint">
            {place === 'yard'
              ? tr('点一下门，故事就开始了', 'Click the front door to begin')
              : place === 'hall'
                ? tr('沿走廊走走，遇见一扇喜欢的门', 'Stroll the corridor and pick a door')
                : tr('在这里，待一会儿也没关系', 'Stay a quiet while here')}
          </span>
          <button
            type="button"
            className="postcard-button"
            data-sound="shutter"
            aria-label={tr('拍一张纸质明信片', 'Take a paper postcard')}
            title={tr('生成纸质明信片与此刻深链', 'Create a paper postcard & deep link')}
            disabled={busy || !ready}
            onClick={() => handleOpenPostcard()}
          >
            <Icon name="postcard" size={16} />
            <span>{tr('拍明信片', 'Postcard')}</span>
          </button>
          <button
            type="button"
            className={`sfx-button ${sfxEnabled ? 'active' : ''}`}
            aria-label={sfxEnabled ? tr('关闭交互音效', 'Mute sound effects') : tr('开启交互音效', 'Enable sound effects')}
            aria-pressed={sfxEnabled}
            title={sfxEnabled ? tr('交互触感音效：开启', 'Tactile sound effects: On') : tr('交互触感音效：静音', 'Tactile sound effects: Muted')}
            onClick={handleToggleSfx}
          >
            <Icon name={sfxEnabled ? 'sfxOn' : 'sfxOff'} size={17} />
          </button>
          <button
            type="button"
            className={`ambient-button ${ambient ? 'active' : ''}`}
            aria-label={ambient ? tr('关闭环境声', 'Turn off ambient sound') : tr('开启环境声', 'Turn on ambient sound')}
            aria-pressed={ambient}
            title={ambient ? tr('环境声与雨声：开启', 'Ambient & rain audio: On') : tr('环境声与雨声：关闭', 'Ambient & rain audio: Off')}
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
        {busy
          ? tr(`正在前往${localizedRooms.find((r) => r.id === destination)?.name || '下一个房间'}`, `Moving to ${localizedRooms.find((r) => r.id === destination)?.name || 'next room'}`)
          : tr(`已来到${room.name}`, `Arrived at ${room.name}`)}
      </p>

      <Modal open={mapOpen} close={() => setMapOpen(false)} label={tr('小屋地图', 'Cottage Map')} className="map-dialog">
        <h2>{tr('小屋地图', 'Cottage Map')}</h2>
        <p className="dialog-intro">{tr('想去哪儿，推门就好。', 'Pick any room and push the door open.')}</p>
        <div className="floor-plan">
          {localizedRooms.map((r) => (
            <button
              type="button"
              key={r.id}
              className={`plan-${r.id} ${place === r.id ? 'current' : ''}`}
              onClick={() => void navigate(r.id)}
              aria-current={place === r.id ? 'location' : undefined}
            >
              <Icon name={r.icon} size={27} />
              <strong>{r.name}</strong>
              <span>{place === r.id ? tr('你在这里', 'You are here') : r.note}</span>
            </button>
          ))}
        </div>

        <form
          className="name-form"
          onSubmit={(e) => {
            e.preventDefault()
            const trimmedName = settingsDraft.homeName.trim().slice(0, 12)
            if (!trimmedName) {
              setNameMessage(tr('先为小屋写一个名字吧。', 'Give your cottage a name first.'))
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
                  ? tr('小屋名称与外观文字已保存到本机 local-data/。', 'Cottage name and copy saved to local-data/.')
                  : tr('小屋名称与外观文字已保存到云端。', 'Cottage name and copy saved to the cloud.')
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
                  showToast(trLive('小屋名称与外观文字已保存', 'Cottage settings saved'), 'success')
                } catch (err) {
                  if (err instanceof ConflictError) {
                    await refreshCloud()
                    setNameMessage(
                      trLive(
                        '小屋设置在另一窗口已被修改，已为你同步最新内容。',
                        'Settings were updated in another window—synced latest version.',
                      ),
                    )
                  } else {
                    setNameMessage(err instanceof Error ? err.message : trLive('保存失败，请重试。', 'Save failed, please retry.'))
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
              setNameMessage(tr('小屋的名字记住了。', 'Cottage name remembered.'))
              showToast(tr('小屋的名字已记住', 'Cottage name remembered'), 'success')
            } catch {
              setNameMessage(
                tr(
                  '名字已更新；当前浏览器无法保存，下次打开会恢复默认。',
                  'Name updated; browser storage is blocked so it will reset on reload.',
                ),
              )
            }
          }}
        >
          <div className="name-form-head">
            <label htmlFor="home-name">
              <Icon name="pencil" size={17} />
              {tr('给小屋起个名字', 'Name Your Cottage')}
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
              placeholder={tr('最多 12 个字', 'Up to 12 chars')}
              disabled={settingsBusy}
            />
            <button type="submit" disabled={settingsBusy}>
              {settingsBusy
                ? tr('保存中…', 'Saving…')
                : canPersistSiteSettings
                  ? backendHealth.mode === 'local-studio'
                    ? tr('保存本机', 'Save Local')
                    : tr('保存设置', 'Save')
                  : tr('记住', 'Save')}
            </button>
          </div>
          {canPersistSiteSettings && (
            <section className="site-extra-settings" aria-label={tr('小屋文字外观设置', 'Cottage plaque & greeting settings')}>
              <button
                type="button"
                className="cms-ghost-btn"
                onClick={() => setSettingsExpanded((v) => !v)}
              >
                {settingsExpanded
                  ? tr('收起门牌与迎客语设置', 'Hide Plaque & Greeting Settings')
                  : tr('自定义门牌与小院迎客语', 'Customize Plaque & Courtyard Greeting')}
              </button>
              {settingsExpanded && (
                <div className="site-extra-fields">
                  <div className="cms-field">
                    <div className="cms-field-head">
                      <label htmlFor="plaque-title">{tr('门厅牌匾主标题', 'Porch Plaque Title')}</label>
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
                      <label htmlFor="plaque-subtitle">{tr('门厅牌匾副标题', 'Porch Plaque Subtitle')}</label>
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
                      <label htmlFor="yard-heading">{tr('小院欢迎大标题', 'Courtyard Heading')}</label>
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
                      <label htmlFor="yard-subtitle">{tr('小院欢迎导语', 'Courtyard Subtitle')}</label>
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
                        <label htmlFor="default-atmosphere">{tr('访客默认天色', 'Default Visitor Sky')}</label>
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
                        <option value="daylight">{tr('晴昼（推荐）', 'Daylight (Recommended)')}</option>
                        <option value="dawn">{tr('晨雾', 'Dawn')}</option>
                        <option value="golden">{tr('落日', 'Sunset')}</option>
                        <option value="night">{tr('夜灯', 'Night')}</option>
                        <option value="auto">{tr('跟随访客当地时间', 'Follow visitor local time')}</option>
                      </select>
                    </div>
                    <div className="cms-field">
                      <div className="cms-field-head">
                        <label htmlFor="default-weather">{tr('访客默认天气', 'Default Visitor Weather')}</label>
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
                        <option value="clear">{tr('晴朗无雨', 'Clear')}</option>
                        <option value="rain">{tr('细雨微凉', 'Rain')}</option>
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
                  ? tr('在本地编辑模式下保存后，会写入本机 local-data/ 并应用到所有页面。', 'Saved changes write to local-data/ and apply across all rooms.')
                  : tr('在主人登录状态下保存后，会同步到云端并应用给所有访客。', 'Saved changes sync to the cloud for all visitors.')
                : tr('名字会保存在这台设备的浏览器里。', 'Saved in this browser on your device.'))}
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
            clearSignedUrlCache('admin')
            await refreshCloud()
            showToast(
              backendHealth.mode === 'local-studio'
                ? trLive('已进入本地编辑模式', 'Entered Local Studio editing mode')
                : trLive('已登录主人管理模式', 'Signed in to Owner mode'),
              'success',
            )
          }}
          onSignedOut={async () => {
            adminSeqRef.current += 1
            clearSignedUrlCache()
            setAdminEmail(null)
            setAdminData(null)
            await loadPublic()
            showToast(trLive('已切换为访客浏览视图', 'Switched to visitor view'), 'info')
          }}
          onRetryCleanup={async () => {
            const res = await cleanupMediaAssetsApi({ sweepOrphans: true })
            setAdminData((prev) => (prev ? { ...prev, pendingCleanupCount: res.remaining } : prev))
            if (res.errors.length || res.remaining !== 0) {
              throw new Error(
                trLive(
                  `旧素材尚未全部清理，请重试或检查存储。${res.errors.join('；')}`,
                  `Some unused media could not be cleaned up yet. ${res.errors.join('; ')}`,
                ),
              )
            }
            showToast(trLive('旧素材清理检查完成', 'Media cleanup check completed'), 'info')
          }}
          onImportSample={async () => {
            await initLocalSampleApi(false)
            await refreshCloud()
            showToast(trLive('已导入初始示例内容', 'Starter sample content imported'), 'success')
          }}
          onExportSnapshot={async () => {
            const res = await exportLocalSnapshotApi()
            playSound('success-seal')
            showToast(
              trLive(
                `公开快照导出完成（作品 ${res.projects} 件 · 手记 ${res.notes} 篇）`,
                `Public snapshot exported (${res.projects} projects · ${res.notes} notes)`,
              ),
              'success',
            )
            return res
          }}
        />
      </Modal>

      <Suspense fallback={null}>
        {projectEditorOpen && (
          <LazyModalBoundary active={projectEditorOpen} onClose={() => { setProjectEditorOpen(false) }}>
          <ProjectEditorModal key={editingProject?.id ?? 'new'}
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
          </LazyModalBoundary>
        )}

        {noteEditorOpen && (
          <LazyModalBoundary active={noteEditorOpen} onClose={() => { setNoteEditorOpen(false) }}>
          <NoteEditorModal key={editingNote?.id ?? 'new'}
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
          </LazyModalBoundary>
        )}

        {profileEditorOpen && (
          <LazyModalBoundary active={profileEditorOpen} onClose={() => { setProfileEditorOpen(false) }}>
          <ProfileEditorModal
            open={profileEditorOpen}
            initialProfile={adminData?.profile ?? null}
            assets={adminData?.assets ?? {}}
            onAssetUploaded={registerUploadedAsset}
            onSaved={handleProfileSaved}
            onConflict={(c) => setConflict(c)}
            onClose={() => setProfileEditorOpen(false)}
          />
          </LazyModalBoundary>
        )}

        {projectDetailMounted && (
          <LazyModalBoundary active={viewingProject !== null} onClose={() => { setViewingProject(null) }}>
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
                      room: 'gallery',
                      slug: pub?.slug || viewingProject.project.id,
                      title: viewingProject.project.title || tr('作品', 'Project'),
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
          </LazyModalBoundary>
        )}

        {noteDetailMounted && (
          <LazyModalBoundary active={viewingNote !== null} onClose={() => { setViewingNote(null) }}>
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
                      room: 'study',
                      slug: pub?.slug || viewingNote.note.id,
                      title: viewingNote.note.title || tr('手记', 'Note'),
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
          </LazyModalBoundary>
        )}

        {postcardMounted && (
          <LazyModalBoundary active={postcardOpen} onClose={() => { setPostcardOpen(false); setPostcardSeedItem(null); setPostcardSnapshot(null) }}>
          <PostcardModal
            open={postcardOpen}
            snapshotDataUrl={postcardSnapshot}
            homeName={displayHomeName}
            plaqueTitle={localizedSiteDefault(siteSettings.plaqueTitle, DEFAULT_SITE_SETTINGS.plaqueTitle, 'Welcome Home', locale)}
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
          </LazyModalBoundary>
        )}

        {conflictMounted && (
          <LazyModalBoundary active={conflict !== null} onClose={() => setConflict(null)}>
            <ConflictDialog conflict={conflict} onClose={() => setConflict(null)} />
          </LazyModalBoundary>
        )}
      </Suspense>
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </div>
    </I18nContext.Provider>
  )
}
