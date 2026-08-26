-- Due Diligence Release 2: Pedro, a private website-only study assistant.
--
-- The Worker authenticates the caller and is the only client of these objects.
-- Pedro stores no provider output, never accepts model-authored copy or URLs,
-- and only exposes server-authored messages plus opaque, owner-bound actions.

begin;

create extension if not exists pgcrypto with schema extensions;

create table public.pedro_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  access_kind text not null check (access_kind in ('paid', 'operator')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_id, access_kind),
  unique (id, user_id),
  unique (id, user_id, access_kind)
);

create table public.pedro_turns (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_kind text not null check (access_kind in ('paid', 'operator')),
  request_key text not null check (request_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  input_text text not null check (char_length(btrim(input_text)) between 1 and 1000),
  input_sha256 text not null check (input_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (
    status in ('reserved', 'completed', 'failed_retryable', 'failed_terminal')
  ),
  claim_version integer not null default 1 check (claim_version > 0),
  attempt_count smallint not null default 1 check (attempt_count between 1 and 3),
  lease_expires_at timestamptz,
  response_kind text check (response_kind in (
    'greeting',
    'motivation',
    'outside_scope',
    'no_match',
    'match',
    'choose_location',
    'website_help_profile',
    'website_help_study_circles',
    'website_help_syllabus',
    'website_help_doctrine',
    'website_help_mock_bar',
    'website_help_home',
    'website_help_account',
    'website_help_pricing',
    'website_help_pedro'
  )),
  response_text text check (
    response_text is null or char_length(btrim(response_text)) between 1 and 1000
  ),
  failure_class text check (failure_class in (
    'provider_unavailable', 'provider_invalid', 'search_unavailable',
    'configuration_missing', 'internal_retryable', 'internal_terminal'
  )),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint pedro_turns_thread_owner_fkey
    foreign key (thread_id, user_id, access_kind)
    references public.pedro_threads(id, user_id, access_kind)
    on delete cascade,
  constraint pedro_turns_completion_check check (
    (
      status = 'reserved'
      and lease_expires_at is not null
      and response_kind is null
      and response_text is null
      and failure_class is null
      and completed_at is null
    )
    or (
      status = 'completed'
      and lease_expires_at is null
      and response_kind is not null
      and response_text is not null
      and failure_class is null
      and completed_at is not null
    )
    or (
      status in ('failed_retryable', 'failed_terminal')
      and lease_expires_at is null
      and response_kind is null
      and response_text is null
      and failure_class is not null
      and completed_at is null
    )
  ),
  unique (user_id, access_kind, request_key),
  unique (id, user_id)
);

create unique index pedro_turns_one_reserved_per_access_idx
  on public.pedro_turns (user_id, access_kind)
  where status = 'reserved';

create index pedro_turns_history_idx
  on public.pedro_turns (thread_id, created_at, id);

create index pedro_turns_rate_idx
  on public.pedro_turns (user_id, access_kind, created_at desc);

create table public.pedro_actions (
  id uuid primary key default gen_random_uuid(),
  turn_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  ordinal smallint not null check (ordinal between 1 and 3),
  destination text not null check (destination in ('doctrine', 'syllabus', 'mock_bar')),
  doctrine_content_id text references public.dd2026_content_items(id) on delete restrict,
  syllabus_version_id uuid references public.examination_versions(id) on delete restrict,
  syllabus_question_id uuid references public.examination_questions(id) on delete restrict,
  mock_question_id text,
  mock_subject text,
  created_at timestamptz not null default now(),
  constraint pedro_actions_turn_owner_fkey
    foreign key (turn_id, user_id)
    references public.pedro_turns(id, user_id)
    on delete cascade,
  constraint pedro_actions_syllabus_version_question_fkey
    foreign key (syllabus_version_id, syllabus_question_id)
    references public.examination_version_questions(version_id, question_id)
    on delete restrict,
  constraint pedro_actions_target_shape_check check (
    (
      destination = 'doctrine'
      and doctrine_content_id is not null
      and syllabus_version_id is null
      and syllabus_question_id is null
      and mock_question_id is null
      and mock_subject is null
    )
    or (
      destination = 'syllabus'
      and doctrine_content_id is null
      and syllabus_version_id is not null
      and syllabus_question_id is not null
      and mock_question_id is null
      and mock_subject is null
    )
    or (
      destination = 'mock_bar'
      and doctrine_content_id is null
      and syllabus_version_id is null
      and syllabus_question_id is null
      and mock_question_id is not null
      and mock_subject is not null
      and char_length(btrim(mock_question_id)) between 1 and 128
      and char_length(btrim(mock_subject)) between 2 and 120
      and mock_question_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
      and mock_subject ~ '^[[:alnum:]][[:alnum:] .,&()''/-]{1,119}$'
    )
  ),
  unique (turn_id, ordinal),
  unique (turn_id, destination)
);

create index pedro_actions_owner_idx
  on public.pedro_actions (user_id, id);

create index if not exists payment_requests_pedro_entitlement_idx
  on public.payment_requests (subscription_id, user_id)
  where status = 'approved' and subscription_id is not null;

alter table public.pedro_threads enable row level security;
alter table public.pedro_threads force row level security;
alter table public.pedro_turns enable row level security;
alter table public.pedro_turns force row level security;
alter table public.pedro_actions enable row level security;
alter table public.pedro_actions force row level security;

revoke all on public.pedro_threads from public, anon, authenticated;
revoke all on public.pedro_turns from public, anon, authenticated;
revoke all on public.pedro_actions from public, anon, authenticated;

grant select, insert, update, delete on public.pedro_threads to service_role;
grant select, insert, update, delete on public.pedro_turns to service_role;
grant select, insert, update, delete on public.pedro_actions to service_role;

create or replace function public.pedro_access_snapshot(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_role text := 'student';
  v_terms_ok boolean := false;
  v_paid boolean := false;
  v_access_kind text;
begin
  if p_user_id is null
     or not exists (
       select 1
       from auth.users authenticated_user
       where authenticated_user.id = p_user_id
         and coalesce(authenticated_user.is_anonymous, false) is false
     )
  then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'authentication_required'
    );
  end if;

  select coalesce(role_record.role, 'student')
  into v_role
  from public.user_roles role_record
  where role_record.user_id = p_user_id;
  v_role := coalesce(v_role, 'student');

  select exists (
    select 1
    from public.platform_access_settings settings
    join public.terms_acceptances acceptance
      on acceptance.user_id = p_user_id
     and acceptance.terms_version = settings.current_terms_version
     and acceptance.privacy_version = settings.current_privacy_version
    where settings.singleton = true
  ) into v_terms_ok;

  if not v_terms_ok then
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'current_terms_required'
    );
  end if;

  select exists (
    select 1
    from public.subscriptions subscription
    join public.payment_requests payment
      on payment.subscription_id = subscription.id
     and payment.user_id = subscription.user_id
     and payment.status = 'approved'
    where subscription.user_id = p_user_id
      and subscription.status = 'active'
      and subscription.source = 'manual_payment'
      and subscription.starts_at is not null
      and subscription.starts_at <= v_now
      and (subscription.expires_at is null or subscription.expires_at > v_now)
  ) into v_paid;

  if v_paid then
    v_access_kind := 'paid';
  elsif v_role in ('founder_admin', 'super_admin') then
    v_access_kind := 'operator';
  else
    return pg_catalog.jsonb_build_object(
      'allowed', false,
      'reason', 'paid_access_required'
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', true,
    'accessKind', v_access_kind,
    'testMode', v_access_kind = 'operator'
  );
end;
$$;

create or replace function public.pedro_message_json(p_turn_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'id', turn_record.id,
    'role', 'pedro',
    'text', turn_record.response_text,
    'actions', coalesce((
      select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'id', action_record.id,
          'type', action_record.destination,
          'label', case action_record.destination
            when 'doctrine' then 'Open Doctrine Review'
            when 'syllabus' then 'Open Syllabus-Based Review'
            else 'Open Bar Question Practice'
          end
        ) order by action_record.ordinal
      )
      from public.pedro_actions action_record
      where action_record.turn_id = turn_record.id
    ), '[]'::jsonb),
    'createdAt', turn_record.completed_at
  )
  from public.pedro_turns turn_record
  where turn_record.id = p_turn_id
    and turn_record.status = 'completed';
