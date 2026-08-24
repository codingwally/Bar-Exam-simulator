begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions, auth, pg_temp;

select plan(75);

-- Tests remain deterministic even when the staging environment has already
-- enabled the private rollout gate. The outer transaction restores its state.
update public.bar_simulation_runtime_config
set allocation_enabled = false
where config_key = 'randomized_allocation_v1';

select has_table('public', 'bar_simulation_runtime_config', 'runtime switch exists');
select has_table('public', 'bar_simulation_question_pool', 'private source pool exists');
select has_table('public', 'bar_simulation_pool_syncs', 'pool sync receipts exist');
select has_table(
  'public', 'bar_simulation_private_versions',
  'owner-bound private version claims exist'
);
select has_table('public', 'bar_simulation_allocations', 'attempt allocations exist');
select has_table(
  'public', 'bar_simulation_allocation_questions',
  'immutable allocation question rows exist'
);
select has_table(
  'public', 'bar_simulation_start_receipts',
  'durable start request receipts exist'
);
select has_table(
  'public', 'bar_simulation_answered_questions',
  'feature-scoped lifetime answer history exists'
);
select has_table(
  'public', 'bar_simulation_pool_staging_v1',
  'bounded private pool transport exists'
);
select has_function(
  'public', 'bar_simulation_sync_pool_v1',
  array['uuid', 'jsonb', 'text', 'text'],
  'safe full-pool sync RPC exists'
);
select has_function(
  'public', 'bar_simulation_stage_pool_v1',
  array['uuid', 'uuid', 'integer', 'integer', 'jsonb', 'text', 'text'],
  'bounded pool-staging RPC exists'
);
select has_function(
  'public', 'bar_simulation_finalize_pool_v1',
  array['uuid', 'uuid', 'text', 'text'],
  'atomic pool-finalization RPC exists'
);
select has_function(
  'public', 'bar_simulation_set_randomization_v1',
  array['uuid', 'boolean', 'text'],
  'database rollout gate RPC exists'
);
select has_function(
  'public', 'bar_simulation_start_attempt_v1',
  array['uuid', 'uuid', 'text', 'text', 'text'],
  'atomic Simulation allocator RPC exists'
);
select has_function(
  'public', 'bar_simulation_open_attempt_v1',
  array['uuid', 'uuid'],
  'catalog resume helper exists'
);
select has_trigger(
  'public', 'examination_responses',
  'bar_simulation_capture_answer_v1_trigger',
  'lifetime Simulation answer capture is installed'
);
select has_trigger(
  'public', 'examination_attempts_multi',
  'bar_simulation_close_allocation_v1_trigger',
  'allocation close capture is installed'
);
select has_trigger(
  'public', 'examination_attempts_multi',
  'bar_simulation_guard_one_open_attempt_v1_trigger',
  'one-open-Simulation-attempt guard is installed'
);

