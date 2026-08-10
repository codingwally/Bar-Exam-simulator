-- Examination Room authoritative student start-state correction.
--
-- A student must never receive RESUME_READY after the examination or the
-- student's attempt deadline has ended.  Terminal examination state is also
-- evaluated before access-code validation so an expired room cannot create a
-- misleading credential failure or hide the actual closure reason.

begin;

create or replace function public.exam_room_student_waiting_room_v4(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text default null,
  p_rate_key_hash text default null,
  p_device_instance_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_publication public.exam_room_publications%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_email text;
  v_accommodation jsonb := '{}'::jsonb;
  v_credential jsonb;
  v_window_open timestamptz;
  v_window_close timestamptz;
  v_effective_hard_close timestamptz;
  v_entry_closes_at timestamptz;
  v_late_minutes integer := 0;
  v_extra_minutes integer := 0;
  v_access_required boolean := true;
  v_access_ready boolean := false;
  v_access_accepted boolean := false;
  v_access_status text := 'required';
  v_blocker text := 'STUDENT_NOT_ELIGIBLE';
  v_state text := 'blocked';
  v_can_start boolean := false;
  v_poll_after_ms integer;
begin
  if p_student_key_hash is not null
    and p_student_key_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID'; end if;
  if p_rate_key_hash is not null
    and p_rate_key_hash !~ '^[0-9a-f]{64}$'
  then raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID'; end if;

  v_base := public.exam_room_student_preflight_v2(
    p_student_user_id,
    p_exam_public_id,
    p_device_instance_hash
  );
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select lower(user_record.email) into v_email
  from auth.users user_record
  where user_record.id = p_student_user_id;
  select * into v_roster
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active'
    and (
      roster.student_user_id = p_student_user_id
      or roster.canonical_email = v_email
  )
  limit 1;

  -- Preserve the question-free, schedule-free denial for outsiders, account
  -- mismatches, and unpublished examinations.
  if (v_base ->> 'code') in (
    'ROSTER_REQUIRED', 'ROSTER_ACCOUNT_MISMATCH', 'EXAM_NOT_PUBLISHED'
  ) then
    return jsonb_build_object(
      'ok', true,
      'preflightVersion', 4,
      'waitingRoom', true,
      'waitingRoomState', 'blocked',
      'eligible', false,
      'code', v_base ->> 'code',
      'examId', v_exam.public_id,
      'serverNow', v_now,
      'accessCodeAccepted', false,
      'accessCodeStatus', 'unavailable',
      'canStart', false,
      'startBlockerCode', v_base ->> 'code',
      'startBlocker', v_base ->> 'code',
      'pollAfterMs', null,
      'checks', jsonb_build_object(
        'authenticated', true,
        'rosterMatched', (v_base ->> 'code') <> 'ROSTER_REQUIRED',
        'accountMatched', (v_base ->> 'code') not in (
          'ROSTER_REQUIRED', 'ROSTER_ACCOUNT_MISMATCH'
        ),
        'published', (v_base ->> 'code') <> 'EXAM_NOT_PUBLISHED'
      )
    );
  end if;

  select * into v_publication
  from public.exam_room_publications publication
  where publication.id = v_exam.current_publication_id;

  if v_roster.id is not null then
    select accommodation.configuration into v_accommodation
    from public.exam_room_accommodations accommodation
    where accommodation.exam_id = v_exam.id
      and accommodation.roster_id = v_roster.id
      and accommodation.status = 'active';
    v_accommodation := coalesce(v_accommodation, '{}'::jsonb);

    select * into v_attempt
    from public.exam_room_attempts attempt
    where attempt.exam_id = v_exam.id
      and attempt.roster_id = v_roster.id;
  end if;

  if v_publication.id is not null then
    v_access_required := coalesce(
      (v_publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean,
      true
    );
    v_late_minutes := coalesce(
      (v_publication.rules_snapshot ->> 'lateAdmissionMinutes')::integer,
      0
    );
  end if;
  v_extra_minutes := coalesce((v_accommodation ->> 'extraMinutes')::integer, 0)
    + coalesce((v_accommodation ->> 'incidentExtensionMinutes')::integer, 0);
  v_window_open := coalesce(
    nullif(v_accommodation ->> 'individualOpensAt', '')::timestamptz,
    v_exam.opens_at
  );
  v_window_close := coalesce(
    nullif(v_accommodation ->> 'individualHardClosesAt', '')::timestamptz,
    v_exam.hard_closes_at
  );
  if v_window_close is not null then
    v_effective_hard_close := v_window_close
      + make_interval(mins => v_extra_minutes);
  end if;
  if v_window_open is not null and v_window_close is not null then
    v_entry_closes_at := least(
      v_window_close,
      v_window_open + make_interval(mins => greatest(v_late_minutes, 1))
    );
  end if;

  v_access_ready := not v_access_required or exists (
    select 1
    from public.exam_room_student_access_issuances issuance
    join public.exam_room_credentials credential
      on credential.id = issuance.credential_id
    where issuance.exam_id = v_exam.id
      and issuance.status = 'active'
      and credential.status = 'active'
      and credential.credential_type = 'student_exam'
      and credential.expires_at > v_now
  );

  -- Terminal examination state is authoritative.  Evaluate it before attempt
  -- resume and before validating the class code.  This prevents a stale open
  -- attempt or a wrong code from masking that the room has already closed.
  if v_exam.status in ('closed', 'grading', 'sealed')
    or (
      v_effective_hard_close is not null
      and v_now >= v_effective_hard_close
    )
  then
    v_access_accepted := not v_access_required;
    v_access_status := case
      when v_access_required then 'required'
      else 'not_required'
    end;
    v_blocker := 'EXAM_CLOSED';
    v_state := 'blocked';
  elsif v_attempt.id is not null
    and v_attempt.status in ('in_progress', 'locked')
    and v_attempt.server_deadline is not null
    and v_now >= v_attempt.server_deadline
  then
    v_access_accepted := true;
    v_access_status := 'not_required';
    v_blocker := 'DEADLINE_REACHED';
    v_state := 'blocked';
  elsif v_attempt.id is not null
    and v_attempt.status in ('in_progress', 'locked')
  then
    v_access_accepted := true;
    v_access_status := 'not_required';
    v_blocker := 'RESUME_READY';
    v_state := 'resume';
    v_can_start := true;
  elsif v_attempt.id is not null
    and v_attempt.status in ('submitted', 'auto_submitted', 'sealed')
  then
    v_access_accepted := true;
    v_access_status := 'not_required';
    v_blocker := 'ATTEMPT_ALREADY_SUBMITTED';
  elsif not coalesce((v_base ->> 'eligible')::boolean, false) then
    v_access_status := case
      when v_access_required then 'required'
      else 'not_required'
    end;
    v_blocker := coalesce(v_base ->> 'code', 'STUDENT_NOT_ELIGIBLE');
  elsif not v_access_ready then
    v_access_status := 'not_issued';
    v_blocker := 'STUDENT_ACCESS_NOT_READY';
  elsif v_access_required and p_student_key_hash is null then
    v_access_status := 'required';
    v_blocker := 'STUDENT_ACCESS_CODE_REQUIRED';
  else
    if v_access_required then
      if p_rate_key_hash is null then
        raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
      end if;
      v_credential := public.exam_room_check_student_credential_preopen_v4(
        p_student_user_id,
        v_exam.id,
        p_student_key_hash,
        p_rate_key_hash
      );
      v_access_accepted := coalesce((v_credential ->> 'ok')::boolean, false);
      v_access_status := case v_credential ->> 'code'
        when 'CREDENTIAL_LOCKED' then 'locked'
        when 'CREDENTIAL_INVALID' then 'invalid'
        when 'CREDENTIAL_NOT_ACTIVE' then 'not_issued'
        else case when v_access_accepted then 'accepted' else 'invalid' end
      end;
      if not v_access_accepted then
        v_blocker := coalesce(v_credential ->> 'code', 'CREDENTIAL_INVALID');
      end if;
    else
      v_access_accepted := true;
      v_access_status := 'not_required';
    end if;

    if v_access_accepted then
      if v_window_open is null or v_now < v_window_open then
        v_blocker := 'EXAM_NOT_OPEN';
        v_state := 'waiting';
        v_poll_after_ms := case
          when v_window_open is null then null
          when v_window_open - v_now <= interval '60 seconds' then 5000
          else 15000
        end;
      elsif v_entry_closes_at is null or v_now >= v_entry_closes_at then
        v_blocker := 'LATE_ADMISSION_CLOSED';
      else
        v_blocker := 'READY';
        v_state := 'ready';
        v_can_start := true;
      end if;
    end if;
  end if;

  return v_base || jsonb_build_object(
    'preflightVersion', 4,
    'waitingRoom', true,
    'waitingRoomState', v_state,
    'accessCodeRequired', v_access_required,
    'accessCodeAccepted', v_access_accepted,
    'accessCodeStatus', v_access_status,
    'studentAccessReady', v_access_ready,
    'serverNow', v_now,
    'opensAt', v_window_open,
    'entryClosesAt', v_entry_closes_at,
    'hardClosesAt', v_effective_hard_close,
    'canStart', v_can_start,
    'startBlockerCode', v_blocker,
    'startBlocker', v_blocker,
    'pollAfterMs', v_poll_after_ms,
    'rosterIdentity', case
      when v_roster.id is null then null
      else jsonb_build_object(
        'candidateNumber', v_roster.candidate_number,
        'accountMatched', v_roster.student_user_id is null
          or v_roster.student_user_id = p_student_user_id
      )
    end
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_WAITING_ROOM_INVALID';
end;
$$;

comment on function public.exam_room_student_waiting_room_v4(
  uuid, uuid, text, text, text
) is 'Question-free student waiting-room preflight with terminal exam and attempt deadline enforcement.';

revoke all on function public.exam_room_student_waiting_room_v4(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_student_waiting_room_v4(
  uuid, uuid, text, text, text
) to service_role;

commit;
