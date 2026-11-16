import { getSupabaseClient, supabaseAnonKey, supabaseUrl } from './supabase'
import { getBackendMode, getLocalHeaders } from './backend'
import { cleanupMediaAssetsApi, registerMediaAssetApi, signMediaUrlsApi } from './api'
import { ApiError, type MediaAsset, type SignedMediaEntry } from '../types/content'

export const MAX_RAW_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024 // 50 MB
export const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp'])
export const ALLOWED_VIDEO_MIME = new Set(['video/mp4', 'video/webm'])

const BUCKET_NAME = 'cottage-media'
const REFRESH_MARGIN_MS = 30_000
const MAX_CACHE_ENTRIES = 500

const urlCache = new Map<string, SignedMediaEntry>()
const signEpoch = { public: 0, admin: 0 }
const inflightSign = new Map<string, { epoch:number; promise:Promise<SignedMediaEntry | null> | null }>()

function cacheKeyFor(assetId: string, scope: 'public' | 'admin' = 'public'): string {
  return `${scope}:${assetId}`
}

function setCachedEntry(key: string, entry: SignedMediaEntry) {
  if (urlCache.has(key)) urlCache.delete(key)
  urlCache.set(key, entry)
  while (urlCache.size > MAX_CACHE_ENTRIES) {
    const oldest = urlCache.keys().next().value
    if (oldest === undefined) break
    urlCache.delete(oldest)
  }
}

export function seedSignedUrls(
  entries: Record<string, SignedMediaEntry> | undefined | null,
  scope: 'public' | 'admin' = 'public',
) {
  if (!entries) return
  for (const [id, entry] of Object.entries(entries)) {
    if (entry?.displayUrl) setCachedEntry(cacheKeyFor(id, scope), entry)
  }
}

export function evictSignedUrl(assetId: string, scope?: 'public' | 'admin') {
  if (scope) {
    urlCache.delete(cacheKeyFor(assetId, scope))
    inflightSign.delete(cacheKeyFor(assetId, scope))
    return
  }
  urlCache.delete(cacheKeyFor(assetId, 'public'))
  urlCache.delete(cacheKeyFor(assetId, 'admin'))
  inflightSign.delete(cacheKeyFor(assetId, 'public'))
  inflightSign.delete(cacheKeyFor(assetId, 'admin'))
}

export function clearSignedUrlCache(scope?: 'public' | 'admin') {
  for (const target of scope ? [scope] : ['public','admin'] as const) signEpoch[target]++
  if (!scope) {
    urlCache.clear()
    inflightSign.clear()
    return
  }
  const prefix = `${scope}:`
  for (const key of Array.from(urlCache.keys())) {
    if (key.startsWith(prefix)) urlCache.delete(key)
  }
  for (const key of Array.from(inflightSign.keys())) if (key.startsWith(prefix)) inflightSign.delete(key)
}

export function getCachedUrl(
  assetId: string | null | undefined,
  variant: 'display' | 'thumb' = 'display',
  scope: 'public' | 'admin' = 'public',
): string | null {
  if (!assetId) return null
  const entry = urlCache.get(cacheKeyFor(assetId, scope))
  if (!entry) return null
  if (Date.now() >= entry.expiresAt) return null
  return variant === 'thumb' ? (entry.thumbUrl ?? entry.displayUrl) : entry.displayUrl
}

export function isUrlNearExpiry(
  assetId: string | null | undefined,
  scope: 'public' | 'admin' = 'public',
): boolean {
  if (!assetId) return true
  const entry = urlCache.get(cacheKeyFor(assetId, scope))
  if (!entry) return true
  return Date.now() >= entry.expiresAt - REFRESH_MARGIN_MS
}

