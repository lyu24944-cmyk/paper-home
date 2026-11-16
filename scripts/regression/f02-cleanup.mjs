import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import ts from 'typescript'
import { database, addAsset } from './database.mjs'

const db = await database()
try {
  const id = crypto.randomUUID()
  await addAsset(db, id)
  await db.query('SELECT cleanup_candidate_assets(ARRAY[$1]::uuid[],false)', [id])
  const saved = await db.query("SELECT save_project_draft(null,0,'pending','t','s','b','',$1,ARRAY[$1]::uuid[],null) AS r", [id])
  assert.equal(saved.rows[0].r.ok, false, 'F02: queued media must not become a new draft reference')
  await assert.rejects(db.query('INSERT INTO notes(slug,draft_image_asset_ids) VALUES ($1,ARRAY[$2]::uuid[])', ['direct', id]), /ready|就绪/)
  const claims = (await db.query('SELECT * FROM claim_media_cleanup(50)')).rows
  assert.equal(claims.length, 1)
  assert.equal((await db.query('SELECT * FROM claim_media_cleanup(50)')).rows.length, 0, 'active claim cannot be claimed twice')
  await db.query('SELECT fail_media_cleanup($1,$2,$3)', [claims[0].id, claims[0].claim_token, 'test failure'])
  assert.equal((await db.query('SELECT count(*)::int AS n FROM media_cleanup_queue')).rows[0].n, 1)
  await db.exec("UPDATE media_cleanup_queue SET next_retry_at=now()-interval '1 second'")

  const source = fs.readFileSync(new URL('../../supabase/functions/_shared/supabase.ts', import.meta.url), 'utf8').replace(/^import.*\r?\n/gm, '')
  const js = ts.transpileModule(source, { compilerOptions: { module: 99, target: 9 } }).outputText
  const { flushCleanupQueue } = await import('data:text/javascript;base64,' + Buffer.from(js + '\n//# sourceURL=paper-home-edge-test.js').toString('base64'))
  let storageFailure = true, confirmFailure = false, removals = 0
  const client = {
    async rpc(name, args) {
      if (name === 'finish_media_cleanup' && confirmFailure) return { data: null, error: { message: 'injected database failure' } }
      try {
        const keys = Object.keys(args)
        const q = `SELECT * FROM ${name}(${keys.map((k, i) => `${k}=>$${i + 1}`).join(',')})`
        const rows = (await db.query(q, Object.values(args))).rows
        return { data: name === 'claim_media_cleanup' ? rows : rows[0]?.[name], error: null }
      } catch (error) { return { data: null, error } }
    },
    storage: { from: () => ({ remove: async () => { removals++; return { error: storageFailure ? { message: 'injected Storage failure' } : null } } }) },
    from: () => ({ select: async () => ({ count: (await db.query('SELECT count(*)::int AS n FROM media_cleanup_queue')).rows[0].n, error: null }) }),
  }
  let result = await flushCleanupQueue(client)
  assert.equal(result.cleaned, 0); assert.equal(result.remaining, 1); assert.equal(result.errors.length, 1)
  storageFailure = false; confirmFailure = true
  await db.exec("UPDATE media_cleanup_queue SET next_retry_at=now()-interval '1 second'")
  result = await flushCleanupQueue(client)
  assert.equal(result.cleaned, 0); assert.equal(result.remaining, 1); assert.equal(result.errors.length, 1)
  confirmFailure = false
  await db.exec("UPDATE media_cleanup_queue SET next_retry_at=now()-interval '1 second'")
  result = await flushCleanupQueue(client)
  assert.deepEqual(result, { cleaned: 1, remaining: 0, errors: [] })
  assert.equal(removals, 3)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM media_assets')).rows[0].n, 0)
  const expired = crypto.randomUUID()
  await addAsset(db, expired)
  await db.query('SELECT cleanup_candidate_assets(ARRAY[$1]::uuid[],false)', [expired])
  const first = (await db.query('SELECT * FROM claim_media_cleanup(50)')).rows[0]
  await db.exec("UPDATE media_cleanup_queue SET claimed_at=now()-interval '6 minutes',next_retry_at=now()-interval '1 second'")
  const second = (await db.query('SELECT * FROM claim_media_cleanup(50)')).rows[0]
  assert.notEqual(first.claim_token, second.claim_token)
  assert.equal((await db.query('SELECT finish_media_cleanup($1,$2) AS ok', [first.id, first.claim_token])).rows[0].ok, false)
  await assert.rejects(db.query("INSERT INTO projects(slug,published_snapshot) VALUES ('bad-published',jsonb_build_object('cover_asset_id',$1::text))", [expired]), /ready/)
  console.log('F02 PASS: draft/direct references rejected; claims exclusive; Storage/DB failures retry without false success')
} finally { await db.close() }

// Upgrade an existing inconsistent database; never silently revive/delete its files.
const legacy = await database({ before: '202611160001' })
try {
  const id = crypto.randomUUID()
  await addAsset(legacy, id)
  await legacy.query('SELECT cleanup_candidate_assets(ARRAY[$1]::uuid[],false)', [id])
  await legacy.query("INSERT INTO notes(slug,draft_image_asset_ids) VALUES ('legacy',ARRAY[$1]::uuid[])", [id])
  await legacy.exec(fs.readFileSync(new URL('../../supabase/migrations/202611160001_safe_media_cleanup.sql', import.meta.url), 'utf8'))
  assert.equal((await legacy.query('SELECT * FROM claim_media_cleanup(50)')).rows.length, 0)
  assert((await legacy.query('SELECT last_error FROM media_cleanup_queue')).rows[0].last_error.includes('blocked'))
  console.log('F02 PASS: historical inconsistent references block deletion and retain diagnostics')
} finally { await legacy.close() }