select is(
  (
    select allocation_enabled
    from public.bar_simulation_runtime_config
    where config_key = 'randomized_allocation_v1'
  ),
  false,
  'randomized allocation is disabled by default'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.bar_simulation_question_pool'::regclass),
  'pool has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.bar_simulation_pool_staging_v1'::regclass),
  'pool staging has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.bar_simulation_pool_staging_v1'::regclass),
  'pool staging forces RLS'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.bar_simulation_question_pool'::regclass),
  'pool forces RLS'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.bar_simulation_allocations'::regclass),
  'allocations have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.bar_simulation_allocations'::regclass),
  'allocations force RLS'
);
select is(
  has_table_privilege('anon', 'public.bar_simulation_question_pool', 'select'),
  false,
  'anonymous browsers cannot read protected pool content'
);
select is(
  has_table_privilege('anon', 'public.bar_simulation_pool_staging_v1', 'select'),
  false,
  'anonymous browsers cannot read staged pool content'
);
select is(
  has_table_privilege('authenticated', 'public.bar_simulation_question_pool', 'select'),
  false,
  'authenticated browsers cannot read protected pool content'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.bar_simulation_stage_pool_v1(uuid,uuid,integer,integer,jsonb,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers cannot stage pool content'
);
select is(
  has_function_privilege(
    'service_role',
    'public.bar_simulation_stage_pool_v1(uuid,uuid,integer,integer,jsonb,text,text)',
    'execute'
  ),
  true,
  'the Worker can stage bounded pool parts'
);
select is(
  has_table_privilege('service_role', 'public.bar_simulation_question_pool', 'select'),
  true,
  'the Worker can read the pool'
);
select is(
  has_function_privilege(
    'anon',
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)',
    'execute'
  ),
  false,
  'anonymous browsers cannot call the allocator'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)',
    'execute'
  ),
  false,
  'authenticated browsers cannot call the allocator directly'
);
select is(
  has_function_privilege(
    'service_role',
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)',
    'execute'
  ),
  true,
  'the Worker can call the allocator'
);
select is(
  (
    select prosecdef
    from pg_proc
    where oid =
      'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ),
  true,
  'the private allocator uses definer rights over FORCE-RLS tables'
);
select ok(
  pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ) like '%pg_advisory_xact_lock%'
  and pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ) like '%gen_random_bytes%'
  and pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ) not like '%ORDER BY random()%'
  and pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ) not like '%UPDATE public.examination_definitions%'
  and pg_get_functiondef(
    'public.bar_simulation_start_attempt_v1(uuid,uuid,text,text,text)'::regprocedure
  ) like '%grading_entitlement_reserved%false%',
  'allocator is locked, crypto-shuffled, non-activating, and credit-neutral'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '99600000-0000-4000-8000-000000000001',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'simulation-admin@example.invalid',
    '{}', '{"full_name":"Simulation Admin"}', now(), now(), false, false
  ),
  (
    '99600000-0000-4000-8000-000000000002',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'simulation-student-a@example.invalid',
    '{}', '{"full_name":"Simulation Student A"}', now(), now(), false, false
  ),
  (
    '99600000-0000-4000-8000-000000000003',
    '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'simulation-student-b@example.invalid',
    '{}', '{"full_name":"Simulation Student B"}', now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id = '99600000-0000-4000-8000-000000000001';

insert into public.examination_beta_access (
  user_id, enabled, expires_at, granted_by, reason
)
values
  (
    '99600000-0000-4000-8000-000000000002', true, now() + interval '1 day',
    '99600000-0000-4000-8000-000000000001',
    'Synthetic randomized Simulation verification for student A.'
  ),
  (
    '99600000-0000-4000-8000-000000000003', true, now() + interval '1 day',
    '99600000-0000-4000-8000-000000000001',
    'Synthetic randomized Simulation verification for student B.'
  )
on conflict (user_id) do update
set enabled = true,
    expires_at = excluded.expires_at,
    granted_by = excluded.granted_by,
    reason = excluded.reason;

-- Six ordinary, already-published catalog versions. The allocator must never
-- change these active_version_id values.
insert into public.examination_definitions (
  id, public_id, track, assessment_kind, title, subject, test_only,
  status, active_version_id, created_by
)
values
  (
    '99610000-0000-4000-8000-000000000001',
    '99611000-0000-4000-8000-000000000001',
    'bar_feels', 'curated', 'Synthetic Political Simulation',
    'Political and Public International Law', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  ),
  (
    '99610000-0000-4000-8000-000000000002',
    '99611000-0000-4000-8000-000000000002',
    'bar_feels', 'curated', 'Synthetic Commercial and Tax Simulation',
    'Commercial and Taxation Laws', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  ),
  (
    '99610000-0000-4000-8000-000000000003',
    '99611000-0000-4000-8000-000000000003',
    'bar_feels', 'curated', 'Synthetic Civil Simulation',
    'Civil Law', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  ),
  (
    '99610000-0000-4000-8000-000000000004',
    '99611000-0000-4000-8000-000000000004',
    'bar_feels', 'curated', 'Synthetic Labor Simulation',
    'Labor Law and Social Legislations', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  ),
  (
    '99610000-0000-4000-8000-000000000005',
    '99611000-0000-4000-8000-000000000005',
    'bar_feels', 'curated', 'Synthetic Criminal Simulation',
    'Criminal Law', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  ),
  (
    '99610000-0000-4000-8000-000000000006',
    '99611000-0000-4000-8000-000000000006',
    'bar_feels', 'curated', 'Synthetic Remedial and Ethics Simulation',
    'Remedial Law, Legal and Judicial Ethics', false, 'published', null,
    '99600000-0000-4000-8000-000000000001'
  );

insert into public.examination_versions (
  id, exam_id, version_number, label, duration_seconds, default_timer_mode,
  allowed_timer_modes, grading_route, answer_release_rule, instructions,
  syllabus, question_count, status, snapshot_hash, created_by, published_at
)
select
  ('99620000-0000-4000-8000-' || lpad(item.ordinality::text, 12, '0'))::uuid,
  item.exam_id,
  1,
  'Synthetic active catalog v1',
  14400,
  'strict',
  '["strict","selfPaced","none"]'::jsonb,
  'either',
  'after_ai',
  'Answer all twenty questions using ALAC.',
  jsonb_build_array(item.destination),
  20,
  'published',
  repeat(item.ordinality::text, 64),
  '99600000-0000-4000-8000-000000000001'::uuid,
  now()
from (
  values
    (1, '99610000-0000-4000-8000-000000000001'::uuid,
      'Political and Public International Law'),
    (2, '99610000-0000-4000-8000-000000000002'::uuid,
      'Commercial and Taxation Laws'),
    (3, '99610000-0000-4000-8000-000000000003'::uuid, 'Civil Law'),
    (4, '99610000-0000-4000-8000-000000000004'::uuid,
      'Labor Law and Social Legislations'),
    (5, '99610000-0000-4000-8000-000000000005'::uuid, 'Criminal Law'),
    (6, '99610000-0000-4000-8000-000000000006'::uuid,
      'Remedial Law, Legal and Judicial Ethics')
) as item(ordinality, exam_id, destination);

update public.examination_definitions definition
set active_version_id = (
  '99620000-0000-4000-8000-'
  || lpad(right(definition.id::text, 12)::integer::text, 12, '0')
)::uuid
where definition.id::text like '99610000-0000-4000-8000-%';

create temporary table simulation_catalog_before as
select definition.id,
       definition.active_version_id,
       (select count(*) from public.examination_versions) as version_count
from public.examination_definitions definition
where definition.id::text like '99610000-0000-4000-8000-%';

create temporary table simulation_pool_fixture as
with subjects(subject, code, subject_ordinal) as (
  values
    ('Political and Public International Law', 'POL', 1),
    ('Labor Law', 'LAB', 2),
    ('Civil Law', 'CIV', 3),
    ('Taxation Law', 'TAX', 4),
    ('Commercial Law', 'COM', 5),
    ('Criminal Law', 'CRI', 6),
    ('Remedial Law', 'REM', 7),
    ('Legal and Judicial Ethics', 'ETH', 8)
), rows as (
  select
    subject,
    code,
    n,
    code || '-SIM-' || lpad(n::text, 3, '0') as source_id,
    encode(digest(code || ':' || n::text, 'sha256'), 'hex') as content_hash,
    (subject_ordinal - 1) * 100 + n as sheet_row
  from subjects
  cross join generate_series(1, 100) n
)
select jsonb_agg(
  jsonb_build_object(
    'questionId', source_id,
    'subject', subject,
    'topic', 'Synthetic randomized allocation topic',
    'barYear', '2025',
    'questionNumber', n::text,
    'prompt', 'Synthetic ALAC essay prompt for ' || source_id
      || ' with enough facts for a complete answer.',
    'suggestedAnswer', 'Answer: The stated legal result for ' || source_id
      || ' follows from the supplied facts and controlling rule.',
    'legalBasis', 'The controlling constitutional, statutory, or procedural rule applies.',
    'doctrine', 'Synthetic controlling doctrine for randomized allocation testing.',
    'alac', jsonb_build_object(
      'application', 'Apply the governing rule to the material facts.',
      'conclusion', 'The legally supported conclusion follows.'
    ),
    'jurisprudence', '[]'::jsonb,
    'sourceUrls', jsonb_build_array(
      'https://elibrary.judiciary.gov.ph/synthetic/' || source_id
    ),
    'sourceUrlText', 'https://elibrary.judiciary.gov.ph/synthetic/' || source_id,
    'publicationReady', 'Yes',
    'editorialStatus', 'Owner override',
    'contentHash', content_hash,
    'sheetRow', sheet_row
  ) order by sheet_row
) as rows
from rows;

select throws_ok(
  $$
    select public.bar_simulation_sync_pool_v1(
      '99600000-0000-4000-8000-000000000001',
      (select jsonb_agg(value)
       from jsonb_array_elements((select rows from simulation_pool_fixture))
         with ordinality item(value, ordinal)
       where ordinal < 800),
      repeat('a', 64),
      'https://docs.google.com/spreadsheets/d/synthetic/edit'
    )
  $$,
  'P0001',
  'BAR_SIMULATION_POOL_SOURCE_INVALID',
  'an incomplete full snapshot is rejected before mutation'
);

do $stage_complete_simulation_pool$
declare
  v_part integer;
  v_rows jsonb;
begin
  for v_part in 1..8 loop
    select jsonb_agg(item.value order by item.ordinality)
    into v_rows
    from jsonb_array_elements((select rows from simulation_pool_fixture))
      with ordinality as item(value, ordinality)
    where item.ordinality between ((v_part - 1) * 100) + 1 and v_part * 100;
    perform public.bar_simulation_stage_pool_v1(
      '99600000-0000-4000-8000-000000000001',
      '99640000-0000-4000-8000-000000000001',
      v_part,
      8,
      v_rows,
      repeat('b', 64),
      'https://docs.google.com/spreadsheets/d/synthetic/edit'
    );
  end loop;
end;
$stage_complete_simulation_pool$;

create temporary table simulation_pool_sync as
select public.bar_simulation_finalize_pool_v1(
  '99600000-0000-4000-8000-000000000001',
  '99640000-0000-4000-8000-000000000001',
  repeat('b', 64),
  'https://docs.google.com/spreadsheets/d/synthetic/edit'
) as value;

select is(
  (select (value->>'stagedParts')::integer from simulation_pool_sync),
  8,
  'all eight bounded pool parts are finalized atomically'
);
select is(
  (select (value->>'stagedRows')::integer from simulation_pool_sync),
  800,
  'pool finalization reconstructs all 800 rows in source order'
);

select is(
  (select (value->>'eligibleQuestions')::integer from simulation_pool_sync),
  800,
  'the complete pool imports all 800 eligible questions'
);
select is(
  (
    select count(*)
    from jsonb_each((select value->'subjectCounts' from simulation_pool_sync)) count_entry
    where (count_entry.value #>> '{}')::integer = 100
  ),
  8::bigint,
  'the pool contains exactly 100 questions in every source subject'
);
select is(
  (select (value->>'versionsCreated')::integer from simulation_pool_sync),
  0,
  'pool population creates no examination version'
);
select is(
  (select (value->>'catalogActivated')::boolean from simulation_pool_sync),
  false,
  'pool population activates no catalog version'
);
select is(
  (select count(*) from public.examination_versions),
  (select max(version_count) from simulation_catalog_before),
  'pool population leaves the global version count unchanged'
);
select is(
  (
    select count(*)
    from public.examination_definitions current_definition
    join simulation_catalog_before prior using (id)
    where current_definition.active_version_id = prior.active_version_id
  ),
  6::bigint,
  'pool population leaves every active catalog pointer unchanged'
);

create temporary table simulation_pool_replay as
select public.bar_simulation_sync_pool_v1(
  '99600000-0000-4000-8000-000000000001',
  (select rows from simulation_pool_fixture),
  repeat('b', 64),
  'https://docs.google.com/spreadsheets/d/synthetic/edit'
) as value;

select is(
  (select (value->>'replayed')::boolean from simulation_pool_replay),
  true,
  'a repeated pool digest is a durable no-op replay'
);
select is(
  (
    select allocation_enabled
    from public.bar_simulation_runtime_config
    where config_key = 'randomized_allocation_v1'
  ),
  false,
  'loading the pool does not enable randomized allocation'
);

select throws_ok(
  $$
    select public.bar_simulation_start_attempt_v1(
      '99600000-0000-4000-8000-000000000002',
      '99620000-0000-4000-8000-000000000001',
      'strict',
      'sim_start_disabled_0001',
      'simulation-tab-token-000000000000000000000001'
    )
  $$,
  'P0001',
  'BAR_SIMULATION_RANDOMIZATION_DISABLED',
  'the database-side rollout switch blocks a new allocation while off'
);

create temporary table simulation_enable as
select public.bar_simulation_set_randomization_v1(
  '99600000-0000-4000-8000-000000000001',
  true,
  'Enable only inside the rolled-back pgTAP randomized Simulation test.'
) as value;

select is(
  (select (value->>'enabled')::boolean from simulation_enable),
  true,
  'an administrator can enable only after the 800/100-per-subject gate passes'
);

create temporary table simulation_start_a as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000001',
  'strict',
  'sim_start_pol_req_0001',
  'simulation-tab-token-000000000000000000000001'
) as value;

select is(
  (select jsonb_array_length(value->'questions') from simulation_start_a),
  20,
  'a single-subject Simulation attempt receives twenty questions'
);
select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions allocation_question
    where allocation_question.allocation_id =
      (select (value->>'allocationId')::uuid from simulation_start_a)
      and allocation_question.original_subject =
        'Political and Public International Law'
  ),
  20::bigint,
  'the Political destination receives its exact twenty-question quota'
);
select isnt(
  (
    select attempt.version_id
    from public.examination_attempts_multi attempt
    where attempt.id =
      (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a)
  ),
  '99620000-0000-4000-8000-000000000001'::uuid,
  'the attempt uses its own private snapshot version'
);
select is(
  (
    select active_version_id
    from public.examination_definitions
    where id = '99610000-0000-4000-8000-000000000001'
  ),
  '99620000-0000-4000-8000-000000000001'::uuid,
  'creating a private allocation does not change the active catalog version'
);
select ok(
  (
    select not grading_entitlement_reserved
      and grading_entitlement_reference is null
    from public.examination_attempts_multi
    where id = (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a)
  ),
  'starting an attempt reserves no grading credit'
);
select ok(
  (select value::text from simulation_start_a)
    !~* 'model_answer|modelAnswer|legal_basis|legalBasis|suggestedAnswer',
  'the start response does not leak sealed answer content'
);
select is(
  (
    select user_id
    from public.bar_simulation_allocations
    where id = (select (value->>'allocationId')::uuid from simulation_start_a)
  ),
  '99600000-0000-4000-8000-000000000002'::uuid,
  'the immutable allocation is bound to its authenticated owner'
);

