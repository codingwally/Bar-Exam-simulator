-- Examination Room renovation: Professor-visible authenticated access and
-- reversible session controls. This migration is intentionally confined to
-- the exam_room_* namespace. It does not alter simulator, question-bank,
-- subscription, payment, or general authentication data.

begin;

create table if not exists public.exam_room_candidate_access_controls (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete cascade,
  roster_id uuid not null references public.exam_room_roster(id) on delete restrict,
  status text not null default 'allowed' check (status in ('allowed', 'blocked')),
  prior_admission_status text check (
    prior_admission_status is null
    or prior_admission_status in ('eligible', 'admitted', 'denied', 'withdrawn', 'no_show')
  ),
  blocked_by uuid references auth.users(id) on delete set null,
  blocked_at timestamptz,
  block_reason text check (
    block_reason is null or char_length(btrim(block_reason)) between 5 and 1000
  ),
  last_kicked_by uuid references auth.users(id) on delete set null,
  last_kicked_at timestamptz,
  last_kick_reason text check (
    last_kick_reason is null or char_length(btrim(last_kick_reason)) between 5 and 1000
  ),
  kick_count integer not null default 0 check (kick_count between 0 and 10000),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (exam_id, roster_id),
  constraint exam_room_candidate_access_block_shape check (
    (status = 'allowed' and blocked_by is null and blocked_at is null and block_reason is null)
    or
    -- Keep the block durable if the Professor account is later deleted and the
    -- blocked_by foreign key is cleared by ON DELETE SET NULL.
    (status = 'blocked' and blocked_at is not null and block_reason is not null)
  )
);

create index if not exists exam_room_candidate_access_status_idx
  on public.exam_room_candidate_access_controls (exam_id, status, updated_at desc);

alter table public.exam_room_candidate_access_controls enable row level security;
alter table public.exam_room_candidate_access_controls force row level security;
revoke all privileges on table public.exam_room_candidate_access_controls
  from public, anon, authenticated;
grant select, insert, update on table public.exam_room_candidate_access_controls
  to service_role;

create or replace function public.exam_room_control_candidate_access_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_candidate_number text,
  p_action text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_roster public.exam_room_roster%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_control public.exam_room_candidate_access_controls%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_prior_admission_status text;
  v_sessions_closed integer := 0;
  v_event_type text;
  v_request jsonb;
  v_response jsonb;
