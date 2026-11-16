import crypto from 'node:crypto'
import {prepareTestVideo} from '../test-runtime.mjs'
import net from 'node:net'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createServer} from 'vite'
import {localCmsPlugin} from '../local-cms-plugin.mjs'
import {createLocalCmsStore} from '../local-cms-store.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f16-')),dataDir=path.join(root,'private')
process.env.LOCAL_CMS_ALLOW_LAN='1';process.env.LOCAL_CMS_PIN='regression-pin-only'
fs.writeFileSync(path.join(root,'index.html'),'<p>home</p>')
const store=createLocalCmsStore(root,{dataDir});await store.seedNeutralSample();const db=store.readDb(),project=db.projects[0]
store.mutate('project.unpublish',{id:project.id,expectedVersion:project.version})
const probe=net.createServer();await new Promise(r=>probe.listen(0,'0.0.0.0',r));const port=probe.address().port;await new Promise(r=>probe.close(r))
const videoId=crypto.randomUUID(),videoBytes=fs.readFileSync(prepareTestVideo(root))
store.appendVideoChunk(videoId,'mp4',videoBytes,{reset:true,finalize:true,mimeType:'video/mp4'})
assert.equal(store.mutate('media.register',{assetId:videoId,kind:'video',displayPath:`videos/${videoId}/demo.mp4`,mimeType:'video/mp4',byteSize:videoBytes.length,width:96,height:64,durationSec:1}).status,200)
const editing=store.readDb().projects[0]
assert.equal(store.mutate('project.save_draft',{id:editing.id,expectedVersion:editing.version,...editing.draft,videoAssetId:videoId}).status,200)
const server=await createServer({root,configFile:false,plugins:[localCmsPlugin({rootDir:root,dataDir})],server:{host:'0.0.0.0',port,strictPort:true,allowedHosts:true},optimizeDeps:{noDiscovery:true}})
try{
 await server.listen()
 const ip=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal&&x.address.startsWith('10.'))?.address || Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal)?.address
 assert.ok(ip,'LAN interface required for the real network authentication test')
 const base=`http://${ip}:${server.httpServer.address().port}/__local-cms`
 const health=await(await fetch(base+'/health')).json();assert.equal(health.pinRequired,true)
 assert.equal((await fetch(base+'/admin-content',{headers:{'x-local-owner':'1'}})).status,403)
 const login=await fetch(base+'/session',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:'regression-pin-only'})})
 assert.equal(login.status,200,'PIN login must exist')
 const raw=login.headers.get('set-cookie');assert.match(raw,/HttpOnly/i);assert.match(raw,/SameSite=Strict/i);assert.match(raw,/Max-Age=3600/i)
 const cookie=raw.split(';')[0],headers={cookie,'x-local-owner':'1'}
 assert.equal((await fetch(base+'/admin-content',{headers})).status,200)
 const media=`/media/admin/${project.draft.coverAssetId}/display`
 assert.equal((await fetch(base+media)).status,403)
 assert.equal((await fetch(base+media,{headers:{cookie}})).status,200,'draft images must use cookie authentication without custom headers')
 const video=`/media/admin/${videoId}/display`
 assert.equal((await fetch(base+video)).status,403)
 const stream=await fetch(base+video,{headers:{cookie,Range:'bytes=-32'}})
 assert.equal(stream.status,206);assert.deepEqual(Buffer.from(await stream.arrayBuffer()),videoBytes.subarray(-32))
 assert.equal((await fetch(base+'/session',{method:'DELETE',headers:{cookie}})).status,200)
 assert.equal((await fetch(base+media,{headers:{cookie}})).status,403,'logout must revoke the server session')
 for(let i=0;i<5;i++)assert.equal((await fetch(base+'/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"pin":"wrong"}'})).status,403)
 assert.equal((await fetch(base+'/session',{method:'POST',headers:{'content-type':'application/json'},body:'{"pin":"wrong"}'})).status,429)
 console.log('F16 PASS: real LAN login, HttpOnly cookie image/video access, revocation and bad-PIN rate limiting')
}finally{await server.close();fs.rmSync(root,{recursive:true,force:true})}