create temporary table simulation_start_b as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000001',
  'strict',
  'sim_start_pol_req_0002',
  'simulation-tab-token-000000000000000000000001'
) as value;

select is(
  (select value->'attempt'->>'attemptId' from simulation_start_b),
  (select value->'attempt'->>'attemptId' from simulation_start_a),
  'a later request resumes the existing open destination attempt'
);

create temporary table simulation_start_a_replay as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000001',
  'strict',
  'sim_start_pol_req_0001',
  'simulation-tab-token-000000000000000000000001'
) as value;

select is(
  (select value->'attempt'->>'attemptId' from simulation_start_a_replay),
  (select value->'attempt'->>'attemptId' from simulation_start_a),
  'out-of-order retry A after B resolves to A original attempt'
);
select is(
  (select (value->>'replayed')::boolean from simulation_start_a_replay),
  true,
  'out-of-order retry is explicitly marked replayed'
);
select throws_ok(
  $$
    select public.bar_simulation_start_attempt_v1(
      '99600000-0000-4000-8000-000000000002',
      '99620000-0000-4000-8000-000000000001',
      'selfPaced',
      'sim_start_pol_req_0001',
      'simulation-tab-token-000000000000000000000001'
    )
  $$,
  'P0001',
  'BAR_SIMULATION_START_REQUEST_CONFLICT',
  'a reused request key with a changed payload is rejected'
);

