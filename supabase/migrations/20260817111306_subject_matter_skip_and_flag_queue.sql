-- Subject Matter safe skip lifecycle and persistent flagged-for-later queue.
--
-- A skip closes the current practice attempt without creating a submission or
-- grading job, advances the user's no-repeat cycle to a different question,
-- and keeps any existing response flag available in the private performance
-- record. The trusted Worker remains the only caller of the mutation RPC.

begin;

alter table public.examination_attempts_multi
  add column if not exists subject_matter_skipped_at timestamptz;

alter table public.examination_attempts_multi
  add column if not exists subject_matter_skip_request_key text;

alter table public.examination_attempts_multi
  add column if not exists subject_matter_skip_next_version_id uuid
    references public.examination_versions(id) on delete restrict;

do $migration$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.examination_attempts_multi'::regclass
      and conname = 'examination_attempts_subject_skip_check'
  ) then
    alter table public.examination_attempts_multi
      add constraint examination_attempts_subject_skip_check check (
        (
          subject_matter_skipped_at is null
          and subject_matter_skip_request_key is null
          and subject_matter_skip_next_version_id is null
        )
        or (
          status = 'cancelled'
          and subject_matter_skipped_at is not null
          and subject_matter_skip_request_key is not null
          and subject_matter_skip_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
          and subject_matter_skip_next_version_id is not null
          and submitted_at is null
        )
      );
  end if;
end;
$migration$;

create unique index if not exists examination_attempts_subject_skip_request_idx
  on public.examination_attempts_multi (
    user_id,
    subject_matter_skip_request_key
  )
  where subject_matter_skip_request_key is not null;

create index if not exists examination_attempts_subject_skipped_history_idx
  on public.examination_attempts_multi (user_id, subject_matter_skipped_at desc)
  where subject_matter_skipped_at is not null;

comment on column public.examination_attempts_multi.subject_matter_skipped_at is
  'When this Subject Matter attempt was closed by Skip without submission, grading, or score impact.';

comment on column public.examination_attempts_multi.subject_matter_skip_request_key is
  'Owner-scoped idempotency key for the Subject Matter skip operation.';

comment on column public.examination_attempts_multi.subject_matter_skip_next_version_id is
  'Different published Subject Matter version selected atomically by Skip for safe replay.';

