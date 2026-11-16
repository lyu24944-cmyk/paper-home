import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import {createLocalCmsStore} from '../local-cms-store.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f17-'))
try{
 const store=createLocalCmsStore(root,{dataDir:path.join(root,'private')});await store.seedNeutralSample()
 const id=crypto.randomUUID(),dir=path.join(store.mediaDir,'videos',id),file=path.join(dir,'demo.mp4')
 fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(file,Buffer.from('orphan-final'))
 const old=new Date(Date.now()-25*3600_000);fs.utimesSync(file,old,old)
 assert.equal(store.cleanupAssets([],true).errors.length,0)
 assert.equal(fs.existsSync(file),false,'unregistered completed files older than 24h must be reclaimed')
 const asset=Object.values(store.readDb().assets)[0],bytes=fs.readFileSync(path.join(store.mediaDir,asset.displayPath)),fresh=crypto.randomUUID()
 const rel=store.writeUploadedMediaBlob(fresh,'display','webp',bytes,'image/webp'),image=path.join(store.mediaDir,rel)
 fs.utimesSync(image,old,old);store.cleanupAssets([],true)
 assert.equal(fs.existsSync(image),true,'active upload leases protect a file even with an old mtime')
 store.abortVideoUpload(fresh)
 assert.equal(fs.existsSync(image),false,'cancel reclaims an unregistered final image too')
 assert.throws(()=>store.writeUploadedMediaBlob(fresh,'display','webp',bytes,'image/webp'),/取消|cancel/i,'a late server completion cannot recreate canceled files')
 const missing=path.join(root,'missing-target'),broken=path.join(store.mediaDir,'videos',crypto.randomUUID())
 fs.mkdirSync(missing);fs.symlinkSync(missing,broken,process.platform==='win32'?'junction':'dir');fs.rmdirSync(missing)
 const failed=store.cleanupAssets([],true)
 assert.equal(failed.cleaned,0);assert.ok(failed.errors.length>0);assert.ok(failed.remaining>0,'orphan traversal errors cannot report full success')
 console.log('F17 PASS: 24h final-file sweep, active lease protection and cancellation tombstones')
}finally{fs.rmSync(root,{recursive:true,force:true})}
