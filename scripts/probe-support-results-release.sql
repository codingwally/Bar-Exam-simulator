\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $support_results_probe$
declare
  v_admin uuid;
  v_requester uuid;
  v_nonadmin uuid := gen_random_uuid();
  v_requester_email text;
  v_case_id uuid := gen_random_uuid();
  v_request_key text := 'supportresults' || replace(gen_random_uuid()::text, '-', '');
  v_result jsonb;
  v_item jsonb;
  v_conflict_rejected boolean := false;
  v_nonadmin_rejected boolean := false;
begin
  select role_row.user_id, account.email
  into v_admin, v_requester_email
  from public.user_roles role_row
  join auth.users account
    on account.id = role_row.user_id
  where public.admin_has_capability(role_row.user_id, 'support_admin')
  order by role_row.user_id
  limit 1;

  if v_admin is null then
    raise exception 'SUPPORT_RESULTS_PROBE_ACTOR_MISSING';
  end if;
  v_requester := v_admin;

  while exists (select 1 from auth.users account where account.id = v_nonadmin) loop
    v_nonadmin := gen_random_uuid();
  end loop;

  insert into public.support_requests (
    id,
    user_id,
    category,
    message,
    reply_email,
    status,
    priority
  ) values (
    v_case_id,
    v_requester,
    'technical',
    'Rollback-only support results release verification.',
    'support-results-release@example.invalid',
    'pending',
    'normal'
  );

  v_result := public.admin_support_queue_v1(
    v_admin,
    v_case_id::text,
    10,
    0,
    v_request_key
  );
  if v_result is null
     or jsonb_typeof(v_result) is distinct from 'object'
     or jsonb_typeof(v_result->'items') is distinct from 'array'
  then
    raise exception 'SUPPORT_RESULTS_PROBE_IDENTITY_SHAPE_FAILED';
  end if;

  if jsonb_array_length(v_result->'items') <> 1 then
    raise exception 'SUPPORT_RESULTS_PROBE_IDENTITY_COUNT_FAILED';
  end if;
  v_item := v_result->'items'->0;

  if jsonb_typeof(v_item) is distinct from 'object'
     or v_item->>'id' is distinct from v_case_id::text
     or v_item->>'user_id' is distinct from v_requester::text
     or v_item->>'account_email' is distinct from v_requester_email
     or not (v_item ?& array[
       'display_name',
       'account_claimed_name',
       'account_email',
       'reply_email',
       'contact_email'
     ])
  then
    raise exception 'SUPPORT_RESULTS_PROBE_IDENTITY_FAILED';
  end if;

  perform public.admin_support_queue_v1(
    v_admin,
    v_case_id::text,
    10,
    0,
    v_request_key
  );

  if (
    select count(*)
    from public.admin_audit_log audit_row
    where audit_row.actor_user_id = v_admin
      and audit_row.target_resource_type = 'admin_support_queue_v1'
      and audit_row.details->>'requestKey' = v_request_key
  ) <> 1 then
    raise exception 'SUPPORT_RESULTS_PROBE_AUDIT_IDEMPOTENCY_FAILED';
  end if;

  begin
    perform public.admin_support_queue_v1(
      v_admin,
      'different-search',
      10,
      0,
      v_request_key
    );
  exception when others then
    if sqlerrm like '%request key conflict%' then
      v_conflict_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_conflict_rejected then
    raise exception 'SUPPORT_RESULTS_PROBE_REQUEST_KEY_CONFLICT_ACCEPTED';
  end if;

  begin
    perform public.admin_support_queue_v1(
      v_nonadmin,
      null,
      10,
      0,
      'supportresultsnonadmin'
    );
  exception when others then
    if lower(sqlerrm) like '%authorization%'
       or lower(sqlerrm) like '%capability%'
    then
      v_nonadmin_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_nonadmin_rejected then
    raise exception 'SUPPORT_RESULTS_PROBE_NONADMIN_ACCEPTED';
  end if;
end
$support_results_probe$;

do $support_history_probe$
declare
  v_empty_owner uuid := gen_random_uuid();
  v_owner uuid;
  v_track text;
  v_other_attempt uuid;
  v_result jsonb;
  v_item jsonb;
  v_invalid_rejected boolean := false;
