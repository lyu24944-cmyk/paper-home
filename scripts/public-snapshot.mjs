import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import sharp from 'sharp'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function publicAssetKinds(payload){
  if(!Array.isArray(payload.projects)||!Array.isArray(payload.notes)||!(payload.profile===null||typeof payload.profile==='object'))throw new Error('Invalid public snapshot structure')
  const kinds=new Map()
  const add=(id,kind)=>{if(!id)return;if(!UUID.test(id)||kinds.has(id)&&kinds.get(id)!==kind)throw new Error('Invalid public media reference');kinds.set(id,kind)}
  for(const item of [...payload.projects,...payload.notes,...(payload.profile?[payload.profile]:[])]){
    if(Object.keys(item).some(key=>/draft|published_snapshot|created_by/i.test(key)))throw new Error('Private fields in public content')
    for(const key of ['coverAssetId','avatarAssetId'])add(item[key],'image')
    for(const key of ['galleryAssetIds','imageAssetIds'])for(const id of item[key]??[])add(id,'image')
    add(item.videoAssetId,'video')
  }
  return kinds
}
function snapshotFile(folder,url){
  if(typeof url!=='string'||!url.startsWith('./local-snapshot/media/')||/[?#\\]/.test(url))throw new Error('Snapshot media must use local paths')
  const relative=url.slice('./local-snapshot/'.length)
  if(relative.split('/').some(x=>!x||x==='.'||x==='..'||x.includes('%')))throw new Error('Unsafe snapshot media path')
  const file=path.resolve(folder,relative)
  const within=path.relative(fs.realpathSync(folder),fs.realpathSync(file))
  if(within.startsWith('..'+path.sep)||path.isAbsolute(within)||!fs.statSync(file).isFile())throw new Error('Snapshot file escapes its directory')
  return file
}
export function snapshotFiles(folder){
  const files=[]
  function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    if(entry.isSymbolicLink())throw new Error('Snapshot symlinks are forbidden')
    const file=path.join(dir,entry.name)
    if(entry.isDirectory())walk(file);else if(entry.isFile())files.push(path.relative(folder,file).replaceAll('\\','/'))
  }}walk(folder)
  return files.sort()
}
export function writeSnapshotManifest(folder,source){
  const files={}
  for(const file of snapshotFiles(folder))if(file!=='manifest.json')files[file]=crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,file))).digest('hex')
  fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({schemaVersion:1,source,files},null,2))
}
export async function validateSnapshot(folder,{requireManifest=true}={}){
  // Reject links before opening cottage.json or any referenced file.
  const files=snapshotFiles(folder)
  const payload=JSON.parse(fs.readFileSync(path.join(folder,'cottage.json'),'utf8'))
  if(payload.snapshot!==true)throw new Error('Missing explicit snapshot marker')
  const kinds=publicAssetKinds(payload),allowed=new Set(['cottage.json','manifest.json'])
  for(const [id,kind] of kinds){
    const entry=payload.signedUrls?.[id]
    if(!entry?.displayUrl||entry.expiresAt!==Number.MAX_SAFE_INTEGER)throw new Error('Missing permanent public media entry: '+id)
    for(const [variant,url] of [['display',entry.displayUrl],['thumb',entry.thumbUrl]]){
      if(!url)continue
      const file=snapshotFile(folder,url),data=fs.readFileSync(file),ext=path.extname(file).toLowerCase()
      if(!data.length)throw new Error('Empty snapshot media: '+id)
      if(kind==='image'||variant==='thumb')await sharp(data).raw().toBuffer()
      else if(ext==='.mp4'){
        if(data.subarray(4,8).toString()!=='ftyp')throw new Error('Invalid MP4 snapshot media')
      }else if(ext!=='.webm'||data.readUInt32BE(0)!==0x1a45dfa3)throw new Error('Invalid video snapshot media')
      allowed.add(path.relative(folder,file).replaceAll('\\','/'))
    }
  }
  if(Object.keys(payload.signedUrls??{}).some(id=>!kinds.has(id)))throw new Error('Unreferenced media in public snapshot')
  if(files.some(file=>!allowed.has(file)))throw new Error('Unexpected file in public snapshot')
  if(requireManifest){
    const manifest=JSON.parse(fs.readFileSync(path.join(folder,'manifest.json'),'utf8'))
    if(manifest.schemaVersion!==1||!['local','supabase'].includes(manifest.source))throw new Error('Invalid snapshot manifest')
    if(Object.keys(manifest.files).length!==files.filter(x=>x!=='manifest.json').length)throw new Error('Snapshot manifest file count mismatch')
    for(const file of files)if(file!=='manifest.json'&&manifest.files[file]!==crypto.createHash('sha256').update(fs.readFileSync(path.join(folder,file))).digest('hex'))throw new Error('Snapshot checksum mismatch: '+file)
  }
  return payload
}
