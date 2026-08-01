-- Plain-language Admin business details for users, activity, subscriptions,
-- answers, and Quorum moderation. This is an additive reporting layer only:
-- it does not change authentication, Beta All Access, grading, questions, or
-- any learner-facing simulator route.

begin;

create or replace function public.admin_subscription_category(
  p_user_id uuid
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when coalesce((
      select r.role
      from public.user_roles r
      where r.user_id = p_user_id
    ), 'student') in ('admin', 'founder_admin', 'super_admin')
      then 'Admin & Staff'
    when exists (
      select 1
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.plan_code = 'premium'
        and s.status = 'active'
        and coalesce(s.starts_at, now()) <= now()
        and (s.expires_at is null or s.expires_at > now())
    ) then 'Premium'
    when exists (
      select 1
      from public.subscriptions s
      where s.user_id = p_user_id
        and s.plan_code <> 'premium'
        and s.status = 'active'
        and coalesce(s.starts_at, now()) <= now()
        and (s.expires_at is null or s.expires_at > now())
    ) then 'Regular'
    when coalesce((
      select r.role = 'beta_tester'
      from public.user_roles r
      where r.user_id = p_user_id
    ), false)
      or coalesce((
        select s.global_beta_all_access_enabled
        from public.platform_access_settings s
        where s.singleton = true
      ), false)
      then 'Beta Tester'
    else 'Regular'
  end
$$;

create or replace function public.admin_user_score_summary()
returns table (
  user_id uuid,
  graded_answer_count bigint,
  average_score numeric,
  latest_score numeric,
  last_graded_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with practice_scores as (
    select
      a.user_id,
      a.score::numeric as score,
      coalesce(a.completed_at, a.submitted_at) as graded_at
    from public.exam_attempts a
    join auth.users u on u.id = a.user_id
    where a.score is not null
      and nullif(btrim(a.answer_text), '') is not null
      and coalesce(u.is_anonymous, false) = false
  ), formal_scores as (
    select
      a.user_id,
      case
        when hr.finalized_at is not null then hr.score
        else aa.score
      end::numeric as score,
      case
        when hr.finalized_at is not null then hr.finalized_at
        else aa.finalized_at
      end as graded_at
    from public.examination_responses r
    join public.examination_attempts_multi a on a.id = r.attempt_id
    join auth.users u on u.id = a.user_id
    left join public.examination_ai_assessments aa
      on aa.attempt_id = a.id
     and aa.question_id = r.question_id
    left join lateral (
      select er.score, er.finalized_at
      from public.examination_examiner_assignments ea
      join public.examination_examiner_reviews er
        on er.assignment_id = ea.id
       and er.question_id = r.question_id
      where ea.attempt_id = a.id
      order by
        (er.finalized_at is not null) desc,
        er.finalized_at desc nulls last,
        er.saved_at desc,
        ea.created_at desc
      limit 1
    ) hr on true
    where nullif(btrim(r.answer_text), '') is not null
      and case
        when hr.finalized_at is not null then hr.score
        else aa.score
      end is not null
      and coalesce(u.is_anonymous, false) = false
  ), all_scores as (
    select * from practice_scores
    union all
    select * from formal_scores
  )
  select
    s.user_id,
    count(*)::bigint,
    round(avg(s.score), 1),
    (array_agg(s.score order by s.graded_at desc))[1],
    max(s.graded_at)
  from all_scores s
  group by s.user_id
$$;

create or replace function public.admin_overview_engagement_metrics(
  p_actor_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_signed_in_accounts bigint := 0;
  v_users_with_answers bigint := 0;
  v_questions_answered bigint := 0;
  v_practice_answered bigint := 0;
  v_examination_answered bigint := 0;
  v_active_5 bigint := 0;
  v_active_30 bigint := 0;
  v_open_quorum_reports bigint := 0;
  v_subscription_counts jsonb := '{}'::jsonb;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;

  select count(*) into v_signed_in_accounts
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
    and u.last_sign_in_at is not null;

  select
    count(*)::bigint,
    coalesce(sum(c.answered_question_count), 0)::bigint,
    coalesce(sum(c.practice_answered), 0)::bigint,
    coalesce(sum(c.examination_answered), 0)::bigint
  into
    v_users_with_answers,
    v_questions_answered,
    v_practice_answered,
    v_examination_answered
  from public.admin_user_answer_counts() c;

  select count(*) into v_active_5
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '5 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false;

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false;

  select count(*) into v_open_quorum_reports
  from public.forum_reports r
  where r.status = 'pending';

  select coalesce(jsonb_object_agg(c.category, c.total), '{}'::jsonb)
    into v_subscription_counts
  from (
    select
      public.admin_subscription_category(u.id) as category,
      count(*)::bigint as total
    from auth.users u
    where coalesce(u.is_anonymous, false) = false
    group by public.admin_subscription_category(u.id)
  ) c;

  return jsonb_build_object(
    'scope', 'all_time',
    'generatedAt', now(),
    'signedInAccounts', v_signed_in_accounts,
    'usersWithAnswers', v_users_with_answers,
    'questionsAnswered', v_questions_answered,
    'practiceQuestionsAnswered', v_practice_answered,
    'examinationQuestionsAnswered', v_examination_answered,
    'activeSignedInLast5Minutes', v_active_5,
    'activeSignedInLast30Minutes', v_active_30,
    'openQuorumReports', v_open_quorum_reports,
    'subscriptionCounts', v_subscription_counts,
    'definition',
      'Persisted non-blank practice answers plus persisted non-blank formal-examination responses.'
  );
end;
$$;

create or replace function public.admin_user_engagement_directory(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_access_purpose text := lower(btrim(coalesce(p_access_purpose, '')));
  v_limit integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_max_limit integer;
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_directory jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;

  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid directory request key required';
  end if;
  if v_access_purpose not in ('dashboard', 'csv_export') then
    raise exception 'Valid directory access purpose required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Directory search is too long';
  end if;
  if coalesce(v_search, '') ~ '[[:cntrl:]]' then
    raise exception 'Directory search contains unsupported characters';
  end if;

  v_max_limit := case when v_access_purpose = 'csv_export' then 5000 else 100 end;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), v_max_limit);
  if v_access_purpose = 'csv_export' and v_offset <> 0 then
    raise exception 'Directory export offset is not allowed';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'search', coalesce(v_search, ''),
      'purpose', v_access_purpose,
      'limit', v_limit,
      'offset', v_offset
    )::text,
    'sha256'
  ), 'hex');

  -- Bind each idempotency key to one immutable request before exact emails are
  -- read. This closes the older directory function's key-reuse audit gap.
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260826));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_user_engagement_directory_request'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Directory request key conflict';
  end if;

  if not found then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_user_engagement_directory_request',
      v_access_purpose,
      case v_access_purpose
        when 'csv_export' then 'Authorized user-list download request'
        else 'Authorized Admin user-list view request'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
        'requestFingerprint', v_request_fingerprint,
        'purpose', v_access_purpose,
        'searchApplied', v_search is not null,
        'searchFingerprint', encode(extensions.digest(
          coalesce(v_search, ''), 'sha256'
        ), 'hex'),
        'limit', v_limit,
        'offset', v_offset
      )
    );
  end if;

  v_directory := public.admin_user_directory(
    p_actor_user_id,
    v_search,
    v_limit,
    v_offset,
    p_request_key,
    v_access_purpose
  );

  select coalesce(
    jsonb_agg(
      (d.item - 'last_active_at' - 'session_count') || jsonb_build_object(
        'last_sign_in_at', u.last_sign_in_at,
        'has_signed_in', u.last_sign_in_at is not null,
        'practice_answered_count', coalesce(c.practice_answered, 0),
        'examination_answered_count', coalesce(c.examination_answered, 0),
        'answered_question_count', coalesce(c.answered_question_count, 0),
        'last_answered_at', c.last_answered_at,
        'graded_answer_count', coalesce(sc.graded_answer_count, 0),
        'average_score', sc.average_score,
        'latest_score', sc.latest_score,
        'last_graded_at', sc.last_graded_at,
        'subscription_category', public.admin_subscription_category(u.id),
        'subscription_id', sub.id,
        'subscription_plan', sub.plan_code,
        'subscription_status', sub.status,
        'subscription_source', sub.source,
        'subscription_starts_at', sub.starts_at,
        'subscription_expires_at', sub.expires_at,
        'trial_expires_at', trial.expires_at,
        'free_beta_enabled', coalesce(beta.enabled, false),
        'free_beta_expires_at', beta.expires_at,
        'beta_all_access_enabled', coalesce(settings.global_beta_all_access_enabled, false),
        'current_legal_accepted', public.phase4_has_current_legal_acceptance(u.id),
        'effective_access', case
          when not public.phase4_has_current_legal_acceptance(u.id)
            then 'Legal acceptance required'
          when coalesce((d.item->>'role') in ('super_admin', 'founder_admin'), false)
            then 'Admin & Staff access'
          when public.phase4_global_beta_effective(u.id) then 'Beta All Access'
          when sub.currently_active then 'Active subscription'
          else 'No active subscription'
        end
      )
      order by d.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
  left join auth.users u on u.id = (d.item->>'id')::uuid
  left join public.admin_user_answer_counts() c on c.user_id = u.id
  left join public.admin_user_score_summary() sc on sc.user_id = u.id
  left join public.access_trials trial on trial.user_id = u.id
  left join public.free_beta_access beta on beta.user_id = u.id
  left join lateral (
    select
      s.id,
      s.plan_code,
      s.status,
      s.source,
      s.starts_at,
      s.expires_at,
      (
        s.status = 'active'
        and s.starts_at <= now()
        and (s.expires_at is null or s.expires_at > now())
      ) as currently_active
    from public.subscriptions s
    where s.user_id = u.id
      and s.status in ('active', 'paused', 'pending_payment', 'trialing')
    order by
      (s.status = 'active') desc,
      s.updated_at desc,
      s.created_at desc
    limit 1
  ) sub on true
  left join public.platform_access_settings settings on settings.singleton = true;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

create or replace function public.admin_live_activity(
  p_actor_user_id uuid,
  p_limit integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_active_5 bigint := 0;
  v_active_30 bigint := 0;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid activity request key required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260823));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_live_activity'
      and a.details->>'requestKey' = p_request_key
      and coalesce((a.details->>'limit')::integer, -1) <> v_limit
  ) then
    raise exception 'Activity request key was already used for a different request';
  end if;

  select count(*) into v_active_5
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '5 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false;

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_live_activity'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_live_activity',
      'last_30_minutes',
      'Authorized Admin activity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'active5Minutes', v_active_5,
        'active30Minutes', v_active_30,
        'limit', v_limit,
        'resultCount', 0,
        'identityRowsWithheld', true
      )
    );
  end if;

  return jsonb_build_object(
    'generatedAt', now(),
    'windowSeconds', 300,
    'activeSignedInLast5Minutes', v_active_5,
    'activeSignedInLast30Minutes', v_active_30,
    'items', '[]'::jsonb,
    'definition',
      'Approximate visible-page activity associated with signed-in session records. Named identities are intentionally withheld because sign-out and account-switch attribution is not reliable enough for exact online-presence claims.'
  );