update public.examination_responses response
set answer_text = 'A completed ALAC answer that permanently counts as answered.',
    revision = revision + 1,
    saved_at = now()
where response.attempt_id =
  (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a);

-- Recreate the narrow trigger-install/backfill race: the response was already
-- nonblank, but its lifetime-history row is absent when the user clears it.
-- The UPDATE must capture OLD.answer_text before accepting the blank NEW value.
delete from public.bar_simulation_answered_questions answered
where answered.user_id = '99600000-0000-4000-8000-000000000002'
  and answered.question_id = (
    select allocation_question.question_id
    from public.bar_simulation_allocation_questions allocation_question
    where allocation_question.allocation_id =
      (select (value->>'allocationId')::uuid from simulation_start_a)
    order by allocation_question.ordinal
    limit 1
  );

update public.examination_responses response
set answer_text = '   ',
    revision = revision + 1,
    saved_at = now()
where response.attempt_id =
  (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a)
  and response.question_id = (
    select allocation_question.question_id
    from public.bar_simulation_allocation_questions allocation_question
    where allocation_question.allocation_id =
      (select (value->>'allocationId')::uuid from simulation_start_a)
    order by allocation_question.ordinal
    limit 1
  );

select is(
  (
    select count(*)
    from public.bar_simulation_answered_questions answered
    where answered.user_id = '99600000-0000-4000-8000-000000000002'
  ),
  20::bigint,
  'once nonblank, all twenty answers remain in lifetime history after one is cleared'
);

