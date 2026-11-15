import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  BUCKET_NAME,
  cleanContactLinks,
  cleanShortLines,
  cleanUuidArray,
  createAdminClient,
  errorResponse,
  flushCleanupQueue,
  HttpError,
  isValidEmail,
  isValidHttpUrl,
  isValidUuid,
  normalizeSiteSettingsRow,
  parseJsonBody,
  requireAdmin,
} from '../_shared/supabase.ts'

const MAX_BYTES = 52428800
const MAX_IMAGE_BYTES = 10485760
const ALLOWED_IMAGE_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png'])
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm'])

function requireOptionalUuid(val: unknown, label: string): string | null {
  if (val === undefined || val === null || val === '') return null
  if (!isValidUuid(val)) {
    throw new HttpError(400, `${label}格式不合法`)
  }
  return val.trim()
}

function requireUuid(val: unknown, label: string): string {
  if (!isValidUuid(val)) {
    throw new HttpError(400, `${label}格式不合法或缺失`)
  }
  return val.trim()
}

function mapRpcResult(
  result: Record<string, unknown>,
  extra: Record<string, unknown> = {},
  req?: Request,
): Response {
  if (result.ok === true) {
    return jsonResponse({ ...result, ...extra }, 200, req)
  }
  const code = result.code
  if (code === 'CONFLICT') {
    return jsonResponse({ error: '云端已有更新版本，请先核对后再决定是否覆盖。', ...result, ...extra }, 409, req)
  }
  if (code === 'SLUG_TAKEN') {
    return jsonResponse({ error: '短链接标识已被占用，请更换后再保存。', ...result, ...extra }, 409, req)
  }
  if (code === 'VALIDATION_ERROR') {
    const errors = Array.isArray(result.errors) ? result.errors : ['填写内容不完整']
    return jsonResponse({ error: errors.join('；'), ...result, ...extra }, 400, req)
  }
  if (code === 'NOT_FOUND') {
    return jsonResponse({ error: '记录不存在或已被删除。', ...result, ...extra }, 404, req)
  }
  return jsonResponse({ error: '操作未成功', ...result, ...extra }, 400, req)
}

async function handleMediaRegister(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  payload: Record<string, unknown>,
  req: Request,
) {
  const assetId = typeof payload.assetId === 'string' ? payload.assetId.trim() : ''
  const kind = payload.kind === 'image' || payload.kind === 'video' ? payload.kind : null
  const displayPath = typeof payload.displayPath === 'string' ? payload.displayPath.trim() : ''
  const thumbPath = typeof payload.thumbPath === 'string' ? payload.thumbPath.trim() : null
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : ''
  const byteSize = typeof payload.byteSize === 'number' ? payload.byteSize : 0
  const maxKindBytes = kind === 'image' ? MAX_IMAGE_BYTES : MAX_BYTES

  if (!isValidUuid(assetId) || !kind || !displayPath || byteSize <= 0 || byteSize > MAX_BYTES) {
    throw new HttpError(400, '媒体参数不合法或文件超出 50 MB 限制')
  }
  const expectedPrefix = `${kind}s/${assetId}/`
  if (!displayPath.startsWith(expectedPrefix) || (thumbPath && !thumbPath.startsWith(expectedPrefix))) {
    throw new HttpError(400, '媒体存储路径格式不合法')
  }
  if (kind === 'image' && !ALLOWED_IMAGE_MIMES.has(mimeType)) {
    throw new HttpError(400, '仅支持 WebP、JPEG 或 PNG 图片')
  }
  if (kind === 'video' && !ALLOWED_VIDEO_MIMES.has(mimeType)) {
    throw new HttpError(400, '仅支持 MP4 或 WebM 视频')
  }

  const { data: existing, error: existingErr } = await admin
    .from('media_assets')
    .select('id')
    .eq('id', assetId)
    .maybeSingle()

  if (existingErr) {
    throw new HttpError(500, '检查媒体记录状态失败', existingErr.message)
  }
  if (existing) {
    throw new HttpError(409, '该素材 ID 已完成登记，禁止覆盖。')
  }

  // Verify object actually exists in private storage before marking ready.
  const folder = displayPath.split('/').slice(0, -1).join('/')
  const filename = displayPath.split('/').pop() ?? ''
  const { data: listed, error: listErr } = await admin.storage
    .from(BUCKET_NAME)
    .list(folder, { search: filename, limit: 10 })

  const found = listed?.find((item) => item.name === filename)
  if (listErr || !found) {
    throw new HttpError(400, '存储文件尚未上传完成，请重试上传')
  }

  const storageSize = (found.metadata as Record<string, unknown> | undefined)?.size
  if (typeof storageSize === 'number') {
    if (storageSize <= 0 || storageSize > maxKindBytes || (kind === 'video' && storageSize !== byteSize)) {
      throw new HttpError(400, '存储文件实际体积与声明不符或超出限制')
    }
  }

  const { data: inserted, error } = await admin
    .from('media_assets')
    .insert({
      id: assetId,
      kind,
      status: 'ready',
      display_path: displayPath,
      thumb_path: thumbPath,
      mime_type: mimeType,
      byte_size: byteSize,
      width: typeof payload.width === 'number' ? Math.round(payload.width) : null,
      height: typeof payload.height === 'number' ? Math.round(payload.height) : null,
      duration_sec: typeof payload.durationSec === 'number' ? payload.durationSec : null,
      original_filename: typeof payload.originalFilename === 'string' ? payload.originalFilename.slice(0, 180) : null,
      created_by: userId,
    })
    .select('*')
    .single()

  if (error || !inserted) {
    if (error?.code === '23505') {
      throw new HttpError(409, '该素材 ID 已完成登记，禁止覆盖。')
    }
    throw new HttpError(500, '登记媒体记录失败', error?.message)
  }

  return jsonResponse(
    {
      ok: true,
      asset: {
        id: inserted.id,
        kind: inserted.kind,
        status: inserted.status,
        mimeType: inserted.mime_type,
        byteSize: inserted.byte_size,
        width: inserted.width,
        height: inserted.height,
        durationSec: inserted.duration_sec,
        originalFilename: inserted.original_filename,
        createdAt: inserted.created_at,
      },
    },
    200,
    req,
  )
}

