-- Professor-owned class-results dashboard and audited spreadsheet exports.
--
-- This is additive. It does not alter the grading rubric, question content,
-- submission snapshots, release rules, or student-facing authorization.
-- Only the owning Professor may request the dataset; browser roles never
-- receive direct table access.

begin;

create table if not exists public.exam_room_class_result_exports (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  professor_user_id uuid not null references auth.users(id) on delete restrict,
  export_scope text not null check (export_scope in ('offline_grading', 'class_results')),
  selected_attempt_ids uuid[] not null check (
    cardinality(selected_attempt_ids) between 1 and 500
  ),
  selected_count integer not null check (selected_count between 1 and 500),
  includes_questions boolean not null default true,
  includes_submitted_answers boolean not null default true,
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  output_bytes integer check (output_bytes is null or output_bytes between 1 and 26214400),
  output_sha256 text check (output_sha256 is null or output_sha256 ~ '^[0-9a-f]{64}$'),
  unique (professor_user_id, request_key),
  constraint exam_room_class_result_export_completion_check check (
    (completed_at is null and output_bytes is null and output_sha256 is null)
    or (completed_at is not null and output_bytes is not null and output_sha256 is not null)
  )
);

create index if not exists exam_room_class_result_exports_exam_idx
  on public.exam_room_class_result_exports (exam_id, requested_at desc);

alter table public.exam_room_class_result_exports enable row level security;
alter table public.exam_room_class_result_exports force row level security;
revoke all on table public.exam_room_class_result_exports from public, anon, authenticated;
revoke all on table public.exam_room_class_result_exports from service_role;
grant select, insert, update on table public.exam_room_class_result_exports to service_role;

