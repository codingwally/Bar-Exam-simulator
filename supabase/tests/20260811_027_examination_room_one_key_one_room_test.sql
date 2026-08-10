-- Behavioral contract for 20260811003200_examination_room_one_key_one_room.sql.
-- Synthetic records are transaction-scoped and always rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
)
values
  (
    '32000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'room-key-admin@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Room Key Admin"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '32000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'room-key-professor@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Room Key Professor"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '32000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'room-key-student@example.invalid',
    '{}'::jsonb, '{"full_name":"Synthetic Room Key Student"}'::jsonb,
    now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id = '32000000-0000-4000-8000-000000000001'::uuid;

do $room_key_behavior$
declare
  v_admin constant uuid := '32000000-0000-4000-8000-000000000001'::uuid;
  v_professor constant uuid := '32000000-0000-4000-8000-000000000002'::uuid;
  v_student constant uuid := '32000000-0000-4000-8000-000000000003'::uuid;
  v_issue_one jsonb;
  v_issue_two jsonb;
  v_issue_three jsonb;
  v_redeem_one jsonb;
  v_redeem_two jsonb;
  v_replay jsonb;
  v_ledger jsonb;
  v_revoke jsonb;
  v_revoke_replay jsonb;
  v_room_one uuid;
  v_baseline_total integer;
begin
  v_ledger := public.exam_room_admin_professor_activation_ledger(
    v_admin, 'all', 1, 0
  );
  v_baseline_total := (v_ledger ->> 'total')::integer;

  v_issue_one := public.exam_room_issue_professor_activation(
    v_admin,
    'room-key-professor@example.invalid',
    repeat('a', 64),
    'Constitutional Law Midterms',
    'Synthetic College of Law',
    'First Semester 2026-2027',
    now() + interval '2 days',
    'Create the first synthetic Examination Room.'
  );
  v_issue_two := public.exam_room_issue_professor_activation(
    v_admin,
    'room-key-professor@example.invalid',
    repeat('b', 64),
    'Civil Law Finals',
    'Synthetic College of Law',
    'First Semester 2026-2027',
    now() + interval '3 days',
    'Create the second independent Examination Room.'
  );

  if (v_issue_one ->> 'ok')::boolean is not true
    or (v_issue_two ->> 'ok')::boolean is not true
    or (
      select count(*)
      from public.exam_room_professor_activations a
      where a.target_email = 'room-key-professor@example.invalid'
        and a.status = 'issued'
    ) <> 2
  then
    raise exception 'ROOM_KEY_TEST_MULTIPLE_PENDING_FAILED';
  end if;

  v_redeem_one := public.exam_room_redeem_professor_activation(
    v_professor, repeat('a', 64), repeat('1', 64)
  );
  v_redeem_two := public.exam_room_redeem_professor_activation(
    v_professor, repeat('b', 64), repeat('2', 64)
  );

  if (v_redeem_one ->> 'ok')::boolean is not true
    or (v_redeem_two ->> 'ok')::boolean is not true
    or (v_redeem_one ->> 'classroomId') = (v_redeem_two ->> 'classroomId')
    or (
      select count(*)
      from public.exam_room_classrooms c
      where c.owner_professor_id = v_professor
    ) <> 2
    or (
      select count(*)
      from public.exam_room_professor_activations a
      where a.target_email = 'room-key-professor@example.invalid'
        and a.status = 'redeemed'
        and a.classroom_id is not null
    ) <> 2
  then
    raise exception 'ROOM_KEY_TEST_BINDING_FAILED';
  end if;

  v_replay := public.exam_room_redeem_professor_activation(
    v_professor, repeat('a', 64), repeat('1', 64)
  );
  if v_replay ->> 'code' <> 'ACTIVATION_ALREADY_REDEEMED' then
    raise exception 'ROOM_KEY_TEST_REPLAY_FAILED';
  end if;

  v_room_one := (v_redeem_one ->> 'classroomId')::uuid;
  perform public.exam_room_create_exam(
    v_professor, v_room_one, 'Midterm Examination',
    'Answer every question in complete sentences.', 1, 'standard', false
  );
  begin
    perform public.exam_room_create_exam(
      v_professor, v_room_one, 'Forbidden Second Examination',
      'This call must fail.', 1, 'standard', false
    );
    raise exception 'ROOM_KEY_TEST_SECOND_EXAM_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ONE_EXAM_LIMIT' then raise; end if;
  end;

  begin
    perform public.exam_room_create_classroom(
      v_professor, 'Forbidden Free Room', 'Synthetic College of Law', 'First Semester'
    );
    raise exception 'ROOM_KEY_TEST_FREE_ROOM_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ROOM_KEY_REQUIRED' then raise; end if;
  end;

  v_issue_three := public.exam_room_issue_professor_activation(
    v_admin,
    'room-key-professor@example.invalid',
    repeat('c', 64),
    'Remedial Law Special Examination',
    'Synthetic College of Law',
    'First Semester 2026-2027',
    now() + interval '4 days',
    'Create a revocation test invitation record.'
  );
  v_revoke := public.exam_room_admin_revoke_professor_activation(
    v_admin,
    (v_issue_three ->> 'activationId')::uuid,
    'The synthetic examination schedule was withdrawn.',
    'room_key_revoke_request_0001'
  );
  v_revoke_replay := public.exam_room_admin_revoke_professor_activation(
    v_admin,
    (v_issue_three ->> 'activationId')::uuid,
    'The synthetic examination schedule was withdrawn.',
    'room_key_revoke_request_0001'
  );
  if v_revoke ->> 'status' <> 'revoked'
    or (v_revoke_replay ->> 'idempotent')::boolean is not true
  then
    raise exception 'ROOM_KEY_TEST_REVOKE_FAILED';
  end if;

  begin
    update public.exam_room_professor_activations
    set status = 'redeemed'
    where id = (v_issue_three ->> 'activationId')::uuid;
    raise exception 'ROOM_KEY_TEST_TERMINAL_STATUS_REOPENED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT' then raise; end if;
  end;
  begin
    update public.exam_room_professor_activations
    set revoke_reason = 'A forbidden rewrite of the recorded reason.'
    where id = (v_issue_three ->> 'activationId')::uuid;
    raise exception 'ROOM_KEY_TEST_REVOKE_AUDIT_REWRITTEN';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT' then raise; end if;
  end;
  begin
    update public.exam_room_professor_activations
    set redeemed_at = redeemed_at + interval '1 second'
    where id = (v_issue_one ->> 'activationId')::uuid;
    raise exception 'ROOM_KEY_TEST_REDEMPTION_AUDIT_REWRITTEN';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ACTIVATION_ROOM_BINDING_CONFLICT' then raise; end if;
  end;

  v_ledger := public.exam_room_admin_professor_activation_ledger(
    v_admin, 'all', 2, 0
  );
  if (v_ledger ->> 'ok')::boolean is not true
    or (v_ledger ->> 'total')::integer <> v_baseline_total + 3
    or jsonb_array_length(v_ledger -> 'activations') <> 2
    or (v_ledger ->> 'offset')::integer <> 0
    or v_ledger::text like '%' || repeat('a', 64) || '%'
    or v_ledger::text like '%' || repeat('b', 64) || '%'
    or v_ledger::text like '%' || repeat('c', 64) || '%'
    or v_ledger::text ilike '%token_hash%'
  then
    raise exception 'ROOM_KEY_TEST_LEDGER_FAILED';
  end if;
  v_ledger := public.exam_room_admin_professor_activation_ledger(
    v_admin, 'all', 2, 2
  );
  if jsonb_array_length(v_ledger -> 'activations') <> least(2, v_baseline_total + 1)
    or (v_ledger ->> 'offset')::integer <> 2
  then
    raise exception 'ROOM_KEY_TEST_LEDGER_PAGING_FAILED';
  end if;

  begin
    perform public.exam_room_issue_professor_activation(
      v_student,
      'room-key-professor@example.invalid',
      repeat('d', 64),
      'Unauthorized Room',
      'Synthetic College of Law',
      'First Semester 2026-2027',
      now() + interval '1 day',
      'This non-Admin issuance must fail.'
    );
    raise exception 'ROOM_KEY_TEST_NON_ADMIN_ISSUED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ADMIN_REQUIRED' then raise; end if;
  end;
end;
$room_key_behavior$;

rollback;