end;
$$;

create or replace function public.admin_quorum_posts(
  p_actor_user_id uuid,
  p_search text,
  p_status text,
  p_limit integer,
  p_offset integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_status text := lower(btrim(coalesce(p_status, 'all')));
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Quorum search is too long';
  end if;
  if v_status not in ('all', 'visible', 'hidden', 'removed', 'deleted_by_author') then
    raise exception 'Valid Quorum status required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid Quorum request key required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260824));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_quorum_posts'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce(a.details->>'status', '') <> v_status
        or coalesce(a.details->>'searchFingerprint', '') <> md5(coalesce(v_search, ''))
        or coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce((a.details->>'offset')::integer, -1) <> v_offset
      )
  ) then
    raise exception 'Quorum request key was already used for a different request';
  end if;

  select count(*) into v_total
  from public.forum_posts fp
  join auth.users u on u.id = fp.author_user_id
  left join public.profiles p on p.id = fp.author_user_id
  where (
      v_status = 'all'
      or (v_status = 'deleted_by_author' and fp.deleted_at is not null)
      or (v_status <> 'deleted_by_author' and fp.deleted_at is null and fp.moderation_status = v_status)
    )
    and (
      v_search is null
      or fp.body ilike '%' || v_search || '%'
      or fp.subject ilike '%' || v_search || '%'
      or fp.category ilike '%' || v_search || '%'
      or p.display_name ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%'
    );

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
    into v_items
  from (
    select
      fp.public_id as entry_id,
      fp.body,
      fp.entry_type,
      fp.category,
      fp.subject,
      fp.source_url,
      fp.created_at,
      fp.updated_at,
      fp.publication_status,
      case when fp.deleted_at is not null
        then 'deleted_by_author'
        else fp.moderation_status
      end as content_status,
      fp.moderation_reason,
      fp.comments_locked_at is not null as comments_locked,
      fp.author_user_id,
      p.display_name as author_name,
      u.email as author_email,
      (
        select count(*)
        from public.forum_comments c
        where c.post_id = fp.id
          and c.deleted_at is null
      ) as comment_count,
      (
        select count(*)
        from public.forum_reports r
        where r.target_post_id = fp.id
      ) as report_count
    from public.forum_posts fp
    join auth.users u on u.id = fp.author_user_id
    left join public.profiles p on p.id = fp.author_user_id
    where (
        v_status = 'all'
        or (v_status = 'deleted_by_author' and fp.deleted_at is not null)
        or (v_status <> 'deleted_by_author' and fp.deleted_at is null and fp.moderation_status = v_status)
      )
      and (
        v_search is null
        or fp.body ilike '%' || v_search || '%'
        or fp.subject ilike '%' || v_search || '%'
        or fp.category ilike '%' || v_search || '%'
        or p.display_name ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    order by fp.created_at desc
    limit v_limit offset v_offset
  ) x;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_quorum_posts'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_quorum_posts',
      v_status,
      'Authorized Quorum moderation view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'status', v_status,
        'searchApplied', v_search is not null,
        'searchFingerprint', md5(coalesce(v_search, '')),
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', jsonb_array_length(v_items),
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total
  );
