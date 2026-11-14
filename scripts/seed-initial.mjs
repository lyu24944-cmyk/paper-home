import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createAdminSupabaseFromEnv,
  ensureAdminUser,
  uploadMediaAndRegister,
} from './supabase-admin-helper.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')
const forceOverwrite = process.argv.includes('--force')

async function main() {
  const { supabase, adminEmail, adminPassword } = createAdminSupabaseFromEnv(rootDir)
  const adminUser = await ensureAdminUser(supabase, adminEmail, adminPassword)
  const seed = JSON.parse(fs.readFileSync(path.join(rootDir, 'seed', 'initial-content.json'), 'utf8'))

  for (const asset of seed.assets) {
    const bytes = await uploadMediaAndRegister(supabase, adminUser.id, {
      id: asset.id,
      kind: asset.kind,
      mimeType: asset.mimeType,
      displayAbsPath: path.join(rootDir, asset.displayFile),
      thumbAbsPath: asset.thumbFile ? path.join(rootDir, asset.thumbFile) : null,
      width: asset.width,
      height: asset.height,
      durationSec: asset.durationSec,
      originalFilename: asset.originalFilename,
    })
    console.log(`Uploaded & registered asset: ${asset.originalFilename} (${(bytes / 1024).toFixed(1)} KB)`)
  }

  for (const project of seed.projects) {
    const { data: existing } = await supabase
      .from('projects')
      .select('id')
      .eq('slug', project.slug)
      .maybeSingle()

    if (existing && !forceOverwrite) {
      console.log(`Skipped existing project draft (use --force to overwrite): ${project.title}`)
      continue
    }

    const { error } = await supabase.from('projects').upsert(
      {
        id: existing?.id ?? project.id,
        slug: project.slug,
        sort_order: project.sortOrder,
        is_published: false,
        has_unpublished_changes: true,
        draft_title: project.title,
        draft_summary: project.summary,
        draft_body: project.body,
        draft_demo_url: project.demoUrl,
        draft_cover_asset_id: project.coverAssetId,
        draft_gallery_asset_ids: project.galleryAssetIds,
        draft_video_asset_id: project.videoAssetId,
      },
      { onConflict: 'slug' },
    )
    if (error) throw error
    console.log(`Seeded project draft: ${project.title}`)
  }

  for (const note of seed.notes) {
    const { data: existing } = await supabase
      .from('notes')
      .select('id')
      .eq('slug', note.slug)
      .maybeSingle()

    if (existing && !forceOverwrite) {
      console.log(`Skipped existing note draft (use --force to overwrite): ${note.title}`)
      continue
    }

    const { error } = await supabase.from('notes').upsert(
      {
        id: existing?.id ?? note.id,
        slug: note.slug,
        sort_order: note.sortOrder,
        is_published: false,
        has_unpublished_changes: true,
        draft_title: note.title,
        draft_body: note.body,
        draft_project_id: note.projectId,
        draft_image_asset_ids: note.imageAssetIds,
        draft_video_asset_id: note.videoAssetId,
      },
      { onConflict: 'slug' },
    )
    if (error) throw error
    console.log(`Seeded note draft: ${note.title}`)
  }

  console.log('\nDone! All initial content has been seeded as DRAFTS (is_published = false).')
  console.log('Log in inside the app ("小屋地图 -> 主人登录") to preview and publish them room by room.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
