-- Let an assigned Beadle who is also an active rostered student move from
-- class preparation into the same examination without retyping or receiving
-- the class code. Authorization is derived from the server-side Beadle
-- assignment and roster identity; the credential hash is never returned.

begin;

create or replace function public.exam_room_beadle_student_waiting_room_v1(
  p_user_id uuid,
  p_exam_public_id uuid,
  p_rate_key_hash text,
  p_device_instance_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_student_key_hash text;
  v_result jsonb;
begin
  if p_rate_key_hash is null or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;
  if p_device_instance_hash is not null
    and p_device_instance_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;

  select exam.* into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  if not public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED';
  end if;

  select credential.token_hash into v_student_key_hash
  from public.exam_room_student_access_issuances issuance
  join public.exam_room_credentials credential
    on credential.id = issuance.credential_id
  where issuance.exam_id = v_exam.id
    and issuance.status = 'active'
    and credential.status = 'active'
    and credential.credential_type = 'student_exam'
    and credential.expires_at > clock_timestamp()
  order by issuance.issued_at desc
  limit 1;

  v_result := public.exam_room_student_waiting_room_v4(
    p_user_id,
    p_exam_public_id,
    v_student_key_hash,
    p_rate_key_hash,
    p_device_instance_hash
  );

  return v_result || jsonb_build_object(
    'beadleDirectEntry', true,
    'accessAuthorization', 'active_beadle_assignment'
  );
end;
$$;

create or replace function public.exam_room_start_beadle_student_attempt_v1(
  p_user_id uuid,
  p_exam_public_id uuid,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_beadle_assignment_id uuid;
  v_student_key_hash text;
  v_preflight jsonb;
begin
  v_preflight := public.exam_room_beadle_student_waiting_room_v1(
    p_user_id,
    p_exam_public_id,
    p_rate_key_hash,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_preflight ->> 'startBlockerCode', v_preflight ->> 'code'),
      'serverNow', v_preflight -> 'serverNow',
      'opensAt', v_preflight -> 'opensAt',
      'entryClosesAt', v_preflight -> 'entryClosesAt',
      'beadleDirectEntry', true
    );
  end if;

  select exam.* into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  -- Hold the exact active assignment through attempt creation so a concurrent
  -- revocation cannot race the final authorization decision.
  select assignment.id into v_beadle_assignment_id
  from public.exam_room_beadle_assignments assignment
  where assignment.exam_id = v_exam.id
    and assignment.beadle_user_id = p_user_id
    and assignment.status = 'active'
    and assignment.expires_at > clock_timestamp()
    and v_exam.status <> 'sealed'
    and v_exam.release_id is null
  for update of assignment;
  if not found then raise exception 'EXAM_ROOM_BEADLE_ASSIGNMENT_REQUIRED'; end if;

  select credential.token_hash into v_student_key_hash
  from public.exam_room_student_access_issuances issuance
  join public.exam_room_credentials credential
    on credential.id = issuance.credential_id
  where issuance.exam_id = v_exam.id
    and issuance.status = 'active'
    and credential.status = 'active'
    and credential.credential_type = 'student_exam'
    and credential.expires_at > clock_timestamp()
  order by issuance.issued_at desc
  limit 1;

  return public.exam_room_start_attempt_v4(
    p_user_id,
    p_exam_public_id,
    v_student_key_hash,
    p_rate_key_hash
  );
end;
$$;

comment on function public.exam_room_beadle_student_waiting_room_v1(
  uuid, uuid, text, text
) is 'Question-free waiting-room handoff for an assigned Beadle who is also the rostered student; no class code is returned.';

comment on function public.exam_room_start_beadle_student_attempt_v1(
  uuid, uuid, text
) is 'Starts only the assigned Beadle own rostered attempt after a fresh direct-entry preflight.';

revoke all on function public.exam_room_beadle_student_waiting_room_v1(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_beadle_student_waiting_room_v1(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.exam_room_start_beadle_student_attempt_v1(
  uuid, uuid, text
) from public, anon, authenticated;
grant execute on function public.exam_room_start_beadle_student_attempt_v1(
  uuid, uuid, text
) to service_role;

commit;