end;
$$;

create or replace function public.admin_preview_answer_history(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_record_source text,
  p_limit integer,
  p_offset integer,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_record_source text := lower(btrim(coalesce(p_record_source, 'all')));
  v_limit integer := coalesce(p_limit, 100);
  v_offset integer := coalesce(p_offset, 0);
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_request_fingerprint text;
  v_existing_fingerprint text;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  if p_target_user_id is not null
     and not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'Target user not found';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'Both preview dates must be supplied or both omitted';
  end if;
  if p_from is not null
     and (p_from >= p_to or p_to - p_from > interval '366 days') then
    raise exception 'Valid preview window of at most 366 days required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Answer-history search is too long';
  end if;
  if coalesce(v_search, '') ~ '[[:cntrl:]]' then
    raise exception 'Answer-history search contains unsupported characters';
  end if;
  if v_record_source not in ('all', 'practice', 'formal_exam') then
    raise exception 'Valid answer-history record source required';
  end if;
  if v_limit < 1 or v_limit > 100 then
    raise exception 'Answer-history preview limit must be between 1 and 100';
  end if;
  if v_offset < 0 or v_offset > 1000000 then
    raise exception 'Answer-history preview offset is invalid';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid answer-history preview request key required';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'targetUserId', p_target_user_id,
      'from', p_from,
      'to', p_to,
      'search', coalesce(v_search, ''),
      'recordSource', v_record_source,
      'limit', v_limit,
      'offset', v_offset
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260825));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'answer_history_preview'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Answer-history preview request key conflict';
  end if;

  with response_rows as (
    select
      'practice'::text as record_source,
      a.user_id,
      coalesce(
        nullif(btrim(p.display_name), ''),
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), '')
      )::text as user_display_name,
      case when coalesce(u.is_anonymous, false) then null else u.email end::text as user_email,
      case
        when coalesce(u.is_anonymous, false) then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null then 'not_available'
        else 'available'
      end::text as email_status,
      public.admin_subscription_category(a.user_id)::text as subscription_category,
      a.id as attempt_id,
      a.question_bank_id::text as question_id,
      null::text as question_text,
      'external_question_bank_not_persisted'::text as question_text_source,
      'unavailable_exact_historic_text'::text as question_text_status,
      a.answer_text::text as submitted_answer,
      a.score::numeric as score,
      case
        when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
          then 'ai'
        else 'ungraded'
      end::text as grade_source,
      null::text as suggested_answer,
      'external_question_bank_not_persisted'::text as suggested_answer_source,
      'not_persisted_with_practice_attempt'::text as suggested_answer_status,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then case jsonb_typeof(a.assessment->'modelAnswerALAC')
            when 'string' then a.assessment->>'modelAnswerALAC'
            else (a.assessment->'modelAnswerALAC')::text
          end
        else null
      end::text as model_answer,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'persisted_ai_assessment_model_answer_alac'
        else null
      end::text as model_answer_source,
      case
        when a.assessment ? 'modelAnswerALAC'
             and a.assessment->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(a.assessment->'modelAnswerALAC')
               when 'string' then nullif(btrim(a.assessment->>'modelAnswerALAC'), '') is not null
               when 'object' then a.assessment->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then a.assessment->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'available_generated_assessment'
        else 'not_persisted'
      end::text as model_answer_status,
      nullif(concat_ws(
        E'\n\n',
        nullif(a.assessment->>'rationale', ''),
        nullif(a.assessment->>'legalExplanation', '')
      ), '')::text as feedback_text,
      a.subject::text as subject,
      'Mock Bar'::text as exam_title,
      a.status::text as attempt_status,
      a.timer_mode::text as timer_mode,
      a.elapsed_seconds::integer as elapsed_seconds,
      a.submitted_at as answer_saved_at,
      a.submitted_at,
      case
        when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
          then a.completed_at
        else null
      end::timestamptz as graded_at,
      a.completed_at
    from public.exam_attempts a
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    where nullif(btrim(a.answer_text), '') is not null
      and (p_from is null or a.submitted_at >= p_from)
      and (p_to is null or a.submitted_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)

    union all

    select
      'formal_exam'::text,
      a.user_id,
      coalesce(
        nullif(btrim(p.display_name), ''),
        nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
        nullif(btrim(u.raw_user_meta_data->>'name'), '')
      )::text,
      case when coalesce(u.is_anonymous, false) then null else u.email end::text,
      case
        when coalesce(u.is_anonymous, false) then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null then 'not_available'
        else 'available'
      end::text,
      public.admin_subscription_category(a.user_id)::text,
      a.id,
      coalesce(nullif(q.source_key, ''), q.id::text)::text,
      vq.prompt_snapshot::text,
      'immutable_exam_snapshot'::text,
      'available_exact_attempt_snapshot'::text,
      r.answer_text::text,
      case when hr.finalized_at is not null then hr.score else aa.score end::numeric,
      case
        when hr.finalized_at is not null and aa.id is not null then 'human_and_ai'
        when hr.finalized_at is not null then 'human'
        when aa.id is not null then 'ai'
        when hr.assignment_id is not null then 'human_draft'
        else 'ungraded'
      end::text,
      null::text,
      null::text,
      'not_separately_persisted'::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null
        then null else vq.model_answer_snapshot end::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null
        then null else 'immutable_exam_snapshot' end::text,
      case
        when vq.model_answer_snapshot is null then 'not_persisted'
        when nullif(btrim(vq.model_answer_snapshot), '') is null then 'present_but_empty'
        else 'available_exact_attempt_snapshot'
      end::text,
      coalesce(
        nullif(btrim(hr.comments), ''),
        nullif(concat_ws(
          E'\n\n',
          nullif(aa.assessment_json->>'rationale', ''),
          nullif(aa.assessment_json->>'legalExplanation', '')
        ), '')
      )::text,
      coalesce(d.subject, q.subject)::text,
      d.title::text,
      a.status::text,
      a.timer_mode::text,
      a.elapsed_seconds::integer,
      r.saved_at,
      a.submitted_at,
      greatest(aa.finalized_at, hr.finalized_at),
      null::timestamptz
    from public.examination_responses r
    join public.examination_attempts_multi a on a.id = r.attempt_id
    join auth.users u on u.id = a.user_id
    left join public.profiles p on p.id = a.user_id
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id
     and vq.question_id = r.question_id
    join public.examination_questions q on q.id = r.question_id
    left join public.examination_ai_assessments aa
      on aa.attempt_id = a.id
     and aa.question_id = r.question_id
    left join lateral (
      select
        ea.id as assignment_id,
        er.score,
        er.comments,
        er.saved_at,
        er.finalized_at
      from public.examination_examiner_assignments ea
      join public.examination_examiner_reviews er
        on er.assignment_id = ea.id
       and er.question_id = r.question_id
      where ea.attempt_id = a.id
      order by
        (er.finalized_at is not null) desc,
        er.finalized_at desc nulls last,
        er.saved_at desc,
        ea.created_at desc
      limit 1
    ) hr on true
    where nullif(btrim(r.answer_text), '') is not null
      and (p_from is null or r.saved_at >= p_from)
      and (p_to is null or r.saved_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)
  ), filtered_rows as (
    select rr.*
    from response_rows rr
    where (v_record_source = 'all' or rr.record_source = v_record_source)
      and (
        v_search is null
        or strpos(lower(concat_ws(
          ' ', rr.user_display_name, rr.user_email, rr.subscription_category,
          rr.subject, rr.exam_title, rr.question_text, rr.submitted_answer
        )), lower(v_search)) > 0
      )
  ), ordered_rows as (
    select
      fr.*,
      count(*) over () as total_count,
      row_number() over (
        order by fr.answer_saved_at desc, fr.record_source,
                 fr.attempt_id, fr.question_id
      ) as result_ordinal
    from filtered_rows fr
  )
  select
    coalesce(max(o.total_count), 0),
    coalesce(jsonb_agg(
      jsonb_build_object(
        'recordSource', o.record_source,
        'userId', o.user_id,
        'userDisplayName', o.user_display_name,
        'userEmail', o.user_email,
        'emailStatus', o.email_status,
        'subscriptionCategory', o.subscription_category,
        'attemptId', o.attempt_id,
        'questionId', o.question_id,
        'questionText', o.question_text,
        'questionTextSource', o.question_text_source,
        'questionTextStatus', o.question_text_status,
        'submittedAnswer', o.submitted_answer,
        'answerStatus', 'available',
        'score', o.score,
        'gradeSource', o.grade_source,
        'feedbackText', o.feedback_text,
        'suggestedAnswer', o.suggested_answer,
        'suggestedAnswerSource', o.suggested_answer_source,
        'suggestedAnswerStatus', o.suggested_answer_status,
        'modelAnswer', o.model_answer,
        'modelAnswerSource', o.model_answer_source,
        'modelAnswerStatus', o.model_answer_status,
        'subject', o.subject,
        'examTitle', o.exam_title,
        'attemptStatus', o.attempt_status,
        'timerMode', o.timer_mode,
        'elapsedSeconds', o.elapsed_seconds,
        'answerSavedAt', o.answer_saved_at,
        'submittedAt', o.submitted_at,
        'gradedAt', o.graded_at,
        'completedAt', o.completed_at
      ) order by o.result_ordinal
    ) filter (
      where o.result_ordinal > v_offset
        and o.result_ordinal <= v_offset + v_limit
    ), '[]'::jsonb)
  into v_total, v_items
  from ordered_rows o;

  if v_existing_fingerprint is null then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_user_id,
      target_resource_type, target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      p_target_user_id,
      'answer_history_preview',
      coalesce(p_target_user_id::text, 'all_users'),
      'Authorized Admin answer details view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'requestFingerprint', v_request_fingerprint,
        'recordSource', v_record_source,
        'searchApplied', v_search is not null,
        'searchFingerprint', md5(coalesce(v_search, '')),
        'from', p_from,
        'to', p_to,
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', jsonb_array_length(v_items),
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total,
    'scope', case when p_target_user_id is null then 'all_users' else 'single_user' end,
    'dateScope', case when p_from is null then 'all_time' else 'bounded_range' end
  );
