import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import gsap from 'gsap'
import { CameraController, World, doorStops, type CameraHandle } from './World'
import { rooms, type Place } from './content'
import { layout, stopProgress, type TransitionState } from './layout'
import { loadResources, type Quality, type ResourcePack } from './resources'
import { RenderPipeline } from './RenderPipeline'
import {
  cleanupMediaAssetsApi,
  fetchAdminCottage,
  fetchPublicCottage,
  reorderNotesApi,
  reorderProjectsApi,
  signOutAdmin,
} from './lib/api'
import { evictSignedUrl, getCachedUrl, refreshSignedUrl, seedSignedUrls } from './lib/media'
import { getSupabaseClient, isCloudConfigured } from './lib/supabase'
import {
  ApiError,
  ConflictError,
  type AdminCottageData,
  type AdminNote,
  type AdminProfile,
  type AdminProject,
  type GalleryDisplayItem,
  type MediaAsset,
  type NotePayload,
  type ProjectPayload,
  type PublicCottageData,
} from './types/content'
import { Icon } from './components/Icon'
import { Modal } from './components/Modal'
import { AdminAuthPanel } from './components/AdminAuthPanel'
import { RoomDirectory } from './components/RoomDirectory'
import { ProjectDetailModal, type LinkedNoteRef } from './components/ProjectDetailModal'
import { NoteDetailModal, type LinkedProjectRef } from './components/NoteDetailModal'
import { ProjectEditorModal } from './components/ProjectEditorModal'
import { NoteEditorModal } from './components/NoteEditorModal'
import { ProfileEditorModal } from './components/ProfileEditorModal'
import { ConflictDialog, type ConflictContext } from './components/ConflictDialog'

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

function startingPlace(): Place {
  const hash = window.location.hash.slice(1)
  return rooms.some((r) => r.id === hash) ? (hash as Place) : 'yard'
}

