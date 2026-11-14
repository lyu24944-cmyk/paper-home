import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createLocalCmsStore } from './local-cms-store.mjs'
import {
  createAdminSupabaseFromEnv,
  ensureAdminUser,
  uploadMediaAndRegister,
} from './supabase-admin-helper.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const asDrafts = process.argv.includes('--as-drafts')
const forceOverwrite = process.argv.includes('--force')

function toProjectSnapshotRow(pub) {
  if (!pub) return null
  return {
    title: pub.title,
    summary: pub.summary,
    body: pub.body,
    demo_url: pub.demoUrl || '',
    cover_asset_id: pub.coverAssetId ?? null,
    gallery_asset_ids: Array.isArray(pub.galleryAssetIds) ? pub.galleryAssetIds : [],
    video_asset_id: pub.videoAssetId ?? null,
    published_at: pub.publishedAt ?? new Date().toISOString(),
  }
}

function toNoteSnapshotRow(pub) {
  if (!pub) return null
  return {
    title: pub.title,
    body: pub.body,
    project_id: pub.projectId ?? null,
    image_asset_ids: Array.isArray(pub.imageAssetIds) ? pub.imageAssetIds : [],
    video_asset_id: pub.videoAssetId ?? null,
    published_at: pub.publishedAt ?? new Date().toISOString(),
  }
}

function toProfileSnapshotRow(pub) {
  if (!pub) return null
  return {
    display_name: pub.displayName || '',
    bio: pub.bio || '',
    focus_areas: pub.focusAreas || '',
    avatar_asset_id: pub.avatarAssetId ?? null,
    contact_email: pub.contactEmail || '',
    contact_links: Array.isArray(pub.contactLinks) ? pub.contactLinks : [],
    published_at: pub.publishedAt ?? new Date().toISOString(),
  }
}

async function main() {
  const store = createLocalCmsStore(rootDir)
  if (!fs.existsSync(store.cottagePath)) {
    throw new Error('未找到 local-data/cottage.json，请先在本地工作室添加并保存内容后再同步到云端。')
  }

  const db = store.readDb()
  const { supabase, adminEmail, adminPassword } = createAdminSupabaseFromEnv(rootDir)
  const adminUser = await ensureAdminUser(supabase, adminEmail, adminPassword)

  for (const asset of Object.values(db.assets)) {
    if (!asset || asset.status !== 'ready') continue
    const bytes = await uploadMediaAndRegister(supabase, adminUser.id, {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      displayAbsPath: path.join(store.mediaDir, asset.displayPath),
      thumbAbsPath: asset.thumbPath ? path.join(store.mediaDir, asset.thumbPath) : null,
      width: asset.width ?? null,
      height: asset.height ?? null,
      durationSec: asset.durationSec ?? null,
      originalFilename: asset.originalFilename ?? null,
    })
    console.log(`Synced asset ${asset.id} (${(bytes / 1024).toFixed(1)} KB)`)
  }

  for (const project of db.projects) {
    const { data: existing } = await supabase.from('projects').select('id').eq('slug', project.slug).maybeSingle()
    if (existing && !forceOverwrite) {
      console.log(`Skipped existing project (${project.slug}); pass --force to overwrite.`)
      continue
    }
    const publishItem = !asDrafts && Boolean(project.isPublished && project.published)
    const { error } = await supabase.from('projects').upsert(
      {
        id: existing?.id ?? project.id,
        slug: project.slug,
        sort_order: project.sortOrder,
        is_published: publishItem,
        published_at: publishItem ? (project.publishedAt ?? new Date().toISOString()) : null,
        has_unpublished_changes: publishItem ? Boolean(project.hasUnpublishedChanges) : true,
        draft_title: project.draft.title,
        draft_summary: project.draft.summary,
        draft_body: project.draft.body,
        draft_demo_url: project.draft.demoUrl || '',
        draft_cover_asset_id: project.draft.coverAssetId ?? null,
        draft_gallery_asset_ids: project.draft.galleryAssetIds ?? [],
        draft_video_asset_id: project.draft.videoAssetId ?? null,
        published_snapshot: publishItem ? toProjectSnapshotRow(project.published) : null,
      },
      { onConflict: 'slug' },
    )
    if (error) throw error
    console.log(`Synced project: ${project.draft.title} [${publishItem ? 'published' : 'draft'}]`)
  }

  for (const note of db.notes) {
    const { data: existing } = await supabase.from('notes').select('id').eq('slug', note.slug).maybeSingle()
    if (existing && !forceOverwrite) {
      console.log(`Skipped existing note (${note.slug}); pass --force to overwrite.`)
      continue
    }
    const publishItem = !asDrafts && Boolean(note.isPublished && note.published)
    const { error } = await supabase.from('notes').upsert(
      {
        id: existing?.id ?? note.id,
        slug: note.slug,
        sort_order: note.sortOrder,
        is_published: publishItem,
        published_at: publishItem ? (note.publishedAt ?? new Date().toISOString()) : null,
        has_unpublished_changes: publishItem ? Boolean(note.hasUnpublishedChanges) : true,
        draft_title: note.draft.title,
        draft_body: note.draft.body,
        draft_project_id: note.draft.projectId ?? null,
        draft_image_asset_ids: note.draft.imageAssetIds ?? [],
        draft_video_asset_id: note.draft.videoAssetId ?? null,
        published_snapshot: publishItem ? toNoteSnapshotRow(note.published) : null,
      },
      { onConflict: 'slug' },
    )
    if (error) throw error
    console.log(`Synced note: ${note.draft.title} [${publishItem ? 'published' : 'draft'}]`)
  }

  const p = db.profile
  if (p) {
    const publishProfile = !asDrafts && Boolean(p.isPublished && p.published)
    const { error } = await supabase.from('site_profile').upsert(
      {
        id: 'owner',
        is_published: publishProfile,
        published_at: publishProfile ? (p.publishedAt ?? new Date().toISOString()) : null,
        has_unpublished_changes: publishProfile ? Boolean(p.hasUnpublishedChanges) : true,
        draft_display_name: p.draft.displayName || '',
        draft_bio: p.draft.bio || '',
        draft_focus_areas: p.draft.focusAreas || '',
        draft_avatar_asset_id: p.draft.avatarAssetId ?? null,
        draft_contact_email: p.draft.contactEmail || '',
        draft_contact_links: p.draft.contactLinks ?? [],
        published_snapshot: publishProfile ? toProfileSnapshotRow(p.published) : null,
      },
      { onConflict: 'id' },
    )
    if (error) throw error
    console.log(`Synced owner profile [${publishProfile ? 'published' : 'draft'}]`)
  }

  console.log('\n[sync:supabase] Done!')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
