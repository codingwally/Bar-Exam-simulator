-- Allow additive Syllabus-Based Review banks to grow beyond the original
-- 100-question per-course safety cap. The placement table already permits
-- slots through 200; this aligns the incremental importer with that existing
-- schema limit without changing existing questions, attempts, or grades.

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_catalog.pg_get_functiondef(
    'public.subject_matter_sync_incremental_v1_legacy_snapshot_hash(uuid,jsonb,text,text)'::regprocedure
  )
  into v_definition;

  if v_definition is null
     or pg_catalog.strpos(
       v_definition,
       'coalesce(item.value->>''slot'', '''') !~ ''^[1-9][0-9]?$|^100$'''
     ) = 0
     or pg_catalog.strpos(
       v_definition,
       'current_counts.current_count + incoming.additions > 100'
     ) = 0
  then
    raise exception 'SUBJECT_MATTER_INCREMENTAL_CAP_200_PRECONDITION_FAILED';
  end if;

  v_updated := pg_catalog.replace(
    v_definition,
    'coalesce(item.value->>''slot'', '''') !~ ''^[1-9][0-9]?$|^100$''',
    'coalesce(item.value->>''slot'', '''') !~ ''^([1-9]|[1-9][0-9]|1[0-9][0-9]|200)$'''
  );

  v_updated := pg_catalog.replace(
    v_updated,
    'current_counts.current_count + incoming.additions > 100',
    'current_counts.current_count + incoming.additions > 200'
  );

  execute v_updated;
end
$$;

comment on function public.subject_matter_sync_incremental_v1_legacy_snapshot_hash(
  uuid, jsonb, text, text
) is
  'Legacy implementation used by the guarded incremental Syllabus-Based Review importer; accepts course slots up to the subject_matter_placements schema limit of 200.';
