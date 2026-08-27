-- Due Diligence Release 2: PostgreSQL conditional expressions cannot be
-- schema-qualified. Reinstall only the three Pedro functions affected by the
-- original pg_catalog.GREATEST/LEAST qualification defect.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '180s';

do $pedro_conditional_expression_preflight$
begin
  if pg_catalog.to_regprocedure(
       'public.pedro_reserve_turn(uuid,uuid,text,text)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.pedro_search_published_content(uuid,uuid,integer,text[],integer)'
     ) is null
     or pg_catalog.to_regprocedure(
       'public.pedro_history(uuid,uuid,integer,timestamptz,uuid)'
     ) is null then
    raise exception using
      errcode = '55000',
      message = 'Pedro conditional-expression fix requires the Release 2 Pedro functions';
  end if;
end;
$pedro_conditional_expression_preflight$;

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
      v_retry_after_seconds := least(
        60,
        greatest(
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
      v_retry_after_seconds := least(
        60,
        greatest(
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
    v_retry_after_seconds := least(
      60,
      greatest(
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
  v_limit integer := least(greatest(coalesce(p_limit, 4), 1), 4);
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
  v_message_limit integer := least(greatest(coalesce(p_limit, 50), 1), 50);
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

  v_turn_limit := greatest(1, pg_catalog.floor(v_message_limit::numeric / 2)::integer);

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

revoke all on function public.pedro_reserve_turn(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.pedro_search_published_content(uuid, uuid, integer, text[], integer)
  from public, anon, authenticated;
revoke all on function public.pedro_history(uuid, uuid, integer, timestamptz, uuid)
  from public, anon, authenticated;

grant execute on function public.pedro_reserve_turn(uuid, uuid, text, text)
  to service_role;
grant execute on function public.pedro_search_published_content(uuid, uuid, integer, text[], integer)
  to service_role;
grant execute on function public.pedro_history(uuid, uuid, integer, timestamptz, uuid)
  to service_role;

do $pedro_conditional_expression_postflight$
declare
  function_signature text;
  function_oid regprocedure;
  function_definition text;
begin
  foreach function_signature in array array[
    'public.pedro_reserve_turn(uuid,uuid,text,text)',
    'public.pedro_search_published_content(uuid,uuid,integer,text[],integer)',
    'public.pedro_history(uuid,uuid,integer,timestamptz,uuid)'
  ]::text[]
  loop
    function_oid := pg_catalog.to_regprocedure(function_signature);
    function_definition := pg_catalog.lower(
      pg_catalog.pg_get_functiondef(function_oid)
    );

    if function_oid is null
       or pg_catalog.strpos(function_definition, 'pg_catalog.greatest(') > 0
       or pg_catalog.strpos(function_definition, 'pg_catalog.least(') > 0
       or not exists (
         select 1
         from pg_catalog.pg_proc function_record
         where function_record.oid = function_oid
           and function_record.prosecdef
           and coalesce(function_record.proconfig, '{}'::text[])
             @> array['search_path=""']::text[]
       )
       or pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
       or pg_catalog.has_function_privilege(
         'authenticated',
         function_oid,
         'EXECUTE'
       )
       or not pg_catalog.has_function_privilege(
         'service_role',
         function_oid,
         'EXECUTE'
       ) then
      raise exception using
        errcode = '55000',
        message = 'Pedro conditional-expression postflight failed for '
          || function_signature;
    end if;
  end loop;
end;
$pedro_conditional_expression_postflight$;

commit;