create or replace function public.exam_room_professor_results_dashboard_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_candidates jsonb;
  v_class_statuses jsonb;
  v_release public.exam_room_releases%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for share;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select * into v_release
  from public.exam_room_releases release
  where release.exam_id = v_exam.id;

  select coalesce(jsonb_agg(candidate_data order by student_name, candidate_number), '[]'::jsonb)
  into v_candidates
  from (
    select roster.display_name as student_name,
      attempt.candidate_number,
      jsonb_build_object(
        'attemptId', attempt.public_id,
        'candidateNumber', attempt.candidate_number,
        'studentNumber', roster.student_number,
        'studentName', coalesce(roster.display_name, attempt.candidate_number),
        'studentEmail', roster.canonical_email,
        'status', attempt.status,
        'startedAt', attempt.started_at,
        'serverDeadline', attempt.server_deadline,
        'submittedAt', attempt.submitted_at,
        'lateEntry', v_exam.opens_at is not null and attempt.started_at > v_exam.opens_at,
        'lateSubmission', attempt.submitted_at is not null and attempt.submitted_at > attempt.server_deadline,
        'late', (v_exam.opens_at is not null and attempt.started_at > v_exam.opens_at)
          or (attempt.submitted_at is not null and attempt.submitted_at > attempt.server_deadline),
        'submissionGeneration', submission.generation,
        'unansweredCount', (
          select count(*)
          from jsonb_array_elements(submission.answer_snapshot) answer_entry
          where btrim(coalesce(answer_entry ->> 'answerText', '')) = ''
        ),
        'incidentCount', (
          select count(*) from public.exam_room_integrity_events incident
          where incident.attempt_id = attempt.id
        ),
        'allGradesFinal', not exists (
          select 1
          from public.exam_room_questions question
          left join public.exam_room_grades grade
            on grade.attempt_id = attempt.id and grade.question_id = question.id
          where question.question_version_id = attempt.question_version_id
            and (grade.question_id is null or grade.grade_state <> 'final')
        ) and exists (
          select 1 from public.exam_room_questions question
          where question.question_version_id = attempt.question_version_id
        ),
        'totalScore', coalesce((
          select sum(grade.score)
          from public.exam_room_grades grade
          where grade.attempt_id = attempt.id
        ), 0),
        'totalMaximumPoints', coalesce((
          select sum(question.maximum_points)
          from public.exam_room_questions question
          where question.question_version_id = attempt.question_version_id
        ), 0),
        'percentage', case when coalesce((
          select sum(question.maximum_points)
          from public.exam_room_questions question
          where question.question_version_id = attempt.question_version_id
        ), 0) > 0 then round(100 * coalesce((
          select sum(grade.score)
          from public.exam_room_grades grade
          where grade.attempt_id = attempt.id
        ), 0) / (
          select sum(question.maximum_points)
          from public.exam_room_questions question
          where question.question_version_id = attempt.question_version_id
        ), 2) else null end,
        'questions', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'questionId', question.id,
            'ordinal', question.ordinal,
            'prompt', question.prompt_text,
            'answer', coalesce((
              select answer_entry ->> 'answerText'
              from jsonb_array_elements(submission.answer_snapshot) answer_entry
              where answer_entry ->> 'questionId' = question.id::text
              limit 1
            ), ''),
            'maximumPoints', question.maximum_points,
            'score', grade.score,
            'comment', grade.professor_comment,
            'gradeState', grade.grade_state,
            'gradeRevision', coalesce(grade.revision, 0)
          ) order by question.ordinal), '[]'::jsonb)
          from public.exam_room_questions question
          left join public.exam_room_grades grade
            on grade.attempt_id = attempt.id and grade.question_id = question.id
          where question.question_version_id = attempt.question_version_id
        )
      ) candidate_data
    from public.exam_room_attempts attempt
    join public.exam_room_roster roster on roster.id = attempt.roster_id
    join lateral (
      select submitted.*
      from public.exam_room_submissions submitted
      where submitted.attempt_id = attempt.id
      order by submitted.generation desc
      limit 1
    ) submission on true
    where attempt.exam_id = v_exam.id
      and attempt.status in ('submitted', 'auto_submitted', 'sealed')
  ) candidate_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'candidateNumber', roster.candidate_number,
    'studentNumber', roster.student_number,
    'studentName', coalesce(roster.display_name, roster.candidate_number),
    'studentEmail', roster.canonical_email,
    'status', coalesce(attempt.status, admission.status, 'not_started'),
    'displayStatus', case
      when attempt.status in ('submitted', 'auto_submitted', 'sealed') then 'Submitted'
      when attempt.status = 'in_progress' then 'Active'
      when attempt.status = 'locked' then 'Active - review required'
      when admission.status = 'no_show' then 'Absent'
      when attempt.id is null and (
        v_exam.status in ('closed', 'grading', 'sealed')
        or (v_exam.hard_closes_at is not null and clock_timestamp() >= v_exam.hard_closes_at)
      ) then 'Absent'
      else 'Not started'
    end,
    'startedAt', attempt.started_at,
    'serverDeadline', attempt.server_deadline,
    'submittedAt', attempt.submitted_at,
    'lateEntry', coalesce(v_exam.opens_at is not null and attempt.started_at > v_exam.opens_at, false),
    'lateSubmission', coalesce(attempt.submitted_at > attempt.server_deadline, false),
    'late', coalesce(
      (v_exam.opens_at is not null and attempt.started_at > v_exam.opens_at)
      or (attempt.submitted_at > attempt.server_deadline), false
    ),
    'active', attempt.status in ('in_progress', 'locked'),
    'absent', admission.status = 'no_show' or (
      attempt.id is null and (
        v_exam.status in ('closed', 'grading', 'sealed')
        or (v_exam.hard_closes_at is not null and clock_timestamp() >= v_exam.hard_closes_at)
      )
    ),
    'accommodated', exists (
      select 1 from public.exam_room_accommodations accommodation
      where accommodation.exam_id = v_exam.id
        and accommodation.roster_id = roster.id
        and accommodation.status = 'active'
    )
  ) order by coalesce(roster.display_name, roster.candidate_number), roster.candidate_number), '[]'::jsonb)
  into v_class_statuses
  from public.exam_room_roster roster
  left join public.exam_room_attempts attempt
    on attempt.exam_id = v_exam.id and attempt.roster_id = roster.id
  left join public.exam_room_admissions admission
    on admission.exam_id = v_exam.id and admission.roster_id = roster.id
  where roster.classroom_id = v_exam.classroom_id
    and roster.status = 'active';

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'status', v_exam.status,
    'opensAt', v_exam.opens_at,
    'hardClosesAt', v_exam.hard_closes_at,
    'questionCount', v_exam.requested_question_count,
    'expectedCount', jsonb_array_length(v_class_statuses),
    'submittedCount', jsonb_array_length(v_candidates),
    'released', v_release.id is not null,
    'releasedAt', v_release.released_at,
    'generatedAt', clock_timestamp(),
    'answersIncluded', true,
    'classStatuses', v_class_statuses,
    'candidates', v_candidates
  );
