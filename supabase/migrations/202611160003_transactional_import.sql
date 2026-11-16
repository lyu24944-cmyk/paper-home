-- Internal service-only import. All comparisons precede writes under the CMS gate.
create function public.import_cms_content(p_plan jsonb) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  section text; tab text; item jsonb; items jsonb; existing jsonb; expected int;
  row_data jsonb; columns_sql text; select_sql text; update_sql text; k text;
  order_key text; order_version int;
begin
  if auth.role() is distinct from 'service_role' then raise insufficient_privilege; end if;
  perform public.lock_cms_write();
  foreach section in array array['projects','notes','profile','settings'] loop
    tab := case section when 'profile' then 'site_profile' when 'settings' then 'site_settings' else section end;
    items := coalesce(p_plan->section,'[]'::jsonb);
    if jsonb_typeof(items) <> 'array' then raise exception 'Import section must be an array'; end if;
    for item in select value from jsonb_array_elements(items) loop
      if coalesce(item->>'expectedVersion','') !~ '^[0-9]+$' then
        return jsonb_build_object('ok',false,'code','VALIDATION_ERROR','errors',jsonb_build_array('Invalid import version'));
      end if;
      expected := (item->>'expectedVersion')::int;
      execute format('select to_jsonb(t) from public.%I t where id::text=$1 for update',tab)
        into existing using item->'row'->>'id';
      if (existing is null and expected <> 0) or
         (existing is not null and (expected <= 0 or (existing->>'version')::int is distinct from expected)) then
        return jsonb_build_object('ok',false,'code','CONFLICT','table',tab,'id',item->'row'->>'id');
      end if;
    end loop;
    if section in ('projects','notes') and jsonb_array_length(items)>0 then
      order_key := section || '_order';
      select version into order_version from public.collection_state where key=order_key for update;
      if (p_plan->'orderVersions'->>order_key)::int is distinct from order_version then
        return jsonb_build_object('ok',false,'code','CONFLICT','table','collection_state','id',order_key);
      end if;
    end if;
  end loop;

  foreach section in array array['projects','notes','profile','settings'] loop
    tab := case section when 'profile' then 'site_profile' when 'settings' then 'site_settings' else section end;
    items := coalesce(p_plan->section,'[]'::jsonb);
    for item in select value from jsonb_array_elements(items) loop
      row_data := ((item->'row') - 'created_at' - 'updated_at' - 'version') ||
        jsonb_build_object('version',(item->>'expectedVersion')::int+1,'updated_at',clock_timestamp());
      columns_sql := ''; select_sql := ''; update_sql := '';
      for k in select jsonb_object_keys(row_data) loop
        if columns_sql<>'' then columns_sql:=columns_sql||',';select_sql:=select_sql||',';end if;
        columns_sql:=columns_sql||quote_ident(k); select_sql:=select_sql||'r.'||quote_ident(k);
        if k<>'id' then
          if update_sql<>'' then update_sql:=update_sql||',';end if;
          update_sql:=update_sql||format('%1$I=excluded.%1$I',k);
        end if;
      end loop;
      execute format('insert into public.%1$I (%2$s) select %3$s from jsonb_populate_record(null::public.%1$I,$1) r on conflict(id) do update set %4$s',tab,columns_sql,select_sql,update_sql) using row_data;
    end loop;
    if section in ('projects','notes') and jsonb_array_length(items)>0 then
      update public.collection_state set version=version+1,updated_at=clock_timestamp() where key=section||'_order';
    end if;
  end loop;
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.import_cms_content(jsonb) from public,anon,authenticated;
grant execute on function public.import_cms_content(jsonb) to service_role;