create or replace function public.subject_matter_skip_question(
  p_user_id uuid,
  p_attempt_id uuid,
  p_request_key text,
  p_tab_token text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_attempt public.examination_attempts_multi%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_next_version public.examination_versions%rowtype;
  v_cycle public.subject_matter_cycles%rowtype;
  v_question_id uuid;
  v_question_count integer;
  v_next_version_id uuid;
  v_course_name text;
  v_course_code text;
  v_year_level smallint;
  v_term smallint;
  v_seen_question_ids uuid[];
  v_flagged boolean := false;
  v_tab_hash text;
  v_setup jsonb;
  v_cycle_restarted boolean := false;
  v_cycle_preserved boolean := false;
begin
  if p_user_id is null
     or not exists (
       select 1
       from auth.users authenticated_user
       where authenticated_user.id = p_user_id
         and coalesce(authenticated_user.is_anonymous, false) is false
     )
  then
    raise exception 'EXAM_ACCESS_REQUIRED';
  end if;

  if p_attempt_id is null
     or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
     or char_length(coalesce(p_tab_token, '')) not between 32 and 256
  then
    raise exception 'EXAM_SUBJECT_SKIP_INVALID';
  end if;

  perform public.examination_authorize_access(
    p_user_id,
    'per_subject',
    null,
    p_attempt_id,
    false
  );

  select attempt.*
  into v_attempt
  from public.examination_attempts_multi attempt
  where attempt.id = p_attempt_id
    and attempt.user_id = p_user_id
  for update of attempt;

  if v_attempt.id is null then
    raise exception 'EXAM_ATTEMPT_NOT_FOUND';
  end if;

  -- The original successful result is replayed without advancing the cycle a
  -- second time. A different key cannot repurpose an already closed attempt.
  if v_attempt.subject_matter_skipped_at is not null then
    if v_attempt.subject_matter_skip_request_key <> v_request_key then
      raise exception 'EXAM_ATTEMPT_CLOSED';
    end if;
    if v_attempt.subject_matter_skip_next_version_id is null
       or v_attempt.subject_matter_skip_next_version_id = v_attempt.version_id
    then
      raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
    end if;

    select version.*
    into v_next_version
    from public.examination_versions version
    where version.id = v_attempt.subject_matter_skip_next_version_id
      and version.status = 'published';

    select definition.*
    into v_definition
    from public.examination_definitions definition
    where definition.id = v_next_version.exam_id
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published';

    if v_next_version.id is null or v_definition.id is null then
      raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
    end if;

    v_setup := jsonb_build_object(
      'versionId', v_next_version.id,
      'track', 'per_subject',
      'assessmentKind', 'quiz',
      'title', v_definition.title,
      'subject', v_definition.subject,
      'questionCount', 1,
      'durationSeconds', v_next_version.duration_seconds,
      'timerMode', v_next_version.default_timer_mode,
      'allowedTimerModes', v_next_version.allowed_timer_modes,
      'instructions', v_next_version.instructions,
      'gradingRoute', v_next_version.grading_route,
      'answerReleaseRule', v_next_version.answer_release_rule
    );

    return jsonb_build_object(
      'skipped', true,
      'replayed', true,
      'attemptId', v_attempt.id,
      'skippedAt', v_attempt.subject_matter_skipped_at,
      'flaggedForLater', exists (
        select 1
        from public.examination_responses response
        where response.attempt_id = v_attempt.id
          and response.flagged
      ),
      'setup', v_setup
    );
  end if;

  if v_attempt.status not in ('in_progress', 'review')
     or v_attempt.submitted_at is not null
  then
    raise exception 'EXAM_ATTEMPT_CLOSED';
  end if;

  v_tab_hash := public.examination_tab_hash(p_tab_token);
  if v_attempt.active_tab_hash <> v_tab_hash then
    raise exception 'EXAM_SECOND_TAB_BLOCKED';
  end if;

  select definition.*
  into v_definition
  from public.examination_versions version
  join public.examination_definitions definition on definition.id = version.exam_id
  where version.id = v_attempt.version_id
    and version.status = 'published'
    and definition.status = 'published'
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz';

  if v_definition.id is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  select count(*), (array_agg(version_question.question_id))[1]
  into v_question_count, v_question_id
  from public.examination_version_questions version_question
  where version_question.version_id = v_attempt.version_id;

  if v_question_count <> 1 or v_question_id is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  select
    placement.course_name,
    placement.course_code,
    placement.year_level,
    placement.term
  into
    v_course_name,
    v_course_code,
    v_year_level,
    v_term
  from public.subject_matter_placements placement
  where placement.exam_id = v_definition.id
    and placement.course_name = v_definition.subject
    and placement.question_id = v_question_id;

  if v_course_name is null or v_course_code is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'subject-cycle:' || p_user_id::text || ':' || v_course_name
      || ':' || v_year_level::text || ':' || v_term::text,
    0
  ));

  insert into public.subject_matter_cycles (
    user_id,
    subject,
    year_level,
    term
  ) values (
    p_user_id,
    v_course_name,
    v_year_level,
    v_term
  )
  on conflict (user_id, subject, year_level, term) do nothing;

  select cycle.*
  into v_cycle
  from public.subject_matter_cycles cycle
  where cycle.user_id = p_user_id
    and cycle.subject = v_course_name
    and cycle.year_level = v_year_level
    and cycle.term = v_term
  for update of cycle;

  -- A direct retry from Flagged for later deliberately does not replace the
  -- no-repeat cycle's already-selected active question. Skipping that retry
  -- closes only the retry attempt and returns the preserved active version.
  if v_cycle.active_version_id is not null
     and v_cycle.active_version_id <> v_attempt.version_id
  then
    select version.id
    into v_next_version_id
    from public.examination_versions version
    join public.examination_definitions definition on definition.id = version.exam_id
    join public.subject_matter_placements placement on placement.exam_id = definition.id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
    where version.id = v_cycle.active_version_id
      and version.status = 'published'
      and version.question_count = 1
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and definition.subject = v_course_name
      and placement.course_name = v_course_name
      and placement.course_code = v_course_code
      and placement.year_level = v_year_level
      and placement.term = v_term
      and version_question.question_id <> v_question_id
    limit 1;

    if v_next_version_id is null then
      raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
    end if;
    v_cycle_preserved := true;
  end if;

  if not v_cycle_preserved then
    v_seen_question_ids := case
      when v_question_id = any(v_cycle.seen_question_ids)
        then v_cycle.seen_question_ids
      else array_append(v_cycle.seen_question_ids, v_question_id)
    end;

    select version.id
    into v_next_version_id
    from public.subject_matter_placements placement
    join public.examination_definitions definition on definition.id = placement.exam_id
    join public.examination_versions version on version.id = definition.active_version_id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
    where placement.course_name = v_course_name
      and placement.course_code = v_course_code
      and placement.year_level = v_year_level
      and placement.term = v_term
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and version.status = 'published'
      and version.question_count = 1
      and version.id <> v_attempt.version_id
      and version_question.question_id <> v_question_id
      and not (version_question.question_id = any(v_seen_question_ids))
    order by random()
    limit 1;

    -- Skipping the last unseen item automatically starts another cycle. Keeping
    -- the just-skipped question in the new seen set guarantees that Skip never
    -- returns the same question, even across the cycle boundary.
    if v_next_version_id is null then
      v_cycle_restarted := true;
      v_seen_question_ids := array[v_question_id]::uuid[];

      select version.id
      into v_next_version_id
      from public.subject_matter_placements placement
      join public.examination_definitions definition on definition.id = placement.exam_id
      join public.examination_versions version on version.id = definition.active_version_id
      join public.examination_version_questions version_question
        on version_question.version_id = version.id
      where placement.course_name = v_course_name
        and placement.course_code = v_course_code
        and placement.year_level = v_year_level
        and placement.term = v_term
        and definition.track = 'per_subject'
        and definition.assessment_kind = 'quiz'
        and definition.status = 'published'
        and version.status = 'published'
        and version.question_count = 1
        and version.id <> v_attempt.version_id
        and version_question.question_id <> v_question_id
      order by random()
      limit 1;
    end if;
  end if;

  if v_next_version_id is null or v_next_version_id = v_attempt.version_id then
    raise exception 'EXAM_SUBJECT_NO_ALTERNATE_QUESTION';
  end if;

  select version.*
  into v_next_version
  from public.examination_versions version
  where version.id = v_next_version_id
    and version.status = 'published';

  select definition.*
  into v_definition
  from public.examination_definitions definition
  where definition.id = v_next_version.exam_id
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published';

  if v_next_version.id is null or v_definition.id is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  if not v_cycle_preserved then
    update public.subject_matter_cycles
    set seen_question_ids = v_seen_question_ids,
        active_version_id = v_next_version.id,
        cycle_number = cycle_number + case when v_cycle_restarted then 1 else 0 end,
        started_at = case when v_cycle_restarted then v_now else started_at end,
        updated_at = v_now
    where user_id = p_user_id
      and subject = v_course_name
      and year_level = v_year_level
      and term = v_term;
  end if;

  select response.flagged
  into v_flagged
  from public.examination_responses response
  where response.attempt_id = v_attempt.id
    and response.question_id = v_question_id;

  update public.examination_attempts_multi
  set status = 'cancelled',
      subject_matter_skipped_at = v_now,
      subject_matter_skip_request_key = v_request_key,
      subject_matter_skip_next_version_id = v_next_version.id,
      submission_reason = 'Subject Matter question skipped without submission or score.',
      elapsed_seconds = case
        when timer_mode in ('strict', 'selfPaced')
          then greatest(
            elapsed_seconds,
            floor(extract(epoch from (v_now - started_at)))::integer
          )
        else elapsed_seconds
      end,
      last_activity_at = v_now,
      last_heartbeat_at = v_now,
      tab_lease_until = v_now,
      updated_at = v_now
  where id = v_attempt.id
    and user_id = p_user_id
    and status in ('in_progress', 'review')
    and submitted_at is null
  returning * into v_attempt;

  if v_attempt.subject_matter_skipped_at is null then
    raise exception 'EXAM_ATTEMPT_CLOSED';
  end if;

  insert into public.examination_audit_log (
    actor_user_id,
    action,
    resource_type,
    resource_id,
    reason,
    metadata
  ) values (
    p_user_id,
    'subject_question_skipped',
    'examination_attempt',
    v_attempt.id::text,
    'The student chose Skip; no submission, grading job, or score was created.',
    jsonb_build_object(
      'versionId', v_attempt.version_id,
      'questionId', v_question_id,
      'nextVersionId', v_next_version.id,
      'flaggedForLater', coalesce(v_flagged, false),
      'cycleRestarted', v_cycle_restarted,
      'cyclePreserved', v_cycle_preserved
    )
  );

  v_setup := jsonb_build_object(
    'versionId', v_next_version.id,
    'track', 'per_subject',
    'assessmentKind', 'quiz',
    'title', v_definition.title,
    'subject', v_definition.subject,
    'questionCount', 1,
    'durationSeconds', v_next_version.duration_seconds,
    'timerMode', v_next_version.default_timer_mode,
    'allowedTimerModes', v_next_version.allowed_timer_modes,
    'instructions', v_next_version.instructions,
    'gradingRoute', v_next_version.grading_route,
    'answerReleaseRule', v_next_version.answer_release_rule
  );

  return jsonb_build_object(
    'skipped', true,
    'replayed', false,
    'attemptId', v_attempt.id,
    'skippedAt', v_attempt.subject_matter_skipped_at,
    'flaggedForLater', coalesce(v_flagged, false),
    'cycleRestarted', v_cycle_restarted,
    'cyclePreserved', v_cycle_preserved,
    'setup', v_setup
  );
