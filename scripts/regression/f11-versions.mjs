import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {createLocalCmsStore} from '../local-cms-store.mjs'
import {database} from './database.mjs'
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f11-'))
const store=createLocalCmsStore(process.cwd(),{dataDir})
try{
 const p=store.mutate('project.save_draft',{expectedVersion:0,title:'p'}).body.project
 const n=store.mutate('note.save_draft',{expectedVersion:0,title:'n'}).body.note
 for(const version of [undefined,null,0,-1,1.5,'1',2147483648,Number.MAX_SAFE_INTEGER]){
  for(const action of ['project.save_draft','project.publish','project.unpublish','project.delete','project.reorder','note.save_draft','note.publish','note.unpublish','note.delete','note.reorder','profile.save_draft','profile.publish','profile.unpublish','settings.save']){
   const res=store.mutate(action,{id:action.startsWith('note')?n.id:p.id,expectedVersion:version,expectedOrderVersion:version,orderedIds:[action.startsWith('note')?n.id:p.id],homeName:'house'})
   assert.equal(res.status,400,`${action}: illegal version ${String(version)} must be 400`)
  }
 }
 assert.equal(store.mutate('project.save_draft',{id:p.id,expectedVersion:999}).status,409)
 const db=await database()
 try{
  const sql="select save_site_settings($1,'house','','','','','daylight','clear') r"
  for(const version of [null,0,-1])assert.equal((await db.query(sql,[version])).rows[0].r.code,'VALIDATION_ERROR')
  const v=(await db.query('select version from site_settings')).rows[0].version
  assert.equal((await db.query(sql,[v+1])).rows[0].r.code,'CONFLICT')
  assert.equal((await db.query(sql,[v])).rows[0].r.ok,true)
  assert.equal((await db.query("select save_project_draft(null,null,'p','','','','',null,'{}',null) r")).rows[0].r.code,'VALIDATION_ERROR')
  assert.equal((await db.query("select save_project_draft(null,0,'p','','','','',null,'{}',null) r")).rows[0].r.ok,true)
  console.log('F11 PASS: local mutations and SQL reject invalid versions; stale versions conflict; creation uses zero')
 }finally{await db.close()}
}finally{fs.rmSync(dataDir,{recursive:true,force:true})}
