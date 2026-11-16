import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {build} from 'vite'
import {createLocalCmsStore} from '../local-cms-store.mjs'
import {localCmsPlugin} from '../local-cms-plugin.mjs'
import {validateSnapshot} from '../public-snapshot.mjs'
const root=fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-build-preserve-'))),dataDir=path.join(root,'private'),out=path.join(root,'dist')
fs.writeFileSync(path.join(root,'index.html'),'<p>public cottage</p>')
const store=createLocalCmsStore(root,{dataDir});await store.seedNeutralSample()
const run=(extra=[])=>build({root,configFile:false,logLevel:'silent',plugins:[localCmsPlugin({rootDir:root,mode:'local-export',dataDir}),...extra],build:{outDir:out}})
try{
  await run()
  const file=path.join(out,'local-snapshot/cottage.json'),previous=fs.readFileSync(file)
  const asset=Object.values(store.readDb().assets)[0]
  const original=fs.readFileSync(path.join(store.mediaDir,asset.displayPath)),html=fs.readFileSync(path.join(out,'index.html'))
  fs.unlinkSync(path.join(store.mediaDir,asset.displayPath))
  await assert.rejects(run(),/素材|文件|media|missing/i)
  assert.equal(fs.existsSync(file),true,'Vite must validate before clearing the previous build output')
  assert.deepEqual(fs.readFileSync(file),previous,'failed Vite export must retain the last complete snapshot')
  fs.writeFileSync(path.join(store.mediaDir,asset.displayPath),original)
  fs.writeFileSync(path.join(root,'index.html'),'<p>uncommitted new build</p>')
  await assert.rejects(run([{name:'injected-build-error',buildStart(){throw new Error('injected build failure')}}]),/injected build failure/)
  assert.deepEqual(fs.readFileSync(file),previous,'compile failure restores the previous snapshot')
  assert.deepEqual(fs.readFileSync(path.join(out,'index.html')),html,'compile failure restores the previous full build')
  await run([{name:'injected-source-race',buildStart(){fs.unlinkSync(path.join(store.mediaDir,asset.displayPath))}}])
  await validateSnapshot(path.join(out,'local-snapshot'),{requireManifest:false})
  console.log('F15 PASS: actual Vite build validates before output deletion and preserves the previous snapshot')
}finally{fs.rmSync(root,{recursive:true,force:true})}
