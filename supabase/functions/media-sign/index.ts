import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  cleanUuidArray,
  createAdminClient,
  errorResponse,
  HttpError,
  parseJsonBody,
  requireAdmin,
  signAssets,
} from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    if (req.method !== 'POST') {
      throw new HttpError(405, '仅支持 POST 请求')
    }

    const admin = createAdminClient()
    const body = await parseJsonBody<{ assetIds?: unknown; scope?: 'public' | 'admin' }>(req)
    const rawIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []

    if (rawIds.length === 0) {
      return jsonResponse({ signedUrls: {}, deniedIds: [] }, 200, req)
    }

    const uniqueIds = cleanUuidArray(rawIds).slice(0, 40)
    if (uniqueIds.length === 0) {
      throw new HttpError(400, '请求包含非法的素材 ID')
    }

    const scope = body.scope === 'admin' ? 'admin' : 'public'

    if (scope === 'admin') {
      await requireAdmin(req, admin)
      const signedUrls = await signAssets(admin, uniqueIds, { allowedKinds: ['image', 'video'] })
      return jsonResponse({ signedUrls, deniedIds: [] }, 200, req)
    }

    // Public scope: verify requested assets in a single batch SQL RPC.
    const { data: allowedData, error: rpcErr } = await admin.rpc('filter_public_asset_ids', {
      p_ids: uniqueIds,
    })
    if (rpcErr) {
      throw new HttpError(500, '校验公开素材权限失败', rpcErr.message)
    }

    const allowedIds = cleanUuidArray(allowedData)
    const allowedSet = new Set(allowedIds)
    const deniedIds = uniqueIds.filter((id) => !allowedSet.has(id))

    if (allowedIds.length === 0) {
      return jsonResponse(
        { error: '请求的素材未发布或已撤回', signedUrls: {}, deniedIds },
        403,
        req,
      )
    }

    const signedUrls = await signAssets(admin, allowedIds, { allowedKinds: ['image', 'video'] })
    return jsonResponse({ signedUrls, deniedIds }, 200, req)
  } catch (err) {
    return errorResponse(err, req)
  }
})
