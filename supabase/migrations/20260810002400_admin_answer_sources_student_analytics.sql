-- Admin-only answer evidence and student-only analytics.
-- This migration does not change authentication, entitlements, grading, question
-- delivery, simulator behavior, or any learner-facing route.

begin;

create or replace function public.admin_is_student_analytics_user(
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_id is null then true
    else coalesce((
      select r.role
      from public.user_roles r
      where r.user_id = p_user_id
    ), 'student') not in ('admin', 'founder_admin', 'super_admin')
  end
$$;

create or replace function public.admin_answer_source_context(
  p_record_source text,
  p_attempt_id uuid,
  p_question_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result_sources jsonb := '[]'::jsonb;
  v_question_sources jsonb := '[]'::jsonb;
begin
  if p_record_source = 'practice' then
    select case
      when jsonb_typeof(a.assessment->'sources') = 'array'
        then a.assessment->'sources'
      else '[]'::jsonb
    end
    into v_result_sources
    from public.exam_attempts a
    where a.id = p_attempt_id;
  elsif p_record_source = 'formal_exam' then
    select case
      when jsonb_typeof(aa.assessment_json->'sources') = 'array'
        then aa.assessment_json->'sources'
      else '[]'::jsonb
    end
    into v_result_sources
    from public.examination_ai_assessments aa
    join public.examination_questions q on q.id = aa.question_id
    where aa.attempt_id = p_attempt_id
      and (q.id::text = p_question_id or q.source_key = p_question_id)
    order by aa.finalized_at desc nulls last, aa.created_at desc
    limit 1;

    select case
      when jsonb_typeof(vq.source_urls_snapshot) = 'array'
        then vq.source_urls_snapshot
      else '[]'::jsonb
    end
    into v_question_sources
    from public.examination_attempts_multi a
    join public.examination_version_questions vq on vq.version_id = a.version_id
    join public.examination_questions q on q.id = vq.question_id
    where a.id = p_attempt_id
      and (q.id::text = p_question_id or q.source_key = p_question_id)
    limit 1;
  end if;

  return jsonb_build_object(
    'resultSources', coalesce(v_result_sources, '[]'::jsonb),
    'questionSourceLinks', coalesce(v_question_sources, '[]'::jsonb)
  );
end;
$$;

create or replace function public.admin_preview_answer_history_with_sources(
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
  v_result jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  v_result := public.admin_preview_answer_history(
    p_actor_user_id, p_target_user_id, p_from, p_to, p_search,
    p_record_source, p_limit, p_offset, p_request_key
  );

  select coalesce(
    jsonb_agg(
      e.item || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      order by e.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as e(item, ordinality);

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

create or replace function public.admin_export_answer_history_with_sources(
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
  v_result := public.admin_export_answer_history_with_context(
    p_actor_user_id, p_target_user_id, p_from, p_to,
    p_limit, p_reason, p_request_key
  );

  select coalesce(
    jsonb_agg(
      e.item || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      order by e.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as e(item, ordinality);

  return jsonb_set(v_result, '{items}', v_items, true);
end;
$$;

create or replace function public.admin_user_answer_counts()
returns table (
  user_id uuid,
  practice_answered bigint,
  examination_answered bigint,
  answered_question_count bigint,
  last_answered_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with answer_events as (
    select
      a.user_id,
      1::bigint as practice_count,
      0::bigint as examination_count,
      a.submitted_at as answered_at
    from public.exam_attempts a
    join auth.users u on u.id = a.user_id
    where nullif(btrim(a.answer_text), '') is not null
      and coalesce(u.is_anonymous, false) = false
      and public.admin_is_student_analytics_user(a.user_id)

    union all

    select
      a.user_id,
      0::bigint,
      1::bigint,
      r.saved_at
    from public.examination_responses r
    join public.examination_attempts_multi a on a.id = r.attempt_id
    join auth.users u on u.id = a.user_id
    where nullif(btrim(r.answer_text), '') is not null
      and coalesce(u.is_anonymous, false) = false
      and public.admin_is_student_analytics_user(a.user_id)
  )
  select
    e.user_id,
    sum(e.practice_count)::bigint,
    sum(e.examination_count)::bigint,
    count(*)::bigint,
    max(e.answered_at)
  from answer_events e
  group by e.user_id
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
    and u.last_sign_in_at is not null
    and public.admin_is_student_analytics_user(u.id);

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
    and coalesce(u.is_anonymous, false) = false
    and public.admin_is_student_analytics_user(u.id);

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and public.admin_is_student_analytics_user(u.id);

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
      and public.admin_is_student_analytics_user(u.id)
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
    and coalesce(u.is_anonymous, false) = false
    and public.admin_is_student_analytics_user(u.id);

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and public.admin_is_student_analytics_user(u.id);

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


create or replace function public.admin_period_metrics(
  p_from timestamptz,
  p_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_days integer;
  v_result jsonb;
begin
  if p_from is null or p_to is null or p_from >= p_to then
    raise exception 'Invalid reporting window';
  end if;
  if p_to - p_from > interval '366 days' then
    raise exception 'Reporting window exceeds 366 days';
  end if;

  v_days := greatest(1, ceil(extract(epoch from (p_to - p_from)) / 86400.0)::integer);

  with
  session_scope as (
    select
      id,
      coalesce(user_id::text, visitor_id::text, anonymous_session_id::text) as audience_id,
      user_id,
      started_at,
      least(
        coalesce(ended_at, last_seen_at),
        started_at + interval '4 hours'
      ) as conservative_end,
      device_category,
      referral_host,
      utm_source,
      utm_medium,
      utm_campaign,
      landing_area
    from public.usage_sessions
    where public.admin_is_student_analytics_user(user_id)
      and started_at >= p_from and started_at < p_to
  ),
  event_scope as (
    select *
    from public.usage_events
    where public.admin_is_student_analytics_user(user_id)
      and occurred_at >= p_from and occurred_at < p_to
  ),
  all_audience_days as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      (occurred_at at time zone 'Asia/Manila')::date as activity_date
    from public.usage_events
    where public.admin_is_student_analytics_user(user_id)
      and occurred_at < p_to
      and coalesce(user_id::text, anonymous_session_id::text) is not null
    group by 1, 2
  ),
  cohort_first as (
    select audience_id, min(activity_date) as first_activity_date
    from all_audience_days
    group by audience_id
  ),
  retention as (
    select jsonb_object_agg(
      'd' || horizon.days::text,
      jsonb_build_object(
        'matured',
          ((p_to at time zone 'Asia/Manila')::date - horizon.days)
            >= (p_from at time zone 'Asia/Manila')::date,
        'sample_sufficient', cohort.eligible_count >= 5,
        'eligible_cohort', cohort.eligible_count,
        'retained', cohort.retained_count,
        'rate', case when cohort.eligible_count < 5 then null
          else round(cohort.retained_count::numeric / cohort.eligible_count, 4) end
      )
    ) as metrics
    from (values (1), (7), (30)) as horizon(days)
    cross join lateral (
      select
        count(*)::integer as eligible_count,
        count(*) filter (
          where exists (
            select 1
            from all_audience_days retained_day
            where retained_day.audience_id = first_seen.audience_id
              and retained_day.activity_date
                = first_seen.first_activity_date + horizon.days
          )
        )::integer as retained_count
      from cohort_first first_seen
      where first_seen.first_activity_date
        >= (p_from at time zone 'Asia/Manila')::date
        and first_seen.first_activity_date
          <= (p_to at time zone 'Asia/Manila')::date - horizon.days
    ) cohort
  ),
  audience_days as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      (occurred_at at time zone 'Asia/Manila')::date as activity_date
    from event_scope
    group by 1, 2
  ),
  daily_activity as (
    select count(*)::integer as daily_unique_total
    from audience_days
  ),
  traffic as (
    select
      count(*) filter (where event_type = 'page_view')::integer as page_views,
      count(distinct coalesce(user_id::text, anonymous_session_id::text))::integer as unique_visitors,
      count(*) filter (where event_type = 'registration_completed')::integer as registrations,
      count(*) filter (where event_type = 'onboarding_completed')::integer as onboarding_completions,
      count(*) filter (where event_type = 'guest_first_grade')::integer as guest_first_grade,
      count(*) filter (where event_type = 'guest_third_grade')::integer as guest_third_grade,
      count(*) filter (where event_type = 'guest_limit_reached')::integer as guest_limit_reached,
      count(*) filter (where event_type = 'sign_in_prompted')::integer as sign_in_prompted,
      count(*) filter (where event_type = 'sign_in_started')::integer as sign_in_started,
      count(*) filter (where event_type = 'sign_in_completed')::integer as sign_in_completed,
      count(*) filter (where event_type = 'subject_selected')::integer as subject_selections,
      count(*) filter (where event_type = 'question_viewed')::integer as questions_viewed,
      count(*) filter (where event_type = 'grading_started')::integer as grading_started,
      count(*) filter (where event_type = 'grading_success')::integer as grading_success,
      count(*) filter (where event_type = 'grading_failure')::integer as grading_failure,
      count(*) filter (where event_type = 'grading_timeout')::integer as grading_timeout,
      count(*) filter (where event_type = 'grading_rate_limited')::integer as grading_rate_limited,
      count(*) filter (where event_type = 'support_submitted')::integer as support_submitted,
      count(*) filter (where event_type = 'correction_submitted')::integer as correction_submitted
    from event_scope
  ),
  learning as (
    select
      round(avg(score) filter (where event_type = 'grading_success' and score is not null), 1) as attempt_average,
      round(percentile_cont(0.5) within group (order by score)
        filter (where event_type = 'grading_success' and score is not null)::numeric, 1) as median_score,
      count(*) filter (where event_type = 'grading_success' and score is not null)::integer as score_sample_size
    from event_scope
  ),
  latest_success as (
    select distinct on (audience_id, question_id)
      audience_id, question_id, score
    from (
      select
        coalesce(user_id::text, anonymous_session_id::text) as audience_id,
        question_id,
        score,
        occurred_at
      from event_scope
      where event_type = 'grading_success'
        and score is not null
        and question_id is not null
    ) successful
    order by audience_id, question_id, occurred_at desc
  ),
  repeated_success as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      question_id,
      (array_agg(score order by occurred_at asc))[1] as first_score,
      (array_agg(score order by occurred_at desc))[1] as latest_score
    from event_scope
    where event_type = 'grading_success'
      and score is not null
      and question_id is not null
    group by 1, 2
    having count(*) > 1
  ),
  mastery as (
    select
      round((select avg(score) from latest_success), 1) as mastery_average,
      (select count(*) from latest_success)::integer as mastery_sample_size,
      round((select avg(latest_score - first_score) from repeated_success), 1)
        as average_improvement,
      (select count(*) from repeated_success)::integer as repeated_question_sample
  ),
  reliability as (
    select
      round(percentile_cont(0.5) within group (order by latency_ms)
        filter (where event_type = 'grading_success' and latency_ms is not null)::numeric)::integer as p50_latency_ms,
      round(percentile_cont(0.95) within group (order by latency_ms)
        filter (where event_type = 'grading_success' and latency_ms is not null)::numeric)::integer as p95_latency_ms,
      max(occurred_at) filter (where event_type = 'grading_success') as last_successful_grade
    from event_scope
  ),
  engagement as (
    select
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 1)
      )::integer as dau,
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 7)
      )::integer as wau,
      count(distinct audience_id) filter (
        where activity_date >= ((p_to at time zone 'Asia/Manila')::date - 30)
      )::integer as mau,
      count(*) filter (where dates_active > 1)::integer as returning_visitors
    from (
      select audience_id, count(distinct activity_date) as dates_active, max(activity_date) as activity_date
      from audience_days
      group by audience_id
    ) d
  ),
  sessions as (
    select
      count(*)::integer as session_count,
      count(*) filter (where user_id is not null)::integer as authenticated_sessions,
      count(*) filter (where user_id is null)::integer as guest_sessions,
      round(percentile_cont(0.5) within group (
        order by greatest(0, extract(epoch from (conservative_end - started_at)))
      )::numeric)::integer as median_session_seconds
    from session_scope
  )
  select jsonb_build_object(
    'from', p_from,
    'to', p_to,
    'calendar_days', v_days,
    'traffic', jsonb_build_object(
      'page_views', traffic.page_views,
      'unique_visitors', traffic.unique_visitors,
      'sessions', sessions.session_count,
      'average_daily_views', round(traffic.page_views::numeric / v_days, 1),
      'average_daily_unique_visitors', round(daily_activity.daily_unique_total::numeric / v_days, 1),
      'authenticated_sessions', sessions.authenticated_sessions,
      'guest_sessions', sessions.guest_sessions,
      'median_session_seconds', sessions.median_session_seconds,
      'dau', engagement.dau,
      'wau', engagement.wau,
      'mau', engagement.mau,
      'dau_mau_ratio', case when engagement.mau = 0 then null
        else round(engagement.dau::numeric / engagement.mau, 3) end,
      'wau_mau_ratio', case when engagement.mau = 0 then null
        else round(engagement.wau::numeric / engagement.mau, 3) end,
      'returning_visitors', engagement.returning_visitors
    ),
    'funnel', jsonb_build_object(
      'eligible_guest_sessions', sessions.guest_sessions,
      'guest_first_successful_grade', traffic.guest_first_grade,
      'guest_third_successful_grade', traffic.guest_third_grade,
      'limit_reached', traffic.guest_limit_reached,
      'sign_in_prompted', traffic.sign_in_prompted,
      'sign_in_started', traffic.sign_in_started,
      'sign_in_completed', traffic.sign_in_completed,
      'onboarding_completed', traffic.onboarding_completions,
      'registrations', traffic.registrations,
      'registration_conversion_rate', case when traffic.sign_in_prompted = 0 then null
        else round(traffic.registrations::numeric / traffic.sign_in_prompted, 4) end,
      'onboarding_completion_rate', case when traffic.registrations = 0 then null
        else round(traffic.onboarding_completions::numeric / traffic.registrations, 4) end,
      'guest_activation_rate', case when sessions.guest_sessions = 0 then null
        else round(traffic.guest_first_grade::numeric / sessions.guest_sessions, 4) end
    ),
    'retention', retention.metrics,
    'learning', jsonb_build_object(
      'attempt_average', learning.attempt_average,
      'mastery_average', mastery.mastery_average,
      'mastery_sample_size', mastery.mastery_sample_size,
      'average_improvement', mastery.average_improvement,
      'repeated_question_sample', mastery.repeated_question_sample,
      'median_score', learning.median_score,
      'sample_size', learning.score_sample_size,
      'questions_viewed', traffic.questions_viewed,
      'successful_grades', traffic.grading_success,
      'questions_per_active_user', case when traffic.unique_visitors = 0 then null
        else round(traffic.questions_viewed::numeric / traffic.unique_visitors, 2) end,
      'successful_grades_per_active_user', case when traffic.unique_visitors = 0 then null
        else round(traffic.grading_success::numeric / traffic.unique_visitors, 2) end
    ),
    'reliability', jsonb_build_object(
      'grading_started', traffic.grading_started,
      'grading_success', traffic.grading_success,
      'grading_failure', traffic.grading_failure,
      'grading_timeout', traffic.grading_timeout,
      'grading_rate_limited', traffic.grading_rate_limited,
      'success_rate', case when traffic.grading_started = 0 then null
        else round(traffic.grading_success::numeric / traffic.grading_started, 4) end,
      'p50_latency_ms', reliability.p50_latency_ms,
      'p95_latency_ms', reliability.p95_latency_ms,
      'last_successful_grade', reliability.last_successful_grade
    ),
    'operations', jsonb_build_object(
      'support_submitted', traffic.support_submitted,
      'correction_submitted', traffic.correction_submitted
    )
  )
  into v_result
  from traffic, learning, mastery, reliability, engagement, sessions, daily_activity, retention;

  return v_result;
end;
$$;


create or replace function public.admin_dashboard_snapshot(
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_auth jsonb;
  v_current jsonb;
  v_previous jsonb;
  v_collection_start timestamptz;
  v_subjects jsonb;
  v_models jsonb;
  v_sources jsonb;
  v_device_mix jsonb;
begin
  v_auth := public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;
  if p_previous_from is null or p_previous_to is null then
    raise exception 'Comparison window is required';
  end if;

  v_current := public.admin_period_metrics(p_from, p_to);
  v_previous := public.admin_period_metrics(p_previous_from, p_previous_to);

  select least(
    coalesce((select min(started_at) from public.usage_sessions where public.admin_is_student_analytics_user(user_id)), 'infinity'::timestamptz),
    coalesce((select min(occurred_at) from public.usage_events where public.admin_is_student_analytics_user(user_id)), 'infinity'::timestamptz)
  ) into v_collection_start;
  if v_collection_start = 'infinity'::timestamptz then
    v_collection_start := null;
  end if;

  select coalesce(jsonb_agg(row_value order by subject), '[]'::jsonb)
  into v_subjects
  from (
    select
      subject,
      jsonb_build_object(
        'subject', subject,
        'question_views', count(*) filter (where event_type = 'question_viewed'),
        'grading_starts', count(*) filter (where event_type = 'grading_started'),
        'successful_grades', count(*) filter (where event_type = 'grading_success'),
        'failures', count(*) filter (where event_type in ('grading_failure','grading_timeout','grading_rate_limited')),
        'attempt_average', round(avg(score) filter (where event_type = 'grading_success' and score is not null), 1),
        'sample_size', count(*) filter (where event_type = 'grading_success' and score is not null),
        'low_sample', count(*) filter (where event_type = 'grading_success' and score is not null) < 5
      ) as row_value
    from public.usage_events
    where public.admin_is_student_analytics_user(user_id)
      and occurred_at >= p_from and occurred_at < p_to
      and subject is not null
    group by subject
  ) s;

  select coalesce(jsonb_agg(row_value order by model_name), '[]'::jsonb)
  into v_models
  from (
    select
      coalesce(model_name, 'Not reported') as model_name,
      jsonb_build_object(
        'model', coalesce(model_name, 'Not reported'),
        'successful_grades', count(*) filter (where event_type = 'grading_success'),
        'failures', count(*) filter (where event_type in ('grading_failure','grading_timeout','grading_rate_limited')),
        'p95_latency_ms', round(percentile_cont(0.95) within group (order by latency_ms)
          filter (where latency_ms is not null)::numeric)::integer
      ) as row_value
    from public.usage_events
    where public.admin_is_student_analytics_user(user_id)
      and occurred_at >= p_from and occurred_at < p_to
      and event_type like 'grading_%'
    group by coalesce(model_name, 'Not reported')
  ) m;

  select coalesce(jsonb_agg(row_value order by sessions desc), '[]'::jsonb)
  into v_sources
  from (
    select
      coalesce(utm_source, referral_host, 'Direct / unavailable') as source,
      count(*)::integer as sessions,
      jsonb_build_object(
        'source', coalesce(utm_source, referral_host, 'Direct / unavailable'),
        'medium', coalesce(utm_medium, 'Not available'),
        'sessions', count(*)
      ) as row_value
    from public.usage_sessions
    where public.admin_is_student_analytics_user(user_id)
      and started_at >= p_from and started_at < p_to
    group by coalesce(utm_source, referral_host, 'Direct / unavailable'), coalesce(utm_medium, 'Not available')
    limit 20
  ) a;

  select coalesce(jsonb_agg(row_value order by sessions desc), '[]'::jsonb)
  into v_device_mix
  from (
    select
      coalesce(device_category, 'unknown') as category,
      count(*)::integer as sessions,
      jsonb_build_object(
        'category', coalesce(device_category, 'unknown'),
        'sessions', count(*)
      ) as row_value
    from public.usage_sessions
    where public.admin_is_student_analytics_user(user_id)
      and started_at >= p_from and started_at < p_to
    group by coalesce(device_category, 'unknown')
  ) d;

  return jsonb_build_object(
    'authorization', v_auth,
    'meta', jsonb_build_object(
      'timezone', 'Asia/Manila',
      'generated_at', now(),
      'data_collection_start', v_collection_start,
      'freshness', case when v_collection_start is null then 'No verified analytics events yet' else 'Live operational data' end,
      'heartbeat_seconds', 90,
      'current_viewer_window_minutes', 5,
      'privacy_threshold', 5
    ),
    'current', v_current,
    'previous', v_previous,
    'realtime', jsonb_build_object(
      'current_viewers', (
        select count(distinct coalesce(user_id::text, visitor_id::text, anonymous_session_id::text))
        from public.usage_sessions
        where public.admin_is_student_analytics_user(user_id)
          and ended_at is null
          and last_seen_at >= now() - interval '5 minutes'
      )
    ),
    'inventory', jsonb_build_object(
      'database_subjects', (select count(*) from public.subjects),
      'database_questions', (select count(*) from public.questions)
    ),
    'queues', jsonb_build_object(
      'pending_support', (
        select count(*) from public.support_requests
        where status in ('pending', 'in_progress', 'waiting_for_student')
      ),
      'pending_corrections', (
        select count(*) from public.question_corrections where status = 'pending'
      ),
      'open_recovery_cases', (
        select count(*) from public.account_recovery_cases
        where status <> 'closed_no_transfer'
      ),
      'active_manual_entitlements', (
        select count(*) from public.user_entitlements
        where status = 'active'
          and effective_from <= now()
          and (effective_until is null or effective_until > now())
      )
    ),
    'subjects', v_subjects,
    'models', v_models,
    'acquisition', v_sources,
    'devices', v_device_mix,
    'financial', jsonb_build_object(
      'paid_subscribers', null,
      'paid_subscribers_status', 'Not connected — payment integration pending.',
      'revenue', null,
      'mrr', null,
      'arr', null,
      'arpu', null,
      'paid_churn', null,
      'advertising_impressions', null,
      'advertising_clicks', null,
      'advertising_ctr', null,
      'sponsorship_income', null,
      'manual_access_notice', 'Manual access control — no payment provider is connected.'
    )
  );
end;
$$;



revoke all on function public.admin_is_student_analytics_user(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_answer_source_context(text, uuid, text)
  from public, anon, authenticated;
revoke all on function public.admin_preview_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.admin_export_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;

grant execute on function public.admin_is_student_analytics_user(uuid) to service_role;
grant execute on function public.admin_answer_source_context(text, uuid, text) to service_role;
grant execute on function public.admin_preview_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) to service_role;
grant execute on function public.admin_export_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_preview_answer_history_with_sources(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text
) is 'Founder-only answer preview with saved assessment sources. Practice question text is enriched server-side from the published bank.';
comment on function public.admin_is_student_analytics_user(uuid)
  is 'Admin reporting helper that excludes identified administrator and founder roles while retaining student and anonymous learner activity.';

commit;
