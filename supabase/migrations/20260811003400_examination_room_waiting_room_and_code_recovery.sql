-- Examination Room waiting room and recoverable active class code.
--
-- Student exam codes remain hashed for admission checks. A separate
-- Worker-encrypted AES-GCM envelope lets the currently assigned Beadle view
-- the active class code after a refresh without storing usable plaintext in
-- PostgreSQL. Student waiting-room preflight validates that code before the
-- opening time without returning questions or creating an attempt.

begin;

alter table public.exam_room_student_access_issuances
  add column if not exists code_ciphertext text,
  add column if not exists code_nonce text,
  add column if not exists code_key_id text,
  add column if not exists code_algorithm text,
  add column if not exists code_encrypted_at timestamptz;

alter table public.exam_room_student_access_issuances
  drop constraint if exists exam_room_student_access_code_envelope_shape_check;

alter table public.exam_room_student_access_issuances
  add constraint exam_room_student_access_code_envelope_shape_check check (
    (
      num_nonnulls(
        code_ciphertext, code_nonce, code_key_id,
        code_algorithm, code_encrypted_at
      ) = 0
    )
    or
    (
      num_nonnulls(
        code_ciphertext, code_nonce, code_key_id,
        code_algorithm, code_encrypted_at
      ) = 5
      and code_ciphertext ~ '^[A-Za-z0-9_-]+$'
      and char_length(code_ciphertext) between 38 and 4096
      and code_nonce ~ '^[A-Za-z0-9_-]{16}$'
      and code_key_id ~ '^[A-Za-z0-9._-]{1,64}$'
      and code_algorithm = 'A256GCM'
      and code_encrypted_at is not null
    )
  );

comment on column public.exam_room_student_access_issuances.code_ciphertext is
  'Worker-encrypted AES-GCM envelope only; never a plaintext student exam code.';
comment on column public.exam_room_student_access_issuances.code_nonce is
  'Unique 96-bit AES-GCM nonce encoded as unpadded base64url.';
comment on column public.exam_room_student_access_issuances.code_key_id is
  'Non-secret Worker key identifier used for explicit envelope-key rotation.';

