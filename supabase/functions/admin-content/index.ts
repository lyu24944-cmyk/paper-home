import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  cleanContactLinks,
  cleanShortLines,
  createAdminClient,
  errorResponse,
  HttpError,
  normalizeSiteSettingsRow,
  requireAdmin,
  signAssets,
} from '../_shared/supabase.ts'

function collectIdsFromSnapshot(snap: Record<string, unknown> | null, kind: 'project' | 'note' | 'profile'): string[] {
  if (!snap) return []
  const ids: string[] = []
  if (kind === 'project') {
    if (typeof snap.cover_asset_id === 'string') ids.push(snap.cover_asset_id)
    if (Array.isArray(snap.gallery_asset_ids)) {
      for (const x of snap.gallery_asset_ids) if (typeof x === 'string') ids.push(x)
    }
  } else if (kind === 'note') {
    if (Array.isArray(snap.image_asset_ids)) {
      for (const x of snap.image_asset_ids) if (typeof x === 'string') ids.push(x)
    }
  } else if (typeof snap.avatar_asset_id === 'string') {
    ids.push(snap.avatar_asset_id)
  }
  return ids
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    if (req.method !== 'GET') {
      throw new HttpError(405, '仅支持 GET 请求')
    }

    const admin = createAdminClient()
    const user = await requireAdmin(req, admin)

    const [projRes, noteRes, profRes, settingsRes, stateRes, assetsRes, cleanupRes] = await Promise.all([
      admin
        .from('projects')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin
        .from('notes')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin.from('site_profile').select('*').eq('id', 'owner').maybeSingle(),
      admin.from('site_settings').select('*').eq('id', 'main').maybeSingle(),
      admin.from('collection_state').select('key, version'),
      admin.from('media_assets').select('id, kind, status, mime_type, byte_size, width, height, duration_sec, original_filename, created_at'),
      admin.from('media_cleanup_queue').select('id', { count: 'exact', head: true }),
    ])

    if (projRes.error) throw new HttpError(500, '读取作品管理列表失败', projRes.error.message)
    if (noteRes.error) throw new HttpError(500, '读取手记管理列表失败', noteRes.error.message)
    if (profRes.error) throw new HttpError(500, '读取个人资料失败', profRes.error.message)
    if (stateRes.error) throw new HttpError(500, '读取排序版本失败', stateRes.error.message)

    const imageIds: string[] = []

    const projects = (projRes.data ?? []).map((row) => {
      if (row.draft_cover_asset_id) imageIds.push(row.draft_cover_asset_id)
      if (Array.isArray(row.draft_gallery_asset_ids)) imageIds.push(...row.draft_gallery_asset_ids)
      const pub = row.published_snapshot as Record<string, unknown> | null
      imageIds.push(...collectIdsFromSnapshot(pub, 'project'))

      return {
        id: row.id,
        slug: row.slug,
        sortOrder: row.sort_order,
        isPublished: row.is_published,
        publishedAt: row.published_at,
        hasUnpublishedChanges: row.has_unpublished_changes,
        version: row.version,
        updatedAt: row.updated_at,
        draft: {
          title: row.draft_title,
          summary: row.draft_summary,
          body: row.draft_body,
          demoUrl: row.draft_demo_url,
          coverAssetId: row.draft_cover_asset_id,
          galleryAssetIds: row.draft_gallery_asset_ids ?? [],
          videoAssetId: row.draft_video_asset_id,
        },
        published: pub
          ? {
              title: String(pub.title ?? ''),
              summary: String(pub.summary ?? ''),
              body: String(pub.body ?? ''),
              demoUrl: String(pub.demo_url ?? ''),
              coverAssetId: (pub.cover_asset_id as string | null) ?? null,
              galleryAssetIds: Array.isArray(pub.gallery_asset_ids) ? pub.gallery_asset_ids : [],
              videoAssetId: (pub.video_asset_id as string | null) ?? null,
              publishedAt: (pub.published_at as string | null) ?? row.published_at,
            }
          : null,
      }
    })

    const notes = (noteRes.data ?? []).map((row) => {
      if (Array.isArray(row.draft_image_asset_ids)) imageIds.push(...row.draft_image_asset_ids)
      const pub = row.published_snapshot as Record<string, unknown> | null
      imageIds.push(...collectIdsFromSnapshot(pub, 'note'))

      return {
        id: row.id,
        slug: row.slug,
        sortOrder: row.sort_order,
        isPublished: row.is_published,
        publishedAt: row.published_at,
        hasUnpublishedChanges: row.has_unpublished_changes,
        version: row.version,
        updatedAt: row.updated_at,
        draft: {
          title: row.draft_title,
          body: row.draft_body,
          projectId: row.draft_project_id,
          imageAssetIds: row.draft_image_asset_ids ?? [],
          videoAssetId: row.draft_video_asset_id,
        },
        published: pub
          ? {
              title: String(pub.title ?? ''),
              body: String(pub.body ?? ''),
              projectId: (pub.project_id as string | null) ?? null,
              imageAssetIds: Array.isArray(pub.image_asset_ids) ? pub.image_asset_ids : [],
              videoAssetId: (pub.video_asset_id as string | null) ?? null,
              publishedAt: (pub.published_at as string | null) ?? row.published_at,
            }
          : null,
      }
    })

    const pRow = profRes.data
    const pPub = (pRow?.published_snapshot as Record<string, unknown> | null) ?? null
    if (pRow?.draft_avatar_asset_id) imageIds.push(pRow.draft_avatar_asset_id)
    imageIds.push(...collectIdsFromSnapshot(pPub, 'profile'))

    const profile = pRow
      ? {
          isPublished: pRow.is_published,
          publishedAt: pRow.published_at,
          hasUnpublishedChanges: pRow.has_unpublished_changes,
          version: pRow.version,
          updatedAt: pRow.updated_at,
          draft: {
            displayName: pRow.draft_display_name,
            bio: pRow.draft_bio,
            focusAreas: pRow.draft_focus_areas,
            avatarAssetId: pRow.draft_avatar_asset_id,
            contactEmail: pRow.draft_contact_email,
            contactLinks: cleanContactLinks(pRow.draft_contact_links),
            nowNotes: cleanShortLines((pRow as Record<string, unknown>).draft_now_notes, 3, 36),
            quotes: cleanShortLines((pRow as Record<string, unknown>).draft_quotes, 8, 120),
          },
          published: pPub
            ? {
                displayName: String(pPub.display_name ?? ''),
                bio: String(pPub.bio ?? ''),
                focusAreas: String(pPub.focus_areas ?? ''),
                avatarAssetId: (pPub.avatar_asset_id as string | null) ?? null,
                contactEmail: String(pPub.contact_email ?? ''),
                contactLinks: cleanContactLinks(pPub.contact_links),
                nowNotes: cleanShortLines(pPub.now_notes, 3, 36),
                quotes: cleanShortLines(pPub.quotes, 8, 120),
                publishedAt: (pPub.published_at as string | null) ?? pRow.published_at,
              }
            : null,
        }
      : null

    const siteSettings = normalizeSiteSettingsRow(
      settingsRes.error ? null : (settingsRes.data as Record<string, unknown> | null),
    )
    const siteSettingsVersion =
      !settingsRes.error && settingsRes.data && typeof settingsRes.data.version === 'number'
        ? settingsRes.data.version
        : 1

    const orderVersions = Object.fromEntries(
      (stateRes.data ?? []).map((s) => [s.key, s.version as number]),
    )

    const assets: Record<string, unknown> = {}
    for (const a of assetsRes.data ?? []) {
      assets[a.id] = {
        id: a.id,
        kind: a.kind,
        status: a.status,
        mimeType: a.mime_type,
        byteSize: a.byte_size,
        width: a.width,
        height: a.height,
        durationSec: a.duration_sec,
        originalFilename: a.original_filename,
        createdAt: a.created_at,
      }
    }

    const signedUrls = await signAssets(admin, imageIds, { allowedKinds: ['image'] })

    return jsonResponse(
      {
        adminUserId: user.id,
        projects,
        notes,
        profile,
        siteSettings,
        siteSettingsVersion,
        orderVersions: {
          projects: orderVersions.projects_order ?? 1,
          notes: orderVersions.notes_order ?? 1,
        },
        assets,
        signedUrls,
        pendingCleanupCount: cleanupRes.count ?? 0,
      },
      200,
      req,
    )
  } catch (err) {
    return errorResponse(err, req)
  }
})
