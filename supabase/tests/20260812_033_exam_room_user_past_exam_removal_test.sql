-- Transactional behavioral proof for per-user examination workspace removal.
-- Every synthetic identity and record is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  ('5b000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'past-professor@example.invalid', '{}', '{}', now(), now(), false, false),
  ('5b000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'past-beadle@example.invalid', '{}', '{}', now(), now(), false, false),
  ('5b000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'past-student@example.invalid', '{}', '{}', now(), now(), false, false),
  ('5b000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'past-outsider@example.invalid', '{}', '{}', now(), now(), false, false);

insert into public.exam_room_professors (user_id, activated_by)
values ('5b000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000001');

insert into public.exam_room_classrooms (
  id, public_id, owner_professor_id, title, school_name, academic_term
) values
  ('5b000000-0000-4000-8000-000000000010', '5b000000-0000-4000-8000-000000000011',
   '5b000000-0000-4000-8000-000000000001', 'Completed Room', 'Synthetic College', 'Beta 2026'),
  ('5b000000-0000-4000-8000-000000000012', '5b000000-0000-4000-8000-000000000013',
   '5b000000-0000-4000-8000-000000000001', 'Upcoming Room', 'Synthetic College', 'Beta 2026');

insert into public.exam_room_exams (
  id, public_id, classroom_id, owner_professor_id, title, instructions,
  requested_question_count, duration_minutes, opens_at, hard_closes_at,
  status, integrity_preset, include_questionnaire
) values
  ('5b000000-0000-4000-8000-000000000020', '5b000000-0000-4000-8000-000000000021',
   '5b000000-0000-4000-8000-000000000010', '5b000000-0000-4000-8000-000000000001',
   'Completed Examination', 'Answer using ALAC.', 1, 60,
   now() - interval '2 hours', now() - interval '1 hour', 'closed', 'standard', false),
  ('5b000000-0000-4000-8000-000000000022', '5b000000-0000-4000-8000-000000000023',
   '5b000000-0000-4000-8000-000000000012', '5b000000-0000-4000-8000-000000000001',
   'Upcoming Examination', 'Answer using ALAC.', 1, 60,
   now() + interval '1 hour', now() + interval '2 hours', 'scheduled', 'standard', false);

insert into public.exam_room_beadle_assignments (
  id, exam_id, beadle_user_id, status, assigned_by, assigned_at, expires_at
) values
  ('5b000000-0000-4000-8000-000000000030', '5b000000-0000-4000-8000-000000000020',
   '5b000000-0000-4000-8000-000000000002', 'active',
   '5b000000-0000-4000-8000-000000000001', now(), now() + interval '1 day'),
  ('5b000000-0000-4000-8000-000000000031', '5b000000-0000-4000-8000-000000000022',
   '5b000000-0000-4000-8000-000000000002', 'active',
   '5b000000-0000-4000-8000-000000000001', now(), now() + interval '1 day');

insert into public.exam_room_roster (
  id, classroom_id, student_user_id, canonical_email, student_number,
  candidate_number, display_name, status, created_by, updated_by
) values
  ('5b000000-0000-4000-8000-000000000040', '5b000000-0000-4000-8000-000000000010',
   '5b000000-0000-4000-8000-000000000003', 'past-student@example.invalid',
   'PAST-001', 'PAST-001', 'Past Student', 'active',
   '5b000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000001'),
  ('5b000000-0000-4000-8000-000000000041', '5b000000-0000-4000-8000-000000000012',
   '5b000000-0000-4000-8000-000000000003', 'past-student@example.invalid',
   'NEXT-001', 'NEXT-001', 'Past Student', 'active',
   '5b000000-0000-4000-8000-000000000001', '5b000000-0000-4000-8000-000000000001');

do $past_exam_behavior$
declare
  v_professor constant uuid := '5b000000-0000-4000-8000-000000000001';
  v_beadle constant uuid := '5b000000-0000-4000-8000-000000000002';
  v_student constant uuid := '5b000000-0000-4000-8000-000000000003';
  v_outsider constant uuid := '5b000000-0000-4000-8000-000000000004';
  v_completed constant uuid := '5b000000-0000-4000-8000-000000000021';
  v_upcoming constant uuid := '5b000000-0000-4000-8000-000000000023';
  v_result jsonb;
begin
  v_result := public.exam_room_dismiss_past_exam_v1(
    v_professor, v_completed, 'past_professor_20260812'
  );
  if (v_result ->> 'scope') <> 'professor' then
    raise exception 'PAST_EXAM_PROFESSOR_SCOPE_FAILED';
  end if;

  v_result := public.exam_room_dismiss_past_exam_v1(
    v_beadle, v_completed, 'past_beadle_20260812'
  );
  if (v_result ->> 'scope') <> 'beadle' then
    raise exception 'PAST_EXAM_BEADLE_SCOPE_FAILED';
  end if;

  v_result := public.exam_room_dismiss_past_exam_v1(
    v_student, v_completed, 'past_student_20260812'
  );
  if (v_result ->> 'scope') <> 'student' then
    raise exception 'PAST_EXAM_STUDENT_SCOPE_FAILED';
  end if;

  if (select count(*) from public.exam_room_user_exam_dismissals where exam_id =
      '5b000000-0000-4000-8000-000000000020') <> 3 then
    raise exception 'PAST_EXAM_PER_USER_ROWS_FAILED';
  end if;
  if (select count(*) from public.exam_room_exams where id in (
      '5b000000-0000-4000-8000-000000000020',
      '5b000000-0000-4000-8000-000000000022'
  )) <> 2 then
    raise exception 'PAST_EXAM_CANONICAL_RECORD_CHANGED';
  end if;

  begin
    perform public.exam_room_dismiss_past_exam_v1(
      v_outsider, v_completed, 'past_outsider_20260812'
    );
    raise exception 'PAST_EXAM_OUTSIDER_ALLOWED';
  exception when others then
    if sqlerrm = 'PAST_EXAM_OUTSIDER_ALLOWED'
      or sqlerrm not like '%EXAM_ROOM_EXAM_ACCESS_REQUIRED%'
    then raise; end if;
  end;

  v_result := public.exam_room_dismiss_past_exam_v1(
    v_professor, v_upcoming, 'next_professor_20260812'
  );
  if (v_result ->> 'scope') <> 'professor'
    or (v_result ->> 'removedFromWorkspace')::boolean is not true
  then
    raise exception 'WORKSPACE_UPCOMING_PROFESSOR_REMOVE_FAILED';
  end if;

  v_result := public.exam_room_dismiss_past_exam_v1(
    v_beadle, v_upcoming, 'next_beadle_20260812'
  );
  if (v_result ->> 'scope') <> 'beadle' then
    raise exception 'WORKSPACE_UPCOMING_BEADLE_REMOVE_FAILED';
  end if;

  v_result := public.exam_room_dismiss_past_exam_v1(
    v_student, v_upcoming, 'next_student_20260812'
  );
  if (v_result ->> 'scope') <> 'student' then
    raise exception 'WORKSPACE_UPCOMING_STUDENT_REMOVE_FAILED';
  end if;

  if (select count(*) from public.exam_room_user_exam_dismissals where exam_id =
      '5b000000-0000-4000-8000-000000000022') <> 3 then
    raise exception 'WORKSPACE_UPCOMING_PER_USER_ROWS_FAILED';
  end if;

  if (select count(*) from public.exam_room_exams where id in (
      '5b000000-0000-4000-8000-000000000020',
      '5b000000-0000-4000-8000-000000000022'
  )) <> 2 then
    raise exception 'WORKSPACE_CANONICAL_RECORD_CHANGED';
  end if;

  if has_table_privilege('anon', 'public.exam_room_user_exam_dismissals', 'select')
    or has_table_privilege('authenticated', 'public.exam_room_user_exam_dismissals', 'insert')
  then
    raise exception 'PAST_EXAM_BROWSER_GRANT_FAILED';
  end if;
end;
$past_exam_behavior$;

rollback;