begin
  while exists (
    select 1
    from public.examination_attempts_multi attempt
    where attempt.user_id = v_empty_owner
  ) loop
    v_empty_owner := gen_random_uuid();
  end loop;

  v_result := public.examination_history_by_track_v1(
    v_empty_owner,
    'per_subject',
    10,
    0
  );

  if v_result is null
     or jsonb_typeof(v_result) is distinct from 'object'
     or jsonb_typeof(v_result->'items') is distinct from 'array'
  then
    raise exception 'SUPPORT_RESULTS_PROBE_EMPTY_OWNER_SHAPE_FAILED';
  end if;

  if v_result->>'track' is distinct from 'per_subject'
     or coalesce((v_result->>'total')::bigint, -1) <> 0
     or jsonb_array_length(v_result->'items') <> 0
     or coalesce((v_result->>'hasMore')::boolean, true)
  then
    raise exception 'SUPPORT_RESULTS_PROBE_EMPTY_OWNER_HISTORY_FAILED';
  end if;

  select sample.user_id, sample.track
  into v_owner, v_track
  from (
    select attempt.user_id, definition.track, count(*) as attempt_count
    from public.examination_attempts_multi attempt
    join public.examination_versions version
      on version.id = attempt.version_id
    join public.examination_definitions definition
      on definition.id = version.exam_id
    where definition.track in ('per_subject', 'bar_feels')
    group by attempt.user_id, definition.track
    order by count(*) desc, attempt.user_id, definition.track
    limit 1
  ) sample;

  if v_owner is not null then
    select attempt.id
    into v_other_attempt
    from public.examination_attempts_multi attempt
    join public.examination_versions version
      on version.id = attempt.version_id
    join public.examination_definitions definition
      on definition.id = version.exam_id
    where definition.track = v_track
      and attempt.user_id <> v_owner
    order by attempt.started_at desc, attempt.id desc
    limit 1;

    v_result := public.examination_history_by_track_v1(
      v_owner,
      v_track,
      100,
      0
    );

    if v_result is null
       or jsonb_typeof(v_result) is distinct from 'object'
       or jsonb_typeof(v_result->'items') is distinct from 'array'
    then
      raise exception 'SUPPORT_RESULTS_PROBE_HISTORY_SHAPE_FAILED';
    end if;

    if v_result->>'track' is distinct from v_track
       or coalesce((v_result->>'total')::bigint, -1) <> (
         select count(*)
         from public.examination_attempts_multi attempt
         join public.examination_versions version
           on version.id = attempt.version_id
         join public.examination_definitions definition
           on definition.id = version.exam_id
         where attempt.user_id = v_owner
           and definition.track = v_track
       )
    then
      raise exception 'SUPPORT_RESULTS_PROBE_HISTORY_TOTAL_FAILED';
    end if;

    for v_item in
      select value
      from jsonb_array_elements(v_result->'items')
    loop
      if jsonb_typeof(v_item) is distinct from 'object'
         or not exists (
           select 1
           from public.examination_attempts_multi attempt
           join public.examination_versions version
             on version.id = attempt.version_id
           join public.examination_definitions definition
             on definition.id = version.exam_id
           where attempt.id = (v_item->>'attemptId')::uuid
             and attempt.user_id = v_owner
             and definition.track = v_track
         )
      then
        raise exception 'SUPPORT_RESULTS_PROBE_CROSS_OWNER_HISTORY';
      end if;

      if coalesce((v_item->>'answeredCount')::bigint, -1) <> (
        select count(*)
        from public.examination_responses response
        where response.attempt_id = (v_item->>'attemptId')::uuid
          and nullif(btrim(response.answer_text), '') is not null
      ) then
        raise exception 'SUPPORT_RESULTS_PROBE_ANSWER_COUNT_FAILED';
      end if;
    end loop;

    if v_other_attempt is not null
       and exists (
         select 1
         from jsonb_array_elements(v_result->'items') as history_item(value)
         where history_item.value->>'attemptId' = v_other_attempt::text
       )
    then
      raise exception 'SUPPORT_RESULTS_PROBE_OTHER_OWNER_ATTEMPT_RETURNED';
    end if;
  end if;

  begin
    perform public.examination_history_by_track_v1(
      v_empty_owner,
      'unsupported-track',
      10,
      0
    );
  exception when others then
    if sqlerrm like '%EXAM_QUERY_INVALID%' then
      v_invalid_rejected := true;
    else
      raise;
    end if;
  end;

  if not v_invalid_rejected then
    raise exception 'SUPPORT_RESULTS_PROBE_INVALID_TRACK_ACCEPTED';
  end if;
end
$support_history_probe$;

rollback;
