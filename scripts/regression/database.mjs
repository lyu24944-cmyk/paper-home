import fs from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'

export async function database({ before } = {}) {
  const db = new PGlite({ extensions: { pgcrypto } })
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$SELECT coalesce(nullif(current_setting('request.jwt.claim.role',true),''),'service_role')$$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    CREATE TABLE storage.objects(id uuid,bucket_id text);
  `)
  for (const file of fs.readdirSync(new URL('../../supabase/migrations/', import.meta.url)).sort()) {
    if (before && file >= before) continue
    await db.exec(fs.readFileSync(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'))
  }
  await db.exec("INSERT INTO auth.users VALUES ('00000000-0000-0000-0000-000000000001')")
  return db
}

export async function addAsset(db, id) {
  await db.query(`INSERT INTO media_assets(id,kind,status,display_path,mime_type,byte_size,created_by)
    VALUES ($1,'image','ready',$2,'image/png',32,'00000000-0000-0000-0000-000000000001')`, [id, `images/${id}/display.png`])
}
