import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import {spawnSync} from 'node:child_process'
const root=path.resolve('.qa/f20-invalid-assets');fs.mkdirSync(path.join(root,'scripts'),{recursive:true});fs.mkdirSync(path.join(root,'public/assets/realistic'),{recursive:true})
for(const name of ['check-assets.mjs','asset-validation.mjs'])if(fs.existsSync('scripts/'+name))fs.copyFileSync('scripts/'+name,path.join(root,'scripts',name))
const data=Buffer.from('invalid glb with a correct hash'),folder=path.join(root,'public/assets/realistic')
fs.writeFileSync(path.join(folder,'broken.glb'),data)
fs.writeFileSync(path.join(folder,'manifest.json'),JSON.stringify({served:[{filename:'broken.glb',sha256:crypto.createHash('sha256').update(data).digest('hex')}]}))
const result=spawnSync(process.execPath,[path.join(root,'scripts/check-assets.mjs')],{encoding:'utf8'})
assert.notEqual(result.status,0,'matching checksums cannot make undecodable assets pass')
console.log('F20 PASS: undecodable GLB with a valid checksum is rejected')