end;
$$;

-- Keep the legacy single-user download route compatible while binding its
-- idempotency key to the complete request before the older export function can
-- return. The newer complete answer-history download below is preferred.
create or replace function public.admin_export_user_responses_with_identity(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_result jsonb;
  v_email text;
  v_display_name text;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_target_user_id is null
     or not exists (select 1 from auth.users u where u.id = p_target_user_id) then
    raise exception 'Target user not found';
  end if;
  if p_from is null or p_to is null or p_from >= p_to
     or p_to - p_from > interval '366 days' then
    raise exception 'Valid export window of at most 366 days required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'Valid export row limit required';
  end if;
  if char_length(v_reason) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid export request key required';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'targetUserId', p_target_user_id,
      'from', p_from,
      'to', p_to,
      'limit', p_limit,
      'reason', v_reason
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260827));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'user_question_answer_export_request'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Question-and-answer export request key conflict';
  end if;

  if not found then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_user_id,
      target_resource_type, target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      p_target_user_id,
      'user_question_answer_export_request',
      p_target_user_id::text,
      v_reason,
      jsonb_build_object(
        'requestKey', p_request_key,
        'requestFingerprint', v_request_fingerprint,
        'from', p_from,
        'to', p_to,
        'limit', p_limit
      )
    );
  end if;

  select
    u.email,
    coalesce(
      nullif(btrim(p.display_name), ''),
      nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
      nullif(btrim(u.raw_user_meta_data->>'name'), '')
    )
    into v_email, v_display_name
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = p_target_user_id;

  v_result := public.admin_export_user_responses(
    p_actor_user_id,
    p_target_user_id,
    p_from,
    p_to,
    p_limit,
    v_reason,
    p_request_key
  );

  return v_result || jsonb_build_object(
    'user', jsonb_build_object(
      'id', p_target_user_id,
      'email', v_email,
      'displayName', v_display_name,
      'subscriptionCategory', public.admin_subscription_category(p_target_user_id)
    )
  );
