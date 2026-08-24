begin;
create extension if not exists pgtap with schema extensions;
select plan(44);

select has_table('public', 'feature_question_rotations', 'rotation state exists');
select has_table('public', 'feature_question_issuances', 'owner-bound issuances exist');
select has_table('public', 'feature_question_rotation_receipts', 'durable request receipts exist');
select has_function(
  'public', 'select_feature_question_v2',
  array['uuid', 'text', 'text', 'text[]', 'text[]', 'text'],
  'the versioned Practice selector exists'
);
select has_function(
  'public', 'feature_question_restore_authorized_v2',
  array['uuid', 'text', 'text', 'text', 'uuid'],
  'the issuance-backed restore authorizer exists'
);
select hasnt_function(
  'public', 'select_feature_question_v1',
  array['uuid', 'text', 'text', 'text[]', 'text'],
  'the unsafe v1 selector has been removed'
);

select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.feature_question_rotations'::regclass),
  'rotation state has RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.feature_question_rotations'::regclass),
  'rotation state forces RLS'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.feature_question_issuances'::regclass),
  'issuances have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.feature_question_issuances'::regclass),
  'issuances force RLS'
);
select ok(
  (select relrowsecurity from pg_class
   where oid = 'public.feature_question_rotation_receipts'::regclass),
  'receipts have RLS enabled'
);
select ok(
  (select relforcerowsecurity from pg_class
   where oid = 'public.feature_question_rotation_receipts'::regclass),
  'receipts force RLS'
);

select is(
  has_table_privilege('anon', 'public.feature_question_rotations', 'select'),
  false,
  'anonymous users cannot read rotation state'
);
select is(
  has_table_privilege('authenticated', 'public.feature_question_issuances', 'select'),
  false,
  'browser users cannot read issuance evidence'
);
select is(
  has_table_privilege('authenticated', 'public.feature_question_rotation_receipts', 'select'),
  false,
  'browser users cannot read request receipts'
);
select is(
  has_table_privilege('service_role', 'public.feature_question_rotations', 'select'),
  true,
  'the Worker can read rotation state'
);
select is(
  has_table_privilege('service_role', 'public.feature_question_issuances', 'select'),
  true,
  'the Worker can read issuance evidence'
);
select is(
  has_table_privilege('service_role', 'public.feature_question_rotation_receipts', 'select'),
  true,
  'the Worker can read request receipts'
);
select is(
  has_function_privilege(
    'anon',
    'public.select_feature_question_v2(uuid,text,text,text[],text[],text)',
    'execute'
  ),
  false,
  'anonymous users cannot execute the selector'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.select_feature_question_v2(uuid,text,text,text[],text[],text)',
    'execute'
  ),
  false,
  'browser users cannot execute the selector'
);
select is(
  has_function_privilege(
    'service_role',
    'public.select_feature_question_v2(uuid,text,text,text[],text[],text)',
    'execute'
  ),
  true,
  'the Worker can execute the selector'
);
select is(
  has_function_privilege(
    'authenticated',
    'public.feature_question_restore_authorized_v2(uuid,text,text,text,uuid)',
    'execute'
  ),
  false,
  'browser users cannot forge restore authorization'
);
select is(
  has_function_privilege(
    'service_role',
    'public.feature_question_restore_authorized_v2(uuid,text,text,text,uuid)',
    'execute'
  ),
  true,
  'the Worker can verify restore authorization'
);
select is(
  (select prosecdef from pg_proc where oid =
    'public.select_feature_question_v2(uuid,text,text,text[],text[],text)'::regprocedure),
  false,
  'the selector uses invoker rights'
);
select is(
  (select prosecdef from pg_proc where oid =
    'public.feature_question_restore_authorized_v2(uuid,text,text,text,uuid)'::regprocedure),
  false,
  'the restore authorizer uses invoker rights'
);

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values (
  '99100000-0000-4000-8000-000000000001',
  '00000000-0000-0000-0000-000000000000',
  'authenticated',
  'authenticated',
  'feature-rotation-student@example.invalid',
  '{}',
  '{"full_name":"Feature Rotation Student"}',
  now(),
  now(),
  false,
  false
);

