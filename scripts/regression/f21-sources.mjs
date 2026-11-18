import http from 'node:http'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {exportPublic} from '../export-public.mjs'
import {createLocalCmsStore,createEmptyStoreData} from '../local-cms-store.mjs'
import {validateSnapshot} from '../public-snapshot.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {localCmsPlugin} from '../local-cms-plugin.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f21-'))
try{
 const plugin=localCmsPlugin({rootDir:root,mode:'local-export',dataDir:path.join(root,'missing-private')})
 await assert.rejects(async()=>await plugin.writeBundle({dir:path.join(root,'dist')}),/source|快照|数据|missing/i,'a missing selected source must fail instead of exporting an empty cottage')
 const dataDir=path.join(root,'private'),store=createLocalCmsStore(root,{dataDir});await store.seedNeutralSample()
 const db=store.readDb();db.projects[0].draft.title='PRIVATE_DRAFT_MUST_NOT_EXPORT';fs.writeFileSync(store.cottagePath,JSON.stringify(db))
 const local=path.join(root,'site-content'),cloud=path.join(root,'cloud-content')
 await exportPublic({source:'local',dataDir,outDir:local})
 const payload=await validateSnapshot(local)
 assert.ok(!fs.readFileSync(path.join(local,'cottage.json'),'utf8').includes('PRIVATE_DRAFT_MUST_NOT_EXPORT'))
 const calls=[],api=http.createServer((req,res)=>{
   calls.push(req.method+' '+req.url.split('?')[0])
   if(req.url==='/functions/v1/public-content'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));return}
   if(req.url==='/functions/v1/media-sign'){
     let body='';req.on('data',x=>body+=x);req.on('end',()=>{
       const request=JSON.parse(body);assert.equal(request.scope,'public')
       const signedUrls=Object.fromEntries(request.assetIds.map(id=>[id,{displayUrl:`${origin}/storage/v1/object/sign/cottage-media/${id}/display?token=TEMPORARY`,thumbUrl:`${origin}/storage/v1/object/sign/cottage-media/${id}/thumb?token=TEMPORARY`,expiresAt:Date.now()+600000}]))
       res.setHeader('Content-Type','application/json');res.end(JSON.stringify({signedUrls,deniedIds:[]}))
     });return
   }
   const match=req.url.match(/^\/storage\/v1\/object\/sign\/cottage-media\/([^/]+)\/(display|thumb)/)
   if(match){const asset=db.assets[match[1]],file=path.join(store.mediaDir,match[2]==='thumb'?asset.thumbPath:asset.displayPath);res.setHeader('Content-Type',asset.mimeType);res.end(fs.readFileSync(file));return}
   res.statusCode=500;res.end()
 })
 let origin
 await new Promise(resolve=>api.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${api.address().port}`
 try{
   await exportPublic({source:'supabase',url:origin,key:'public-test-key',outDir:cloud})
   const result=await validateSnapshot(cloud)
   assert.deepEqual(result.projects,payload.projects)
   assert.ok(!fs.readFileSync(path.join(cloud,'cottage.json'),'utf8').includes('TEMPORARY'))
   assert.ok(calls.every(call=>call.includes('/public-content')||call.includes('/media-sign')||call.includes('/storage/v1/object/sign/')))
   const before=fs.readFileSync(path.join(cloud,'cottage.json'),'utf8')
   await assert.rejects(exportPublic({source:'supabase',url:origin,key:'sb_secret_forbidden',outDir:cloud}),/Service-role/)
   assert.equal(fs.readFileSync(path.join(cloud,'cottage.json'),'utf8'),before)
 }finally{await new Promise(resolve=>api.close(resolve))}
 process.env.PAPER_HOME_SNAPSHOT_DIR=local
 await plugin.writeBundle({dir:path.join(root,'dist')})
 assert.deepEqual((await validateSnapshot(path.join(root,'dist/local-snapshot'))).projects,payload.projects)
 process.env.PAPER_HOME_SNAPSHOT_DIR=path.join(root,'dist/local-snapshot')
 await assert.rejects(plugin.writeBundle({dir:path.join(root,'dist')}),/outside/,'a build must not erase its selected snapshot input')
 process.env.PAPER_HOME_SNAPSHOT_DIR=local
 fs.appendFileSync(path.join(local,'cottage.json'),' ')
 await assert.rejects(plugin.writeBundle({dir:path.join(root,'dist')}),/checksum/)
 delete process.env.PAPER_HOME_SNAPSHOT_DIR
 const empty=path.join(root,'empty');fs.mkdirSync(empty);fs.writeFileSync(path.join(empty,'cottage.json'),JSON.stringify(createEmptyStoreData()))
 await exportPublic({source:'local',dataDir:empty,outDir:path.join(root,'empty-public')})
 assert.equal((await validateSnapshot(path.join(root,'empty-public'))).projects.length,0)
 const cliDemoDataDir=path.join(root,'cli-demo'),cliDemoPublicDir=path.join(root,'cli-demo-public')
 const initScript=fileURLToPath(new URL('../init-sample.mjs',import.meta.url))
 const initRun=spawnSync(process.execPath,[initScript],{env:{...process.env,LOCAL_CMS_DATA_DIR:cliDemoDataDir},encoding:'utf8'})
 assert.equal(initRun.status,0,initRun.stderr||initRun.stdout)
 assert.ok(initRun.stdout.includes(cliDemoDataDir),'init-sample log should report custom LOCAL_CMS_DATA_DIR')
 await exportPublic({source:'local',dataDir:cliDemoDataDir,outDir:cliDemoPublicDir})
 const cliDemoSnapshot=await validateSnapshot(cliDemoPublicDir)
 assert.ok(cliDemoSnapshot.projects.length>0)
 console.log('F21 PASS: missing source fails; local/cloud exports use public data, local media, hashes, no fallback and explicit empty snapshots')
}finally{fs.rmSync(root,{recursive:true,force:true})}
