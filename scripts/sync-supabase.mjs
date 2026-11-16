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
    now_notes: Array.isArray(pub.nowNotes) ? pub.nowNotes : [],
    quotes: Array.isArray(pub.quotes) ? pub.quotes : [],
    published_at: pub.publishedAt ?? new Date().toISOString(),
  }
}

export async function syncToSupabase({store,supabase,adminUser,asDrafts=false,forceOverwrite=false}) {
  if (!fs.existsSync(store.cottagePath)) {
    throw new Error('未找到 local-data/cottage.json，请先在本地工作室添加并保存内容后再同步到云端。')
  }

  const db = store.readDb()

  // Resolve every project before writing anything, including slugs skipped without --force.
  const existingProjects = new Map()
  const projectIds = new Map()
  for (const project of db.projects) {
    const { data, error } = await supabase.from('projects').select('id,version').eq('slug', project.slug).maybeSingle()
    if (error) throw error
    existingProjects.set(project.slug, data)
    projectIds.set(project.id, data?.id ?? project.id)
  }
  const resolveProjectId = (id) => {
    if (!id) return null
    if (!projectIds.has(id)) throw new Error(`Unresolved local project reference: ${id}`)
    return projectIds.get(id)
  }
  for (const note of db.notes) {
    note.draft.projectId = resolveProjectId(note.draft.projectId)
    if (note.published) note.published.projectId = resolveProjectId(note.published.projectId)
  }

  // Preflight captures all versions before any media transfer can race an editor.
  const existingNotes = new Map()
  for (const note of db.notes) {
    const {data,error}=await supabase.from('notes').select('id,version').eq('slug',note.slug).maybeSingle()
    if(error) throw error
    existingNotes.set(note.slug,data)
  }
  const singleton = async (table,id) => {
    const {data,error}=await supabase.from(table).select('id,version').eq('id',id).maybeSingle()
    if(error) throw error
    return data
  }
  const existingProfile=await singleton('site_profile','owner')
  const existingSettings=await singleton('site_settings','main')
  const {data:orders,error:orderError}=await supabase.from('collection_state').select('key,version')
  if(orderError) throw orderError
  const plan={projects:[],notes:[],profile:[],settings:[],orderVersions:Object.fromEntries(orders.map(x=>[x.key,x.version]))}

  for (const project of db.projects) {
    const existing = existingProjects.get(project.slug)
    if (existing && !forceOverwrite) {
      console.log(`Skipped existing project (${project.slug}); pass --force to overwrite.`)
      continue
    }
    const publishItem = !asDrafts && Boolean(project.isPublished && project.published)
    plan.projects.push({expectedVersion:existing?.version ?? 0,row:{
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
    }})
    console.log(`Prepared project: ${project.draft.title} [${publishItem ? 'published' : 'draft'}]`)
  }

  for (const note of db.notes) {
    const existing = existingNotes.get(note.slug)
    if (existing && !forceOverwrite) {
      console.log(`Skipped existing note (${note.slug}); pass --force to overwrite.`)
      continue
    }
    const publishItem = !asDrafts && Boolean(note.isPublished && note.published)
    plan.notes.push({expectedVersion:existing?.version ?? 0,row:{
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
    }})
    console.log(`Prepared note: ${note.draft.title} [${publishItem ? 'published' : 'draft'}]`)
  }

  const p = db.profile
  if (p) {
    const publishProfile = !asDrafts && Boolean(p.isPublished && p.published)
    plan.profile.push({expectedVersion:existingProfile?.version ?? 0,row:{
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
        draft_now_notes: Array.isArray(p.draft.nowNotes) ? p.draft.nowNotes : [],
        draft_quotes: Array.isArray(p.draft.quotes) ? p.draft.quotes : [],
        published_snapshot: publishProfile ? toProfileSnapshotRow(p.published) : null,
    }})
    console.log(`Prepared owner profile [${publishProfile ? 'published' : 'draft'}]`)
  }

  if (db.siteSettings) {
    const s = db.siteSettings
    plan.settings.push({expectedVersion:existingSettings?.version ?? 0,row:{
        id: 'main',
        home_name: s.homeName || '我的小屋',
        plaque_title: s.plaqueTitle || '欢迎回家',
        plaque_subtitle: s.plaqueSubtitle ?? '',
        yard_heading: s.yardHeading || '来家里坐坐。',
        yard_subtitle: s.yardSubtitle ?? '',
        default_atmosphere: s.defaultAtmosphere || 'daylight',
        default_weather: s.defaultWeather || 'clear',
    }})
    console.log(`Prepared site settings (${s.homeName})`)
  }

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

  const {data:result,error}=await supabase.rpc('import_cms_content',{p_plan:plan})
  if(error) throw error
  if(!result?.ok) throw new Error(result?.code==='CONFLICT' ? 'Import conflict: content changed after preflight; repeat preflight.' : 'Import transaction rejected')
  console.log('\n[sync:supabase] Done!')
}

async function main(){
  const {supabase,adminEmail,adminPassword}=createAdminSupabaseFromEnv(rootDir)
  const adminUser=await ensureAdminUser(supabase,adminEmail,adminPassword)
  await syncToSupabase({store:createLocalCmsStore(rootDir),supabase,adminUser,asDrafts:process.argv.includes('--as-drafts'),forceOverwrite:process.argv.includes('--force')})
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) main().catch((err) => {
  console.error(err)
  process.exit(1)
})