function collectCandidateAssetIds(row: Record<string, unknown>): string[] {
  const ids: string[] = []
  const pushStr = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) ids.push(v.trim())
  }
  const pushArr = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(pushStr)
  }

  pushStr(row.draft_cover_asset_id)
  pushStr(row.draft_video_asset_id)
  pushArr(row.draft_gallery_asset_ids)
  pushArr(row.draft_image_asset_ids)

  const pub = row.published_snapshot as Record<string, unknown> | null | undefined
  if (pub && typeof pub === 'object') {
    pushStr(pub.cover_asset_id)
    pushStr(pub.video_asset_id)
    pushArr(pub.gallery_asset_ids)
    pushArr(pub.image_asset_ids)
  }
  return [...new Set(ids)]
}

async function handleEntityDelete(
  admin: ReturnType<typeof createAdminClient>,
  table: 'projects' | 'notes',
  payload: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  const id = requireUuid(payload.id, '待删除记录 ID')
  const expectedVersion = typeof payload.expectedVersion === 'number' ? payload.expectedVersion : NaN
  if (!Number.isInteger(expectedVersion)) {
    throw new HttpError(400, '缺少待删除的记录版本号')
  }

  // Atomic SQL WHERE id = $1 AND version = $2 prevents deleting past concurrent edits.
  const { data: deleted, error: delErr } = await admin
    .from(table)
    .delete()
    .eq('id', id)
    .eq('version', expectedVersion)
    .select('*')
    .maybeSingle()

  if (delErr) {
    throw new HttpError(500, '删除失败', delErr.message)
  }

  if (!deleted) {
    const { data: current, error: readErr } = await admin
      .from(table)
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (readErr) {
      throw new HttpError(500, '检查记录版本失败', readErr.message)
    }
    if (!current) {
      return mapRpcResult({ ok: false, code: 'NOT_FOUND' }, {}, req)
    }
    return mapRpcResult({ ok: false, code: 'CONFLICT', latest: current }, {}, req)
  }

  const candidates = collectCandidateAssetIds(deleted as Record<string, unknown>)
  if (candidates.length > 0) {
    const { error: cleanErr } = await admin.rpc('cleanup_candidate_assets', {
      p_candidate_ids: candidates,
      p_sweep_orphans: false,
    })
    if (cleanErr) {
      throw new HttpError(500, '清理关联素材失败', cleanErr.message)
    }
  }

  const cleanup = await flushCleanupQueue(admin)
  return mapRpcResult({ ok: true, deleted_id: id }, { pendingCleanupCount: cleanup.remaining }, req)
}

