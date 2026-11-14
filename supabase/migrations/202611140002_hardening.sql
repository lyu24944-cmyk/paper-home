-- Security & performance hardening applied on live Supabase project:
-- 1. Switch public.is_admin() to SECURITY INVOKER using cached (select auth.uid()).
-- 2. Restrict all internal / service_role RPCs strictly to service_role (Edge Functions only).
-- 3. Add covering indexes for foreign key columns across CMS tables.

create or replace function public.is_admin()
returns boolean
language sql
stable
security invoker
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated, service_role;

revoke all on function public.is_asset_public(uuid) from public, anon, authenticated;
grant execute on function public.is_asset_public(uuid) to service_role;

revoke all on function public.is_asset_referenced(uuid) from public, anon, authenticated;
grant execute on function public.is_asset_referenced(uuid) to service_role;

revoke all on function public.enqueue_unreferenced_assets(uuid[]) from public, anon, authenticated;
grant execute on function public.enqueue_unreferenced_assets(uuid[]) to service_role;

revoke all on function public.assert_caller_admin() from public, anon, authenticated;
grant execute on function public.assert_caller_admin() to service_role;

revoke all on function public.all_assets_ready(uuid[]) from public, anon, authenticated;
grant execute on function public.all_assets_ready(uuid[]) to service_role;

revoke all on function public.cleanup_candidate_assets(uuid[], boolean) from public, anon, authenticated;
grant execute on function public.cleanup_candidate_assets(uuid[], boolean) to service_role;

revoke all on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.save_project_draft(uuid, int, text, text, text, text, text, uuid, uuid[], uuid) to service_role;

revoke all on function public.publish_project(uuid, int) from public, anon, authenticated;
grant execute on function public.publish_project(uuid, int) to service_role;

revoke all on function public.unpublish_project(uuid, int) from public, anon, authenticated;
grant execute on function public.unpublish_project(uuid, int) to service_role;

revoke all on function public.reorder_projects(uuid[], int) from public, anon, authenticated;
grant execute on function public.reorder_projects(uuid[], int) to service_role;

revoke all on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) from public, anon, authenticated;
grant execute on function public.save_note_draft(uuid, int, text, text, text, uuid, uuid[], uuid) to service_role;

revoke all on function public.publish_note(uuid, int) from public, anon, authenticated;
grant execute on function public.publish_note(uuid, int) to service_role;

revoke all on function public.unpublish_note(uuid, int) from public, anon, authenticated;
grant execute on function public.unpublish_note(uuid, int) to service_role;

revoke all on function public.reorder_notes(uuid[], int) from public, anon, authenticated;
grant execute on function public.reorder_notes(uuid[], int) to service_role;

revoke all on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.save_profile_draft(int, text, text, text, uuid, text, jsonb) to service_role;

revoke all on function public.publish_profile(int) from public, anon, authenticated;
grant execute on function public.publish_profile(int) to service_role;

revoke all on function public.unpublish_profile(int) from public, anon, authenticated;
grant execute on function public.unpublish_profile(int) to service_role;

create index if not exists idx_media_assets_created_by on public.media_assets(created_by);
create index if not exists idx_notes_draft_project_id on public.notes(draft_project_id);
create index if not exists idx_notes_draft_video_asset_id on public.notes(draft_video_asset_id);
create index if not exists idx_projects_draft_cover_asset_id on public.projects(draft_cover_asset_id);
create index if not exists idx_projects_draft_video_asset_id on public.projects(draft_video_asset_id);
create index if not exists idx_site_profile_draft_avatar_asset_id on public.site_profile(draft_avatar_asset_id);
