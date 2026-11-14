import { getSupabaseClient, isCloudConfigured, supabaseAnonKey, supabaseUrl } from './supabase'
import {
  getBackendMode,
  getLocalHeaders,
  resolveBackendHealth,
  setLocalOwnerActive,
} from './backend'
import {
  ApiError,
  ConflictError,
  type AdminCottageData,
  type AdminNote,
  type AdminProfile,
  type AdminProject,
  type ContactLink,
  type MediaAsset,
  type NotePayload,
  type ProfilePayload,
  type ProjectPayload,
  type PublicCottageData,
  type SignedMediaEntry,
  type SiteSettingsPayload,
} from '../types/content'

function cleanLinks(raw: unknown): ContactLink[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => ({
      label: typeof item?.label === 'string' ? item.label.trim() : '',
      url: typeof item?.url === 'string' ? item.url.trim() : '',
    }))
    .filter((item) => item.label && item.url)
}

function cleanStringList(raw: unknown, maxItems = 8, maxLen = 120): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => (typeof item === 'string' ? item.trim().slice(0, maxLen) : ''))
    .filter(Boolean)
    .slice(0, maxItems)
}

export function normalizeAdminProject(row: Record<string, unknown>): AdminProject {
  if ('draft' in row && row.draft && typeof row.draft === 'object') {
    return row as unknown as AdminProject
  }
  const pub = (row.published_snapshot as Record<string, unknown> | null) ?? null
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    isPublished: Boolean(row.is_published),
    publishedAt: (row.published_at as string | null) ?? null,
    hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
    version: Number(row.version ?? 1),
    updatedAt: String(row.updated_at ?? ''),
    draft: {
      title: String(row.draft_title ?? ''),
      summary: String(row.draft_summary ?? ''),
      body: String(row.draft_body ?? ''),
      demoUrl: String(row.draft_demo_url ?? ''),
      coverAssetId: (row.draft_cover_asset_id as string | null) ?? null,
      galleryAssetIds: Array.isArray(row.draft_gallery_asset_ids) ? (row.draft_gallery_asset_ids as string[]) : [],
      videoAssetId: (row.draft_video_asset_id as string | null) ?? null,
    },
    published: pub
      ? {
          title: String(pub.title ?? ''),
          summary: String(pub.summary ?? ''),
          body: String(pub.body ?? ''),
          demoUrl: String(pub.demo_url ?? ''),
          coverAssetId: (pub.cover_asset_id as string | null) ?? null,
          galleryAssetIds: Array.isArray(pub.gallery_asset_ids) ? (pub.gallery_asset_ids as string[]) : [],
          videoAssetId: (pub.video_asset_id as string | null) ?? null,
          publishedAt: (pub.published_at as string | null) ?? (row.published_at as string | null) ?? null,
        }
      : null,
  }
}

export function normalizeAdminNote(row: Record<string, unknown>): AdminNote {
  if ('draft' in row && row.draft && typeof row.draft === 'object') {
    return row as unknown as AdminNote
  }
  const pub = (row.published_snapshot as Record<string, unknown> | null) ?? null
  return {
    id: String(row.id),
    slug: String(row.slug ?? ''),
    sortOrder: Number(row.sort_order ?? 0),
    isPublished: Boolean(row.is_published),
    publishedAt: (row.published_at as string | null) ?? null,
    hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
    version: Number(row.version ?? 1),
    updatedAt: String(row.updated_at ?? ''),
    draft: {
      title: String(row.draft_title ?? ''),
      body: String(row.draft_body ?? ''),
      projectId: (row.draft_project_id as string | null) ?? null,
      imageAssetIds: Array.isArray(row.draft_image_asset_ids) ? (row.draft_image_asset_ids as string[]) : [],
      videoAssetId: (row.draft_video_asset_id as string | null) ?? null,
    },
    published: pub
      ? {
          title: String(pub.title ?? ''),
          body: String(pub.body ?? ''),
          projectId: (pub.project_id as string | null) ?? null,
          imageAssetIds: Array.isArray(pub.image_asset_ids) ? (pub.image_asset_ids as string[]) : [],
          videoAssetId: (pub.video_asset_id as string | null) ?? null,
          publishedAt: (pub.published_at as string | null) ?? (row.published_at as string | null) ?? null,
        }
      : null,
  }
}

