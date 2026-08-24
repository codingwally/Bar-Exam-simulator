-- Durable, feature-scoped question rotation.
--
-- This is additive and database-first: the existing clients continue to use
-- their current selectors until the Worker opts into this RPC. Answered items
-- are excluded permanently within the same feature + subject. Merely issued
-- (but unanswered) items are held back until the other unanswered candidates
-- have been offered, after which they may safely re-enter the rotation.

begin;

set local lock_timeout = '250ms';
set local statement_timeout = '5s';

create table if not exists public.feature_question_rotations (
  user_id uuid not null references auth.users(id) on delete cascade,
  feature_key text not null check (
    feature_key in (
      'syllabus_based_review',
      'bar_question_practice',
      'bar_exam_simulation'
    )
  ),
  subject text not null check (char_length(btrim(subject)) between 2 and 160),
  cycle_number integer not null default 1 check (cycle_number > 0),
  issued_question_ids text[] not null default '{}'::text[],
  last_question_id text,
  last_request_key text check (
    last_request_key is null
    or last_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
  ),
  last_result jsonb not null default '{}'::jsonb
    check (jsonb_typeof(last_result) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, feature_key, subject)
);

create index if not exists feature_question_rotations_recent_idx
  on public.feature_question_rotations (user_id, updated_at desc);

alter table public.feature_question_rotations enable row level security;
alter table public.feature_question_rotations force row level security;

revoke all on public.feature_question_rotations
  from public, anon, authenticated;
grant select, insert, update, delete on public.feature_question_rotations
  to service_role;

comment on table public.feature_question_rotations is
  'Server-only, per-user question issuance state isolated by product feature and subject.';
comment on column public.feature_question_rotations.issued_question_ids is
  'Questions offered in the current unanswered cycle; this is not the permanent answered ledger.';

commit;

begin;

set local statement_timeout = '5min';

create or replace function public.select_feature_question_v1(
  p_user_id uuid,
  p_feature_key text,
  p_subject text,
  p_candidate_question_ids text[],
  p_request_key text
)
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  v_feature_key text := lower(btrim(coalesce(p_feature_key, '')));
  v_subject text := btrim(coalesce(p_subject, ''));
  v_request_key text := btrim(coalesce(p_request_key, ''));
  v_candidates text[];
  v_answered text[] := '{}'::text[];
  v_unanswered text[] := '{}'::text[];
  v_fresh text[] := '{}'::text[];
  v_issued text[] := '{}'::text[];
  v_selected text;
  v_cycle_number integer;
  v_state public.feature_question_rotations%rowtype;
  v_result jsonb;