end;
$$;

revoke all on function public.subject_matter_skip_question(
  uuid, uuid, text, text
) from public, anon, authenticated;
grant execute on function public.subject_matter_skip_question(
  uuid, uuid, text, text
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
      select count(distinct attempt.id)
      from public.examination_attempts_multi attempt
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.subject_matter_skipped_at is null
        and (v_subject is null or definition.subject = v_subject)
    ),
    'skippedQuestions', (
      select count(*)
      from public.examination_attempts_multi attempt
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.status = 'cancelled'
        and attempt.subject_matter_skipped_at is not null
        and (v_subject is null or definition.subject = v_subject)
    ),
    'completedQuestions', (
      select count(*)
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and (v_subject is null or definition.subject = v_subject)
    ),
    'unassistedCompletedQuestions', (
      select count(*)
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.review_material_revealed_before_submission is false
        and (v_subject is null or definition.subject = v_subject)
    ),
    'assistedCompletedQuestions', (
      select count(*)
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.review_material_revealed_before_submission is true
        and (v_subject is null or definition.subject = v_subject)
    ),
    'unknownAssistanceCompletedQuestions', (
      select count(*)
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.review_material_revealed_before_submission is null
        and (v_subject is null or definition.subject = v_subject)
    ),
    'unassistedAverageScore', (
      select round(avg(assessment.score)::numeric, 1)
      from public.examination_submissions submission
      join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
      join public.examination_versions version on version.id = attempt.version_id
      join public.examination_definitions definition on definition.id = version.exam_id
      join public.examination_ai_assessments assessment on assessment.attempt_id = attempt.id
      where attempt.user_id = p_user_id
        and definition.track = 'per_subject'
        and attempt.review_material_revealed_before_submission is false
        and (v_subject is null or definition.subject = v_subject)
    ),
    'flaggedForLater', coalesce((
      select jsonb_agg(flagged.item order by flagged.queued_at desc)
      from (
        select latest.queued_at, latest.item
        from (
          -- Prefer an active resumable attempt when the same version also has
          -- an older skipped flag. Otherwise expose the latest skipped flag as
          -- a new Practice again action until a later submission clears it.
          select distinct on (candidate.version_id)
            candidate.version_id,
            candidate.queued_at,
            candidate.priority,
            candidate.item
          from (
            select
              attempt.version_id,
              coalesce(response.saved_at, attempt.updated_at) as queued_at,
              0 as priority,
              jsonb_build_object(
                'attemptId', attempt.id,
                'versionId', attempt.version_id,
                'questionId', version_question.question_id,
                'subject', definition.subject,
                'topic', question.topic,
                'prompt', version_question.prompt_snapshot,
                'answerText', response.answer_text,
                'status', attempt.status,
                'resumable', true,
                'queuedAt', coalesce(response.saved_at, attempt.updated_at)
              ) as item
            from public.examination_attempts_multi attempt
            join public.examination_versions version on version.id = attempt.version_id
            join public.examination_definitions definition on definition.id = version.exam_id
            join public.examination_version_questions version_question
              on version_question.version_id = version.id
            join public.examination_questions question on question.id = version_question.question_id
            join public.examination_responses response
              on response.attempt_id = attempt.id
             and response.question_id = version_question.question_id
            where attempt.user_id = p_user_id
              and definition.track = 'per_subject'
              and attempt.status in ('in_progress', 'review')
              and attempt.submitted_at is null
              and attempt.subject_matter_skipped_at is null
              and response.flagged
              and (v_subject is null or definition.subject = v_subject)

            union all

            select
              attempt.version_id,
              attempt.subject_matter_skipped_at as queued_at,
              1 as priority,
              jsonb_build_object(
                'attemptId', attempt.id,
                'versionId', attempt.version_id,
                'questionId', version_question.question_id,
                'subject', definition.subject,
                'topic', question.topic,
                'prompt', version_question.prompt_snapshot,
                'answerText', response.answer_text,
                'status', attempt.status,
                'resumable', false,
                'queuedAt', attempt.subject_matter_skipped_at,
                'skippedAt', attempt.subject_matter_skipped_at
              ) as item
            from public.examination_attempts_multi attempt
            join public.examination_versions version on version.id = attempt.version_id
            join public.examination_definitions definition on definition.id = version.exam_id
            join public.examination_version_questions version_question
              on version_question.version_id = version.id
            join public.examination_questions question on question.id = version_question.question_id
            join public.examination_responses response
              on response.attempt_id = attempt.id
             and response.question_id = version_question.question_id
            where attempt.user_id = p_user_id
              and definition.track = 'per_subject'
              and attempt.status = 'cancelled'
              and attempt.subject_matter_skipped_at is not null
              and response.flagged
              and (v_subject is null or definition.subject = v_subject)
              and not exists (
                select 1
                from public.examination_attempts_multi later_attempt
                join public.examination_submissions later_submission
                  on later_submission.attempt_id = later_attempt.id
                where later_attempt.user_id = p_user_id
                  and later_attempt.version_id = attempt.version_id
                  and later_attempt.started_at >= attempt.subject_matter_skipped_at
              )
          ) candidate
          order by candidate.version_id, candidate.priority, candidate.queued_at desc
        ) latest
        order by latest.queued_at desc
        limit v_limit
      ) flagged
    ), '[]'::jsonb),
    'recentAttempts', coalesce((
      select jsonb_agg(recent.item order by recent.submitted_at desc)
      from (
        select
          submission.submitted_at,
          jsonb_build_object(
            'attemptId', attempt.id,
            'questionId', question.id,
            'subject', definition.subject,
            'topic', question.topic,
            'submittedAt', submission.submitted_at,
            'score', assessment.score,
            'answerText', response.answer_text,
            'assessment', assessment.assessment_json,
            'assisted', attempt.review_material_revealed_before_submission is true,
            'assistanceKnown', attempt.review_material_revealed_before_submission is not null,
            'reviewMaterialRevealedAt', attempt.review_material_revealed_at,
            'suggestedAnswer', case
              when model_release.attempt_id is not null
                then version_question.model_answer_snapshot
              else null
            end,
            'legalBasis', case
              when model_release.attempt_id is not null
                then version_question.legal_basis_snapshot
              else null
            end,
            'sources', case
              when model_release.attempt_id is not null
                then version_question.source_urls_snapshot
              else '[]'::jsonb
            end
          ) as item
        from public.examination_submissions submission
        join public.examination_attempts_multi attempt on attempt.id = submission.attempt_id
        join public.examination_versions version on version.id = attempt.version_id
        join public.examination_definitions definition on definition.id = version.exam_id
        join public.examination_version_questions version_question
          on version_question.version_id = version.id
        join public.examination_questions question on question.id = version_question.question_id
        join public.examination_responses response
          on response.attempt_id = attempt.id
         and response.question_id = question.id
        left join public.examination_ai_assessments assessment
          on assessment.attempt_id = attempt.id
         and assessment.question_id = question.id
        left join public.examination_model_releases model_release
          on model_release.attempt_id = attempt.id
        where attempt.user_id = p_user_id
          and definition.track = 'per_subject'
          and (v_subject is null or definition.subject = v_subject)
        order by submission.submitted_at desc
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
