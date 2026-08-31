-- Transactional pgTAP coverage for the administrator-only 2026 Bar Forecast.

begin;
set local search_path = public, extensions, auth, pg_temp;
create extension if not exists pgtap with schema extensions;
select no_plan();

select has_table(
  'public',
  'dd2026_bar_forecast_consents',
  'versioned Bar Forecast consent storage exists'
);

select ok(
  (
    select c.relrowsecurity and c.relforcerowsecurity
    from pg_class c
    where c.oid = 'public.dd2026_bar_forecast_consents'::regclass
  ),
  'Bar Forecast consent storage has enabled and forced RLS'
);

select has_function(
  'public',
  'dd2026_bar_forecast_consent_status',
  array['uuid', 'text'],
  'admin-only consent status RPC exists'
);
select has_function(
  'public',
  'dd2026_bar_forecast_accept_consent',
  array['uuid', 'text'],
  'admin-only consent acceptance RPC exists'
);
select has_function(
  'public',
  'dd2026_bar_forecast_admin_list',
  array['uuid', 'text', 'text'],
  'admin-only Forecast list RPC exists'
);

select function_privs_are(
  'public',
  'dd2026_bar_forecast_consent_status',
  array['uuid', 'text'],
  'anon',
  array[]::text[],
  'anon cannot execute Forecast consent status'
);
select function_privs_are(
  'public',
  'dd2026_bar_forecast_accept_consent',
  array['uuid', 'text'],
  'authenticated',
  array[]::text[],
  'authenticated clients cannot execute Forecast consent acceptance'
);
select function_privs_are(
  'public',
  'dd2026_bar_forecast_admin_list',
  array['uuid', 'text', 'text'],
  'authenticated',
  array[]::text[],
  'authenticated clients cannot execute the Forecast list'
);

