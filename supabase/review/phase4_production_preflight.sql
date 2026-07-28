-- PHASE 4 PRODUCTION PREFLIGHT — READ-ONLY / FAIL-FAST
--
-- Expected project: hbllomlijfznnuudpdvr.
-- PostgreSQL cannot prove a Supabase project reference. The operator must
-- independently verify the exact dashboard or connection target before running
-- this script. Every statement below is catalog or row-count inspection only.

do $phase4_preflight$
declare
  v_missing text[];
  v_unexpected text[];
  v_founder_ids uuid[] := array[
    '132fb612-2045-4dcd-8408-dddbd8434789'::uuid,
    '23b9d2b9-0c7e-480a-aab2-20f8a1db907c'::uuid,
    'ffb88fe9-2cf7-4846-8acf-4e6a2330140a'::uuid
  ];
begin
  select array_agg(name order by name) into v_missing
  from unnest(array[
    'account_recovery_audit','account_recovery_cases','admin_action_requests',
    'admin_audit_log','admin_capabilities','calibration_examples',
    'discount_assignments','discount_codes','entitlement_history',
    'grading_results','guest_grading_devices','guest_grading_reservations',
    'guest_grading_usage','marketing_consents','plan_catalog','profiles',
    'question_correction_history','question_corrections','questions','subjects',
    'submissions','support_request_history',
    'support_requests','terms_acceptances','usage_events','usage_sessions',
    'user_entitlements','user_roles','website_control_history','website_controls'
  ]) expected(name)
  where to_regclass('public.' || name) is null;
  if v_missing is not null then
    raise exception 'PHASE4_PREFLIGHT_MISSING_PHASE3_OBJECTS: %', v_missing;
  end if;

  if to_regclass('public.grade_disputes') is not null then
    raise exception 'PHASE4_PREFLIGHT_LEGACY_GRADE_DISPUTES_PRESENT: Phase 1 should have renamed this table to question_corrections';
  end if;

  select array_agg(name order by name) into v_unexpected
  from unnest(array[
    'access_trials','ai_improvement_consents','exam_attempts',
    'free_beta_access','free_beta_access_history','grade_reservations',
    'lifetime_grade_usage','outbound_notifications','partnership_inquiries',
    'partnership_inquiry_history','payment_request_history','payment_requests',
    'platform_access_settings','provider_incidents','refund_request_history',
    'refund_requests','subscription_history','subscriptions'
  ]) phase4(name)
  where to_regclass('public.' || name) is not null;
  if v_unexpected is not null then
    raise exception 'PHASE4_PREFLIGHT_PARTIAL_OR_EXISTING_RELEASE: %', v_unexpected;
  end if;

  if not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260724005821' and name = 'initial_schema'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260727' and name = '002_auth_user_data_analytics_foundation'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260728' and name = '003_phase2_guest_access_support'
  ) or not exists (
    select 1 from supabase_migrations.schema_migrations
    where version = '20260729' and name = '004_phase3_admin_analytics'
  ) or (
    select count(*) from supabase_migrations.schema_migrations
  ) <> 4 then
    raise exception 'PHASE4_PREFLIGHT_LEDGER_DRIFT: baseline and Phase 1-3 ledger entries are required';
  end if;

  if exists (
    select 1
    from supabase_migrations.schema_migrations
    where version in ('20260730','20260730005','20260730006','20260730007','20260730008')
  ) then
    raise exception 'PHASE4_PREFLIGHT_LEDGER_CONFLICT: a Phase 4 ledger entry already exists';
  end if;

  if (select count(*) from public.subjects) <> 8 then
    raise exception 'PHASE4_PREFLIGHT_SUBJECT_DRIFT: expected exactly 8 subjects';
  end if;
  if (select count(*) from public.questions) <> 2 then
    raise exception 'PHASE4_PREFLIGHT_QUESTION_DRIFT: expected exactly 2 database question rows';
  end if;
  if (select count(*) from public.user_roles where role = 'super_admin') <> 1 then
    raise exception 'PHASE4_PREFLIGHT_SUPER_ADMIN_DRIFT: exactly one Super Admin is required';
  end if;
  if not exists (
    select 1 from public.user_roles
    where user_id = 'd78c8052-656a-4bbd-af8d-c07916684fcb'::uuid
      and role = 'super_admin'
  ) then
    raise exception 'PHASE4_PREFLIGHT_SUPER_ADMIN_IDENTITY_DRIFT: verified Super Admin UUID is absent';
  end if;
  if (
    select count(*) from auth.users where id = any(v_founder_ids)
  ) <> 3 or (
    select count(*) from public.profiles where id = any(v_founder_ids)
  ) <> 3 then
    raise exception 'PHASE4_PREFLIGHT_FOUNDER_IDENTITY_DRIFT: all three verified Founder UUIDs must exist';
  end if;

  if not has_table_privilege('anon', 'public.subjects', 'select')
     or not has_table_privilege('anon', 'public.questions', 'select') then
    raise exception 'PHASE4_PREFLIGHT_PUBLIC_READ_DRIFT: public subject/question reads must remain available';
  end if;

  if to_regprocedure('public.admin_operational_data(uuid,text,text,integer,integer)') is null
     or to_regprocedure('public.admin_execute_action(uuid,text,uuid,jsonb,text,text)') is null
     or to_regprocedure('public.admin_authorization_context(uuid)') is null
     or to_regprocedure('public.jsonb_has_forbidden_keys(jsonb,text[])') is null then
    raise exception 'PHASE4_PREFLIGHT_FUNCTION_DRIFT: required Phase 1-3 functions are missing';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'user_roles'
      and column_name = 'role'
      and data_type <> 'text'
  ) then
    raise exception 'PHASE4_PREFLIGHT_ROLE_COLUMN_DRIFT: user_roles.role must remain text';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in (
        'admin_audit_log','profiles','question_corrections','questions',
        'subjects','submissions','support_requests','usage_events',
        'usage_sessions','user_entitlements','user_roles'
      )
      and not c.relrowsecurity
  ) then
    raise exception 'PHASE4_PREFLIGHT_RLS_DRIFT: required Phase 1-3 tables must retain RLS';
  end if;

  if exists (
    select 1
    from storage.buckets
    where id = 'payment-proofs'
  ) then
    raise exception 'PHASE4_PREFLIGHT_STORAGE_DRIFT: payment-proofs bucket already exists';
  end if;