export function normalizeAdminProfile(row: Record<string, unknown>): AdminProfile {
  if ('draft' in row && row.draft && typeof row.draft === 'object') {
    return row as unknown as AdminProfile
  }
  const pub = (row.published_snapshot as Record<string, unknown> | null) ?? null
  return {
    isPublished: Boolean(row.is_published),
    publishedAt: (row.published_at as string | null) ?? null,
    hasUnpublishedChanges: Boolean(row.has_unpublished_changes),
    version: Number(row.version ?? 1),
    updatedAt: String(row.updated_at ?? ''),
    draft: {
      displayName: String(row.draft_display_name ?? ''),
      bio: String(row.draft_bio ?? ''),
      focusAreas: String(row.draft_focus_areas ?? ''),
      avatarAssetId: (row.draft_avatar_asset_id as string | null) ?? null,
      contactEmail: String(row.draft_contact_email ?? ''),
      contactLinks: cleanLinks(row.draft_contact_links),
      nowNotes: cleanStringList(row.draft_now_notes, 3, 36),
      quotes: cleanStringList(row.draft_quotes, 8, 120),
    },
    published: pub
      ? {
          displayName: String(pub.display_name ?? ''),
          bio: String(pub.bio ?? ''),
          focusAreas: String(pub.focus_areas ?? ''),
          avatarAssetId: (pub.avatar_asset_id as string | null) ?? null,
          contactEmail: String(pub.contact_email ?? ''),
          contactLinks: cleanLinks(pub.contact_links),
          nowNotes: cleanStringList(pub.now_notes ?? pub.nowNotes, 3, 36),
          quotes: cleanStringList(pub.quotes, 8, 120),
          publishedAt: (pub.published_at as string | null) ?? (row.published_at as string | null) ?? null,
        }
      : null,
  }
}

async function getAccessToken(): Promise<string> {
  const client = getSupabaseClient()
  const { data, error } = await client.auth.getSession()
  if (error || !data.session?.access_token) {
    throw new ApiError(401, '未登录或登录状态已过期，请先登录主人账号。', 'UNAUTHORIZED')
  }
  return data.session.access_token
}

let snapshotPromise: Promise<PublicCottageData> | null = null

async function fetchStaticSnapshot(): Promise<PublicCottageData> {
  if (!snapshotPromise) {
    snapshotPromise = (async () => {
      const res = await fetch('./local-snapshot/cottage.json', { cache: 'no-store' })
      if (!res.ok) {
        throw new ApiError(res.status, '静态小屋快照文件读取失败。', 'SNAPSHOT_ERROR')
      }
      return (await res.json()) as PublicCottageData
    })()
  }
  return await snapshotPromise
}

async function callFunction<T>(
  name: string,
  options: { method?: 'GET' | 'POST'; body?: unknown; requireAuth?: boolean } = {},
): Promise<T> {
  const mode = await getBackendMode()

  if (mode === 'unconfigured-readonly') {
    if (name === 'public-content') {
      return { projects: [], notes: [], profile: null, signedUrls: {} } as T
    }
    if (name === 'media-sign') {
      const ids = Array.isArray((options.body as { assetIds?: unknown })?.assetIds)
        ? ((options.body as { assetIds: string[] }).assetIds)
        : []
      return { signedUrls: {}, deniedIds: ids } as T
    }
    throw new ApiError(503, '尚未配置云端服务或本地工作室，当前为只读展示状态。', 'UNCONFIGURED')
  }

  if (mode === 'static-snapshot') {
    if (name === 'public-content') {
      return (await fetchStaticSnapshot()) as T
    }
    if (name === 'media-sign') {
      const snap = await fetchStaticSnapshot()
      const ids = Array.isArray((options.body as { assetIds?: unknown })?.assetIds)
        ? ((options.body as { assetIds: string[] }).assetIds)
        : []
      const signedUrls: Record<string, SignedMediaEntry> = {}
      const deniedIds: string[] = []
      for (const id of ids) {
        if (snap.signedUrls?.[id]) signedUrls[id] = snap.signedUrls[id]
        else deniedIds.push(id)
      }
      return { signedUrls, deniedIds } as T
    }
    throw new ApiError(
      403,
      '当前为纯静态快照展示版，仅供浏览；如需编辑，请在本机运行 npm run dev。',
      'READONLY_SNAPSHOT',
    )
  }

  let endpoint: string
  let headers: Record<string, string>
  if (mode === 'local-studio') {
    endpoint = `/__local-cms/${name}`
    headers = {
      ...(options.requireAuth ? getLocalHeaders() : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }
  } else {
    const token = options.requireAuth ? await getAccessToken() : supabaseAnonKey
    endpoint = `${supabaseUrl}/functions/v1/${name}`
    headers = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    }
  }

  let response: Response
  try {
    response = await fetch(endpoint, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    })
  } catch {
    throw new ApiError(
      0,
      mode === 'local-studio'
        ? '无法连接本地工作室存储服务（请确认 Vite 开发服务正在运行），当前输入已保留。'
        : '网络连接中断或无法访问云端服务，当前输入已保留，请检查网络后重试。',
      'NETWORK_ERROR',
    )
  }

  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (response.status === 409) {
    throw new ConflictError(
      String(data.error ?? '内容已被另一窗口或设备修改。'),
      data.latest ?? null,
      typeof data.order_version === 'number' ? data.order_version : undefined,
      Array.isArray(data.latest_order) ? (data.latest_order as string[]) : undefined,
    )
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      String(data.error ?? `请求失败（${response.status}）`),
      typeof data.code === 'string' ? data.code : undefined,
      data.detail,
    )
  }

  return data as T
}