$$;

create or replace function public.pedro_reserve_turn(
  p_user_id uuid,
  p_thread_id uuid,
  p_request_key text,
  p_input_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_access jsonb;
  v_access_kind text;
  v_request_key text := pg_catalog.btrim(coalesce(p_request_key, ''));
  v_input_text text := pg_catalog.btrim(coalesce(p_input_text, ''));
  v_input_hash text;
  v_thread public.pedro_threads%rowtype;
  v_turn public.pedro_turns%rowtype;
  v_active_turn public.pedro_turns%rowtype;
  v_retry_after_seconds integer;
begin
  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED:%', coalesce(v_access ->> 'reason', 'denied');
  end if;
  v_access_kind := v_access ->> 'accessKind';

  if v_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'PEDRO_REQUEST_KEY_INVALID';
  end if;
  if pg_catalog.char_length(v_input_text) not between 1 and 1000 then
    raise exception 'PEDRO_MESSAGE_INVALID';
  end if;

  v_input_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(v_input_text, 'UTF8'), 'sha256'),
    'hex'
  );

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'pedro:' || p_user_id::text || ':' || v_access_kind,
    0
  ));

  insert into public.pedro_threads (user_id, access_kind)
  values (p_user_id, v_access_kind)
  on conflict (user_id, access_kind) do update
  set updated_at = excluded.updated_at
  returning * into v_thread;

  if p_thread_id is not null and p_thread_id <> v_thread.id then
    raise exception 'PEDRO_THREAD_INVALID';
  end if;

  -- Reconcile every expired lease before either retrying an older request or
  -- reserving a new one. The advisory lock makes this the single serialized
  -- decision point for the member and access kind.
  update public.pedro_turns expired_turn
  set status = case
        when expired_turn.attempt_count >= 3 then 'failed_terminal'
        else 'failed_retryable'
      end,
      lease_expires_at = null,
      failure_class = case
        when expired_turn.attempt_count >= 3 then 'internal_terminal'
        else 'internal_retryable'
      end,
      updated_at = v_now
  where expired_turn.user_id = p_user_id
    and expired_turn.access_kind = v_access_kind
    and expired_turn.status = 'reserved'
    and expired_turn.lease_expires_at <= v_now;

  select turn_record.*
  into v_turn
  from public.pedro_turns turn_record
  where turn_record.user_id = p_user_id
    and turn_record.access_kind = v_access_kind
    and turn_record.request_key = v_request_key
  for update of turn_record;

  if v_turn.id is not null then
    if v_turn.input_sha256 <> v_input_hash then
      raise exception 'PEDRO_REQUEST_KEY_REUSED';
    end if;

    if v_turn.status = 'completed' then
      return pg_catalog.jsonb_build_object(
        'state', 'completed',
        'threadId', v_thread.id,
        'accessKind', v_access_kind,
        'message', public.pedro_message_json(v_turn.id)
      );
    end if;

    if v_turn.status = 'failed_terminal' then
      return pg_catalog.jsonb_build_object(
        'state', 'failed_terminal',
        'threadId', v_thread.id,
        'turnId', v_turn.id,
        'accessKind', v_access_kind
      );
    end if;

    if v_turn.status = 'reserved' and v_turn.lease_expires_at > v_now then
      v_retry_after_seconds := pg_catalog.least(
        60,
        pg_catalog.greatest(
          1,
          pg_catalog.ceil(
            extract(epoch from (v_turn.lease_expires_at - v_now))
          )::integer
        )
      );
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'threadId', v_thread.id,
        'turnId', v_turn.id,
        'accessKind', v_access_kind,
        'retryAfterSeconds', v_retry_after_seconds
      );
    end if;

    if v_turn.attempt_count >= 3 then
      update public.pedro_turns
      set status = 'failed_terminal',
          lease_expires_at = null,
          failure_class = coalesce(failure_class, 'internal_terminal'),
          updated_at = v_now
      where id = v_turn.id
      returning * into v_turn;

      return pg_catalog.jsonb_build_object(
        'state', 'failed_terminal',
        'threadId', v_thread.id,
        'turnId', v_turn.id,
        'accessKind', v_access_kind
      );
    end if;

    select active_turn.*
    into v_active_turn
    from public.pedro_turns active_turn
    where active_turn.user_id = p_user_id
      and active_turn.access_kind = v_access_kind
      and active_turn.status = 'reserved'
      and active_turn.lease_expires_at > v_now
      and active_turn.id <> v_turn.id
    for update of active_turn;

    if v_active_turn.id is not null then
      v_retry_after_seconds := pg_catalog.least(
        60,
        pg_catalog.greatest(
          1,
          pg_catalog.ceil(
            extract(epoch from (v_active_turn.lease_expires_at - v_now))
          )::integer
        )
      );
      return pg_catalog.jsonb_build_object(
        'state', 'in_progress',
        'threadId', v_thread.id,
        'turnId', v_active_turn.id,
        'accessKind', v_access_kind,
        'retryAfterSeconds', v_retry_after_seconds
      );
    end if;

    update public.pedro_turns
    set status = 'reserved',
        claim_version = claim_version + 1,
        attempt_count = attempt_count + 1,
        lease_expires_at = v_now + interval '90 seconds',
        failure_class = null,
        updated_at = v_now
    where id = v_turn.id
    returning * into v_turn;

    return pg_catalog.jsonb_build_object(
      'state', 'reserved',
      'threadId', v_thread.id,
      'turnId', v_turn.id,
      'claimVersion', v_turn.claim_version,
      'accessKind', v_access_kind
    );
  end if;

  select active_turn.*
  into v_active_turn
  from public.pedro_turns active_turn
  where active_turn.user_id = p_user_id
    and active_turn.access_kind = v_access_kind
    and active_turn.status = 'reserved'
    and active_turn.lease_expires_at > v_now
  for update of active_turn;

  if v_active_turn.id is not null then
    v_retry_after_seconds := pg_catalog.least(
      60,
      pg_catalog.greatest(
        1,
        pg_catalog.ceil(
            extract(epoch from (v_active_turn.lease_expires_at - v_now))
        )::integer
      )
    );
    return pg_catalog.jsonb_build_object(
      'state', 'in_progress',
      'threadId', v_thread.id,
      'turnId', v_active_turn.id,
      'accessKind', v_access_kind,
      'retryAfterSeconds', v_retry_after_seconds
    );
  end if;

  if (
    select pg_catalog.count(*)
    from public.pedro_turns recent_turn
    where recent_turn.user_id = p_user_id
      and recent_turn.access_kind = v_access_kind
      and recent_turn.created_at >= v_now - interval '10 minutes'
  ) >= 30 then
    raise exception 'PEDRO_RATE_LIMIT_SHORT';
  end if;

  if (
    select pg_catalog.count(*)
    from public.pedro_turns daily_turn
    where daily_turn.user_id = p_user_id
      and daily_turn.access_kind = v_access_kind
      and daily_turn.created_at >= (
        pg_catalog.date_trunc('day', v_now at time zone 'Asia/Manila')
          at time zone 'Asia/Manila'
      )
  ) >= 250 then
    raise exception 'PEDRO_RATE_LIMIT_DAILY';
  end if;

  insert into public.pedro_turns (
    thread_id,
    user_id,
    access_kind,
    request_key,
    input_text,
    input_sha256,
    status,
    lease_expires_at
  ) values (
    v_thread.id,
    p_user_id,
    v_access_kind,
    v_request_key,
    v_input_text,
    v_input_hash,
    'reserved',
    v_now + interval '90 seconds'
  )
  returning * into v_turn;

  update public.pedro_threads
  set updated_at = v_now,
      last_message_at = v_now
  where id = v_thread.id;

  return pg_catalog.jsonb_build_object(
    'state', 'reserved',
    'threadId', v_thread.id,
    'turnId', v_turn.id,
    'claimVersion', v_turn.claim_version,
    'accessKind', v_access_kind
  );