async function handleSettingsSave(
  admin: ReturnType<typeof createAdminClient>,
  payload: Record<string, unknown>,
  req: Request,
): Promise<Response> {
  const expectedVersion =
    typeof payload.expectedVersion === 'number' && Number.isInteger(payload.expectedVersion)
      ? payload.expectedVersion
      : null

  const { data, error } = await admin.rpc('save_site_settings', {
    p_expected_version: expectedVersion,
    p_home_name: typeof payload.homeName === 'string' ? payload.homeName : '',
    p_plaque_title: typeof payload.plaqueTitle === 'string' ? payload.plaqueTitle : '',
    p_plaque_subtitle: typeof payload.plaqueSubtitle === 'string' ? payload.plaqueSubtitle : '',
    p_yard_heading: typeof payload.yardHeading === 'string' ? payload.yardHeading : '',
    p_yard_subtitle: typeof payload.yardSubtitle === 'string' ? payload.yardSubtitle : '',
    p_default_atmosphere: typeof payload.defaultAtmosphere === 'string' ? payload.defaultAtmosphere : 'daylight',
    p_default_weather: typeof payload.defaultWeather === 'string' ? payload.defaultWeather : 'clear',
  })

  if (error) {
    throw new HttpError(500, '保存小屋设置失败', error.message)
  }

  const result = (data ?? {}) as Record<string, unknown>
  if (result.ok === true) {
    const row = (result.settings ?? {}) as Record<string, unknown>
    const cleanup = await flushCleanupQueue(admin)
    return jsonResponse(
      {
        ok: true,
        siteSettings: normalizeSiteSettingsRow(row),
        siteSettingsVersion: typeof row.version === 'number' ? row.version : 1,
        pendingCleanupCount: cleanup.remaining,
      },
      200,
      req,
    )
  }

  if (result.code === 'CONFLICT') {
    const latestRow = result.latest as Record<string, unknown> | undefined
    return jsonResponse(
      {
        ok: false,
        code: 'CONFLICT',
        error: '小屋设置在另一标签页已有更新，请刷新后再保存。',
        latest: latestRow
          ? {
              siteSettings: normalizeSiteSettingsRow(latestRow),
              siteSettingsVersion: typeof latestRow.version === 'number' ? latestRow.version : 1,
            }
          : undefined,
      },
      409,
      req,
    )
  }

  return mapRpcResult(result, {}, req)
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, '仅支持 POST 请求')
    }

    const admin = createAdminClient()
    const user = await requireAdmin(req, admin)
    const body = await parseJsonBody<{ action?: string; payload?: Record<string, unknown> }>(req)
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object' ? body.payload : {}

    if (action === 'media.register') {
      return await handleMediaRegister(admin, user.id, payload, req)
    }
    if (action === 'settings.save') {
      return await handleSettingsSave(admin, payload, req)
    }
    if (action === 'project.delete') {
      return await handleEntityDelete(admin, 'projects', payload, req)
    }
    if (action === 'note.delete') {
      return await handleEntityDelete(admin, 'notes', payload, req)
    }

    let rpcName = ''
    let rpcArgs: Record<string, unknown> = {}

    switch (action) {
      case 'project.save_draft': {
        const demoUrl = typeof payload.demoUrl === 'string' ? payload.demoUrl.trim() : ''
        if (demoUrl && !isValidHttpUrl(demoUrl)) {
          throw new HttpError(400, '演示链接格式无效，请以 http:// 或 https:// 开头。')
        }
        rpcName = 'save_project_draft'
        rpcArgs = {
          p_id: requireOptionalUuid(payload.id, '作品 ID'),
          p_expected_version: payload.expectedVersion ?? 1,
          p_slug: typeof payload.slug === 'string' ? payload.slug : '',
          p_title: payload.title ?? '',
          p_summary: payload.summary ?? '',
          p_body: payload.body ?? '',
          p_demo_url: demoUrl,
          p_cover_asset_id: requireOptionalUuid(payload.coverAssetId, '封面图 ID'),
          p_gallery_asset_ids: cleanUuidArray(payload.galleryAssetIds),
          p_video_asset_id: requireOptionalUuid(payload.videoAssetId, '视频 ID'),
        }
        break
      }
      case 'project.publish':
        rpcName = 'publish_project'
        rpcArgs = { p_id: requireUuid(payload.id, '作品 ID'), p_expected_version: payload.expectedVersion }
        break
      case 'project.unpublish':
        rpcName = 'unpublish_project'
        rpcArgs = { p_id: requireUuid(payload.id, '作品 ID'), p_expected_version: payload.expectedVersion }
        break
      case 'project.reorder':
        rpcName = 'reorder_projects'
        rpcArgs = {
          p_ordered_ids: cleanUuidArray(payload.orderedIds),
          p_expected_order_version: payload.expectedOrderVersion,
        }
        break
      case 'note.save_draft':
        rpcName = 'save_note_draft'
        rpcArgs = {
          p_id: requireOptionalUuid(payload.id, '手记 ID'),
          p_expected_version: payload.expectedVersion ?? 1,
          p_slug: typeof payload.slug === 'string' ? payload.slug : '',
          p_title: payload.title ?? '',
          p_body: payload.body ?? '',
          p_project_id: requireOptionalUuid(payload.projectId, '关联作品 ID'),
          p_image_asset_ids: cleanUuidArray(payload.imageAssetIds),
          p_video_asset_id: requireOptionalUuid(payload.videoAssetId, '视频 ID'),
        }
        break
      case 'note.publish':
        rpcName = 'publish_note'
        rpcArgs = { p_id: requireUuid(payload.id, '手记 ID'), p_expected_version: payload.expectedVersion }
        break
      case 'note.unpublish':
        rpcName = 'unpublish_note'
        rpcArgs = { p_id: requireUuid(payload.id, '手记 ID'), p_expected_version: payload.expectedVersion }
        break
      case 'note.reorder':
        rpcName = 'reorder_notes'
        rpcArgs = {
          p_ordered_ids: cleanUuidArray(payload.orderedIds),
          p_expected_order_version: payload.expectedOrderVersion,
        }
        break
      case 'profile.save_draft': {
        const contactEmail = typeof payload.contactEmail === 'string' ? payload.contactEmail.trim() : ''
        if (contactEmail && !isValidEmail(contactEmail)) {
          throw new HttpError(400, '联系邮箱格式无效。')
        }
        if (Array.isArray(payload.contactLinks)) {
          for (const item of payload.contactLinks) {
            const label = typeof item?.label === 'string' ? item.label.trim() : ''
            const url = typeof item?.url === 'string' ? item.url.trim() : ''
            if (!label && !url) continue
            if (!label || !isValidHttpUrl(url)) {
              throw new HttpError(400, '联系方式链接需要同时填写名称与有效 http(s):// 网址。')
            }
          }
        }
        rpcName = 'save_profile_draft'
        rpcArgs = {
          p_expected_version: payload.expectedVersion,
          p_display_name: payload.displayName ?? '',
          p_bio: payload.bio ?? '',
          p_focus_areas: payload.focusAreas ?? '',
          p_avatar_asset_id: requireOptionalUuid(payload.avatarAssetId, '头像 ID'),
          p_contact_email: contactEmail,
          p_contact_links: cleanContactLinks(payload.contactLinks),
          p_now_notes: cleanShortLines(payload.nowNotes, 3, 36),
          p_quotes: cleanShortLines(payload.quotes, 8, 120),
        }
        break
      }
      case 'profile.publish':
        rpcName = 'publish_profile'
        rpcArgs = { p_expected_version: payload.expectedVersion }
        break
      case 'profile.unpublish':
        rpcName = 'unpublish_profile'
        rpcArgs = { p_expected_version: payload.expectedVersion }
        break
      default:
        throw new HttpError(400, `未知操作: ${action}`)
    }

    const { data, error } = await admin.rpc(rpcName, rpcArgs)
    if (error) {
      throw new HttpError(500, '数据库保存失败', error.message)
    }

    const cleanup = await flushCleanupQueue(admin)
    return mapRpcResult((data ?? {}) as Record<string, unknown>, {
      pendingCleanupCount: cleanup.remaining,
    }, req)
  } catch (err) {
    return errorResponse(err, req)
  }
})
