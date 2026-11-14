import fs from 'node:fs'
import path from 'node:path'
import { ALLOWED_IMAGE_MIMES, ALLOWED_VIDEO_MIMES, MAX_ASSET_BYTES, MAX_IMAGE_BYTES, createLocalCmsStore } from './local-cms-store.mjs'

function isLoopbackAddress(addr) {
  if (!addr) return false
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function sendJson(res, status, data) {
  const payload = Buffer.from(JSON.stringify(data), 'utf8')
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Content-Length', String(payload.byteLength))
  res.setHeader('Cache-Control', 'no-store')
  res.end(payload)
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let total = 0
    req.on('data', (chunk) => {
      total += chunk.length
      if (total > maxBytes) {
        reject(new Error(`请求体超出 ${Math.round(maxBytes / 1048576)} MB 上限`))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJsonBody(req) {
  const raw = await readRawBody(req, 2 * 1024 * 1024)
  if (!raw.length) return {}
  return JSON.parse(raw.toString('utf8'))
}

function isWriteAuthorized(req) {
  if (isLoopbackAddress(req.socket?.remoteAddress)) return true
  const allowLan = process.env.LOCAL_CMS_ALLOW_LAN === '1'
  const expectedPin = process.env.LOCAL_CMS_PIN || ''
  return Boolean(allowLan && expectedPin && req.headers['x-local-pin'] === expectedPin)
}

function requireAdminHeaders(req, res) {
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

function serveMediaFile(req, res, resolved) {
  if (resolved.status !== 200) {
    sendJson(res, resolved.status, { error: resolved.error })
    return
  }

  const stat = fs.statSync(resolved.filePath)
  const total = stat.size
  res.setHeader('Content-Type', resolved.mimeType)
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
    fs.createReadStream(resolved.filePath, { start, end }).pipe(res)
    return
  }

  res.statusCode = 200
  res.setHeader('Content-Length', String(total))
  fs.createReadStream(resolved.filePath).pipe(res)
}

export function localCmsPlugin({ rootDir, mode = 'development', outDir = 'dist', dataDir = process.env.LOCAL_CMS_DATA_DIR } = {}) {
  const store = createLocalCmsStore(rootDir, dataDir ? { dataDir } : undefined)

  return {
    name: 'paper-home-local-cms',
    configureServer(server) {
      server.middlewares.use('/__local-cms', async (req, res, next) => {
        try {
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
            const mimeType = urlObj.searchParams.get('mimeType') || ''

            if (variant === 'video') {
              if (mimeType && !ALLOWED_VIDEO_MIMES.has(mimeType)) {
                sendJson(res, 400, { error: '仅支持 MP4 或 WebM 视频文件' })
                return
              }
              const ext = mimeType === 'video/webm' || urlObj.searchParams.get('ext') === 'webm' ? 'webm' : 'mp4'
              const reset = urlObj.searchParams.get('reset') === '1'
              const finalize = urlObj.searchParams.get('final') === '1'
              const chunk = await readRawBody(req, MAX_ASSET_BYTES + 1024 * 1024)
              const written = store.appendVideoChunk(assetId, ext, chunk, { reset, finalize })
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
            const relPath = store.writeUploadedMediaBlob(assetId, variant, ext, buf)
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
            if (scope === 'admin' && (!isWriteAuthorized(req) || req.headers['sec-fetch-site'] === 'cross-site')) {
              sendJson(res, 403, { error: '禁止跨站或非本机读取草稿素材' })
              return
            }
            const resolved = store.resolveAssetFile(assetId, variant, scope)
            serveMediaFile(req, res, resolved)
            return
          }

          next()
        } catch (err) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : '本地存储服务异常' })
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
