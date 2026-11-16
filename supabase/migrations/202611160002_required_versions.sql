-- Keep the existing RPC signatures, but enforce the same version contract as HTTP.
do $$
declare f record; definition text; invalid text; argument text;
begin
  for f in select p.oid,p.proname,p.proargnames from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace join pg_language l on l.oid=p.prolang
    where n.nspname='public' and l.lanname='plpgsql'
      and (p.proargnames @> array['p_expected_version'] or p.proargnames @> array['p_expected_order_version'])
  loop
    argument := case when f.proargnames @> array['p_expected_order_version'] then 'p_expected_order_version' else 'p_expected_version' end;
    invalid := format('%1$s is null or %1$s <= 0',argument);
    if f.proname in ('save_project_draft','save_note_draft') then
      invalid := 'p_expected_version is null or (p_id is null and p_expected_version <> 0) or (p_id is not null and p_expected_version <= 0)';
    end if;
    definition := pg_get_functiondef(f.oid);
    definition := regexp_replace(definition, '\mbegin\M',
      format(E'begin\n  if %s then return jsonb_build_object(''ok'',false,''code'',''VALIDATION_ERROR'',''errors'',jsonb_build_array(''Invalid required version'')); end if;',invalid),'i');
    definition := replace(definition,'p_expected_version is not null and v_row.version <> p_expected_version','v_row.version is distinct from p_expected_version');
    definition := replace(definition,'v_row.version <> p_expected_version','v_row.version is distinct from p_expected_version');
    definition := replace(definition,'v_state.version <> p_expected_order_version','v_state.version is distinct from p_expected_order_version');
    execute definition;
  end loop;
end $$;