end
$phase4_preflight$;

select jsonb_build_object(
  'status', 'PHASE4_PREFLIGHT_PASSED_READ_ONLY',
  'checked_at', now(),
  'subjects', (select count(*) from public.subjects),
  'questions', (select count(*) from public.questions),
  'users', (select count(*) from auth.users),
  'profiles', (select count(*) from public.profiles),
  'submissions', (select count(*) from public.submissions),
  'grading_results', (select count(*) from public.grading_results),
  'question_corrections', (select count(*) from public.question_corrections),
  'support_requests', (select count(*) from public.support_requests),
  'usage_sessions', (select count(*) from public.usage_sessions),
  'usage_events', (select count(*) from public.usage_events),
  'entitlements', (select count(*) from public.user_entitlements),
  'audit_records', (select count(*) from public.admin_audit_log),
  'super_admins', (select count(*) from public.user_roles where role = 'super_admin'),
  'verified_founder_identities', (
    select count(*) from auth.users
    where id = any(array[
      '132fb612-2045-4dcd-8408-dddbd8434789'::uuid,
      '23b9d2b9-0c7e-480a-aab2-20f8a1db907c'::uuid,
      'ffb88fe9-2cf7-4846-8acf-4e6a2330140a'::uuid
    ])
  ),
  'migration_versions', (
    select jsonb_agg(version order by version)
    from supabase_migrations.schema_migrations
  )
) as phase4_preflight_result;
