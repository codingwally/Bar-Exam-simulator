-- Fix partial draft grade saves in Examination Room.
--
-- The v1 grading manifest intentionally carries maxPoints for the entire
-- immutable submitted examination, even when a draft grading revision contains
-- only the questions graded so far. The original persistence validator
-- mistakenly recalculated maximum_score from only the score entries in the
-- current draft revision, causing valid partial saves to fail with
-- GRADING_MANIFEST_INVALID.
--
-- This patch changes only the save_grade validation block. Final result release
-- keeps its stricter requirement that every question be scored.

do $patch$
declare
  function_def text;
  save_start integer;
  release_start integer;
  save_segment text;
  old_fragment text := $old$
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0),
      coalesce(sum(q.points), 0)
    into question_count, distinct_score_count, total_score, maximum_score
    from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> 'questionNumber')::integer
     and q.question_key = score.value ->> 'questionKey'
     and q.points = (score.value ->> 'maxPoints')::numeric
    where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;
$old$;
  new_fragment text := $new$
    select
      count(*)::integer,
      count(distinct q.id)::integer,
      coalesce(sum((score.value ->> 'pointsAwarded')::numeric), 0)
    into question_count, distinct_score_count, total_score
    from jsonb_array_elements(coalesce(grading_manifest -> 'scores', '[]'::jsonb)) score(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (score.value ->> 'questionNumber')::integer
     and q.question_key = score.value ->> 'questionKey'
     and q.points = (score.value ->> 'maxPoints')::numeric
    where (score.value ->> 'pointsAwarded')::numeric between 0 and q.points;

    -- Draft grading revisions may contain only the questions graded so far.
    -- The grading manifest's maxPoints is intentionally bound to the immutable
    -- maximum for the whole submitted examination, not the graded subset.
    select coalesce(sum(q.points), 0)
    into maximum_score
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id;
$new$;
begin
  select pg_get_functiondef(p.oid)
  into function_def
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'examination_room_v1'
    and p.proname = 'api_professor'
    and p.prokind = 'f'
  limit 1;

  if function_def is null then
    raise exception 'Examination Room api_professor function was not found';
  end if;

  save_start := strpos(function_def, 'if p_operation = ''save_grade'' then');
  release_start := strpos(function_def, 'if p_operation = ''release_results'' then');

  if save_start = 0 or release_start = 0 or release_start <= save_start then
    raise exception 'Could not isolate Examination Room save_grade block';
  end if;

  save_segment := substring(function_def from save_start for release_start - save_start);

  if strpos(save_segment, old_fragment) = 0 then
    -- Be idempotent when applying to an environment that already has the fix.
    if strpos(save_segment, 'Draft grading revisions may contain only the questions graded so far.') > 0 then
      return;
    end if;
    raise exception 'Expected save_grade grading-total validation block was not found; refusing an unsafe patch';
  end if;

  save_segment := replace(save_segment, old_fragment, new_fragment);
  function_def :=
    substring(function_def from 1 for save_start - 1)
    || save_segment
    || substring(function_def from release_start);

  execute function_def;
end
$patch$;
