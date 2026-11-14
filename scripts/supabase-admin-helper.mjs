import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

export function loadEnvFile(filePath) {
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

export function createAdminSupabaseFromEnv(rootDir) {
  loadEnvFile(path.join(rootDir, '.env.local'))
  loadEnvFile(path.join(rootDir, '.env'))

  const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  const adminEmail = (process.env.ADMIN_EMAIL || '').trim()
  const adminPassword = process.env.ADMIN_PASSWORD || ''

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL (or VITE_SUPABASE_URL) and/or SUPABASE_SERVICE_ROLE_KEY in environment or .env.local.')
  }
  if (!adminEmail) {
    throw new Error('Missing ADMIN_EMAIL. Provide the owner account email so uploaded assets belong to the admin user.')
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { supabase, adminEmail, adminPassword }
}

export async function ensureAdminUser(supabase, adminEmail, adminPassword = '') {
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
      throw new Error(
        `User ${adminEmail} does not exist in Supabase Auth yet. Either create it in Supabase Dashboard (with signup disabled) or pass ADMIN_PASSWORD to create it now.`,
      )
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

export async function uploadMediaAndRegister(supabase, adminUserId, {
  id,
  kind,
  mimeType,
  displayAbsPath,
  thumbAbsPath,
  width = null,
  height = null,
  durationSec = null,
  originalFilename = null,
}) {
  if (!fs.existsSync(displayAbsPath)) {
    throw new Error(`Missing media file: ${displayAbsPath}`)
  }
  const ext = kind === 'video'
    ? (mimeType === 'video/webm' ? 'webm' : 'mp4')
    : (mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/png' ? 'png' : 'webp')
  const displayPath = `${kind}s/${id}/${kind === 'video' ? `demo.${ext}` : `display.${ext}`}`
  const displayBuf = fs.readFileSync(displayAbsPath)

  const { error: upErr } = await supabase.storage
    .from('cottage-media')
    .upload(displayPath, displayBuf, {
      contentType: mimeType,
      upsert: true,
      cacheControl: '3600',
    })
  if (upErr) throw upErr

  let thumbPath = null
  let thumbSize = 0
  if (thumbAbsPath && fs.existsSync(thumbAbsPath)) {
    const thumbExt = path.extname(thumbAbsPath).replace('.', '') || 'webp'
    const thumbMime = thumbExt === 'jpg' || thumbExt === 'jpeg' ? 'image/jpeg' : 'image/webp'
    const thumbBuf = fs.readFileSync(thumbAbsPath)
    thumbSize = thumbBuf.byteLength
    thumbPath = `images/${id}/thumb.${thumbExt}`
    const { error: thumbErr } = await supabase.storage
      .from('cottage-media')
      .upload(thumbPath, thumbBuf, {
        contentType: thumbMime,
        upsert: true,
        cacheControl: '3600',
      })
    if (thumbErr) throw thumbErr
  }

  const { error: dbErr } = await supabase.from('media_assets').upsert(
    {
      id,
      kind,
      status: 'ready',
      display_path: displayPath,
      thumb_path: thumbPath,
      mime_type: mimeType,
      byte_size: displayBuf.byteLength + thumbSize,
      width,
      height,
      duration_sec: durationSec,
      original_filename: originalFilename,
      created_by: adminUserId,
    },
    { onConflict: 'id' },
  )
  if (dbErr) throw dbErr
  return displayBuf.byteLength + thumbSize
}
