-- Staging-only behavioral/security coverage for DueDiligence 2026.
-- Synthetic users and content usage records are enclosed in one transaction
-- and rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;
select no_plan();

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  ('a0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-admin@example.invalid', '{}', '{"full_name":"DD26 Admin"}', now(), now(), false, false),
  ('d0260000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dd26-student-a@example.invalid', '{}', '{"full_name":"DD26 Student A"}', now(), now(), false, false);

update public.user_roles
set role = 'super_admin'
where user_id = 'a0260000-0000-4000-8000-000000000001';

do $dd26_setup$
declare
  v_admin constant uuid := 'a0260000-0000-4000-8000-000000000001';
  v_student constant uuid := 'd0260000-0000-4000-8000-000000000001';
  v_version_id uuid;
begin
  update public.dd2026_feature_flags
  set enabled = true
  where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';

  perform public.dd2026_import_content_batch(v_admin, jsonb_build_array(jsonb_build_object(
    'id', 'dd26-staging-bar-easy', 'content_type', 'bar_easy',
    'subject', 'Labor Law', 'title', 'Staging Bar Easy',
    'source_version', '2026.1', 'source_status', 'AI_PREPARED_BETA',
    'checksum', repeat('1', 64),
    'payload', jsonb_build_object(
      'prompt', 'Is notice required?', 'suggested_answer', 'Yes.',
      'explanation', 'Due process requires notice.',
      'source_url', 'https://elibrary.judiciary.gov.ph/test'
    )
  )));
  select id into v_version_id from public.dd2026_content_versions
  where content_id = 'dd26-staging-bar-easy';
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'submit_review', 'Staging editorial review.');
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'approve', 'Staging legal approval.');
  perform public.dd2026_editorial_transition(v_admin, 'dd26-staging-bar-easy', v_version_id, 'publish', 'Staging publication approval.');

  update public.dd2026_feature_flags
  set enabled = false
  where flag_key = 'CONTENT_HUMAN_REVIEW_REQUIRED';
  perform public.dd2026_import_content_batch(v_admin, jsonb_build_array(jsonb_build_object(
    'id', 'dd26-staging-doctrine', 'content_type', 'doctrine',
    'subject', 'Labor Law', 'title', 'Staging Doctrine',
    'source_version', '2026.1', 'source_status', 'AI_PREPARED_BETA',
    'checksum', repeat('2', 64),
    'payload', jsonb_build_object(
      'doctrine_title', 'Security of tenure',
      'canonical_meaning', 'Dismissal requires lawful cause.',
      'source_url', 'https://elibrary.judiciary.gov.ph/test'
    )
  )));
  perform public.dd2026_record_bar_easy_completion(
    v_student, 'dd26-staging-bar-easy', 'bar-easy-request-2026', 'gemini-test'
  );
  perform public.dd2026_record_doctrine_mastery(
    v_student, 'dd26-staging-doctrine', 'thumbs_up',
    'doctrine-request-2026', 'gemini-test'
  );
end
$dd26_setup$;

select is(
  (select lifecycle_state from public.dd2026_content_versions where content_id = 'dd26-staging-bar-easy'),
  'published',
  'human-review mode requires and records the complete editorial lifecycle'
);

select ok(
  (select current_published_version_id is not null from public.dd2026_content_items where id = 'dd26-staging-bar-easy'),
  'human-approved content becomes the published version'
);

select is(
  (select lifecycle_state from public.dd2026_content_versions where content_id = 'dd26-staging-doctrine'),
  'published',
  'beta-mode validated content publishes without silently removing future review controls'
);

select ok(
  (select count(*) = 1 from public.dd2026_bar_easy_usage where user_id = 'd0260000-0000-4000-8000-000000000001')
  and (select count(*) = 1 from public.dd2026_doctrine_mastery where user_id = 'd0260000-0000-4000-8000-000000000001'),
  'Bar Easy and Doctrine persist only completion/mastery records'
);

select ok(
  not exists (
    select 1 from public.dd2026_bar_easy_usage where row_to_json(dd2026_bar_easy_usage)::text ilike '%DD26_CANARY_ANSWER%'
  ) and not exists (
    select 1 from public.dd2026_doctrine_mastery where row_to_json(dd2026_doctrine_mastery)::text ilike '%DD26_CANARY_ANSWER%'
  ),
  'non-retentive study records contain no answer canary'
);

do $dd2026_behavioral_finish$
declare
  v_result text;
begin
  for v_result in select * from finish() loop
    if v_result ilike '%failed%' or v_result ilike 'not ok%' then
      raise exception 'DD2026_BEHAVIORAL_PGTAP_FAILED: %', v_result;
    end if;
  end loop;
end
$dd2026_behavioral_finish$;

rollback;
