-- Syllabus-Based Review lifetime no-repeat selection and terminal exhaustion.
--
-- This migration is deliberately additive at the API boundary: the existing
-- subject_matter_next_question and subject_matter_skip_question RPCs remain
-- unchanged for instant rollout rollback.  The Worker can opt into these v2
-- RPCs only after the database migration is present.
--
-- A v2 terminal skip needs to persist that no next version exists.  The
-- existing three-column skip constraint required a next version for every
-- skip, so a dedicated boolean extends that state without rewriting any
-- existing attempt.  The replacement constraint is validated before the old
-- constraint is removed.  A short lock timeout makes deployment fail safely
-- instead of waiting behind production traffic.

-- Keep every ACCESS EXCLUSIVE operation in its own fail-fast transaction.
-- PostgreSQL retains table locks until COMMIT, so wrapping the column change,
-- validation, constraint swap, and all function DDL in one transaction would
-- unnecessarily hold the paid-user attempt table lock for the whole file.
begin;

set local lock_timeout = '2s';
set local statement_timeout = '5s';

alter table public.examination_attempts_multi
  add column if not exists subject_matter_skip_exhausted_v2 boolean
    not null default false;

comment on column public.examination_attempts_multi.subject_matter_skip_exhausted_v2 is
  'True only when a v2 Syllabus-Based Review skip closed the attempt because the scoped lifetime pool was exhausted.';

commit;

begin;

set local lock_timeout = '2s';
set local statement_timeout = '5s';

do $subject_skip_add_v2_constraint$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
      and constraint_record.conname = 'examination_attempts_subject_skip_check'
      and position(
        'subject_matter_skip_exhausted_v2'
        in pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_record.oid))
      ) > 0
  ) and not exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
      and constraint_record.conname = 'examination_attempts_subject_skip_v2_check'
  ) then
    alter table public.examination_attempts_multi
      add constraint examination_attempts_subject_skip_v2_check check (
        (
          subject_matter_skipped_at is null
          and subject_matter_skip_request_key is null
          and subject_matter_skip_next_version_id is null
          and subject_matter_skip_exhausted_v2 is false
        )
        or (
          status = 'cancelled'
          and subject_matter_skipped_at is not null
          and subject_matter_skip_request_key is not null
          and subject_matter_skip_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
          and submitted_at is null
          and (
            (
              subject_matter_skip_exhausted_v2 is false
              and subject_matter_skip_next_version_id is not null
            )
            or (
              subject_matter_skip_exhausted_v2 is true
              and subject_matter_skip_next_version_id is null
            )
          )
        )
      ) not valid;
  end if;
end;
$subject_skip_add_v2_constraint$;

commit;

-- VALIDATE CONSTRAINT uses SHARE UPDATE EXCLUSIVE rather than ACCESS
-- EXCLUSIVE, so normal attempt reads and writes remain available.
begin;

set local lock_timeout = '2s';
set local statement_timeout = '5min';

do $subject_skip_validate_v2_constraint$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
      and constraint_record.conname = 'examination_attempts_subject_skip_v2_check'
      and not constraint_record.convalidated
  ) then
    alter table public.examination_attempts_multi
      validate constraint examination_attempts_subject_skip_v2_check;
  end if;
end;
$subject_skip_validate_v2_constraint$;

commit;

begin;

set local lock_timeout = '2s';
set local statement_timeout = '5s';

do $subject_skip_swap_v2_constraint$
begin
  if exists (
    select 1
    from pg_catalog.pg_constraint constraint_record
    where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
      and constraint_record.conname = 'examination_attempts_subject_skip_check'
      and position(
        'subject_matter_skip_exhausted_v2'
        in pg_catalog.lower(pg_catalog.pg_get_constraintdef(constraint_record.oid))
      ) > 0
  ) then
    -- The original migration may already have run in a non-production
    -- environment. Remove only an unused duplicate left by a partial retry.
    if exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
        and constraint_record.conname = 'examination_attempts_subject_skip_v2_check'
    ) then
      alter table public.examination_attempts_multi
        drop constraint examination_attempts_subject_skip_v2_check;
    end if;
  else
    if not exists (
      select 1
      from pg_catalog.pg_constraint constraint_record
      where constraint_record.conrelid = 'public.examination_attempts_multi'::pg_catalog.regclass
        and constraint_record.conname = 'examination_attempts_subject_skip_v2_check'
        and constraint_record.convalidated
    ) then
      raise exception 'EXAMINATION_SUBJECT_SKIP_V2_CONSTRAINT_NOT_READY';
    end if;

    alter table public.examination_attempts_multi
      drop constraint if exists examination_attempts_subject_skip_check;

    alter table public.examination_attempts_multi
      rename constraint examination_attempts_subject_skip_v2_check
      to examination_attempts_subject_skip_check;
  end if;