export async function refreshSignedUrl(
  assetId: string,
  scope: 'public' | 'admin',
  force = false,
): Promise<SignedMediaEntry | null> {
  const key = cacheKeyFor(assetId, scope)
  if (!force && !isUrlNearExpiry(assetId, scope)) {
    return urlCache.get(key) ?? null
  }

  const existing = inflightSign.get(key)
  if (existing?.promise) return await existing.promise

  const job = { epoch:signEpoch[scope], promise:null as Promise<SignedMediaEntry | null> | null }
  const current = () => signEpoch[scope] === job.epoch && inflightSign.get(key) === job
  inflightSign.set(key, job)
  job.promise = (async () => {
    try {
      const res = await signMediaUrlsApi([assetId], scope)
      if (!current()) return null
      seedSignedUrls(res.signedUrls, scope)
      if (res.deniedIds.includes(assetId)) {
        urlCache.delete(key)
        return null
      }
      return res.signedUrls[assetId] ?? null
    } catch (err) {
      if (current() && err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        urlCache.delete(key)
      }
      return null
    } finally {
      if (current()) inflightSign.delete(key)
    }
  })()

  return await job.promise
}

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

async function decodeImage(file: File): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      }
    } catch {
      // Fallback to HTMLImageElement below.
    }
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('无法读取该图片文件，请确认文件未损坏。'))
      el.src = objectUrl
    })
    return {
      width: img.naturalWidth,
      height: img.naturalHeight,
      draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      close: () => URL.revokeObjectURL(objectUrl),
    }
  } catch (err) {
    URL.revokeObjectURL(objectUrl)
    throw err
  }
}