-- This checker deliberately ignores valid_from so a signed-in, roster-bound
-- student can prove the active class code in the waiting room. Expiry, scope,
-- active issuance, bounded failure windows, and lockout remain enforced.
create or replace function public.exam_room_check_student_credential_preopen_v4(
  p_actor_user_id uuid,
  p_exam_id uuid,
  p_presented_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_credential public.exam_room_credentials%rowtype;
  v_window public.exam_room_credential_windows%rowtype;
  v_window_found boolean := false;
  v_failures integer;
  v_locked_until timestamptz;
begin
  if p_presented_hash is null
    or p_rate_key_hash is null
    or p_presented_hash !~ '^[0-9a-f]{64}$'
    or p_rate_key_hash !~ '^[0-9a-f]{64}$'
  then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;

  select c.* into v_credential
  from public.exam_room_student_access_issuances issuance
  join public.exam_room_credentials c on c.id = issuance.credential_id
  where issuance.exam_id = p_exam_id
    and issuance.status = 'active'
    and c.exam_id = p_exam_id
    and c.credential_type = 'student_exam'
    and c.status = 'active'
    and (c.scoped_user_id is null or c.scoped_user_id = p_actor_user_id)
  order by issuance.issued_at desc
  limit 1;

  if not found or clock_timestamp() >= v_credential.expires_at then
    return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_NOT_ACTIVE');
  end if;

  select * into v_window
  from public.exam_room_credential_windows credential_window
  where credential_window.exam_id = p_exam_id
    and credential_window.actor_user_id = p_actor_user_id
    and credential_window.credential_type = 'student_exam'
    and credential_window.rate_key_hash = p_rate_key_hash
  for update;
  v_window_found := found;

  if v_window_found
    and v_window.locked_until is not null
    and v_window.locked_until > clock_timestamp()
  then
    return jsonb_build_object(
      'ok', false,
      'code', 'CREDENTIAL_LOCKED',
      'lockedUntil', v_window.locked_until
    );
  end if;

  if v_credential.token_hash <> p_presented_hash then
    -- One atomic UPSERT closes the parallel-first-failure race: a concurrent
    -- loser increments the row committed by the winner instead of resetting
    -- that row to one failure.
    insert into public.exam_room_credential_windows as credential_window (
      exam_id, actor_user_id, credential_type, rate_key_hash,
      failures, window_started_at
    ) values (
      p_exam_id, p_actor_user_id, 'student_exam', p_rate_key_hash,
      1, clock_timestamp()
    )
    on conflict (exam_id, actor_user_id, credential_type, rate_key_hash)
    where exam_id is not null
    do update set
      failures = case
        when credential_window.window_started_at
          < clock_timestamp() - interval '15 minutes'
          then 1
        else least(credential_window.failures + 1, 5)
      end,
      window_started_at = case
        when credential_window.window_started_at
          < clock_timestamp() - interval '15 minutes'
          then clock_timestamp()
        else credential_window.window_started_at
      end,
      locked_until = case
        when credential_window.window_started_at
          < clock_timestamp() - interval '15 minutes'
          then null
        when least(credential_window.failures + 1, 5) >= 5
          then clock_timestamp() + interval '15 minutes'
        else null
      end,
      updated_at = clock_timestamp()
    returning credential_window.failures, credential_window.locked_until
    into v_failures, v_locked_until;

    insert into public.exam_room_audit_log (
      actor_user_id, exam_id, action, metadata
    ) values (
      p_actor_user_id,
      p_exam_id,
      'credential_failed',
      jsonb_build_object('credentialType', 'student_exam', 'stage', 'waiting_room')
    );

    return jsonb_build_object(
      'ok', false,
      'code', case
        when v_failures >= 5 then 'CREDENTIAL_LOCKED'
        else 'CREDENTIAL_INVALID'
      end,
      'lockedUntil', case when v_failures >= 5 then v_locked_until else null end
    );
  end if;

  -- A successful poll is read-only in the common case. This delete only
  -- clears a prior failure window and therefore does not grow per-poll state.
  delete from public.exam_room_credential_windows
  where exam_id = p_exam_id
    and actor_user_id = p_actor_user_id
    and credential_type = 'student_exam'
    and rate_key_hash = p_rate_key_hash;

  return jsonb_build_object('ok', true, 'credentialId', v_credential.id);
end;
$$;

-- V4 wraps the already-audited, idempotent V3 issue/rotation transaction and
-- binds the corresponding encrypted envelope to the still-active issuance.
-- Replaying a superseded request fails closed instead of reflecting an old
-- class code back to the Beadle.
create or replace function public.exam_room_issue_student_access_v4(
  p_beadle_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_code_ciphertext text,
  p_code_nonce text,
  p_code_key_id text,
  p_code_algorithm text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_response jsonb;
  v_issuance_id uuid;
  v_issuance public.exam_room_student_access_issuances%rowtype;
begin
  if p_student_key_hash is null
    or p_code_ciphertext is null
    or p_code_nonce is null
    or p_code_key_id is null
    or p_code_algorithm is null
    or p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_code_ciphertext !~ '^[A-Za-z0-9_-]+$'
    or char_length(p_code_ciphertext) not between 38 and 4096
    or p_code_nonce !~ '^[A-Za-z0-9_-]{16}$'
    or p_code_key_id !~ '^[A-Za-z0-9._-]{1,64}$'
    or p_code_algorithm <> 'A256GCM'
  then
    raise exception 'EXAM_ROOM_STUDENT_CODE_ENVELOPE_INVALID';
  end if;

  v_response := public.exam_room_issue_student_access_v3(
    p_beadle_user_id,
    p_exam_public_id,
    p_student_key_hash,
    p_request_key
  );
  v_issuance_id := nullif(v_response ->> 'issuanceId', '')::uuid;
  if v_issuance_id is null then
    raise exception 'EXAM_ROOM_STUDENT_CODE_ENVELOPE_INVALID';
  end if;

  update public.exam_room_student_access_issuances issuance
  set code_ciphertext = p_code_ciphertext,
      code_nonce = p_code_nonce,
      code_key_id = p_code_key_id,
      code_algorithm = p_code_algorithm,
      code_encrypted_at = clock_timestamp()
  from public.exam_room_credentials credential
  where issuance.id = v_issuance_id
    and issuance.credential_id = credential.id
    and issuance.status = 'active'
    and credential.status = 'active'
    and credential.credential_type = 'student_exam'
    and credential.token_hash = p_student_key_hash
  returning issuance.* into v_issuance;

  if not found then
    raise exception 'EXAM_ROOM_STUDENT_ACCESS_SUPERSEDED';
  end if;

  -- Retired class codes have no operational recovery purpose. Destroy their
  -- encrypted envelopes as soon as a replacement becomes active.
  update public.exam_room_student_access_issuances
  set code_ciphertext = null,
      code_nonce = null,
      code_key_id = null,
      code_algorithm = null,
      code_encrypted_at = null
  where exam_id = v_issuance.exam_id
    and id <> v_issuance.id
    and status <> 'active';

  return v_response || jsonb_build_object(
    'studentCodeRecoverable', true,
    'studentCodeKeyId', p_code_key_id
  );
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception 'EXAM_ROOM_STUDENT_CODE_ENVELOPE_INVALID';
end;
$$;

-- The encrypted envelope is returned only to the Worker and only for the
-- currently assigned Beadle. The Worker removes it before forming the browser
-- response. Owners retain their existing portal view but do not receive the
-- Beadle's class-code envelope through this function.
create or replace function public.exam_room_beadle_portal_v4(
  p_user_id uuid,
  p_exam_public_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base jsonb;
  v_exam public.exam_room_exams%rowtype;
  v_envelope jsonb;
begin
  v_base := public.exam_room_beadle_portal_v3(p_user_id, p_exam_public_id);
  if p_exam_public_id is null then
    return v_base;
  end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  if public.exam_room_has_active_beadle_assignment_v2(p_user_id, v_exam.id) then
    select jsonb_build_object(
      'examId', v_exam.public_id,
      'tokenHash', credential.token_hash,
      'ciphertext', issuance.code_ciphertext,
      'nonce', issuance.code_nonce,
      'keyId', issuance.code_key_id,
      'algorithm', issuance.code_algorithm,
      'encryptedAt', issuance.code_encrypted_at
    ) into v_envelope
    from public.exam_room_student_access_issuances issuance
    join public.exam_room_credentials credential
      on credential.id = issuance.credential_id
    where issuance.exam_id = v_exam.id
      and issuance.status = 'active'
      and issuance.code_ciphertext is not null
      and credential.status = 'active'
      and credential.credential_type = 'student_exam'
      and credential.expires_at > clock_timestamp()
    order by issuance.issued_at desc
    limit 1;
  end if;

  return v_base || jsonb_build_object(
    'studentCodeRecoverable', v_envelope is not null,
    'activeStudentCodeEnvelope', v_envelope
  );
end;
$$;

-- Safe waiting-room read. It may update only the bounded credential failure
-- window and failure audit on a bad code; it never inserts or updates an
-- attempt, answer, session, or question record.
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

  -- A caller who is outside the class list, whose email row is already bound
  -- to another account, or whose examination is not yet published gets only
  -- the denial needed to correct entry. Do not disclose draft schedule,
  -- instructions, rules, access readiness, or any roster identity.
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

  if v_attempt.id is not null
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
  elsif v_exam.status in ('grading', 'sealed') then
    v_blocker := 'EXAM_CLOSED';
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

-- Start is still a separate mutation. It immediately re-runs V4 preflight,
-- then delegates to the established start function, which locks the exam and
-- revalidates the live credential before creating the attempt.
create or replace function public.exam_room_start_attempt_v4(
  p_student_user_id uuid,
  p_exam_public_id uuid,
  p_student_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_preflight jsonb;
begin
  v_preflight := public.exam_room_student_waiting_room_v4(
    p_student_user_id,
    p_exam_public_id,
    p_student_key_hash,
    p_rate_key_hash,
    null
  );
  if not coalesce((v_preflight ->> 'canStart')::boolean, false) then
    return jsonb_build_object(
      'ok', false,
      'code', v_preflight ->> 'startBlockerCode',
      'serverNow', v_preflight -> 'serverNow',
      'opensAt', v_preflight -> 'opensAt',
      'entryClosesAt', v_preflight -> 'entryClosesAt',
      'studentAccessReady', v_preflight -> 'studentAccessReady',
      'accessCodeAccepted', v_preflight -> 'accessCodeAccepted'
    );
  end if;
  return public.exam_room_start_attempt(
    p_student_user_id,
    p_exam_public_id,
    p_student_key_hash,
    p_rate_key_hash
  );
end;
$$;

revoke all on function public.exam_room_check_student_credential_preopen_v4(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_check_student_credential_preopen_v4(
  uuid, uuid, text, text
) to service_role;

revoke all on function public.exam_room_issue_student_access_v4(
  uuid, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_issue_student_access_v4(
  uuid, uuid, text, text, text, text, text, text
) to service_role;

revoke all on function public.exam_room_beadle_portal_v4(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.exam_room_beadle_portal_v4(uuid, uuid)
  to service_role;

revoke all on function public.exam_room_student_waiting_room_v4(
  uuid, uuid, text, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_student_waiting_room_v4(
  uuid, uuid, text, text, text
) to service_role;

revoke all on function public.exam_room_start_attempt_v4(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.exam_room_start_attempt_v4(
  uuid, uuid, text, text
) to service_role;

commit;
