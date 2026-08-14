-- Subject Matter assisted/open-book review state and owner-bound review reveal.
--
-- This migration is additive. It does not alter the examination grading rubric,
-- score calculation, immutable question snapshots, or answer submission flow.

begin;

alter table public.examination_attempts_multi
  add column if not exists review_material_revealed_at timestamptz;

alter table public.examination_attempts_multi
  add column if not exists review_material_revealed_before_submission boolean;

alter table public.examination_attempts_multi
  alter column review_material_revealed_before_submission set default false;

-- Staging may have received an earlier reviewed draft of this migration. Preserve
-- the classification of those exact rows when the final migration is reapplied.
update public.examination_attempts_multi
set review_material_revealed_before_submission = case
  when submitted_at is null then true
  when review_material_revealed_at <= submitted_at then true
  else false
end
where review_material_revealed_before_submission is null
  and review_material_revealed_at is not null;

comment on column public.examination_attempts_multi.review_material_revealed_at is
  'First successful reveal of Subject Matter review material, whether before or after submission.';

comment on column public.examination_attempts_multi.review_material_revealed_before_submission is
  'True only when review material was first revealed before submission; false for newly tracked unassisted attempts and null for legacy attempts whose prior assistance state cannot be proven.';

create or replace function public.subject_matter_reveal_review(
  p_user_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.examination_attempts_multi%rowtype;
  v_track text;
  v_assessment_kind text;
  v_question_count integer;
  v_question_id uuid;
  v_prompt text;
  v_suggested_answer text;
  v_legal_basis text;
  v_governing_provision text;
  v_doctrine text;
  v_jurisprudence jsonb;
  v_citation text;
  v_raw_sources jsonb;
  v_sources jsonb;
begin
  perform public.examination_authorize_access(
    p_user_id,
    'per_subject',
    null,
    p_attempt_id,
    true
  );

  select attempt.*
  into v_attempt
  from public.examination_attempts_multi attempt
  where attempt.id = p_attempt_id
    and attempt.user_id = p_user_id
  for update of attempt;

  select definition.track, definition.assessment_kind
  into v_track, v_assessment_kind
  from public.examination_versions version
  join public.examination_definitions definition on definition.id = version.exam_id
  where version.id = v_attempt.version_id;

  if v_attempt.id is null
     or v_track <> 'per_subject'
     or v_assessment_kind <> 'quiz'
     or v_attempt.status not in ('in_progress', 'review', 'submitted', 'expired')
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select count(*)
  into v_question_count
  from public.examination_version_questions version_question
  where version_question.version_id = v_attempt.version_id;

  if v_question_count <> 1 then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select
    version_question.question_id,
    nullif(btrim(version_question.prompt_snapshot), ''),
    nullif(btrim(version_question.model_answer_snapshot), ''),
    nullif(btrim(version_question.legal_basis_snapshot), ''),
    nullif(btrim(version_question.governing_provision_snapshot), ''),
    nullif(btrim(question.doctrine), ''),
    version_question.jurisprudence_snapshot,
    nullif(btrim(version_question.citation_snapshot), ''),
    version_question.source_urls_snapshot
  into
    v_question_id,
    v_prompt,
    v_suggested_answer,
    v_legal_basis,
    v_governing_provision,
    v_doctrine,
    v_jurisprudence,
    v_citation,
    v_raw_sources
  from public.examination_version_questions version_question
  join public.examination_questions question
    on question.id = version_question.question_id
   and question.content_hash = version_question.snapshot_hash
  where version_question.version_id = v_attempt.version_id
    and question.publication_ready is true
    and lower(question.review_status) in ('approved', 'owner_override');

  if v_question_id is null
     or v_prompt is null
     or v_suggested_answer is null
     or char_length(v_suggested_answer) < 20
     or v_legal_basis is null
     or v_doctrine is null
     or jsonb_typeof(v_jurisprudence) <> 'array'
     or jsonb_typeof(v_raw_sources) <> 'array'
     or jsonb_array_length(v_raw_sources) < 1
     or jsonb_array_length(v_raw_sources) > 12
     or exists (
       select 1
       from jsonb_array_elements(v_raw_sources) as source(entry)
       cross join lateral (
         select case jsonb_typeof(source.entry)
           when 'string' then btrim(source.entry #>> '{}')
           when 'object' then btrim(source.entry->>'url')
           else null
         end as url
       ) normalized
       where normalized.url is null
          or normalized.url !~ '^https://'
          or char_length(normalized.url) > 2048
     )
  then
    raise exception 'EXAM_SUBJECT_REVIEW_MATERIAL_UNAVAILABLE';
  end if;

  select jsonb_agg(normalized.url order by source.ordinality)
  into v_sources
  from jsonb_array_elements(v_raw_sources) with ordinality as source(entry, ordinality)
  cross join lateral (
    select case jsonb_typeof(source.entry)
      when 'string' then btrim(source.entry #>> '{}')
      when 'object' then btrim(source.entry->>'url')
      else null
    end as url
  ) normalized;

  -- Persist the first successful reveal in every lifecycle state. Whether it
  -- occurred before submission is stored separately and never changes later.
  if v_attempt.review_material_revealed_at is null then
    update public.examination_attempts_multi
    set review_material_revealed_at = clock_timestamp(),
        review_material_revealed_before_submission =
          (v_attempt.status in ('in_progress', 'review')),
        updated_at = clock_timestamp()
    where id = v_attempt.id
      and user_id = p_user_id
      and review_material_revealed_at is null
    returning * into v_attempt;
  end if;

  return jsonb_build_object(
    'status', 'available',
    'attemptId', v_attempt.id,
    'questionId', v_question_id,
    'prompt', v_prompt,
    'suggestedAnswer', v_suggested_answer,
    'legalBasis', v_legal_basis,
    'governingProvision', v_governing_provision,
    'doctrine', v_doctrine,
    'jurisprudence', v_jurisprudence,
    'citation', v_citation,
    'sources', v_sources,
    'assisted', v_attempt.review_material_revealed_before_submission is true,
    'assistanceKnown', v_attempt.review_material_revealed_before_submission is not null,
    'reviewMaterialRevealedAt', v_attempt.review_material_revealed_at
  );
end;
$$;

revoke all on function public.subject_matter_reveal_review(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.subject_matter_reveal_review(uuid, uuid)
  to service_role;

create or replace function public.examination_attempt_summary(
  p_attempt public.examination_attempts_multi
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'attemptId', p_attempt.id,
    'publicId', p_attempt.public_id,
    'versionId', p_attempt.version_id,
    'status', p_attempt.status,
    'timerMode', p_attempt.timer_mode,
    'startedAt', p_attempt.started_at,
    'deadlineAt', p_attempt.deadline_at,
    'submittedAt', p_attempt.submitted_at,
    'lastSavedAt', p_attempt.last_activity_at,
    'elapsedSeconds', p_attempt.elapsed_seconds,
    'remainingSeconds', public.examination_attempt_remaining_seconds(p_attempt),
    'tabLeaseUntil', p_attempt.tab_lease_until,
    'assisted', p_attempt.review_material_revealed_before_submission is true,
    'assistanceKnown', p_attempt.review_material_revealed_before_submission is not null,
    'reviewMaterialRevealedAt', p_attempt.review_material_revealed_at,
    'counts', jsonb_build_object(
      'answered', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and nullif(btrim(r.answer_text), '') is not null
      ),
      'flagged', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id and r.flagged
      ),
      'total', (
        select count(*) from public.examination_responses r
        where r.attempt_id = p_attempt.id
      )
    )
  );
$$;

revoke all on function public.examination_attempt_summary(
  public.examination_attempts_multi
) from public, anon, authenticated;
grant execute on function public.examination_attempt_summary(
  public.examination_attempts_multi
) to service_role;

create or replace function public.subject_matter_performance(
  p_user_id uuid,
  p_subject text default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_subject text := nullif(btrim(coalesce(p_subject, '')), '');
  v_limit integer := least(100, greatest(1, coalesce(p_limit, 50)));
begin
  perform public.examination_authorize_access(
    p_user_id, 'per_subject', null, null, true
  );
  return jsonb_build_object(
    'subject', v_subject,
    'attemptedQuestions', (
      select count(distinct a.id)
      from public.examination_attempts_multi a
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and (v_subject is null or d.subject = v_subject)
    ),
    'completedQuestions', (
      select count(*)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and (v_subject is null or d.subject = v_subject)
    ),
    'unassistedCompletedQuestions', (
      select count(*)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and a.review_material_revealed_before_submission is false
        and (v_subject is null or d.subject = v_subject)
    ),
    'assistedCompletedQuestions', (
      select count(*)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and a.review_material_revealed_before_submission is true
        and (v_subject is null or d.subject = v_subject)
    ),
    'unknownAssistanceCompletedQuestions', (
      select count(*)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and a.review_material_revealed_before_submission is null
        and (v_subject is null or d.subject = v_subject)
    ),
    'unassistedAverageScore', (
      select round(avg(ai.score)::numeric, 1)
      from public.examination_submissions s
      join public.examination_attempts_multi a on a.id = s.attempt_id
      join public.examination_versions ev on ev.id = a.version_id
      join public.examination_definitions d on d.id = ev.exam_id
      join public.examination_ai_assessments ai on ai.attempt_id = a.id
      where a.user_id = p_user_id
        and d.track = 'per_subject'
        and a.review_material_revealed_before_submission is false
        and (v_subject is null or d.subject = v_subject)
    ),
    'recentAttempts', coalesce((
      select jsonb_agg(item order by submitted_at desc)
      from (
        select
          s.submitted_at,
          jsonb_build_object(
            'attemptId', a.id,
            'questionId', q.id,
            'subject', d.subject,
            'topic', q.topic,
            'submittedAt', s.submitted_at,
            'score', ai.score,
            'answerText', r.answer_text,
            'assessment', ai.assessment_json,
            'assisted', a.review_material_revealed_before_submission is true,
            'assistanceKnown', a.review_material_revealed_before_submission is not null,
            'reviewMaterialRevealedAt', a.review_material_revealed_at,
            'suggestedAnswer', case
              when mr.attempt_id is not null then vq.model_answer_snapshot
              else null
            end,
            'legalBasis', case
              when mr.attempt_id is not null then vq.legal_basis_snapshot
              else null
            end,
            'sources', case
              when mr.attempt_id is not null then vq.source_urls_snapshot
              else '[]'::jsonb
            end
          ) as item
        from public.examination_submissions s
        join public.examination_attempts_multi a on a.id = s.attempt_id
        join public.examination_versions ev on ev.id = a.version_id
        join public.examination_definitions d on d.id = ev.exam_id
        join public.examination_version_questions vq on vq.version_id = ev.id
        join public.examination_questions q on q.id = vq.question_id
        join public.examination_responses r
          on r.attempt_id = a.id and r.question_id = q.id
        left join public.examination_ai_assessments ai
          on ai.attempt_id = a.id and ai.question_id = q.id
        left join public.examination_model_releases mr on mr.attempt_id = a.id
        where a.user_id = p_user_id
          and d.track = 'per_subject'
          and (v_subject is null or d.subject = v_subject)
        order by s.submitted_at desc
        limit v_limit
      ) recent
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.subject_matter_performance(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.subject_matter_performance(uuid, text, integer)
  to service_role;

commit;