async function canvasEncode(
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void,
  srcW: number,
  srcH: number,
  maxEdge: number,
  quality: number,
): Promise<{ blob: Blob; mimeType: string; ext: string; width: number; height: number }> {
  const scale = Math.min(1, maxEdge / Math.max(srcW, srcH))
  const width = Math.max(1, Math.round(srcW * scale))
  const height = Math.max(1, Math.round(srcH * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器不支持画布压缩处理')
  draw(ctx, width, height)

  const tryEncode = (type: string, q: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q))

  const webp = await tryEncode('image/webp', quality)
  if (webp && webp.type === 'image/webp') {
    return { blob: webp, mimeType: 'image/webp', ext: 'webp', width, height }
  }
  const jpeg = await tryEncode('image/jpeg', Math.min(0.92, quality + 0.04))
  if (jpeg) {
    return { blob: jpeg, mimeType: 'image/jpeg', ext: 'jpg', width, height }
  }
  throw new Error('图片编码失败，请尝试更换图片格式。')
}

export async function processAndUploadImage(file: File, signal?: AbortSignal): Promise<{ asset: MediaAsset; signedEntry: SignedMediaEntry | null }> {
  signal?.throwIfAborted()
  if (!ALLOWED_IMAGE_MIME.has(file.type)) {
    throw new Error('仅支持 JPEG、PNG、WebP 格式图片。')
  }
  if (file.size <= 0 || file.size > MAX_RAW_IMAGE_BYTES) {
    throw new Error(`图片文件大小超出 10 MB 上限（当前 ${(file.size / 1048576).toFixed(2)} MB），请压缩后再试。`)
  }

  const decoded = await decodeImage(file)
  if (decoded.width <= 0 || decoded.height <= 0) {
    decoded.close()
    throw new Error('图片尺寸无效，请更换图片。')
  }

  let display: Awaited<ReturnType<typeof canvasEncode>>
  let thumb: Awaited<ReturnType<typeof canvasEncode>>
  try {
    signal?.throwIfAborted()
    display = await canvasEncode(decoded.draw, decoded.width, decoded.height, 1600, 0.84)
    signal?.throwIfAborted()
    thumb = await canvasEncode(decoded.draw, decoded.width, decoded.height, 640, 0.8)
    signal?.throwIfAborted()
  } finally {
    decoded.close()
  }

  const assetId = createId()
  const displayPath = `images/${assetId}/display.${display.ext}`
  const thumbPath = `images/${assetId}/thumb.${thumb.ext}`
  const mode = await getBackendMode()
  signal?.throwIfAborted()

  const finish = async (asset: MediaAsset) => {
    try {
      signal?.throwIfAborted()
      const signedEntry = await refreshSignedUrl(asset.id, 'admin', true)
      signal?.throwIfAborted()
      return { asset, signedEntry }
    } catch (error) {
      // Reference-aware cleanup never removes media saved by another content write.
      await cleanupMediaAssetsApi({ candidateAssetIds: [asset.id] }).catch(() => undefined)
      throw error
    }
  }

  if (mode === 'local-studio') {
    try {
    const uploadLocalBlob = async (variant: 'display' | 'thumb', blob: Blob, mimeType: string) => {
      const res = await fetch(
        `/__local-cms/media-upload?assetId=${encodeURIComponent(assetId)}&variant=${variant}&mimeType=${encodeURIComponent(mimeType)}`,
        {
          method: 'POST',
          headers: {
            ...getLocalHeaders(),
            'Content-Type': 'application/octet-stream',
          },
          body: blob,
          signal,
        },
      )
      const bodyText = await res.text().catch(() => '')
      if (!res.ok) {
        let errMsg = ''
        try {
          errMsg = (JSON.parse(bodyText) as { error?: string }).error || ''
        } catch {
          errMsg = ''
        }
        throw new Error(errMsg || `本地保存图片失败（${res.status}）`)
      }
    }
    await Promise.all([
      uploadLocalBlob('display', display.blob, display.mimeType),
      uploadLocalBlob('thumb', thumb.blob, thumb.mimeType),
    ])
    signal?.throwIfAborted()

    const asset = await registerMediaAssetApi({
      assetId,
      kind: 'image',
      displayPath,
      thumbPath,
      mimeType: display.mimeType,
      byteSize: display.blob.size + thumb.blob.size,
      width: display.width,
      height: display.height,
      durationSec: null,
      originalFilename: file.name,
    })

    return await finish(asset)
    } catch(error) {
      await cleanupMediaAssetsApi({candidateAssetIds:[assetId]}).catch(()=>undefined)
      await fetch(`/__local-cms/media-upload?assetId=${encodeURIComponent(assetId)}`,{method:'DELETE',headers:getLocalHeaders()}).catch(()=>undefined)
      throw error
    }
  }

  if (mode !== 'cloud') {
    throw new Error('当前为只读展示模式，无法上传图片。')
  }

  const client = await getSupabaseClient()
  signal?.throwIfAborted()
  const [upDisplay, upThumb] = await Promise.all([
    client.storage.from(BUCKET_NAME).upload(displayPath, display.blob, {
      contentType: display.mimeType,
      upsert: true,
    }),
    client.storage.from(BUCKET_NAME).upload(thumbPath, thumb.blob, {
      contentType: thumb.mimeType,
      upsert: true,
    }),
  ])

  if (upDisplay.error || upThumb.error) {
    await client.storage.from(BUCKET_NAME).remove([displayPath, thumbPath]).catch(() => undefined)
    const msg = upDisplay.error?.message || upThumb.error?.message || '上传失败'
    throw new Error(
      msg.toLowerCase().includes('quota') || msg.toLowerCase().includes('storage')
        ? '云端存储额度可能已满，请先压缩或清理旧素材后再试。'
        : `图片上传失败：${msg}`,
    )
  }

  let registrationAttempted = false
  try {
    signal?.throwIfAborted()
    registrationAttempted = true
    const asset = await registerMediaAssetApi({
      assetId,
      kind: 'image',
      displayPath,
      thumbPath,
      mimeType: display.mimeType,
      byteSize: display.blob.size + thumb.blob.size,
      width: display.width,
      height: display.height,
      durationSec: null,
      originalFilename: file.name,
    })

    return await finish(asset)
  } catch (err) {
    if (registrationAttempted) {
      await cleanupMediaAssetsApi({ candidateAssetIds: [assetId] }).catch(() => undefined)
    } else {
      await client.storage.from(BUCKET_NAME).remove([displayPath, thumbPath]).catch(() => undefined)
    }
    throw err
  }
}

export async function validateVideoFile(file: File, signal?: AbortSignal): Promise<{ mimeType: string; width: number; height: number; durationSec: number }> {
  signal?.throwIfAborted()
  const mime = file.type || (file.name.toLowerCase().endsWith('.webm') ? 'video/webm' : file.name.toLowerCase().endsWith('.mp4') ? 'video/mp4' : '')
  if (!ALLOWED_VIDEO_MIME.has(mime)) {
    throw new Error('仅支持浏览器可播放的 MP4 或 WebM 视频文件。')
  }
  if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
    throw new Error(`视频大小超出 50 MB 上限（当前 ${(file.size / 1048576).toFixed(2)} MB），请先裁剪或压缩后再上传。`)
  }

  const objectUrl = URL.createObjectURL(file)
  try {
    const meta = await new Promise<{ width: number; height: number; durationSec: number }>((resolve, reject) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.muted = true
      video.playsInline = true
      const cleanup = () => {
        window.clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        video.onloadedmetadata = null
        video.onerror = null
        video.removeAttribute('src')
        video.load()
      }
      const abort = () => { cleanup(); reject(new DOMException('已取消视频检查', 'AbortError')) }
      const timer = window.setTimeout(() => {
        cleanup()
        reject(new Error('视频元信息解析超时，请检查视频编码。'))
      }, 10_000)
      video.onloadedmetadata = () => {
        const w = video.videoWidth, h = video.videoHeight, d = video.duration
        cleanup()
        if (w > 0 && h > 0 && Number.isFinite(d) && d > 0) resolve({ width:w, height:h, durationSec:d })
        else reject(new Error('无法识别视频画面或时长，请转换编码后重试。'))
      }
      video.onerror = () => { cleanup(); reject(new Error('当前浏览器无法播放该视频编码。')) }
      signal?.addEventListener('abort', abort, { once:true })
      if (signal?.aborted) { abort(); return }
      video.src = objectUrl
    })

    return { mimeType: mime, ...meta }
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

export interface VideoUploadController {
  assetId: string
  start: () => void
  cancel: () => Promise<void>
}

function createLocalVideoUpload(
  file: File,
  meta: { mimeType: string; width: number; height: number; durationSec: number },
  callbacks: {
    onProgress: (percent: number, uploadedBytes: number, totalBytes: number) => void
    onSuccess: (asset: MediaAsset) => void
    onError: (message: string) => void
  },
): VideoUploadController {
  const assetId = createId()
  const ext = meta.mimeType === 'video/webm' ? 'webm' : 'mp4'
  const displayPath = `videos/${assetId}/demo.${ext}`
  const chunkSize = 6 * 1024 * 1024
  let cancelled = false
  let activeXhr: XMLHttpRequest | null = null

  const sendChunk = (chunk: Blob, startOffset: number, reset: boolean, isFinal: boolean) =>
    new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      activeXhr = xhr
      const url = `/__local-cms/media-upload?assetId=${encodeURIComponent(assetId)}&variant=video&ext=${ext}&mimeType=${encodeURIComponent(meta.mimeType)}&reset=${reset ? 1 : 0}&final=${isFinal ? 1 : 0}`
      xhr.open('POST', url)
      for (const [k, v] of Object.entries(getLocalHeaders())) {
        xhr.setRequestHeader(k, v)
      }
      xhr.setRequestHeader('Content-Type', 'application/octet-stream')
      xhr.upload.onprogress = (e) => {
        if (cancelled) return
        const loaded = Math.min(file.size, startOffset + (e.lengthComputable ? e.loaded : 0))
        const pct = file.size > 0 ? Math.min(99, Math.round((loaded / file.size) * 100)) : 0
        callbacks.onProgress(pct, loaded, file.size)
      }
      xhr.onload = () => {
        activeXhr = null
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve()
          return
        }
        try {
          const body = JSON.parse(xhr.responseText || '{}') as { error?: string }
          reject(new Error(body.error || `本地视频写入失败（${xhr.status}）`))
        } catch {
          reject(new Error(`本地视频写入失败（${xhr.status}）`))
        }
      }
      xhr.onerror = () => {
        activeXhr = null
        reject(new Error('本地视频传输中断'))
      }
      xhr.onabort = () => {
        activeXhr = null
        reject(new Error('ABORTED'))
      }
      xhr.send(chunk)
    })

  let started = false
  const start = () => {
    if (cancelled || started) return
    started = true
    void (async () => {
      try {
        let offset = 0
        let index = 0
        while (offset < file.size) {
          if (cancelled) return
          const end = Math.min(file.size, offset + chunkSize)
          await sendChunk(file.slice(offset, end), offset, index === 0, end >= file.size)
          offset = end
          index += 1
        }
        if (cancelled) return
        const asset = await registerMediaAssetApi({
          assetId,
          kind: 'video',
          displayPath,
          thumbPath: null,
          mimeType: meta.mimeType,
          byteSize: file.size,
          width: meta.width,
          height: meta.height,
          durationSec: meta.durationSec,
          originalFilename: file.name,
        })
        if (cancelled) { await cleanupMediaAssetsApi({ candidateAssetIds:[asset.id] }); return }
        callbacks.onProgress(100, file.size, file.size)
        callbacks.onSuccess(asset)
      } catch (err) {
        if (cancelled || (err instanceof Error && err.message === 'ABORTED')) return
        callbacks.onError(err instanceof Error ? `${err.message}。可点击“重试上传”。` : '视频上传失败，请重试。')
      }
    })()
  }

  const cancel = async () => {
    cancelled = true
    activeXhr?.abort()
    activeXhr = null
    await fetch(`/__local-cms/media-upload?assetId=${encodeURIComponent(assetId)}`, {
      method: 'DELETE',
      headers: getLocalHeaders(),
    }).catch(() => undefined)
  }

  return { assetId, start, cancel }
}

