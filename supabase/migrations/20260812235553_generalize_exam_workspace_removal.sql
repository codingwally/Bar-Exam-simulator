-- Generalize the existing per-user Examination Room dismissal so an
-- authorized participant may remove an examination from their own workspace
-- at any lifecycle stage. Canonical examination records are never deleted.

begin;

comment on table public.exam_room_user_exam_dismissals is
  'Per-user workspace visibility preferences. Rows never delete or alter canonical examinations, attempts, answers, grades, receipts, exports, or audit history.';

create or replace function public.exam_room_dismiss_past_exam_v1(
  p_user_id uuid,
  p_exam_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_user_email text;
  v_scope text;
  v_dismissed_at timestamptz;
begin
  if p_request_key is null
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID';
  end if;

  select lower(u.email) into v_user_email
  from auth.users u
  where u.id = p_user_id;
  if v_user_email is null then
    raise exception 'EXAM_ROOM_AUTH_REQUIRED';
  end if;

  select e.* into v_exam
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id;
  if not found then
    raise exception 'EXAM_ROOM_EXAM_NOT_FOUND';
  end if;

  if v_exam.owner_professor_id = p_user_id then
    v_scope := 'professor';
  elsif exists (
    select 1
    from public.exam_room_beadle_assignments b
    where b.exam_id = v_exam.id
      and b.beadle_user_id = p_user_id
      and b.status = 'active'
  ) then
    v_scope := 'beadle';
  elsif exists (
    select 1
    from public.exam_room_attempts a
    where a.exam_id = v_exam.id
      and a.student_user_id = p_user_id
  ) or exists (
    select 1
    from public.exam_room_roster r
    where r.classroom_id = v_exam.classroom_id
      and r.status = 'active'
      and (r.student_user_id = p_user_id or r.canonical_email = v_user_email)
  ) then
    v_scope := 'student';
  else
    raise exception 'EXAM_ROOM_EXAM_ACCESS_REQUIRED';
  end if;

  insert into public.exam_room_user_exam_dismissals (
    user_id,
    exam_id,
    dismissed_as,
    request_key
  ) values (
    p_user_id,
    v_exam.id,
    v_scope,
    p_request_key
  )
  on conflict (user_id, exam_id) do nothing;

  select d.dismissed_at into v_dismissed_at
  from public.exam_room_user_exam_dismissals d
  where d.user_id = p_user_id
    and d.exam_id = v_exam.id;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'removedFromWorkspace', true,
    'removedFromPastExams', true,
    'scope', v_scope,
    'removedAt', v_dismissed_at
  );
end;
$$;

