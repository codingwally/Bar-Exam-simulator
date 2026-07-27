-- PHASE 3 PRODUCTION PREFLIGHT — READ-ONLY / FAIL-FAST
--
-- Expected project: hbllomlijfznnuudpdvr.
-- PostgreSQL cannot prove a Supabase project ref; the operator must verify the
-- exact dashboard/CLI target before running this read-only script.
-- This script performs catalog and row-count reads only.

do $phase3_preflight$
declare
  v_missing text[];
  v_unexpected text[];
begin
  select array_agg(name order by name) into v_missing
  from unnest(array[
    'admin_audit_log','calibration_examples','grading_results',
    'guest_grading_devices','guest_grading_reservations','guest_grading_usage',
    'marketing_consents','profiles','question_corrections','questions','subjects',
    'submissions','support_requests','terms_acceptances','usage_events',
    'usage_sessions','user_entitlements','user_roles'
  ]) expected(name)
  where to_regclass('public.' || name) is null;
  if v_missing is not null then
    raise exception 'PHASE3_PREFLIGHT_MISSING_BASE_TABLES: %', v_missing;
  end if;

  select array_agg(name order by name) into v_unexpected
  from unnest(array[
    'admin_capabilities','support_request_history','question_correction_history',
    'entitlement_history','plan_catalog','discount_codes','discount_assignments',
    'account_recovery_cases','account_recovery_audit','website_controls',
    'website_control_history','admin_action_requests'
  ]) phase3(name)
  where to_regclass('public.' || name) is not null;
  if v_unexpected is not null then
    raise exception 'PHASE3_PREFLIGHT_ALREADY_PRESENT: %', v_unexpected;
  end if;

  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260727'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260728'
  ) then
    raise exception 'PHASE3_PREFLIGHT_LEDGER_DRIFT: Phase 1 and Phase 2 ledger entries are required';
  end if;
  if exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260729'
  ) then
    raise exception 'PHASE3_PREFLIGHT_LEDGER_CONFLICT: 20260729 already exists';
  end if;

  if (select count(*) from public.subjects) <> 8 then
    raise exception 'PHASE3_PREFLIGHT_SUBJECT_DRIFT: expected 8 production subjects';
  end if;
  if (select count(*) from public.questions) < 2 then
    raise exception 'PHASE3_PREFLIGHT_QUESTION_DRIFT: expected at least the two existing production question rows';
  end if;
  if (select count(*) from public.user_roles where role = 'super_admin') <> 1 then
    raise exception 'PHASE3_PREFLIGHT_SUPER_ADMIN_DRIFT: exactly one verified Super Admin is required';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'admin_audit_log','calibration_examples','grading_results',
        'guest_grading_devices','guest_grading_reservations','guest_grading_usage',
        'marketing_consents','profiles','question_corrections','questions','subjects',
        'submissions','support_requests','terms_acceptances','usage_events',
        'usage_sessions','user_entitlements','user_roles'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'PHASE3_PREFLIGHT_RLS_DRIFT: every existing production table must retain RLS';
  end if;

  if not has_table_privilege('anon', 'public.subjects', 'select')
     or not has_table_privilege('anon', 'public.questions', 'select') then
    raise exception 'PHASE3_PREFLIGHT_PUBLIC_READ_DRIFT: subject/question public reads must be present';
  end if;
  if not has_table_privilege('authenticated', 'public.usage_events', 'select')
     or not has_table_privilege('authenticated', 'public.usage_sessions', 'select')
     or not has_table_privilege('authenticated', 'public.admin_audit_log', 'select') then
    raise exception 'PHASE3_PREFLIGHT_ANALYTICS_GRANT_DRIFT: expected pre-Phase3 direct read grants are absent';
  end if;

  if to_regprocedure('public.reserve_guest_grade(text,text,text,smallint,integer)') is null
     or to_regprocedure('public.finalize_guest_grade(uuid)') is null
     or to_regprocedure('public.release_guest_grade(uuid)') is null
     or to_regprocedure('public.jsonb_has_forbidden_keys(jsonb,text[])') is null then
    raise exception 'PHASE3_PREFLIGHT_FUNCTION_DRIFT: required Phase 1/2 functions are missing';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'usage_sessions' and column_name = 'visitor_id')
        or (table_name = 'usage_events' and column_name = 'event_key')
        or (table_name = 'support_requests' and column_name = 'priority')
      )
  ) then
    raise exception 'PHASE3_PREFLIGHT_PARTIAL_SCHEMA: Phase 3 columns already exist';
  end if;
end
$phase3_preflight$;

select jsonb_build_object(
  'status', 'PHASE3_PREFLIGHT_PASSED_READ_ONLY',
  'checked_at', now(),
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'profiles', (select count(*) from public.profiles),
  'users', (select count(*) from auth.users),
  'super_admins', (select count(*) from public.user_roles where role = 'super_admin'),
  'support_requests', (select count(*) from public.support_requests),
  'question_corrections', (select count(*) from public.question_corrections),
  'usage_sessions', (select count(*) from public.usage_sessions),
  'usage_events', (select count(*) from public.usage_events),
  'entitlements', (select count(*) from public.user_entitlements)
) as phase3_preflight_result;
