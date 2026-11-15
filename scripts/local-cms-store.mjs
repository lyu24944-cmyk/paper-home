import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const MAX_ASSET_BYTES = 52428800 // 50 MB
export const MAX_IMAGE_BYTES = 10485760 // 10 MB
export const ALLOWED_IMAGE_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png'])
export const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm'])

export const DEFAULT_SITE_SETTINGS = {
  homeName: '我的小屋',
  plaqueTitle: '欢迎回家',
  plaqueSubtitle: '留一点时间，慢慢逛',
  yardHeading: '来家里坐坐。',
  yardSubtitle: '推开门，里面是我的作品、过程记录与自我介绍。',
  defaultAtmosphere: 'daylight',
  defaultWeather: 'clear',
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

export function isValidHttpUrl(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500) return false
  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function isValidEmail(value) {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return Boolean(trimmed) && trimmed.length <= 180 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed)
}

export function hasValidMagicBytes(buf, mimeType) {
  if (!buf || !Buffer.isBuffer(buf)) return false
  switch (mimeType) {
    case 'image/webp':
      return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP'
    case 'image/png':
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      )
    case 'image/jpeg':
      return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff
    case 'video/mp4':
      return buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp'
    case 'video/webm':
      return buf.length >= 4 && buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3
    default:
      return false
  }
}

function nowIso() {
  return new Date().toISOString()
}

function slugify(input, prefix) {
  const base = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `${prefix}-${base || 'item'}-${crypto.randomUUID().slice(0, 8)}`
}

function cleanStrArray(input, validFilter = isValidUuid) {
  if (!Array.isArray(input)) return []
  const seen = new Set()
  const out = []
  for (const raw of input) {
    if (typeof raw !== 'string') continue
    const s = raw.trim()
    if (!s || (validFilter && !validFilter(s)) || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

function cleanContactLinks(input) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => ({
      label: typeof item?.label === 'string' ? item.label.trim().slice(0, 40) : '',
      url: typeof item?.url === 'string' ? item.url.trim().slice(0, 500) : '',
    }))
    .filter((item) => item.label && isValidHttpUrl(item.url))
}

function cleanShortLines(input, maxItems = 3, maxLen = 36) {
  if (!Array.isArray(input)) return []
  return input
    .map((item) => (typeof item === 'string' ? item.trim().slice(0, maxLen) : ''))
    .filter(Boolean)
    .slice(0, maxItems)
}

const VALID_ATMOSPHERES = new Set(['dawn', 'daylight', 'golden', 'night', 'auto'])
const VALID_WEATHERS = new Set(['clear', 'rain'])

export function normalizeSiteSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const homeName = typeof src.homeName === 'string' ? src.homeName.trim().slice(0, 12) : ''
  const plaqueTitle = typeof src.plaqueTitle === 'string' ? src.plaqueTitle.trim().slice(0, 12) : ''
  const plaqueSubtitle = typeof src.plaqueSubtitle === 'string' ? src.plaqueSubtitle.trim().slice(0, 24) : ''
  const yardHeading = typeof src.yardHeading === 'string' ? src.yardHeading.trim().slice(0, 24) : ''
  const yardSubtitle = typeof src.yardSubtitle === 'string' ? src.yardSubtitle.trim().slice(0, 80) : ''
  const defaultAtmosphere = VALID_ATMOSPHERES.has(src.defaultAtmosphere)
    ? src.defaultAtmosphere
    : DEFAULT_SITE_SETTINGS.defaultAtmosphere
  const defaultWeather = VALID_WEATHERS.has(src.defaultWeather)
    ? src.defaultWeather
    : DEFAULT_SITE_SETTINGS.defaultWeather

  return {
    homeName: homeName || DEFAULT_SITE_SETTINGS.homeName,
    plaqueTitle: plaqueTitle || DEFAULT_SITE_SETTINGS.plaqueTitle,
    plaqueSubtitle: src.plaqueSubtitle !== undefined ? plaqueSubtitle : DEFAULT_SITE_SETTINGS.plaqueSubtitle,
    yardHeading: yardHeading || DEFAULT_SITE_SETTINGS.yardHeading,
    yardSubtitle: src.yardSubtitle !== undefined ? yardSubtitle : DEFAULT_SITE_SETTINGS.yardSubtitle,
    defaultAtmosphere,
    defaultWeather,
  }
}

export function createEmptyStoreData() {
  const ts = nowIso()
  return {
    schemaVersion: 1,
    siteSettingsVersion: 1,
    siteSettings: { ...DEFAULT_SITE_SETTINGS },
    orderVersions: { projects: 1, notes: 1 },
    projects: [],
    notes: [],
    profile: {
      isPublished: false,
      publishedAt: null,
      hasUnpublishedChanges: false,
      version: 1,
      updatedAt: ts,
      draft: {
        displayName: '',
        bio: '',
        focusAreas: '',
        avatarAssetId: null,
        contactEmail: '',
        contactLinks: [],
        nowNotes: [],
        quotes: [],
      },
      published: null,
    },
    assets: {},
  }
}

function createSampleSvg(title, subtitle, accentColor, bgTop, bgBottom) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="800" viewBox="0 0 1280 800">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${bgTop}" />
      <stop offset="100%" stop-color="${bgBottom}" />
    </linearGradient>
  </defs>
  <rect width="1280" height="800" fill="url(#bg)" />
  <rect x="64" y="64" width="1152" height="672" rx="18" fill="none" stroke="${accentColor}" stroke-width="4" stroke-opacity="0.35" />
  <circle cx="980" cy="220" r="88" fill="${accentColor}" fill-opacity="0.14" />
  <path d="M220 560 L440 380 L660 560 Z" fill="${accentColor}" fill-opacity="0.18" stroke="${accentColor}" stroke-width="5" />
  <rect x="305" y="540" width="270" height="140" fill="#fffdf6" stroke="${accentColor}" stroke-width="5" />
  <rect x="412" y="592" width="56" height="88" rx="4" fill="${accentColor}" fill-opacity="0.45" />
  <text x="640" y="340" text-anchor="middle" font-family="sans-serif" font-size="56" font-weight="600" fill="#29362e">${esc(title)}</text>
  <text x="640" y="410" text-anchor="middle" font-family="sans-serif" font-size="28" fill="#536154">${esc(subtitle)}</text>
