import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {spawnSync} from 'node:child_process'
import {validateSnapshot} from '../public-snapshot.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-snapshot-git-'))
try{
  fs.cpSync('site-content',path.join(root,'site-content'),{recursive:true})
  fs.copyFileSync('.gitattributes',path.join(root,'.gitattributes'))
  const git=args=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stderr)}
  git(['init','--quiet'])
  git(['-c','core.autocrlf=true','add','.'])
  fs.unlinkSync(path.join(root,'site-content/cottage.json'))
  git(['-c','core.autocrlf=true','checkout-index','--all','--force'])
  await validateSnapshot(path.join(root,'site-content'))
  console.log('F21 PASS: Git checkout with autocrlf preserves committed snapshot bytes and hashes')
}finally{fs.rmSync(root,{recursive:true,force:true})}