end;
$$;

-- Persist the complete email-export request before any attachment is sent.
-- Exact replay is reported to the Worker so it cannot send a duplicate; reuse
-- with a different recipient, filter, limit, or reason is rejected.
create or replace function public.admin_prepare_user_directory_email_export(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_recipient_key text,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_reason text := btrim(coalesce(p_reason, ''));
  v_request_fingerprint text;
  v_existing_fingerprint text;
  v_result jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_recipient_key not in ('wally', 'gilmar', 'ice', 'emrico') then
    raise exception 'Approved founder recipient required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Directory search is too long';
  end if;
  if coalesce(v_search, '') ~ '[[:cntrl:]]' then
    raise exception 'Directory search contains unsupported characters';
  end if;
  if char_length(v_reason) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid export request key required';
  end if;

  v_request_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'recipientKey', p_recipient_key,
      'search', coalesce(v_search, ''),
      'limit', v_limit,
      'reason', v_reason
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260828));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_user_directory_email_request'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Directory email request key conflict';
  end if;
  if found then
    return jsonb_build_object(
      'alreadyPrepared', true,
      'recipientKey', p_recipient_key,
      'items', '[]'::jsonb
    );
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'sensitive_data_viewed',
    'admin_user_directory_email_request',
    p_recipient_key,
    v_reason,
    jsonb_build_object(
      'requestKey', p_request_key,
      'requestFingerprint', v_request_fingerprint,
      'recipientKey', p_recipient_key,
      'searchApplied', v_search is not null,
      'searchFingerprint', encode(extensions.digest(
        coalesce(v_search, ''), 'sha256'
      ), 'hex'),
      'limit', v_limit,
      'deliveryState', 'prepared'
    )
  );

  v_result := public.admin_user_engagement_directory(
    p_actor_user_id,
    v_search,
    v_limit,
    0,
    p_request_key,
    'csv_export'
  );

  return v_result || jsonb_build_object(
    'recipientKey', p_recipient_key,
    'alreadyPrepared', false
  );