export async function signInAdmin(email: string, password: string) {
  const client = getSupabaseClient()
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password })
  if (error || !data.session) {
    throw new ApiError(401, error?.message || '邮箱或密码不正确，请重试。', 'AUTH_FAILED')
  }
  return data.session
}

export async function enterLocalOwnerMode(): Promise<string> {
  const health = await resolveBackendHealth(true)
  if (health.mode !== 'local-studio') {
    throw new ApiError(503, '当前未检测到本地工作室写入服务（请通过 npm run dev 打开）。', 'UNCONFIGURED')
  }
  if (!health.writable) {
    throw new ApiError(403, '为保护本机文件安全，仅本机（127.0.0.1 / localhost）允许开启本地编辑模式。', 'FORBIDDEN')
  }
  setLocalOwnerActive(true)
  return '本地主人（本机保存）'
}

export async function signOutAdmin() {
  const mode = await getBackendMode()
  if (mode === 'local-studio') {
    setLocalOwnerActive(false)
    return
  }
  if (!isCloudConfigured) return
  const client = getSupabaseClient()
  await client.auth.signOut()
}

export async function fetchPublicCottage(): Promise<PublicCottageData> {
  return await callFunction<PublicCottageData>('public-content', { method: 'GET', requireAuth: false })
}

export async function fetchAdminCottage(): Promise<AdminCottageData> {
  return await callFunction<AdminCottageData>('admin-content', { method: 'GET', requireAuth: true })
}

export async function signMediaUrlsApi(
  assetIds: string[],
  scope: 'public' | 'admin',
): Promise<{ signedUrls: Record<string, SignedMediaEntry>; deniedIds: string[] }> {
  return await callFunction<{ signedUrls: Record<string, SignedMediaEntry>; deniedIds: string[] }>('media-sign', {
    method: 'POST',
    body: { assetIds, scope },
    requireAuth: scope === 'admin',
  })
}

export async function registerMediaAssetApi(payload: {
  assetId: string
  kind: 'image' | 'video'
  displayPath: string
  thumbPath: string | null
  mimeType: string
  byteSize: number
  width: number | null
  height: number | null
  durationSec: number | null
  originalFilename: string
}): Promise<MediaAsset> {
  const res = await callFunction<{ ok: true; asset: MediaAsset }>('admin-mutate', {
    method: 'POST',
    body: { action: 'media.register', payload },
    requireAuth: true,
  })
  return res.asset
}

export async function cleanupMediaAssetsApi(options: {
  candidateAssetIds?: string[]
  sweepOrphans?: boolean
}): Promise<{ cleaned: number; remaining: number; errors: string[] }> {
  return await callFunction('media-cleanup', {
    method: 'POST',
    body: options,
    requireAuth: true,
  })
}