end;
$$;

create or replace function public.pedro_search_published_content(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_version integer,
  p_terms text[],
  p_limit integer default 4
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_turn public.pedro_turns%rowtype;
  v_terms text[];
  v_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 4), 1), 4);
begin
  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED';
  end if;

  select turn_record.*
  into v_turn
  from public.pedro_turns turn_record
  where turn_record.id = p_turn_id
    and turn_record.user_id = p_user_id
    and turn_record.access_kind = v_access ->> 'accessKind'
    and turn_record.status = 'reserved'
    and turn_record.claim_version = p_claim_version
    and turn_record.lease_expires_at > pg_catalog.clock_timestamp();

  if v_turn.id is null then
    raise exception 'PEDRO_CLAIM_STALE';
  end if;

  select pg_catalog.array_agg(term order by term)
  into v_terms
  from (
    select distinct pg_catalog.lower(pg_catalog.btrim(raw_term)) as term
    from pg_catalog.unnest(coalesce(p_terms, '{}'::text[])) raw_term
    where pg_catalog.char_length(pg_catalog.btrim(raw_term)) between 2 and 40
      and pg_catalog.btrim(raw_term) ~ '^[[:alnum:]][[:alnum:] .''/-]{1,39}$'
    order by term
    limit 8
  ) normalized_terms;

  if coalesce(pg_catalog.array_length(v_terms, 1), 0) = 0 then
    return pg_catalog.jsonb_build_object('candidates', '[]'::jsonb);
  end if;

  return pg_catalog.jsonb_build_object('candidates', coalesce((
    with doctrine_candidates as (
      select
        'doctrine'::text as destination,
        item.id::text as stable_id,
        item.id as content_id,
        null::uuid as version_id,
        null::uuid as question_id,
        item.title,
        item.subject,
        null::text as topic,
        (
          select pg_catalog.count(*)::integer
          from pg_catalog.unnest(v_terms) term
          where pg_catalog.lower(item.title) like '%' || term || '%'
             or pg_catalog.lower(item.subject) like '%' || term || '%'
        ) as score
      from public.dd2026_content_items item
      join public.dd2026_content_versions version
        on version.id = item.current_published_version_id
       and version.content_id = item.id
       and version.lifecycle_state = 'published'
      where item.content_type = 'doctrine'
        and exists (
          select 1
          from pg_catalog.unnest(v_terms) term
          where pg_catalog.lower(item.title) like '%' || term || '%'
             or pg_catalog.lower(item.subject) like '%' || term || '%'
        )
    ),
    syllabus_candidates as (
      select distinct on (version.id, question.id)
        'syllabus'::text as destination,
        version.id::text || ':' || question.id::text as stable_id,
        null::text as content_id,
        version.id as version_id,
        question.id as question_id,
        coalesce(nullif(pg_catalog.btrim(question.topic), ''), placement.course_name) as title,
        placement.course_name as subject,
        nullif(pg_catalog.btrim(question.topic), '') as topic,
        (
          select pg_catalog.count(*)::integer
          from pg_catalog.unnest(v_terms) term
          where pg_catalog.lower(coalesce(question.topic, '')) like '%' || term || '%'
             or pg_catalog.lower(question.subject) like '%' || term || '%'
             or pg_catalog.lower(coalesce(question.doctrine, '')) like '%' || term || '%'
             or pg_catalog.lower(placement.course_name) like '%' || term || '%'
        ) as score
      from public.subject_matter_placements placement
      join public.examination_definitions definition
        on definition.id = placement.exam_id
       and definition.track = 'per_subject'
       and definition.assessment_kind = 'quiz'
       and definition.status = 'published'
      join public.examination_versions version
        on version.id = definition.active_version_id
       and version.status = 'published'
       and version.question_count = 1
      join public.examination_version_questions version_question
        on version_question.version_id = version.id
       and version_question.question_id = placement.question_id
      join public.examination_questions question
        on question.id = version_question.question_id
       and question.source_type = 'google_sheet'
       and question.review_status = 'approved'
       and question.publication_ready = true
      where (
        exists (
          select 1
          from public.examination_attempts_multi open_attempt
          where open_attempt.user_id = p_user_id
            and open_attempt.version_id = version.id
            and open_attempt.status in ('in_progress', 'review')
            and open_attempt.submitted_at is null
        )
        or (
          not exists (
            select 1
            from public.subject_matter_cycles cycle
            where cycle.user_id = p_user_id
              and cycle.subject = placement.course_name
              and cycle.year_level = placement.year_level
              and cycle.term = placement.term
              and question.id = any(cycle.seen_question_ids)
          )
          and not exists (
            select 1
            from public.examination_attempts_multi history_attempt
            join public.examination_versions history_version
              on history_version.id = history_attempt.version_id
            join public.examination_definitions history_definition
              on history_definition.id = history_version.exam_id
            join public.examination_version_questions history_version_question
              on history_version_question.version_id = history_version.id
             and history_version_question.question_id = question.id
            join public.subject_matter_placements history_placement
              on history_placement.exam_id = history_definition.id
             and history_placement.question_id = question.id
            left join public.examination_responses history_response
              on history_response.attempt_id = history_attempt.id
             and history_response.question_id = question.id
            where history_attempt.user_id = p_user_id
              and history_placement.course_name = placement.course_name
              and history_placement.year_level = placement.year_level
              and history_placement.term = placement.term
              and (
                pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
                or history_attempt.subject_matter_skipped_at is not null
              )
          )
        )
      )
        and exists (
        select 1
        from pg_catalog.unnest(v_terms) term
        where pg_catalog.lower(coalesce(question.topic, '')) like '%' || term || '%'
           or pg_catalog.lower(question.subject) like '%' || term || '%'
           or pg_catalog.lower(coalesce(question.doctrine, '')) like '%' || term || '%'
           or pg_catalog.lower(placement.course_name) like '%' || term || '%'
      )
    ),
    ranked as (
      select candidate.*,
             pg_catalog.row_number() over (
               partition by candidate.destination
               order by candidate.score desc, candidate.title, candidate.stable_id
             ) as destination_rank
      from (
        select * from doctrine_candidates
        union all
        select * from syllabus_candidates
      ) candidate
    )
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
        'type', destination,
        'title', title,
        'subject', subject,
        'contentId', content_id,
        'versionId', version_id,
        'questionId', question_id
      )) order by score desc, destination, title, stable_id
    )
    from ranked
    where destination_rank <= v_limit
  ), '[]'::jsonb));
