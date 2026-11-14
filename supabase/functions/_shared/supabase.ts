import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'

export const BUCKET_NAME = 'cottage-media'
export const DEFAULT_SIGN_TTL_SEC = 600

export interface SignedMediaEntry {
  displayUrl: string
  thumbUrl: string | null
  expiresAt: number
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message)
  }
}

export function createAdminClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !serviceKey) {
    throw new HttpError(500, 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }
  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function requireAdmin(req: Request, adminClient: SupabaseClient): Promise<User> {
  const authHeader = req.headers.get('Authorization') || ''
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  if (!match) {
    throw new HttpError(401, '未登录或缺少身份凭证')
  }
  const token = match[1].trim()
  const { data, error } = await adminClient.auth.getUser(token)
  if (error || !data.user) {
    throw new HttpError(401, '登录状态已失效，请重新登录')
  }

  const configuredId = Deno.env.get('ADMIN_USER_ID')?.trim()
  if (configuredId && data.user.id !== configuredId) {
    throw new HttpError(403, '当前账号无管理权限')
  }

  const { data: adminRow, error: adminErr } = await adminClient
    .from('admin_users')
    .select('user_id')
    .eq('user_id', data.user.id)
    .maybeSingle()

  if (adminErr || !adminRow) {
    throw new HttpError(403, '当前账号未授权为小屋管理员')
  }

  return data.user
}

export async function signAssets(
  adminClient: SupabaseClient,
  assetIds: string[],
  options: { expiresIn?: number; allowedKinds?: ('image' | 'video')[] } = {},
): Promise<Record<string, SignedMediaEntry>> {
  const { expiresIn = DEFAULT_SIGN_TTL_SEC, allowedKinds = ['image'] } = options
  const uniqueIds = [...new Set(assetIds.filter(Boolean))]
  if (uniqueIds.length === 0) return {}

  const { data: assets, error } = await adminClient
    .from('media_assets')
    .select('id, kind, status, display_path, thumb_path')
    .in('id', uniqueIds)
    .in('kind', allowedKinds)

  if (error || !assets) {
    throw new HttpError(500, '读取媒体元数据失败', error?.message)
  }

  const paths: string[] = []
  for (const asset of assets) {
    if (asset.status !== 'ready') continue
    paths.push(asset.display_path)
    if (asset.thumb_path) paths.push(asset.thumb_path)
  }

  if (paths.length === 0) return {}

  const { data: signedList, error: signErr } = await adminClient.storage
    .from(BUCKET_NAME)
    .createSignedUrls(paths, expiresIn)

  if (signErr || !signedList) {
    throw new HttpError(500, '生成临时媒体链接失败', signErr?.message)
  }

  const byPath = new Map<string, string>()
  for (const item of signedList) {
    if (item.path && item.signedUrl) {
      byPath.set(item.path, item.signedUrl)
    }
  }

  const expiresAt = Date.now() + expiresIn * 1000
  const result: Record<string, SignedMediaEntry> = {}
  for (const asset of assets) {
    const displayUrl = byPath.get(asset.display_path)
    if (!displayUrl) continue
    result[asset.id] = {
      displayUrl,
      thumbUrl: asset.thumb_path ? (byPath.get(asset.thumb_path) ?? null) : null,
      expiresAt,
    }
  }

  return result
}

export async function flushCleanupQueue(adminClient: SupabaseClient): Promise<{
  cleaned: number
  remaining: number
  errors: string[]
}> {
  const { data: dueRows, error } = await adminClient
    .from('media_cleanup_queue')
    .select('id, asset_id, storage_paths, attempts')
    .lte('next_retry_at', new Date().toISOString())
    .order('created_at', { ascending: true })
    .limit(50)

  if (error) {
    return { cleaned: 0, remaining: -1, errors: [error.message] }
  }

  let cleaned = 0
  const errors: string[] = []

  for (const row of dueRows ?? []) {
    const paths = (row.storage_paths as string[]).filter(Boolean)
    if (paths.length === 0) {
      await adminClient.from('media_cleanup_queue').delete().eq('id', row.id)
      if (row.asset_id) {
        await adminClient.from('media_assets').delete().eq('id', row.asset_id).eq('status', 'pending_delete')
      }
      cleaned += 1
      continue
    }

    const { error: rmErr } = await adminClient.storage.from(BUCKET_NAME).remove(paths)
    if (!rmErr) {
      await adminClient.from('media_cleanup_queue').delete().eq('id', row.id)
      if (row.asset_id) {
        await adminClient.from('media_assets').delete().eq('id', row.asset_id).eq('status', 'pending_delete')
      }
      cleaned += 1
    } else {
      const nextRetry = new Date(Date.now() + 5 * 60 * 1000).toISOString()
      await adminClient
        .from('media_cleanup_queue')
        .update({
          attempts: (row.attempts ?? 0) + 1,
          last_error: rmErr.message,
          next_retry_at: nextRetry,
        })
        .eq('id', row.id)
      errors.push(rmErr.message)
    }
  }

  const { count } = await adminClient
    .from('media_cleanup_queue')
    .select('id', { count: 'exact', head: true })

  return { cleaned, remaining: count ?? 0, errors }
}

export function cleanContactLinks(raw: unknown): { label: string; url: string }[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => {
      const label = typeof item?.label === 'string' ? item.label.trim() : ''
      const url = typeof item?.url === 'string' ? item.url.trim() : ''
      return { label, url }
    })
    .filter((item) => item.label && item.url)
}