update public.examination_attempts_multi
set status = 'submitted',
    submitted_at = now(),
    updated_at = now()
where id = (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a);

select is(
  (
    select status
    from public.bar_simulation_allocations
    where id = (select (value->>'allocationId')::uuid from simulation_start_a)
  ),
  'closed',
  'closing the attempt atomically closes its allocation'
);

create temporary table simulation_start_second_cycle as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000001',
  'strict',
  'sim_start_pol_req_0003',
  'simulation-tab-token-000000000000000000000001'
) as value;

select isnt(
  (select value->'attempt'->>'attemptId' from simulation_start_second_cycle),
  (select value->'attempt'->>'attemptId' from simulation_start_a),
  'a closed attempt is followed by a new owner-bound attempt'
);
select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions first_allocation
    join public.bar_simulation_allocation_questions second_allocation
      on second_allocation.question_id = first_allocation.question_id
    where first_allocation.allocation_id =
      (select (value->>'allocationId')::uuid from simulation_start_a)
      and second_allocation.allocation_id =
      (select (value->>'allocationId')::uuid from simulation_start_second_cycle)
  ),
  0::bigint,
  'the next attempt excludes every lifetime-answered Simulation question'
);

create temporary table simulation_com_tax as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000002',
  'strict',
  'sim_start_comtax_0001',
  'simulation-tab-token-000000000000000000000001'
) as value;

