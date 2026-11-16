import assert from 'node:assert/strict'
import {database} from './database.mjs'
const db=await database()
try{
 const id='33333333-3333-4333-8333-333333333333'
 const plan={projects:[{expectedVersion:0,row:{id,slug:'imported',draft_title:'DRAFT',is_published:true,published_snapshot:{title:'PUBLIC'},has_unpublished_changes:true}}],notes:[],orderVersions:{projects_order:1,notes_order:1}}
 const run=async p=>(await db.query('select import_cms_content($1::jsonb) r',[JSON.stringify(p)])).rows[0].r
 assert.equal((await run(plan)).ok,true)
 let row=(await db.query('select * from projects where id=$1',[id])).rows[0]
 assert.equal(row.version,1);assert.equal(row.draft_title,'DRAFT');assert.equal(row.published_snapshot.title,'PUBLIC')
 const order=(await db.query("select version from collection_state where key='projects_order'")).rows[0].version
 plan.orderVersions.projects_order=order
 plan.projects[0].expectedVersion=1;plan.projects[0].row.draft_title='IMPORTED AGAIN'
 await db.query("select save_project_draft($1,1,'imported','EDITOR','','','',null,'{}',null)",[id])
 assert.equal((await run(plan)).code,'CONFLICT','--force cannot bypass a post-preflight edit')
 assert.equal((await db.query('select draft_title from projects where id=$1',[id])).rows[0].draft_title,'EDITOR')
 plan.projects[0].expectedVersion=2
 assert.equal((await run(plan)).ok,true)
 assert.equal((await db.query('select version from projects where id=$1',[id])).rows[0].version,3)
 assert.equal((await db.query("select version from collection_state where key='projects_order'")).rows[0].version,order+1)
 assert.equal((await run(plan)).code,'CONFLICT','duplicate import cannot reuse versions')
 console.log('F13 PASS: transactional import preserves snapshots and rejects stale preflight versions')
}finally{await db.close()}