end;
$$;

create or replace function public.pedro_complete_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_version integer,
  p_response_kind text,
  p_actions jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_access jsonb;
  v_turn public.pedro_turns%rowtype;
  v_response_kind text := pg_catalog.btrim(coalesce(p_response_kind, ''));
  v_actions jsonb := coalesce(p_actions, '[]'::jsonb);
  v_action_count integer;
  v_response_text text;
  v_action jsonb;
  v_ordinal bigint;
  v_destination text;
  v_content_id text;
  v_version_id uuid;
  v_question_id uuid;
  v_mock_question_id text;
  v_mock_subject text;
begin
  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED';
  end if;

  select turn_record.*
  into v_turn
  from public.pedro_turns turn_record
  where turn_record.id = p_turn_id
    and turn_record.user_id = p_user_id
    and turn_record.access_kind = v_access ->> 'accessKind'
  for update of turn_record;

  if v_turn.id is null then
    raise exception 'PEDRO_TURN_NOT_FOUND';
  end if;
  if v_turn.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'state', 'completed',
      'threadId', v_turn.thread_id,
      'message', public.pedro_message_json(v_turn.id)
    );
  end if;
  if v_turn.status <> 'reserved'
     or p_claim_version is null
     or v_turn.claim_version <> p_claim_version
     or v_turn.lease_expires_at <= v_now
  then
    raise exception 'PEDRO_CLAIM_STALE';
  end if;

  if v_response_kind = '' or v_response_kind not in (
    'greeting',
    'motivation',
    'outside_scope',
    'no_match',
    'match',
    'choose_location',
    'website_help_profile',
    'website_help_study_circles',
    'website_help_syllabus',
    'website_help_doctrine',
    'website_help_mock_bar',
    'website_help_home',
    'website_help_account',
    'website_help_pricing',
    'website_help_pedro'
  ) then
    raise exception 'PEDRO_RESPONSE_KIND_INVALID';
  end if;

  if pg_catalog.jsonb_typeof(v_actions) <> 'array' then
    raise exception 'PEDRO_ACTIONS_INVALID';
  end if;
  v_action_count := pg_catalog.jsonb_array_length(v_actions);
  if v_action_count > 3 then
    raise exception 'PEDRO_ACTIONS_INVALID';
  end if;
  if v_response_kind = 'match' and v_action_count not between 1 and 3 then
    raise exception 'PEDRO_ACTIONS_REQUIRED';
  end if;
  if v_response_kind = 'choose_location' and v_action_count not between 2 and 3 then
    raise exception 'PEDRO_ACTIONS_REQUIRED';
  end if;
  if v_response_kind not in ('match', 'choose_location') and v_action_count <> 0 then
    raise exception 'PEDRO_ACTIONS_NOT_ALLOWED';
  end if;

  v_response_text := case v_response_kind
    when 'greeting' then 'Hi, I''m Pedro. I can help you find material in Syllabus-Based Review, Doctrine Review, or Bar Question Practice.'
    when 'motivation' then 'You''re doing difficult work, one step at a time. I can help you find your next Syllabus-Based Review, Doctrine Review, or Bar Question Practice.'
    when 'outside_scope' then 'I can only help you with due diligence website.'
    when 'no_match' then 'I couldn''t find a published match in Syllabus-Based Review, Doctrine Review, or Bar Question Practice. Try a topic name.'
    when 'match' then 'I found a published Due Diligence match. Open it below.'
    when 'choose_location' then 'I found matching Due Diligence material. Where would you like to test it?'
    when 'website_help_profile' then 'Open Profile, choose Upload profile picture, select your image, and save it. Your saved photo will appear on Home.'
    when 'website_help_study_circles' then 'Open Study Circles from the menu, then choose Create study circle or join an available circle.'
    when 'website_help_syllabus' then 'Open Syllabus-Based Review from the menu, then choose a published subject or search for a topic.'
    when 'website_help_doctrine' then 'Open Doctrine Review from the menu, then search or choose a published doctrine.'
    when 'website_help_mock_bar' then 'Open Bar Question Practice from the menu to practice with a published Bar question.'
    when 'website_help_home' then 'Open Home from the main menu to return to your Due Diligence study dashboard.'
    when 'website_help_account' then 'Open Profile from the account menu to review your Due Diligence account information.'
    when 'website_help_pricing' then 'Open Plans & Pricing from the menu to review the subscription options currently shown on DueDiligence.ph.'
    else 'Ask Pedro for a topic, then choose Doctrine Review, Syllabus-Based Review, or Bar Question Practice when Pedro offers them.'
  end;

  delete from public.pedro_actions
  where turn_id = v_turn.id;

  for v_action, v_ordinal in
    select action_item.value, action_item.ordinality
    from pg_catalog.jsonb_array_elements(v_actions) with ordinality action_item(value, ordinality)
  loop
    if pg_catalog.jsonb_typeof(v_action) <> 'object' then
      raise exception 'PEDRO_ACTIONS_INVALID';
    end if;

    v_destination := pg_catalog.lower(pg_catalog.btrim(coalesce(v_action ->> 'type', '')));
    v_content_id := nullif(pg_catalog.btrim(v_action ->> 'contentId'), '');
    v_version_id := null;
    v_question_id := null;
    v_mock_question_id := nullif(pg_catalog.btrim(v_action ->> 'questionId'), '');
    v_mock_subject := nullif(pg_catalog.btrim(v_action ->> 'subject'), '');

    if v_destination = 'doctrine' then
      if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_action) as action_keys(action_key)
        where action_key not in ('type', 'contentId')
      ) then
        raise exception 'PEDRO_ACTIONS_INVALID';
      end if;
      if v_content_id is null or not exists (
        select 1
        from public.dd2026_content_items item
        join public.dd2026_content_versions version
          on version.id = item.current_published_version_id
         and version.content_id = item.id
         and version.lifecycle_state = 'published'
        where item.id = v_content_id
          and item.content_type = 'doctrine'
      ) then
        raise exception 'PEDRO_DOCTRINE_TARGET_INVALID';
      end if;
    elsif v_destination = 'syllabus' then
      if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_action) as action_keys(action_key)
        where action_key not in ('type', 'versionId', 'questionId')
      ) then
        raise exception 'PEDRO_ACTIONS_INVALID';
      end if;
      begin
        v_version_id := (v_action ->> 'versionId')::uuid;
        v_question_id := (v_action ->> 'questionId')::uuid;
      exception when invalid_text_representation then
        raise exception 'PEDRO_SYLLABUS_TARGET_INVALID';
      end;
      v_mock_question_id := null;
      if not exists (
        select 1
        from public.examination_versions version
        join public.examination_definitions definition
          on definition.id = version.exam_id
         and definition.active_version_id = version.id
         and definition.track = 'per_subject'
         and definition.assessment_kind = 'quiz'
         and definition.status = 'published'
        join public.examination_version_questions version_question
          on version_question.version_id = version.id
         and version_question.question_id = v_question_id
        join public.subject_matter_placements placement
          on placement.exam_id = definition.id
         and placement.question_id = v_question_id
        join public.examination_questions question
          on question.id = version_question.question_id
         and question.source_type = 'google_sheet'
         and question.review_status = 'approved'
         and question.publication_ready = true
        where version.id = v_version_id
          and version.status = 'published'
          and version.question_count = 1
      ) then
        raise exception 'PEDRO_SYLLABUS_TARGET_INVALID';
      end if;
    elsif v_destination = 'mock_bar' then
      if exists (
        select 1
        from pg_catalog.jsonb_object_keys(v_action) as action_keys(action_key)
        where action_key not in ('type', 'questionId', 'subject')
      ) then
        raise exception 'PEDRO_ACTIONS_INVALID';
      end if;
      if v_mock_question_id is null
         or pg_catalog.char_length(v_mock_question_id) not between 1 and 128
         or v_mock_question_id !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
         or v_mock_subject is null
         or pg_catalog.char_length(v_mock_subject) not between 2 and 120
         or v_mock_subject !~ '^[[:alnum:]][[:alnum:] .,&()''/-]{1,119}$'
      then
        raise exception 'PEDRO_MOCK_TARGET_INVALID';
      end if;
    else
      raise exception 'PEDRO_ACTION_DESTINATION_INVALID';
    end if;

    insert into public.pedro_actions (
      turn_id,
      user_id,
      ordinal,
      destination,
      doctrine_content_id,
      syllabus_version_id,
      syllabus_question_id,
      mock_question_id,
      mock_subject
    ) values (
      v_turn.id,
      p_user_id,
      v_ordinal::smallint,
      v_destination,
      case when v_destination = 'doctrine' then v_content_id end,
      case when v_destination = 'syllabus' then v_version_id end,
      case when v_destination = 'syllabus' then v_question_id end,
      case when v_destination = 'mock_bar' then v_mock_question_id end,
      case when v_destination = 'mock_bar' then v_mock_subject end
    );
  end loop;

  update public.pedro_turns
  set status = 'completed',
      response_kind = v_response_kind,
      response_text = v_response_text,
      failure_class = null,
      lease_expires_at = null,
      completed_at = v_now,
      updated_at = v_now
  where id = v_turn.id
  returning * into v_turn;

  update public.pedro_threads
  set updated_at = v_now,
      last_message_at = v_now
  where id = v_turn.thread_id;

  return pg_catalog.jsonb_build_object(
    'state', 'completed',
    'threadId', v_turn.thread_id,
    'message', public.pedro_message_json(v_turn.id)
  );