end;
$subject_skip_swap_v2_constraint$;

commit;

begin;

set local statement_timeout = '5min';

create or replace function public.subject_matter_next_question_v2(
  p_user_id uuid,
  p_subject text,
  p_year_level smallint,
  p_term smallint,
  p_reset_cycle boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course text := pg_catalog.btrim(coalesce(p_subject, ''));
  v_cycle public.subject_matter_cycles%rowtype;
  v_question_id uuid;
  v_version_id uuid;
  v_version public.examination_versions%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_total integer := 0;
  v_answered integer := 0;
  v_skipped integer := 0;
  v_remaining integer := 0;
  v_active_restored boolean := false;
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

  if pg_catalog.char_length(v_course) not between 2 and 120
     or p_year_level not between 1 and 4
     or p_term not between 1 and 3
  then
    raise exception 'SUBJECT_MATTER_SELECTION_INVALID';
  end if;

  -- A reset would make previously seen questions eligible again.  The v2 API
  -- accepts the legacy argument only so rollout can be wire-compatible, but it
  -- never performs the destructive reset.
  if coalesce(p_reset_cycle, false) then
    raise exception 'SUBJECT_MATTER_RESET_RETIRED';
  end if;

  perform public.examination_authorize_access(
    p_user_id,
    'per_subject',
    null,
    null,
    false
  );

  -- All selectors and skips for one owner/course/year/term serialize on the
  -- same transaction-scoped lock.  The row lock below supplies a second guard
  -- and keeps the active restoration decision atomic.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-cycle:' || p_user_id::text || ':' || v_course
      || ':' || p_year_level::text || ':' || p_term::text,
    0
  ));

  insert into public.subject_matter_cycles (
    user_id,
    subject,
    year_level,
    term
  ) values (
    p_user_id,
    v_course,
    p_year_level,
    p_term
  )
  on conflict (user_id, subject, year_level, term) do nothing;

  select cycle.*
  into v_cycle
  from public.subject_matter_cycles cycle
  where cycle.user_id = p_user_id
    and cycle.subject = v_course
    and cycle.year_level = p_year_level
    and cycle.term = p_term
  for update of cycle;

  select pg_catalog.count(distinct version_question.question_id)::integer
  into v_total
  from public.subject_matter_placements placement
  join public.examination_definitions definition
    on definition.id = placement.exam_id
  join public.examination_versions version
    on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = placement.question_id
  where placement.course_name = v_course
    and placement.year_level = p_year_level
    and placement.term = p_term
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1;

  if v_total = 0 then
    raise exception 'SUBJECT_MATTER_SUBJECT_NOT_FOUND';
  end if;

  -- Count only questions that still belong to this exact current course pool.
  -- A nonblank response is permanently answered even when grading later fails
  -- or the attempt never reaches submission.  Skips remain separate metrics.
  select
    pg_catalog.count(*) filter (
      where exists (
        select 1
        from public.examination_attempts_multi history_attempt
        join public.examination_versions history_version
          on history_version.id = history_attempt.version_id
        join public.examination_definitions history_definition
          on history_definition.id = history_version.exam_id
        join public.subject_matter_placements history_placement
          on history_placement.exam_id = history_definition.id
         and history_placement.question_id = pool.question_id
        join public.examination_responses history_response
          on history_response.attempt_id = history_attempt.id
         and history_response.question_id = pool.question_id
        where history_attempt.user_id = p_user_id
          and history_placement.course_name = v_course
          and history_placement.year_level = p_year_level
          and history_placement.term = p_term
          and pg_catalog.btrim(history_response.answer_text) <> ''
      )
    )::integer,
    pg_catalog.count(*) filter (
      where exists (
        select 1
        from public.examination_attempts_multi history_attempt
        join public.examination_versions history_version
          on history_version.id = history_attempt.version_id
        join public.examination_definitions history_definition
          on history_definition.id = history_version.exam_id
        join public.subject_matter_placements history_placement
          on history_placement.exam_id = history_definition.id
         and history_placement.question_id = pool.question_id
        where history_attempt.user_id = p_user_id
          and history_attempt.subject_matter_skipped_at is not null
          and history_placement.course_name = v_course
          and history_placement.year_level = p_year_level
          and history_placement.term = p_term
      )
    )::integer
  into v_answered, v_skipped
  from (
    select distinct version_question.question_id
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.id = definition.active_version_id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    where placement.course_name = v_course
      and placement.year_level = p_year_level
      and placement.term = p_term
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and version.status = 'published'
      and version.question_count = 1
  ) pool;

  -- Restore the current published setup while it remains unanswered.  An open
  -- attempt wins even when it contains a nonblank draft: this is restoration,
  -- not issuance of a new question.
  if v_cycle.active_version_id is not null then
    select version.id, version_question.question_id
    into v_version_id, v_question_id
    from public.examination_versions version
    join public.examination_definitions definition
      on definition.id = version.exam_id
    join public.subject_matter_placements placement
      on placement.exam_id = definition.id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    where version.id = v_cycle.active_version_id
      and placement.course_name = v_course
      and placement.year_level = p_year_level
      and placement.term = p_term
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and version.status = 'published'
      and version.question_count = 1
    limit 1;

    if v_version_id is null then
      update public.subject_matter_cycles
      set active_version_id = null,
          updated_at = pg_catalog.clock_timestamp()
      where user_id = p_user_id
        and subject = v_course
        and year_level = p_year_level
        and term = p_term
      returning * into v_cycle;
    elsif exists (
      select 1
      from public.examination_attempts_multi active_attempt
      where active_attempt.user_id = p_user_id
        and active_attempt.version_id = v_version_id
        and active_attempt.status in ('in_progress', 'review')
        and active_attempt.submitted_at is null
    ) then
      v_active_restored := true;
    elsif exists (
      select 1
      from public.examination_attempts_multi history_attempt
      left join public.examination_responses history_response
        on history_response.attempt_id = history_attempt.id
       and history_response.question_id = v_question_id
      where history_attempt.user_id = p_user_id
        and history_attempt.version_id = v_version_id
        and (
          pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
          or history_attempt.subject_matter_skipped_at is not null
        )
    ) then
      update public.subject_matter_cycles
      set seen_question_ids = case
            when v_question_id = any(seen_question_ids)
              then seen_question_ids
            else pg_catalog.array_append(seen_question_ids, v_question_id)
          end,
          active_version_id = null,
          updated_at = pg_catalog.clock_timestamp()
      where user_id = p_user_id
        and subject = v_course
        and year_level = p_year_level
        and term = p_term
      returning * into v_cycle;
      v_version_id := null;
      v_question_id := null;
    else
      -- The setup was selected but no attempt was opened yet.
      v_active_restored := true;
    end if;
  end if;

  if v_version_id is null then
    select version.id, version_question.question_id
    into v_version_id, v_question_id
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.id = definition.active_version_id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    where placement.course_name = v_course
      and placement.year_level = p_year_level
      and placement.term = p_term
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and version.status = 'published'
      and version.question_count = 1
      and not (
        version_question.question_id = any(v_cycle.seen_question_ids)
      )
      and not exists (
        select 1
        from public.examination_attempts_multi history_attempt
        join public.examination_versions history_version
          on history_version.id = history_attempt.version_id
        join public.examination_definitions history_definition
          on history_definition.id = history_version.exam_id
        join public.subject_matter_placements history_placement
          on history_placement.exam_id = history_definition.id
         and history_placement.question_id = version_question.question_id
        left join public.examination_responses history_response
          on history_response.attempt_id = history_attempt.id
         and history_response.question_id = version_question.question_id
        where history_attempt.user_id = p_user_id
          and history_placement.course_name = v_course
          and history_placement.year_level = p_year_level
          and history_placement.term = p_term
          and (
            pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
            or history_attempt.subject_matter_skipped_at is not null
          )
      )
    order by pg_catalog.gen_random_uuid()
    limit 1;

    if v_version_id is null then
      update public.subject_matter_cycles
      set active_version_id = null,
          updated_at = pg_catalog.clock_timestamp()
      where user_id = p_user_id
        and subject = v_course
        and year_level = p_year_level
        and term = p_term;

      return pg_catalog.jsonb_build_object(
        'exhausted', true,
        'terminal', true,
        'resetRequired', false,
        'subject', v_course,
        'yearLevel', p_year_level,
        'term', p_term,
        'questionCount', v_total,
        'completedCount', v_answered,
        'skippedCount', v_skipped,
        'remainingCount', 0
      );
    end if;

    update public.subject_matter_cycles
    set active_version_id = v_version_id,
        updated_at = pg_catalog.clock_timestamp()
    where user_id = p_user_id
      and subject = v_course
      and year_level = p_year_level
      and term = p_term
    returning * into v_cycle;
  end if;

  select version.*
  into v_version
  from public.examination_versions version
  where version.id = v_version_id
    and version.status = 'published';

  select definition.*
  into v_definition
  from public.examination_definitions definition
  where definition.id = v_version.exam_id
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published';

  if v_version.id is null or v_definition.id is null then
    raise exception 'SUBJECT_MATTER_SELECTION_STALE';
  end if;

  select pg_catalog.count(*)::integer
  into v_remaining
  from public.subject_matter_placements placement
  join public.examination_definitions definition
    on definition.id = placement.exam_id
  join public.examination_versions version
    on version.id = definition.active_version_id
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = placement.question_id
  where placement.course_name = v_course
    and placement.year_level = p_year_level
    and placement.term = p_term
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz'
    and definition.status = 'published'
    and version.status = 'published'
    and version.question_count = 1
    and not (version_question.question_id = any(v_cycle.seen_question_ids))
    and not exists (
      select 1
      from public.examination_attempts_multi history_attempt
      join public.examination_versions history_version
        on history_version.id = history_attempt.version_id
      join public.examination_definitions history_definition
        on history_definition.id = history_version.exam_id
      join public.subject_matter_placements history_placement
        on history_placement.exam_id = history_definition.id
       and history_placement.question_id = version_question.question_id
      left join public.examination_responses history_response
        on history_response.attempt_id = history_attempt.id
       and history_response.question_id = version_question.question_id
      where history_attempt.user_id = p_user_id
        and history_placement.course_name = v_course
        and history_placement.year_level = p_year_level
        and history_placement.term = p_term
        and (
          pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
          or history_attempt.subject_matter_skipped_at is not null
        )
    );

  return pg_catalog.jsonb_build_object(
    'exhausted', false,
    'terminal', false,
    'resetRequired', false,
    'activeRestored', v_active_restored,
    'subject', v_course,
    'yearLevel', p_year_level,
    'term', p_term,
    'questionCount', v_total,
    'completedCount', v_answered,
    'skippedCount', v_skipped,
    'remainingCount', v_remaining,
    'setup', pg_catalog.jsonb_build_object(
      'versionId', v_version.id,
      'track', 'per_subject',
      'assessmentKind', 'quiz',
      'title', v_definition.title,
      'subject', v_definition.subject,
      'questionCount', 1,
      'durationSeconds', v_version.duration_seconds,
      'timerMode', v_version.default_timer_mode,
      'allowedTimerModes', v_version.allowed_timer_modes,
      'instructions', v_version.instructions,
      'gradingRoute', v_version.grading_route,
      'answerReleaseRule', v_version.answer_release_rule
    )
  );
