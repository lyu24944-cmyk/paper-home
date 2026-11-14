-- Cottage CMS schema, private storage, atomic version checks, and retryable media cleanup.

create extension if not exists pgcrypto;

-- 1. Single-admin registry (bound strictly to auth.users UUID, never email strings)
create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = auth.uid()
  );
$$;

-- 2. Media asset metadata (actual binaries live inside private bucket `cottage-media`)
create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('image', 'video')),
  status text not null default 'uploading' check (status in ('uploading', 'ready', 'pending_delete')),
  display_path text not null unique,
  thumb_path text,
  mime_type text not null,
  byte_size bigint not null check (byte_size > 0 and byte_size <= 52428800),
  width int,
  height int,
  duration_sec double precision,
  original_filename text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 3. Content tables: working draft fields + separate published_snapshot JSONB
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sort_order int not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  version int not null default 1,
  draft_title text not null default '',
  draft_summary text not null default '',
  draft_body text not null default '',
  draft_demo_url text not null default '',
  draft_cover_asset_id uuid references public.media_assets(id) on delete restrict,
  draft_gallery_asset_ids uuid[] not null default '{}',
  draft_video_asset_id uuid references public.media_assets(id) on delete restrict,
  published_snapshot jsonb,
  has_unpublished_changes boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  sort_order int not null default 0,
  is_published boolean not null default false,
  published_at timestamptz,
  version int not null default 1,
  draft_title text not null default '',
  draft_body text not null default '',
  draft_project_id uuid references public.projects(id) on delete set null,
  draft_image_asset_ids uuid[] not null default '{}',
  draft_video_asset_id uuid references public.media_assets(id) on delete restrict,
  published_snapshot jsonb,
  has_unpublished_changes boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.site_profile (
  id text primary key check (id = 'owner'),
  is_published boolean not null default false,
  published_at timestamptz,
  version int not null default 1,
  draft_display_name text not null default '',
  draft_bio text not null default '',
  draft_focus_areas text not null default '',
  draft_avatar_asset_id uuid references public.media_assets(id) on delete restrict,
  draft_contact_email text not null default '',
  draft_contact_links jsonb not null default '[]'::jsonb,
  published_snapshot jsonb,
  has_unpublished_changes boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.site_profile (id)
values ('owner')
on conflict (id) do nothing;

-- 4. Collection order version locks
create table if not exists public.collection_state (
  key text primary key check (key in ('projects_order', 'notes_order')),
  version int not null default 1,
  updated_at timestamptz not null default now()
);

insert into public.collection_state (key, version)
values ('projects_order', 1), ('notes_order', 1)
on conflict (key) do nothing;

-- 5. Retryable media cleanup queue
create table if not exists public.media_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid,
  storage_paths text[] not null,
  attempts int not null default 0,
  last_error text,
  next_retry_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

-- 6. Private Storage Bucket & strict Admin-only Storage RLS
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'cottage-media',
  'cottage-media',
  false,
  52428800,
  array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/webm']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = 52428800,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "cottage_media_admin_all" on storage.objects;
create policy "cottage_media_admin_all"
on storage.objects
for all
to authenticated
using (bucket_id = 'cottage-media' and public.is_admin())
with check (bucket_id = 'cottage-media' and public.is_admin());

-- 7. Table RLS (deny anon direct access to base tables; admin only)
alter table public.admin_users enable row level security;
alter table public.media_assets enable row level security;
alter table public.projects enable row level security;
alter table public.notes enable row level security;
alter table public.site_profile enable row level security;
alter table public.collection_state enable row level security;
alter table public.media_cleanup_queue enable row level security;

drop policy if exists "admin_users_self_select" on public.admin_users;
create policy "admin_users_self_select"
on public.admin_users for select to authenticated
using (auth.uid() = user_id);

drop policy if exists "media_assets_admin_all" on public.media_assets;
create policy "media_assets_admin_all"
on public.media_assets for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "projects_admin_all" on public.projects;
create policy "projects_admin_all"
on public.projects for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "notes_admin_all" on public.notes;
create policy "notes_admin_all"
on public.notes for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "site_profile_admin_all" on public.site_profile;
create policy "site_profile_admin_all"
on public.site_profile for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "collection_state_admin_all" on public.collection_state;
create policy "collection_state_admin_all"
on public.collection_state for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists "media_cleanup_queue_admin_all" on public.media_cleanup_queue;
create policy "media_cleanup_queue_admin_all"
on public.media_cleanup_queue for all to authenticated
using (public.is_admin()) with check (public.is_admin());

-- 8. Asset reference helpers (used by signing endpoint & safe cleanup)
create or replace function public.safe_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
begin
  if p_text is null or btrim(p_text) = '' then
    return null;
  end if;
  return p_text::uuid;
exception when others then
  return null;
end;
$$;

create or replace function public.snapshot_contains_asset(p_snapshot jsonb, p_asset_id uuid)
returns boolean
language sql
immutable
as $$
  select
    p_snapshot is not null
    and (
      public.safe_uuid(p_snapshot->>'cover_asset_id') = p_asset_id
      or public.safe_uuid(p_snapshot->>'video_asset_id') = p_asset_id
      or public.safe_uuid(p_snapshot->>'avatar_asset_id') = p_asset_id
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(p_snapshot->'gallery_asset_ids', '[]'::jsonb)) as g(val)
        where public.safe_uuid(g.val) = p_asset_id
      )
      or exists (
        select 1
        from jsonb_array_elements_text(coalesce(p_snapshot->'image_asset_ids', '[]'::jsonb)) as im(val)
        where public.safe_uuid(im.val) = p_asset_id
      )
    );