end;
$$;

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

  if p_selected_attempt_public_ids is null or cardinality(p_selected_attempt_public_ids) = 0 then
    select array_agg((candidate ->> 'attemptId')::uuid order by candidate ->> 'attemptId')
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

  if v_selected is null or cardinality(v_selected) = 0 then
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
      selected_count, request_key
    ) values (
      v_exam.id, p_professor_user_id, p_export_scope, v_selected,
      cardinality(v_selected), p_request_key
    ) returning * into v_export;
    perform public.exam_room_append_audit_v2(
      p_professor_user_id, v_exam.id, null, 'class_result_export', v_export.id,
      'class_result_export_requested', p_request_key,
      jsonb_build_object(
        'scope', p_export_scope,
        'selection_count', cardinality(v_selected),
        'includes_questions', true,
        'includes_submitted_answers', true
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
      'classStatuses', (
        select coalesce(jsonb_agg(class_status order by (class_status ->> 'studentName')), '[]'::jsonb)
        from jsonb_array_elements(v_dashboard -> 'classStatuses') class_status
        where exists (
          select 1
          from jsonb_array_elements(v_candidates) selected_candidate
          where selected_candidate ->> 'candidateNumber' = class_status ->> 'candidateNumber'
        )
      ),
      'selectedCount', cardinality(v_selected),
      'exportScope', p_export_scope
    )
  );
end;
$$;

create or replace function public.exam_room_complete_class_result_export_v1(
  p_professor_user_id uuid,
  p_export_id uuid,
  p_output_bytes integer,
  p_output_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export public.exam_room_class_result_exports%rowtype;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_output_bytes not between 1 and 26214400
    or p_output_sha256 !~ '^[0-9a-f]{64}$'
  then raise exception 'EXAM_ROOM_CLASS_EXPORT_OUTPUT_INVALID'; end if;

  select export_row.* into v_export
  from public.exam_room_class_result_exports export_row
  join public.exam_room_exams exam on exam.id = export_row.exam_id
  where export_row.id = p_export_id
    and export_row.professor_user_id = p_professor_user_id
    and exam.owner_professor_id = p_professor_user_id
  for update of export_row;
  if not found then raise exception 'EXAM_ROOM_CLASS_EXPORT_NOT_FOUND'; end if;

  if v_export.completed_at is not null then
    if v_export.output_bytes <> p_output_bytes or v_export.output_sha256 <> p_output_sha256 then
      raise exception 'EXAM_ROOM_CLASS_EXPORT_IDEMPOTENCY_CONFLICT';
    end if;
    return jsonb_build_object('ok', true, 'exportId', v_export.id, 'completedAt', v_export.completed_at);
  end if;

  update public.exam_room_class_result_exports
  set completed_at = clock_timestamp(), output_bytes = p_output_bytes,
      output_sha256 = p_output_sha256
  where id = v_export.id
  returning * into v_export;

  perform public.exam_room_append_audit_v2(
    p_professor_user_id, v_export.exam_id, null, 'class_result_export', v_export.id,
    'class_result_export_completed', v_export.request_key,
    jsonb_build_object(
      'scope', v_export.export_scope,
      'selection_count', v_export.selected_count,
      'output_bytes', p_output_bytes,
      'output_sha256', p_output_sha256
    )
  );
  return jsonb_build_object('ok', true, 'exportId', v_export.id, 'completedAt', v_export.completed_at);
end;
$$;

revoke all on function public.exam_room_professor_results_dashboard_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_prepare_class_result_export_v1(uuid, uuid, uuid[], text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_complete_class_result_export_v1(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.exam_room_professor_results_dashboard_v1(uuid, uuid)
  to service_role;
grant execute on function public.exam_room_prepare_class_result_export_v1(uuid, uuid, uuid[], text, text)
  to service_role;
grant execute on function public.exam_room_complete_class_result_export_v1(uuid, uuid, integer, text)
  to service_role;

comment on table public.exam_room_class_result_exports is
  'Audits owner-Professor class-result and offline-grading workbook generation without storing workbook content.';
comment on function public.exam_room_professor_results_dashboard_v1(uuid, uuid) is
  'Returns final submitted answers, roster identity, grades, and timing only to the owning Professor through the trusted Worker.';

-- The existing release function remains intentionally untouched. Result-email
-- question numbers are derived in the Worker by joining queued questions and
-- grades on questionId.

commit;
