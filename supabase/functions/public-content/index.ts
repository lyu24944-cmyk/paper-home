import { handlePreflight, jsonResponse } from '../_shared/cors.ts'
import {
  cleanContactLinks,
  cleanShortLines,
  createAdminClient,
  errorResponse,
  HttpError,
  isValidHttpUrl,
  normalizeSiteSettingsRow,
  signAssets,
} from '../_shared/supabase.ts'

Deno.serve(async (req) => {
  const preflight = handlePreflight(req)
  if (preflight) return preflight

  try {
    if (req.method !== 'GET') {
      throw new HttpError(405, '仅支持 GET 请求')
    }

    const admin = createAdminClient()

    const [projRes, noteRes, profRes, settingsRes] = await Promise.all([
      admin
        .from('projects')
        .select('id, slug, sort_order, published_at, published_snapshot')
        .eq('is_published', true)
        .not('published_snapshot', 'is', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin
        .from('notes')
        .select('id, slug, sort_order, published_at, published_snapshot')
        .eq('is_published', true)
        .not('published_snapshot', 'is', null)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true }),
      admin
        .from('site_profile')
        .select('is_published, published_at, published_snapshot')
        .eq('id', 'owner')
        .maybeSingle(),
      admin
        .from('site_settings')
        .select('*')
        .eq('id', 'main')
        .maybeSingle(),
    ])

    if (projRes.error) throw new HttpError(500, '读取作品失败', projRes.error.message)
    if (noteRes.error) throw new HttpError(500, '读取手记失败', noteRes.error.message)
    if (profRes.error) throw new HttpError(500, '读取关于我失败', profRes.error.message)

    const imageAssetIds: string[] = []
    const projects = (projRes.data ?? []).map((row) => {
      const snap = row.published_snapshot as Record<string, unknown>
      const coverAssetId = typeof snap.cover_asset_id === 'string' ? snap.cover_asset_id : null
      const galleryAssetIds = Array.isArray(snap.gallery_asset_ids)
        ? snap.gallery_asset_ids.filter((x): x is string => typeof x === 'string')
        : []
      const videoAssetId = typeof snap.video_asset_id === 'string' ? snap.video_asset_id : null
      const rawDemoUrl = String(snap.demo_url ?? '').trim()

      if (coverAssetId) imageAssetIds.push(coverAssetId)
      imageAssetIds.push(...galleryAssetIds)

      return {
        id: row.id as string,
        slug: row.slug as string,
        sortOrder: row.sort_order as number,
        publishedAt: (snap.published_at as string | undefined) ?? (row.published_at as string | null),
        title: String(snap.title ?? ''),
        summary: String(snap.summary ?? ''),
        body: String(snap.body ?? ''),
        demoUrl: isValidHttpUrl(rawDemoUrl) ? rawDemoUrl : '',
        coverAssetId,
        galleryAssetIds,
        videoAssetId,
      }
    })

    const publishedProjectIds = new Set(projects.map((p) => p.id))

    const notes = (noteRes.data ?? []).map((row) => {
      const snap = row.published_snapshot as Record<string, unknown>
      const rawProjId = typeof snap.project_id === 'string' ? snap.project_id : null
      const imageIds = Array.isArray(snap.image_asset_ids)
        ? snap.image_asset_ids.filter((x): x is string => typeof x === 'string')
        : []
      const videoAssetId = typeof snap.video_asset_id === 'string' ? snap.video_asset_id : null

      imageAssetIds.push(...imageIds)

      return {
        id: row.id as string,
        slug: row.slug as string,
        sortOrder: row.sort_order as number,
        publishedAt: (snap.published_at as string | undefined) ?? (row.published_at as string | null),
        title: String(snap.title ?? ''),
        body: String(snap.body ?? ''),
        projectId: rawProjId && publishedProjectIds.has(rawProjId) ? rawProjId : null,
        imageAssetIds: imageIds,
        videoAssetId,
      }
    })

    let profile: Record<string, unknown> | null = null
    if (profRes.data?.is_published && profRes.data.published_snapshot) {
      const snap = profRes.data.published_snapshot as Record<string, unknown>
      const avatarAssetId = typeof snap.avatar_asset_id === 'string' ? snap.avatar_asset_id : null
      if (avatarAssetId) imageAssetIds.push(avatarAssetId)

      const displayName = String(snap.display_name ?? '').trim()
      const bio = String(snap.bio ?? '').trim()
      const focusAreas = String(snap.focus_areas ?? '').trim()
      const contactEmail = String(snap.contact_email ?? '').trim()
      const contactLinks = cleanContactLinks(snap.contact_links)
      const nowNotes = cleanShortLines(snap.now_notes, 3, 36)
      const quotes = cleanShortLines(snap.quotes, 8, 120)

      if (
        displayName ||
        bio ||
        focusAreas ||
        avatarAssetId ||
        contactEmail ||
        contactLinks.length > 0 ||
        nowNotes.length > 0 ||
        quotes.length > 0
      ) {
        profile = {
          displayName,
          bio,
          focusAreas,
          avatarAssetId,
          contactEmail,
          contactLinks,
          nowNotes,
          quotes,
          publishedAt: (snap.published_at as string | undefined) ?? profRes.data.published_at ?? null,
        }
      }
    }

    const siteSettings = normalizeSiteSettingsRow(
      settingsRes.error ? null : (settingsRes.data as Record<string, unknown> | null),
    )

    // Never sign video paths during initial public fetch; videos are lazy-signed on user play click.
    const signedUrls = await signAssets(admin, imageAssetIds, { allowedKinds: ['image'] })

    return jsonResponse({ projects, notes, profile, siteSettings, signedUrls }, 200, req)
  } catch (err) {
    return errorResponse(err, req)
  }
})
