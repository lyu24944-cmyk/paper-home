import {syncToSupabase} from '../sync-supabase.mjs'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import {fileURLToPath} from 'node:url'
import {createLocalCmsStore} from '../local-cms-store.mjs'
const root=process.cwd(),dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'paper-home-f12-'))
try{
 const store=createLocalCmsStore(root,{dataDir});await store.seedNeutralSample();const db=store.readDb()
 const localId=db.projects[0].id,cloudId='22222222-2222-4222-8222-222222222222'
 for(const force of [false,true]){
  const writes=[]
  const supabase={from(table){return{select(){if(table==='collection_state')return Promise.resolve({data:[{key:'projects_order',version:1},{key:'notes_order',version:1}],error:null});return{eq(){return{maybeSingle:async()=>({data:table==='projects'?{id:cloudId,version:1}:null,error:null})}}}},async upsert(){throw Error('content writes must use transaction RPC')}}},async rpc(name,{p_plan}){assert.equal(name,'import_cms_content');for(const [section,table] of [['projects','projects'],['notes','notes'],['profile','site_profile'],['settings','site_settings']])for(const item of p_plan[section])writes.push({table,row:item.row});return{data:{ok:true},error:null}}}

  const mediaDb=structuredClone(db);mediaDb.assets={}
  await syncToSupabase({store:{cottagePath:store.cottagePath,readDb:()=>mediaDb},supabase,adminUser:{id:'admin'},forceOverwrite:force})
  const note=writes.find(x=>x.table==='notes').row
  assert.equal(note.draft_project_id,cloudId,'draft link must use resolved remote ID (force='+force+')')
  assert.equal(note.published_snapshot.project_id,cloudId,'published link must use resolved remote ID')
  assert.notEqual(note.draft_project_id,localId)
 }
 console.log('F12 PASS: forced and skipped projects map draft/published note IDs')
}finally{fs.rmSync(dataDir,{recursive:true,force:true})}