end;
$$;

create or replace function public.admin_record_user_directory_email_delivery(
  p_actor_user_id uuid,
  p_recipient_key text,
  p_status text,
  p_provider_id text,
  p_safe_error_code text,
  p_result_count integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_reason text := btrim(coalesce(p_reason, ''));
  v_prepare_fingerprint text;
  v_delivery_fingerprint text;
  v_existing_fingerprint text;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_recipient_key not in ('wally', 'gilmar', 'ice', 'emrico') then
    raise exception 'Approved founder recipient required';
  end if;
  if p_status not in ('sent', 'failed', 'suppressed', 'not_configured') then
    raise exception 'Valid delivery status required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid export request key required';
  end if;
  if char_length(v_reason) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if p_result_count is null or p_result_count < 0 or p_result_count > 5000 then
    raise exception 'Valid exported row count required';
  end if;
  if char_length(coalesce(p_provider_id, '')) > 180
     or char_length(coalesce(p_safe_error_code, '')) > 120 then
    raise exception 'Delivery receipt metadata is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260829));
  select a.details->>'requestFingerprint'
    into v_prepare_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_user_directory_email_request'
    and a.details->>'requestKey' = p_request_key
    and a.details->>'recipientKey' = p_recipient_key
    and a.reason = v_reason;
  if not found or nullif(v_prepare_fingerprint, '') is null then
    raise exception 'Matching prepared directory email request required';
  end if;

  v_delivery_fingerprint := encode(extensions.digest(
    jsonb_build_object(
      'preparedRequestFingerprint', v_prepare_fingerprint,
      'recipientKey', p_recipient_key,
      'status', p_status,
      'providerId', nullif(coalesce(p_provider_id, ''), ''),
      'safeErrorCode', nullif(coalesce(p_safe_error_code, ''), ''),
      'resultCount', p_result_count,
      'reason', v_reason
    )::text,
    'sha256'
  ), 'hex');

  select a.details->>'deliveryFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'admin_user_directory_email_delivery'
    and a.details->>'requestKey' = p_request_key;
  if found and v_existing_fingerprint is distinct from v_delivery_fingerprint then
    raise exception 'Directory email delivery receipt conflict';
  end if;
  if found then
    return jsonb_build_object(
      'recorded', true,
      'alreadyRecorded', true,
      'status', p_status,
      'recipientKey', p_recipient_key
    );
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type,
    target_resource_id, reason, details
  ) values (
    p_actor_user_id,
    'sensitive_data_viewed',
    'admin_user_directory_email_delivery',
    p_recipient_key,
    v_reason,
    jsonb_build_object(
      'requestKey', p_request_key,
      'preparedRequestFingerprint', v_prepare_fingerprint,
      'deliveryFingerprint', v_delivery_fingerprint,
      'recipientKey', p_recipient_key,
      'status', p_status,
      'resultCount', p_result_count,
      'providerId', nullif(left(coalesce(p_provider_id, ''), 180), ''),
      'safeErrorCode', nullif(left(coalesce(p_safe_error_code, ''), 120), '')
    )
  );

  return jsonb_build_object(
    'recorded', true,
    'alreadyRecorded', false,
    'status', p_status,
    'recipientKey', p_recipient_key
  );