select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions
    where allocation_id = (select (value->>'allocationId')::uuid from simulation_com_tax)
      and original_subject = 'Commercial Law'
  ),
  10::bigint,
  'Commercial and Taxation receives ten Commercial Law questions'
);
select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions
    where allocation_id = (select (value->>'allocationId')::uuid from simulation_com_tax)
      and original_subject = 'Taxation Law'
  ),
  10::bigint,
  'Commercial and Taxation receives ten Taxation Law questions'
);

create temporary table simulation_rem_eth as
select public.bar_simulation_start_attempt_v1(
  '99600000-0000-4000-8000-000000000002',
  '99620000-0000-4000-8000-000000000006',
  'strict',
  'sim_start_remeth_0001',
  'simulation-tab-token-000000000000000000000001'
) as value;

select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions
    where allocation_id = (select (value->>'allocationId')::uuid from simulation_rem_eth)
      and original_subject = 'Remedial Law'
  ),
  10::bigint,
  'Remedial and Ethics receives ten Remedial Law questions'
);
select is(
  (
    select count(*)
    from public.bar_simulation_allocation_questions
    where allocation_id = (select (value->>'allocationId')::uuid from simulation_rem_eth)
      and original_subject = 'Legal and Judicial Ethics'
  ),
  10::bigint,
  'Remedial and Ethics receives ten Ethics questions'
);

