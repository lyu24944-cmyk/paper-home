-- Paper Home Cottage CMS: Phase 3 schema alignment & security hardening
-- 1. Align cloud schema with Local Studio: site_settings, profile now_notes & quotes
-- 2. Harden RPC locks, exception mapping, published snapshot FK sync, and missing REVOKEs

-- 1. Site settings singleton (admin-writable, read through edge functions)
create table if not exists public.site_settings (
  id text primary key check (id = 'main'),
  home_name text not null default '我的小屋',
  plaque_title text not null default '欢迎回家',
  plaque_subtitle text not null default '留一点时间，慢慢逛',
  yard_heading text not null default '来家里坐坐。',
  yard_subtitle text not null default '推开门，里面是我的作品、过程记录与自我介绍。',
  default_atmosphere text not null default 'daylight'
    check (default_atmosphere in ('dawn', 'daylight', 'golden', 'night', 'auto')),
  default_weather text not null default 'clear'
    check (default_weather in ('clear', 'rain')),
  version int not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.site_settings enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'site_settings'
      and policyname = 'site_settings_admin_all'
  ) then
    create policy "site_settings_admin_all"
    on public.site_settings
    for all
    to authenticated
    using (public.is_admin())
    with check (public.is_admin());
  end if;
end $$;

insert into public.site_settings (id)
values ('main')
on conflict (id) do nothing;

-- 2. Extend site_profile with now_notes and quotes
alter table public.site_profile
  add column if not exists draft_now_notes text[] not null default '{}'::text[],
  add column if not exists draft_quotes text[] not null default '{}'::text[];

-- 3. Fix TOCTOU lock order in enqueue_unreferenced_assets (lock media row BEFORE reference check)
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

  for v_id in select distinct unnest(p_candidate_ids) order by 1 loop
    if v_id is null then
      continue;
    end if;

    select * into v_asset
    from public.media_assets
    where id = v_id and status <> 'pending_delete'
    for update;
    if not found then
      continue;
    end if;

    if public.is_asset_referenced(v_id) then
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

-- 4. Batch helper for media-sign edge function (replaces N per-asset RPC calls)
create or replace function public.filter_public_asset_ids(p_ids uuid[])
returns uuid[]
language plpgsql
security definer
set search_path = public
as $$
declare
  v_allowed uuid[];
begin
  if p_ids is null then
    return '{}'::uuid[];
  end if;

  select coalesce(array_agg(id), '{}'::uuid[])
  into v_allowed
  from (
    select distinct u as id
    from unnest(p_ids) as u
    where u is not null
      and public.is_asset_public(u)
  ) t;

  return coalesce(v_allowed, '{}'::uuid[]);
end;
$$;

-- 5. Site settings save RPC with optimistic concurrency control
create or replace function public.save_site_settings(
  p_expected_version int,
  p_home_name text,
  p_plaque_title text,
  p_plaque_subtitle text,
  p_yard_heading text,
  p_yard_subtitle text,
  p_default_atmosphere text,
  p_default_weather text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.site_settings%rowtype;
  v_updated public.site_settings%rowtype;
  v_home_name text := left(btrim(coalesce(p_home_name, '')), 12);
  v_plaque_title text := left(btrim(coalesce(p_plaque_title, '')), 16);
  v_plaque_subtitle text := left(btrim(coalesce(p_plaque_subtitle, '')), 32);
  v_yard_heading text := left(btrim(coalesce(p_yard_heading, '')), 20);
  v_yard_subtitle text := left(btrim(coalesce(p_yard_subtitle, '')), 80);
  v_atmo text := case
    when p_default_atmosphere in ('dawn', 'daylight', 'golden', 'night', 'auto') then p_default_atmosphere
    else 'daylight'
  end;
  v_weather text := case
    when p_default_weather in ('clear', 'rain') then p_default_weather
    else 'clear'
  end;
begin
  perform public.assert_caller_admin();

  select * into v_row from public.site_settings where id = 'main' for update;
  if not found then
    insert into public.site_settings (id) values ('main') returning * into v_row;
  end if;

  if p_expected_version is not null and v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  if v_home_name = '' then
    return jsonb_build_object(
      'ok', false,
      'code', 'VALIDATION_ERROR',
      'errors', to_jsonb(array['请先为小屋写一个名字。']::text[])
    );
  end if;

  if v_plaque_title = '' then v_plaque_title := '欢迎回家'; end if;
  if v_plaque_subtitle = '' then v_plaque_subtitle := '留一点时间，慢慢逛'; end if;
  if v_yard_heading = '' then v_yard_heading := '来家里坐坐。'; end if;
  if v_yard_subtitle = '' then v_yard_subtitle := '推开门，里面是我的作品、过程记录与自我介绍。'; end if;

  update public.site_settings
  set
    home_name = v_home_name,
    plaque_title = v_plaque_title,
    plaque_subtitle = v_plaque_subtitle,
    yard_heading = v_yard_heading,
    yard_subtitle = v_yard_subtitle,
    default_atmosphere = v_atmo,
    default_weather = v_weather,
    version = version + 1,
    updated_at = now()
  where id = 'main'
  returning * into v_updated;

  return jsonb_build_object('ok', true, 'settings', to_jsonb(v_updated));
end;
$$;

-- 6. Catch unique_violation / foreign_key_violation cleanly in project & note draft saves
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
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'SLUG_TAKEN');
  when foreign_key_violation then
    return jsonb_build_object(
      'ok', false,
      'code', 'VALIDATION_ERROR',
      'errors', to_jsonb(array['引用的媒体素材不存在或已被清理。']::text[])
    );
