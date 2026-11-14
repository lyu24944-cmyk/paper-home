import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let val = trimmed.slice(eq + 1).trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (!process.env[key]) process.env[key] = val
  }
}

loadEnvFile(path.join(rootDir, '.env.local'))
loadEnvFile(path.join(rootDir, '.env'))

const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
const adminEmail = (process.env.ADMIN_EMAIL || '').trim()
const adminPassword = process.env.ADMIN_PASSWORD || ''
const forceOverwrite = process.argv.includes('--force')

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY in environment or .env.local.')
  process.exit(1)
}

if (!adminEmail) {
  console.error('Missing ADMIN_EMAIL. Provide the owner account email so uploaded seed assets belong to the admin user.')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function ensureAdminUser() {
  let page = 1
  let user = null
  while (!user) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    user = data.users.find((u) => (u.email || '').toLowerCase() === adminEmail.toLowerCase()) || null
    if (user || data.users.length < 100) break
    page += 1
  }

  if (!user) {
    if (!adminPassword) {
      console.error(
        `User ${adminEmail} does not exist in Supabase Auth yet. Either create it in Supabase Dashboard (with signup disabled) or pass ADMIN_PASSWORD to create it now.`,
      )
      process.exit(1)
    }
    const { data, error } = await supabase.auth.admin.createUser({
      email: adminEmail,
      password: adminPassword,
      email_confirm: true,
    })
    if (error || !data.user) throw error || new Error('Failed to create admin user')
    user = data.user
    console.log(`Created Auth user: ${user.email} (${user.id})`)
  }

  const { error: adminInsertErr } = await supabase
    .from('admin_users')
    .upsert({ user_id: user.id }, { onConflict: 'user_id' })
  if (adminInsertErr) throw adminInsertErr
  console.log(`Verified admin_users entry for ${user.email} (${user.id})`)
  return user
}

async function main() {
  const adminUser = await ensureAdminUser()
  const seed = JSON.parse(fs.readFileSync(path.join(rootDir, 'seed', 'initial-content.json'), 'utf8'))

  for (const asset of seed.assets) {
    const displayAbs = path.join(rootDir, asset.displayFile)
    if (!fs.existsSync(displayAbs)) {
      throw new Error(`Missing prepared seed media file: ${displayAbs}`)
    }
    const ext = asset.kind === 'video' ? (asset.mimeType === 'video/webm' ? 'webm' : 'mp4') : 'webp'
    const displayPath = `${asset.kind}s/${asset.id}/${asset.kind === 'video' ? `video.${ext}` : `display.${ext}`}`
    const displayBuf = fs.readFileSync(displayAbs)

    const { error: upErr } = await supabase.storage
      .from('cottage-media')
      .upload(displayPath, displayBuf, {
        contentType: asset.mimeType,
        upsert: true,
        cacheControl: '3600',
      })
    if (upErr) throw upErr

    let thumbPath = null
    if (asset.thumbFile) {
      const thumbAbs = path.join(rootDir, asset.thumbFile)
      if (!fs.existsSync(thumbAbs)) throw new Error(`Missing thumb file: ${thumbAbs}`)
      thumbPath = `images/${asset.id}/thumb.webp`
      const { error: thumbErr } = await supabase.storage
        .from('cottage-media')
        .upload(thumbPath, fs.readFileSync(thumbAbs), {
          contentType: 'image/webp',
          upsert: true,
          cacheControl: '3600',
        })
      if (thumbErr) throw thumbErr
    }

    const { error: dbErr } = await supabase.from('media_assets').upsert(
      {
        id: asset.id,
        kind: asset.kind,
        status: 'ready',
        display_path: displayPath,
        thumb_path: thumbPath,
        mime_type: asset.mimeType,
        byte_size: displayBuf.byteLength,
        width: asset.width,
        height: asset.height,
        duration_sec: asset.durationSec,
        original_filename: asset.originalFilename,
        created_by: adminUser.id,
      },
      { onConflict: 'id' },
    )
    if (dbErr) throw dbErr
    console.log(`Uploaded & registered asset: ${asset.originalFilename} (${(displayBuf.byteLength / 1024).toFixed(1)} KB)`)
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
