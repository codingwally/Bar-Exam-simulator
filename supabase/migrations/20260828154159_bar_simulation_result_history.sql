-- Keep a learner's Bar Simulation history independent from the much higher
-- volume Syllabus-Based Review history. The Worker authorizes the requested
-- track before calling this owner-scoped reader.

begin;

create or replace function public.examination_history_by_track_v1(
  p_user_id uuid,
  p_track text,
  p_limit integer,
  p_offset integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_track text := nullif(btrim(coalesce(p_track, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 10000);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
begin
  if p_user_id is null
    or v_track is null
    or v_track not in ('per_subject', 'bar_feels')
  then
    raise exception 'EXAM_QUERY_INVALID';
  end if;

  select count(*)
  into v_total
  from public.examination_attempts_multi a
  join public.examination_versions v on v.id = a.version_id
  join public.examination_definitions d on d.id = v.exam_id
  where a.user_id = p_user_id
    and d.track = v_track;

  select coalesce(
    jsonb_agg(history.item order by history.started_at desc, history.attempt_id desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      a.id as attempt_id,
      a.started_at,
      jsonb_build_object(
        'attemptId', a.id,
        'publicId', a.public_id,
        'title', d.title,
        'subject', d.subject,
        'track', d.track,
        'assessmentKind', d.assessment_kind,
        'testOnly', d.test_only,
        'status', a.status,
        'timerMode', a.timer_mode,
        'startedAt', a.started_at,
        'submittedAt', a.submitted_at,
        'elapsedSeconds', a.elapsed_seconds,
        'questionCount', v.question_count,
        'answeredCount', (
          select count(*)
          from public.examination_responses r
          where r.attempt_id = a.id
            and nullif(btrim(r.answer_text), '') is not null
        ),
        'aiAssessmentCount', (
          select count(*)
          from public.examination_ai_assessments assessment
          where assessment.attempt_id = a.id
        ),
        'humanFinalized', exists (
          select 1
          from public.examination_examiner_assignments assignment
          where assignment.attempt_id = a.id
            and assignment.status = 'finalized'
        ),
        'modelsReleased', exists (
          select 1
          from public.examination_model_releases model_release
          where model_release.attempt_id = a.id
        )
      ) as item
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    where a.user_id = p_user_id
      and d.track = v_track
    order by a.started_at desc, a.id desc
    limit v_limit offset v_offset
  ) history;

  return jsonb_build_object(
    'track', v_track,
    'limit', v_limit,
    'offset', v_offset,
    'total', v_total,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total,
    'items', v_items
  );
end;
$$;

revoke all on function public.examination_history_by_track_v1(uuid, text, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.examination_history_by_track_v1(uuid, text, integer, integer)
  to service_role;

comment on function public.examination_history_by_track_v1(uuid, text, integer, integer)
  is 'Worker-only owner-scoped examination history filtered by an explicitly authorized track.';

notify pgrst, 'reload schema';

commit;
