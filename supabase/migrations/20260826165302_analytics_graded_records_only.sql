-- Analytics is a record of completed grading, not an attempt-lifecycle queue.
-- Filter eligibility before pagination and harden direct PDF lookup against
-- unanswered or partially graded records.

begin;

create or replace function public.dd2026_verdict_records(
  p_user_id uuid,
  p_include_deleted boolean default false,
  p_limit integer default 200,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 200), 1), 500);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
begin
  perform public.dd2026_require_user(p_user_id);

  return jsonb_build_object(
    'items', coalesce((
      with records as (
        select
          g.id as source_id,
          'legacy_grading_result'::text as source_type,
          'Mock Bar'::text as feature,
          subj.name::text as subject,
          q.id::text as question_id,
          q.question_no::text as question_number,
          q.bar_year,
          g.overall_score::numeric as score,
          s.time_spent_seconds::integer as elapsed_seconds,
          null::text as timer_mode,
          g.graded_at as occurred_at,
          'completed'::text as status,
          true as grading_complete,
          g.rubric_version::text as rubric_version,
          s.word_count::integer as word_count,
          case
            when g.answer_score is null
             and g.legal_basis_score is null
             and g.application_score is null
             and g.conclusion_score is null then null::jsonb
            else jsonb_strip_nulls(jsonb_build_object(
              'responsiveness', g.answer_score,
              'legalBasis', g.legal_basis_score,
              'application', g.application_score,
              'conclusion', g.conclusion_score
            ))
          end as rubric_breakdown
        from public.grading_results g
        join public.submissions s on s.id = g.submission_id
        join public.questions q on q.id = s.question_id
        join public.subjects subj on subj.id = q.subject_id
        where s.user_id = p_user_id
          and g.overall_score is not null

        union all

        select
          a.id,
          'phase4_exam_attempt',
          'Mock Bar',
          a.subject,
          a.question_bank_id,
          null::text,
          null::integer,
          a.score,
          a.elapsed_seconds,
          a.timer_mode,
          a.completed_at,
          a.status,
          true,
          a.assessment->>'rubricVersion',
          case
            when length(btrim(a.answer_text)) = 0 then 0
            else cardinality(regexp_split_to_array(btrim(a.answer_text), E'\\s+'))
          end::integer,
          case
            when jsonb_typeof(a.assessment->'rubricBreakdown') = 'object'
              then a.assessment->'rubricBreakdown'
            else null::jsonb
          end
        from public.exam_attempts a
        where a.user_id = p_user_id
          and a.status = 'completed'
          and a.score is not null

        union all

        select
          a.id,
          'examination_attempt',
          case d.track when 'per_subject' then 'Subject Matter' else 'Bar Feels' end,
          coalesce(d.subject, d.title),
          null::text,
          null::text,
          null::integer,
          scores.average_score,
          a.elapsed_seconds,
          a.timer_mode,
          a.submitted_at,
          a.status,
          true,
          scores.rubric_version,
          responses.word_count,
          null::jsonb
        from public.examination_attempts_multi a
        join public.examination_versions v on v.id = a.version_id
        join public.examination_definitions d on d.id = v.exam_id
        join public.examination_grading_jobs grading_job
          on grading_job.attempt_id = a.id
         and grading_job.route = 'ai'
         and grading_job.status = 'completed'
        join lateral (
          select
            round(avg(x.score), 1) as average_score,
            max(x.assessment_json->>'rubricVersion') as rubric_version,
            count(*)::integer as assessment_count
          from public.examination_ai_assessments x
          where x.attempt_id = a.id
        ) scores on scores.assessment_count = v.question_count
                and scores.average_score is not null
        left join lateral (
          select coalesce(sum(
            case
              when length(btrim(r.answer_text)) = 0 then 0
              else cardinality(regexp_split_to_array(btrim(r.answer_text), E'\\s+'))
            end
          ), 0)::integer as word_count
          from public.examination_responses r
          where r.attempt_id = a.id
        ) responses on true
        where a.user_id = p_user_id
          and a.status in ('submitted', 'expired')
      ), visible as (
        select
          r.*,
          ar.deleted_at,
          ar.restore_until
        from records r
        left join public.verdict_archived_records ar
          on ar.user_id = p_user_id
         and ar.source_type = r.source_type
         and ar.source_id = r.source_id
        where p_include_deleted = (ar.id is not null)
           or (not p_include_deleted and ar.id is null)
      )
      select jsonb_agg(jsonb_build_object(
        'id', source_id,
        'sourceType', source_type,
        'feature', feature,
        'subject', subject,
        'questionId', question_id,
        'questionNumber', question_number,
        'barYear', bar_year,
        'score', score,
        'elapsedSeconds', elapsed_seconds,
        'timerMode', timer_mode,
        'occurredAt', occurred_at,
        'status', status,
        'gradingComplete', grading_complete,
        'rubricVersion', rubric_version,
        'wordCount', word_count,
        'rubricBreakdown', rubric_breakdown,
        'deletedAt', deleted_at,
        'restoreUntil', restore_until
      ) order by occurred_at desc, source_id desc)
      from (
        select * from visible
        order by occurred_at desc, source_id desc
        limit v_limit offset v_offset
      ) page
    ), '[]'::jsonb),
    'includeDeleted', p_include_deleted,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

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
  select enabled into v_enabled from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_ENABLED';
  select enabled into v_premium_required from public.dd2026_feature_flags
  where flag_key = 'VERDICT_PDF_PREMIUM_REQUIRED';
  if not coalesce(v_enabled, false) then raise exception 'DD2026_VERDICT_PDF_DISABLED'; end if;
  if coalesce(v_premium_required, false) and not public.dd2026_is_premium(p_user_id) then
    raise exception 'DD2026_PREMIUM_REQUIRED';
  end if;
  if exists (
    select 1 from public.verdict_archived_records
    where user_id = p_user_id and source_id = p_grading_result_id
  ) then raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND'; end if;

  select jsonb_build_object(
    'resultId', g.id, 'sourceType', 'legacy_grading_result',
    'submissionId', s.id, 'questionId', q.id, 'subject', subj.name,
    'barYear', q.bar_year, 'questionNumber', q.question_no,
    'question', q.prompt_text, 'suggestedAnswer', q.model_answer,
    'legalBasis', q.case_law, 'userAnswer', s.answer_text,
    'feedback', coalesce(g.feedback_json, '{}'::jsonb),
    'score', g.overall_score, 'passed', g.passed,
    'gradedAt', g.graded_at, 'rubricVersion', g.rubric_version
  ) into v_result
  from public.grading_results g
  join public.submissions s on s.id = g.submission_id
  join public.questions q on q.id = s.question_id
  join public.subjects subj on subj.id = q.subject_id
  where g.id = p_grading_result_id
    and s.user_id = p_user_id
    and g.overall_score is not null;

  if v_result is null then
    select jsonb_build_object(
      'resultId', a.id, 'sourceType', 'phase4_exam_attempt',
      'questionBankId', a.question_bank_id, 'questionId', a.question_bank_id,
      'subject', a.subject, 'question', null, 'suggestedAnswer', null,
      'userAnswer', a.answer_text, 'feedback', coalesce(a.assessment, '{}'::jsonb),
      'score', a.score, 'passed', null, 'gradedAt', a.completed_at,
      'rubricVersion', a.assessment->>'rubricVersion'
    ) into v_result
    from public.exam_attempts a
    where a.id = p_grading_result_id
      and a.user_id = p_user_id
      and a.status = 'completed'
      and a.score is not null;
  end if;

  if v_result is null then
    select jsonb_build_object(
      'resultId', a.id,
      'sourceType', 'examination_attempt',
      'feature', case d.track when 'per_subject' then 'Subject Matter' else 'Bar Feels' end,
      'subject', coalesce(d.subject, d.title),
      'title', d.title,
      'userAnswer', null,
      'score', summary.average_score,
      'gradedAt', a.submitted_at,
      'rubricVersion', summary.rubric_version,
      'questions', coalesce(summary.questions, '[]'::jsonb)
    ) into v_result
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    join public.examination_grading_jobs grading_job
      on grading_job.attempt_id = a.id
     and grading_job.route = 'ai'
     and grading_job.status = 'completed'
    join lateral (
      select
        round(avg(ai.score), 1) as average_score,
        max(ai.assessment_json->>'rubricVersion') as rubric_version,
        count(ai.id)::integer as assessment_count,
        jsonb_agg(jsonb_build_object(
          'questionId', vq.question_id,
          'questionNumber', vq.ordinal,
          'question', vq.prompt_snapshot,
          'suggestedAnswer', vq.model_answer_snapshot,
          'legalBasis', vq.legal_basis_snapshot,
          'application', vq.application_snapshot,
          'conclusion', vq.conclusion_snapshot,
          'sources', vq.source_urls_snapshot,
          'userAnswer', coalesce(r.answer_text, ''),
          'score', ai.score,
          'feedback', coalesce(ai.assessment_json, '{}'::jsonb)
        ) order by vq.ordinal) as questions
      from public.examination_version_questions vq
      left join public.examination_responses r
        on r.attempt_id = a.id and r.question_id = vq.question_id
      left join public.examination_ai_assessments ai
        on ai.attempt_id = a.id and ai.question_id = vq.question_id
      where vq.version_id = a.version_id
    ) summary on summary.assessment_count = v.question_count
             and summary.average_score is not null
    where a.id = p_grading_result_id
      and a.user_id = p_user_id
      and a.status in ('submitted', 'expired');
  end if;

  if v_result is null then raise exception 'DD2026_VERDICT_RESULT_NOT_FOUND'; end if;
  return v_result;
end;
$$;

revoke all on function public.dd2026_verdict_records(uuid, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_verdict_records(uuid, boolean, integer, integer)
  to service_role;

revoke all on function public.dd2026_verdict_result(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.dd2026_verdict_result(uuid, uuid)
  to service_role;

commit;
