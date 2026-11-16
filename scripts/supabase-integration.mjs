import {createRequire} from 'node:module'
import {createLocalCmsStore} from './local-cms-store.mjs'
import {syncToSupabase} from './sync-supabase.mjs'
import {exportPublic} from './export-public.mjs'
import {validateSnapshot} from './public-snapshot.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
import {createClient} from '@supabase/supabase-js'
import sharp from 'sharp'
import pg from 'pg'
import {freePort,trackProcess} from './test-runtime.mjs'

const root=process.cwd()
fs.mkdirSync(path.join(root,'.qa'),{recursive:true})
const work=fs.mkdtempSync(path.join(root,'.qa','supabase-'))
const require=createRequire(import.meta.url)
const platform=process.platform==='win32'?'windows':process.platform
const cli=path.join(path.dirname(require.resolve(`@supabase/cli-${platform}-${process.arch}/package.json`)),'bin','supabase'+(process.platform==='win32'?'.exe':''))
const redact=text=>text.replace(/eyJ[A-Za-z0-9_.-]+/g,'[LOCAL_JWT]').replace(/sb_(secret|publishable)_[A-Za-z0-9_-]+/g,'[LOCAL_KEY]').replace(/postgres(?:ql)?:\/\/[^\s]+/g,'[LOCAL_DB_URL]')
async function command(args){
  return await new Promise((resolve,reject)=>{
    const child=trackProcess(spawn(cli,[...args,'--workdir',work],{windowsHide:true,env:{...process.env,SUPABASE_TELEMETRY_DISABLED:'true'},stdio:['ignore','pipe','pipe']}))
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x)
    child.on('error',reject);child.on('exit',code=>resolve({code,output}))
  })
}
fs.mkdirSync(path.join(work,'supabase'),{recursive:true})
for(const dir of ['migrations','functions'])fs.cpSync(path.join(root,'supabase',dir),path.join(work,'supabase',dir),{recursive:true})
const ports=[];for(let i=0;i<5;i++)ports.push(await freePort())
const projectName='paper-home-'+crypto.randomBytes(5).toString('hex')
let config=fs.readFileSync('supabase/config.toml','utf8').replace('project_id = "paper-home"',`project_id = "${projectName}"`).replace('port = 54321',`port = ${ports[0]}`)
config+=`\n[db]\nport = ${ports[1]}\nshadow_port = ${ports[2]}\nmajor_version = 17\n[studio]\nenabled = false\nport = ${ports[3]}\n[analytics]\nenabled = false\n[db.pooler]\nenabled = false\nport = ${ports[4]}\n`
fs.writeFileSync(path.join(work,'supabase','config.toml'),config)
let sql
try{
  console.log('Starting isolated Supabase containers (original migrations and real Edge runtime).')
  const start=await command(['start','-x','studio,imgproxy,mailpit,realtime,postgres-meta,logflare,vector,supavisor'])
  fs.writeFileSync(path.join(work,'start.log'),redact(start.output))
  assert.equal(start.code,0,'Supabase start failed; see sanitized start.log in '+work)
  const status=await command(['status','-o','json'])
  const json=status.output.slice(status.output.indexOf('{'),status.output.lastIndexOf('}')+1)
  const env=JSON.parse(json),url=env.API_URL,key=env.SERVICE_ROLE_KEY,anon=env.ANON_KEY
  assert.ok(url&&key&&anon,'Local CLI status omitted required values')
  assert.ok(['localhost','127.0.0.1'].includes(new URL(url).hostname),'Integration must never use a hosted project')
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
  const visitor=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
  sql=new pg.Client({connectionString:env.DB_URL});await sql.connect()
  const email='regression@example.com',password='Local-regression-123!'
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ifError(created.error)
  assert.ifError((await admin.from('admin_users').insert({user_id:created.data.user.id})).error)
  const auth=await visitor.auth.signInWithPassword({email,password});assert.ifError(auth.error)
  const token=auth.data.session.access_token
  const edge=async(name,body,authorized=true)=>{
    const response=await fetch(url+'/functions/v1/'+name,{method:body===undefined?'GET':'POST',headers:{apikey:anon,...(authorized?{authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})})
    const text=await response.text();let data;try{data=JSON.parse(text)}catch{throw new Error('Non-JSON Edge response '+response.status+' '+redact(text.slice(0,500)))}
    return {status:response.status,data}
  }
  assert.equal((await edge('public-content',undefined,false)).status,200)
  assert.equal((await edge('admin-content',undefined,false)).status,401)
  const mutate=async(action,payload)=>edge('admin-mutate',{action,payload})
  console.log('Real Auth/RLS and Edge endpoints ready.')
  for(const version of [null,0,-1,1.5,'1'])assert.equal((await mutate('settings.save',{expectedVersion:version,homeName:'invalid'})).status,400)
  const id=crypto.randomUUID(),display=`images/${id}/display.png`,thumb=`images/${id}/thumb.png`
  const bytes=await sharp({create:{width:64,height:64,channels:3,background:'#336655'}}).png().toBuffer()
  for(const object of [display,thumb])assert.ifError((await admin.storage.from('cottage-media').upload(object,bytes,{contentType:'image/png'})).error)
  assert.equal((await mutate('media.register',{assetId:id,kind:'image',displayPath:display,thumbPath:thumb,mimeType:'image/png',byteSize:bytes.length*2,width:64,height:64})).status,200)
  assert.equal((await edge('media-sign',{scope:'public',assetIds:[id]},false)).status,403)
  const saved=await mutate('project.save_draft',{expectedVersion:0,title:'draft',summary:'s',body:'b',coverAssetId:id,galleryAssetIds:[id]})
  assert.equal(saved.status,200,JSON.stringify(saved.data));const row=saved.data.item||saved.data.project
  const projectId=row.id,version=row.version
  for(const invalid of [undefined,null,0,-1,1.5,'1',2147483648,Number.MAX_SAFE_INTEGER]){
    for(const action of ['project.save_draft','project.publish','project.unpublish','project.delete','project.reorder','note.save_draft','note.publish','note.unpublish','note.delete','note.reorder','profile.save_draft','profile.publish','profile.unpublish','settings.save']){
      assert.equal((await mutate(action,{id:projectId,expectedVersion:invalid,expectedOrderVersion:invalid})).status,400,`${action} invalid version ${invalid}`)
    }
  }
  console.log('All versioned Edge actions reject missing, null, zero, negative, fractional and string versions.')
  assert.equal((await mutate('project.publish',{id:projectId,expectedVersion:version})).status,200)
  assert.equal((await edge('media-sign',{scope:'public',assetIds:[id]},false)).status,200)
  assert.equal((await mutate('project.save_draft',{id:projectId,expectedVersion:version,title:'stale'})).status,409)
  const anonymous=createClient(url,anon,{auth:{persistSession:false,autoRefreshToken:false}})
  assert.deepEqual((await anonymous.from('projects').select('*')).data,[],'anon cannot read base tables')
  const pending=crypto.randomUUID()
  assert.ifError((await admin.from('media_assets').insert({id:pending,kind:'image',status:'ready',display_path:`images/${pending}/display.png`,mime_type:'image/png',byte_size:10,created_by:created.data.user.id})).error)
  assert.ifError((await admin.rpc('cleanup_candidate_assets',{p_candidate_ids:[pending],p_sweep_orphans:false})).error)
  await sql.query("update media_cleanup_queue set next_retry_at=now()+interval '1 hour'")
  const rejected=await mutate('note.save_draft',{expectedVersion:0,title:'bad',imageAssetIds:[pending]})
  assert.equal(rejected.status,400,'queued media cannot be referenced by a new draft')
  assert.ok((await admin.from('notes').insert({slug:'bad-direct',draft_image_asset_ids:[pending]})).error,'direct writes obey reference guard')
  await sql.query("update media_cleanup_queue set next_retry_at=now()-interval '1 second'")
  const claims=await Promise.all([admin.rpc('claim_media_cleanup',{p_limit:50}),admin.rpc('claim_media_cleanup',{p_limit:50})])
  claims.forEach(x=>assert.ifError(x.error));assert.equal(claims.reduce((n,x)=>n+x.data.length,0),1,'duplicate workers claim exclusively')
  const claim=claims.flatMap(x=>x.data)[0]
  assert.ifError((await admin.rpc('fail_media_cleanup',{p_queue_id:claim.id,p_claim_token:claim.claim_token,p_error:'injected Storage failure'})).error)
  const due=()=>sql.query("update media_cleanup_queue set next_retry_at=now()-interval '1 second'")
  await due()
  const storageName='supabase_storage_'+projectName
  const docker=async args=>await new Promise((resolve,reject)=>{const child=trackProcess(spawn('docker',args,{windowsHide:true,stdio:['ignore','pipe','pipe']}));let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error('Local Docker command failed: '+out)))})
  try{
    await docker(['stop','--time','1',storageName])
    const failed=await edge('media-cleanup',{candidateAssetIds:[],sweepOrphans:false})
    assert.equal(failed.status,200);assert.equal(failed.data.cleaned,0);assert.equal(failed.data.remaining,1);assert.ok(failed.data.errors.length)
    assert.equal((await admin.from('media_assets').select('id').eq('id',pending)).data.length,1)
  }finally{await docker(['start',storageName])}
  const storageDeadline=Date.now()+30000
  while(true){
    const health=await admin.storage.from('cottage-media').list('',{limit:1})
    if(!health.error)break
    if(Date.now()>storageDeadline)throw new Error('Storage did not become healthy after restart')
    await new Promise(resolve=>setTimeout(resolve,250))
  }
  await due()
  await sql.query(`create function public.test_cleanup_failure() returns trigger language plpgsql as $$begin raise exception 'injected transaction failure';end$$;create trigger test_cleanup_failure before delete on public.media_assets for each row when(old.id='${pending}') execute function public.test_cleanup_failure()`)
  try{
    const failed=await edge('media-cleanup',{candidateAssetIds:[],sweepOrphans:false})
    assert.equal(failed.data.cleaned,0);assert.equal(failed.data.remaining,1);assert.ok(failed.data.errors.length);assert.ok(failed.data.errors.some(x=>x.includes('injected transaction failure')),JSON.stringify(failed.data))
    assert.equal((await admin.from('media_assets').select('id').eq('id',pending)).data.length,1)
  }finally{await sql.query('drop trigger test_cleanup_failure on public.media_assets;drop function public.test_cleanup_failure()')}
  await due()
  const retried=await edge('media-cleanup',{candidateAssetIds:[],sweepOrphans:false})
  assert.equal(retried.status,200);assert.equal(retried.data.cleaned,1,JSON.stringify(retried.data));assert.equal(retried.data.remaining,0)
  assert.equal((await admin.from('media_assets').select('id').eq('id',pending)).data.length,0)
  console.log('Real Storage outage and database transaction failure retain the cleanup job; recovery completes atomically.')
  const current=(await admin.from('projects').select('*').eq('id',projectId).single()).data
  const orders=Object.fromEntries((await admin.from('collection_state').select('*')).data.map(x=>[x.key,x.version]))
  const plan={projects:[{expectedVersion:current.version,row:{id:projectId,slug:current.slug,draft_title:'imported draft',published_snapshot:current.published_snapshot,is_published:true}}],notes:[],orderVersions:orders}
  assert.equal((await admin.rpc('import_cms_content',{p_plan:plan})).data.ok,true)
  assert.equal((await admin.rpc('import_cms_content',{p_plan:plan})).data.code,'CONFLICT')
  const localData=path.join(work,'local-data'),store=createLocalCmsStore(root,{dataDir:localData});await store.seedNeutralSample()
  const sample=store.readDb(),mappedId=crypto.randomUUID()
  assert.ifError((await admin.from('projects').insert({id:mappedId,slug:sample.projects[0].slug,draft_title:'PREEXISTING'})).error)
  await syncToSupabase({store,supabase:admin,adminUser:created.data.user})
  let note=(await admin.from('notes').select('*').eq('slug',sample.notes[0].slug).single()).data
  assert.equal(note.draft_project_id,mappedId);assert.equal(note.published_snapshot.project_id,mappedId)
  const beforeForce=(await admin.from('projects').select('*').eq('id',mappedId).single()).data
  await syncToSupabase({store,supabase:admin,adminUser:created.data.user,forceOverwrite:true})
  const afterForce=(await admin.from('projects').select('*').eq('id',mappedId).single()).data
  assert.equal(afterForce.version,beforeForce.version+1)
  assert.equal(afterForce.draft_title,sample.projects[0].draft.title)
  const cloudOut=path.join(work,'cloud-public'),localOut=path.join(work,'local-public')
  await exportPublic({source:'supabase',url,key:anon,outDir:cloudOut})
  await exportPublic({source:'local',dataDir:localData,outDir:localOut})
  const cloudSnapshot=await validateSnapshot(cloudOut);await validateSnapshot(localOut)
  assert.ok(cloudSnapshot.projects.some(x=>x.id===mappedId))
  console.log('Real sync maps skipped slugs, increments versions and preserves registered media; both public exports validate.')
  for(const [source,snapshot] of [['local',localOut],['supabase',cloudOut]]){
    const result=await new Promise((resolve,reject)=>{const child=trackProcess(spawn(process.execPath,['node_modules/vite/bin/vite.js','build','--mode','local-export','--outDir',path.join(work,source+'-dist')],{env:{...process.env,PAPER_HOME_FORCE_LOCAL:'1',LOCAL_CMS_DATA_DIR:localData,PAPER_HOME_SNAPSHOT_DIR:snapshot},stdio:['ignore','pipe','pipe'],windowsHide:true}));let out='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>out+=x);child.on('error',reject);child.on('exit',code=>resolve({code,out}))})
    fs.writeFileSync(path.join(work,source+'-build.log'),redact(result.out));assert.equal(result.code,0,'Static source build: '+source)
  }
  console.log('PASS real Supabase: RLS/Auth, all versioned Edge actions, cleanup failures/retries, transaction import, actual ID mapping and both static source builds.')
}finally{
  await sql?.end()
  const stopped=await command(['stop','--no-backup'])
  fs.writeFileSync(path.join(work,'stop.log'),redact(stopped.output))
  console.log('Isolated Supabase stop exit:',stopped.code)
}