</svg>`
}

export function createLocalCmsStore(rootDir, { dataDir = path.join(rootDir, 'local-data') } = {}) {
  const cottagePath = path.join(dataDir, 'cottage.json')
  const mediaDir = path.join(dataDir, 'media')

  function resolveMediaPath(relPath) {
    if (typeof relPath !== 'string' || !relPath.trim()) {
      throw new Error('媒体文件路径不能为空')
    }
    const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    if (cleanRel.includes('..')) {
      throw new Error('非法媒体文件路径')
    }
    const resolved = path.resolve(mediaDir, cleanRel)
    const mediaRootWithSep = path.resolve(mediaDir) + path.sep
    if (!resolved.startsWith(mediaRootWithSep)) {
      throw new Error('媒体路径越界')
    }
    return resolved
  }

  function readDb() {
    if (!fs.existsSync(cottagePath)) {
      return createEmptyStoreData()
    }
    const raw = JSON.parse(fs.readFileSync(cottagePath, 'utf8'))
    const base = createEmptyStoreData()
    return {
      ...base,
      ...raw,
      siteSettingsVersion: Number.isInteger(raw?.siteSettingsVersion) ? raw.siteSettingsVersion : 1,
      siteSettings: normalizeSiteSettings(raw?.siteSettings),
      orderVersions: {
        projects: Number.isInteger(raw?.orderVersions?.projects) ? raw.orderVersions.projects : 1,
        notes: Number.isInteger(raw?.orderVersions?.notes) ? raw.orderVersions.notes : 1,
      },
      projects: Array.isArray(raw?.projects) ? raw.projects : [],
      notes: Array.isArray(raw?.notes) ? raw.notes : [],
      profile:
        raw?.profile && typeof raw.profile === 'object'
          ? {
              ...base.profile,
              ...raw.profile,
              draft: {
                ...base.profile.draft,
                ...(raw.profile.draft && typeof raw.profile.draft === 'object' ? raw.profile.draft : {}),
                contactLinks: Array.isArray(raw.profile.draft?.contactLinks) ? raw.profile.draft.contactLinks : [],
                nowNotes: Array.isArray(raw.profile.draft?.nowNotes) ? raw.profile.draft.nowNotes : [],
                quotes: Array.isArray(raw.profile.draft?.quotes) ? raw.profile.draft.quotes : [],
              },
              published:
                raw.profile.published && typeof raw.profile.published === 'object'
                  ? {
                      ...base.profile.draft,
                      ...raw.profile.published,
                      contactLinks: Array.isArray(raw.profile.published.contactLinks)
                        ? raw.profile.published.contactLinks
                        : [],
                      nowNotes: Array.isArray(raw.profile.published.nowNotes) ? raw.profile.published.nowNotes : [],
                      quotes: Array.isArray(raw.profile.published.quotes) ? raw.profile.published.quotes : [],
                    }
                  : null,
            }
          : base.profile,
      assets: raw?.assets && typeof raw.assets === 'object' ? raw.assets : {},
    }
  }

  function writeDb(db) {
    fs.mkdirSync(dataDir, { recursive: true })
    const tmpPath = `${cottagePath}.${process.pid}.${Date.now()}.tmp`
    fs.writeFileSync(tmpPath, JSON.stringify(db, null, 2), 'utf8')
    fs.renameSync(tmpPath, cottagePath)
  }

  function collectSnapshotAssets(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return []
    const ids = []
    if (typeof snapshot.coverAssetId === 'string' && snapshot.coverAssetId) ids.push(snapshot.coverAssetId)
    if (typeof snapshot.videoAssetId === 'string' && snapshot.videoAssetId) ids.push(snapshot.videoAssetId)
    if (typeof snapshot.avatarAssetId === 'string' && snapshot.avatarAssetId) ids.push(snapshot.avatarAssetId)
    if (Array.isArray(snapshot.galleryAssetIds)) {
      for (const id of snapshot.galleryAssetIds) if (typeof id === 'string' && id) ids.push(id)
    }
    if (Array.isArray(snapshot.imageAssetIds)) {
      for (const id of snapshot.imageAssetIds) if (typeof id === 'string' && id) ids.push(id)
    }
    return [...new Set(ids)]
  }

  function isAssetPublic(db, assetId) {
    if (!assetId) return false
    for (const p of db.projects) {
      if (p.isPublished && p.published && collectSnapshotAssets(p.published).includes(assetId)) return true
    }
    for (const n of db.notes) {
      if (n.isPublished && n.published && collectSnapshotAssets(n.published).includes(assetId)) return true
    }
    if (db.profile?.isPublished && db.profile.published && collectSnapshotAssets(db.profile.published).includes(assetId)) {
      return true
    }
    return false
  }

  function isAssetReferenced(db, assetId) {
    if (isAssetPublic(db, assetId)) return true
    for (const p of db.projects) {
      if (collectSnapshotAssets(p.draft).includes(assetId)) return true
      if (p.published && collectSnapshotAssets(p.published).includes(assetId)) return true
    }
    for (const n of db.notes) {
      if (collectSnapshotAssets(n.draft).includes(assetId)) return true
      if (n.published && collectSnapshotAssets(n.published).includes(assetId)) return true
    }
    if (db.profile?.draft && collectSnapshotAssets(db.profile.draft).includes(assetId)) return true
    if (db.profile?.published && collectSnapshotAssets(db.profile.published).includes(assetId)) return true
    return false
  }

  function allAssetsReady(db, ids) {
    for (const id of cleanStrArray(ids)) {
      const asset = db.assets[id]
      if (!asset || asset.status !== 'ready') return false
    }
    return true
  }

  function signAssets(db, assetIds, { scope = 'public', urlPrefix = '/__local-cms/media' } = {}) {
    const signedUrls = {}
    const deniedIds = []
    const unique = [...new Set((assetIds || []).filter((x) => typeof x === 'string' && x.trim()))]

    for (const id of unique) {
      const asset = db.assets[id]
      if (!asset || asset.status !== 'ready') {
        deniedIds.push(id)
        continue
      }
      if (scope === 'public' && !isAssetPublic(db, id)) {
        deniedIds.push(id)
        continue
      }
      const ver = encodeURIComponent(String(asset.createdAt || '1'))
      signedUrls[id] = {
        displayUrl: `${urlPrefix}/${scope}/${id}/display?v=${ver}`,
        thumbUrl: asset.thumbPath ? `${urlPrefix}/${scope}/${id}/thumb?v=${ver}` : null,
        expiresAt: Date.now() + 365 * 24 * 3600 * 1000,
      }
    }
    return { signedUrls, deniedIds }
  }

  function cleanupAssetsInternal(db, candidateIds = [], sweepOrphans = false) {
    const candidates = new Set(cleanStrArray(candidateIds))
    if (sweepOrphans) {
      for (const id of Object.keys(db.assets)) {
        candidates.add(id)
      }
    }
    let cleaned = 0
    const errors = []

    for (const id of candidates) {
      const asset = db.assets[id]
      if (!asset) continue
      if (isAssetReferenced(db, id)) continue
      try {
        for (const rel of [asset.displayPath, asset.thumbPath]) {
          if (!rel) continue
          const target = resolveMediaPath(rel)
          if (fs.existsSync(target)) {
            fs.rmSync(target, { force: true })
          }
          const parentDir = path.dirname(target)
          if (fs.existsSync(parentDir) && fs.readdirSync(parentDir).length === 0) {
            fs.rmdirSync(parentDir)
          }
        }
        delete db.assets[id]
        cleaned += 1
      } catch (err) {
        errors.push(`${id}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    if (sweepOrphans && fs.existsSync(mediaDir)) {
      const staleBefore = Date.now() - 24 * 60 * 60 * 1000
      for (const kindDir of ['videos', 'images']) {
        const root = path.join(mediaDir, kindDir)
        if (!fs.existsSync(root)) continue
        for (const assetFolder of fs.readdirSync(root)) {
          const dir = path.join(root, assetFolder)
          try {
            if (!fs.statSync(dir).isDirectory()) continue
            for (const fileName of fs.readdirSync(dir)) {
              if (!fileName.endsWith('.part')) continue
              const full = path.join(dir, fileName)
              if (fs.statSync(full).mtimeMs < staleBefore) {
                fs.rmSync(full, { force: true })
              }
            }
            if (fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
          } catch {
            // Ignore partial cleanup errors on orphan directories.
          }
        }
      }
    }

    return { cleaned, remaining: errors.length, errors }
  }

  function buildPublicCottage({ urlPrefix = '/__local-cms/media' } = {}) {
    const db = readDb()
    const projects = db.projects
      .filter((p) => p.isPublished && p.published)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => ({
        id: p.id,
        slug: p.slug,
        sortOrder: p.sortOrder,
        publishedAt: p.published.publishedAt ?? p.publishedAt ?? null,
        title: p.published.title,
        summary: p.published.summary,
        body: p.published.body,
        demoUrl: p.published.demoUrl || '',
        coverAssetId: p.published.coverAssetId ?? null,
        galleryAssetIds: Array.isArray(p.published.galleryAssetIds) ? p.published.galleryAssetIds : [],
        videoAssetId: p.published.videoAssetId ?? null,
      }))

    const notes = db.notes
      .filter((n) => n.isPublished && n.published)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((n) => ({
        id: n.id,
        slug: n.slug,
        sortOrder: n.sortOrder,
        publishedAt: n.published.publishedAt ?? n.publishedAt ?? null,
        title: n.published.title,
        body: n.published.body,
        projectId: n.published.projectId ?? null,
        imageAssetIds: Array.isArray(n.published.imageAssetIds) ? n.published.imageAssetIds : [],
        videoAssetId: n.published.videoAssetId ?? null,
      }))

    const profile =
      db.profile?.isPublished && db.profile.published
        ? {
            displayName: db.profile.published.displayName || '',
            bio: db.profile.published.bio || '',
            focusAreas: db.profile.published.focusAreas || '',
            avatarAssetId: db.profile.published.avatarAssetId ?? null,
            contactEmail: db.profile.published.contactEmail || '',
            contactLinks: Array.isArray(db.profile.published.contactLinks) ? db.profile.published.contactLinks : [],
            nowNotes: cleanShortLines(db.profile.published.nowNotes, 3, 36),
            quotes: cleanShortLines(db.profile.published.quotes, 8, 120),
            publishedAt: db.profile.published.publishedAt ?? db.profile.publishedAt ?? null,
          }
        : null

    const assetIds = [
      ...projects.flatMap((p) => collectSnapshotAssets(p)),
      ...notes.flatMap((n) => collectSnapshotAssets(n)),
      ...(profile ? collectSnapshotAssets(profile) : []),
    ]
    const { signedUrls } = signAssets(db, assetIds, { scope: 'public', urlPrefix })

    return {
      projects,
      notes,
      profile,
      siteSettings: normalizeSiteSettings(db.siteSettings),
      signedUrls,
    }
  }

  function buildAdminCottage({ urlPrefix = '/__local-cms/media' } = {}) {
    const db = readDb()
    const projects = db.projects.slice().sort((a, b) => a.sortOrder - b.sortOrder)
    const notes = db.notes.slice().sort((a, b) => a.sortOrder - b.sortOrder)
    const publicAssets = {}
    const assetIds = []
    for (const [id, asset] of Object.entries(db.assets)) {
      if (asset.status === 'pending_delete') continue
      assetIds.push(id)
      publicAssets[id] = {
        id: asset.id,
        kind: asset.kind,
        status: asset.status,
        mimeType: asset.mimeType,
        byteSize: asset.byteSize,
        width: asset.width ?? null,
        height: asset.height ?? null,
        durationSec: asset.durationSec ?? null,
        originalFilename: asset.originalFilename ?? null,
        createdAt: asset.createdAt,
      }
    }
    const { signedUrls } = signAssets(db, assetIds, { scope: 'admin', urlPrefix })

    return {
      adminUserId: 'local-owner',
      projects,
      notes,
      profile: db.profile,
      siteSettings: normalizeSiteSettings(db.siteSettings),
      siteSettingsVersion: db.siteSettingsVersion,
      orderVersions: db.orderVersions,
      assets: publicAssets,
      signedUrls,
      pendingCleanupCount: 0,
    }
  }

  function resolveAssetFile(assetId, variant, scope = 'public') {
    if (!isValidUuid(assetId)) return { status: 400, error: '非法素材 ID' }
    const db = readDb()
    const asset = db.assets[assetId]
    if (!asset || asset.status !== 'ready') {
      return { status: 404, error: '素材不存在或未就绪' }
    }
    if (scope === 'public' && !isAssetPublic(db, assetId)) {
      return { status: 403, error: '请求的素材未发布或已撤回' }
    }
    const rel = variant === 'thumb' ? (asset.thumbPath || asset.displayPath) : asset.displayPath
    if (!rel) return { status: 404, error: '素材文件缺失' }
    const filePath = resolveMediaPath(rel)
    if (!fs.existsSync(filePath)) {
      return { status: 404, error: '本地磁盘素材文件不存在' }
    }
    const thumbMimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp',
    }
    const thumbExt = variant === 'thumb' && asset.thumbPath ? path.extname(rel).toLowerCase() : ''
    const mimeType = (thumbExt && thumbMimeMap[thumbExt]) || asset.mimeType
    return { status: 200, filePath, mimeType }
  }

  function hasAsset(assetId) {
    if (!isValidUuid(assetId)) return false
    const db = readDb()
    return Boolean(db.assets[assetId])
  }

  function writeUploadedMediaBlob(assetId, variant, ext, buffer, mimeType = '') {
    if (!isValidUuid(assetId)) throw httpError(400, '非法素材 ID')
    if (hasAsset(assetId)) throw httpError(409, '该素材 ID 已完成登记，禁止覆盖')
    if (mimeType && !hasValidMagicBytes(buffer, mimeType)) {
      throw httpError(400, '上传文件头部签名与声明的图片格式不符')
    }
    const kindDir = variant === 'video' ? 'videos' : 'images'
    const safeExt = String(ext || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
    const filename = variant === 'thumb' ? `thumb.${safeExt}` : variant === 'video' ? `demo.${safeExt}` : `display.${safeExt}`
    const relPath = `${kindDir}/${assetId}/${filename}`
    const fullPath = resolveMediaPath(relPath)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, buffer)
    return relPath
  }

  function appendVideoChunk(assetId, ext, buffer, { reset = false, finalize = false, mimeType = '' } = {}) {
    if (!isValidUuid(assetId)) throw httpError(400, '非法素材 ID')
    if (hasAsset(assetId)) throw httpError(409, '该素材 ID 已完成登记，禁止覆盖')
    const safeExt = ext === 'webm' ? 'webm' : 'mp4'
    const partRel = `videos/${assetId}/demo.${safeExt}.part`
    const finalRel = `videos/${assetId}/demo.${safeExt}`
    const partPath = resolveMediaPath(partRel)
    const finalPath = resolveMediaPath(finalRel)
    fs.mkdirSync(path.dirname(partPath), { recursive: true })
    if (reset && fs.existsSync(partPath)) fs.rmSync(partPath, { force: true })
    const isFirstChunk = reset || !fs.existsSync(partPath)
    if (isFirstChunk && mimeType && !hasValidMagicBytes(buffer, mimeType)) {
      throw httpError(400, '视频文件头部签名与声明的视频格式不符')
    }
    fs.appendFileSync(partPath, buffer)
    const stat = fs.statSync(partPath)
    if (stat.size > MAX_ASSET_BYTES) {
      fs.rmSync(partPath, { force: true })
      throw httpError(413, '视频文件超出 50 MB 上限')
    }
    if (finalize) {
      fs.renameSync(partPath, finalPath)
      return { relPath: finalRel, byteSize: stat.size }
    }
    return { relPath: partRel, byteSize: stat.size }
  }

  function abortVideoUpload(assetId) {
    if (!isValidUuid(assetId)) return
    const dir = resolveMediaPath(`videos/${assetId}/_`).replace(/[\\/]_$/, '')
    if (!fs.existsSync(dir)) return
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith('.part')) fs.rmSync(path.join(dir, name), { force: true })
    }
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  }

  function mutate(action, payload = {}) {
    const db = readDb()
    const ts = nowIso()

    if (action === 'media.register') {
      const assetId = typeof payload.assetId === 'string' ? payload.assetId.trim() : ''
      const kind = payload.kind === 'image' || payload.kind === 'video' ? payload.kind : null
      const displayPath = typeof payload.displayPath === 'string' ? payload.displayPath.trim() : ''
      const thumbPath = typeof payload.thumbPath === 'string' ? payload.thumbPath.trim() : null
      const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : ''
      const byteSize = Number(payload.byteSize ?? 0)

      if (!isValidUuid(assetId) || !kind || !displayPath || byteSize <= 0 || byteSize > MAX_ASSET_BYTES) {
        return { status: 400, body: { ok: false, error: '媒体参数不合法或文件超出 50 MB 限制' } }
      }
      if (db.assets[assetId]) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '该素材 ID 已完成登记，禁止覆盖。' } }
      }
      const expectedPrefix = `${kind}s/${assetId}/`
      if (!displayPath.startsWith(expectedPrefix) || (thumbPath && !thumbPath.startsWith(expectedPrefix))) {
        return { status: 400, body: { ok: false, error: '媒体存储路径格式不合法' } }
      }
      if (kind === 'image' && !ALLOWED_IMAGE_MIMES.has(mimeType)) {
        return { status: 400, body: { ok: false, error: '仅支持 WebP、JPEG 或 PNG 图片' } }
      }
      if (kind === 'video' && !ALLOWED_VIDEO_MIMES.has(mimeType)) {
        return { status: 400, body: { ok: false, error: '仅支持 MP4 或 WebM 视频' } }
      }
      const fullDisplayPath = resolveMediaPath(displayPath)
      if (!fs.existsSync(fullDisplayPath)) {
        return { status: 400, body: { ok: false, error: '本地媒体文件尚未写入完成，请重试上传' } }
      }
      const diskStat = fs.statSync(fullDisplayPath)
      const maxAllowed = kind === 'image' ? MAX_IMAGE_BYTES : MAX_ASSET_BYTES
      if (diskStat.size <= 0 || diskStat.size > maxAllowed) {
        return { status: 400, body: { ok: false, error: '媒体文件大小不合法或超出上限' } }
      }
      const headBuf = Buffer.alloc(16)
      const fd = fs.openSync(fullDisplayPath, 'r')
      let readLen = 0
      try {
        readLen = fs.readSync(fd, headBuf, 0, headBuf.length, 0)
      } finally {
        fs.closeSync(fd)
      }
      if (!hasValidMagicBytes(headBuf.subarray(0, readLen), mimeType)) {
        return { status: 400, body: { ok: false, error: '文件内容与声明的媒体类型不匹配' } }
      }

      const asset = {
        id: assetId,
        kind,
        status: 'ready',
        displayPath,
        thumbPath,
        mimeType,
        byteSize,
        width: typeof payload.width === 'number' ? Math.round(payload.width) : null,
        height: typeof payload.height === 'number' ? Math.round(payload.height) : null,
        durationSec: typeof payload.durationSec === 'number' ? payload.durationSec : null,
        originalFilename: typeof payload.originalFilename === 'string' ? payload.originalFilename.slice(0, 180) : null,
        createdAt: ts,
      }
      db.assets[assetId] = asset
      writeDb(db)
      return {
        status: 200,
        body: {
          ok: true,
          asset: {
            id: asset.id,
            kind: asset.kind,
            status: asset.status,
            mimeType: asset.mimeType,
            byteSize: asset.byteSize,
            width: asset.width,
            height: asset.height,
            durationSec: asset.durationSec,
            originalFilename: asset.originalFilename,
            createdAt: asset.createdAt,
          },
        },
      }
    }

    if (action === 'settings.save') {
      const expectedVersion = payload.expectedVersion
      if (Number.isInteger(expectedVersion) && expectedVersion !== db.siteSettingsVersion) {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'CONFLICT',
            error: '小屋设置在另一标签页已有更新，请刷新后再保存。',
            latest: { siteSettings: db.siteSettings, siteSettingsVersion: db.siteSettingsVersion },
          },
        }
      }
      const nextName = typeof payload.homeName === 'string' ? payload.homeName.trim().slice(0, 12) : ''
      if (!nextName) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: '请先为小屋写一个名字。' } }
      }
      db.siteSettings = normalizeSiteSettings(payload)
      db.siteSettingsVersion += 1
      writeDb(db)
      return {
        status: 200,
        body: {
          ok: true,
          siteSettings: db.siteSettings,
          siteSettingsVersion: db.siteSettingsVersion,
          pendingCleanupCount: 0,
        },
      }
    }

    if (action === 'project.save_draft') {
      const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null
      const draft = {
        title: String(payload.title ?? ''),
        summary: String(payload.summary ?? ''),
        body: String(payload.body ?? ''),
        demoUrl: String(payload.demoUrl ?? '').trim(),
        coverAssetId: isValidUuid(payload.coverAssetId) ? payload.coverAssetId.trim() : null,
        galleryAssetIds: cleanStrArray(payload.galleryAssetIds),
        videoAssetId: isValidUuid(payload.videoAssetId) ? payload.videoAssetId.trim() : null,
      }
      if (draft.demoUrl && !isValidHttpUrl(draft.demoUrl)) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: '演示链接格式无效，请以 http:// 或 https:// 开头。' } }
      }
      if (!id) {
        const nextSlug = (typeof payload.slug === 'string' && payload.slug.trim()) || slugify(draft.title, 'project')
        if (db.projects.some((p) => p.slug === nextSlug)) {
          return { status: 409, body: { ok: false, code: 'SLUG_TAKEN', error: '作品短链接已存在，请换一个标题或标识。' } }
        }
        const nextOrder = db.projects.length === 0 ? 0 : Math.max(...db.projects.map((p) => p.sortOrder)) + 1
        const project = {
          id: crypto.randomUUID(),
          slug: nextSlug,
          sortOrder: nextOrder,
          isPublished: false,
          publishedAt: null,
          hasUnpublishedChanges: true,
          version: 1,
          updatedAt: ts,
          draft,
          published: null,
        }
        db.projects.push(project)
        writeDb(db)
        return { status: 200, body: { ok: true, project, pendingCleanupCount: 0 } }
      }

      const idx = db.projects.findIndex((p) => p.id === id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.projects[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改，请核对后再覆盖。', latest: current } }
      }
      const prevAssets = collectSnapshotAssets(current.draft)
      const updated = {
        ...current,
        draft,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
      }
      db.projects[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, project: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'project.publish') {
      const idx = db.projects.findIndex((p) => p.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.projects[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const errors = []
      if (!current.draft.title.trim()) errors.push('请填写作品标题')
      if (!current.draft.summary.trim()) errors.push('请填写作品简介')
      if (!current.draft.body.trim()) errors.push('请填写作品正文')
      if (!current.draft.coverAssetId) errors.push('请上传作品封面图')
      if (current.draft.demoUrl && !isValidHttpUrl(current.draft.demoUrl)) {
        errors.push('演示链接必须以 http:// 或 https:// 开头')
      }
      if (!allAssetsReady(db, collectSnapshotAssets(current.draft))) {
        errors.push('部分图片或视频尚未上传完成，请等待上传就绪后再发布')
      }
      if (errors.length > 0) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: errors.join('；'), errors } }
      }
      const prevPubAssets = current.published ? collectSnapshotAssets(current.published) : []
      const pubAt = current.publishedAt || ts
      const updated = {
        ...current,
        isPublished: true,
        publishedAt: pubAt,
        hasUnpublishedChanges: false,
        version: current.version + 1,
        updatedAt: ts,
        published: { ...current.draft, publishedAt: pubAt },
      }
      db.projects[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevPubAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, project: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'project.unpublish') {
      const idx = db.projects.findIndex((p) => p.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.projects[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const prevPubAssets = current.published ? collectSnapshotAssets(current.published) : []
      const updated = {
        ...current,
        isPublished: false,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
        published: null,
      }
      db.projects[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevPubAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, project: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'project.delete') {
      const idx = db.projects.findIndex((p) => p.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.projects[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const candidates = [...collectSnapshotAssets(current.draft), ...collectSnapshotAssets(current.published)]
      db.projects.splice(idx, 1)
      for (const note of db.notes) {
        if (note.draft?.projectId === current.id) note.draft.projectId = null
        if (note.published?.projectId === current.id) note.published.projectId = null
      }
      const cleanup = cleanupAssetsInternal(db, candidates, false)
      writeDb(db)
      return { status: 200, body: { ok: true, deleted_id: current.id, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'project.reorder') {
      const orderedIds = cleanStrArray(payload.orderedIds)
      const existingSorted = db.projects.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((p) => p.id)
      const sameSet =
        orderedIds.length === existingSorted.length &&
        orderedIds.slice().sort().every((id, i) => id === existingSorted.slice().sort()[i])
      if (db.orderVersions.projects !== Number(payload.expectedOrderVersion) || !sameSet) {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'CONFLICT',
            error: '作品排序已被另一窗口修改，请核对最新顺序。',
            order_version: db.orderVersions.projects,
            latest_order: existingSorted,
          },
        }
      }
      orderedIds.forEach((id, order) => {
        const item = db.projects.find((p) => p.id === id)
        if (item) item.sortOrder = order
      })
      db.orderVersions.projects += 1
      writeDb(db)
      return { status: 200, body: { ok: true, order_version: db.orderVersions.projects, pendingCleanupCount: 0 } }
    }

    if (action === 'note.save_draft') {
      const id = typeof payload.id === 'string' && payload.id.trim() ? payload.id.trim() : null
      const draft = {
        title: String(payload.title ?? ''),
        body: String(payload.body ?? ''),
        projectId: isValidUuid(payload.projectId) ? payload.projectId.trim() : null,
        imageAssetIds: cleanStrArray(payload.imageAssetIds),
        videoAssetId: isValidUuid(payload.videoAssetId) ? payload.videoAssetId.trim() : null,
      }
      if (draft.projectId && !db.projects.some((p) => p.id === draft.projectId)) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: '关联的作品不存在或已被删除。' } }
      }
      if (!id) {
        const nextSlug = (typeof payload.slug === 'string' && payload.slug.trim()) || slugify(draft.title, 'note')
        if (db.notes.some((n) => n.slug === nextSlug)) {
          return { status: 409, body: { ok: false, code: 'SLUG_TAKEN', error: '手记短链接已存在，请换一个标题或标识。' } }
        }
        const nextOrder = db.notes.length === 0 ? 0 : Math.max(...db.notes.map((n) => n.sortOrder)) + 1
        const note = {
          id: crypto.randomUUID(),
          slug: nextSlug,
          sortOrder: nextOrder,
          isPublished: false,
          publishedAt: null,
          hasUnpublishedChanges: true,
          version: 1,
          updatedAt: ts,
          draft,
          published: null,
        }
        db.notes.push(note)
        writeDb(db)
        return { status: 200, body: { ok: true, note, pendingCleanupCount: 0 } }
      }

      const idx = db.notes.findIndex((n) => n.id === id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.notes[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const prevAssets = collectSnapshotAssets(current.draft)
      const updated = {
        ...current,
        draft,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
      }
      db.notes[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, note: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'note.publish') {
      const idx = db.notes.findIndex((n) => n.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.notes[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const errors = []
      if (!current.draft.title.trim()) errors.push('请填写手记标题')
      if (!current.draft.body.trim()) errors.push('请填写手记正文')
      if (!allAssetsReady(db, collectSnapshotAssets(current.draft))) {
        errors.push('部分图片或视频尚未上传完成，请等待上传就绪后再发布')
      }
      if (errors.length > 0) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: errors.join('；'), errors } }
      }
      const prevPubAssets = current.published ? collectSnapshotAssets(current.published) : []
      const pubAt = current.publishedAt || ts
      const updated = {
        ...current,
        isPublished: true,
        publishedAt: pubAt,
        hasUnpublishedChanges: false,
        version: current.version + 1,
        updatedAt: ts,
        published: { ...current.draft, publishedAt: pubAt },
      }
      db.notes[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevPubAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, note: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'note.unpublish') {
      const idx = db.notes.findIndex((n) => n.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.notes[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const prevPubAssets = current.published ? collectSnapshotAssets(current.published) : []
      const updated = {
        ...current,
        isPublished: false,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
        published: null,
      }
      db.notes[idx] = updated
      const cleanup = cleanupAssetsInternal(db, prevPubAssets, false)
      writeDb(db)
      return { status: 200, body: { ok: true, note: updated, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'note.delete') {
      const idx = db.notes.findIndex((n) => n.id === payload.id)
      if (idx === -1) return { status: 404, body: { ok: false, code: 'NOT_FOUND', error: '记录不存在或已被删除。' } }
      const current = db.notes[idx]
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '本地内容已被另一窗口修改。', latest: current } }
      }
      const candidates = [...collectSnapshotAssets(current.draft), ...collectSnapshotAssets(current.published)]
      db.notes.splice(idx, 1)
      const cleanup = cleanupAssetsInternal(db, candidates, false)
      writeDb(db)
      return { status: 200, body: { ok: true, deleted_id: current.id, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'note.reorder') {
      const orderedIds = cleanStrArray(payload.orderedIds)
      const existingSorted = db.notes.slice().sort((a, b) => a.sortOrder - b.sortOrder).map((n) => n.id)
      const sameSet =
        orderedIds.length === existingSorted.length &&
        orderedIds.slice().sort().every((id, i) => id === existingSorted.slice().sort()[i])
      if (db.orderVersions.notes !== Number(payload.expectedOrderVersion) || !sameSet) {
        return {
          status: 409,
          body: {
            ok: false,
            code: 'CONFLICT',
            error: '手记排序已被另一窗口修改，请核对最新顺序。',
            order_version: db.orderVersions.notes,
            latest_order: existingSorted,
          },
        }
      }
      orderedIds.forEach((id, order) => {
        const item = db.notes.find((n) => n.id === id)
        if (item) item.sortOrder = order
      })
      db.orderVersions.notes += 1
      writeDb(db)
      return { status: 200, body: { ok: true, order_version: db.orderVersions.notes, pendingCleanupCount: 0 } }
    }

    if (action === 'profile.save_draft') {
      const current = db.profile
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '个人介绍已被另一窗口修改。', latest: current } }
      }
      const contactEmail = String(payload.contactEmail ?? '').trim()
      if (contactEmail && !isValidEmail(contactEmail)) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: '联系邮箱格式无效。' } }
      }
      if (Array.isArray(payload.contactLinks)) {
        for (const item of payload.contactLinks) {
          const label = typeof item?.label === 'string' ? item.label.trim() : ''
          const url = typeof item?.url === 'string' ? item.url.trim() : ''
          if (!label && !url) continue
          if (!label || !isValidHttpUrl(url)) {
            return {
              status: 400,
              body: { ok: false, code: 'VALIDATION_ERROR', error: '联系方式链接需要同时填写名称与有效 http(s):// 网址。' },
            }
          }
        }
      }
      const prevAvatar = current.draft?.avatarAssetId
      const draft = {
        displayName: String(payload.displayName ?? ''),
        bio: String(payload.bio ?? ''),
        focusAreas: String(payload.focusAreas ?? ''),
        avatarAssetId: isValidUuid(payload.avatarAssetId) ? payload.avatarAssetId.trim() : null,
        contactEmail,
        contactLinks: cleanContactLinks(payload.contactLinks),
        nowNotes: cleanShortLines(payload.nowNotes, 3, 36),
        quotes: cleanShortLines(payload.quotes, 8, 120),
      }
      db.profile = {
        ...current,
        draft,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
      }
      const cleanup = prevAvatar && prevAvatar !== draft.avatarAssetId
        ? cleanupAssetsInternal(db, [prevAvatar], false)
        : { remaining: 0 }
      writeDb(db)
      return { status: 200, body: { ok: true, profile: db.profile, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'profile.publish') {
      const current = db.profile
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '个人介绍已被另一窗口修改。', latest: current } }
      }
      const d = current.draft
      const errors = []
      if (
        !d.displayName.trim() &&
        !d.bio.trim() &&
        !d.focusAreas.trim() &&
        !d.avatarAssetId &&
        !d.contactEmail.trim() &&
        d.contactLinks.length === 0 &&
        (!Array.isArray(d.nowNotes) || d.nowNotes.length === 0) &&
        (!Array.isArray(d.quotes) || d.quotes.length === 0)
      ) {
        errors.push('请至少填写一项公开介绍内容后再发布')
      }
      if (d.contactEmail && !isValidEmail(d.contactEmail)) {
        errors.push('联系邮箱格式无效')
      }
      if (d.avatarAssetId && !allAssetsReady(db, [d.avatarAssetId])) {
        errors.push('头像尚未上传完成，请等待上传就绪后再发布')
      }
      if (errors.length > 0) {
        return { status: 400, body: { ok: false, code: 'VALIDATION_ERROR', error: errors.join('；'), errors } }
      }
      const prevAvatar = current.published?.avatarAssetId
      const pubAt = current.publishedAt || ts
      db.profile = {
        ...current,
        isPublished: true,
        publishedAt: pubAt,
        hasUnpublishedChanges: false,
        version: current.version + 1,
        updatedAt: ts,
        published: { ...d, publishedAt: pubAt },
      }
      const cleanup = prevAvatar && prevAvatar !== d.avatarAssetId
        ? cleanupAssetsInternal(db, [prevAvatar], false)
        : { remaining: 0 }
      writeDb(db)
      return { status: 200, body: { ok: true, profile: db.profile, pendingCleanupCount: cleanup.remaining } }
    }

    if (action === 'profile.unpublish') {
      const current = db.profile
      if (current.version !== Number(payload.expectedVersion)) {
        return { status: 409, body: { ok: false, code: 'CONFLICT', error: '个人介绍已被另一窗口修改。', latest: current } }
      }
      const prevAvatar = current.published?.avatarAssetId
      db.profile = {
        ...current,
        isPublished: false,
        hasUnpublishedChanges: true,
        version: current.version + 1,
        updatedAt: ts,
        published: null,
      }
      const cleanup = prevAvatar ? cleanupAssetsInternal(db, [prevAvatar], false) : { remaining: 0 }
      writeDb(db)
      return { status: 200, body: { ok: true, profile: db.profile, pendingCleanupCount: cleanup.remaining } }
    }

    return { status: 400, body: { ok: false, error: `不支持的本地操作：${action}` } }
  }

  function exportStaticSnapshot(outSnapshotDir) {
    const db = readDb()
    const base = buildPublicCottage()
    const mediaOutDir = path.join(outSnapshotDir, 'media')
    fs.rmSync(outSnapshotDir, { recursive: true, force: true })
    fs.mkdirSync(mediaOutDir, { recursive: true })

    const neededIds = [
      ...base.projects.flatMap((p) => collectSnapshotAssets(p)),
      ...base.notes.flatMap((n) => collectSnapshotAssets(n)),
      ...(base.profile ? collectSnapshotAssets(base.profile) : []),
    ]
    const staticSignedUrls = {}

    const mediaRootPrefix = path.resolve(mediaOutDir) + path.sep
    for (const id of [...new Set(neededIds)]) {
      const asset = db.assets[id]
      if (!asset || asset.status !== 'ready') continue
      const displaySrc = resolveMediaPath(asset.displayPath)
      if (!fs.existsSync(displaySrc)) continue

      const displayDest = path.resolve(mediaOutDir, asset.displayPath)
      if (!displayDest.startsWith(mediaRootPrefix)) {
        throw new Error(`导出路径越界: ${asset.displayPath}`)
      }
      fs.mkdirSync(path.dirname(displayDest), { recursive: true })
      fs.copyFileSync(displaySrc, displayDest)

      let thumbUrl = null
      if (asset.thumbPath) {
        const thumbSrc = resolveMediaPath(asset.thumbPath)
        if (fs.existsSync(thumbSrc)) {
          const thumbDest = path.resolve(mediaOutDir, asset.thumbPath)
          if (!thumbDest.startsWith(mediaRootPrefix)) {
            throw new Error(`导出路径越界: ${asset.thumbPath}`)
          }
          fs.mkdirSync(path.dirname(thumbDest), { recursive: true })
          fs.copyFileSync(thumbSrc, thumbDest)
          thumbUrl = `./local-snapshot/media/${asset.thumbPath.replace(/\\/g, '/')}`
        }
      }

      staticSignedUrls[id] = {
        displayUrl: `./local-snapshot/media/${asset.displayPath.replace(/\\/g, '/')}`,
        thumbUrl,
        expiresAt: Number.MAX_SAFE_INTEGER,
      }
    }

    const payload = {
      snapshot: true,
      exportedAt: nowIso(),
      projects: base.projects,
      notes: base.notes,
      profile: base.profile,
      siteSettings: base.siteSettings,
      signedUrls: staticSignedUrls,
    }
    fs.writeFileSync(path.join(outSnapshotDir, 'cottage.json'), JSON.stringify(payload, null, 2), 'utf8')
    return {
      projectCount: base.projects.length,
      noteCount: base.notes.length,
      assetCount: Object.keys(staticSignedUrls).length,
    }
  }

  async function seedNeutralSample({ force = false } = {}) {
    const db = readDb()
    const hasExisting =
      db.projects.length > 0 ||
      db.notes.length > 0 ||
      Boolean(db.profile?.draft?.displayName || db.profile?.draft?.bio || db.profile?.isPublished)
    if (hasExisting && !force) {
      return { skipped: true, reason: '已有本地内容，已跳过示例初始化。' }
    }

    const sharpMod = (await import('sharp')).default
    if (force) {
      fs.rmSync(mediaDir, { recursive: true, force: true })
    }
    const fresh = createEmptyStoreData()
    const ts = nowIso()

    const defs = [
      {
        id: '10000000-0000-4000-8000-000000000101',
        filename: 'starter-cover.webp',
        title: '我的第一件作品',
        subtitle: '在作品室中上传自己的截图、正文与演示视频',
        accent: '#365840',
        bgTop: '#f6f3e8',
        bgBottom: '#e9eadc',
      },
      {
        id: '10000000-0000-4000-8000-000000000102',
        filename: 'starter-study.webp',
        title: '创作过程手记',
        subtitle: '记录搭建过程、取舍思考与日常草图',
        accent: '#6b5b3e',
        bgTop: '#f7f4ec',
        bgBottom: '#ebe5d4',
      },
    ]

    for (const item of defs) {
      const svgBuf = Buffer.from(createSampleSvg(item.title, item.subtitle, item.accent, item.bgTop, item.bgBottom))
      const displayBuf = await sharpMod(svgBuf).resize(1280, 800).webp({ quality: 84 }).toBuffer()
      const thumbBuf = await sharpMod(svgBuf).resize(640, 400).webp({ quality: 80 }).toBuffer()
      const displayPath = `images/${item.id}/display.webp`
      const thumbPath = `images/${item.id}/thumb.webp`
      fs.mkdirSync(path.dirname(resolveMediaPath(displayPath)), { recursive: true })
      fs.writeFileSync(resolveMediaPath(displayPath), displayBuf)
      fs.writeFileSync(resolveMediaPath(thumbPath), thumbBuf)
      fresh.assets[item.id] = {
        id: item.id,
        kind: 'image',
        status: 'ready',
        displayPath,
        thumbPath,
        mimeType: 'image/webp',
        byteSize: displayBuf.length + thumbBuf.length,
        width: 1280,
        height: 800,
        durationSec: null,
        originalFilename: item.filename,
        createdAt: ts,
      }
    }

    const projectId = '20000000-0000-4000-8000-000000000101'
    const projectDraft = {
      title: '示例作品 · 我的本地小屋',
      summary: '这是一条本地可随时修改或删除的示例作品，用于演示作品室墙面展示与详情阅读。',
      body: '你好，欢迎来到这座专属于你的本地小屋。\n\n在右上角打开「小屋地图」，即可一键进入本地编辑模式：你可以修改小屋名称与迎客语、替换这张示例封面、上传自己的多张截图与 50 MB 以内的 MP4/WebM 演示视频，或直接删除示例重新开始。\n\n所有内容和图片视频默认保存在本机 `local-data/` 目录中，不需要连接任何外部账号；之后如果想放到网上给朋友浏览，只需运行 `npm run build:local` 即可生成纯静态站点。',
      demoUrl: '',
      coverAssetId: defs[0].id,
      galleryAssetIds: [defs[1].id],
      videoAssetId: null,
    }
    fresh.projects.push({
      id: projectId,
      slug: 'starter-cottage-example',
      sortOrder: 0,
      isPublished: true,
      publishedAt: ts,
      hasUnpublishedChanges: false,
      version: 1,
      updatedAt: ts,
      draft: projectDraft,
      published: { ...projectDraft, publishedAt: ts },
    })

    const note1Draft = {
      title: '如何把这座小屋变成你自己的',
      body: '1. 在顶部点击「小屋地图」，可以修改小屋名称、门前牌匾副标题以及小院欢迎语。\n\n2. 点击「进入本地编辑模式」后，走进「作品室」「创作手记」「关于我」，就能新增、保存草稿、预览、发布或撤回对应内容。\n\n3. 退出编辑视图即可切回访客视角，检查未发布草稿是否已正确隐藏。',
      projectId,
      imageAssetIds: [defs[1].id],
      videoAssetId: null,
    }
    fresh.notes.push({
      id: '30000000-0000-4000-8000-000000000101',
      slug: 'how-to-customize-your-cottage',
      sortOrder: 0,
      isPublished: true,
      publishedAt: ts,
      hasUnpublishedChanges: false,
      version: 1,
      updatedAt: ts,
      draft: note1Draft,
      published: { ...note1Draft, publishedAt: ts },
    })

    writeDb(fresh)
    return { skipped: false, projectCount: 1, noteCount: 1, assetCount: 2 }
  }

  return {
    dataDir,
    cottagePath,
    mediaDir,
    readDb,
    writeDb,
    buildPublicCottage,
    buildAdminCottage,
    signAssets,
    hasAsset,
    resolveAssetFile,
    writeUploadedMediaBlob,
    appendVideoChunk,
    abortVideoUpload,
    mutate,
    cleanupAssets: (candidateIds, sweepOrphans) => {
      const db = readDb()
      const res = cleanupAssetsInternal(db, candidateIds, sweepOrphans)
      writeDb(db)
      return res
    },
    exportStaticSnapshot,
    seedNeutralSample,
  }
}
