-- Due Diligence two-bank Subject Matter production preflight.
-- READ-ONLY and fail-fast. Run only after independently confirming that the
-- connected project is hbllomlijfznnuudpdvr. This script always rolls back.

begin transaction read only;
set local statement_timeout = '30s';
set local search_path = public, extensions, pg_temp;

do $subject_matter_two_bank_preflight$
declare
  v_table text;
  v_signature record;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: migration ledger missing';
  end if;

  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260811003200'
      and name = 'examination_room_one_key_one_room'
  ) then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: approved production baseline 20260811003200 missing';
  end if;

  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version in ('20260811004000', '20260811004100')
       or name in (
         'subject_matter_two_bank_consolidation',
         'subject_matter_chunked_release_transport'
       )
  ) then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: consolidation migration already appears in ledger';
  end if;

  foreach v_table in array array[
    'examination_definitions',
    'examination_versions',
    'examination_questions',
    'examination_version_questions',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_ai_assessments',
    'release_content_syncs',
    'bar_feels_manifest',
    'subject_matter_cycles'
  ] loop
    if to_regclass('public.' || v_table) is null then
      raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: required table public.% missing', v_table;
    end if;
  end loop;

  foreach v_table in array array[
    'subject_matter_placements',
    'release_subject_matter_payload_parts'
  ] loop
    if to_regclass('public.' || v_table) is not null then
      raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: new table public.% already exists', v_table;
    end if;
  end loop;

  if exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'release_sync_subject_matter_v2',
        'release_sync_all_content_v2',
        'release_stage_subject_matter_v2',
        'release_finalize_subject_matter_v2',
        'release_finalize_all_content_v2'
      )
  ) then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: one or more v2 functions already exist';
  end if;

  if to_regprocedure('public.examination_require_admin(uuid)') is null
     or to_regprocedure('public.release_sync_subject_matter(uuid,jsonb,text,text)') is null
     or to_regprocedure('public.release_sync_bar_feels(uuid,jsonb,text,text)') is null
     or to_regprocedure('public.release_sync_all_content(uuid,jsonb,text,text,jsonb,text,text)') is null
     or to_regprocedure('public.subject_matter_catalog(uuid)') is null
     or to_regprocedure('public.subject_matter_next_question(uuid,text,smallint,smallint,boolean)') is null
  then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: required function signature differs';
  end if;

  for v_signature in
    select * from (values
      ('examination_definitions', 'id', 'uuid', 'NO'),
      ('examination_definitions', 'track', 'text', 'NO'),
      ('examination_definitions', 'assessment_kind', 'text', 'NO'),
      ('examination_definitions', 'subject', 'text', 'YES'),
      ('examination_definitions', 'year_level', 'int2', 'YES'),
      ('examination_definitions', 'semester', 'int2', 'YES'),
      ('examination_definitions', 'active_version_id', 'uuid', 'YES'),
      ('examination_versions', 'id', 'uuid', 'NO'),
      ('examination_versions', 'exam_id', 'uuid', 'NO'),
      ('examination_versions', 'status', 'text', 'NO'),
      ('examination_versions', 'question_count', 'int4', 'NO'),
      ('examination_questions', 'id', 'uuid', 'NO'),
      ('examination_questions', 'source_key', 'text', 'NO'),
      ('examination_questions', 'subject', 'text', 'NO'),
      ('examination_questions', 'difficulty', 'text', 'YES'),
      ('examination_questions', 'source_metadata', 'jsonb', 'NO'),
      ('examination_questions', 'content_hash', 'text', 'NO'),
      ('examination_version_questions', 'version_id', 'uuid', 'NO'),
      ('examination_version_questions', 'question_id', 'uuid', 'NO'),
      ('examination_version_questions', 'ordinal', 'int2', 'NO')
    ) as expected(table_name, column_name, udt_name, is_nullable)
  loop
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = v_signature.table_name
        and c.column_name = v_signature.column_name
        and c.udt_name = v_signature.udt_name
        and c.is_nullable = v_signature.is_nullable
    ) then
      raise exception
        'SUBJECT_MATTER_PREFLIGHT_FAILED: column signature %.% % nullable=% differs',
        v_signature.table_name, v_signature.column_name,
        v_signature.udt_name, v_signature.is_nullable;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.examination_questions'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['id']::text[]
  ) or not exists (
    select 1 from pg_constraint c
    where c.conrelid = 'public.examination_definitions'::regclass
      and c.contype = 'p'
      and (
        select array_agg(a.attname::text order by k.ordinality)
        from unnest(c.conkey) with ordinality k(attnum, ordinality)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
      ) = array['id']::text[]
  ) then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: referenced primary key differs';
  end if;

  foreach v_table in array array[
    'examination_definitions',
    'examination_versions',
    'examination_questions',
    'examination_version_questions',
    'examination_attempts_multi',
    'examination_responses',
    'examination_submissions',
    'examination_ai_assessments'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: RLS disabled on public.%', v_table;
    end if;

    if exists (
      select 1 from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = v_table
        and grantee in ('PUBLIC', 'anon', 'authenticated')
    ) then
      raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: browser grant exists on public.%', v_table;
    end if;
  end loop;

  if (select count(*) from public.examination_questions) <> 736
     or (select count(*) from public.examination_definitions) <> 623
     or (select count(*) from public.examination_definitions where track = 'per_subject') <> 616
     or (select count(*) from public.examination_versions) <> 634
     or (select count(*) from public.examination_version_questions) <> 747
     or (select count(*) from public.bar_feels_manifest) <> 120
     or (select count(*) from public.subject_matter_cycles) <> 26
  then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: protected content baseline counts drifted';
  end if;

  if exists (
    select 1 from public.examination_questions
    where source_key like 'SYNTHETIC-%'
       or prompt_text like '[SYNTHETIC%'
  ) then
    raise exception 'SUBJECT_MATTER_PREFLIGHT_FAILED: synthetic examination content exists';
  end if;
end
$subject_matter_two_bank_preflight$;

select jsonb_build_object(
  'status', 'SUBJECT_MATTER_TWO_BANK_PREFLIGHT_PASSED',
  'users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'subjects', (select count(*) from public.subjects),
  'legacy_questions', (select count(*) from public.questions),
  'examination_definitions', (select count(*) from public.examination_definitions),
  'subject_definitions', (
    select count(*) from public.examination_definitions where track = 'per_subject'
  ),
  'examination_versions', (select count(*) from public.examination_versions),
  'examination_version_questions', (select count(*) from public.examination_version_questions),
  'examination_questions', (select count(*) from public.examination_questions),
  'examination_attempts', (select count(*) from public.examination_attempts_multi),
  'examination_responses', (select count(*) from public.examination_responses),
  'examination_submissions', (select count(*) from public.examination_submissions),
  'examination_ai_assessments', (select count(*) from public.examination_ai_assessments),
  'bar_feels_manifest', (select count(*) from public.bar_feels_manifest),
  'subject_matter_cycles', (select count(*) from public.subject_matter_cycles)
) as subject_matter_two_bank_preflight;

rollback;