-- A nonblank failed-grade response is still answered; a blank persisted row is not.
insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status
)
values
  (
    '99100000-0000-4000-8000-000000000001',
    'rotation_tax_answer_0001',
    'TAX-ANSWERED',
    'Taxation Law',
    'A substantive answer whose grading provider failed.',
    'failed'
  ),
  (
    '99100000-0000-4000-8000-000000000001',
    'rotation_tax_blank_0001',
    'TAX-BLANK',
    'Taxation Law',
    '   ',
    'unanswered'
  );

create temporary table rotation_tax as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Taxation Law',
  array['TAX-ANSWERED', 'TAX-BLANK'],
  '{}'::text[],
  'rotation_tax_select_0001'
) as value;

select is(
  (select value->>'questionId' from rotation_tax),
  'TAX-BLANK',
  'failed-grade nonblank work is excluded while blank work remains eligible'
);
select is(
  (select (value->>'answeredCount')::integer from rotation_tax),
  1,
  'only the nonblank response counts as answered'
);
select ok(
  (select value->>'issuanceId' from rotation_tax)
    ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$',
  'selection returns an owner-bound issuance ID'
);
select is(
  public.feature_question_restore_authorized_v2(
    '99100000-0000-4000-8000-000000000001',
    'bar_question_practice',
    'Taxation Law',
    'TAX-BLANK',
    (select (value->>'issuanceId')::uuid from rotation_tax)
  ),
  true,
  'the exact matching active issuance authorizes restoration'
);
select is(
  public.feature_question_restore_authorized_v2(
    '99100000-0000-4000-8000-000000000001',
    'bar_question_practice',
    'Taxation Law',
    'TAX-BLANK',
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  ),
  false,
  'an arbitrary issuance ID cannot authorize restoration'
);
select is(
  (select count(*) from public.feature_question_rotation_receipts
   where subject = 'Taxation Law'),
  1::bigint,
  'one durable receipt is stored for the request'
);
select is(
  (select count(*) from public.feature_question_issuances
   where subject = 'Taxation Law'),
  1::bigint,
  'one issuance record is stored for the selected question'
);

insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status
)
values (
  '99100000-0000-4000-8000-000000000001',
  'rotation_tax_answer_0002',
  'TAX-BLANK',
  'Taxation Law',
  'The formerly blank item now has a substantive answer.',
  'completed'
);

select is(
  public.feature_question_restore_authorized_v2(
    '99100000-0000-4000-8000-000000000001',
    'bar_question_practice',
    'Taxation Law',
    'TAX-BLANK',
    (select (value->>'issuanceId')::uuid from rotation_tax)
  ),
  false,
  'an otherwise valid issuance cannot restore a question after it is answered'
);

select throws_ok(
  $$
    select public.select_feature_question_v2(
      '99100000-0000-4000-8000-000000000001',
      'bar_exam_simulation',
      'Taxation Law',
      array['TAX-BLANK'],
      '{}'::text[],
      'rotation_wrong_feature_0001'
    )
  $$,
  'P0001',
  'FEATURE_QUESTION_SELECTION_INVALID',
  'the one-question selector rejects Simulation allocation'
);

insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status
)
values (
  '99100000-0000-4000-8000-000000000001',
  'rotation_labor_answer_0001',
  'LAB-ANSWERED',
  'Labor Law',
  'Completed Labor answer.',
  'completed'
);

create temporary table rotation_first as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Labor Law',
  array['LAB-ANSWERED', 'LAB-FRESH-1', 'LAB-FRESH-2'],
  '{}'::text[],
  'rotation_labor_select_0001'
) as value;