end;
$$;

create or replace function public.pedro_fail_turn(
  p_user_id uuid,
  p_turn_id uuid,
  p_claim_version integer,
  p_failure_class text,
  p_retryable boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_failure_class text := pg_catalog.btrim(coalesce(p_failure_class, ''));
  v_turn public.pedro_turns%rowtype;
  v_status text;
begin
  v_failure_class := case v_failure_class
    when 'capacity' then 'provider_unavailable'
    when 'timeout' then 'provider_unavailable'
    when 'unavailable' then 'provider_unavailable'
    when 'persistence_unavailable' then 'internal_retryable'
    when 'search_unavailable' then 'search_unavailable'
    when 'provider_unavailable' then 'provider_unavailable'
    when 'provider_invalid' then 'provider_invalid'
    when 'configuration_missing' then 'configuration_missing'
    when 'internal_retryable' then 'internal_retryable'
    when 'internal_terminal' then 'internal_terminal'
    else case when coalesce(p_retryable, true)
      then 'internal_retryable'
      else 'internal_terminal'
    end
  end;

  select turn_record.*
  into v_turn
  from public.pedro_turns turn_record
  where turn_record.id = p_turn_id
    and turn_record.user_id = p_user_id
  for update of turn_record;

  if v_turn.id is null then
    raise exception 'PEDRO_TURN_NOT_FOUND';
  end if;
  if v_turn.status = 'completed' then
    return pg_catalog.jsonb_build_object(
      'state', 'completed',
      'threadId', v_turn.thread_id,
      'message', public.pedro_message_json(v_turn.id)
    );
  end if;
  if v_turn.status <> 'reserved'
     or p_claim_version is null
     or v_turn.claim_version <> p_claim_version
  then
    raise exception 'PEDRO_CLAIM_STALE';
  end if;

  v_status := case
    when not coalesce(p_retryable, true) or v_turn.attempt_count >= 3
      then 'failed_terminal'
    else 'failed_retryable'
  end;

  update public.pedro_turns
  set status = v_status,
      failure_class = case
        when v_status = 'failed_terminal' and v_failure_class = 'internal_retryable'
          then 'internal_terminal'
        else v_failure_class
      end,
      lease_expires_at = null,
      updated_at = v_now
  where id = v_turn.id
  returning * into v_turn;

  return pg_catalog.jsonb_build_object(
    'state', v_status,
    'threadId', v_turn.thread_id,
    'turnId', v_turn.id
  );
end;
$$;

create or replace function public.pedro_history(
  p_user_id uuid,
  p_thread_id uuid,
  p_limit integer,
  p_before_created_at timestamptz,
  p_before_turn_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_thread public.pedro_threads%rowtype;
  v_cursor_turn public.pedro_turns%rowtype;
  v_cursor_created_at timestamptz;
  v_message_limit integer := pg_catalog.least(pg_catalog.greatest(coalesce(p_limit, 50), 1), 50);
  v_turn_limit integer;
  v_messages jsonb;
begin
  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED:%', coalesce(v_access ->> 'reason', 'denied');
  end if;

  if (p_before_created_at is null) <> (p_before_turn_id is null) then
    raise exception 'PEDRO_HISTORY_CURSOR_INVALID';
  end if;

  if p_thread_id is null then
    insert into public.pedro_threads (user_id, access_kind)
    values (p_user_id, v_access ->> 'accessKind')
    on conflict (user_id, access_kind) do nothing;

    select thread_record.*
    into v_thread
    from public.pedro_threads thread_record
    where thread_record.user_id = p_user_id
      and thread_record.access_kind = v_access ->> 'accessKind';
  else
    select thread_record.*
    into v_thread
    from public.pedro_threads thread_record
    where thread_record.id = p_thread_id
      and thread_record.user_id = p_user_id
      and thread_record.access_kind = v_access ->> 'accessKind';

    if v_thread.id is null then
      raise exception 'PEDRO_THREAD_INVALID';
    end if;
  end if;

  if p_before_turn_id is not null then
    select turn_record.*
    into v_cursor_turn
    from public.pedro_turns turn_record
    where turn_record.id = p_before_turn_id
      and turn_record.thread_id = v_thread.id
      and turn_record.user_id = p_user_id
      and turn_record.access_kind = v_access ->> 'accessKind'
      and turn_record.status = 'completed';

    if v_cursor_turn.id is null then
      raise exception 'PEDRO_HISTORY_CURSOR_INVALID';
    end if;
    v_cursor_created_at := v_cursor_turn.created_at;
  end if;

  v_turn_limit := pg_catalog.greatest(1, pg_catalog.floor(v_message_limit::numeric / 2)::integer);

  with selected_turns as (
    select turn_record.*
    from public.pedro_turns turn_record
    where turn_record.thread_id = v_thread.id
      and turn_record.status = 'completed'
      and (
        v_cursor_created_at is null
        or (turn_record.created_at, turn_record.id)
          < (v_cursor_created_at, p_before_turn_id)
      )
    order by turn_record.created_at desc, turn_record.id desc
    limit v_turn_limit
  ),
  flattened as (
    select
      selected_turn.id::text || ':user' as id,
      'user'::text as role,
      selected_turn.input_text as text,
      '[]'::jsonb as actions,
      selected_turn.created_at as created_at,
      selected_turn.created_at as turn_created_at,
      0 as message_order
    from selected_turns selected_turn
    union all
    select
      selected_turn.id::text as id,
      'pedro'::text as role,
      selected_turn.response_text as text,
      coalesce((
        select pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'id', action_record.id,
            'type', action_record.destination,
            'label', case action_record.destination
              when 'doctrine' then 'Open Doctrine Review'
              when 'syllabus' then 'Open Syllabus-Based Review'
              else 'Open Bar Question Practice'
            end
          ) order by action_record.ordinal
        )
        from public.pedro_actions action_record
        where action_record.turn_id = selected_turn.id
      ), '[]'::jsonb) as actions,
      selected_turn.completed_at as created_at,
      selected_turn.created_at as turn_created_at,
      1 as message_order
    from selected_turns selected_turn
  ),
  limited_messages as (
    select flattened.*
    from flattened
    where v_message_limit > 1 or flattened.role = 'pedro'
    order by flattened.turn_created_at desc, flattened.message_order desc
    limit v_message_limit
  )
  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', id,
      'role', role,
      'text', text,
      'actions', actions,
      'createdAt', created_at
    ) order by turn_created_at, message_order, id
  ), '[]'::jsonb)
  into v_messages
  from limited_messages;

  return pg_catalog.jsonb_build_object(
    'threadId', v_thread.id,
    'accessKind', v_access ->> 'accessKind',
    'testMode', coalesce((v_access ->> 'testMode')::boolean, false),
    'messages', v_messages
  );
