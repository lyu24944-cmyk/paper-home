-- Apply with cleanup workers paused/drained. Existing migrations remain immutable.
alter table public.media_assets drop constraint media_assets_status_check;
alter table public.media_assets add constraint media_assets_status_check
  check (status in ('uploading','ready','pending_delete','deleting'));
alter table public.media_cleanup_queue add column claim_token uuid;
alter table public.media_cleanup_queue add column claimed_at timestamptz;

create function public.lock_cms_write() returns void
language sql security definer set search_path = public as $$
  select pg_advisory_xact_lock(1864439121, 1);
$$;

create function public.cms_write_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.lock_cms_write();
  return null;
end;
$$;

-- Statement gates also protect authorized direct REST writes and FK cascades.
do $$ declare t text; begin
  foreach t in array array['projects','notes','site_profile','site_settings','collection_state','media_assets','media_cleanup_queue'] loop
    execute format('create trigger cms_write_gate before insert or update or delete on public.%I for each statement execute function public.cms_write_gate()',t);
  end loop;
end $$;

-- RPCs acquire the gate BEFORE taking content row locks, avoiding lock-order cycles.
do $$ declare f record; definition text; begin
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname = any(array[
      'save_project_draft','publish_project','unpublish_project','delete_project','reorder_projects',
      'save_note_draft','publish_note','unpublish_note','delete_note','reorder_notes',
      'save_profile_draft','publish_profile','unpublish_profile','save_site_settings',
      'cleanup_candidate_assets','enqueue_unreferenced_assets'])
  loop
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition, '\mbegin\M', E'begin\n  perform public.lock_cms_write();', 'i');
    execute definition;
  end loop;
end $$;

create function public.content_asset_ids(p_row jsonb) returns uuid[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(distinct id), '{}'::uuid[]) from (
    select public.safe_uuid(p_row->>'draft_cover_asset_id') id
    union all select public.safe_uuid(p_row->>'draft_video_asset_id')
    union all select public.safe_uuid(p_row->>'draft_avatar_asset_id')
    union all select public.safe_uuid(value) from jsonb_array_elements_text(coalesce(p_row->'draft_gallery_asset_ids','[]'::jsonb))
    union all select public.safe_uuid(value) from jsonb_array_elements_text(coalesce(p_row->'draft_image_asset_ids','[]'::jsonb))
    union all select public.safe_uuid(p_row->'published_snapshot'->>'cover_asset_id')
    union all select public.safe_uuid(p_row->'published_snapshot'->>'video_asset_id')
    union all select public.safe_uuid(p_row->'published_snapshot'->>'avatar_asset_id')
    union all select public.safe_uuid(value) from jsonb_array_elements_text(coalesce(p_row->'published_snapshot'->'gallery_asset_ids','[]'::jsonb))
    union all select public.safe_uuid(value) from jsonb_array_elements_text(coalesce(p_row->'published_snapshot'->'image_asset_ids','[]'::jsonb))
  ) a where id is not null;
$$;

create function public.guard_content_asset_references() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text; v_old uuid[] := '{}'::uuid[]; v_old_published uuid[] := '{}'::uuid[];
begin
  if tg_op='UPDATE' then
    v_old := public.content_asset_ids(to_jsonb(old));
    v_old_published := public.content_asset_ids(jsonb_build_object('published_snapshot',to_jsonb(old)->'published_snapshot'));
  end if;
  for v_id in
    (select unnest(public.content_asset_ids(to_jsonb(new))) except select unnest(v_old))
    union
    (select unnest(public.content_asset_ids(jsonb_build_object('published_snapshot',to_jsonb(new)->'published_snapshot'))) except select unnest(v_old_published))
  loop
    select status into v_status from public.media_assets where id=v_id;
    if v_status is distinct from 'ready' then
      raise exception 'Referenced media must exist and be ready' using errcode='23503';
    end if;
  end loop;
  return new;
end;
$$;

do $$ declare t text; begin
  foreach t in array array['projects','notes','site_profile'] loop
    execute format('create trigger guard_content_assets before insert or update on public.%I for each row execute function public.guard_content_asset_references()',t);
  end loop;
end $$;

create function public.guard_media_identity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.status in ('pending_delete','deleting') and new.status not in ('pending_delete','deleting') then
    raise exception 'Media scheduled for deletion cannot be revived' using errcode='23514';
  end if;
  if old.status <> 'uploading' and (new.display_path is distinct from old.display_path or new.thumb_path is distinct from old.thumb_path or new.kind is distinct from old.kind) then
    raise exception 'Registered media identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger guard_media_identity before update on public.media_assets
for each row execute function public.guard_media_identity();

create function public.claim_media_cleanup(p_limit int default 50)
returns setof public.media_cleanup_queue language plpgsql security definer set search_path = public as $$
declare q public.media_cleanup_queue%rowtype; a public.media_assets%rowtype;
begin
  perform public.assert_caller_admin();
  perform public.lock_cms_write();
  for q in select * from public.media_cleanup_queue
    where next_retry_at<=now() and (claim_token is null or claimed_at<now()-interval '5 minutes')
    order by created_at limit least(greatest(p_limit,1),50) for update skip locked
  loop
    select * into a from public.media_assets where id=q.asset_id for update;
    if not found or public.is_asset_referenced(q.asset_id) or a.status not in ('pending_delete','deleting') then
      update public.media_cleanup_queue set attempts=attempts+1, last_error='Cleanup blocked: missing metadata, unexpected state or live reference',
        next_retry_at=now()+interval '5 minutes', claim_token=null, claimed_at=null where id=q.id;
      continue;
    end if;
    -- Paths come from the locked immutable metadata, never an untrusted queue payload.
    update public.media_assets set status='deleting' where id=a.id;
    update public.media_cleanup_queue set claim_token=gen_random_uuid(), claimed_at=now(),
      next_retry_at=now()+interval '5 minutes', storage_paths=array_remove(array[a.display_path,a.thumb_path],null)
      where id=q.id returning * into q;
    return next q;
  end loop;
end;
$$;

create function public.finish_media_cleanup(p_queue_id uuid,p_claim_token uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare q public.media_cleanup_queue%rowtype;
begin
  perform public.assert_caller_admin(); perform public.lock_cms_write();
  select * into q from public.media_cleanup_queue where id=p_queue_id and claim_token=p_claim_token for update;
  if not found then return false; end if;
  if public.is_asset_referenced(q.asset_id) then raise exception 'Cleanup blocked by live reference'; end if;
  delete from public.media_assets where id=q.asset_id and status='deleting';
  if not found then raise exception 'Cleanup metadata state changed'; end if;
  delete from public.media_cleanup_queue where id=q.id;
  return true;
end;
$$;

create function public.fail_media_cleanup(p_queue_id uuid,p_claim_token uuid,p_error text) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_caller_admin(); perform public.lock_cms_write();
  update public.media_cleanup_queue set attempts=attempts+1,last_error=left(p_error,500),
    next_retry_at=now()+interval '5 minutes',claim_token=null,claimed_at=null
    where id=p_queue_id and claim_token=p_claim_token;
  return found;
end;
$$;

revoke all on function public.lock_cms_write(), public.cms_write_gate(),public.content_asset_ids(jsonb),
  public.guard_content_asset_references(), public.guard_media_identity(), public.claim_media_cleanup(int),
  public.finish_media_cleanup(uuid,uuid),public.fail_media_cleanup(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.lock_cms_write(),public.content_asset_ids(jsonb),public.claim_media_cleanup(int),
  public.finish_media_cleanup(uuid,uuid),public.fail_media_cleanup(uuid,uuid,text) to service_role;