begin
  if p_action not in ('kick', 'block', 'unblock') then
    raise exception 'EXAM_ROOM_ACCESS_ACTION_INVALID';
  end if;
  if char_length(btrim(coalesce(p_candidate_number, ''))) not between 1 and 120 then
    raise exception 'EXAM_ROOM_CANDIDATE_NUMBER_INVALID';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'EXAM_ROOM_REASON_REQUIRED';
  end if;

  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'candidateNumber', btrim(p_candidate_number),
    'action', p_action,
    'reason', btrim(p_reason)
  );
  v_response := public.exam_room_command_begin_v2(
    p_professor_user_id,
    'control_candidate_access_v1',
    p_request_key,
    v_request
  );
  if v_response is not null then return v_response; end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select * into v_roster
  from public.exam_room_roster roster
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active'
    and lower(roster.candidate_number) = lower(btrim(p_candidate_number))
  for update;
  if not found then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;

  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.exam_id = v_exam.id
    and attempt.roster_id = v_roster.id
  for update;

  if p_action = 'kick' and v_attempt.id is null then
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'ATTEMPT_NOT_STARTED',
      'examId', v_exam.public_id,
      'candidateNumber', v_roster.candidate_number,
      'action', p_action,
      'sessionsClosed', 0
    );
    return public.exam_room_command_complete_v2(
      p_professor_user_id,
      'control_candidate_access_v1',
      p_request_key,
      v_request,
      v_response
    );
  end if;

  select * into v_control
  from public.exam_room_candidate_access_controls control
  where control.exam_id = v_exam.id and control.roster_id = v_roster.id
  for update;

  if p_action = 'kick' and v_control.status = 'blocked' then
    v_response := jsonb_build_object(
      'ok', false,
      'code', 'EXAM_ROOM_ACCESS_BLOCKED',
      'examId', v_exam.public_id,
      'candidateNumber', v_roster.candidate_number,
      'action', p_action,
      'sessionsClosed', 0
    );
    return public.exam_room_command_complete_v2(
      p_professor_user_id,
      'control_candidate_access_v1',
      p_request_key,
      v_request,
      v_response
    );
  end if;

  if p_action = 'block' then
    select admission.status into v_prior_admission_status
    from public.exam_room_admissions admission
    where admission.exam_id = v_exam.id and admission.roster_id = v_roster.id;
    v_prior_admission_status := coalesce(v_prior_admission_status, 'eligible');

    insert into public.exam_room_candidate_access_controls (
      exam_id, roster_id, status, prior_admission_status,
      blocked_by, blocked_at, block_reason, updated_at
    ) values (
      v_exam.id, v_roster.id, 'blocked', v_prior_admission_status,
      p_professor_user_id, clock_timestamp(), btrim(p_reason), clock_timestamp()
    )
    on conflict (exam_id, roster_id) do update
    set status = 'blocked',
        prior_admission_status = case
          when public.exam_room_candidate_access_controls.status = 'blocked'
            then public.exam_room_candidate_access_controls.prior_admission_status
          else excluded.prior_admission_status
        end,
        blocked_by = excluded.blocked_by,
        blocked_at = excluded.blocked_at,
        block_reason = excluded.block_reason,
        updated_at = excluded.updated_at
    returning * into v_control;

    insert into public.exam_room_admissions (
      exam_id, roster_id, status, decided_by, decision_reason, decided_at, updated_at
    ) values (
      v_exam.id, v_roster.id, 'denied', p_professor_user_id,
      btrim(p_reason), clock_timestamp(), clock_timestamp()
    )
    on conflict (exam_id, roster_id) do update
    set status = 'denied',
        decided_by = excluded.decided_by,
        decision_reason = excluded.decision_reason,
        decided_at = excluded.decided_at,
        updated_at = excluded.updated_at;
    v_event_type := 'candidate_access_blocked';
  elsif p_action = 'unblock' then
    if v_control.id is not null and v_control.status = 'blocked' then
      v_prior_admission_status := case
        when v_control.prior_admission_status in (
          'eligible', 'admitted', 'denied', 'withdrawn', 'no_show'
        ) then v_control.prior_admission_status
        else 'eligible'
      end;
      update public.exam_room_candidate_access_controls
      set status = 'allowed',
          prior_admission_status = null,
          blocked_by = null,
          blocked_at = null,
          block_reason = null,
          updated_at = clock_timestamp()
      where id = v_control.id
      returning * into v_control;

      update public.exam_room_admissions
      set status = v_prior_admission_status,
          decided_by = p_professor_user_id,
          decision_reason = btrim(p_reason),
          decided_at = clock_timestamp(),
          updated_at = clock_timestamp()
      where exam_id = v_exam.id and roster_id = v_roster.id;
    end if;
    v_event_type := 'candidate_access_unblocked';
  else
    insert into public.exam_room_candidate_access_controls (
      exam_id, roster_id, status, last_kicked_by, last_kicked_at,
      last_kick_reason, kick_count, updated_at
    ) values (
      v_exam.id, v_roster.id, 'allowed', p_professor_user_id,
      clock_timestamp(), btrim(p_reason), 1, clock_timestamp()
    )
    on conflict (exam_id, roster_id) do update
    set last_kicked_by = excluded.last_kicked_by,
        last_kicked_at = excluded.last_kicked_at,
        last_kick_reason = excluded.last_kick_reason,
        kick_count = public.exam_room_candidate_access_controls.kick_count + 1,
        updated_at = excluded.updated_at
    returning * into v_control;
    v_event_type := 'candidate_session_kicked';
  end if;

  if p_action in ('kick', 'block') and v_attempt.id is not null then
    for v_session in
      select * from public.exam_room_sessions session
      where session.attempt_id = v_attempt.id and session.status = 'active'
      for update
    loop
      update public.exam_room_sessions
      set status = 'closed',
          ended_at = clock_timestamp(),
          ended_by = p_professor_user_id,
          end_reason = left(
            case
              when p_action = 'block' then 'Professor blocked examination access: ' || btrim(p_reason)
              else 'Professor ended this live session: ' || btrim(p_reason)
            end,
            1000
          )
      where id = v_session.id;

      insert into public.exam_room_session_events (
        session_id, attempt_id, actor_user_id, event_type, epoch, metadata
      ) values (
        v_session.id, v_attempt.id, p_professor_user_id, 'closed', v_session.epoch,
        jsonb_build_object('reasonCode', 'professor_' || p_action)
      );
      v_sessions_closed := v_sessions_closed + 1;
    end loop;
  end if;

  perform public.exam_room_append_audit_v2(
    p_professor_user_id,
    v_exam.id,
    v_attempt.id,
    'candidate_access_control',
    v_control.id,
    v_event_type,
    p_request_key,
    jsonb_build_object(
      'candidateNumber', v_roster.candidate_number,
      'action', p_action,
      'sessionsClosed', v_sessions_closed
    )
  );

  v_response := jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'candidateNumber', v_roster.candidate_number,
    'action', p_action,
    'accessStatus', case when p_action = 'block' then 'blocked' else 'allowed' end,
    'sessionsClosed', v_sessions_closed,
    'blockedAt', case when p_action = 'block' then v_control.blocked_at else null end,
    'lastKickedAt', v_control.last_kicked_at,
    'changedAt', clock_timestamp()
  );
  return public.exam_room_command_complete_v2(
    p_professor_user_id,
    'control_candidate_access_v1',
    p_request_key,
    v_request,
    v_response
  );