-- A nonblank Syllabus-Based Review response is intentionally outside the
-- Simulation feature-scoped lifetime ledger.
insert into public.examination_definitions (
  id, public_id, track, assessment_kind, title, subject, year_level,
  semester, test_only, status, active_version_id, created_by
)
values (
  '99630000-0000-4000-8000-000000000001',
  '99631000-0000-4000-8000-000000000001',
  'per_subject', 'system_test', 'Synthetic Civil Syllabus Review',
  'Civil Law', 1, 1, true, 'published', null,
  '99600000-0000-4000-8000-000000000001'
);
insert into public.examination_versions (
  id, exam_id, version_number, label, duration_seconds, default_timer_mode,
  allowed_timer_modes, grading_route, answer_release_rule, instructions,
  syllabus, question_count, status, snapshot_hash, created_by
)
values (
  '99632000-0000-4000-8000-000000000001',
  '99630000-0000-4000-8000-000000000001',
  1, 'Synthetic Syllabus v1', 600, 'none', '["none"]', 'either',
  'after_ai', 'Synthetic feature-scope test.', '["Civil Law"]',
  1, 'draft', repeat('c', 64),
  '99600000-0000-4000-8000-000000000001'
);
insert into public.examination_version_questions (
  version_id, question_id, ordinal, prompt_snapshot, model_answer_snapshot,
  legal_basis_snapshot, application_snapshot, conclusion_snapshot,
  jurisprudence_snapshot, citation_snapshot, governing_provision_snapshot,
  source_urls_snapshot, snapshot_hash
)
select
  '99632000-0000-4000-8000-000000000001', question.id, 1,
  question.prompt_text, question.model_answer, question.legal_basis,
  question.application_text, question.conclusion_text, question.jurisprudence,
  question.citation, question.governing_provision, question.source_urls,
  question.content_hash
from public.examination_questions question
where question.source_key = 'bar-feels:CIV-SIM-001';
update public.examination_versions
set status = 'published', published_at = now()
where id = '99632000-0000-4000-8000-000000000001';
update public.examination_definitions
set active_version_id = '99632000-0000-4000-8000-000000000001'
where id = '99630000-0000-4000-8000-000000000001';
insert into public.examination_attempts_multi (
  id, user_id, version_id, timer_mode, status, active_tab_hash,
  tab_lease_until, start_request_key, grading_entitlement_reserved
)
values (
  '99633000-0000-4000-8000-000000000001',
  '99600000-0000-4000-8000-000000000003',
  '99632000-0000-4000-8000-000000000001',
  'none', 'in_progress', repeat('d', 64), now() + interval '90 seconds',
  'sim_syllabus_attempt_0001', false
);
insert into public.examination_responses (
  attempt_id, question_id, answer_text, revision
)
select
  '99633000-0000-4000-8000-000000000001', question.id,
  'A nonblank Syllabus-Based Review answer.', 1
