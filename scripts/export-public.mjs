import fs from 'node:fs'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {createLocalCmsStore} from './local-cms-store.mjs'
import {atomicDirectoryAsync} from './atomic-directory.mjs'
import {publicAssetKinds,writeSnapshotManifest,validateSnapshot} from './public-snapshot.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]))
const projectKeys=['id','slug','sortOrder','publishedAt','title','summary','body','demoUrl','coverAssetId','galleryAssetIds','videoAssetId']
const noteKeys=['id','slug','sortOrder','publishedAt','title','body','projectId','imageAssetIds','videoAssetId']
const profileKeys=['publishedAt','displayName','bio','focusAreas','avatarAssetId','contactEmail','contactLinks','nowNotes','quotes']
export async function exportPublic({source,outDir=path.join(root,'site-content'),dataDir=process.env.LOCAL_CMS_DATA_DIR||path.join(root,'local-data'),url=process.env.SUPABASE_URL||process.env.VITE_SUPABASE_URL,key=process.env.SUPABASE_ANON_KEY||process.env.VITE_SUPABASE_ANON_KEY}){
  if(!['local','supabase'].includes(source))throw new Error('Explicit --source local|supabase is required')
  const target=path.resolve(outDir),relative=path.relative(target,root),privateRelative=path.relative(target,path.resolve(dataDir))
  const contains=relative=>relative===''||(relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))
  if(contains(relative)||contains(privateRelative))throw new Error('Unsafe public snapshot output directory')
  return await atomicDirectoryAsync(target,async stage=>{
    if(source==='local'){
      if(!fs.existsSync(path.join(dataDir,'cottage.json')))throw new Error('Missing selected local data source')
      createLocalCmsStore(root,{dataDir}).exportStaticSnapshot(stage)
    }else{
      if(!url||!key)throw new Error('Supabase public URL and anon/publishable key are required; private env files are not loaded')
      if(key.startsWith('sb_secret_'))throw new Error('Service-role keys are forbidden for public export')
      try{if(JSON.parse(Buffer.from(key.split('.')[1]||'','base64url').toString()).role==='service_role')throw new Error('Service-role keys are forbidden for public export')}catch(error){if(error.message.startsWith('Service-role'))throw error}
      const base=new URL(url)
      if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash)throw new Error('Invalid public Supabase URL')
      const request=async(name,body)=>{
        const response=await fetch(new URL('/functions/v1/'+name,base),{method:body?'POST':'GET',headers:{apikey:key,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)})
        if(!response.ok)throw new Error(`Public ${name} failed (${response.status})`)
        return await response.json()
      }
      const content=await request('public-content')
      publicAssetKinds(content)
      const payload={snapshot:true,exportedAt:new Date().toISOString(),projects:content.projects.map(x=>pick(x,projectKeys)),notes:content.notes.map(x=>pick(x,noteKeys)),profile:content.profile?pick(content.profile,profileKeys):null,siteSettings:content.siteSettings,signedUrls:{}}
      const kinds=publicAssetKinds(payload),ids=[...kinds.keys()]
      for(let offset=0;offset<ids.length;offset+=40){
        const batch=ids.slice(offset,offset+40),signed=await request('media-sign',{scope:'public',assetIds:batch})
        if(signed.deniedIds?.length)throw new Error('Published media became unavailable during public export')
        for(const id of batch){
          const entry=signed.signedUrls?.[id]
          if(!entry?.displayUrl)throw new Error('Missing published media signature: '+id)
          const saved={displayUrl:null,thumbUrl:null,expiresAt:Number.MAX_SAFE_INTEGER}
          for(const [variant,remote] of [['display',entry.displayUrl],['thumb',entry.thumbUrl]]){
            if(!remote)continue
            const signedUrl=new URL(remote,base)
            // Supabase local Edge uses an internal gateway origin; the signed Storage path
            // is public on the explicitly selected API origin in both local and hosted mode.
            if(!signedUrl.pathname.startsWith('/storage/v1/object/sign/cottage-media/'))throw new Error('Unexpected signed Storage path')
            const download=new URL(signedUrl.pathname+signedUrl.search,base)
            const response=await fetch(download,{signal:AbortSignal.timeout(60000),redirect:'error'})
            if(!response.ok)throw new Error(`Published media download failed (${response.status})`)
            const mime=response.headers.get('content-type')?.split(';')[0]
            const extensions={'image/png':'png','image/jpeg':'jpg','image/webp':'webp','video/mp4':'mp4','video/webm':'webm'}
            const ext=extensions[mime],expected=variant==='thumb'?'image':kinds.get(id)
            if(!ext||!mime.startsWith(expected+'/'))throw new Error('Published media MIME does not match its reference')
            const data=Buffer.from(await response.arrayBuffer())
            if(!data.length||data.length>50*1024*1024)throw new Error('Published media exceeds the export size limit')
            const rel=`media/${expected}s/${id}/${variant}.${ext}`,file=path.join(stage,rel)
            fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,data)
            saved[variant==='display'?'displayUrl':'thumbUrl']='./local-snapshot/'+rel
          }
          payload.signedUrls[id]=saved
        }
      }
      fs.writeFileSync(path.join(stage,'cottage.json'),JSON.stringify(payload,null,2))
    }
    writeSnapshotManifest(stage,source)
    const payload=await validateSnapshot(stage)
    return {source,projects:payload.projects.length,notes:payload.notes.length,assets:Object.keys(payload.signedUrls).length}
  })
}
async function main(){
  const option=name=>{const i=process.argv.indexOf('--'+name);return i>=0?process.argv[i+1]:undefined}
  console.log('Exported public snapshot:',await exportPublic({source:option('source'),outDir:option('out')}))
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1})