create temporary table rotation_second as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Labor Law',
  array['LAB-ANSWERED', 'LAB-FRESH-1', 'LAB-FRESH-2'],
  '{}'::text[],
  'rotation_labor_select_0002'
) as value;

create temporary table rotation_first_replay as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Labor Law',
  array['LAB-ANSWERED', 'LAB-FRESH-1', 'LAB-FRESH-2'],
  '{}'::text[],
  'rotation_labor_select_0001'
) as value;

select ok(
  (select value->>'questionId' from rotation_first)
    = any(array['LAB-FRESH-1', 'LAB-FRESH-2']),
  'the first request excludes answered work'
);
select isnt(
  (select value->>'questionId' from rotation_second),
  (select value->>'questionId' from rotation_first),
  'a concurrent-style later request receives the other unissued question'
);
select is(
  (select value->>'questionId' from rotation_first_replay),
  (select value->>'questionId' from rotation_first),
  'an out-of-order retry of A after B returns A original selection'
);
select is(
  (select (value->>'replayed')::boolean from rotation_first_replay),
  true,
  'the out-of-order retry is marked replayed'
);
select throws_ok(
  $$
    select public.select_feature_question_v2(
      '99100000-0000-4000-8000-000000000001',
      'bar_question_practice',
      'Labor Law',
      array['LAB-ANSWERED', 'LAB-FRESH-1'],
      '{}'::text[],
      'rotation_labor_select_0001'
    )
  $$,
  'P0001',
  'FEATURE_QUESTION_REQUEST_CONFLICT',
  'a reused request key with a changed payload is rejected'
);

create temporary table rotation_soft_exclusion as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Civil Law',
  array['CIV-SOFT-1', 'CIV-SOFT-2'],
  array['CIV-SOFT-1'],
  'rotation_civil_select_0001'
) as value;

select is(
  (select value->>'questionId' from rotation_soft_exclusion),
  'CIV-SOFT-2',
  'a client exclusion is honored as a soft preference without shrinking inventory'
);

insert into public.exam_attempts (
  user_id, request_key, question_bank_id, subject, answer_text, status
)
values
  (
    '99100000-0000-4000-8000-000000000001',
    'rotation_labor_answer_0002',
    'LAB-FRESH-1',
    'Labor Law',
    'Completed first fresh question.',
    'completed'
  ),
  (
    '99100000-0000-4000-8000-000000000001',
    'rotation_labor_answer_0003',
    'LAB-FRESH-2',
    'Labor Law',
    'Completed second fresh question.',
    'completed'
  );

create temporary table rotation_exhausted as
select public.select_feature_question_v2(
  '99100000-0000-4000-8000-000000000001',
  'bar_question_practice',
  'Labor Law',
  array['LAB-ANSWERED', 'LAB-FRESH-1', 'LAB-FRESH-2'],
  '{}'::text[],
  'rotation_labor_select_0003'
) as value;

select is(
  (select (value->>'exhausted')::boolean from rotation_exhausted),
  true,
  'the selector returns terminal exhaustion instead of recycling answered work'
);
select is(
  (select value->>'questionId' from rotation_exhausted),
  null,
  'terminal exhaustion returns no question ID'
);
select is(
  (select (value->>'answeredCount')::integer from rotation_exhausted),
  3,
  'terminal exhaustion reports all three answered questions'
);

update public.feature_question_issuances
set issued_at = now() - interval '8 days',
    expires_at = now() - interval '1 day'
where id = (select (value->>'issuanceId')::uuid from rotation_tax);

select is(
  public.feature_question_restore_authorized_v2(
    '99100000-0000-4000-8000-000000000001',
    'bar_question_practice',
    'Taxation Law',
    'TAX-BLANK',
    (select (value->>'issuanceId')::uuid from rotation_tax)
  ),
  false,
  'an expired issuance cannot restore a hidden question'
);

select * from finish();
rollback;
