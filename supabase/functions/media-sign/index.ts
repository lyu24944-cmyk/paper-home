import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  createAdminClient,
  HttpError,
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
    const body = (await req.json()) as { assetIds?: unknown; scope?: 'public' | 'admin' }
    const rawIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []

    if (rawIds.length === 0) {
      return jsonResponse({ signedUrls: {}, deniedIds: [] })
    }

    const uniqueIds = [...new Set(rawIds)].slice(0, 40)
    const scope = body.scope === 'admin' ? 'admin' : 'public'

    if (scope === 'admin') {
      await requireAdmin(req, admin)
      const signedUrls = await signAssets(admin, uniqueIds, { allowedKinds: ['image', 'video'] })
      return jsonResponse({ signedUrls, deniedIds: [] })
    }

    // Public scope: verify each requested asset belongs to an actively published snapshot.
    const allowedIds: string[] = []
    const deniedIds: string[] = []

    await Promise.all(
      uniqueIds.map(async (id) => {
        const { data, error } = await admin.rpc('is_asset_public', { p_asset_id: id })
        if (!error && data === true) allowedIds.push(id)
        else deniedIds.push(id)
      }),
    )

    if (allowedIds.length === 0) {
      return jsonResponse(
        { error: '请求的素材未发布或已撤回', signedUrls: {}, deniedIds },
        403,
      )
    }

    const signedUrls = await signAssets(admin, allowedIds, { allowedKinds: ['image', 'video'] })
    return jsonResponse({ signedUrls, deniedIds })
  } catch (err) {
    if (err instanceof HttpError) {
      return jsonResponse({ error: err.message, detail: err.detail }, err.status)
    }
    return jsonResponse({ error: err instanceof Error ? err.message : '服务器错误' }, 500)
  }
})
