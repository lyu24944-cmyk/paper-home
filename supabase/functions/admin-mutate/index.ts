import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  BUCKET_NAME,
  cleanContactLinks,
  createAdminClient,
  flushCleanupQueue,
  HttpError,
  requireAdmin,
} from '../_shared/supabase.ts'

const MAX_BYTES = 52428800
const ALLOWED_IMAGE_MIMES = new Set(['image/webp', 'image/jpeg', 'image/png'])
const ALLOWED_VIDEO_MIMES = new Set(['video/mp4', 'video/webm'])

function mapRpcResult(result: Record<string, unknown>, extra: Record<string, unknown> = {}): Response {
  if (result.ok === true) {
    return jsonResponse({ ...result, ...extra }, 200)
  }
  const code = result.code
  if (code === 'CONFLICT') {
    return jsonResponse({ error: '云端已有更新版本，请先核对后再决定是否覆盖。', ...result, ...extra }, 409)
  }
  if (code === 'VALIDATION_ERROR') {
    const errors = Array.isArray(result.errors) ? result.errors : ['填写内容不完整']
    return jsonResponse({ error: errors.join('；'), ...result, ...extra }, 400)
  }
  if (code === 'NOT_FOUND') {
    return jsonResponse({ error: '记录不存在或已被删除。', ...result, ...extra }, 404)
  }
  return jsonResponse({ error: '操作未成功', ...result, ...extra }, 400)
}

async function handleMediaRegister(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  payload: Record<string, unknown>,
) {
  const assetId = typeof payload.assetId === 'string' ? payload.assetId : ''
  const kind = payload.kind === 'image' || payload.kind === 'video' ? payload.kind : null
  const displayPath = typeof payload.displayPath === 'string' ? payload.displayPath.trim() : ''
  const thumbPath = typeof payload.thumbPath === 'string' ? payload.thumbPath.trim() : null
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.trim() : ''
  const byteSize = typeof payload.byteSize === 'number' ? payload.byteSize : 0

  if (!assetId || !kind || !displayPath || byteSize <= 0 || byteSize > MAX_BYTES) {
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

  const { data: inserted, error } = await admin
    .from('media_assets')
    .upsert({
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
    throw new HttpError(500, '登记媒体记录失败', error?.message)
  }

  return jsonResponse({
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
  })
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
): Promise<Response> {
  const id = typeof payload.id === 'string' ? payload.id.trim() : ''
  const expectedVersion = typeof payload.expectedVersion === 'number' ? payload.expectedVersion : NaN
  if (!id || !Number.isInteger(expectedVersion)) {
    throw new HttpError(400, '缺少待删除的记录 ID 或版本号')
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
      return mapRpcResult({ ok: false, code: 'NOT_FOUND' })
    }
    return mapRpcResult({ ok: false, code: 'CONFLICT', latest: current })
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
  return mapRpcResult({ ok: true, deleted_id: id }, { pendingCleanupCount: cleanup.remaining })
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
    const body = (await req.json()) as { action?: string; payload?: Record<string, unknown> }
    const action = body.action ?? ''
    const payload = body.payload ?? {}

    if (action === 'media.register') {
      return await handleMediaRegister(admin, user.id, payload)
    }
    if (action === 'project.delete') {
      return await handleEntityDelete(admin, 'projects', payload)
    }
    if (action === 'note.delete') {
      return await handleEntityDelete(admin, 'notes', payload)
    }

    let rpcName = ''
    let rpcArgs: Record<string, unknown> = {}

    switch (action) {
      case 'project.save_draft':
        rpcName = 'save_project_draft'
        rpcArgs = {
          p_id: payload.id ?? null,
          p_expected_version: payload.expectedVersion ?? 1,
          p_slug: payload.slug ?? '',
          p_title: payload.title ?? '',
          p_summary: payload.summary ?? '',
          p_body: payload.body ?? '',
          p_demo_url: payload.demoUrl ?? '',
          p_cover_asset_id: payload.coverAssetId ?? null,
          p_gallery_asset_ids: Array.isArray(payload.galleryAssetIds) ? payload.galleryAssetIds : [],
          p_video_asset_id: payload.videoAssetId ?? null,
        }
        break
      case 'project.publish':
        rpcName = 'publish_project'
        rpcArgs = { p_id: payload.id, p_expected_version: payload.expectedVersion }
        break
      case 'project.unpublish':
        rpcName = 'unpublish_project'
        rpcArgs = { p_id: payload.id, p_expected_version: payload.expectedVersion }
        break
      case 'project.reorder':
        rpcName = 'reorder_projects'
        rpcArgs = {
          p_ordered_ids: Array.isArray(payload.orderedIds) ? payload.orderedIds : [],
          p_expected_order_version: payload.expectedOrderVersion,
        }
        break
      case 'note.save_draft':
        rpcName = 'save_note_draft'
        rpcArgs = {
          p_id: payload.id ?? null,
          p_expected_version: payload.expectedVersion ?? 1,
          p_slug: payload.slug ?? '',
          p_title: payload.title ?? '',
          p_body: payload.body ?? '',
          p_project_id: payload.projectId ?? null,
          p_image_asset_ids: Array.isArray(payload.imageAssetIds) ? payload.imageAssetIds : [],
          p_video_asset_id: payload.videoAssetId ?? null,
        }
        break
      case 'note.publish':
        rpcName = 'publish_note'
        rpcArgs = { p_id: payload.id, p_expected_version: payload.expectedVersion }
        break
      case 'note.unpublish':
        rpcName = 'unpublish_note'
        rpcArgs = { p_id: payload.id, p_expected_version: payload.expectedVersion }
        break
      case 'note.reorder':
        rpcName = 'reorder_notes'
        rpcArgs = {
          p_ordered_ids: Array.isArray(payload.orderedIds) ? payload.orderedIds : [],
          p_expected_order_version: payload.expectedOrderVersion,
        }
        break
      case 'profile.save_draft':
        rpcName = 'save_profile_draft'
        rpcArgs = {
          p_expected_version: payload.expectedVersion,
          p_display_name: payload.displayName ?? '',
          p_bio: payload.bio ?? '',
          p_focus_areas: payload.focusAreas ?? '',
          p_avatar_asset_id: payload.avatarAssetId ?? null,
          p_contact_email: payload.contactEmail ?? '',
          p_contact_links: cleanContactLinks(payload.contactLinks),
        }
        break
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
    })
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message, detail: err.detail }, err.status)
    }
    return jsonResponse({ error: err instanceof Error ? err.message : '服务器错误' }, 500)
  }
})
