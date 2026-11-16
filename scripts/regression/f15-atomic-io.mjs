import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {atomicDirectory,atomicDirectoryAsync} from '../atomic-directory.mjs'
const root=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f15-io-')),target=path.join(root,'snapshot'),rename=fs.renameSync
fs.mkdirSync(target);fs.writeFileSync(path.join(target,'marker'),'old')
try{
  let transient=2
  fs.renameSync=(from,to)=>{
    if(transient-->0)throw Object.assign(new Error('injected transient Windows sharing failure'),{code:'EPERM'})
    return rename(from,to)
  }
  atomicDirectory(target,stage=>fs.writeFileSync(path.join(stage,'marker'),'new'))
  assert.equal(fs.readFileSync(path.join(target,'marker'),'utf8'),'new')
  fs.renameSync=(from,to)=>{
    if(to===target&&fs.readFileSync(path.join(from,'marker'),'utf8')==='bad')throw Object.assign(new Error('injected permanent rename failure'),{code:'EPERM'})
    return rename(from,to)
  }
  await assert.rejects(atomicDirectoryAsync(target,async stage=>fs.writeFileSync(path.join(stage,'marker'),'bad')),/permanent rename/)
  assert.equal(fs.readFileSync(path.join(target,'marker'),'utf8'),'new','failed replacement restores the previous complete directory')
  console.log('F15 PASS: transient rename retries and permanent replacement failure preserve complete output')
}finally{fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true})}
