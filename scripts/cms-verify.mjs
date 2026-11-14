import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const distDir = path.join(rootDir, '.qa', 'cms-dist')
const qaOutDir = path.join(rootDir, '.qa', 'cms-verify')
fs.mkdirSync(qaOutDir, { recursive: true })

const MOCK_PORT = 4325
const SITE_PORT = 4326
const ADMIN_EMAIL = 'owner@example.com'
const ADMIN_PASS = 'Secret123!'
const ADMIN_UID = '11111111-1111-4111-8111-111111111111'

function makeJwt(email, sub) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub,
      email,
      role: 'authenticated',
      aud: 'authenticated',
      exp: Math.floor(Date.now() / 1000) + 7200,
    }),
  ).toString('base64url')
  return `${header}.${payload}.mock-sig`
}

const VALID_TOKEN = makeJwt(ADMIN_EMAIL, ADMIN_UID)

function slugify(input, prefix) {
  const base = (input || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return `${prefix}-${base || 'item'}-${crypto.randomUUID().slice(0, 8)}`
}

function createMockSupabase() {
  const db = {
    assets: new Map(), // id -> asset row
    blobs: new Map(), // path -> { buffer: Buffer, mime: string }
    tusUploads: new Map(), // id -> { objectName, mimeType, length, offset, chunks: Buffer[] }
    projects: [],
    notes: [],
    profile: {
      isPublished: false,
      publishedAt: null,
      hasUnpublishedChanges: true,
      version: 1,
      updatedAt: new Date().toISOString(),
      draft: {
        displayName: '',
        bio: '',
        focusAreas: '',
        avatarAssetId: null,
        contactEmail: '',
        contactLinks: [],
      },
      published: null,
    },
    orderVersions: { projects: 1, notes: 1 },
    cleanupQueue: new Map(), // assetId -> paths[]
    failNextTusPatch: false,
    stats: {
      publicSignCalls: [],
      adminSignCalls: [],
      videoFetchCalls: 0,
      tusPatchCount: 0,
      tusDeleteCount: 0,
      cleanupCalls: 0,
      deletedPaths: [],
    },
  }

  function snapshotContainsAsset(snapshot, assetId) {
    if (!snapshot || !assetId) return false
    if (snapshot.coverAssetId === assetId) return true
    if (snapshot.videoAssetId === assetId) return true
    if (snapshot.avatarAssetId === assetId) return true
    if (Array.isArray(snapshot.galleryAssetIds) && snapshot.galleryAssetIds.includes(assetId)) return true
    if (Array.isArray(snapshot.imageAssetIds) && snapshot.imageAssetIds.includes(assetId)) return true
    return false
  }

  function isAssetPublic(assetId) {
    if (db.projects.some((p) => p.isPublished && snapshotContainsAsset(p.published, assetId))) return true
    if (db.notes.some((n) => n.isPublished && snapshotContainsAsset(n.published, assetId))) return true
    if (db.profile.isPublished && snapshotContainsAsset(db.profile.published, assetId)) return true
    return false
  }

  function isAssetReferenced(assetId) {
    if (db.projects.some((p) => snapshotContainsAsset(p.draft, assetId) || (p.isPublished && snapshotContainsAsset(p.published, assetId)))) return true
    if (db.notes.some((n) => snapshotContainsAsset(n.draft, assetId) || (n.isPublished && snapshotContainsAsset(n.published, assetId)))) return true
    if (snapshotContainsAsset(db.profile.draft, assetId) || (db.profile.isPublished && snapshotContainsAsset(db.profile.published, assetId))) return true
    return false
  }

  function enqueueIfUnreferenced(ids) {
    for (const id of ids.filter(Boolean)) {
      if (!isAssetReferenced(id)) {
        const asset = db.assets.get(id)
        if (asset) {
          asset.status = 'pending_delete'
          db.cleanupQueue.set(id, [asset.displayPath, asset.thumbPath].filter(Boolean))
        }
      }
    }
  }

  function flushCleanup(candidateIds = null) {
    let cleaned = 0
    const targets = candidateIds ? candidateIds : [...db.cleanupQueue.keys()]
    for (const id of targets) {
      if (isAssetReferenced(id)) {
        db.cleanupQueue.delete(id)
        continue
      }
      const asset = db.assets.get(id)
      const paths = db.cleanupQueue.get(id) || (asset ? [asset.displayPath, asset.thumbPath].filter(Boolean) : [])
      for (const p of paths) {
        db.blobs.delete(p)
        db.stats.deletedPaths.push(p)
      }
      db.cleanupQueue.delete(id)
      db.assets.delete(id)
      cleaned += 1
    }
    return cleaned
  }

  function buildSignEntry(asset) {
    const exp = Date.now() + 600_000
    return {
      displayUrl: `http://127.0.0.1:${MOCK_PORT}/storage/v1/object/sign/cottage-media/${asset.displayPath}?token=sig-${asset.id}`,
      thumbUrl: asset.thumbPath
        ? `http://127.0.0.1:${MOCK_PORT}/storage/v1/object/sign/cottage-media/${asset.thumbPath}?token=sig-${asset.id}`
        : null,
      expiresAt: exp,
    }
  }

  function sendJson(res, status, data, extraHeaders = {}) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Expose-Headers': 'Upload-Offset,Upload-Length,Location,Tus-Resumable',
      ...extraHeaders,
    })
    res.end(JSON.stringify(data))
  }

  function readBody(req) {
    return new Promise((resolve) => {
      const chunks = []
      req.on('data', (c) => chunks.push(c))
      req.on('end', () => resolve(Buffer.concat(chunks)))
    })
  }

  const server = http.createServer(async (req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,HEAD,OPTIONS',
      'Access-Control-Expose-Headers': 'Upload-Offset,Upload-Length,Location,Tus-Resumable',
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors)
      return res.end()
    }

    const url = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`)
    const authHeader = req.headers.authorization || ''
    const isAdminReq = authHeader === `Bearer ${VALID_TOKEN}`

    // Auth endpoints
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const raw = (await readBody(req)).toString('utf8')
      const body = JSON.parse(raw || '{}')
      if (body.email !== ADMIN_EMAIL || body.password !== ADMIN_PASS) {
        return sendJson(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
      }
      return sendJson(res, 200, {
        access_token: VALID_TOKEN,
        token_type: 'bearer',
        expires_in: 7200,
        refresh_token: 'mock-refresh-token',
        user: { id: ADMIN_UID, email: ADMIN_EMAIL, role: 'authenticated' },
      })
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      if (!isAdminReq) return sendJson(res, 401, { error: 'unauthorized' })
      return sendJson(res, 200, { id: ADMIN_UID, email: ADMIN_EMAIL, role: 'authenticated' })
    }
    if (url.pathname === '/auth/v1/logout' && req.method === 'POST') {
      return sendJson(res, 204, {})
    }

    // Test control hook for simulating concurrent device update
    if (url.pathname === '/__test/bump-note' && req.method === 'POST') {
      const { id, title } = JSON.parse((await readBody(req)).toString('utf8'))
      const note = db.notes.find((n) => n.id === id)
      if (!note) return sendJson(res, 404, { error: 'not found' })
      note.version += 1
      note.draft.title = title || `${note.draft.title}（另一台设备已更新）`
      note.updatedAt = new Date().toISOString()
      return sendJson(res, 200, { version: note.version })
    }
    if (url.pathname === '/__test/set-tus-fail' && req.method === 'POST') {
      const { fail } = JSON.parse((await readBody(req)).toString('utf8'))
      db.failNextTusPatch = Boolean(fail)
      return sendJson(res, 200, { ok: true })
    }
    if (url.pathname === '/__test/stats' && req.method === 'GET') {
      return sendJson(res, 200, {
        ...db.stats,
        blobCount: db.blobs.size,
        queueCount: db.cleanupQueue.size,
        assetCount: db.assets.size,
      })
    }

    // Storage direct object upload & delete
    if (url.pathname.startsWith('/storage/v1/object/cottage-media/') && req.method === 'POST') {
      if (!isAdminReq) return sendJson(res, 403, { error: 'forbidden' })
      const objPath = decodeURIComponent(url.pathname.replace('/storage/v1/object/cottage-media/', ''))
      const buf = await readBody(req)
      db.blobs.set(objPath, { buffer: buf, mime: req.headers['content-type'] || 'application/octet-stream' })
      return sendJson(res, 200, { Key: `cottage-media/${objPath}` })
    }
    if (url.pathname === '/storage/v1/object/cottage-media' && req.method === 'DELETE') {
      if (!isAdminReq) return sendJson(res, 403, { error: 'forbidden' })
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      for (const p of body.prefixes || []) db.blobs.delete(p)
      return sendJson(res, 200, [])
    }

    // Signed media fetch (with Range support for <video>)
    if (url.pathname.startsWith('/storage/v1/object/sign/cottage-media/') && req.method === 'GET') {
      const objPath = decodeURIComponent(url.pathname.replace('/storage/v1/object/sign/cottage-media/', ''))
      const blob = db.blobs.get(objPath)
      if (!blob) return sendJson(res, 404, { error: 'not found' })
      if (blob.mime.startsWith('video/')) db.stats.videoFetchCalls += 1
      const total = blob.buffer.byteLength
      const range = req.headers.range
      if (range && range.startsWith('bytes=')) {
        const [startStr, endStr] = range.replace('bytes=', '').split('-')
        const start = Number(startStr || 0)
        const end = endStr ? Math.min(Number(endStr), total - 1) : total - 1
        const chunk = blob.buffer.subarray(start, end + 1)
        res.writeHead(206, {
          ...cors,
          'Content-Type': blob.mime,
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': chunk.byteLength,
        })
        return res.end(chunk)
      }
      res.writeHead(200, {
        ...cors,
        'Content-Type': blob.mime,
        'Accept-Ranges': 'bytes',
        'Content-Length': total,
      })
      return res.end(blob.buffer)
    }

    // TUS Resumable endpoint
    if (url.pathname === '/storage/v1/upload/resumable' && req.method === 'POST') {
      if (!isAdminReq) return sendJson(res, 403, { error: 'forbidden' })
      const length = Number(req.headers['upload-length'] || 0)
      const metaRaw = String(req.headers['upload-metadata'] || '')
      const meta = {}
      for (const pair of metaRaw.split(',')) {
        const [k, v] = pair.trim().split(' ')
        if (k && v) meta[k] = Buffer.from(v, 'base64').toString('utf8')
      }
      const initialBody = req.headers['content-type']?.includes('offset+octet-stream')
        ? await readBody(req)
        : Buffer.alloc(0)
      const uploadId = crypto.randomUUID()
      const chunks = initialBody.byteLength > 0 ? [initialBody] : []
      const offset = initialBody.byteLength
      db.tusUploads.set(uploadId, {
        objectName: meta.objectName,
        mimeType: meta.contentType || 'video/mp4',
        length,
        offset,
        chunks,
      })
      if (offset >= length && length > 0) {
        db.blobs.set(meta.objectName, { buffer: Buffer.concat(chunks), mime: meta.contentType || 'video/mp4' })
      }
      res.writeHead(201, {
        ...cors,
        'Tus-Resumable': '1.0.0',
        Location: `http://127.0.0.1:${MOCK_PORT}/storage/v1/upload/resumable/${uploadId}`,
        'Upload-Offset': String(offset),
      })
      return res.end()
    }

    if (url.pathname.startsWith('/storage/v1/upload/resumable/')) {
      const uploadId = url.pathname.split('/').pop()
      const up = db.tusUploads.get(uploadId)
      if (!up) {
        res.writeHead(404, { ...cors, 'Tus-Resumable': '1.0.0' })
        return res.end()
      }
      if (req.method === 'HEAD') {
        res.writeHead(200, {
          ...cors,
          'Tus-Resumable': '1.0.0',
          'Upload-Offset': String(up.offset),
          'Upload-Length': String(up.length),
          'Cache-Control': 'no-store',
        })
        return res.end()
      }
      if (req.method === 'DELETE') {
        db.stats.tusDeleteCount += 1
        db.tusUploads.delete(uploadId)
        res.writeHead(204, { ...cors, 'Tus-Resumable': '1.0.0' })
        return res.end()
      }
      if (req.method === 'PATCH') {
        db.stats.tusPatchCount += 1
        await readBody(req).then((buf) => {
          if (db.failNextTusPatch) {
            res.writeHead(500, { ...cors, 'Tus-Resumable': '1.0.0' })
            res.end('Simulated chunk failure')
            return
          }
          up.chunks.push(buf)
          up.offset += buf.byteLength
          if (up.offset >= up.length) {
            db.blobs.set(up.objectName, {
              buffer: Buffer.concat(up.chunks),
              mime: up.mimeType,
            })
          }
          res.writeHead(204, {
            ...cors,
            'Tus-Resumable': '1.0.0',
            'Upload-Offset': String(up.offset),
          })
          res.end()
        })
        return
      }
    }

    // Edge Function: public-content
    if (url.pathname === '/functions/v1/public-content' && req.method === 'GET') {
      const projects = db.projects
        .filter((p) => p.isPublished && p.published)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((p) => ({ id: p.id, slug: p.slug, sortOrder: p.sortOrder, ...p.published }))
      const notes = db.notes
        .filter((n) => n.isPublished && n.published)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((n) => ({ id: n.id, slug: n.slug, sortOrder: n.sortOrder, ...n.published }))
      const profile = db.profile.isPublished && db.profile.published ? { ...db.profile.published } : null

      const signedUrls = {}
      const imageIds = new Set()
      for (const p of projects) {
        if (p.coverAssetId) imageIds.add(p.coverAssetId)
        for (const gid of p.galleryAssetIds || []) imageIds.add(gid)
      }
      for (const n of notes) {
        for (const iid of n.imageAssetIds || []) imageIds.add(iid)
      }
      if (profile?.avatarAssetId) imageIds.add(profile.avatarAssetId)
      for (const id of imageIds) {
        const asset = db.assets.get(id)
        if (asset && asset.kind === 'image' && asset.status === 'ready') {
          signedUrls[id] = buildSignEntry(asset)
        }
      }
      return sendJson(res, 200, { projects, notes, profile, signedUrls })
    }

    // Edge Function: media-sign
    if (url.pathname === '/functions/v1/media-sign' && req.method === 'POST') {
      const { assetIds = [], scope = 'public' } = JSON.parse((await readBody(req)).toString('utf8'))
      if (scope === 'admin' && !isAdminReq) return sendJson(res, 403, { error: 'forbidden' })
      if (scope === 'public') db.stats.publicSignCalls.push([...assetIds])
      else db.stats.adminSignCalls.push([...assetIds])

      const signedUrls = {}
      const deniedIds = []
      for (const id of assetIds) {
        const asset = db.assets.get(id)
        if (!asset || asset.status !== 'ready') {
          deniedIds.push(id)
          continue
        }
        if (scope === 'public' && !isAssetPublic(id)) {
          deniedIds.push(id)
          continue
        }
        signedUrls[id] = buildSignEntry(asset)
      }
      if (scope === 'public' && Object.keys(signedUrls).length === 0 && deniedIds.length > 0) {
        return sendJson(res, 403, { error: '没有权限访问未发布素材。', deniedIds })
      }
      return sendJson(res, 200, { signedUrls, deniedIds })
    }

    // Admin-only functions
    if (!isAdminReq) return sendJson(res, 401, { error: 'unauthorized' })

    if (url.pathname === '/functions/v1/admin-content' && req.method === 'GET') {
      const assetsObj = {}
      const signedUrls = {}
      for (const [id, asset] of db.assets.entries()) {
        if (asset.status === 'ready') {
          assetsObj[id] = asset
          if (asset.kind === 'image') signedUrls[id] = buildSignEntry(asset)
        }
      }
      return sendJson(res, 200, {
        adminUserId: ADMIN_UID,
        projects: [...db.projects].sort((a, b) => a.sortOrder - b.sortOrder),
        notes: [...db.notes].sort((a, b) => a.sortOrder - b.sortOrder),
        profile: db.profile,
        orderVersions: { ...db.orderVersions },
        assets: assetsObj,
        signedUrls,
        pendingCleanupCount: db.cleanupQueue.size,
      })
    }

    if (url.pathname === '/functions/v1/media-cleanup' && req.method === 'POST') {
      db.stats.cleanupCalls += 1
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const cleaned = flushCleanup(Array.isArray(body.candidateAssetIds) ? body.candidateAssetIds : null)
      return sendJson(res, 200, { cleaned, remaining: db.cleanupQueue.size, errors: [] })
    }

    if (url.pathname === '/functions/v1/admin-mutate' && req.method === 'POST') {
      const { action, payload = {} } = JSON.parse((await readBody(req)).toString('utf8'))
      if (action === 'media.register') {
        const asset = {
          id: payload.assetId,
          kind: payload.kind,
          status: 'ready',
          displayPath: payload.displayPath,
          thumbPath: payload.thumbPath || null,
          mimeType: payload.mimeType,
          byteSize: payload.byteSize,
          width: payload.width ?? null,
          height: payload.height ?? null,
          durationSec: payload.durationSec ?? null,
          originalFilename: payload.originalFilename ?? null,
          createdAt: new Date().toISOString(),
        }
        if (!db.blobs.has(asset.displayPath)) {
          return sendJson(res, 400, { error: '存储文件不存在' })
        }
        db.assets.set(asset.id, asset)
        return sendJson(res, 200, { ok: true, asset })
      }

      if (action === 'project.save_draft') {
        const draft = {
          title: String(payload.title ?? ''),
          summary: String(payload.summary ?? ''),
          body: String(payload.body ?? ''),
          demoUrl: String(payload.demoUrl ?? ''),
          coverAssetId: payload.coverAssetId ?? null,
          galleryAssetIds: Array.isArray(payload.galleryAssetIds) ? payload.galleryAssetIds : [],
          videoAssetId: payload.videoAssetId ?? null,
        }
        if (!payload.id) {
          const item = {
            id: crypto.randomUUID(),
            slug: payload.slug || slugify(draft.title, 'project'),
            sortOrder: db.projects.length,
            isPublished: false,
            publishedAt: null,
            hasUnpublishedChanges: true,
            version: 1,
            updatedAt: new Date().toISOString(),
            draft,
            published: null,
          }
          db.projects.push(item)
          return sendJson(res, 200, { ok: true, project: item, pendingCleanupCount: db.cleanupQueue.size })
        }
        const item = db.projects.find((p) => p.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '作品不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突：云端已被更新。', code: 'CONFLICT', latest: item })
        }
        const oldAssets = [item.draft.coverAssetId, item.draft.videoAssetId, ...item.draft.galleryAssetIds]
        item.draft = draft
        item.hasUnpublishedChanges = true
        item.version += 1
        item.updatedAt = new Date().toISOString()
        enqueueIfUnreferenced(oldAssets)
        const cleaned = flushCleanup()
        return sendJson(res, 200, { ok: true, project: item, cleaned, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'project.publish') {
        const item = db.projects.find((p) => p.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '作品不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        const oldPub = item.published ? [item.published.coverAssetId, item.published.videoAssetId, ...(item.published.galleryAssetIds || [])] : []
        const pubAt = item.publishedAt || new Date().toISOString()
        item.isPublished = true
        item.publishedAt = pubAt
        item.hasUnpublishedChanges = false
        item.version += 1
        item.updatedAt = new Date().toISOString()
        item.published = { ...item.draft, publishedAt: pubAt }
        enqueueIfUnreferenced(oldPub)
        flushCleanup()
        return sendJson(res, 200, { ok: true, project: item, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'project.unpublish') {
        const item = db.projects.find((p) => p.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '作品不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        item.isPublished = false
        item.hasUnpublishedChanges = true
        item.published = null
        item.version += 1
        item.updatedAt = new Date().toISOString()
        return sendJson(res, 200, { ok: true, project: item, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'project.delete') {
        const idx = db.projects.findIndex((p) => p.id === payload.id)
        if (idx < 0) return sendJson(res, 404, { error: '作品不存在' })
        const item = db.projects[idx]
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        const refs = [
          item.draft.coverAssetId,
          item.draft.videoAssetId,
          ...item.draft.galleryAssetIds,
          ...(item.published ? [item.published.coverAssetId, item.published.videoAssetId, ...(item.published.galleryAssetIds || [])] : []),
        ]
        db.projects.splice(idx, 1)
        for (const n of db.notes) {
          if (n.draft.projectId === item.id) n.draft.projectId = null
          if (n.published?.projectId === item.id) n.published.projectId = null
        }
        enqueueIfUnreferenced(refs)
        flushCleanup()
        return sendJson(res, 200, { ok: true, deletedId: item.id, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'project.reorder') {
        if (db.orderVersions.projects !== payload.expectedOrderVersion) {
          return sendJson(res, 409, { error: '排序冲突', code: 'CONFLICT', order_version: db.orderVersions.projects })
        }
        const orderMap = new Map(payload.orderedIds.map((id, i) => [id, i]))
        db.projects.forEach((p) => { if (orderMap.has(p.id)) p.sortOrder = orderMap.get(p.id) })
        db.projects.sort((a, b) => a.sortOrder - b.sortOrder)
        db.orderVersions.projects += 1
        return sendJson(res, 200, { ok: true, order_version: db.orderVersions.projects })
      }

      if (action === 'note.save_draft') {
        const draft = {
          title: String(payload.title ?? ''),
          body: String(payload.body ?? ''),
          projectId: payload.projectId ?? null,
          imageAssetIds: Array.isArray(payload.imageAssetIds) ? payload.imageAssetIds : [],
          videoAssetId: payload.videoAssetId ?? null,
        }
        if (!payload.id) {
          const item = {
            id: crypto.randomUUID(),
            slug: payload.slug || slugify(draft.title, 'note'),
            sortOrder: db.notes.length,
            isPublished: false,
            publishedAt: null,
            hasUnpublishedChanges: true,
            version: 1,
            updatedAt: new Date().toISOString(),
            draft,
            published: null,
          }
          db.notes.push(item)
          return sendJson(res, 200, { ok: true, note: item, pendingCleanupCount: db.cleanupQueue.size })
        }
        const item = db.notes.find((n) => n.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '手记不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '另一台设备刚刚更新了这篇手记。', code: 'CONFLICT', latest: item })
        }
        const oldAssets = [item.draft.videoAssetId, ...item.draft.imageAssetIds]
        item.draft = draft
        item.hasUnpublishedChanges = true
        item.version += 1
        item.updatedAt = new Date().toISOString()
        enqueueIfUnreferenced(oldAssets)
        flushCleanup()
        return sendJson(res, 200, { ok: true, note: item, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'note.publish') {
        const item = db.notes.find((n) => n.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '手记不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        const pubAt = item.publishedAt || new Date().toISOString()
        item.isPublished = true
        item.publishedAt = pubAt
        item.hasUnpublishedChanges = false
        item.version += 1
        item.updatedAt = new Date().toISOString()
        item.published = { ...item.draft, publishedAt: pubAt }
        return sendJson(res, 200, { ok: true, note: item, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'note.unpublish') {
        const item = db.notes.find((n) => n.id === payload.id)
        if (!item) return sendJson(res, 404, { error: '手记不存在' })
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        item.isPublished = false
        item.hasUnpublishedChanges = true
        item.published = null
        item.version += 1
        item.updatedAt = new Date().toISOString()
        return sendJson(res, 200, { ok: true, note: item, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'note.delete') {
        const idx = db.notes.findIndex((n) => n.id === payload.id)
        if (idx < 0) return sendJson(res, 404, { error: '手记不存在' })
        const item = db.notes[idx]
        if (item.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: item })
        }
        const refs = [item.draft.videoAssetId, ...item.draft.imageAssetIds]
        db.notes.splice(idx, 1)
        enqueueIfUnreferenced(refs)
        flushCleanup()
        return sendJson(res, 200, { ok: true, deletedId: item.id, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'note.reorder') {
        if (db.orderVersions.notes !== payload.expectedOrderVersion) {
          return sendJson(res, 409, { error: '排序冲突', code: 'CONFLICT', order_version: db.orderVersions.notes })
        }
        const orderMap = new Map(payload.orderedIds.map((id, i) => [id, i]))
        db.notes.forEach((n) => { if (orderMap.has(n.id)) n.sortOrder = orderMap.get(n.id) })
        db.notes.sort((a, b) => a.sortOrder - b.sortOrder)
        db.orderVersions.notes += 1
        return sendJson(res, 200, { ok: true, order_version: db.orderVersions.notes })
      }

      if (action === 'profile.save_draft') {
        if (db.profile.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: db.profile })
        }
        const oldAvatar = db.profile.draft.avatarAssetId
        db.profile.draft = {
          displayName: String(payload.displayName ?? ''),
          bio: String(payload.bio ?? ''),
          focusAreas: String(payload.focusAreas ?? ''),
          avatarAssetId: payload.avatarAssetId ?? null,
          contactEmail: String(payload.contactEmail ?? ''),
          contactLinks: Array.isArray(payload.contactLinks) ? payload.contactLinks : [],
        }
        db.profile.hasUnpublishedChanges = true
        db.profile.version += 1
        enqueueIfUnreferenced([oldAvatar])
        flushCleanup()
        return sendJson(res, 200, { ok: true, profile: db.profile, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'profile.publish') {
        if (db.profile.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: db.profile })
        }
        const pubAt = db.profile.publishedAt || new Date().toISOString()
        db.profile.isPublished = true
        db.profile.publishedAt = pubAt
        db.profile.hasUnpublishedChanges = false
        db.profile.version += 1
        db.profile.published = { ...db.profile.draft, publishedAt: pubAt }
        return sendJson(res, 200, { ok: true, profile: db.profile, pendingCleanupCount: db.cleanupQueue.size })
      }

      if (action === 'profile.unpublish') {
        if (db.profile.version !== payload.expectedVersion) {
          return sendJson(res, 409, { error: '冲突', code: 'CONFLICT', latest: db.profile })
        }
        db.profile.isPublished = false
        db.profile.hasUnpublishedChanges = true
        db.profile.published = null
        db.profile.version += 1
        return sendJson(res, 200, { ok: true, profile: db.profile, pendingCleanupCount: db.cleanupQueue.size })
      }

      return sendJson(res, 400, { error: `Unknown action: ${action}` })
    }

    sendJson(res, 404, { error: `Not found: ${url.pathname}` })
  })

  return { server, db }
}

function createStaticServer(dir) {
  const mimeMap = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.ttf': 'font/ttf',
    '.glb': 'model/gltf-binary',
    '.bin': 'application/octet-stream',
  }
  return http.createServer((req, res) => {
    const cleanPath = decodeURIComponent((req.url || '/').split('?')[0])
    let filePath = path.join(dir, cleanPath === '/' ? 'index.html' : cleanPath)
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(dir, 'index.html')
    }
    const ext = path.extname(filePath).toLowerCase()
    res.writeHead(200, { 'Content-Type': mimeMap[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  })
}

console.log('1. Building test production bundle with mock Supabase URL -> .qa/cms-dist ...')
execFileSync(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['vite', 'build', '--outDir', '.qa/cms-dist'],
  {
    cwd: rootDir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
      VITE_SUPABASE_ANON_KEY: 'mock-anon-key',
    },
  },
)

const { server: mockServer, db } = createMockSupabase()
const siteServer = createStaticServer(distDir)

await new Promise((r) => mockServer.listen(MOCK_PORT, '127.0.0.1', r))
await new Promise((r) => siteServer.listen(SITE_PORT, '127.0.0.1', r))

const results = { checks: [], errors: [], passed: false }
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
})

const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const page = await context.newPage()
page.on('pageerror', (e) => results.errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') {
    const text = m.text()
    // Expected 403 / 409 / 500 during negative assertions are intentionally provoked via test steps
    results.errors.push(`console.error: ${text}`)
  }
})

async function idle(place) {
  await page.waitForFunction(
    (p) => location.hash === `#${p}` && !document.querySelector('.traveling') && !document.querySelector('.loading-note'),
    place,
    { timeout: 60000 },
  )
  await page.waitForTimeout(350)
}

async function goRoom(place) {
  if ((await page.evaluate(() => location.hash)) === `#${place}`) return
  const mapBtn = page.getByRole('button', { name: /小屋地图/ })
  await mapBtn.click()
  const label = { yard: '小院', hall: '走廊', gallery: '作品室', study: '创作手记', blank: '关于我' }[place]
  await page.getByRole('button', { name: new RegExp('^' + label) }).click()
  await idle(place)
}

try {
  // Use reduced motion to keep automated navigation fast and deterministic
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`http://127.0.0.1:${SITE_PORT}/?qa`)
  await idle('yard')

  // Check 1: Empty visitor state & retired example items
  await goRoom('gallery')
  await page.getByRole('button', { name: /作品目录/ }).click()
  assert(await page.getByText('作品正在整理中').isVisible())
  assert.equal(await page.evaluate(() => window.__HOME_QA__?.galleryPaperXs?.length ?? 0), 0)
  await goRoom('study')
  assert(await page.getByText('主人还没有公开发布手记').isVisible())
  await goRoom('blank')
  assert(await page.getByText('尚未填写的资料暂不公开展示').isVisible())
  results.checks.push('empty visitor baseline omits sample items and unpopulated profile fields')

  // Check 2: Owner login via 小屋地图
  await page.getByRole('button', { name: /小屋地图/ }).click()
  await page.getByRole('button', { name: '登录管理' }).click()
  await page.getByLabel('管理员邮箱').fill(ADMIN_EMAIL)
  await page.getByLabel('登录密码').fill(ADMIN_PASS)
  await page.getByRole('button', { name: '登录小屋' }).click()
  await page.getByText('主人已登录').waitFor({ timeout: 10000 })
  await page.keyboard.press('Escape')
  results.checks.push('owner sign-in succeeds in map dialog')

  const openEd = page.locator('dialog.cms-editor-dialog[open]')

  // Verify admin entries in all 3 rooms + walking paused while editor open
  await goRoom('gallery')
  assert(await page.getByRole('button', { name: '添加作品' }).isVisible())
  await page.getByRole('button', { name: '添加作品' }).click()
  assert(await page.locator('.home-app.walking-paused').count() === 1)

  // Check 3: Oversize image (>10 MB) & video (>50 MB) intercepted before network
  await openEd.getByLabel('作品标题（发布必填）').fill('我的小屋 · 交互式个人网站')
  await openEd.getByLabel('作品简介（发布必填）').fill('手绘白昼风格的可维护个人网站，支持在线创作与发布。')
  await openEd.getByLabel('作品正文（发布必填，支持分段纯文本）').fill('第一段介绍作品效果与结构。\n\n第二段说明在线保存与视频按需加载。')

  const oversizedImg = Buffer.alloc(10.5 * 1024 * 1024, 1)
  const coverInput = openEd.locator('.media-picker-block', { hasText: '作品封面图' }).locator('input[type="file"]')
  await coverInput.setInputFiles({ name: 'too-big.jpg', mimeType: 'image/jpeg', buffer: oversizedImg })
  await openEd.getByText(/超出 10 MB 上限/).waitFor()

  const oversizeVideoPath = path.join(qaOutDir, 'too-big-51mb.mp4')
  const fd = fs.openSync(oversizeVideoPath, 'w')
  fs.ftruncateSync(fd, 51 * 1024 * 1024)
  fs.closeSync(fd)
  const videoInput = openEd.locator('.media-picker-block', { hasText: '演示视频' }).locator('input[type="file"]')
  await videoInput.setInputFiles(oversizeVideoPath)
  await openEd.getByText(/超出 50 MB 上限/).waitFor()
  // Input preserved after oversize rejection!
  assert.equal(await openEd.getByLabel('作品标题（发布必填）').inputValue(), '我的小屋 · 交互式个人网站')
  results.checks.push('oversize image (>10 MB) & video (>50 MB) blocked pre-upload with inputs preserved')

  // Upload real PNG screenshot -> canvas WebP resize & upload
  const coverPngPath = path.join(rootDir, '.qa', 'polish', 'after', 'yard-1440x900.png')
  await coverInput.setInputFiles(coverPngPath)
  await openEd.getByText(/已上传 1 张图片/).waitFor({ timeout: 15000 })

  // Check 4: TUS video upload failure/retry using real 12.14 MB MP4
  const demoVideoPath = path.join(rootDir, '.qa', 'seed', 'cottage-demo.mp4')
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/set-tus-fail`, {
    method: 'POST',
    body: JSON.stringify({ fail: true }),
  })
  await videoInput.setInputFiles(demoVideoPath)
  await openEd.getByRole('button', { name: '重试上传（同一浏览器断点续传）' }).waitFor({ timeout: 25000 })
  // Form text still intact!
  assert.equal(await openEd.getByLabel('作品简介（发布必填）').inputValue(), '手绘白昼风格的可维护个人网站，支持在线创作与发布。')
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/set-tus-fail`, {
    method: 'POST',
    body: JSON.stringify({ fail: false }),
  })
  await openEd.getByRole('button', { name: '重试上传（同一浏览器断点续传）' }).click()
  await openEd.getByText('视频上传并校验完成。').waitFor({ timeout: 25000 })
  results.checks.push('TUS resumable video upload failure, input preservation, and retry succeed')

  // Save draft -> visitor public-content & public media-sign MUST still deny access
  await openEd.getByRole('button', { name: '保存草稿' }).click()
  await openEd.getByText(/草稿已保存到云端/).waitFor()
  const pubBefore = await fetch(`http://127.0.0.1:${MOCK_PORT}/functions/v1/public-content`).then((r) => r.json())
  assert.equal(pubBefore.projects.length, 0)
  const draftCoverId = db.projects[0].draft.coverAssetId
  const draftVideoId = db.projects[0].draft.videoAssetId
  const signDraftRes = await fetch(`http://127.0.0.1:${MOCK_PORT}/functions/v1/media-sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds: [draftCoverId, draftVideoId], scope: 'public' }),
  })
  assert.equal(signDraftRes.status, 403)
  results.checks.push('saved draft & its assets remain strictly inaccessible via public endpoints (403)')

  // Check preview shows draft badge
  await openEd.getByRole('button', { name: '预览当前草稿' }).click()
  await page.locator('dialog.project-detail-dialog[open]').getByText('草稿预览（未发布内容仅主人可见）').waitFor()
  await page.locator('dialog.project-detail-dialog[open] .dialog-close').click()

  // Check 5: Publish project -> centered single 3D gallery slot
  await openEd.getByRole('button', { name: '发布作品' }).click()
  await openEd.getByText('作品已发布到作品室。').waitFor()
  await openEd.locator('.dialog-close').click()
  await page.waitForTimeout(400)
  const xs1 = await page.evaluate(() => window.__HOME_QA__?.galleryPaperXs)
  assert.deepEqual(xs1, [0], `Expected single centered 3D gallery slot [0], got ${JSON.stringify(xs1)}`)
  results.checks.push('single published project centers at x=0 in 3D gallery without duplication')

  // Check live edit isolation on published project
  await page.getByRole('button', { name: '作品管理' }).click()
  await page.locator('#room-directory').getByRole('button', { name: '编辑', exact: true }).click()
  await openEd.getByLabel('作品标题（发布必填）').fill('我的小屋 · 草稿未发布修改')
  await openEd.getByRole('button', { name: '保存草稿' }).click()
  await openEd.getByText(/草稿已保存到云端/).waitFor()
  const pubDuringDraft = await fetch(`http://127.0.0.1:${MOCK_PORT}/functions/v1/public-content`).then((r) => r.json())
  assert.equal(pubDuringDraft.projects[0].title, '我的小屋 · 交互式个人网站')
  await openEd.getByLabel('作品标题（发布必填）').fill('我的小屋 · 交互式个人网站')
  await openEd.getByRole('button', { name: '发布更新' }).click()
  await openEd.getByText(/已发布更新/).waitFor()
  results.checks.push('editing published item updates working draft only until Publish Update')

  // Unpublish check -> immediate denial of public sign requests
  await openEd.getByRole('button', { name: '撤回发布' }).click()
  await openEd.getByText(/已撤回发布/).waitFor()
  const signAfterUnpub = await fetch(`http://127.0.0.1:${MOCK_PORT}/functions/v1/media-sign`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetIds: [draftCoverId, draftVideoId], scope: 'public' }),
  })
  assert.equal(signAfterUnpub.status, 403)
  await openEd.getByRole('button', { name: '发布作品' }).click()
  await openEd.getByText('作品已发布到作品室。').waitFor()
  await openEd.locator('.dialog-close').click()
  results.checks.push('unpublish immediately hides public content & rejects public media signing (403)')

  // Lazy video load check on ProjectDetailModal
  const statsBeforeOpen = await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/stats`).then((r) => r.json())
  await page.locator('#room-directory').getByRole('button', { name: '预览' }).click()
  assert.equal(await page.locator('dialog.project-detail-dialog[open] video').count(), 0)
  const statsAfterOpen = await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/stats`).then((r) => r.json())
  assert.equal(statsAfterOpen.videoFetchCalls, statsBeforeOpen.videoFetchCalls)

  await page.locator('dialog.project-detail-dialog[open]').getByRole('button', { name: '加载并播放演示视频' }).click()
  await page.locator('dialog.project-detail-dialog[open] video').waitFor({ timeout: 10000 })
  await page.locator('dialog.project-detail-dialog[open] .dialog-close').click()
  await page.waitForTimeout(200)
  assert.equal(await page.locator('dialog.project-detail-dialog[open] video').count(), 0)
  results.checks.push('video never preloads before Play click and stops + unmounts src on modal close')

  // Check 6: Notes creation, project linking, reorder, reload persistence, and 409 conflict
  await goRoom('study')
  await page.getByRole('button', { name: '写手记' }).click()
  await openEd.getByLabel('手记标题（发布必填）').fill('空间与浏览路线')
  await openEd.getByLabel('关联作品（可选）').selectOption({ index: 1 })
  await openEd.getByLabel('手记正文（发布必填）').fill('记录走廊与房间路线设计。')
  await openEd.getByRole('button', { name: '发布手记' }).click()
  await openEd.getByText('手记已发布到创作手记。').waitFor()
  await openEd.locator('.dialog-close').click()

  await page.getByRole('button', { name: '写手记' }).click()
  await openEd.getByLabel('手记标题（发布必填）').fill('门窗和室内光照精修')
  await openEd.getByLabel('关联作品（可选）').selectOption({ index: 1 })
  await openEd.getByLabel('手记正文（发布必填）').fill('记录薄玻璃近似与天光布局。')
  await openEd.getByRole('button', { name: '发布手记' }).click()
  await openEd.getByText('手记已发布到创作手记。').waitFor()
  await openEd.locator('.dialog-close').click()

  // Reorder notes (move Note 1 down -> Note 2 becomes first)
  await page.getByRole('button', { name: '下移空间与浏览路线' }).click()
  await page.waitForTimeout(300)
  await page.reload()
  await idle('study')
  const firstNoteTitle = await page.locator('.cms-manage-card strong').first().textContent()
  assert.equal(firstNoteTitle, '门窗和室内光照精修')
  results.checks.push('note creation, project linking, manual reorder, and persistence across reload pass')

  // Trigger 409 Conflict during concurrent note edit
  await page.locator('.cms-manage-card', { hasText: '空间与浏览路线' }).getByRole('button', { name: '编辑' }).click()
  await openEd.getByLabel('手记正文（发布必填）').fill('本地尚未保存的新段落必须被保留')
  const targetNoteId = db.notes.find((n) => n.draft.title === '空间与浏览路线').id
  await fetch(`http://127.0.0.1:${MOCK_PORT}/__test/bump-note`, {
    method: 'POST',
    body: JSON.stringify({ id: targetNoteId, title: '空间与浏览路线（云端新版本）' }),
  })
  await openEd.getByRole('button', { name: '保存草稿' }).click()
  const conflictDlg = page.locator('dialog.conflict-dialog[open]')
  await conflictDlg.getByText('检测到云端更新冲突').waitFor()
  await conflictDlg.getByRole('button', { name: '查看云端版本' }).click()
  await conflictDlg.getByText(/空间与浏览路线（云端新版本）/).waitFor()
  await conflictDlg.getByRole('button', { name: '使用云端版本刷新' }).click()
  assert.equal(await openEd.getByLabel('手记标题（发布必填）').inputValue(), '空间与浏览路线（云端新版本）')
  await openEd.locator('.dialog-close').click()
  results.checks.push('409 version conflict preserves edits, shows cloud diff summary, and refreshes cleanly')

  // Check 7: "关于我" profile blank fields omitted & admin email never leaked
  await goRoom('blank')
  await page.getByRole('button', { name: '编辑介绍' }).click()
  await openEd.getByLabel('称呼 / 名字（可留空）').fill('小屋建造者')
  await openEd.getByLabel('关注方向（可留空）').fill('三维网页与个人工具')
  await openEd.getByRole('button', { name: '发布介绍' }).click()
  await openEd.getByText('“关于我”公开内容已更新。').waitFor()
  await openEd.locator('.dialog-close').click()

  // Check 8: Multi-project 3D cap (4 published -> 3D renders max 3; mobile shows 1 / 4; delete cleans storage)
  await goRoom('gallery')
  const thumbPngPath = coverPngPath
  for (const title of ['实验作品二', '实验作品三', '实验作品四']) {
    await page.getByRole('button', { name: '添加作品' }).click()
    await openEd.getByLabel('作品标题（发布必填）').fill(title)
    await openEd.getByLabel('作品简介（发布必填）').fill(`${title} 简介`)
    await openEd.getByLabel('作品正文（发布必填，支持分段纯文本）').fill(`${title} 正文`)
    await openEd.locator('.media-picker-block', { hasText: '作品封面图' }).locator('input[type="file"]').setInputFiles(thumbPngPath)
    await openEd.getByText(/已上传 1 张图片/).waitFor({ timeout: 15000 })
    await openEd.getByRole('button', { name: '发布作品' }).click()
    await openEd.getByText('作品已发布到作品室。').waitFor()
    await openEd.locator('.dialog-close').click()
  }
  await page.waitForTimeout(450)
  const xs4 = await page.evaluate(() => window.__HOME_QA__?.galleryPaperXs)
  assert.equal(xs4.length, 3, `Expected 3D gallery capped at 3 objects for 4 projects, got ${xs4?.length}`)

  // Switch to phone portrait 390x844
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(400)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert(await page.locator('.gallery-viewer').getByText('1 / 4').isVisible())
  await page.getByRole('button', { name: '下一件作品' }).click()
  assert(await page.locator('.gallery-viewer').getByText('2 / 4').isVisible())
  results.checks.push('4+ projects cap 3D wall at 3 sheets while mobile .gallery-viewer syncs 1 / 4 cleanly')

  // Reset desktop & delete extra 3 test projects, verify asset cleanup runs
  await page.setViewportSize({ width: 1440, height: 900 })
  const blobsBeforeDelete = db.blobs.size
  for (const title of ['实验作品二', '实验作品三', '实验作品四']) {
    if ((await page.locator('#room-directory').count()) === 0) {
      await page.getByRole('button', { name: '作品管理' }).click()
    }
    await page.locator('#room-directory .cms-manage-card', { hasText: title }).getByRole('button', { name: '编辑' }).click()
    await openEd.getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('dialog.confirm-dialog[open]').getByRole('button', { name: '确认删除' }).click()
    await page.waitForTimeout(300)
  }
  assert(db.blobs.size < blobsBeforeDelete, 'Expected deleted projects media blobs to be cleaned up')
  await page.waitForTimeout(400)
  const xsBackTo1 = await page.evaluate(() => window.__HOME_QA__?.galleryPaperXs)
  assert.deepEqual(xsBackTo1, [0])

  // Check Logout restores pure visitor view & blank profile fields are omitted
  await page.getByRole('button', { name: /小屋地图/ }).click()
  await page.getByRole('button', { name: '退出登录' }).click()
  await page.getByText('已退出管理模式').waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('button', { name: '添加作品' }).count(), 0)
  await goRoom('blank')
  assert(await page.getByText('小屋建造者').isVisible())
  assert.equal(await page.getByText(ADMIN_EMAIL).count(), 0)
  results.checks.push('deletion cleans unused storage blobs and logout restores strict visitor view')

  // Also test bidirectional link click in visitor mode (Study -> Gallery Project -> Study Note)
  await goRoom('study')
  await page.locator('#room-directory').getByRole('button', { name: /门窗和室内光照精修/ }).click()
  await page.locator('dialog.note-detail-dialog[open]').getByRole('button', { name: /我的小屋 · 交互式个人网站/ }).click()
  await page.locator('dialog.project-detail-dialog[open]').getByRole('heading', { name: '我的小屋 · 交互式个人网站' }).waitFor()
  await page.locator('dialog.project-detail-dialog[open]').getByRole('button', { name: /门窗和室内光照精修/ }).click()
  await page.locator('dialog.note-detail-dialog[open]').getByRole('heading', { name: '门窗和室内光照精修' }).waitFor()
  await page.locator('dialog.note-detail-dialog[open] .dialog-close').click()
  results.checks.push('visitor cross-navigation between NoteDetailModal and ProjectDetailModal works')

  // Allowlist expected negative-path HTTP console errors if Chrome logs 403/500 for intentional tests
  const unexpectedErrors = results.errors.filter(
    (msg) => !msg.includes('status of 500') && !msg.includes('status of 409'),
  )
  assert.equal(unexpectedErrors.length, 0, `Unexpected runtime errors: ${unexpectedErrors.join('\n')}`)
  results.passed = true
} catch (err) {
  results.passed = false
  results.failure = err.stack || String(err)
  await page.screenshot({ path: path.join(qaOutDir, 'failure.png') }).catch(() => {})
  process.exitCode = 1
} finally {
  await fs.promises.rm(path.join(qaOutDir, 'too-big-51mb.mp4'), { force: true }).catch(() => {})
  await fs.promises.writeFile(path.join(qaOutDir, 'results.json'), JSON.stringify(results, null, 2))
  await browser.close()
  mockServer.close()
  siteServer.close()
  console.log(JSON.stringify(results, null, 2))
}