$$;

create or replace function public.is_asset_public(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    exists (
      select 1 from public.projects
      where is_published = true and public.snapshot_contains_asset(published_snapshot, p_asset_id)
    )
    or exists (
      select 1 from public.notes
      where is_published = true and public.snapshot_contains_asset(published_snapshot, p_asset_id)
    )
    or exists (
      select 1 from public.site_profile
      where id = 'owner' and is_published = true and public.snapshot_contains_asset(published_snapshot, p_asset_id)
    );
$$;

create or replace function public.is_asset_referenced(p_asset_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_asset_public(p_asset_id)
    or exists (
      select 1 from public.projects
      where draft_cover_asset_id = p_asset_id
         or draft_video_asset_id = p_asset_id
         or p_asset_id = any(draft_gallery_asset_ids)
         or public.snapshot_contains_asset(published_snapshot, p_asset_id)
    )
    or exists (
      select 1 from public.notes
      where draft_video_asset_id = p_asset_id
         or p_asset_id = any(draft_image_asset_ids)
         or public.snapshot_contains_asset(published_snapshot, p_asset_id)
    )
    or exists (
      select 1 from public.site_profile
      where id = 'owner'
        and (draft_avatar_asset_id = p_asset_id or public.snapshot_contains_asset(published_snapshot, p_asset_id))
    );
$$;

create or replace function public.enqueue_unreferenced_assets(p_candidate_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_asset public.media_assets%rowtype;
  v_paths text[];
  v_enqueued int := 0;
begin
  if p_candidate_ids is null then
    return 0;
  end if;

  for v_id in select distinct unnest(p_candidate_ids) loop
    if v_id is null then
      continue;
    end if;
    if public.is_asset_referenced(v_id) then
      continue;
    end if;

    select * into v_asset
    from public.media_assets
    where id = v_id and status <> 'pending_delete'
    for update;
    if not found then
      continue;
    end if;

    v_paths := array_remove(array[v_asset.display_path, v_asset.thumb_path], null);
    if array_length(v_paths, 1) > 0 then
      insert into public.media_cleanup_queue (asset_id, storage_paths)
      values (v_id, v_paths);
      v_enqueued := v_enqueued + 1;
    end if;

    update public.media_assets set status = 'pending_delete' where id = v_id;
  end loop;

  return v_enqueued;
end;
$$;

create or replace function public.assert_caller_admin()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and not public.is_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.all_assets_ready(p_ids uuid[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with req as (
    select distinct id from unnest(coalesce(p_ids, '{}'::uuid[])) as id where id is not null
  )
  select not exists (
    select 1 from req r
    left join public.media_assets m on m.id = r.id
    where m.id is null or m.status <> 'ready'
  );
$$;

-- 9. Atomic Project RPCs
create or replace function public.save_project_draft(
  p_id uuid,
  p_expected_version int,
  p_slug text,
  p_title text,
  p_summary text,
  p_body text,
  p_demo_url text,
  p_cover_asset_id uuid,
  p_gallery_asset_ids uuid[],
  p_video_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.projects%rowtype;
  v_updated public.projects%rowtype;
  v_next_order int;
  v_detached uuid[];
  v_gallery uuid[] := coalesce(p_gallery_asset_ids, '{}'::uuid[]);
begin
  perform public.assert_caller_admin();

  if p_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_next_order from public.projects;
    insert into public.projects (
      slug, sort_order, is_published, version,
      draft_title, draft_summary, draft_body, draft_demo_url,
      draft_cover_asset_id, draft_gallery_asset_ids, draft_video_asset_id,
      published_snapshot, has_unpublished_changes
    ) values (
      coalesce(nullif(btrim(p_slug), ''), 'project-' || substr(gen_random_uuid()::text, 1, 8)),
      v_next_order, false, 1,
      coalesce(p_title, ''), coalesce(p_summary, ''), coalesce(p_body, ''), coalesce(btrim(p_demo_url), ''),
      p_cover_asset_id, v_gallery, p_video_asset_id,
      null, true
    )
    returning * into v_updated;

    return jsonb_build_object('ok', true, 'project', to_jsonb(v_updated));
  end if;

  select * into v_row from public.projects where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  v_detached := array_remove(
    array[v_row.draft_cover_asset_id, v_row.draft_video_asset_id] || coalesce(v_row.draft_gallery_asset_ids, '{}'::uuid[]),
    null
  );

  update public.projects
  set
    draft_title = coalesce(p_title, ''),
    draft_summary = coalesce(p_summary, ''),
    draft_body = coalesce(p_body, ''),
    draft_demo_url = coalesce(btrim(p_demo_url), ''),
    draft_cover_asset_id = p_cover_asset_id,
    draft_gallery_asset_ids = v_gallery,
    draft_video_asset_id = p_video_asset_id,
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_detached);
  return jsonb_build_object('ok', true, 'project', to_jsonb(v_updated));
end;
$$;

create or replace function public.publish_project(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.projects%rowtype;
  v_updated public.projects%rowtype;
  v_errors text[] := '{}'::text[];
  v_old_pub_assets uuid[] := '{}'::uuid[];
  v_pub_at timestamptz;
  v_snapshot jsonb;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.projects where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if btrim(v_row.draft_title) = '' then v_errors := array_append(v_errors, '请填写作品标题'); end if;
  if btrim(v_row.draft_summary) = '' then v_errors := array_append(v_errors, '请填写作品简介'); end if;
  if btrim(v_row.draft_body) = '' then v_errors := array_append(v_errors, '请填写作品正文'); end if;
  if v_row.draft_cover_asset_id is null then v_errors := array_append(v_errors, '请上传作品封面图'); end if;

  if not public.all_assets_ready(
    array_remove(array[v_row.draft_cover_asset_id, v_row.draft_video_asset_id] || coalesce(v_row.draft_gallery_asset_ids, '{}'::uuid[]), null)
  ) then
    v_errors := array_append(v_errors, '部分图片或视频尚未上传完成，请等待上传就绪后再发布');
  end if;

  if array_length(v_errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'errors', to_jsonb(v_errors));
  end if;

  if v_row.published_snapshot is not null then
    v_old_pub_assets := array_remove(
      array[
        public.safe_uuid(v_row.published_snapshot->>'cover_asset_id'),
        public.safe_uuid(v_row.published_snapshot->>'video_asset_id')
      ] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'gallery_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  v_pub_at := coalesce(v_row.published_at, now());
  v_snapshot := jsonb_build_object(
    'title', v_row.draft_title,
    'summary', v_row.draft_summary,
    'body', v_row.draft_body,
    'demo_url', v_row.draft_demo_url,
    'cover_asset_id', v_row.draft_cover_asset_id,
    'gallery_asset_ids', to_jsonb(coalesce(v_row.draft_gallery_asset_ids, '{}'::uuid[])),
    'video_asset_id', v_row.draft_video_asset_id,
    'published_at', v_pub_at
  );

  update public.projects
  set
    is_published = true,
    published_at = v_pub_at,
    published_snapshot = v_snapshot,
    has_unpublished_changes = false,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_old_pub_assets);
  return jsonb_build_object('ok', true, 'project', to_jsonb(v_updated));
end;
$$;

create or replace function public.unpublish_project(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.projects%rowtype;
  v_updated public.projects%rowtype;
  v_old_pub_assets uuid[] := '{}'::uuid[];
begin
  perform public.assert_caller_admin();

  select * into v_row from public.projects where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if v_row.published_snapshot is not null then
    v_old_pub_assets := array_remove(
      array[
        public.safe_uuid(v_row.published_snapshot->>'cover_asset_id'),
        public.safe_uuid(v_row.published_snapshot->>'video_asset_id')
      ] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'gallery_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  update public.projects
  set
    is_published = false,
    published_snapshot = null,
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_old_pub_assets);
  return jsonb_build_object('ok', true, 'project', to_jsonb(v_updated));
end;
$$;

create or replace function public.delete_project(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.projects%rowtype;
  v_candidates uuid[] := '{}'::uuid[];
begin
  perform public.assert_caller_admin();

  select * into v_row from public.projects where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  v_candidates := array_remove(
    array[v_row.draft_cover_asset_id, v_row.draft_video_asset_id]
    || coalesce(v_row.draft_gallery_asset_ids, '{}'::uuid[]),
    null
  );

  if v_row.published_snapshot is not null then
    v_candidates := v_candidates || array_remove(
      array[
        public.safe_uuid(v_row.published_snapshot->>'cover_asset_id'),
        public.safe_uuid(v_row.published_snapshot->>'video_asset_id')
      ] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'gallery_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  delete from public.projects where id = p_id;
  perform public.enqueue_unreferenced_assets(v_candidates);
  return jsonb_build_object('ok', true, 'deleted_id', p_id);
end;
$$;

create or replace function public.reorder_projects(
  p_ordered_ids uuid[],
  p_expected_order_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.collection_state%rowtype;
  v_existing_ids uuid[];
  v_idx int;
begin
  perform public.assert_caller_admin();

  select * into v_state from public.collection_state where key = 'projects_order' for update;
  select array_agg(id order by sort_order asc, created_at asc) into v_existing_ids from public.projects;

  if v_state.version <> p_expected_order_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFLICT',
      'order_version', v_state.version,
      'latest_order', to_jsonb(coalesce(v_existing_ids, '{}'::uuid[]))
    );
  end if;

  if coalesce((select array_agg(x order by x) from unnest(p_ordered_ids) x), '{}'::uuid[])
     <> coalesce((select array_agg(x order by x) from unnest(coalesce(v_existing_ids, '{}'::uuid[])) x), '{}'::uuid[]) then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFLICT',
      'order_version', v_state.version,
      'latest_order', to_jsonb(coalesce(v_existing_ids, '{}'::uuid[]))
    );
  end if;

  for v_idx in 1..coalesce(array_length(p_ordered_ids, 1), 0) loop
    update public.projects set sort_order = v_idx - 1 where id = p_ordered_ids[v_idx];
  end loop;

  update public.collection_state
  set version = version + 1, updated_at = now()
  where key = 'projects_order'
  returning version into v_state.version;

  return jsonb_build_object('ok', true, 'order_version', v_state.version);
end;
$$;

-- 10. Atomic Note RPCs
create or replace function public.save_note_draft(
  p_id uuid,
  p_expected_version int,
  p_slug text,
  p_title text,
  p_body text,
  p_project_id uuid,
  p_image_asset_ids uuid[],
  p_video_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notes%rowtype;
  v_updated public.notes%rowtype;
  v_next_order int;
  v_detached uuid[];
  v_images uuid[] := coalesce(p_image_asset_ids, '{}'::uuid[]);
begin
  perform public.assert_caller_admin();

  if p_id is null then
    select coalesce(max(sort_order), -1) + 1 into v_next_order from public.notes;
    insert into public.notes (
      slug, sort_order, is_published, version,
      draft_title, draft_body, draft_project_id,
      draft_image_asset_ids, draft_video_asset_id,
      published_snapshot, has_unpublished_changes
    ) values (
      coalesce(nullif(btrim(p_slug), ''), 'note-' || substr(gen_random_uuid()::text, 1, 8)),
      v_next_order, false, 1,
      coalesce(p_title, ''), coalesce(p_body, ''), p_project_id,
      v_images, p_video_asset_id,
      null, true
    )
    returning * into v_updated;

    return jsonb_build_object('ok', true, 'note', to_jsonb(v_updated));
  end if;

  select * into v_row from public.notes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  v_detached := array_remove(
    array[v_row.draft_video_asset_id] || coalesce(v_row.draft_image_asset_ids, '{}'::uuid[]),
    null
  );

  update public.notes
  set
    draft_title = coalesce(p_title, ''),
    draft_body = coalesce(p_body, ''),
    draft_project_id = p_project_id,
    draft_image_asset_ids = v_images,
    draft_video_asset_id = p_video_asset_id,
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_detached);
  return jsonb_build_object('ok', true, 'note', to_jsonb(v_updated));
end;
$$;

create or replace function public.publish_note(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notes%rowtype;
  v_updated public.notes%rowtype;
  v_errors text[] := '{}'::text[];
  v_old_pub_assets uuid[] := '{}'::uuid[];
  v_pub_at timestamptz;
  v_snapshot jsonb;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.notes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if btrim(v_row.draft_title) = '' then v_errors := array_append(v_errors, '请填写手记标题'); end if;
  if btrim(v_row.draft_body) = '' then v_errors := array_append(v_errors, '请填写手记正文'); end if;

  if not public.all_assets_ready(
    array_remove(array[v_row.draft_video_asset_id] || coalesce(v_row.draft_image_asset_ids, '{}'::uuid[]), null)
  ) then
    v_errors := array_append(v_errors, '部分图片或视频尚未上传完成，请等待上传就绪后再发布');
  end if;

  if array_length(v_errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'errors', to_jsonb(v_errors));
  end if;

  if v_row.published_snapshot is not null then
    v_old_pub_assets := array_remove(
      array[public.safe_uuid(v_row.published_snapshot->>'video_asset_id')] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'image_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  v_pub_at := coalesce(v_row.published_at, now());
  v_snapshot := jsonb_build_object(
    'title', v_row.draft_title,
    'body', v_row.draft_body,
    'project_id', v_row.draft_project_id,
    'image_asset_ids', to_jsonb(coalesce(v_row.draft_image_asset_ids, '{}'::uuid[])),
    'video_asset_id', v_row.draft_video_asset_id,
    'published_at', v_pub_at
  );

  update public.notes
  set
    is_published = true,
    published_at = v_pub_at,
    published_snapshot = v_snapshot,
    has_unpublished_changes = false,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_old_pub_assets);
  return jsonb_build_object('ok', true, 'note', to_jsonb(v_updated));
end;
$$;

create or replace function public.unpublish_note(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notes%rowtype;
  v_updated public.notes%rowtype;
  v_old_pub_assets uuid[] := '{}'::uuid[];
begin
  perform public.assert_caller_admin();

  select * into v_row from public.notes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if v_row.published_snapshot is not null then
    v_old_pub_assets := array_remove(
      array[public.safe_uuid(v_row.published_snapshot->>'video_asset_id')] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'image_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  update public.notes
  set
    is_published = false,
    published_snapshot = null,
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = p_id
  returning * into v_updated;

  perform public.enqueue_unreferenced_assets(v_old_pub_assets);
  return jsonb_build_object('ok', true, 'note', to_jsonb(v_updated));
end;
$$;

create or replace function public.delete_note(
  p_id uuid,
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.notes%rowtype;
  v_candidates uuid[] := '{}'::uuid[];
begin
  perform public.assert_caller_admin();

  select * into v_row from public.notes where id = p_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  v_candidates := array_remove(
    array[v_row.draft_video_asset_id] || coalesce(v_row.draft_image_asset_ids, '{}'::uuid[]),
    null
  );

  if v_row.published_snapshot is not null then
    v_candidates := v_candidates || array_remove(
      array[public.safe_uuid(v_row.published_snapshot->>'video_asset_id')] || coalesce(
        (select array_agg(public.safe_uuid(x)) from jsonb_array_elements_text(coalesce(v_row.published_snapshot->'image_asset_ids', '[]'::jsonb)) x),
        '{}'::uuid[]
      ),
      null
    );
  end if;

  delete from public.notes where id = p_id;
  perform public.enqueue_unreferenced_assets(v_candidates);
  return jsonb_build_object('ok', true, 'deleted_id', p_id);
end;
$$;

create or replace function public.reorder_notes(
  p_ordered_ids uuid[],
  p_expected_order_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state public.collection_state%rowtype;
  v_existing_ids uuid[];
  v_idx int;
begin
  perform public.assert_caller_admin();

  select * into v_state from public.collection_state where key = 'notes_order' for update;
  select array_agg(id order by sort_order asc, created_at asc) into v_existing_ids from public.notes;

  if v_state.version <> p_expected_order_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFLICT',
      'order_version', v_state.version,
      'latest_order', to_jsonb(coalesce(v_existing_ids, '{}'::uuid[]))
    );
  end if;

  if coalesce((select array_agg(x order by x) from unnest(p_ordered_ids) x), '{}'::uuid[])
     <> coalesce((select array_agg(x order by x) from unnest(coalesce(v_existing_ids, '{}'::uuid[])) x), '{}'::uuid[]) then
    return jsonb_build_object(
      'ok', false,
      'code', 'CONFLICT',
      'order_version', v_state.version,
      'latest_order', to_jsonb(coalesce(v_existing_ids, '{}'::uuid[]))
    );
  end if;

  for v_idx in 1..coalesce(array_length(p_ordered_ids, 1), 0) loop
    update public.notes set sort_order = v_idx - 1 where id = p_ordered_ids[v_idx];
  end loop;

  update public.collection_state
  set version = version + 1, updated_at = now()
  where key = 'notes_order'
  returning version into v_state.version;

  return jsonb_build_object('ok', true, 'order_version', v_state.version);
end;
$$;

-- 11. Atomic Profile RPCs
create or replace function public.save_profile_draft(
  p_expected_version int,
  p_display_name text,
  p_bio text,
  p_focus_areas text,
  p_avatar_asset_id uuid,
  p_contact_email text,
  p_contact_links jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_profile%rowtype;
  v_updated public.site_profile%rowtype;
  v_old_avatar uuid;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.site_profile where id = 'owner' for update;
  if not found then
    insert into public.site_profile (id) values ('owner') returning * into v_row;
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  v_old_avatar := v_row.draft_avatar_asset_id;

  update public.site_profile
  set
    draft_display_name = coalesce(p_display_name, ''),
    draft_bio = coalesce(p_bio, ''),
    draft_focus_areas = coalesce(p_focus_areas, ''),
    draft_avatar_asset_id = p_avatar_asset_id,
    draft_contact_email = coalesce(btrim(p_contact_email), ''),
    draft_contact_links = coalesce(p_contact_links, '[]'::jsonb),
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = 'owner'
  returning * into v_updated;

  if v_old_avatar is not null and v_old_avatar is distinct from p_avatar_asset_id then
    perform public.enqueue_unreferenced_assets(array[v_old_avatar]);
  end if;

  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_updated));
end;
$$;

create or replace function public.publish_profile(
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_profile%rowtype;
  v_updated public.site_profile%rowtype;
  v_errors text[] := '{}'::text[];
  v_old_avatar uuid;
  v_pub_at timestamptz;
  v_snapshot jsonb;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.site_profile where id = 'owner' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if btrim(v_row.draft_display_name) = ''
     and btrim(v_row.draft_bio) = ''
     and btrim(v_row.draft_focus_areas) = ''
     and v_row.draft_avatar_asset_id is null
     and btrim(v_row.draft_contact_email) = ''
     and jsonb_array_length(coalesce(v_row.draft_contact_links, '[]'::jsonb)) = 0 then
    v_errors := array_append(v_errors, '请至少填写一项公开介绍内容后再发布');
  end if;

  if v_row.draft_avatar_asset_id is not null and not public.all_assets_ready(array[v_row.draft_avatar_asset_id]) then
    v_errors := array_append(v_errors, '头像尚未上传完成，请等待上传就绪后再发布');
  end if;

  if array_length(v_errors, 1) > 0 then
    return jsonb_build_object('ok', false, 'code', 'VALIDATION_ERROR', 'errors', to_jsonb(v_errors));
  end if;

  if v_row.published_snapshot is not null then
    v_old_avatar := public.safe_uuid(v_row.published_snapshot->>'avatar_asset_id');
  end if;

  v_pub_at := coalesce(v_row.published_at, now());
  v_snapshot := jsonb_build_object(
    'display_name', v_row.draft_display_name,
    'bio', v_row.draft_bio,
    'focus_areas', v_row.draft_focus_areas,
    'avatar_asset_id', v_row.draft_avatar_asset_id,
    'contact_email', v_row.draft_contact_email,
    'contact_links', coalesce(v_row.draft_contact_links, '[]'::jsonb),
    'published_at', v_pub_at
  );

  update public.site_profile
  set
    is_published = true,
    published_at = v_pub_at,
    published_snapshot = v_snapshot,
    has_unpublished_changes = false,
    version = version + 1,
    updated_at = now()
  where id = 'owner'
  returning * into v_updated;

  if v_old_avatar is not null and v_old_avatar is distinct from v_row.draft_avatar_asset_id then
    perform public.enqueue_unreferenced_assets(array[v_old_avatar]);
  end if;

  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_updated));
end;
$$;

create or replace function public.unpublish_profile(
  p_expected_version int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_profile%rowtype;
  v_updated public.site_profile%rowtype;
  v_old_avatar uuid;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.site_profile where id = 'owner' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'NOT_FOUND');
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if v_row.published_snapshot is not null then
    v_old_avatar := public.safe_uuid(v_row.published_snapshot->>'avatar_asset_id');
  end if;

  update public.site_profile
  set
    is_published = false,
    published_snapshot = null,
    has_unpublished_changes = true,
    version = version + 1,
    updated_at = now()
  where id = 'owner'
  returning * into v_updated;

  if v_old_avatar is not null then
    perform public.enqueue_unreferenced_assets(array[v_old_avatar]);
  end if;

  return jsonb_build_object('ok', true, 'profile', to_jsonb(v_updated));
end;
$$;

-- 12. Candidate & orphan media sweep RPCs
create or replace function public.cleanup_candidate_assets(
  p_candidate_ids uuid[],
  p_sweep_orphans boolean default false
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int := 0;
  v_orphans uuid[];
begin
  perform public.assert_caller_admin();

  if p_candidate_ids is not null and array_length(p_candidate_ids, 1) > 0 then
    v_count := v_count + public.enqueue_unreferenced_assets(p_candidate_ids);
  end if;

  if p_sweep_orphans then
    select array_agg(id)
    into v_orphans
    from public.media_assets
    where created_at < now() - interval '24 hours'
      and status <> 'pending_delete'
      and not public.is_asset_referenced(id);

    if v_orphans is not null and array_length(v_orphans, 1) > 0 then
      v_count := v_count + public.enqueue_unreferenced_assets(v_orphans);
    end if;
  end if;

  return v_count;
end;
$$;

-- Tighten function execution privileges
revoke all on function public.is_asset_public(uuid) from public;
grant execute on function public.is_asset_public(uuid) to service_role;

revoke all on function public.is_asset_referenced(uuid) from public;
grant execute on function public.is_asset_referenced(uuid) to service_role;

revoke all on function public.enqueue_unreferenced_assets(uuid[]) from public;
grant execute on function public.enqueue_unreferenced_assets(uuid[]) to service_role;

revoke all on function public.cleanup_candidate_assets(uuid[], boolean) from public, anon;
grant execute on function public.cleanup_candidate_assets(uuid[], boolean) to authenticated, service_role;

revoke all on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) to authenticated, service_role;

revoke all on function public.publish_project(uuid, int) from public, anon;
grant execute on function public.publish_project(uuid, int) to authenticated, service_role;

revoke all on function public.unpublish_project(uuid, int) from public, anon;
grant execute on function public.unpublish_project(uuid, int) to authenticated, service_role;

revoke all on function public.delete_project(uuid, int) from public, anon;
grant execute on function public.delete_project(uuid, int) to authenticated, service_role;

revoke all on function public.reorder_projects(uuid[], int) from public, anon;
grant execute on function public.reorder_projects(uuid[], int) to authenticated, service_role;

revoke all on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) from public, anon;
grant execute on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) to authenticated, service_role;

revoke all on function public.publish_note(uuid, int) from public, anon;
grant execute on function public.publish_note(uuid, int) to authenticated, service_role;

revoke all on function public.unpublish_note(uuid, int) from public, anon;
grant execute on function public.unpublish_note(uuid, int) to authenticated, service_role;

revoke all on function public.delete_note(uuid, int) from public, anon;
grant execute on function public.delete_note(uuid, int) to authenticated, service_role;

revoke all on function public.reorder_notes(uuid[], int) from public, anon;
grant execute on function public.reorder_notes(uuid[], int) to authenticated, service_role;

revoke all on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) from public, anon;
grant execute on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.publish_profile(int) from public, anon;
grant execute on function public.publish_profile(int) to authenticated, service_role;

revoke all on function public.unpublish_profile(int) from public, anon;
grant execute on function public.unpublish_profile(int) to authenticated, service_role;