end;
$$;

revoke all on function public.exam_room_control_candidate_access_v1(uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_control_candidate_access_v1(uuid, uuid, text, text, text, text)
  to service_role;

-- Keep the established session implementation intact and add the block guard
-- as a narrow wrapper. Existing sessions are closed by the Professor action;
-- this guard prevents a blocked account from immediately opening a new one.
create or replace function public.exam_room_open_session_v4(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_device_instance_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
begin
  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;

  if exists (
    select 1
    from public.exam_room_candidate_access_controls control
    where control.exam_id = v_attempt.exam_id
      and control.roster_id = v_attempt.roster_id
      and control.status = 'blocked'
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'EXAM_ROOM_ACCESS_BLOCKED',
      'attemptId', p_attempt_public_id,
      'recovery', 'Contact your Professor before attempting to enter this examination again.'
    );
  end if;

  return public.exam_room_open_session_v3(
    p_student_user_id,
    p_attempt_public_id,
    p_device_instance_hash,
    p_request_key
  );
end;
$$;

revoke all on function public.exam_room_open_session_v4(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_open_session_v4(uuid, uuid, text, text)
  to service_role;

-- Professor-only live roster. Active answer text remains excluded. The email
-- address is the authenticated account attached to the attempt, with the
-- roster address shown separately for a visible identity check.
create or replace function public.exam_room_live_status_v3(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_access jsonb;
  v_candidates jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', roster.candidate_number,
    'studentName', coalesce(roster.display_name, roster.candidate_number),
    'studentNumber', roster.student_number,
    'rosterEmail', roster.canonical_email,
    'accessEmail', case when attempt.id is not null then lower(account.email) else null end,
    'attemptId', attempt.public_id,
    'state', coalesce(attempt.status, 'not_started'),
    'startedAt', attempt.started_at,
    'serverDeadline', attempt.server_deadline,
    'submittedAt', attempt.submitted_at,
    'lastHeartbeatAt', attempt.last_heartbeat_at,
    'activeSessionCount', coalesce(session_summary.active_count, 0),
    'lastSessionSeenAt', session_summary.last_seen_at,
    'accessStatus', coalesce(control.status, 'allowed'),
    'blockedAt', control.blocked_at,
    'lastKickedAt', control.last_kicked_at,
    'kickCount', coalesce(control.kick_count, 0),
    'canKick', attempt.status in ('in_progress', 'locked')
      and coalesce(session_summary.active_count, 0) > 0
      and coalesce(control.status, 'allowed') = 'allowed',
    'canBlock', attempt.id is not null and coalesce(control.status, 'allowed') = 'allowed',
    'canUnblock', control.status = 'blocked',
    'incidentCount', coalesce((
      select count(*) from public.exam_room_integrity_events incident
      where incident.attempt_id = attempt.id
    ), 0),
    'focusExitCount', coalesce((
      select count(*) from public.exam_room_integrity_events incident
      where incident.attempt_id = attempt.id
        and incident.event_type in ('visibility_exit', 'focus_exit', 'fullscreen_exit')
    ), 0),
    'clipboardAttemptCount', coalesce((
      select count(*) from public.exam_room_integrity_events incident
      where incident.attempt_id = attempt.id
        and incident.event_type in ('copy_attempt', 'paste_attempt', 'context_menu_attempt')
    ), 0),
    'lastIncidentAt', (
      select max(incident.occurred_at) from public.exam_room_integrity_events incident
      where incident.attempt_id = attempt.id
    ),
    'generation', latest_submission.generation,
    'latestReceiptId', latest_receipt.public_id,
    'priorReceiptId', prior_receipt.public_id,
    'activeReopeningId', active_reopening.public_id,
    'canReopenSubmission', attempt.status in ('submitted', 'auto_submitted')
      and v_exam.status not in ('grading', 'sealed')
      and v_exam.release_id is null
      and latest_submission.id is not null
      and latest_receipt.id is not null
      and active_reopening.id is null
      and attempt.server_deadline < clock_timestamp() + interval '4 hours',
    'reopenBlockedReason', case
      when attempt.id is null then 'ATTEMPT_NOT_STARTED'
      when attempt.status = 'sealed' or v_exam.status = 'sealed' or v_exam.release_id is not null then 'RESULTS_SEALED'
      when v_exam.status = 'grading' then 'GRADING_STARTED'
      when attempt.status not in ('submitted', 'auto_submitted') then 'ATTEMPT_NOT_SUBMITTED'
      when latest_submission.id is null or latest_receipt.id is null then 'RECEIPT_REQUIRED'
      when active_reopening.id is not null then 'REOPENING_ALREADY_ACTIVE'
      when attempt.server_deadline >= clock_timestamp() + interval '4 hours' then 'ORIGINAL_DEADLINE_TOO_FAR'
      else null
    end
  ) order by coalesce(roster.display_name, roster.candidate_number), roster.candidate_number), '[]'::jsonb)
  into v_candidates
  from public.exam_room_roster roster
  left join public.exam_room_attempts attempt
    on attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
  left join auth.users account on account.id = attempt.student_user_id
  left join public.exam_room_candidate_access_controls control
    on control.exam_id = v_exam.id and control.roster_id = roster.id
  left join lateral (
    select count(*) filter (where session.status = 'active')::integer as active_count,
           max(session.last_seen_at) as last_seen_at
    from public.exam_room_sessions session
    where session.attempt_id = attempt.id
  ) session_summary on true
  left join lateral (
    select submission.*
    from public.exam_room_submissions submission
    where submission.attempt_id = attempt.id
    order by submission.generation desc limit 1
  ) latest_submission on true
  left join public.exam_room_submission_receipts latest_receipt
    on latest_receipt.submission_id = latest_submission.id
  left join public.exam_room_submissions prior_submission
    on prior_submission.id = latest_submission.prior_submission_id
  left join public.exam_room_submission_receipts prior_receipt
    on prior_receipt.submission_id = prior_submission.id
  left join lateral (
    select reopening.*
    from public.exam_room_submission_reopenings reopening
    where reopening.attempt_id = attempt.id
      and reopening.expires_at > clock_timestamp()
      and not exists (
        select 1 from public.exam_room_submissions completed
        where completed.reopening_id = reopening.id
      )
    order by reopening.opened_at desc limit 1
  ) active_reopening on true
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active';

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'status', v_exam.status,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'serverNow', clock_timestamp(),
    'rosterReady', jsonb_array_length(v_candidates) > 0,
    'studentAccessReady', exists (
      select 1 from public.exam_room_credentials credential
      where credential.exam_id = v_exam.id
        and credential.credential_type = 'student_exam'
        and credential.status = 'active'
        and credential.expires_at > clock_timestamp()
    ),
    'reopenMaximumMinutes', 240,
    'accessCodeRequired', coalesce((
      select (publication.rules_snapshot ->> 'studentAccessCodeRequired')::boolean
      from public.exam_room_publications publication
      where publication.id = v_exam.current_publication_id
    ), true),
    'candidates', v_candidates
  );
end;
$$;

revoke all on function public.exam_room_live_status_v3(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_live_status_v3(uuid, uuid, text, text)
  to service_role;

commit;