async function mutateAndNormalize<T>(
  action: string,
  payload: Record<string, unknown>,
  normalizer?: (raw: Record<string, unknown>) => T,
): Promise<{ item?: T; orderVersion?: number; pendingCleanupCount: number }> {
  try {
    const res = await callFunction<Record<string, unknown>>('admin-mutate', {
      method: 'POST',
      body: { action, payload },
      requireAuth: true,
    })
    const rawItem = (res.project ?? res.note ?? res.profile) as Record<string, unknown> | undefined
    return {
      item: rawItem && normalizer ? normalizer(rawItem) : undefined,
      orderVersion: typeof res.order_version === 'number' ? res.order_version : undefined,
      pendingCleanupCount: Number(res.pendingCleanupCount ?? 0),
    }
  } catch (err) {
    if (err instanceof ConflictError && err.latest && normalizer) {
      throw new ConflictError(
        err.message,
        normalizer(err.latest as Record<string, unknown>),
        err.orderVersion,
        err.latestOrder,
      )
    }
    throw err
  }
}

export function saveProjectDraftApi(
  id: string | null,
  expectedVersion: number,
  draft: ProjectPayload & { slug?: string },
) {
  return mutateAndNormalize<AdminProject>(
    'project.save_draft',
    { id, expectedVersion, ...draft },
    normalizeAdminProject,
  )
}

export function publishProjectApi(id: string, expectedVersion: number) {
  return mutateAndNormalize<AdminProject>(
    'project.publish',
    { id, expectedVersion },
    normalizeAdminProject,
  )
}

export function unpublishProjectApi(id: string, expectedVersion: number) {
  return mutateAndNormalize<AdminProject>(
    'project.unpublish',
    { id, expectedVersion },
    normalizeAdminProject,
  )
}

export function deleteProjectApi(id: string, expectedVersion: number) {
  return mutateAndNormalize('project.delete', { id, expectedVersion })
}

export function reorderProjectsApi(orderedIds: string[], expectedOrderVersion: number) {
  return mutateAndNormalize('project.reorder', { orderedIds, expectedOrderVersion })
}

export function saveNoteDraftApi(
  id: string | null,
  expectedVersion: number,
  draft: NotePayload & { slug?: string },
) {
  return mutateAndNormalize<AdminNote>(
    'note.save_draft',
    { id, expectedVersion, ...draft },
    normalizeAdminNote,
  )
}

export function publishNoteApi(id: string, expectedVersion: number) {
  return mutateAndNormalize<AdminNote>('note.publish', { id, expectedVersion }, normalizeAdminNote)
}

export function unpublishNoteApi(id: string, expectedVersion: number) {
  return mutateAndNormalize<AdminNote>('note.unpublish', { id, expectedVersion }, normalizeAdminNote)
}

export function deleteNoteApi(id: string, expectedVersion: number) {
  return mutateAndNormalize('note.delete', { id, expectedVersion })
}

export function reorderNotesApi(orderedIds: string[], expectedOrderVersion: number) {
  return mutateAndNormalize('note.reorder', { orderedIds, expectedOrderVersion })
}

export function saveProfileDraftApi(expectedVersion: number, draft: ProfilePayload) {
  return mutateAndNormalize<AdminProfile>(
    'profile.save_draft',
    { expectedVersion, ...draft },
    normalizeAdminProfile,
  )
}

export function publishProfileApi(expectedVersion: number) {
  return mutateAndNormalize<AdminProfile>('profile.publish', { expectedVersion }, normalizeAdminProfile)
}

export function unpublishProfileApi(expectedVersion: number) {
  return mutateAndNormalize<AdminProfile>('profile.unpublish', { expectedVersion }, normalizeAdminProfile)
}

export async function saveSiteSettingsApi(
  expectedVersion: number | undefined,
  settings: SiteSettingsPayload,
): Promise<{ siteSettings: SiteSettingsPayload; siteSettingsVersion: number }> {
  return await callFunction<{ ok: true; siteSettings: SiteSettingsPayload; siteSettingsVersion: number }>(
    'admin-mutate',
    {
      method: 'POST',
      body: {
        action: 'settings.save',
        payload: { expectedVersion, ...settings },
      },
      requireAuth: true,
    },
  )
}

export async function initLocalSampleApi(force = false) {
  return await callFunction<{ ok: true; skipped?: boolean; reason?: string }>('init-sample', {
    method: 'POST',
    body: { force },
    requireAuth: true,
  })
}
