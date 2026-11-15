import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  cleanUuidArray,
  createAdminClient,
  errorResponse,
  flushCleanupQueue,
  HttpError,
  parseJsonBody,
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

    const body = await parseJsonBody<{ candidateAssetIds?: unknown; sweepOrphans?: boolean }>(req)
    const candidateAssetIds = cleanUuidArray(body.candidateAssetIds)

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
    return jsonResponse({ ok: true, ...result }, 200, req)
  } catch (err) {
    return errorResponse(err, req)
  }
})
