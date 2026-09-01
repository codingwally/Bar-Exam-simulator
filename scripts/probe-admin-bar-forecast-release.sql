-- Rollback-only production/staging proof for protected Bar Forecast member access.
-- Run only after both September pricing prerequisites and all four exact Forecast
-- migrations are present in the Supabase migration ledger.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '45s';

do $admin_bar_forecast_schema_probe$
declare
  v_rpc regprocedure;
  v_content_type_constraint text;
  v_source_version_constraint text;
  v_consent_version_constraint text;
begin
  if to_regclass('supabase_migrations.schema_migrations') is null
      or not exists (
        select 1
        from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260831100000'
         and migration_row.name = 'september_pricing_cutover'
         and 'sha256:0ba5e20831899ade5b30088bf5f618cf055539fc35037bb2ef075119725dd676'
           = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260831101000'
         and migration_row.name = 'proof_only_payment_evidence'
         and 'sha256:dcc4c2401d833a39ae7dbbe21e8a3205a8efdd283aa430b21618f63ac7397eac'
           = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260831170000'
         and migration_row.name = 'admin_bar_forecast'
         and 'sha256:e151ee23f0c363ad931c258ca274ea13a284d562cf281047c7479fb9f35e01b2'
           = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260901010837'
         and migration_row.name = 'admin_bar_forecast_consent_version'
         and 'sha256:bec6e9ca3001baf590cd8fa917fe9cf35ba9b81ce2557fb9f0b7cf6b6358d7ed'
           = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260901014500'
         and migration_row.name = 'admin_bar_forecast_runtime_integrity'
          and 'sha256:a304e4a9b0ba364812e6e49a308930907c2eb3eea65f5c22cce6db61a73ad548'
            = any(coalesce(migration_row.statements, array[]::text[]))
     )
     or not exists (
       select 1
       from supabase_migrations.schema_migrations migration_row
       where migration_row.version = '20260901030000'
         and migration_row.name = 'bar_forecast_member_access'
         and 'sha256:44050f3f4f8a0e90c36ec4b7998f231c0fa30750bd708ca8fdf19301f9015461'
           = any(coalesce(migration_row.statements, array[]::text[]))
      ) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_MIGRATION_LEDGER_MISMATCH';
  end if;

  if not exists (
       select 1
       from public.dd2026_feature_flags flag_row
       where flag_row.flag_key = 'BAR_FORECAST_ENABLED'
          and flag_row.enabled is true
     )
     or not exists (
       select 1
       from public.dd2026_feature_flags flag_row
       where flag_row.flag_key = 'BAR_FORECAST_ADMIN_ONLY'
          and flag_row.enabled is false
     ) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_FEATURE_FLAG_BOUNDARY_FAILED';
  end if;

  if to_regclass('public.dd2026_bar_forecast_consents') is null
     or not exists (
       select 1
       from pg_catalog.pg_class class_row
       where class_row.oid = 'public.dd2026_bar_forecast_consents'::regclass
         and class_row.relrowsecurity
         and class_row.relforcerowsecurity
     )
     or not has_table_privilege(
       'service_role', 'public.dd2026_bar_forecast_consents',
       'SELECT, INSERT, UPDATE, DELETE'
     )
     or has_table_privilege(
       'anon', 'public.dd2026_bar_forecast_consents',
       'SELECT, INSERT, UPDATE, DELETE'
     )
     or has_table_privilege(
       'authenticated', 'public.dd2026_bar_forecast_consents',
       'SELECT, INSERT, UPDATE, DELETE'
     ) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_CONSENT_TABLE_BOUNDARY_FAILED';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
  into v_content_type_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.dd2026_content_items'::regclass
    and constraint_row.conname = 'dd2026_content_items_content_type_check';
  select pg_get_constraintdef(constraint_row.oid)
  into v_source_version_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.dd2026_content_versions'::regclass
    and constraint_row.conname = 'dd2026_content_versions_source_version_check';
  select pg_get_constraintdef(constraint_row.oid)
  into v_consent_version_constraint
  from pg_catalog.pg_constraint constraint_row
  where constraint_row.conrelid = 'public.dd2026_bar_forecast_consents'::regclass
    and constraint_row.conname = 'dd2026_bar_forecast_consents_consent_version_check';
  if v_content_type_constraint is null
     or position('bar_forecast_question' in v_content_type_constraint) = 0
     or v_source_version_constraint is null
     or position('2026.3' in v_source_version_constraint) = 0
     or v_consent_version_constraint is null
     or position('2026-08-31' in v_consent_version_constraint) = 0
     or position('2026-09-01' in v_consent_version_constraint) = 0 then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_CONTENT_CONSTRAINT_FAILED';
  end if;

  foreach v_rpc in array array[
    'public.dd2026_import_content_batch(uuid,jsonb)'::regprocedure,
    'public.dd2026_bar_forecast_access_allowed(uuid)'::regprocedure,
    'public.dd2026_bar_forecast_consent_status(uuid,text)'::regprocedure,
    'public.dd2026_bar_forecast_accept_consent(uuid,text)'::regprocedure,
    'public.dd2026_bar_forecast_admin_list(uuid,text,text)'::regprocedure
  ] loop
    if not has_function_privilege('service_role', v_rpc, 'EXECUTE')
       or has_function_privilege('anon', v_rpc, 'EXECUTE')
       or has_function_privilege('authenticated', v_rpc, 'EXECUTE') then
      raise exception 'ADMIN_BAR_FORECAST_PROBE_RPC_PRIVILEGE_FAILED: %', v_rpc::text;
    end if;
    if not (
         select procedure_row.prosecdef
           and procedure_row.proconfig @> array['search_path=""']::text[]
         from pg_catalog.pg_proc procedure_row
         where procedure_row.oid = v_rpc::oid
       ) then
      raise exception 'ADMIN_BAR_FORECAST_PROBE_RPC_SECURITY_FAILED: %', v_rpc::text;
    end if;
    if v_rpc not in (
         'public.dd2026_import_content_batch(uuid,jsonb)'::regprocedure,
         'public.dd2026_bar_forecast_access_allowed(uuid)'::regprocedure
       )
       and position('2026-09-01' in pg_get_functiondef(v_rpc::oid)) = 0 then
      raise exception 'ADMIN_BAR_FORECAST_PROBE_RPC_CONSENT_VERSION_FAILED: %', v_rpc::text;
    end if;
  end loop;

  v_rpc := 'public.dd2026_bar_forecast_access_allowed(uuid)'::regprocedure;
  if position('public.dd2026_is_admin' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('founding_beta_2026' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('manual_payment' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('admin_adjustment' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('migration' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('complimentary' in pg_get_functiondef(v_rpc::oid)) > 0
     or position('phase4_access_snapshot' in pg_get_functiondef(v_rpc::oid)) > 0 then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_ENTITLEMENT_FUNCTION_FAILED';
  end if;

  v_rpc := 'public.dd2026_bar_forecast_admin_list(uuid,text,text)'::regprocedure;
  if position(
       'DD2026_BAR_FORECAST_INTEGRITY_INVALID'
       in pg_get_functiondef(v_rpc::oid)
     ) = 0
     or position('v_checksum_count' in pg_get_functiondef(v_rpc::oid)) = 0
     or position('v_editorial_count' in pg_get_functiondef(v_rpc::oid)) = 0
     or position(
       'v.payload ->> ''id'' = i.id'
       in pg_get_functiondef(v_rpc::oid)
     ) = 0 then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_RUNTIME_INTEGRITY_FUNCTION_FAILED';
  end if;
end;
$admin_bar_forecast_schema_probe$;

do $admin_bar_forecast_authorization_probe$
declare
  v_non_admin uuid := gen_random_uuid();
  v_error text;
  v_import_rejected boolean := false;
  v_status_rejected boolean := false;
  v_accept_rejected boolean := false;
  v_list_rejected boolean := false;
begin
  if public.dd2026_bar_forecast_access_allowed(v_non_admin) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_RANDOM_ACTOR_ALLOWED';
  end if;

  begin
    perform public.dd2026_import_content_batch(v_non_admin, '[{}]'::jsonb);
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error = 'DD2026_ADMIN_REQUIRED' then
      v_import_rejected := true;
    else
      raise;
    end if;
  end;

  begin
    perform public.dd2026_bar_forecast_consent_status(
      v_non_admin,
      '2026-09-01'
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error = 'DD2026_BAR_FORECAST_ACCESS_REQUIRED' then
      v_status_rejected := true;
    else
      raise;
    end if;
  end;

  begin
    perform public.dd2026_bar_forecast_accept_consent(
      v_non_admin,
      '2026-09-01'
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error = 'DD2026_BAR_FORECAST_ACCESS_REQUIRED' then
      v_accept_rejected := true;
    else
      raise;
    end if;
  end;

  begin
    perform public.dd2026_bar_forecast_admin_list(
      v_non_admin,
      'Political and Public International Law',
      '2026-09-01'
    );
  exception when others then
    get stacked diagnostics v_error = message_text;
    if v_error = 'DD2026_BAR_FORECAST_ACCESS_REQUIRED' then
      v_list_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_import_rejected
     or not v_status_rejected
     or not v_accept_rejected
     or not v_list_rejected then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_INELIGIBLE_AUTHORIZATION_FAILED';
  end if;
end;
$admin_bar_forecast_authorization_probe$;

do $admin_bar_forecast_entitlement_probe$
declare
  v_now timestamptz := statement_timestamp();
  v_actor uuid;
  v_paid uuid := gen_random_uuid();
  v_beta uuid := gen_random_uuid();
  v_complimentary uuid := gen_random_uuid();
  v_expired uuid := gen_random_uuid();
  v_disabled_beta uuid := gen_random_uuid();
  v_status jsonb;
begin
  select role_row.user_id into v_actor
  from public.user_roles role_row
  where role_row.role::text in ('admin', 'founder_admin', 'super_admin')
  order by case role_row.role::text
    when 'founder_admin' then 0
    when 'super_admin' then 1
    else 2
  end
  limit 1;
  if v_actor is null or not public.dd2026_bar_forecast_access_allowed(v_actor) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_ADMIN_ACCESS_FAILED';
  end if;

  insert into auth.users (
    id, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values
  (v_paid, 'forecast-paid-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_beta, 'forecast-beta-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_complimentary, 'forecast-complimentary-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_expired, 'forecast-expired-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now),
  (v_disabled_beta, 'forecast-disabled-beta-probe@example.invalid', '', v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, v_now, v_now);

  insert into public.subscriptions (
    user_id, plan_code, status, starts_at, expires_at, source, reason
  ) values
  (v_paid, 'early_access_beta', 'active', v_now - interval '1 day',
    v_now + interval '1 day', 'manual_payment', 'Rollback-only paid Forecast probe.'),
  (v_complimentary, 'early_access_beta', 'active', v_now - interval '1 day',
    v_now + interval '1 day', 'complimentary', 'Rollback-only complimentary Forecast probe.'),
  (v_expired, 'early_access_beta', 'active', v_now - interval '2 days',
    v_now - interval '1 day', 'manual_payment', 'Rollback-only expired Forecast probe.');

  insert into public.free_beta_access (
    user_id, enabled, expires_at, reason, created_by, updated_by, access_program
  ) values
  (v_beta, true, v_now + interval '1 day', 'Rollback-only Founding Beta Forecast probe.',
    v_actor, v_actor, 'founding_beta_2026'),
  (v_disabled_beta, false, v_now + interval '1 day',
    'Rollback-only disabled Founding Beta Forecast probe.',
    v_actor, v_actor, 'founding_beta_2026');

  if not public.dd2026_bar_forecast_access_allowed(v_paid)
     or not public.dd2026_bar_forecast_access_allowed(v_beta)
     or public.dd2026_bar_forecast_access_allowed(v_complimentary)
     or public.dd2026_bar_forecast_access_allowed(v_expired)
     or public.dd2026_bar_forecast_access_allowed(v_disabled_beta) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_ENTITLEMENT_MATRIX_FAILED';
  end if;

  v_status := public.dd2026_bar_forecast_consent_status(v_paid, '2026-09-01');
  if coalesce((v_status ->> 'consentAccepted')::boolean, true) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_PAID_STATUS_FAILED';
  end if;
  v_status := public.dd2026_bar_forecast_accept_consent(v_paid, '2026-09-01');
  if coalesce((v_status ->> 'consentAccepted')::boolean, false) = false then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_PAID_CONSENT_FAILED';
  end if;
  v_status := public.dd2026_bar_forecast_consent_status(v_beta, '2026-09-01');
  if coalesce((v_status ->> 'consentAccepted')::boolean, true) then
    raise exception 'ADMIN_BAR_FORECAST_PROBE_BETA_STATUS_FAILED';
  end if;
end;
$admin_bar_forecast_entitlement_probe$;

rollback;
select 'ADMIN_BAR_FORECAST_RELEASE_PROBE_PASSED' as result;