end;
$$;

-- Add only the identity context needed by returned answer rows. This avoids
-- loading unrelated users' emails into Worker memory and never substitutes the
-- current practice bank for an unavailable historical snapshot.
create or replace function public.admin_export_answer_history_with_context(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);

  v_result := public.admin_export_answer_history(
    p_actor_user_id,
    p_target_user_id,
    p_from,
    p_to,
    p_limit,
    p_reason,
    p_request_key
  );

  select coalesce(
    jsonb_agg(
      d.item || jsonb_build_object(
        'userDisplayName', coalesce(
          nullif(btrim(p.display_name), ''),
          nullif(btrim(u.raw_user_meta_data->>'full_name'), ''),
          nullif(btrim(u.raw_user_meta_data->>'name'), '')
        ),
        'userEmail', case
          when coalesce(u.is_anonymous, false) then null
          else u.email
        end,
        'subscriptionCategory', public.admin_subscription_category(u.id)
      )
      order by d.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
  join auth.users u on u.id = (d.item->>'userId')::uuid
  left join public.profiles p on p.id = u.id;

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

revoke all on function public.admin_subscription_category(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_user_score_summary()
  from public, anon, authenticated;
revoke all on function public.admin_overview_engagement_metrics(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_user_engagement_directory(
  uuid, text, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.admin_live_activity(uuid, integer, text)
  from public, anon, authenticated;
revoke all on function public.admin_quorum_posts(
  uuid, text, text, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_preview_answer_history(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;
revoke all on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) from public, anon, authenticated;
revoke all on function public.admin_export_answer_history_with_context(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;

grant execute on function public.admin_subscription_category(uuid) to service_role;
grant execute on function public.admin_user_score_summary() to service_role;
grant execute on function public.admin_overview_engagement_metrics(uuid) to service_role;
grant execute on function public.admin_user_engagement_directory(
  uuid, text, integer, integer, text, text
) to service_role;
grant execute on function public.admin_live_activity(uuid, integer, text) to service_role;
grant execute on function public.admin_quorum_posts(
  uuid, text, text, integer, integer, text
) to service_role;
grant execute on function public.admin_preview_answer_history(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) to service_role;
grant execute on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;
grant execute on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) to service_role;
grant execute on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) to service_role;
grant execute on function public.admin_export_answer_history_with_context(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_subscription_category(uuid)
  is 'Service-only plain-language business classification for the protected Admin dashboard.';
comment on function public.admin_user_score_summary()
  is 'Service-only persisted practice and formal-exam score summary by user.';
comment on function public.admin_live_activity(uuid, integer, text)
  is 'Capability-restricted and audited aggregate activity summary; named identity rows are withheld until session attribution is reliable.';
comment on function public.admin_quorum_posts(uuid, text, text, integer, integer, text)
  is 'Founder-only audited Quorum post directory for moderation of reported or unreported posts.';
comment on function public.admin_preview_answer_history(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) is 'Founder-only, service-role-only paginated answer-history preview. Formal content uses immutable attempt snapshots; unavailable historic practice content is never backfilled from the current bank.';
comment on function public.admin_export_user_responses_with_identity(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Founder-only single-user answer download with an immutable preflight audit fingerprint and server-derived identity.';
comment on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) is 'Founder-only user-list email preparation recorded before sending; duplicate or conflicting request keys cannot send again.';
comment on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) is 'Founder-only immutable delivery receipt bound to a previously prepared user-list email request.';
comment on function public.admin_export_answer_history_with_context(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Founder-only complete answer-history download enriched only with identities represented in returned rows.';

commit;