revoke all on function public.exam_room_dismiss_past_exam_v1(uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_dismiss_past_exam_v1(uuid, uuid, text)
  to service_role;

-- A Professor's live room reuses the account-and-exam grading membership
-- after the one-time grading key has been verified. Active answer text is
-- deliberately excluded; only roster status and integrity-event counts leave
-- the database through this function.
create or replace function public.exam_room_live_status_v2(
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
  from public.exam_room_exams e
  where e.public_id = p_exam_public_id
    and e.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam.id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then
    return v_access;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', roster.candidate_number,
    'studentName', coalesce(roster.display_name, roster.candidate_number),
    'studentNumber', roster.student_number,
    'attemptId', attempt.public_id,
    'state', coalesce(attempt.status, 'not_started'),
    'startedAt', attempt.started_at,
    'serverDeadline', attempt.server_deadline,
    'submittedAt', attempt.submitted_at,
    'lastHeartbeatAt', attempt.last_heartbeat_at,
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
      select 1
      from public.exam_room_credentials credential
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

revoke all on function public.exam_room_live_status_v2(uuid, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_live_status_v2(uuid, uuid, text, text)
  to service_role;

-- Final Professor actions honor the same server-saved grading membership as
-- the live room and grading workspace. The original functions remain the
-- authoritative transactional implementations; these narrow wrappers only
-- establish remembered access before delegating to them.
create or replace function public.exam_room_release_results_v2(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_request_key text,
  p_include_questionnaire boolean,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_access jsonb;
  v_active_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select exam.id into v_exam_id
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam_id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select credential.token_hash into v_active_hash
  from public.exam_room_credentials credential
  where credential.exam_id = v_exam_id
    and credential.credential_type = 'professor_grading'
    and credential.status = 'active'
    and credential.expires_at > clock_timestamp()
  order by credential.created_at desc
  limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_NOT_ACTIVE'); end if;

  return public.exam_room_release_results(
    p_professor_user_id,
    p_exam_public_id,
    p_request_key,
    p_include_questionnaire,
    v_active_hash,
    coalesce(p_rate_key_hash, repeat('0', 64))
  );
end;
$$;

revoke all on function public.exam_room_release_results_v2(uuid, uuid, text, boolean, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_release_results_v2(uuid, uuid, text, boolean, text, text)
  to service_role;

create or replace function public.exam_room_prepare_result_export_v4(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_export_scope text,
  p_request_key text,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam_id uuid;
  v_access jsonb;
  v_active_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select exam.id into v_exam_id
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_access := public.exam_room_verify_grading_access_v3(
    p_professor_user_id, v_exam_id, p_grading_key_hash, p_rate_key_hash
  );
  if not coalesce((v_access ->> 'ok')::boolean, false) then return v_access; end if;

  select credential.token_hash into v_active_hash
  from public.exam_room_credentials credential
  where credential.exam_id = v_exam_id
    and credential.credential_type = 'professor_grading'
    and credential.status = 'active'
    and credential.expires_at > clock_timestamp()
  order by credential.created_at desc
  limit 1;
  if not found then return jsonb_build_object('ok', false, 'code', 'CREDENTIAL_NOT_ACTIVE'); end if;

  return public.exam_room_prepare_result_export_v3(
    p_professor_user_id,
    p_exam_public_id,
    p_attempt_public_id,
    p_export_scope,
    p_request_key,
    v_active_hash,
    coalesce(p_rate_key_hash, repeat('0', 64))
  );
end;
$$;

revoke all on function public.exam_room_prepare_result_export_v4(uuid, uuid, uuid, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_prepare_result_export_v4(uuid, uuid, uuid, text, text, text, text)
  to service_role;

-- Allow a roster/status workbook before the first submission. Final-results
-- exports still require at least one fully graded attempt. This is a narrow
-- relaxation of the audit row shape, not a change to submissions or grades.
alter table public.exam_room_class_result_exports
  drop constraint if exists exam_room_class_result_exports_selected_attempt_ids_check;
alter table public.exam_room_class_result_exports
  add constraint exam_room_class_result_exports_selected_attempt_ids_check check (
    cardinality(selected_attempt_ids) between 0 and 500
    and (export_scope = 'offline_grading' or cardinality(selected_attempt_ids) >= 1)
  );
alter table public.exam_room_class_result_exports
  drop constraint if exists exam_room_class_result_exports_selected_count_check;
alter table public.exam_room_class_result_exports
  add constraint exam_room_class_result_exports_selected_count_check check (
    selected_count between 0 and 500
    and (export_scope = 'offline_grading' or selected_count >= 1)
  );

create or replace function public.exam_room_prepare_class_result_export_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_selected_attempt_public_ids uuid[],
  p_export_scope text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_dashboard jsonb;
  v_candidates jsonb;
  v_class_statuses jsonb;
  v_questions jsonb;
  v_selected uuid[];
  v_export public.exam_room_class_result_exports%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_export_scope not in ('offline_grading', 'class_results')
    or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then raise exception 'EXAM_ROOM_CLASS_EXPORT_INVALID'; end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for share;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  v_dashboard := public.exam_room_professor_results_dashboard_v1(
    p_professor_user_id, p_exam_public_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'questionId', question.id,
    'ordinal', question.ordinal,
    'prompt', question.prompt_text,
    'maximumPoints', question.maximum_points
  ) order by question.ordinal), '[]'::jsonb)
  into v_questions
  from public.exam_room_questions question
  where question.question_version_id = v_exam.active_question_version_id;

  if p_selected_attempt_public_ids is null or cardinality(p_selected_attempt_public_ids) = 0 then
    select coalesce(array_agg((candidate ->> 'attemptId')::uuid order by candidate ->> 'attemptId'), '{}'::uuid[])
    into v_selected
    from jsonb_array_elements(v_dashboard -> 'candidates') candidate;
  else
    if cardinality(p_selected_attempt_public_ids) > 500
      or cardinality(p_selected_attempt_public_ids) <> (
        select count(distinct selected_id)
        from unnest(p_selected_attempt_public_ids) as selected(selected_id)
      )
    then raise exception 'EXAM_ROOM_CLASS_EXPORT_SELECTION_INVALID'; end if;
    select array_agg(selected_id order by selected_id)
    into v_selected
    from unnest(p_selected_attempt_public_ids) as selected(selected_id);
  end if;

  if cardinality(v_selected) = 0 and p_export_scope <> 'offline_grading' then
    raise exception 'EXAM_ROOM_CLASS_EXPORT_EMPTY';
  end if;

  select coalesce(jsonb_agg(candidate order by (candidate ->> 'studentName')), '[]'::jsonb)
  into v_candidates
  from jsonb_array_elements(v_dashboard -> 'candidates') candidate
  where (candidate ->> 'attemptId')::uuid = any(v_selected);

  if jsonb_array_length(v_candidates) <> cardinality(v_selected) then
    raise exception 'EXAM_ROOM_CLASS_EXPORT_SELECTION_INVALID';
  end if;
  if p_export_scope = 'class_results' and exists (
    select 1 from jsonb_array_elements(v_candidates) candidate
    where coalesce((candidate ->> 'allGradesFinal')::boolean, false) is not true
  ) then
    raise exception 'EXAM_ROOM_CLASS_EXPORT_GRADES_NOT_FINAL';
  end if;

  -- The overview and attendance sheets always cover the complete class list,
  -- even when the Professor selects only some submitted answers for detailed
  -- offline grading. Candidate answers remain limited to v_selected.
  v_class_statuses := coalesce(v_dashboard -> 'classStatuses', '[]'::jsonb);

  select * into v_export
  from public.exam_room_class_result_exports export
  where export.professor_user_id = p_professor_user_id
    and export.request_key = p_request_key;
  if found then
    if v_export.exam_id <> v_exam.id
      or v_export.export_scope <> p_export_scope
      or v_export.selected_attempt_ids <> v_selected
    then raise exception 'EXAM_ROOM_CLASS_EXPORT_IDEMPOTENCY_CONFLICT'; end if;
  else
    insert into public.exam_room_class_result_exports (
      exam_id, professor_user_id, export_scope, selected_attempt_ids,
      selected_count, includes_submitted_answers, request_key
    ) values (
      v_exam.id, p_professor_user_id, p_export_scope, v_selected,
      cardinality(v_selected), cardinality(v_selected) > 0, p_request_key
    ) returning * into v_export;
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, null, 'class_result_export', v_export.id,
      'class_result_export_requested', p_request_key,
      jsonb_build_object(
        'scope', p_export_scope,
        'selection_count', cardinality(v_selected),
        'includes_questions', true,
        'includes_submitted_answers', cardinality(v_selected) > 0
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'exportId', v_export.id,
    'scope', p_export_scope,
    'dataset', v_dashboard || jsonb_build_object(
      'generatedAt', v_export.requested_at,
      'candidates', v_candidates,
      'classStatuses', v_class_statuses,
      'questions', v_questions,
      'durationMinutes', v_exam.duration_minutes,
      'selectedCount', cardinality(v_selected),
      'exportScope', p_export_scope
    )
  );
end;
$$;

revoke all on function public.exam_room_prepare_class_result_export_v1(uuid, uuid, uuid[], text, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_prepare_class_result_export_v1(uuid, uuid, uuid[], text, text)
  to service_role;

commit;
