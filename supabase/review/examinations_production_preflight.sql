-- SUBJECT MATTER EXAMINATIONS / BAR FEELS PRODUCTION PREFLIGHT
-- READ-ONLY / FAIL-FAST. A passing result is not permission to migrate.

begin;
set transaction read only;

do $examinations_preflight$
declare
  v_missing text[];
  v_unexpected text[];
  v_profile_signature text[];
  v_role_signature text[];
begin
  select array_agg(required_name order by required_name)
    into v_missing
  from unnest(array[
    'profiles',
    'questions',
    'subjects',
    'submissions',
    'grading_results',
    'usage_events',
    'usage_sessions',
    'user_roles'
  ]::text[]) as required_name
  where to_regclass(format('public.%I', required_name)) is null;

  if coalesce(cardinality(v_missing), 0) > 0 then
    raise exception 'EXAM_PREFLIGHT_MISSING_PREREQUISITE_TABLES: %', v_missing;
  end if;

  if to_regclass('auth.users') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
  then
    raise exception 'EXAM_PREFLIGHT_MISSING_AUTH_OR_STORAGE_FOUNDATION';
  end if;

  if (select count(*) from public.subjects) <> 8 then
    raise exception 'EXAM_PREFLIGHT_EXPECTED_EIGHT_SUBJECTS';
  end if;

  if (select count(*) from public.questions) <> 2 then
    raise exception 'EXAM_PREFLIGHT_EXPECTED_TWO_EXISTING_QUESTION_ROWS';
  end if;

  select array_agg(format('%s:%s:%s', column_name, data_type, is_nullable)
                   order by column_name)
    into v_profile_signature
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'profiles'
    and column_name in ('id', 'display_name');

  if v_profile_signature is distinct from array[
    'display_name:text:YES',
    'id:uuid:NO'
  ]::text[] then
    raise exception 'EXAM_PREFLIGHT_PROFILE_SIGNATURE_DRIFT: %', v_profile_signature;
  end if;

  select array_agg(format('%s:%s:%s', column_name, data_type, is_nullable)
                   order by column_name)
    into v_role_signature
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'user_roles'
    and column_name in ('role', 'user_id');

  if v_role_signature is distinct from array[
    'role:text:NO',
    'user_id:uuid:NO'
  ]::text[] then
    raise exception 'EXAM_PREFLIGHT_ROLE_SIGNATURE_DRIFT: %', v_role_signature;
  end if;

  if not exists (
    select 1
    from public.user_roles
    where role in ('founder_admin', 'super_admin')
  ) then
    raise exception 'EXAM_PREFLIGHT_NO_EXISTING_ADMIN_ROLE';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260727'
      and name = '002_auth_user_data_analytics_foundation'
  ) then
    raise exception 'EXAM_PREFLIGHT_PHASE1_LEDGER_ENTRY_MISSING';
  end if;

  if not exists (
    select 1
    from supabase_migrations.schema_migrations
    where version = '20260730005'
      and name = '005_phase4_access_subscriptions'
  ) then
    raise exception 'EXAM_PREFLIGHT_PHASE4_LEDGER_ENTRY_MISSING';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version in ('20260729120725', '20260729120726')
       or name in (
         'examinations_bar_feels_shared_engine',
         'approved_examination_test_bank'
       )
  ) then
    raise exception 'EXAM_PREFLIGHT_EXAMINATION_LEDGER_ENTRY_ALREADY_EXISTS';
  end if;

  select array_agg(table_name order by table_name)
    into v_unexpected
  from information_schema.tables
  where table_schema = 'public'
    and table_name = any(array[
      'examination_questions',
      'examination_definitions',
      'examination_versions',
      'examination_version_questions',
      'examination_beta_access',
      'examination_participants',
      'examination_attempts_multi',
      'examination_responses',
      'examination_submissions',
      'examination_grading_jobs',
      'examination_ai_assessments',
      'examination_examiner_assignments',
      'examination_examiner_reviews',
      'examination_model_releases',
      'examination_uploads',
      'examination_notifications',
      'examination_audit_log',
      'examination_command_receipts'
    ]::text[]);

  if coalesce(cardinality(v_unexpected), 0) > 0 then
    raise exception 'EXAM_PREFLIGHT_EXAMINATION_TABLES_ALREADY_EXIST: %', v_unexpected;
  end if;

  select array_agg(p.proname order by p.proname)
    into v_unexpected
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'examination\_%' escape '\';

  if coalesce(cardinality(v_unexpected), 0) > 0 then
    raise exception 'EXAM_PREFLIGHT_EXAMINATION_FUNCTIONS_ALREADY_EXIST: %', v_unexpected;
  end if;

  select array_agg(t.tgname order by t.tgname)
    into v_unexpected
  from pg_trigger t
  where not t.tgisinternal
    and t.tgname like 'examination\_%' escape '\';

  if coalesce(cardinality(v_unexpected), 0) > 0 then
    raise exception 'EXAM_PREFLIGHT_EXAMINATION_TRIGGERS_ALREADY_EXIST: %', v_unexpected;
  end if;

  if exists (
    select 1
    from storage.buckets
    where id = 'examination-uploads'
       or name = 'examination-uploads'
  ) then
    raise exception 'EXAM_PREFLIGHT_UPLOAD_BUCKET_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from storage.objects
    where bucket_id = 'examination-uploads'
  ) then
    raise exception 'EXAM_PREFLIGHT_UPLOAD_OBJECTS_ALREADY_EXIST';
  end if;

  raise notice 'EXAMINATIONS_PRODUCTION_PREFLIGHT_PASSED_READ_ONLY';
end
$examinations_preflight$;

select
  (select count(*) from public.subjects) as subjects_before,
  (select count(*) from public.questions) as questions_before,
  (select count(*) from auth.users) as users_before,
  (select count(*) from public.profiles) as profiles_before,
  (select count(*) from public.submissions) as submissions_before,
  (select count(*) from public.grading_results) as grading_results_before,
  (select count(*) from storage.buckets) as storage_buckets_before,
  'EXAMINATIONS_PRODUCTION_PREFLIGHT_PASSED_READ_ONLY' as result;

rollback;