from public.examination_questions question
where question.source_key = 'bar-feels:CIV-SIM-001';

select is(
  (
    select count(*)
    from public.bar_simulation_answered_questions answered
    join public.examination_questions question on question.id = answered.question_id
    where answered.user_id = '99600000-0000-4000-8000-000000000003'
      and question.source_key = 'bar-feels:CIV-SIM-001'
  ),
  0::bigint,
  'Syllabus-Based Review answers do not consume Simulation inventory'
);

insert into public.bar_simulation_answered_questions (
  user_id, question_id, first_attempt_id
)
select
  '99600000-0000-4000-8000-000000000003',
  pool.question_id,
  null
from public.bar_simulation_question_pool pool
where pool.subject = 'Civil Law'
  and pool.eligible
  and pool.source_digest = repeat('b', 64)
order by pool.source_question_id
limit 81
on conflict (user_id, question_id) do nothing;

select throws_ok(
  $$
    select public.bar_simulation_start_attempt_v1(
      '99600000-0000-4000-8000-000000000003',
      '99620000-0000-4000-8000-000000000003',
      'strict',
      'sim_start_civil_exhausted_0001',
      'simulation-tab-token-000000000000000000000003'
    )
  $$,
  'P0001',
  'BAR_SIMULATION_POOL_EXHAUSTED:Civil Law',
  'allocation terminates instead of recycling when a twenty-question quota is impossible'
);

select is(
  public.bar_simulation_open_attempt_v1(
    '99600000-0000-4000-8000-000000000003',
    '99620000-0000-4000-8000-000000000001'
  ),
  '{}'::jsonb,
  'the catalog resume helper never exposes another user allocation'
);

select throws_ok(
  format(
    'update public.bar_simulation_allocation_questions set ordinal = ordinal where allocation_id = %L',
    (select value->>'allocationId' from simulation_start_a)
  ),
  'P0001',
  'BAR_SIMULATION_ALLOCATION_IMMUTABLE',
  'allocated question identity and order are immutable'
);
select throws_ok(
  format(
    'update public.examination_versions set duration_seconds = duration_seconds + 1 where id = %L',
    (
      select attempt.version_id::text
      from public.examination_attempts_multi attempt
      where attempt.id =
        (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a)
    )
  ),
  'P0001',
  'EXAM_VERSION_IMMUTABLE',
  'the published per-attempt snapshot version is immutable'
);
select throws_ok(
  format(
    'insert into public.examination_attempts_multi '
    || '(id,user_id,version_id,timer_mode,status,active_tab_hash,tab_lease_until,start_request_key) '
    || 'values (%L,%L,%L,''none'',''in_progress'',repeat(''e'',64),now()+interval ''90 seconds'',%L)',
    '99634000-0000-4000-8000-000000000001',
    '99600000-0000-4000-8000-000000000002',
    (
      select attempt.version_id::text
      from public.examination_attempts_multi attempt
      where attempt.id =
        (select (value->'attempt'->>'attemptId')::uuid from simulation_start_a)
    ),
    'sim_private_replay_0001'
  ),
  'P0001',
  'BAR_SIMULATION_PRIVATE_VERSION_FORBIDDEN',
  'the generic legacy path cannot start a private randomized version again'
);
select is(
  (
    select count(*)
    from public.examination_definitions current_definition
    join simulation_catalog_before prior using (id)
    where current_definition.active_version_id = prior.active_version_id
  ),
  6::bigint,
  'all six catalog active versions remain unchanged after randomized attempts'
);

select * from finish();
rollback;
