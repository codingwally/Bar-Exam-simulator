-- DueDiligence 2026: bridge Verdict PDF exports to the current Phase 4 exam-attempt store.
-- The legacy grading_results path remains supported for existing records.

begin;

alter table public.dd2026_verdict_pdf_exports
  drop constraint if exists dd2026_verdict_pdf_exports_grading_result_id_fkey;

alter table public.dd2026_verdict_pdf_exports
  drop constraint if exists dd2026_verdict_pdf_exports_exam_attempt_id_fkey;

alter table public.dd2026_verdict_pdf_exports
  alter column grading_result_id drop not null,
  add column if not exists exam_attempt_id uuid;

alter table public.dd2026_verdict_pdf_exports
  add constraint dd2026_verdict_pdf_exports_grading_result_id_fkey
    foreign key (grading_result_id) references public.grading_results(id) on delete restrict,
  add constraint dd2026_verdict_pdf_exports_exam_attempt_id_fkey
    foreign key (exam_attempt_id) references public.exam_attempts(id) on delete restrict;

alter table public.dd2026_verdict_pdf_exports
  drop constraint if exists dd2026_verdict_pdf_exports_exactly_one_result_check;

alter table public.dd2026_verdict_pdf_exports
  add constraint dd2026_verdict_pdf_exports_exactly_one_result_check
  check (num_nonnulls(grading_result_id, exam_attempt_id) = 1);

create index if not exists dd2026_verdict_pdf_exports_attempt_idx
  on public.dd2026_verdict_pdf_exports (exam_attempt_id)
  where exam_attempt_id is not null;

create or replace function public.dd2026_verdict_result(
  p_user_id uuid,
  p_grading_result_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_enabled boolean;
  v_premium_required boolean;
  v_result jsonb;
begin
  perform public.dd2026_require_user(p_user_id);
  select enabled into v_enabled
  from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_ENABLED';
  select enabled into v_premium_required
  from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_PREMIUM_REQUIRED';

  if not coalesce(v_enabled, false) then
    raise exception 'DD2026_VERDICT_PDF_DISABLED';
  end if;
  if coalesce(v_premium_required, false) and not public.dd2026_is_premium(p_user_id) then
    raise exception 'DD2026_PREMIUM_REQUIRED';
  end if;

  select jsonb_build_object(
    'resultId', g.id,
    'sourceType', 'legacy_grading_result',
    'submissionId', s.id,
    'questionId', q.id,
    'subject', subj.name,
    'barYear', q.bar_year,
    'questionNumber', q.question_no,
    'question', q.prompt_text,
    'suggestedAnswer', q.model_answer,
    'userAnswer', s.answer_text,
    'feedback', coalesce(g.feedback_json, '{}'::jsonb),
    'score', g.overall_score,
    'passed', g.passed,
    'gradedAt', g.graded_at,
    'rubricVersion', g.rubric_version
  ) into v_result
  from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  join public.questions q on q.id = s.question_id
  join public.subjects subj on subj.id = q.subject_id
  where g.id = p_grading_result_id
    and s.user_id = p_user_id;

  if v_result is null then
    select jsonb_build_object(
      'resultId', a.id,
      'sourceType', 'phase4_exam_attempt',
      'questionBankId', a.question_bank_id,
      'questionId', a.question_bank_id,
      'subject', a.subject,
      'question', null,
      'suggestedAnswer', null,
      'userAnswer', a.answer_text,
      'feedback', coalesce(a.assessment, '{}'::jsonb),
      'score', a.score,
      'passed', null,
      'gradedAt', a.completed_at,
      'rubricVersion', a.assessment ->> 'rubricVersion'
    ) into v_result
    from public.exam_attempts a
    where a.id = p_grading_result_id
      and a.user_id = p_user_id
      and a.status = 'completed';
  end if;

  if v_result is null then
    raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND';
  end if;
  return v_result;
end;
$$;

create or replace function public.dd2026_record_verdict_export(
  p_user_id uuid,
  p_grading_result_id uuid,
  p_request_key text,
  p_selection_kind text,
  p_selected_ids jsonb,
  p_output_bytes integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.dd2026_verdict_pdf_exports%rowtype;
  v_legacy_id uuid;
  v_attempt_id uuid;
begin
  perform public.dd2026_verdict_result(p_user_id, p_grading_result_id);
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
    or p_selection_kind not in ('entire_result', 'sections', 'questions')
    or jsonb_typeof(p_selected_ids) <> 'array'
    or p_output_bytes not between 1 and 26214400
  then
    raise exception 'DD2026_VERDICT_EXPORT_INVALID';
  end if;

  select g.id into v_legacy_id
  from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  where g.id = p_grading_result_id and s.user_id = p_user_id;

  if v_legacy_id is null then
    select a.id into v_attempt_id
    from public.exam_attempts a
    where a.id = p_grading_result_id
      and a.user_id = p_user_id
      and a.status = 'completed';
  end if;

  insert into public.dd2026_verdict_pdf_exports (
    user_id, grading_result_id, exam_attempt_id, request_key,
    selection_kind, selected_ids, output_bytes
  ) values (
    p_user_id, v_legacy_id, v_attempt_id, p_request_key,
    p_selection_kind, p_selected_ids, p_output_bytes
  )
  on conflict (user_id, request_key) do update
  set output_bytes = excluded.output_bytes
  returning * into v_row;

  return jsonb_build_object('exportId', v_row.id, 'createdAt', v_row.created_at);
end;
$$;

revoke all on function public.dd2026_verdict_result(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_verdict_result(uuid, uuid) to service_role;
grant execute on function public.dd2026_record_verdict_export(uuid, uuid, text, text, jsonb, integer)
  to service_role;

commit;