export default function App() {
  const [place, setPlace] = useState<Place>(startingPlace)
  const [opening, setOpening] = useState<Place | null>(null)
  const [busy, setBusy] = useState(false)
  const [destination, setDestination] = useState<Place | null>(null)
  const busyRef = useRef(false)
  const [ready, setReady] = useState(false)
  const [fontReady, setFontReady] = useState(false)
  const [pack, setPack] = useState<ResourcePack | null>(null)
  const [quality, setQuality] = useState<Quality>(() =>
    new URLSearchParams(location.search).get('quality') === 'low' ? 'low' : 'high',
  )
  const [loadProgress, setLoadProgress] = useState(0)
  const [preparing, setPreparing] = useState('')
  const [loadError, setLoadError] = useState('')
  const [retryTarget, setRetryTarget] = useState<Place | null>(null)
  const [retry, setRetry] = useState(0)
  const transition = useRef<TransitionState | null>(null)
  const prepare = useRef<(() => Promise<void>) | null>(null)

  const [mapOpen, setMapOpen] = useState(false)
  const [galleryIndex, setGalleryIndex] = useState(0)
  const [homeName, setHomeName] = useState(savedName)
  const [nameDraft, setNameDraft] = useState(homeName)
  const [nameMessage, setNameMessage] = useState('')
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [ambient, setAmbient] = useState(false)
  const camera = useRef<CameraHandle>(null)
  const progress = useRef(place === 'yard' || place === 'hall' ? 0 : stopProgress(doorStops.find((d) => d.id === place)!.depth))
  const [nearby, setNearby] = useState<Place | null>(null)
  const [atEnd, setAtEnd] = useState(false)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const title = useRef<HTMLHeadingElement>(null)
  const root = useRef<HTMLDivElement>(null)
  const animation = useRef<gsap.core.Tween | null>(null)

  // Cloud CMS state
  const [publicData, setPublicData] = useState<PublicCottageData>(emptyPublicData)
  const [cloudLoading, setCloudLoading] = useState(isCloudConfigured)
  const [cloudError, setCloudError] = useState('')
  const [signedUrlRevision, setSignedUrlRevision] = useState(0)

  const [adminEmail, setAdminEmail] = useState<string | null>(null)
  const [adminData, setAdminData] = useState<AdminCottageData | null>(null)
  const [adminError, setAdminError] = useState('')
  const [reorderBusy, setReorderBusy] = useState(false)

  // Detail & editor modals
  const [viewingProject, setViewingProject] = useState<ViewingProjectState | null>(null)
  const [viewingNote, setViewingNote] = useState<ViewingNoteState | null>(null)
  const [projectEditorOpen, setProjectEditorOpen] = useState(false)
  const [editingProject, setEditingProject] = useState<AdminProject | null>(null)
  const [noteEditorOpen, setNoteEditorOpen] = useState(false)
  const [editingNote, setEditingNote] = useState<AdminNote | null>(null)
  const [profileEditorOpen, setProfileEditorOpen] = useState(false)
  const [conflict, setConflict] = useState<ConflictContext | null>(null)

  const isAdmin = Boolean(adminEmail && adminData)
  const anyModalOpen =
    mapOpen ||
    viewingProject !== null ||
    viewingNote !== null ||
    projectEditorOpen ||
    noteEditorOpen ||
    profileEditorOpen ||
    conflict !== null
  const modalOpenRef = useRef(anyModalOpen)
  modalOpenRef.current = anyModalOpen

  const loadPublic = useCallback(async () => {
    if (!isCloudConfigured) {
      setCloudLoading(false)
      setCloudError('')
      return
    }
    setCloudLoading(true)
    setCloudError('')
    try {
      const data = await fetchPublicCottage()
      seedSignedUrls(data.signedUrls)
      setPublicData(data)
      setSignedUrlRevision((r) => r + 1)
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : '公开内容读取失败，请稍后重试。')
    } finally {
      setCloudLoading(false)
    }
  }, [])

  const loadAdmin = useCallback(async () => {
    if (!isCloudConfigured) return
    setAdminError('')
    try {
      const client = getSupabaseClient()
      const { data: sess } = await client.auth.getSession()
      if (!sess.session?.access_token) {
        setAdminEmail(null)
        setAdminData(null)
        return
      }
      const data = await fetchAdminCottage()
      seedSignedUrls(data.signedUrls)
      setAdminData(data)
      setAdminEmail(sess.session.user?.email ?? '主人')
      setSignedUrlRevision((r) => r + 1)
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        await signOutAdmin().catch(() => {})
        setAdminEmail(null)
        setAdminData(null)
        setAdminError('当前账号无管理员权限或登录已失效，已恢复访客视图。')
      } else {
        setAdminError(err instanceof Error ? err.message : '管理数据读取失败。')
      }
    }
  }, [])

  const refreshCloud = useCallback(async () => {
    await loadPublic()
    if (isCloudConfigured) {
      const client = getSupabaseClient()
      const { data } = await client.auth.getSession()
      if (data.session?.access_token) {
        await loadAdmin()
      }
    }
  }, [loadAdmin, loadPublic])

  useEffect(() => {
    void loadPublic()
    if (!isCloudConfigured) return
    const client = getSupabaseClient()
    void client.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setAdminEmail(data.session.user?.email ?? '主人')
        void loadAdmin()
      }
    })
    const { data: sub } = client.auth.onAuthStateChange((event, session) => {
      if (!session || event === 'SIGNED_OUT') {
        setAdminEmail(null)
        setAdminData(null)
        setProjectEditorOpen(false)
        setNoteEditorOpen(false)
        setProfileEditorOpen(false)
      } else if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        setAdminEmail(session.user?.email ?? '主人')
        if (event === 'SIGNED_IN') void loadAdmin()
      }
    })
    return () => sub.subscription.unsubscribe()
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
    let active = true
    const finish = () => { if (active) setFontReady(true) }
    document.fonts.load('24px HomeHand').then(finish, finish)
    return () => { active = false }
  }, [])

  useEffect(() => {
    document.title = `${homeName} · ${rooms.find((r) => r.id === place)?.name}`
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
    const ctx = gsap.context(() => {
      gsap.from('.welcome-copy > *', { y: reduced ? 0 : 12, opacity: 0.3, stagger: 0.09, duration: 0.65, ease: 'power2.out' })
    }, root)
    return () => ctx.revert()
  }, [place, reduced])

  useEffect(() => () => { animation.current?.kill(); document.body.style.cursor = '' }, [])

  // Ambient sound is synthesized locally and starts only after explicit user gesture.
  useEffect(() => {
    if (!ambient) return
    const audio = new AudioContext()
    const master = audio.createGain(); master.gain.value = 0.04; master.connect(audio.destination)
    const length = audio.sampleRate * 2, buffer = audio.createBuffer(1, length, audio.sampleRate)
    const channel = buffer.getChannelData(0)
    let last = 0
    for (let i = 0; i < length; i++) { last = (last + (Math.random() * 2 - 1) * 0.02) / 1.02; channel[i] = last * 3.5 }
    const wind = audio.createBufferSource(); wind.buffer = buffer; wind.loop = true
    const filter = audio.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 500
    wind.connect(filter); filter.connect(master); wind.start()
    const chirp = () => {
      if (document.hidden || audio.state !== 'running') return
      const osc = audio.createOscillator(), volume = audio.createGain(), now = audio.currentTime
      osc.type = 'sine'; osc.frequency.setValueAtTime(1700 + Math.random() * 900, now)
      osc.frequency.exponentialRampToValueAtTime(3400, now + 0.1); osc.frequency.exponentialRampToValueAtTime(1800, now + 0.25)
      volume.gain.setValueAtTime(0, now); volume.gain.linearRampToValueAtTime(0.12, now + 0.03); volume.gain.exponentialRampToValueAtTime(0.001, now + 0.25)
      osc.connect(volume); volume.connect(master); osc.start(); osc.stop(now + 0.3)
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
      el.scrollBy({
        top: (direction * (el.scrollHeight - el.clientHeight) * layout.stepDistance) / layout.walkLength,
        behavior: reduced ? 'instant' : 'smooth',
      })
    }
  }

  async function navigate(target: Place) {
    if (busyRef.current || !ready) return
    setMapOpen(false)
    setViewingProject(null)
    setViewingNote(null)
    setProjectEditorOpen(false)
    setNoteEditorOpen(false)
    setProfileEditorOpen(false)
    setConflict(null)
    setDirectoryOpen(false)
    if (target === place) return
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
    if (index < 3) setGalleryIndex(index)
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
    evictSignedUrl(assetId)
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
      coverThumbUrl: getCachedUrl(p.coverAssetId, 'thumb'),
    }))
  }, [publicData.projects, signedUrlRevision])

  function registerUploadedAsset(asset: MediaAsset) {
    setAdminData((prev) =>
      prev ? { ...prev, assets: { ...prev.assets, [asset.id]: asset } } : prev,
    )
  }

  function handleProjectSaved(saved: AdminProject, pendingCleanupCount: number) {
    setAdminData((prev) => {
      if (!prev) return prev
      const exists = prev.projects.some((p) => p.id === saved.id)
      const projects = exists
        ? prev.projects.map((p) => (p.id === saved.id ? saved : p))
        : [...prev.projects, saved]
      return { ...prev, projects, pendingCleanupCount }
    })
    void loadPublic()
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
  }

  function handleNoteSaved(saved: AdminNote, pendingCleanupCount: number) {
    setAdminData((prev) => {
      if (!prev) return prev
      const exists = prev.notes.some((n) => n.id === saved.id)
      const notes = exists
        ? prev.notes.map((n) => (n.id === saved.id ? saved : n))
        : [...prev.notes, saved]
      return { ...prev, notes, pendingCleanupCount }
    })
    void loadPublic()
  }

  function handleNoteDeleted(deletedId: string, pendingCleanupCount: number) {
    setAdminData((prev) =>
      prev ? { ...prev, notes: prev.notes.filter((n) => n.id !== deletedId), pendingCleanupCount } : prev,
    )
    void loadPublic()
  }

  function handleProfileSaved(saved: AdminProfile, pendingCleanupCount: number) {
    setAdminData((prev) => (prev ? { ...prev, profile: saved, pendingCleanupCount } : prev))
    void loadPublic()
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

  return (
    <div
      className={`home-app place-${place} ${reduced ? 'reduced-motion' : ''} ${busy || anyModalOpen ? 'walking-paused' : ''} ${busy ? 'traveling' : ''}`}
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
          {fontReady && pack && (
            <Canvas
              role="img"
              aria-label="自然白昼中的住宅与庭院，可进入走廊及作品室、创作手记、关于我三个房间"
              shadows="percentage"
              dpr={[1, 1.5]}
              camera={{ ...initialCamera, near: 0.05, far: 200 }}
              gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
              fallback={
                <div className="scene-fallback">
                  小屋三维场景。使用「小屋地图」也可浏览所有房间。
                </div>
              }
            >
              <CameraController
                ref={camera}
                place={place}
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
                reduced={reduced}
                pack={pack}
                galleryProjects={galleryProjects}
                onCoverExpired={handleCoverExpired}
              />
              <RenderPipeline
                quality={pack.quality}
                transition={transition}
                prepare={prepare}
                onPreparing={setPreparing}
                onReady={() => setReady(true)}
              />
            </Canvas>
          )}
        </SceneBoundary>
      </div>
      <div className="paper-grain" aria-hidden="true" />

      <header className="site-header">
        <button
          type="button"
          className="brand"
          onClick={() => void navigate('yard')}
          aria-label={`${homeName}，返回小院`}
          disabled={busy || !ready}
        >
          <Icon name="home" size={31} />
          <span>{homeName}</span>
        </button>
        <div className="header-actions">
          <label className="quality-control">
            <span className="sr-only">画面质量</span>
            <select
              aria-label="画面质量"
              value={quality}
              disabled={busy}
              onChange={(e) => setQuality(e.target.value as Quality)}
            >
              <option value="high">细致画质</option>
              <option value="low">兼容画质</option>
            </select>
          </label>
          <button
            type="button"
            className="motion-button"
            onClick={() => setReduced(!reduced)}
            aria-label={reduced ? '轻柔模式' : '漫游模式'}
            aria-pressed={reduced}
            title="减少镜头移动"
          >
            <Icon name="motion" size={19} />
            <span>{reduced ? '轻柔模式' : '漫游模式'}</span>
          </button>
          <button
            type="button"
            className={`map-button ${isAdmin ? 'admin-active' : ''}`}
            aria-label={isAdmin ? '小屋地图（主人已登录）' : '小屋地图'}
            onClick={() => { setMapOpen(true); setNameDraft(homeName); setNameMessage('') }}
            disabled={busy || !ready}
          >
            <Icon name="map" size={19} />
            <span>{isAdmin ? '小屋地图 · 主人' : '小屋地图'}</span>
          </button>
        </div>
      </header>

      <main>
        <div className="welcome-copy" key={place}>
          {place === 'yard' ? (
            <>
              <h1 ref={title} tabIndex={-1}>来家里坐坐。</h1>
              <p>推开门，里面是我的作品、过程记录与自我介绍。</p>
            </>
          ) : (
            <>
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

        {inside && (place !== 'gallery' || directoryOpen) && (
          <aside id="room-directory" className="room-content" aria-label={`${room.name}的内容`}>
            <RoomDirectory
              place={place}
              isAdmin={isAdmin}
              cloudLoading={cloudLoading}
              cloudError={cloudError}
              adminError={adminError}
              publicData={publicData}
              adminData={adminData}
              reorderBusy={reorderBusy}
              onCloseGalleryDirectory={() => setDirectoryOpen(false)}
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
                  disabled={busy || galleryIndex <= 0}
                  onClick={() => setGalleryIndex((i) => Math.max(0, i - 1))}
                >
                  <Icon name="back" size={20} />
                </button>
                <button
                  type="button"
                  className="gallery-current"
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
            <button type="button" className="enter-button" onClick={() => void navigate('hall')} disabled={busy || !ready}>
              <span>{busy ? '门开了，进来吧…' : '敲敲门，进来坐坐'}</span>
              <Icon name="arrow" />
            </button>
          ) : (
            <>
              <button type="button" className="back-button" onClick={() => void navigate(backPlace)} disabled={busy || !ready}>
                <Icon name="back" size={19} />
                <span>{place === 'hall' ? '回到小院' : '返回走廊'}</span>
              </button>

              {place === 'gallery' && (
                <div className="gallery-nav-actions">
                  {isAdmin && (
                    <button
                      type="button"
                      className="cms-nav-add-btn"
                      onClick={() => { setEditingProject(null); setProjectEditorOpen(true) }}
                    >
                      <Icon name="plus" size={17} />
                      <span>添加作品</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="directory-toggle"
                    aria-expanded={directoryOpen}
                    aria-controls="room-directory"
                    onClick={() => setDirectoryOpen(!directoryOpen)}
                  >
                    <Icon name="frame" size={18} />
                    <span>{isAdmin ? '作品管理' : '作品目录'}</span>
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

        {!ready && !loadError && (
          <div className="loading-note" role="status">
            {preparing || `正在准备小屋与庭院… ${Math.round(loadProgress * 100)}%`}
          </div>
        )}
        {loadError && (
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
          <Icon name={place === 'yard' ? 'sun' : room.icon} size={18} />
          <span>{place === 'yard' ? '门外，是个晴天' : `你在${room.name}`}</span>
        </div>
        <div className="footer-right">
          <span className="interaction-hint">
            {place === 'yard' ? '点一下门，故事就开始了' : place === 'hall' ? '沿走廊走走，遇见一扇喜欢的门' : '在这里，待一会儿也没关系'}
          </span>
          <button
            type="button"
            className={`ambient-button ${ambient ? 'active' : ''}`}
            aria-label={ambient ? '关闭环境声' : '开启环境声'}
            aria-pressed={ambient}
            onClick={() => setAmbient(!ambient)}
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
            const value = nameDraft.trim().slice(0, 12)
            if (!value) { setNameMessage('先为小屋写一个名字吧。'); return }
            setHomeName(value)
            try {
              localStorage.setItem('paper-home:name', value)
              setNameMessage('小屋的名字记住了。')
            } catch {
              setNameMessage('名字已更新；当前浏览器无法保存，下次打开会恢复默认。')
            }
          }}
        >
          <label htmlFor="home-name">
            <Icon name="pencil" size={17} />
            给小屋起个名字
          </label>
          <div>
            <input
              id="home-name"
              maxLength={12}
              value={nameDraft}
              onChange={(e) => { setNameDraft(e.target.value); setNameMessage('') }}
              placeholder="最多 12 个字"
            />
            <button type="submit">记住</button>
          </div>
          <p className="name-message" role="status">{nameMessage || '名字会保存在这台设备的浏览器里。'}</p>
        </form>

        <AdminAuthPanel
          adminEmail={adminEmail}
          pendingCleanupCount={adminData?.pendingCleanupCount ?? 0}
          onSignedIn={async () => { await refreshCloud() }}
          onSignedOut={async () => {
            setAdminEmail(null)
            setAdminData(null)
            await loadPublic()
          }}
          onRetryCleanup={async () => {
            const res = await cleanupMediaAssetsApi({ sweepOrphans: true })
            setAdminData((prev) => (prev ? { ...prev, pendingCleanupCount: res.remaining } : prev))
          }}
        />
      </Modal>

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

      <ProfileEditorModal
        open={profileEditorOpen}
        initialProfile={adminData?.profile ?? null}
        assets={adminData?.assets ?? {}}
        onAssetUploaded={registerUploadedAsset}
        onSaved={handleProfileSaved}
        onConflict={(c) => setConflict(c)}
        onClose={() => setProfileEditorOpen(false)}
      />

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

      <ConflictDialog conflict={conflict} onClose={() => setConflict(null)} />
    </div>
  )
}