end;
$$;

create or replace function public.subject_matter_skip_question_v2(
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
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_request_key text := pg_catalog.btrim(coalesce(p_request_key, ''));
  v_attempt public.examination_attempts_multi%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_next_version public.examination_versions%rowtype;
  v_cycle public.subject_matter_cycles%rowtype;
  v_question_id uuid;
  v_question_count integer;
  v_next_version_id uuid;
  v_course text;
  v_year_level smallint;
  v_term smallint;
  v_seen_question_ids uuid[];
  v_flagged boolean := false;
  v_tab_hash text;
  v_setup jsonb;
  v_exhausted boolean := false;
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
     or pg_catalog.char_length(coalesce(p_tab_token, '')) not between 32 and 256
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

  -- The attempt row is the durable idempotency receipt.  Both ordinary and
  -- terminal skip results replay exactly without a second cycle mutation.
  if v_attempt.subject_matter_skipped_at is not null then
    if v_attempt.subject_matter_skip_request_key <> v_request_key then
      raise exception 'EXAM_ATTEMPT_CLOSED';
    end if;

    if v_attempt.subject_matter_skip_exhausted_v2 then
      return pg_catalog.jsonb_build_object(
        'skipped', true,
        'replayed', true,
        'exhausted', true,
        'terminal', true,
        'attemptId', v_attempt.id,
        'skippedAt', v_attempt.subject_matter_skipped_at,
        'flaggedForLater', exists (
          select 1
          from public.examination_responses response
          where response.attempt_id = v_attempt.id
            and response.flagged
        ),
        'setup', null
      );
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

    v_setup := pg_catalog.jsonb_build_object(
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

    return pg_catalog.jsonb_build_object(
      'skipped', true,
      'replayed', true,
      'exhausted', false,
      'terminal', false,
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
  join public.examination_definitions definition
    on definition.id = version.exam_id
  where version.id = v_attempt.version_id
    and version.status = 'published'
    and definition.status = 'published'
    and definition.track = 'per_subject'
    and definition.assessment_kind = 'quiz';

  if v_definition.id is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  select pg_catalog.count(*), (pg_catalog.array_agg(version_question.question_id))[1]
  into v_question_count, v_question_id
  from public.examination_version_questions version_question
  where version_question.version_id = v_attempt.version_id;

  if v_question_count <> 1 or v_question_id is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  select
    placement.course_name,
    placement.year_level,
    placement.term
  into
    v_course,
    v_year_level,
    v_term
  from public.subject_matter_placements placement
  where placement.exam_id = v_definition.id
    and placement.course_name = v_definition.subject
    and placement.question_id = v_question_id;

  if v_course is null then
    raise exception 'EXAM_SUBJECT_SKIP_UNAVAILABLE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-cycle:' || p_user_id::text || ':' || v_course
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
    v_course,
    v_year_level,
    v_term
  )
  on conflict (user_id, subject, year_level, term) do nothing;

  select cycle.*
  into v_cycle
  from public.subject_matter_cycles cycle
  where cycle.user_id = p_user_id
    and cycle.subject = v_course
    and cycle.year_level = v_year_level
    and cycle.term = v_term
  for update of cycle;

  v_seen_question_ids := case
    when v_question_id = any(v_cycle.seen_question_ids)
      then v_cycle.seen_question_ids
    else pg_catalog.array_append(v_cycle.seen_question_ids, v_question_id)
  end;

  -- A flagged-version retry may be outside the ordinary active rotation.  In
  -- that case preserve the already-selected active version only when it is an
  -- eligible unseen question in this same course/year/term.
  if v_cycle.active_version_id is not null
     and v_cycle.active_version_id <> v_attempt.version_id
  then
    select version.id
    into v_next_version_id
    from public.examination_versions version
    join public.examination_definitions definition
      on definition.id = version.exam_id
    join public.subject_matter_placements placement
      on placement.exam_id = definition.id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    where version.id = v_cycle.active_version_id
      and version.status = 'published'
      and version.question_count = 1
      and definition.track = 'per_subject'
      and definition.assessment_kind = 'quiz'
      and definition.status = 'published'
      and placement.course_name = v_course
      and placement.year_level = v_year_level
      and placement.term = v_term
      and version_question.question_id <> v_question_id
      and not (version_question.question_id = any(v_seen_question_ids))
      and not exists (
        select 1
        from public.examination_attempts_multi history_attempt
        join public.examination_versions history_version
          on history_version.id = history_attempt.version_id
        join public.examination_definitions history_definition
          on history_definition.id = history_version.exam_id
        join public.subject_matter_placements history_placement
          on history_placement.exam_id = history_definition.id
         and history_placement.question_id = version_question.question_id
        left join public.examination_responses history_response
          on history_response.attempt_id = history_attempt.id
         and history_response.question_id = version_question.question_id
        where history_attempt.user_id = p_user_id
          and history_placement.course_name = v_course
          and history_placement.year_level = v_year_level
          and history_placement.term = v_term
          and (
            pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
            or history_attempt.subject_matter_skipped_at is not null
          )
      )
    limit 1;
    v_cycle_preserved := v_next_version_id is not null;
  end if;

  if v_next_version_id is null then
    select version.id
    into v_next_version_id
    from public.subject_matter_placements placement
    join public.examination_definitions definition
      on definition.id = placement.exam_id
    join public.examination_versions version
      on version.id = definition.active_version_id
    join public.examination_version_questions version_question
      on version_question.version_id = version.id
     and version_question.question_id = placement.question_id
    where placement.course_name = v_course
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
      and not exists (
        select 1
        from public.examination_attempts_multi history_attempt
        join public.examination_versions history_version
          on history_version.id = history_attempt.version_id
        join public.examination_definitions history_definition
          on history_definition.id = history_version.exam_id
        join public.subject_matter_placements history_placement
          on history_placement.exam_id = history_definition.id
         and history_placement.question_id = version_question.question_id
        left join public.examination_responses history_response
          on history_response.attempt_id = history_attempt.id
         and history_response.question_id = version_question.question_id
        where history_attempt.user_id = p_user_id
          and history_placement.course_name = v_course
          and history_placement.year_level = v_year_level
          and history_placement.term = v_term
          and (
            pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
            or history_attempt.subject_matter_skipped_at is not null
          )
      )
    order by pg_catalog.gen_random_uuid()
    limit 1;
  end if;

  if v_next_version_id is null then
    v_exhausted := true;
  else
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

    v_setup := pg_catalog.jsonb_build_object(
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
  end if;

  update public.subject_matter_cycles
  set seen_question_ids = v_seen_question_ids,
      active_version_id = case when v_exhausted then null else v_next_version_id end,
      updated_at = v_now
  where user_id = p_user_id
    and subject = v_course
    and year_level = v_year_level
    and term = v_term
  returning * into v_cycle;

  select response.flagged
  into v_flagged
  from public.examination_responses response
  where response.attempt_id = v_attempt.id
    and response.question_id = v_question_id;

  update public.examination_attempts_multi
  set status = 'cancelled',
      subject_matter_skipped_at = v_now,
      subject_matter_skip_request_key = v_request_key,
      subject_matter_skip_next_version_id = case
        when v_exhausted then null
        else v_next_version_id
      end,
      subject_matter_skip_exhausted_v2 = v_exhausted,
      submission_reason = case
        when v_exhausted
          then 'Syllabus-Based Review question skipped without submission or score; the scoped lifetime pool is exhausted.'
        else 'Syllabus-Based Review question skipped without submission or score.'
      end,
      elapsed_seconds = case
        when timer_mode in ('strict', 'selfPaced')
          then greatest(
            elapsed_seconds,
            pg_catalog.floor(extract(epoch from (v_now - started_at)))::integer
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
    'The student chose Skip; no submission, grading job, score, or grading credit reservation was created.',
    pg_catalog.jsonb_build_object(
      'rotationVersion', 2,
      'versionId', v_attempt.version_id,
      'questionId', v_question_id,
      'nextVersionId', v_next_version_id,
      'exhausted', v_exhausted,
      'flaggedForLater', coalesce(v_flagged, false),
      'cycleRestarted', false,
      'cyclePreserved', v_cycle_preserved,
      'course', v_course,
      'yearLevel', v_year_level,
      'term', v_term
    )
  );

  return pg_catalog.jsonb_build_object(
    'skipped', true,
    'replayed', false,
    'exhausted', v_exhausted,
    'terminal', v_exhausted,
    'attemptId', v_attempt.id,
    'skippedAt', v_attempt.subject_matter_skipped_at,
    'flaggedForLater', coalesce(v_flagged, false),
    'cycleRestarted', false,
    'cyclePreserved', v_cycle_preserved,
    'setup', v_setup
  );
end;
$$;

comment on function public.subject_matter_next_question_v2(
  uuid, text, smallint, smallint, boolean
) is
  'Trusted Worker-only Syllabus-Based Review selector: course/year/term scoped, lifetime no-repeat, active-restoring, and terminal on exhaustion.';

comment on function public.subject_matter_skip_question_v2(
  uuid, uuid, text, text
) is
  'Trusted Worker-only Syllabus-Based Review skip: idempotent, no score or grading-credit reservation, no cycle restart, and terminal on exhaustion.';

revoke all on function public.subject_matter_next_question_v2(
  uuid, text, smallint, smallint, boolean
) from public, anon, authenticated;

revoke all on function public.subject_matter_skip_question_v2(
  uuid, uuid, text, text
) from public, anon, authenticated;

grant execute on function public.subject_matter_next_question_v2(
  uuid, text, smallint, smallint, boolean
) to service_role;

grant execute on function public.subject_matter_skip_question_v2(
  uuid, uuid, text, text
) to service_role;

commit;