end;
$$;

create or replace function public.subject_matter_target_question(
  p_user_id uuid,
  p_version_id uuid,
  p_question_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_access jsonb;
  v_placement public.subject_matter_placements%rowtype;
  v_definition public.examination_definitions%rowtype;
  v_version public.examination_versions%rowtype;
  v_cycle public.subject_matter_cycles%rowtype;
  v_open_attempt_id uuid;
begin
  if p_user_id is null or p_version_id is null or p_question_id is null then
    raise exception 'PEDRO_SYLLABUS_TARGET_INVALID';
  end if;

  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED:%', coalesce(v_access ->> 'reason', 'denied');
  end if;

  perform public.examination_authorize_access(
    p_user_id,
    'per_subject',
    p_version_id,
    null,
    false
  );

  select placement, definition, version
  into v_placement, v_definition, v_version
  from public.subject_matter_placements placement
  join public.examination_definitions definition
    on definition.id = placement.exam_id
   and definition.track = 'per_subject'
   and definition.assessment_kind = 'quiz'
   and definition.status = 'published'
  join public.examination_versions version
    on version.id = definition.active_version_id
   and version.status = 'published'
   and version.question_count = 1
  join public.examination_version_questions version_question
    on version_question.version_id = version.id
   and version_question.question_id = placement.question_id
  join public.examination_questions question
    on question.id = version_question.question_id
   and question.source_type = 'google_sheet'
   and question.review_status = 'approved'
   and question.publication_ready = true
  where version.id = p_version_id
    and question.id = p_question_id
  limit 1;

  if v_placement.exam_id is null or v_definition.id is null or v_version.id is null then
    raise exception 'PEDRO_SYLLABUS_TARGET_STALE';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'subject-cycle:' || p_user_id::text || ':' || v_placement.course_name
      || ':' || v_placement.year_level::text || ':' || v_placement.term::text,
    0
  ));

  insert into public.subject_matter_cycles (
    user_id,
    subject,
    year_level,
    term
  ) values (
    p_user_id,
    v_placement.course_name,
    v_placement.year_level,
    v_placement.term
  )
  on conflict (user_id, subject, year_level, term) do nothing;

  select cycle.*
  into v_cycle
  from public.subject_matter_cycles cycle
  where cycle.user_id = p_user_id
    and cycle.subject = v_placement.course_name
    and cycle.year_level = v_placement.year_level
    and cycle.term = v_placement.term
  for update of cycle;

  select attempt.id
  into v_open_attempt_id
  from public.examination_attempts_multi attempt
  where attempt.user_id = p_user_id
    and attempt.version_id = p_version_id
    and attempt.status in ('in_progress', 'review')
    and attempt.submitted_at is null
  order by attempt.started_at desc
  limit 1
  for update of attempt;

  if exists (
    select 1
    from public.examination_attempts_multi active_attempt
    join public.examination_versions active_version
      on active_version.id = active_attempt.version_id
    join public.examination_definitions active_definition
      on active_definition.id = active_version.exam_id
    join public.examination_version_questions active_version_question
      on active_version_question.version_id = active_version.id
    join public.subject_matter_placements active_placement
      on active_placement.exam_id = active_definition.id
     and active_placement.question_id = active_version_question.question_id
    where active_attempt.user_id = p_user_id
      and active_attempt.status in ('in_progress', 'review')
      and active_attempt.submitted_at is null
      and active_placement.course_name = v_placement.course_name
      and active_placement.year_level = v_placement.year_level
      and active_placement.term = v_placement.term
      and active_attempt.version_id <> p_version_id
  ) then
    raise exception 'PEDRO_SYLLABUS_ACTIVE_ATTEMPT';
  end if;

  if v_open_attempt_id is null and (
    p_question_id = any(v_cycle.seen_question_ids)
    or exists (
      select 1
      from public.examination_attempts_multi history_attempt
      join public.examination_versions history_version
        on history_version.id = history_attempt.version_id
      join public.examination_definitions history_definition
        on history_definition.id = history_version.exam_id
      join public.examination_version_questions history_version_question
        on history_version_question.version_id = history_version.id
       and history_version_question.question_id = p_question_id
      join public.subject_matter_placements history_placement
        on history_placement.exam_id = history_definition.id
       and history_placement.question_id = p_question_id
      left join public.examination_responses history_response
        on history_response.attempt_id = history_attempt.id
       and history_response.question_id = p_question_id
      where history_attempt.user_id = p_user_id
        and history_placement.course_name = v_placement.course_name
        and history_placement.year_level = v_placement.year_level
        and history_placement.term = v_placement.term
        and (
          pg_catalog.btrim(coalesce(history_response.answer_text, '')) <> ''
          or history_attempt.subject_matter_skipped_at is not null
        )
    )
  ) then
    raise exception 'PEDRO_SYLLABUS_TARGET_ALREADY_USED';
  end if;

  update public.subject_matter_cycles
  set active_version_id = p_version_id,
      updated_at = v_now
  where user_id = p_user_id
    and subject = v_placement.course_name
    and year_level = v_placement.year_level
    and term = v_placement.term;

  return pg_catalog.jsonb_build_object(
    'subject', v_placement.course_name,
    'yearLevel', v_placement.year_level,
    'term', v_placement.term,
    'versionId', p_version_id,
    'questionId', p_question_id,
    'resumeAttemptId', v_open_attempt_id,
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

create or replace function public.pedro_resolve_action(
  p_user_id uuid,
  p_action_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_access jsonb;
  v_action public.pedro_actions%rowtype;
  v_target jsonb;
  v_syllabus_selection jsonb;
begin
  v_access := public.pedro_access_snapshot(p_user_id);
  if not coalesce((v_access ->> 'allowed')::boolean, false) then
    raise exception 'PEDRO_ACCESS_REQUIRED:%', coalesce(v_access ->> 'reason', 'denied');
  end if;

  select action_record.*
  into v_action
  from public.pedro_actions action_record
  join public.pedro_turns turn_record
    on turn_record.id = action_record.turn_id
   and turn_record.user_id = action_record.user_id
   and turn_record.status = 'completed'
  where action_record.id = p_action_id
    and action_record.user_id = p_user_id
    and turn_record.access_kind = v_access ->> 'accessKind';

  if v_action.id is null then
    raise exception 'PEDRO_ACTION_NOT_FOUND';
  end if;

  if v_action.destination = 'doctrine' then
    if not exists (
      select 1
      from public.dd2026_content_items item
      join public.dd2026_content_versions version
        on version.id = item.current_published_version_id
       and version.content_id = item.id
       and version.lifecycle_state = 'published'
      where item.id = v_action.doctrine_content_id
        and item.content_type = 'doctrine'
    ) then
      raise exception 'PEDRO_ACTION_STALE';
    end if;
    v_target := pg_catalog.jsonb_build_object(
      'contentId', v_action.doctrine_content_id
    );
  elsif v_action.destination = 'syllabus' then
    v_syllabus_selection := public.subject_matter_target_question(
      p_user_id,
      v_action.syllabus_version_id,
      v_action.syllabus_question_id
    );
    v_target := pg_catalog.jsonb_build_object(
      'versionId', v_syllabus_selection -> 'versionId',
      'questionId', v_syllabus_selection -> 'questionId'
    );
  else
    v_target := pg_catalog.jsonb_build_object(
      'questionId', v_action.mock_question_id,
      'subject', v_action.mock_subject
    );
  end if;

  return pg_catalog.jsonb_build_object(
    'action', pg_catalog.jsonb_build_object(
      'id', v_action.id,
      'type', v_action.destination,
      'target', v_target
    )
  );
end;
$$;

revoke all on function public.pedro_access_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.pedro_message_json(uuid)
  from public, anon, authenticated;
revoke all on function public.pedro_reserve_turn(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.pedro_search_published_content(uuid, uuid, integer, text[], integer)
  from public, anon, authenticated;
revoke all on function public.pedro_complete_turn(uuid, uuid, integer, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.pedro_fail_turn(uuid, uuid, integer, text, boolean)
  from public, anon, authenticated;
revoke all on function public.pedro_history(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.subject_matter_target_question(uuid, uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.pedro_resolve_action(uuid, uuid)
  from public, anon, authenticated;

grant execute on function public.pedro_access_snapshot(uuid) to service_role;
grant execute on function public.pedro_message_json(uuid) to service_role;
grant execute on function public.pedro_reserve_turn(uuid, uuid, text, text) to service_role;
grant execute on function public.pedro_search_published_content(uuid, uuid, integer, text[], integer) to service_role;
grant execute on function public.pedro_complete_turn(uuid, uuid, integer, text, jsonb) to service_role;
grant execute on function public.pedro_fail_turn(uuid, uuid, integer, text, boolean) to service_role;
grant execute on function public.pedro_history(uuid, uuid, integer, timestamptz, uuid) to service_role;
grant execute on function public.subject_matter_target_question(uuid, uuid, uuid) to service_role;
grant execute on function public.pedro_resolve_action(uuid, uuid) to service_role;

comment on function public.pedro_access_snapshot(uuid)
  is 'Strict Pedro entitlement: current legal acceptance plus approved manual-payment subscription, or Founder/Super Admin test access.';
comment on function public.pedro_complete_turn(uuid, uuid, integer, text, jsonb)
  is 'Completes a Pedro turn with server-authored copy and validated owner-bound actions; model-authored response text is never accepted.';
comment on function public.pedro_resolve_action(uuid, uuid)
  is 'Resolves an opaque Pedro action only for its owner after current access and publication checks.';

commit;