end;
$$;

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
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'code', 'SLUG_TAKEN');
  when foreign_key_violation then
    return jsonb_build_object(
      'ok', false,
      'code', 'VALIDATION_ERROR',
      'errors', to_jsonb(array['关联的作品或引用的媒体素材不存在。']::text[])
    );
end;
$$;

-- 7. Serialize reorder RPCs against concurrent row changes
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
  perform 1 from public.projects for update;
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
  perform 1 from public.notes for update;
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

-- 8. Clean up stale project references inside notes.published_snapshot when a project row is removed
create or replace function public.clear_deleted_project_from_note_snapshots()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notes
  set
    published_snapshot = jsonb_set(published_snapshot, '{project_id}', 'null'::jsonb),
    updated_at = now()
  where published_snapshot is not null
    and published_snapshot->>'project_id' = old.id::text;
  return old;
end;
$$;

create or replace trigger trg_projects_clear_note_snapshot
after delete on public.projects
for each row
execute function public.clear_deleted_project_from_note_snapshots();

-- 9. Update profile RPCs for now_notes and quotes (9-arg implementation + 7-arg delegating wrapper)
create or replace function public.save_profile_draft(
  p_expected_version int,
  p_display_name text,
  p_bio text,
  p_focus_areas text,
  p_avatar_asset_id uuid,
  p_contact_email text,
  p_contact_links jsonb,
  p_now_notes text[],
  p_quotes text[]
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
  v_now_notes text[];
  v_quotes text[];
begin
  perform public.assert_caller_admin();

  select * into v_row from public.site_profile where id = 'owner' for update;
  if not found then
    insert into public.site_profile (id) values ('owner') returning * into v_row;
  end if;

  if v_row.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'CONFLICT', 'latest', to_jsonb(v_row));
  end if;

  select coalesce(array_agg(left(btrim(x), 36) order by ord), '{}'::text[])
  into v_now_notes
  from (
    select x, ord
    from unnest(coalesce(p_now_notes, '{}'::text[])) with ordinality as t(x, ord)
    where btrim(coalesce(x, '')) <> ''
    order by ord
    limit 3
  ) s;

  select coalesce(array_agg(left(btrim(x), 120) order by ord), '{}'::text[])
  into v_quotes
  from (
    select x, ord
    from unnest(coalesce(p_quotes, '{}'::text[])) with ordinality as t(x, ord)
    where btrim(coalesce(x, '')) <> ''
    order by ord
    limit 8
  ) s;

  v_old_avatar := v_row.draft_avatar_asset_id;

  update public.site_profile
  set
    draft_display_name = coalesce(p_display_name, ''),
    draft_bio = coalesce(p_bio, ''),
    draft_focus_areas = coalesce(p_focus_areas, ''),
    draft_avatar_asset_id = p_avatar_asset_id,
    draft_contact_email = coalesce(btrim(p_contact_email), ''),
    draft_contact_links = coalesce(p_contact_links, '[]'::jsonb),
    draft_now_notes = coalesce(v_now_notes, '{}'::text[]),
    draft_quotes = coalesce(v_quotes, '{}'::text[]),
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
language sql
security definer
set search_path = public
as $$
  select public.save_profile_draft(
    p_expected_version,
    p_display_name,
    p_bio,
    p_focus_areas,
    p_avatar_asset_id,
    p_contact_email,
    p_contact_links,
    '{}'::text[],
    '{}'::text[]
  );
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
     and jsonb_array_length(coalesce(v_row.draft_contact_links, '[]'::jsonb)) = 0
     and coalesce(array_length(v_row.draft_now_notes, 1), 0) = 0
     and coalesce(array_length(v_row.draft_quotes, 1), 0) = 0 then
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
    'now_notes', coalesce(to_jsonb(v_row.draft_now_notes), '[]'::jsonb),
    'quotes', coalesce(to_jsonb(v_row.draft_quotes), '[]'::jsonb),
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

-- 10. Revoke all omitted / new RPCs from public, anon, authenticated; allow service_role only
revoke all on function public.enqueue_unreferenced_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.enqueue_unreferenced_assets(uuid[]) to service_role;

revoke all on function public.filter_public_asset_ids(uuid[]) from public, anon, authenticated;
grant execute on function public.filter_public_asset_ids(uuid[]) to service_role;

revoke all on function public.save_site_settings(int, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_site_settings(int, text, text, text, text, text, text, text) to service_role;

revoke all on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) to service_role;

revoke all on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) to service_role;

revoke all on function public.reorder_projects(uuid[], int) from public, anon, authenticated;
grant execute on function public.reorder_projects(uuid[], int) to service_role;

revoke all on function public.reorder_notes(uuid[], int) from public, anon, authenticated;
grant execute on function public.reorder_notes(uuid[], int) to service_role;

revoke all on function public.clear_deleted_project_from_note_snapshots() from public, anon, authenticated;
grant execute on function public.clear_deleted_project_from_note_snapshots() to service_role;

revoke all on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb, text[], text[]) from public, anon, authenticated;
grant execute on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb, text[], text[]) to service_role;

revoke all on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) to service_role;

revoke all on function public.publish_profile(int) from public, anon, authenticated;
grant execute on function public.publish_profile(int) to service_role;

revoke all on function public.delete_project(uuid, int) from public, anon, authenticated;
grant execute on function public.delete_project(uuid, int) to service_role;

revoke all on function public.delete_note(uuid, int) from public, anon, authenticated;
grant execute on function public.delete_note(uuid, int) to service_role;