begin
  if p_user_id is null
     or v_feature_key not in (
       'syllabus_based_review',
       'bar_question_practice',
       'bar_exam_simulation'
     )
     or char_length(v_subject) not between 2 and 160
     or v_request_key !~ '^[A-Za-z0-9_-]{16,128}$'
  then
    raise exception 'FEATURE_QUESTION_SELECTION_INVALID';
  end if;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_candidates
  from (
    select distinct btrim(raw_id) as candidate_id
    from unnest(coalesce(p_candidate_question_ids, '{}'::text[])) raw_id
    where char_length(btrim(raw_id)) between 2 and 160
  ) candidates;

  if cardinality(v_candidates) not between 1 and 500 then
    raise exception 'FEATURE_QUESTION_CANDIDATES_INVALID';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'feature-question-rotation:' || p_user_id::text || ':'
      || v_feature_key || ':' || lower(v_subject),
    0
  ));

  insert into public.feature_question_rotations (
    user_id, feature_key, subject
  )
  values (p_user_id, v_feature_key, v_subject)
  on conflict (user_id, feature_key, subject) do nothing;

  select * into v_state
  from public.feature_question_rotations
  where user_id = p_user_id
    and feature_key = v_feature_key
    and subject = v_subject
  for update;

  if v_state.last_request_key = v_request_key
     and jsonb_typeof(v_state.last_result) = 'object'
     and v_state.last_result <> '{}'::jsonb
  then
    return v_state.last_result || jsonb_build_object('replayed', true);
  end if;

  if v_feature_key = 'bar_question_practice' then
    select coalesce(array_agg(distinct a.question_bank_id), '{}'::text[])
    into v_answered
    from public.exam_attempts a
    where a.user_id = p_user_id
      and lower(btrim(a.subject)) = lower(v_subject)
      and nullif(btrim(a.answer_text), '') is not null
      and a.question_bank_id = any(v_candidates);
  elsif v_feature_key = 'syllabus_based_review' then
    select coalesce(array_agg(distinct vq.question_id::text), '{}'::text[])
    into v_answered
    from public.examination_attempts_multi a
    join public.examination_versions ev on ev.id = a.version_id
    join public.examination_definitions d on d.id = ev.exam_id
    join public.examination_submissions submission on submission.attempt_id = a.id
    join public.examination_responses response on response.attempt_id = a.id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id
     and vq.question_id = response.question_id
    where a.user_id = p_user_id
      and d.track = 'per_subject'
      and lower(btrim(d.subject)) = lower(v_subject)
      and nullif(btrim(response.answer_text), '') is not null
      and vq.question_id::text = any(v_candidates);
  else
    select coalesce(array_agg(distinct vq.question_id::text), '{}'::text[])
    into v_answered
    from public.examination_attempts_multi a
    join public.examination_versions ev on ev.id = a.version_id
    join public.examination_definitions d on d.id = ev.exam_id
    join public.examination_submissions submission on submission.attempt_id = a.id
    join public.examination_responses response on response.attempt_id = a.id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id
     and vq.question_id = response.question_id
    where a.user_id = p_user_id
      and d.track = 'bar_feels'
      and lower(btrim(d.subject)) = lower(v_subject)
      and nullif(btrim(response.answer_text), '') is not null
      and vq.question_id::text = any(v_candidates);
  end if;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_unanswered
  from unnest(v_candidates) candidate_id
  where not (candidate_id = any(v_answered));

  if cardinality(v_unanswered) = 0 then
    v_result := jsonb_build_object(
      'feature', v_feature_key,
      'subject', v_subject,
      'questionId', null,
      'questionCount', cardinality(v_candidates),
      'answeredCount', cardinality(v_answered),
      'unansweredCount', 0,
      'remainingUnissued', 0,
      'cycleNumber', v_state.cycle_number,
      'exhausted', true,
      'replayed', false
    );

    update public.feature_question_rotations
    set last_question_id = null,
        last_request_key = v_request_key,
        last_result = v_result,
        updated_at = now()
    where user_id = p_user_id
      and feature_key = v_feature_key
      and subject = v_subject;
    return v_result;
  end if;

  v_issued := coalesce(v_state.issued_question_ids, '{}'::text[]);
  v_cycle_number := v_state.cycle_number;

  select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
  into v_fresh
  from unnest(v_unanswered) candidate_id
  where not (candidate_id = any(v_issued));

  if cardinality(v_fresh) = 0 then
    v_cycle_number := v_cycle_number + 1;
    v_issued := case
      when cardinality(v_unanswered) > 1
       and v_state.last_question_id = any(v_unanswered)
      then array[v_state.last_question_id]::text[]
      else '{}'::text[]
    end;

    select coalesce(array_agg(candidate_id order by candidate_id), '{}'::text[])
    into v_fresh
    from unnest(v_unanswered) candidate_id
    where not (candidate_id = any(v_issued));
  end if;

  select candidate_id
  into v_selected
  from unnest(v_fresh) candidate_id
  order by gen_random_uuid()
  limit 1;

  if nullif(v_selected, '') is null then
    raise exception 'FEATURE_QUESTION_SELECTION_UNAVAILABLE';
  end if;

  v_issued := array_append(v_issued, v_selected);
  v_result := jsonb_build_object(
    'feature', v_feature_key,
    'subject', v_subject,
    'questionId', v_selected,
    'questionCount', cardinality(v_candidates),
    'answeredCount', cardinality(v_answered),
    'unansweredCount', cardinality(v_unanswered),
    'remainingUnissued', greatest(cardinality(v_fresh) - 1, 0),
    'cycleNumber', v_cycle_number,
    'exhausted', false,
    'replayed', false
  );

  update public.feature_question_rotations
  set cycle_number = v_cycle_number,
      issued_question_ids = v_issued,
      last_question_id = v_selected,
      last_request_key = v_request_key,
      last_result = v_result,
      updated_at = now()
  where user_id = p_user_id
    and feature_key = v_feature_key
    and subject = v_subject;

  return v_result;
end;
$$;

revoke all on function public.select_feature_question_v1(
  uuid, text, text, text[], text
) from public, anon, authenticated;
grant execute on function public.select_feature_question_v1(
  uuid, text, text, text[], text
) to service_role;

commit;
