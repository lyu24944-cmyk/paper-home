import { createClient, type SupabaseClient, type User } from 'jsr:@supabase/supabase-js@2'
import { jsonResponse } from './cors.ts'

export const BUCKET_NAME = 'cottage-media'
export const DEFAULT_SIGN_TTL_SEC = 600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const VALID_ATMOSPHERES = new Set(['dawn', 'daylight', 'golden', 'night', 'auto'])
const VALID_WEATHERS = new Set(['clear', 'rain'])

export const DEFAULT_SITE_SETTINGS = {
  homeName: '我的小屋',
  plaqueTitle: '欢迎回家',
  plaqueSubtitle: '留一点时间，慢慢逛',
  yardHeading: '来家里坐坐。',
  yardSubtitle: '推开门，里面是我的作品、过程记录与自我介绍。',
  defaultAtmosphere: 'daylight',
  defaultWeather: 'clear',
}

export function isValidUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim())
}

export function cleanUuidArray(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of input) {
    if (!isValidUuid(item)) continue
    const clean = item.trim()
    if (seen.has(clean)) continue
    seen.add(clean)
    out.push(clean)
  }
  return out
}

export function isValidHttpUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (!trimmed || trimmed.length > 500) return false
  try {
    const parsed = new URL(trimmed)
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && Boolean(parsed.hostname)
  } catch {
    return false
  }
}

export function isValidEmail(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  return Boolean(trimmed) && trimmed.length <= 180 && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(trimmed)
}

export function cleanShortLines(raw: unknown, maxItems = 3, maxLen = 36): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === 'string' ? item.trim().slice(0, maxLen) : ''))
    .filter(Boolean)
    .slice(0, maxItems)
}

export function normalizeSiteSettingsRow(raw: Record<string, unknown> | null | undefined) {
  const row = raw ?? {}
  const homeName = typeof row.home_name === 'string' ? row.home_name.trim().slice(0, 12) : ''
  const plaqueTitle = typeof row.plaque_title === 'string' ? row.plaque_title.trim().slice(0, 16) : ''
  const plaqueSubtitle = typeof row.plaque_subtitle === 'string' ? row.plaque_subtitle.trim().slice(0, 32) : ''
  const yardHeading = typeof row.yard_heading === 'string' ? row.yard_heading.trim().slice(0, 20) : ''
  const yardSubtitle = typeof row.yard_subtitle === 'string' ? row.yard_subtitle.trim().slice(0, 80) : ''
  const defaultAtmosphere = typeof row.default_atmosphere === 'string' && VALID_ATMOSPHERES.has(row.default_atmosphere)
    ? row.default_atmosphere
    : DEFAULT_SITE_SETTINGS.defaultAtmosphere
  const defaultWeather = typeof row.default_weather === 'string' && VALID_WEATHERS.has(row.default_weather)
    ? row.default_weather
    : DEFAULT_SITE_SETTINGS.defaultWeather
  return {
    homeName: homeName || DEFAULT_SITE_SETTINGS.homeName,
    plaqueTitle: plaqueTitle || DEFAULT_SITE_SETTINGS.plaqueTitle,
    plaqueSubtitle: plaqueSubtitle || DEFAULT_SITE_SETTINGS.plaqueSubtitle,
    yardHeading: yardHeading || DEFAULT_SITE_SETTINGS.yardHeading,
    yardSubtitle: yardSubtitle || DEFAULT_SITE_SETTINGS.yardSubtitle,
    defaultAtmosphere,
    defaultWeather,
  }
}

export async function parseJsonBody<T extends Record<string, unknown>>(req: Request): Promise<T> {
  try {
    const parsed = await req.json()
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, '请求体必须是 JSON 对象')
    }
    return parsed as T
  } catch (err) {
    if (err instanceof HttpError) throw err
    throw new HttpError(400, '请求 JSON 格式不合法')
  }
}

export function errorResponse(err: unknown, req?: Request): Response {
  if (err instanceof HttpError) {
    if (err.detail) {
      console.error(`[CMS Edge Error ${err.status}] ${err.message}:`, err.detail)
    }
    return jsonResponse({ error: err.message }, err.status, req)
  }
  console.error('[CMS Edge Unhandled Error]:', err)
  return jsonResponse({ error: '服务器错误，请稍后重试' }, 500, req)
}

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
      const label = typeof item?.label === 'string' ? item.label.trim().slice(0, 40) : ''
      const url = typeof item?.url === 'string' ? item.url.trim().slice(0, 500) : ''
      return { label, url }
    })
    .filter((item) => item.label && isValidHttpUrl(item.url))
}
