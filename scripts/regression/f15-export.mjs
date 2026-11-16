import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {createLocalCmsStore} from '../local-cms-store.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f15-'))
try{
 const store=createLocalCmsStore(root,{dataDir:path.join(root,'private')});await store.seedNeutralSample()
 const out=path.join(root,'snapshot');store.exportStaticSnapshot(out)
 const previous=fs.readFileSync(path.join(out,'cottage.json'),'utf8'),original=store.readDb()
 const id=original.projects[0].published.coverAssetId
 for(const mutation of [db=>delete db.assets[id],db=>db.assets[id].status='pending_delete',db=>db.assets[id].kind='video',db=>db.assets[id].displayPath='images/missing.webp',db=>db.assets[id].thumbPath='images/missing-thumb.webp']){
  const db=structuredClone(original);mutation(db);fs.writeFileSync(store.cottagePath,JSON.stringify(db))
  assert.throws(()=>store.exportStaticSnapshot(out),/素材|文件|引用|image|ready|thumbnail|media/i)
  assert.equal(fs.readFileSync(path.join(out,'cottage.json'),'utf8'),previous,'invalid export must preserve the last complete artifact')
 }
 console.log('F15 PASS: missing/wrong/unready media and thumbnails fail without replacing a complete snapshot')
}finally{fs.rmSync(root,{recursive:true,force:true})}
