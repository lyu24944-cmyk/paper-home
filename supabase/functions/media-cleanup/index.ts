import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  createAdminClient,
  flushCleanupQueue,
  HttpError,
  requireAdmin,
} from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, '仅支持 POST 请求')
    }

    const admin = createAdminClient()
    await requireAdmin(req, admin)

    const body = (await req.json().catch(() => ({}))) as {
      candidateAssetIds?: unknown
      sweepOrphans?: boolean
    }

    const candidateAssetIds = Array.isArray(body.candidateAssetIds)
      ? body.candidateAssetIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []

    if (candidateAssetIds.length > 0 || body.sweepOrphans) {
      const { error } = await admin.rpc('cleanup_candidate_assets', {
        p_candidate_ids: candidateAssetIds,
        p_sweep_orphans: Boolean(body.sweepOrphans),
      })
      if (error) {
        throw new HttpError(500, '登记待清理素材失败', error.message)
      }
    }

    const result = await flushCleanupQueue(admin)
    return jsonResponse({ ok: true, ...result })
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message, detail: err.detail }, err.status)
    }
    return jsonResponse({ error: err instanceof Error ? err.message : '服务器错误' }, 500)
  }
})