select is(
  (
    select enabled
    from public.dd2026_feature_flags
    where flag_key = 'BAR_FORECAST_ENABLED'
  ),
  false,
  'Bar Forecast remains disabled for public delivery by default'
);
select is(
  (
    select enabled
    from public.dd2026_feature_flags
    where flag_key = 'BAR_FORECAST_ADMIN_ONLY'
  ),
  true,
  'Bar Forecast is explicitly administrator-only'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    'af260000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bar-forecast-admin@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
  ),
  (
    'af260000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'bar-forecast-learner@example.invalid',
    '{}'::jsonb, '{}'::jsonb, now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id = 'af260000-0000-4000-8000-000000000001';

select throws_ok(
  $$select public.dd2026_bar_forecast_consent_status(
    null,
    '2026-08-31'
  )$$,
  'P0001',
  'DD2026_ADMIN_REQUIRED',
  'consent status independently rejects a null actor'
);
select throws_ok(
  $$select public.dd2026_bar_forecast_consent_status(
    'af260000-0000-4000-8000-000000000002',
    '2026-08-31'
  )$$,
  'P0001',
  'DD2026_ADMIN_REQUIRED',
  'consent status independently rejects a learner'
);
select throws_ok(
  $$select public.dd2026_bar_forecast_accept_consent(
    'af260000-0000-4000-8000-000000000002',
    '2026-08-31'
  )$$,
  'P0001',
  'DD2026_ADMIN_REQUIRED',
  'consent acceptance independently rejects a learner'
);
select throws_ok(
  $$select public.dd2026_bar_forecast_admin_list(
    'af260000-0000-4000-8000-000000000002',
    'Political and Public International Law',
    '2026-08-31'
  )$$,
  'P0001',
  'DD2026_ADMIN_REQUIRED',
  'Forecast listing independently rejects a learner'
);

select is(
  public.dd2026_bar_forecast_consent_status(
    'af260000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) ->> 'consentAccepted',
  'false',
  'an administrator begins without recorded consent'
);

select throws_ok(
  $$select public.dd2026_bar_forecast_admin_list(
    'af260000-0000-4000-8000-000000000001',
    'Political and Public International Law',
    '2026-08-31'
  )$$,
  'P0001',
  'DD2026_BAR_FORECAST_CONSENT_REQUIRED',
  'Forecast listing requires persisted versioned consent'
);

select is(
  public.dd2026_bar_forecast_accept_consent(
    'af260000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) ->> 'consentAccepted',
  'true',
  'an administrator can record current Forecast consent'
);
select is(
  public.dd2026_bar_forecast_accept_consent(
    'af260000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) ->> 'consentAccepted',
  'true',
  'consent acceptance is idempotent'
);
select is(
  public.dd2026_bar_forecast_consent_status(
    'af260000-0000-4000-8000-000000000001',
    '2026-08-31'
  ) ->> 'consentAccepted',
  'true',
  'accepted current consent is persisted for the administrator'
);

select throws_ok(
  $$select public.dd2026_bar_forecast_accept_consent(
    'af260000-0000-4000-8000-000000000001',
    '2026.3'
  )$$,
  'P0001',
  'DD2026_BAR_FORECAST_CONSENT_VERSION_INVALID',
  'consent is bound to the exact current version'
);

update public.dd2026_feature_flags
set enabled = false
where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';

do $bar_forecast_import$
declare
  v_rows jsonb;
begin
  select jsonb_agg(
    jsonb_build_object(
      'id', 'bar-forecast-test-' || n,
      'content_type', 'bar_forecast_question',
      'subject', 'Political and Public International Law',
      'title', 'POL-' || lpad(n::text, 2, '0') || ' - Forecast test',
      'source_version', '2026.3',
      'source_status', 'AI_PREPARED_BETA',
      'checksum', lpad(to_hex(n), 64, '0'),
      'payload', jsonb_build_object(
        'id', 'bar-forecast-test-' || n,
        'subject', 'Political and Public International Law',
        'version', '2026.3',
        'rank_within_subject', n,
        'prompt', 'May the single controlling doctrine apply to the stated Forecast facts?',
        'suggested_answer', 'Answer: Yes. The curated doctrine applies to the stated facts.',
        'legal_basis', 'The curated legal basis states the single controlling rule for this question.',
        'controlling_doctrine', 'The curated controlling doctrine decides this single legal question.',
        'jurisprudence', 'Curated official authority',
        'citation', 'G.R. No. 1, January 1, 2025'
      )
    ) order by n
  ) into v_rows
  from generate_series(1, 20) n;

  perform public.dd2026_import_content_batch(
    'af260000-0000-4000-8000-000000000001',
    v_rows
  );

  perform public.dd2026_import_content_batch(
    'af260000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'bar-forecast-legacy-test',
      'content_type', 'bar_easy',
      'subject', 'Political and Public International Law',
      'title', 'Legacy 2026.1 import remains valid',
      'source_version', '2026.1',
      'source_status', 'AI_PREPARED_BETA',
      'checksum', repeat('f', 64),
      'payload', jsonb_build_object(
        'prompt', 'Is the legacy content path preserved?',
        'suggested_answer', 'Yes.'
      )
    ))
  );
end
$bar_forecast_import$;

select is(
  (
    select count(*)::integer
    from public.dd2026_content_versions v
    join public.dd2026_content_items i on i.id = v.content_id
    where i.content_type = 'bar_forecast_question'
      and i.subject = 'Political and Public International Law'
      and v.source_version = '2026.3'
      and v.lifecycle_state = 'published'
  ),
  20,
  'twenty Forecast questions are stored as published source version 2026.3'
);

select is(
  (
    select source_version
    from public.dd2026_content_versions
    where content_id = 'bar-forecast-legacy-test'
  ),
  '2026.1',
  'the existing 2026.1 import path remains operational'
);

select is(
  public.dd2026_bar_forecast_admin_list(
    'af260000-0000-4000-8000-000000000001',
    'Political and Public International Law',
    '2026-08-31'
  ) ->> 'total',
  '20',
  'an authorized consenting administrator receives exactly twenty questions'
);

select is(
  (
    public.dd2026_bar_forecast_admin_list(
      'af260000-0000-4000-8000-000000000001',
      'Political and Public International Law',
      '2026-08-31'
    ) -> 'items' -> 0 -> 'payload' ->> 'rank_within_subject'
  ),
  '1',
  'Forecast rows are ordered by curated rank'
);

select throws_ok(
  $$select public.dd2026_import_content_batch(
    'af260000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'bar-forecast-wrong-pair',
      'content_type', 'bar_easy',
      'subject', 'Criminal Law',
      'title', 'Invalid type and version pair',
      'source_version', '2026.3',
      'source_status', 'AI_PREPARED_BETA',
      'checksum', repeat('e', 64),
      'payload', '{}'::jsonb
    ))
  )$$,
  'P0001',
  'DD2026_IMPORT_ROW_INVALID:bar-forecast-wrong-pair',
  'legacy content types cannot be imported under source version 2026.3'
);

select throws_ok(
  $$select public.dd2026_import_content_batch(
    'af260000-0000-4000-8000-000000000001',
    jsonb_build_array(jsonb_build_object(
      'id', 'bar-forecast-wrong-version',
      'content_type', 'bar_forecast_question',
      'subject', 'Criminal Law',
      'title', 'Invalid Forecast version',
      'source_version', '2026.1',
      'source_status', 'AI_PREPARED_BETA',
      'checksum', repeat('d', 64),
      'payload', '{}'::jsonb
    ))
  )$$,
  'P0001',
  'DD2026_IMPORT_ROW_INVALID:bar-forecast-wrong-version',
  'Forecast questions cannot be imported under legacy source version 2026.1'
);

do $bar_forecast_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%' or v_result ilike 'not ok%' then
      raise exception 'BAR_FORECAST_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$bar_forecast_finish$;

rollback;