export async function createResumableVideoUpload(
  file: File,
  callbacks: {
    onProgress: (percent: number, uploadedBytes: number, totalBytes: number) => void
    onSuccess: (asset: MediaAsset) => void
    onError: (message: string) => void
  },
  signal?: AbortSignal,
): Promise<VideoUploadController> {
  const meta = await validateVideoFile(file, signal)
  signal?.throwIfAborted()
  const mode = await getBackendMode()
  signal?.throwIfAborted()
  if (mode === 'local-studio') {
    return createLocalVideoUpload(file, meta, callbacks)
  }
  if (mode !== 'cloud') {
    throw new Error('当前为只读展示模式，无法上传视频。')
  }
  const client = await getSupabaseClient()
  signal?.throwIfAborted()
  const { data: sessionData, error: sessionErr } = await client.auth.getSession()
  signal?.throwIfAborted()
  const token = sessionData.session?.access_token
  if (sessionErr || !token) {
    throw new Error('请先登录主人账号后再上传视频。')
  }

  const ext = meta.mimeType === 'video/webm' ? 'webm' : 'mp4'
  const fileKey = `paper-home:tus-pending:${file.name}:${file.type}:${file.size}:${file.lastModified}`
  let assetId = createId()
  let displayPath = `videos/${assetId}/demo.${ext}`
  try {
    const raw = localStorage.getItem(fileKey)
    if (raw) {
      const parsed = JSON.parse(raw) as { assetId?: string; displayPath?: string }
      if (parsed.assetId && parsed.displayPath) {
        assetId = parsed.assetId
        displayPath = parsed.displayPath
      }
    }
  } catch {
    // Ignore storage read restrictions; fresh UUID fallback remains valid.
  }
  const persistPending = () => {
    try {
      localStorage.setItem(fileKey, JSON.stringify({ assetId, displayPath }))
    } catch {
      // Ignore storage quota errors.
    }
  }
  const clearPending = () => {
    try {
      localStorage.removeItem(fileKey)
    } catch {
      // Ignore storage errors.
    }
  }
  persistPending()
  let cancelled = false

  const { Upload } = await import('tus-js-client')
  signal?.throwIfAborted()
  const upload = new Upload(file, {
    endpoint: `${supabaseUrl}/storage/v1/upload/resumable`,
    retryDelays: [0, 1500, 3000, 6000],
    chunkSize: 6 * 1024 * 1024,
    uploadDataDuringCreation: true,
    removeFingerprintOnSuccess: true,
    onBeforeRequest: async (req) => {
      let authToken = token
      try {
        const { data } = await client.auth.getSession()
        if (data.session?.access_token) {
          authToken = data.session.access_token
        }
      } catch {
        // Fallback to initial header if session probe transiently fails.
      }
      if (!req.getHeader('authorization')) {
        req.setHeader('authorization', `Bearer ${authToken}`)
      }
    },
    headers: {
      apikey: supabaseAnonKey,
      'x-upsert': 'true',
    },
    metadata: {
      bucketName: BUCKET_NAME,
      objectName: displayPath,
      contentType: meta.mimeType,
      cacheControl: '3600',
    },
    onProgress: (bytesUploaded, bytesTotal) => {
      if (cancelled) return
      const pct = bytesTotal > 0 ? Math.min(99, Math.round((bytesUploaded / bytesTotal) * 100)) : 0
      callbacks.onProgress(pct, bytesUploaded, bytesTotal)
    },
    onError: (err) => {
      if (cancelled) return
      const msg = err?.message || '上传中断'
      if (/\b(400|401|403|404|413)\b/.test(msg)) {
        clearPending()
      }
      callbacks.onError(
        msg.includes('413') || msg.toLowerCase().includes('size')
          ? '文件超出存储单文件 50 MB 限制或剩余额度不足，请压缩后重试。'
          : `视频上传中断：${msg}。可点击“重试上传”在同一浏览器内继续。`,
      )
    },
    onSuccess: () => {
      if (cancelled) return
      void (async () => {
        try {
          const asset = await registerMediaAssetApi({
            assetId,
            kind: 'video',
            displayPath,
            thumbPath: null,
            mimeType: meta.mimeType,
            byteSize: file.size,
            width: meta.width,
            height: meta.height,
            durationSec: meta.durationSec,
            originalFilename: file.name,
          })
          if (cancelled) { await cleanupMediaAssetsApi({ candidateAssetIds:[asset.id] }); return }
          clearPending()
          callbacks.onProgress(100, file.size, file.size)
          callbacks.onSuccess(asset)
        } catch (err) {
          if (cancelled) return
          callbacks.onError(err instanceof Error ? err.message : '视频登记失败，请重试。')
        }
      })()
    },
  })

  // Check for previous interrupted upload of the same file within this browser (24h TUS TTL).
  let started = false
  const start = () => {
    if (cancelled || started) return
    started = true
    void upload.findPreviousUploads().then((previous) => {
      if (cancelled) return
      if (previous.length > 0) {
        const prevObj = previous[0].metadata?.objectName
        const match = typeof prevObj === 'string' ? prevObj.match(/^videos\/([0-9a-f-]+)\//i) : null
        if (match) {
          assetId = match[1]
          displayPath = prevObj
          if (upload.options.metadata) upload.options.metadata.objectName = prevObj
          persistPending()
        }
        upload.resumeFromPreviousUpload(previous[0])
      }
      upload.start()
    }).catch(() => {
      if (cancelled) return
      upload.start()
    })
  }

  const cancel = async () => {
    cancelled = true
    clearPending()
    try {
      await upload.abort(true)
    } catch {
      // Ignore abort errors on already-halted uploads.
    }
    await cleanupMediaAssetsApi({ candidateAssetIds:[assetId] }).catch(() => undefined)
  }

  return { assetId, start, cancel }
}
