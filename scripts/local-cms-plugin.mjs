import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  ALLOWED_IMAGE_MIMES,
  ALLOWED_VIDEO_MIMES,
  MAX_ASSET_BYTES,
  MAX_IMAGE_BYTES,
  createLocalCmsStore,
  httpError,
  isValidUuid,
} from './local-cms-store.mjs'

const SAFE_SERVE_MIMES = new Set([...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES])

function isLoopbackAddress(addr) {
  if (!addr) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function isLanPinModeEnabled() {
  return process.env.LOCAL_CMS_ALLOW_LAN === '1' && Boolean(process.env.LOCAL_CMS_PIN)
}

function timingSafeEqualStr(a, b) {
  const hashA = crypto.createHash('sha256').update(String(a)).digest()
  const hashB = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(hashA, hashB)
}

function isAllowedHostHeader(req) {
  const hostHeader = String(req.headers.host || '').trim()
  if (!hostHeader) return false
  if (isLanPinModeEnabled()) return true
  try {
    const parsed = new URL(`http://${hostHeader}`)
    const host = parsed.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1'
  } catch {
    return false
  }
}

function hasSafeOriginAndFetchSite(req) {
  const secFetchSite = typeof req.headers['sec-fetch-site'] === 'string'
    ? req.headers['sec-fetch-site'].toLowerCase()
    : ''
  if (secFetchSite && secFetchSite !== 'same-origin' && secFetchSite !== 'none') {
    return false
  }
  const origin = req.headers.origin
  if (origin !== undefined) {
    if (typeof origin !== 'string' || origin === 'null') return false
    const hostHeader = String(req.headers.host || '').trim().toLowerCase()
    if (!hostHeader) return false
    try {
      const parsedOrigin = new URL(origin)
      if (parsedOrigin.host.toLowerCase() !== hostHeader) return false
    } catch {
      return false
    }
  }
  return true
}

function sendJson(res, status, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(payload.byteLength))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    let rejected = false
    req.on('data', (chunk) => {
      if (rejected) return
      total += chunk.length
      if (total > maxBytes) {
        rejected = true
        reject(httpError(413, `请求体超出 ${Math.round(maxBytes / 1048576)} MB 上限`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      if (!rejected) reject(err)
    })
  })
}

async function readJsonBody(req) {
  const raw = await readRawBody(req, 2 * 1024 * 1024)
  if (!raw.length) return {}
  try {
    const parsed = JSON.parse(raw.toString('utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    throw httpError(400, '请求 JSON 格式不合法')
  }
}

function isWriteAuthorized(req) {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true
  const allowLan = process.env.LOCAL_CMS_ALLOW_LAN === '1'
  const expectedPin = process.env.LOCAL_CMS_PIN || ''
  const providedPin = typeof req.headers['x-local-pin'] === 'string' ? req.headers['x-local-pin'] : ''
  return Boolean(allowLan && expectedPin && providedPin && timingSafeEqualStr(providedPin, expectedPin))
}

function requireAdminHeaders(req, res) {
  if (!isAllowedHostHeader(req) || !hasSafeOriginAndFetchSite(req)) {
    sendJson(res, 403, { error: '禁止跨站或非法来源请求本地工作室接口。' })
    return false
  }
  if (!isWriteAuthorized(req)) {
    sendJson(res, 403, { error: '出于安全限制，本地编辑与写入仅限本机 127.0.0.1 / localhost 访问。' })
    return false
  }
  if (req.headers['x-local-owner'] !== '1') {
    sendJson(res, 403, { error: '缺少本地主人管理校验头。' })
    return false
  }
  return true
}

function pipeReadStream(res, filePath, options) {
  const stream = fs.createReadStream(filePath, options)
  const cleanup = () => {
    if (!stream.destroyed) stream.destroy()
  }
  res.on('close', cleanup)
  stream.on('error', () => {
    cleanup()
    if (!res.headersSent) {
      sendJson(res, 500, { error: '读取本地媒体流失败' })
    } else if (!res.writableEnded) {
      res.end()
    }
  })
  stream.pipe(res)
}

function serveMediaFile(req, res, resolved) {
  if (resolved.status !== 200) {
    sendJson(res, resolved.status, { error: resolved.error })
    return
  }

  const stat = fs.statSync(resolved.filePath)
  const total = stat.size
  const safeMime = SAFE_SERVE_MIMES.has(resolved.mimeType) ? resolved.mimeType : 'application/octet-stream'
  res.setHeader('Content-Type', safeMime)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Accept-Ranges', 'bytes')
  res.setHeader('Cache-Control', 'no-store')

  const rangeHeader = req.headers.range
  if (rangeHeader && typeof rangeHeader === 'string' && rangeHeader.startsWith('bytes=')) {
    const parts = rangeHeader.replace(/^bytes=/, '').split('-')
    const start = Math.max(0, Number.parseInt(parts[0] || '0', 10))
    const end = parts[1] ? Math.min(total - 1, Number.parseInt(parts[1], 10)) : total - 1
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      res.statusCode = 416
      res.setHeader('Content-Range', `bytes */${total}`)
      res.end()
      return
    }
    res.statusCode = 206
    res.setHeader('Content-Range', `bytes ${start}-${end}/${total}`)
    res.setHeader('Content-Length', String(end - start + 1))
    pipeReadStream(res, resolved.filePath, { start, end })
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Length', String(total))
  pipeReadStream(res, resolved.filePath)
}

export function localCmsPlugin({ rootDir, mode = 'development', outDir = 'dist', dataDir = process.env.LOCAL_CMS_DATA_DIR } = {}) {
  const store = createLocalCmsStore(rootDir, dataDir ? { dataDir } : undefined)

  return {
    name: 'paper-home-local-cms',
    configureServer(server) {
      server.middlewares.use('/__local-cms', async (req, res, next) => {
        try {
          if (!isAllowedHostHeader(req)) {
            sendJson(res, 403, { error: '出于安全限制，本地工作室仅允许本机回环 Host 访问。' })
            return
          }
          if ((req.method === 'POST' || req.method === 'PUT' || req.method === 'DELETE') && !hasSafeOriginAndFetchSite(req)) {
            sendJson(res, 403, { error: '禁止跨站来源调用本地工作室写入接口。' })
            return
          }
          const urlObj = new URL(req.url || '/', 'http://127.0.0.1')
          const pathname = urlObj.pathname

          if (req.method === 'GET' && pathname === '/health') {
            const db = store.readDb()
            const hasContent =
              db.projects.length > 0 ||
              db.notes.length > 0 ||
              Boolean(db.profile?.draft?.displayName || db.profile?.draft?.bio || db.profile?.isPublished)
            sendJson(res, 200, {
              ok: true,
              service: 'paper-home-local-cms',
              mode: 'local-studio',
              writable: isWriteAuthorized(req),
              isLoopback: isLoopbackAddress(req.socket?.remoteAddress),
              hasContent,
              dataDir: 'local-data/',
            })
            return
          }

          if (req.method === 'GET' && pathname === '/public-content') {
            sendJson(res, 200, store.buildPublicCottage())
            return
          }

          if (req.method === 'GET' && pathname === '/admin-content') {
            if (!requireAdminHeaders(req, res)) return
            sendJson(res, 200, store.buildAdminCottage())
            return
          }

          if (req.method === 'POST' && pathname === '/media-sign') {
            const body = await readJsonBody(req)
            const scope = body.scope === 'admin' ? 'admin' : 'public'
            if (scope === 'admin' && !requireAdminHeaders(req, res)) return
            const ids = Array.isArray(body.assetIds) ? body.assetIds : []
            const db = store.readDb()
            const { signedUrls, deniedIds } = store.signAssets(db, ids, { scope })
            if (scope === 'public' && ids.length > 0 && Object.keys(signedUrls).length === 0) {
              sendJson(res, 403, { error: '请求的素材未发布或已撤回', signedUrls, deniedIds })
              return
            }
            sendJson(res, 200, { signedUrls, deniedIds })
            return
          }

          if (req.method === 'POST' && pathname === '/admin-mutate') {
            if (!requireAdminHeaders(req, res)) return
            const body = await readJsonBody(req)
            const result = store.mutate(body.action || '', body.payload || {})
            sendJson(res, result.status, result.body)
            return
          }

          if (req.method === 'POST' && pathname === '/media-cleanup') {
            if (!requireAdminHeaders(req, res)) return
            const body = await readJsonBody(req)
            const resCleanup = store.cleanupAssets(body.candidateAssetIds, Boolean(body.sweepOrphans))
            sendJson(res, 200, resCleanup)
            return
          }

          if (req.method === 'POST' && pathname === '/init-sample') {
            if (!requireAdminHeaders(req, res)) return
            const body = await readJsonBody(req)
            const result = await store.seedNeutralSample({ force: Boolean(body.force) })
            sendJson(res, 200, { ok: true, ...result })
            return
          }

          if ((req.method === 'POST' || req.method === 'PUT') && pathname === '/media-upload') {
            if (!requireAdminHeaders(req, res)) return
            const assetId = urlObj.searchParams.get('assetId') || ''
            const variant = urlObj.searchParams.get('variant') || 'display'
            const mimeType = (urlObj.searchParams.get('mimeType') || '').trim()

            if (!isValidUuid(assetId)) {
              sendJson(res, 400, { error: '非法素材 ID' })
              return
            }
            if (store.hasAsset(assetId)) {
              sendJson(res, 409, { error: '该素材 ID 已完成登记，禁止覆盖。' })
              return
            }

            if (variant === 'video') {
              if (!ALLOWED_VIDEO_MIMES.has(mimeType)) {
                sendJson(res, 400, { error: '请声明有效的 MP4 或 WebM 视频 MIME 类型' })
                return
              }
              const ext = mimeType === 'video/webm' ? 'webm' : 'mp4'
              const reset = urlObj.searchParams.get('reset') === '1'
              const finalize = urlObj.searchParams.get('final') === '1'
              const chunk = await readRawBody(req, MAX_ASSET_BYTES + 1024 * 1024)
              const written = store.appendVideoChunk(assetId, ext, chunk, { reset, finalize, mimeType })
              sendJson(res, 200, { ok: true, ...written })
              return
            }

            if (variant !== 'display' && variant !== 'thumb') {
              sendJson(res, 400, { error: '不支持的上传类型' })
              return
            }
            if (!ALLOWED_IMAGE_MIMES.has(mimeType)) {
              sendJson(res, 400, { error: '仅支持 WebP、JPEG 或 PNG 图片' })
              return
            }
            const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp'
            const buf = await readRawBody(req, MAX_IMAGE_BYTES)
            const relPath = store.writeUploadedMediaBlob(assetId, variant, ext, buf, mimeType)
            sendJson(res, 200, { ok: true, path: relPath, byteSize: buf.length })
            return
          }

          if (req.method === 'DELETE' && pathname === '/media-upload') {
            if (!requireAdminHeaders(req, res)) return
            const assetId = urlObj.searchParams.get('assetId') || ''
            store.abortVideoUpload(assetId)
            sendJson(res, 200, { ok: true })
            return
          }

          const mediaMatch = pathname.match(/^\/media\/(public|admin)\/([0-9a-f-]+)\/(display|thumb)$/i)
          if (req.method === 'GET' && mediaMatch) {
            const [, scope, assetId, variant] = mediaMatch
            if (scope === 'admin' && (!isWriteAuthorized(req) || !hasSafeOriginAndFetchSite(req))) {
              sendJson(res, 403, { error: '禁止跨站或非本机读取草稿素材' })
              return
            }
            const resolved = store.resolveAssetFile(assetId, variant, scope)
            serveMediaFile(req, res, resolved)
            return
          }

          next()
        } catch (err) {
          const status =
            err && typeof err === 'object' && 'status' in err && Number.isInteger(err.status) && err.status >= 400 && err.status < 600
              ? err.status
              : 500
          sendJson(res, status, { error: err instanceof Error ? err.message : '本地存储服务异常' })
        }
      })
    },
    writeBundle(outputOptions) {
      if (mode !== 'local-export') return
      const resolvedOutDir = outputOptions?.dir ? path.resolve(outputOptions.dir) : path.resolve(rootDir, outDir)
      const snapshotDir = path.join(resolvedOutDir, 'local-snapshot')
      const summary = store.exportStaticSnapshot(snapshotDir)
      console.log(
        `[paper-home] Exported local static snapshot -> ${path.relative(rootDir, snapshotDir)} ` +
          `(projects: ${summary.projectCount}, notes: ${summary.noteCount}, assets: ${summary.assetCount})`,
      )
    },
  }
}
