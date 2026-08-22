-- Enrich the existing private Analytics record contract with measurements that
-- already exist in approved user-owned records. This does not change grading.

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
          coalesce(a.completed_at, a.submitted_at),
          a.status,
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
          coalesce(a.submitted_at, a.started_at),
          a.status,
          scores.rubric_version,
          responses.word_count,
          null::jsonb
        from public.examination_attempts_multi a
        join public.examination_versions v on v.id = a.version_id
        join public.examination_definitions d on d.id = v.exam_id
        left join lateral (
          select
            round(avg(x.score), 1) as average_score,
            max(x.assessment_json->>'rubricVersion') as rubric_version
          from public.examination_ai_assessments x
          where x.attempt_id = a.id
        ) scores on true
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

revoke all on function public.dd2026_verdict_records(uuid, boolean, integer, integer)
  from public, anon, authenticated;
grant execute on function public.dd2026_verdict_records(uuid, boolean, integer, integer)
  to service_role;

commit;
