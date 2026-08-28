-- Additive reporting RPCs. Existing unscoped RPC signatures remain intact so
-- the Worker can be deployed after this migration without a compatibility gap.

begin;

create or replace function private.admin_user_answer_counts_scoped_v1(
  p_data_scope text
)
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
      attempt.user_id,
      1::bigint as practice_count,
      0::bigint as examination_count,
      attempt.submitted_at as answered_at
    from public.exam_attempts attempt
    join auth.users user_row on user_row.id = attempt.user_id
    where nullif(btrim(attempt.answer_text), '') is not null
      and coalesce(user_row.is_anonymous, false) = false
      and private.admin_learner_reporting_scope_matches(
        attempt.user_id,
        p_data_scope
      )

    union all

    select
      attempt.user_id,
      0::bigint,
      1::bigint,
      response.saved_at
    from public.examination_responses response
    join public.examination_attempts_multi attempt
      on attempt.id = response.attempt_id
    join auth.users user_row on user_row.id = attempt.user_id
    where nullif(btrim(response.answer_text), '') is not null
      and coalesce(user_row.is_anonymous, false) = false
      and private.admin_learner_reporting_scope_matches(
        attempt.user_id,
        p_data_scope
      )
  )
  select
    answer_event.user_id,
    sum(answer_event.practice_count)::bigint,
    sum(answer_event.examination_count)::bigint,
    count(*)::bigint,
    max(answer_event.answered_at)
  from answer_events answer_event
  group by answer_event.user_id
$$;
create or replace function private.admin_period_metrics_scoped_v1(
  p_from timestamptz,
  p_to timestamptz,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
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
    from private.admin_scoped_usage_sessions(p_data_scope)
    where started_at >= p_from and started_at < p_to
  ),
  event_scope as (
    select *
    from private.admin_scoped_usage_events(p_data_scope)
    where occurred_at >= p_from and occurred_at < p_to
  ),
  all_audience_days as (
    select
      coalesce(user_id::text, anonymous_session_id::text) as audience_id,
      (occurred_at at time zone 'Asia/Manila')::date as activity_date
    from private.admin_scoped_usage_events(p_data_scope)
    where occurred_at < p_to
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
    'dataScope', p_data_scope,
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


-- Scoped answer-history preview and export.
create or replace function private.admin_preview_answer_history_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_record_source text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
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
      'offset', v_offset,
      'dataScope', p_data_scope
    )::text,
    'sha256'
  ), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260825));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
  from public.admin_audit_log a
  where a.actor_user_id = p_actor_user_id
    and a.action_type = 'sensitive_data_viewed'
    and a.target_resource_type = 'answer_history_preview_scoped_v1'
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
      and private.admin_reporting_scope_matches(a.user_id, p_data_scope)

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
      and private.admin_reporting_scope_matches(a.user_id, p_data_scope)
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
      'answer_history_preview_scoped_v1',
      coalesce(p_target_user_id::text, 'all_users'),
      'Authorized Admin answer details view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
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
    'dataScope', p_data_scope,
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

create or replace function private.admin_preview_answer_history_with_sources_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_record_source text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);
  v_result := private.admin_preview_answer_history_scoped_v1(
    p_actor_user_id, p_target_user_id, p_from, p_to, p_search,
    p_record_source, p_limit, p_offset, p_request_key, p_data_scope
  );

  select coalesce(
    jsonb_agg(
      e.item
      || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      || public.admin_answer_feature_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid
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

create or replace function public.admin_preview_answer_history_by_feature_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_search text,
  p_feature_key text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_feature_key text := lower(btrim(coalesce(p_feature_key, 'all')));
  v_result jsonb;
  v_page jsonb;
  v_page_items jsonb;
  v_matching_items jsonb := '[]'::jsonb;
  v_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_source_offset integer := 0;
  v_total integer := 0;
  v_scan_cap integer := 25000;
  v_too_many boolean := false;
  v_derived_request_key text;
  v_feature_totals jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);

  if v_feature_key not in (
    'all',
    'bar_question_practice',
    'syllabus_based_review',
    'bar_exam_simulation',
    'legacy_formal_exam'
  ) then
    raise exception 'Valid answer-history feature required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Answer-history preview limit must be between 1 and 100';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 1000000 then
    raise exception 'Answer-history preview offset is invalid';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid answer-history preview request key required';
  end if;

  if v_feature_key in ('all', 'bar_question_practice', 'legacy_formal_exam') then
    v_result := private.admin_preview_answer_history_with_sources_scoped_v1(
      p_actor_user_id,
      p_target_user_id,
      p_from,
      p_to,
      p_search,
      case
        when v_feature_key = 'all' then 'all'
        when v_feature_key = 'legacy_formal_exam' then 'formal_exam'
        else 'practice'
      end,
      p_limit,
      p_offset,
      p_request_key,
      p_data_scope
    );
  else
    loop
      v_derived_request_key := encode(extensions.digest(
        p_request_key || ':' || v_feature_key || ':' || v_source_offset::text,
        'sha256'
      ), 'hex');

      v_page := private.admin_preview_answer_history_with_sources_scoped_v1(
        p_actor_user_id,
        p_target_user_id,
        p_from,
        p_to,
        p_search,
        'formal_exam',
        100,
        v_source_offset,
        v_derived_request_key,
        p_data_scope
      );
      v_page_items := coalesce(v_page->'items', '[]'::jsonb);

      for v_item in
        select item.value
        from jsonb_array_elements(v_page_items) item(value)
      loop
        if v_item->>'featureKey' = v_feature_key then
          v_matching_items := v_matching_items || jsonb_build_array(v_item);
        end if;
      end loop;

      exit when coalesce((v_page->>'hasMore')::boolean, false) is false;
      v_source_offset := v_source_offset + 100;
      if v_source_offset >= v_scan_cap then
        v_too_many := true;
        exit;
      end if;
    end loop;

    v_total := jsonb_array_length(v_matching_items);
    select coalesce(jsonb_agg(item.value order by item.ordinality), '[]'::jsonb)
    into v_items
    from jsonb_array_elements(v_matching_items) with ordinality
      as item(value, ordinality)
    where item.ordinality > p_offset
      and item.ordinality <= p_offset + p_limit;

    v_result := jsonb_build_object(
      'items', v_items,
      'total', v_total,
      'limit', p_limit,
      'offset', p_offset,
      'hasMore', p_offset + jsonb_array_length(v_items) < v_total,
      'tooMany', v_too_many,
      'scope', case when p_target_user_id is null then 'all_users' else 'single_user' end,
      'dateScope', case when p_from is null then 'all_time' else 'bounded_range' end
    );
  end if;

  select jsonb_build_object(
    'bar_question_practice', (
      select count(*)
      from public.exam_attempts attempt
      where nullif(btrim(attempt.answer_text), '') is not null
        and private.admin_reporting_scope_matches(attempt.user_id, p_data_scope)
    ),
    'legacy_formal_exam', (
      select count(*)
      from public.examination_responses response
      join public.examination_attempts_multi attempt
        on attempt.id = response.attempt_id
      where nullif(btrim(response.answer_text), '') is not null
        and private.admin_reporting_scope_matches(attempt.user_id, p_data_scope)
    ),
    'syllabus_based_review', (
      select count(*)
      from public.examination_responses response
      join public.examination_attempts_multi attempt
        on attempt.id = response.attempt_id
      join public.examination_versions version
        on version.id = attempt.version_id
      join public.examination_definitions definition
        on definition.id = version.exam_id
      where nullif(btrim(response.answer_text), '') is not null
        and private.admin_reporting_scope_matches(attempt.user_id, p_data_scope)
        and definition.track = 'per_subject'
    ),
    'bar_exam_simulation', (
      select count(*)
      from public.examination_responses response
      join public.examination_attempts_multi attempt
        on attempt.id = response.attempt_id
      join public.examination_versions version
        on version.id = attempt.version_id
      join public.examination_definitions definition
        on definition.id = version.exam_id
      where nullif(btrim(response.answer_text), '') is not null
        and private.admin_reporting_scope_matches(attempt.user_id, p_data_scope)
        and definition.track = 'bar_feels'
    )
  )
  into v_feature_totals;

  return v_result || jsonb_build_object(
    'dataScope', p_data_scope,
    'featureFilter', v_feature_key,
    'featureTotals', v_feature_totals,
    'tooMany', coalesce((v_result->>'tooMany')::boolean, false)
  );
end;
$$;

create or replace function private.admin_export_answer_history_core_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_scope text := case
    when p_target_user_id is null then 'all_users'
    else 'single_user'
  end;
  v_date_scope text := case
    when p_from is null and p_to is null then 'all_time'
    else 'bounded_range'
  end;
  v_request_fingerprint text;
  v_existing_fingerprint text;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);

  if p_target_user_id is not null
     and not exists (
       select 1
       from auth.users u
       where u.id = p_target_user_id
     ) then
    raise exception 'Target user not found';
  end if;
  if (p_from is null) <> (p_to is null) then
    raise exception 'Both export dates must be supplied or both omitted';
  end if;
  if p_from is not null
     and (p_from >= p_to or p_to - p_from > interval '366 days') then
    raise exception 'Valid export window of at most 366 days required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 5000 then
    raise exception 'Valid export row limit required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
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
      'reason', btrim(p_reason),
      'dataScope', p_data_scope
    )::text,
    'sha256'
  ), 'hex');

  with response_rows as (
    select
      'practice'::text as record_source,
      a.user_id,
      case when coalesce(u.is_anonymous, false) then null
        else u.email end::text as user_email,
      case
        when coalesce(u.is_anonymous, false)
          then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null
          then 'not_available'
        else 'available'
      end::text as email_status,
      a.id as attempt_id,
      a.question_bank_id::text as question_id,
      null::text as question_text,
      'external_question_bank_not_persisted'::text as question_text_source,
      'unavailable_exact_historic_text'::text as question_text_status,
      a.answer_text as submitted_answer,
      'available'::text as answer_status,
      a.score,
      case
        when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
          then 'ai'
        else 'ungraded'
      end::text as grade_source,
      a.score as ai_score,
      null::numeric as human_score,
      nullif(concat_ws(
        E'\n\n',
        nullif(a.assessment->>'rationale', ''),
        nullif(a.assessment->>'legalExplanation', '')
      ), '')::text as feedback_text,
      a.assessment as ai_feedback,
      null::text as human_feedback,
      case when a.assessment is null then 'not_persisted'
        when a.assessment = '{}'::jsonb then 'present_but_empty'
        else 'ai_assessment_available' end::text
        as feedback_status,
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
      a.subject::text as subject,
      'Mock Bar'::text as exam_title,
      'mock_bar'::text as exam_track,
      'single_question'::text as assessment_kind,
      null::text as exam_version_label,
      null::integer as exam_version_number,
      null::integer as question_ordinal,
      null::text as topic,
      null::integer as bar_year,
      null::text as question_number,
      null::text as difficulty,
      a.status::text as attempt_status,
      a.timer_mode::text as timer_mode,
      a.elapsed_seconds::integer as elapsed_seconds,
      null::boolean as flagged,
      null::integer as revision,
      null::text as human_review_status,
      a.provider_model::text as provider_or_grader_model,
      a.safe_error_code::text as safe_error_code,
      null::timestamptz as started_at,
      a.submitted_at as answer_saved_at,
      a.submitted_at,
      case when a.score is not null
             or (a.assessment is not null and a.assessment <> '{}'::jsonb)
        then a.completed_at else null end::timestamptz as graded_at,
      a.completed_at
    from public.exam_attempts a
    join auth.users u on u.id = a.user_id
    where nullif(btrim(a.answer_text), '') is not null
      and (p_from is null or a.submitted_at >= p_from)
      and (p_to is null or a.submitted_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)
      and private.admin_reporting_scope_matches(a.user_id, p_data_scope)

    union all

    select
      'formal_exam'::text,
      a.user_id,
      case when coalesce(u.is_anonymous, false) then null
        else u.email end::text,
      case
        when coalesce(u.is_anonymous, false)
          then 'anonymous_no_registered_email'
        when nullif(btrim(coalesce(u.email, '')), '') is null
          then 'not_available'
        else 'available'
      end::text,
      a.id,
      coalesce(nullif(q.source_key, ''), q.id::text)::text,
      vq.prompt_snapshot::text,
      'immutable_exam_snapshot'::text,
      'available_exact_attempt_snapshot'::text,
      r.answer_text,
      'available'::text,
      case
        when hr.finalized_at is not null then hr.score
        else aa.score
      end::numeric,
      case
        when hr.finalized_at is not null and aa.id is not null then 'human_and_ai'
        when hr.finalized_at is not null then 'human'
        when aa.id is not null then 'ai'
        when hr.assignment_id is not null then 'human_draft'
        else 'ungraded'
      end::text,
      aa.score::numeric,
      hr.score::numeric,
      coalesce(
        case when nullif(btrim(hr.comments), '') is null then null
          else hr.comments end,
        nullif(concat_ws(
          E'\n\n',
          nullif(aa.assessment_json->>'rationale', ''),
          nullif(aa.assessment_json->>'legalExplanation', '')
        ), '')
      )::text,
      aa.assessment_json,
      case when nullif(btrim(hr.comments), '') is null then null
        else hr.comments end::text,
      case
        when aa.id is not null and aa.assessment_json <> '{}'::jsonb
             and nullif(btrim(coalesce(hr.comments, '')), '') is not null
          then 'ai_and_human_feedback_available'
        when nullif(btrim(coalesce(hr.comments, '')), '') is not null
          then 'human_feedback_available'
        when aa.id is not null and aa.assessment_json <> '{}'::jsonb
          then 'ai_assessment_available'
        when aa.id is not null or hr.assignment_id is not null
          then 'present_but_empty'
        else 'not_persisted'
      end::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null then null
        else vq.model_answer_snapshot end::text,
      case when nullif(btrim(vq.model_answer_snapshot), '') is null then null
        else 'immutable_exam_snapshot' end::text,
      case when vq.model_answer_snapshot is null then 'not_persisted'
        when nullif(btrim(vq.model_answer_snapshot), '') is null then 'present_but_empty'
        else 'available_exact_attempt_snapshot' end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
            when 'string' then aa.assessment_json->>'modelAnswerALAC'
            else (aa.assessment_json->'modelAnswerALAC')::text
          end
        else null
      end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'persisted_ai_assessment_model_answer_alac'
        else null
      end::text,
      case
        when aa.assessment_json ? 'modelAnswerALAC'
             and aa.assessment_json->'modelAnswerALAC' <> 'null'::jsonb
             and case jsonb_typeof(aa.assessment_json->'modelAnswerALAC')
               when 'string' then nullif(btrim(aa.assessment_json->>'modelAnswerALAC'), '') is not null
               when 'object' then aa.assessment_json->'modelAnswerALAC' <> '{}'::jsonb
               when 'array' then aa.assessment_json->'modelAnswerALAC' <> '[]'::jsonb
               else true
             end
          then 'available_generated_assessment'
        else 'not_persisted'
      end::text,
      coalesce(d.subject, q.subject)::text,
      d.title::text,
      d.track::text,
      d.assessment_kind::text,
      v.label::text,
      v.version_number::integer,
      vq.ordinal::integer,
      q.topic::text,
      q.bar_year::integer,
      q.question_number::text,
      q.difficulty::text,
      a.status::text,
      a.timer_mode::text,
      a.elapsed_seconds::integer,
      r.flagged::boolean,
      r.revision::integer,
      hr.assignment_status::text,
      aa.grader_model::text,
      gj.safe_error_code::text,
      a.started_at,
      r.saved_at,
      a.submitted_at,
      greatest(aa.finalized_at, hr.finalized_at),
      null::timestamptz
    from public.examination_responses r
    join public.examination_attempts_multi a on a.id = r.attempt_id
    join auth.users u on u.id = a.user_id
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
        ea.status as assignment_status,
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
    left join lateral (
      select j.safe_error_code
      from public.examination_grading_jobs j
      where j.attempt_id = a.id
        and j.route = 'ai'
      order by j.completed_at desc nulls last, j.created_at desc
      limit 1
    ) gj on true
    where nullif(btrim(r.answer_text), '') is not null
      and (p_from is null or r.saved_at >= p_from)
      and (p_to is null or r.saved_at < p_to)
      and (p_target_user_id is null or a.user_id = p_target_user_id)
      and private.admin_reporting_scope_matches(a.user_id, p_data_scope)
  ), ordered_rows as (
    select
      rr.*,
      count(*) over () as total_count,
      row_number() over (
        order by rr.answer_saved_at desc, rr.record_source,
                 rr.attempt_id, rr.question_id
      ) as row_number
    from response_rows rr
  )
  select
    coalesce(max(o.total_count), 0),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'recordSource', o.record_source,
          'userId', o.user_id,
          'userEmail', o.user_email,
          'emailStatus', o.email_status,
          'attemptId', o.attempt_id,
          'questionId', o.question_id,
          'questionText', o.question_text,
          'questionTextSource', o.question_text_source,
          'questionTextStatus', o.question_text_status,
          'submittedAnswer', o.submitted_answer,
          'answerStatus', o.answer_status,
          'score', o.score,
          'gradeSource', o.grade_source,
          'aiScore', o.ai_score,
          'humanScore', o.human_score,
          'feedbackText', o.feedback_text,
          'aiFeedback', o.ai_feedback,
          'humanFeedback', o.human_feedback,
          'feedbackStatus', o.feedback_status,
          'suggestedAnswer', o.suggested_answer,
          'suggestedAnswerSource', o.suggested_answer_source,
          'suggestedAnswerStatus', o.suggested_answer_status,
          'modelAnswer', o.model_answer,
          'modelAnswerSource', o.model_answer_source,
          'modelAnswerStatus', o.model_answer_status,
          'subject', o.subject,
          'examTitle', o.exam_title,
          'examTrack', o.exam_track,
          'assessmentKind', o.assessment_kind,
          'examVersionLabel', o.exam_version_label,
          'examVersionNumber', o.exam_version_number,
          'questionOrdinal', o.question_ordinal,
          'topic', o.topic,
          'barYear', o.bar_year,
          'questionNumber', o.question_number,
          'difficulty', o.difficulty,
          'attemptStatus', o.attempt_status,
          'timerMode', o.timer_mode,
          'elapsedSeconds', o.elapsed_seconds,
          'flagged', o.flagged,
          'revision', o.revision,
          'humanReviewStatus', o.human_review_status,
          'providerOrGraderModel', o.provider_or_grader_model,
          'safeErrorCode', o.safe_error_code,
          'startedAt', o.started_at,
          'answerSavedAt', o.answer_saved_at,
          'submittedAt', o.submitted_at,
          'gradedAt', o.graded_at,
          'completedAt', o.completed_at
        ) order by o.row_number
      ) filter (where o.row_number <= p_limit),
      '[]'::jsonb
    )
  into v_total, v_items
  from ordered_rows o;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 1822));
  select a.details->>'requestFingerprint'
    into v_existing_fingerprint
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'answer_history_export_scoped_v1'
      and a.details->>'requestKey' = p_request_key;

  if found and v_existing_fingerprint is distinct from v_request_fingerprint then
    raise exception 'Export request key conflict';
  end if;

  if not found then
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_user_id,
      target_resource_type,
      target_resource_id,
      reason,
      details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      p_target_user_id,
      'answer_history_export_scoped_v1',
      coalesce(p_target_user_id::text, 'all_users'),
      btrim(p_reason),
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'scope', v_scope,
        'dateScope', v_date_scope,
        'from', p_from,
        'to', p_to,
        'resultCount', v_total,
        'tooMany', v_total > p_limit,
        'requestFingerprint', v_request_fingerprint
      )
    );
  end if;

  if v_total > p_limit then
    return jsonb_build_object(
    'dataScope', p_data_scope,
      'items', '[]'::jsonb,
      'total', v_total,
      'tooMany', true,
      'scope', v_scope,
      'dateScope', v_date_scope
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
    'items', v_items,
    'total', v_total,
    'tooMany', false,
    'scope', v_scope,
    'dateScope', v_date_scope
  );
end;
$$;

create or replace function private.admin_export_answer_history_with_context_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);

  v_result := private.admin_export_answer_history_core_scoped_v1(
    p_actor_user_id,
    p_target_user_id,
    p_from,
    p_to,
    p_limit,
    p_reason,
    p_request_key,
    p_data_scope
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

create or replace function public.admin_export_answer_history_scoped_v1(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_reason text,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);
  v_result := private.admin_export_answer_history_with_context_scoped_v1(
    p_actor_user_id, p_target_user_id, p_from, p_to,
    p_limit, p_reason, p_request_key, p_data_scope
  );

  select coalesce(
    jsonb_agg(
      e.item
      || public.admin_answer_source_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid,
        e.item->>'questionId'
      )
      || public.admin_answer_feature_context(
        e.item->>'recordSource',
        (e.item->>'attemptId')::uuid
      )
      order by e.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_result->'items', '[]'::jsonb))
    with ordinality as e(item, ordinality);

  return jsonb_set(v_result, '{items}', v_items, true)
    || jsonb_build_object('dataScope', p_data_scope);
end;
$$;


-- Scoped commerce and access ledgers.
create or replace function public.phase4_admin_operational_data_scoped_v1(
  p_actor_user_id uuid,
  p_section text,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_search text := lower(btrim(coalesce(p_search,'')));
  v_limit integer := greatest(1, least(coalesce(p_limit,50),100));
  v_offset integer := greatest(0,coalesce(p_offset,0));
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.phase4_require_founder(p_actor_user_id);

  if p_section = 'payments' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (
        select count(*)
        from public.payment_requests payment_count
        join auth.users user_count on user_count.id = payment_count.user_id
        left join public.profiles profile_count
          on profile_count.id = payment_count.user_id
        where private.admin_reporting_scope_matches(
            payment_count.user_id,
            p_data_scope
          )
          and (
            v_search = ''
            or lower(coalesce(profile_count.display_name, '')) like '%' || v_search || '%'
            or lower(coalesce(user_count.email, '')) like '%' || v_search || '%'
            or lower(payment_count.transaction_reference) like '%' || v_search || '%'
            or payment_count.id::text = v_search
          )
      )
    ) into v_result
    from (
      select p.id, p.user_id, pr.display_name, u.email,
        pr.school, pr.year_level, p.plan_code,
        p.trusted_amount_php, p.payment_method, p.payment_date,
        p.transaction_reference, p.status, p.submitted_at, p.reviewed_at,
        p.reviewed_by, p.review_reason, p.subscription_id,
        p.provisional_access_expires_at,
        p.proof_original_name, p.proof_mime_type, p.proof_size_bytes,
        p.verification_email_status, p.verification_email_attempts,
        p.verification_email_last_attempt_at, p.verification_email_sent_at,
        p.verification_email_error
      from public.payment_requests p
      join auth.users u on u.id = p.user_id
      left join public.profiles pr on pr.id = p.user_id
      where private.admin_reporting_scope_matches(p.user_id, p_data_scope)
        and (v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or lower(coalesce(u.email,'')) like '%'||v_search||'%'
         or lower(p.transaction_reference) like '%'||v_search||'%'
         or p.id::text = v_search)
      order by p.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'refunds' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.submitted_at desc),'[]'::jsonb),
      'total', (
        select count(*)
        from public.refund_requests refund_count
        left join public.profiles profile_count
          on profile_count.id = refund_count.user_id
        where private.admin_reporting_scope_matches(
            refund_count.user_id,
            p_data_scope
          )
          and (
            v_search = ''
            or lower(coalesce(profile_count.display_name, '')) like '%' || v_search || '%'
            or refund_count.id::text = v_search
          )
      )
    ) into v_result
    from (
      select r.id, r.user_id, pr.display_name, r.payment_request_id,
        r.status, r.paid_amount_php, r.suggested_refund_php,
        r.approved_refund_php, r.calculation_note, r.submitted_at,
        r.review_reason
      from public.refund_requests r
      left join public.profiles pr on pr.id = r.user_id
      where private.admin_reporting_scope_matches(r.user_id, p_data_scope)
        and (v_search = ''
         or lower(coalesce(pr.display_name,'')) like '%'||v_search||'%'
         or r.id::text = v_search)
      order by r.submitted_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'partnerships' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (
        select count(*)
        from public.partnership_inquiries inquiry_count
        where private.admin_reporting_scope_matches(
            inquiry_count.user_id,
            p_data_scope
          )
          and (
            v_search = ''
            or lower(inquiry_count.contact_name) like '%' || v_search || '%'
            or lower(inquiry_count.contact_email) like '%' || v_search || '%'
            or lower(coalesce(inquiry_count.organization, '')) like '%' || v_search || '%'
          )
      )
    ) into v_result
    from (
      select i.id, i.inquiry_type, i.contact_name, i.contact_email,
        i.organization, i.message, i.consent, i.contact_verified,
        i.status, i.assignee_user_id, i.created_at, i.updated_at
      from public.partnership_inquiries i
      where private.admin_reporting_scope_matches(i.user_id, p_data_scope)
        and (v_search = ''
         or lower(i.contact_name) like '%'||v_search||'%'
         or lower(i.contact_email) like '%'||v_search||'%'
         or lower(coalesce(i.organization,'')) like '%'||v_search||'%')
      order by i.created_at desc limit v_limit offset v_offset
    ) q;
  elsif p_section = 'access' then
    select jsonb_build_object(
      'items', coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc),'[]'::jsonb),
      'total', (
        select count(*)
        from public.profiles profile_count
        where private.admin_reporting_scope_matches(
            profile_count.id,
            p_data_scope
          )
          and (
            v_search = ''
            or lower(coalesce(profile_count.display_name, '')) like '%' || v_search || '%'
            or profile_count.id::text = v_search
          )
      )
    ) into v_result
    from (
      select p.id as user_id, p.display_name, p.created_at,
        coalesce(r.role,'student') as role,
        g.granted_at as introductory_tokens_granted_at,
        g.acknowledged_at as introductory_tokens_acknowledged_at,
        g.token_limit as introductory_token_limit,
        coalesce(t.used_tokens,0) as introductory_tokens_used,
        greatest(0,coalesce(g.token_limit,0)-coalesce(t.used_tokens,0))
          as introductory_tokens_remaining,
        b.enabled as free_beta_enabled, b.expires_at as free_beta_expires_at,
        s.id as subscription_id, s.plan_code, s.status as subscription_status,
        s.starts_at, s.expires_at
      from public.profiles p
      left join public.user_roles r on r.user_id = p.id
      left join public.introductory_token_grants g on g.user_id = p.id
      left join lateral (
        select count(*)::integer as used_tokens
        from public.introductory_token_ledger l
        where l.grant_id = g.id and l.event_type = 'consumed'
      ) t on true
      left join public.free_beta_access b on b.user_id = p.id
      left join lateral (
        select * from public.subscriptions x where x.user_id=p.id
        order by x.updated_at desc limit 1
      ) s on true
      where private.admin_reporting_scope_matches(p.id, p_data_scope)
        and (v_search = ''
         or lower(coalesce(p.display_name,'')) like '%'||v_search||'%'
         or p.id::text = v_search)
      order by p.created_at desc limit v_limit offset v_offset
    ) q;
  else
    raise exception 'Unsupported Phase 4 administrator section';
  end if;

  insert into public.admin_audit_log (
    actor_user_id, action_type, target_resource_type, target_resource_id,
    reason, details
  ) values (
    p_actor_user_id, 'sensitive_data_viewed', 'phase4_admin_section_scoped_v1', p_section,
    'Authorized Founder administration data view.',
    jsonb_build_object(
      'section',p_section,
      'dataScope',p_data_scope,
      'resultCount',jsonb_array_length(coalesce(v_result->'items','[]'::jsonb))
    )
  );
  return coalesce(v_result,jsonb_build_object('items','[]'::jsonb,'total',0))
    || jsonb_build_object('dataScope', p_data_scope);
end;
$$;


-- Scoped account directories and exports.
create or replace function private.admin_user_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_max_limit integer;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_result_count integer := 0;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid directory request key required';
  end if;
  if p_access_purpose not in ('dashboard', 'csv_export') then
    raise exception 'Valid directory access purpose required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Directory search is too long';
  end if;

  v_max_limit := case when p_access_purpose = 'csv_export' then 5000 else 100 end;
  v_limit := least(greatest(coalesce(p_limit, 100), 1), v_max_limit);
  if p_access_purpose = 'csv_export' and v_offset <> 0 then
    raise exception 'Directory export offset is not allowed';
  end if;

  select count(*) into v_total
  from auth.users u
  left join public.profiles p on p.id = u.id
  where coalesce(u.is_anonymous, false) = false
    and private.admin_reporting_scope_matches(u.id, p_data_scope)
    and (
      v_search is null
      or p.display_name ilike '%' || v_search || '%'
      or p.school ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%'
    );

  if p_access_purpose <> 'csv_export' or v_total <= v_limit then
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      into v_items
    from (
    select
      u.id,
      p.display_name,
      u.email,
      p.school,
      p.enrollment_status,
      p.year_level,
      coalesce(p.created_at, u.created_at) as created_at,
      p.profile_completed_at,
      coalesce(r.role, 'student') as role,
      e.plan_code,
      e.status as entitlement_status,
      (
        select max(s.last_seen_at)
        from public.usage_sessions s
        where s.user_id = u.id
      ) as last_active_at,
      (
        select count(*)
        from public.usage_sessions s
        where s.user_id = u.id
      ) as session_count,
      (
        select count(*)
        from public.usage_events ev
        left join public.usage_sessions event_session
          on event_session.id = ev.session_id
        where private.admin_usage_event_owner(ev.user_id, event_session.user_id) = u.id
          and ev.event_type = 'grading_success'
      ) as successful_grade_count,
      (
        select mc.opted_in
        from public.marketing_consents mc
        where mc.user_id = u.id
        order by mc.changed_at desc
        limit 1
      ) as marketing_consent
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles r on r.user_id = u.id
    left join public.user_entitlements e on e.user_id = u.id
    where coalesce(u.is_anonymous, false) = false
      and private.admin_reporting_scope_matches(u.id, p_data_scope)
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    order by coalesce(p.created_at, u.created_at) desc
    limit v_limit offset v_offset
    ) x;
  end if;

  v_result_count := jsonb_array_length(v_items);
  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 1901));
  if not exists (
    select 1
    from public.admin_audit_log
    where actor_user_id = p_actor_user_id
      and action_type = 'sensitive_data_viewed'
      and target_resource_type = 'admin_user_directory_scoped_v1'
      and details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_user_directory_scoped_v1',
      p_access_purpose,
      case p_access_purpose
        when 'csv_export' then 'Authorized user directory CSV export'
        else 'Authorized Students dashboard directory view'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'purpose', p_access_purpose,
        'searchApplied', v_search is not null,
        'limit', v_limit,
        'offset', v_offset,
        'resultCount', v_result_count,
        'totalCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'items', v_items,
    'hasMore', v_offset + v_result_count < v_total,
    'tooMany', p_access_purpose = 'csv_export' and v_total > v_limit
  );
end;
$$;

create or replace function private.admin_user_engagement_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
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
      'offset', v_offset,
      'dataScope', p_data_scope
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
    and a.target_resource_type = 'admin_user_engagement_directory_scoped_v1_request'
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
      'admin_user_engagement_directory_scoped_v1_request',
      v_access_purpose,
      case v_access_purpose
        when 'csv_export' then 'Authorized user-list download request'
        else 'Authorized Admin user-list view request'
      end,
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
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

  v_directory := private.admin_user_directory_scoped_v1(
    p_actor_user_id,
    v_search,
    v_limit,
    v_offset,
    p_request_key,
    v_access_purpose,
    p_data_scope
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
  left join private.admin_user_answer_counts_scoped_v1(p_data_scope) c on c.user_id = u.id
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

create or replace function public.admin_user_monitoring_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_access_purpose text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_directory jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  -- The established directory performs capability authorization, validates
  -- request bounds, returns exact emails, and writes the sensitive-access log.
  v_directory := private.admin_user_engagement_directory_scoped_v1(
    p_actor_user_id,
    p_search,
    p_limit,
    p_offset,
    p_request_key,
    p_access_purpose,
    p_data_scope
  );

  select coalesce(
    jsonb_agg(
      d.item || jsonb_strip_nulls(jsonb_build_object(
        'current_region', case
          when signin.region is not null and signin.country_code is not null
            then signin.region || ', ' || signin.country_code
          else coalesce(signin.region, signin.country_code)
        end,
        'current_device_category', coalesce(signin.device_category, session.device_category),
        'current_browser', signin.browser,
        'current_operating_system', signin.operating_system,
        'current_language', signin.language,
        'monitoring_recorded_at', coalesce(signin.signed_in_at, session.last_seen_at)
      ))
      order by d.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
  left join lateral (
    select
      e.signed_in_at,
      e.device_category,
      e.browser,
      e.operating_system,
      e.region,
      e.country_code,
      e.language
    from public.user_sign_in_events e
    where e.user_id = (d.item->>'id')::uuid
    order by e.signed_in_at desc, e.id desc
    limit 1
  ) signin on true
  left join lateral (
    select s.device_category, s.last_seen_at
    from public.usage_sessions s
    where s.user_id = (d.item->>'id')::uuid
    order by s.last_seen_at desc, s.id desc
    limit 1
  ) session on true;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

create or replace function public.admin_prepare_user_directory_email_export_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_limit integer,
  p_recipient_key text,
  p_reason text,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
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
      'reason', v_reason,
      'dataScope', p_data_scope
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
      'dataScope', p_data_scope,
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
      'dataScope', p_data_scope,
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

  v_result := private.admin_user_engagement_directory_scoped_v1(
    p_actor_user_id,
    v_search,
    v_limit,
    0,
    p_request_key,
    'csv_export',
    p_data_scope
  );

  return v_result || jsonb_build_object(
    'recipientKey', p_recipient_key,
    'dataScope', p_data_scope,
    'alreadyPrepared', false
  );
end;
$$;


create or replace function public.admin_overview_engagement_metrics_scoped_v1(
  p_actor_user_id uuid,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;

  select count(*) into v_signed_in_accounts
  from auth.users u
  where coalesce(u.is_anonymous, false) = false
    and u.last_sign_in_at is not null
    and private.admin_learner_reporting_scope_matches(u.id, p_data_scope);

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
  from private.admin_user_answer_counts_scoped_v1(p_data_scope) c;

  select count(*) into v_active_5
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '5 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and private.admin_learner_reporting_scope_matches(u.id, p_data_scope);

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and private.admin_learner_reporting_scope_matches(u.id, p_data_scope);

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
      and private.admin_learner_reporting_scope_matches(u.id, p_data_scope)
    group by public.admin_subscription_category(u.id)
  ) c;

  return jsonb_build_object(
    'dataScope', p_data_scope,
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

create or replace function public.admin_live_activity_scoped_v1(
  p_actor_user_id uuid,
  p_limit integer,
  p_request_key text,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
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
      and a.target_resource_type = 'admin_live_activity_scoped_v1'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce(a.details->>'dataScope', '') <> p_data_scope
      )
  ) then
    raise exception 'Activity request key was already used for a different request';
  end if;

  select count(*) into v_active_5
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '5 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and private.admin_learner_reporting_scope_matches(u.id, p_data_scope);

  select count(*) into v_active_30
  from public.usage_sessions s
  join auth.users u on u.id = s.user_id
  where s.last_seen_at >= now() - interval '30 minutes'
    and s.ended_at is null
    and coalesce(u.is_anonymous, false) = false
    and private.admin_learner_reporting_scope_matches(u.id, p_data_scope);

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_live_activity_scoped_v1'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_resource_type,
      target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_live_activity_scoped_v1',
      'last_30_minutes',
      'Authorized Admin activity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'active5Minutes', v_active_5,
        'active30Minutes', v_active_30,
        'limit', v_limit,
        'resultCount', 0,
        'identityRowsWithheld', true
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
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

create or replace function public.admin_dashboard_snapshot_scoped_v1(
  p_actor_user_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_previous_from timestamptz,
  p_previous_to timestamptz,
  p_data_scope text
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
  perform private.require_admin_data_scope(p_data_scope);
  v_auth := public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;
  if p_previous_from is null or p_previous_to is null then
    raise exception 'Comparison window is required';
  end if;

  v_current := private.admin_period_metrics_scoped_v1(p_from, p_to, p_data_scope);
  v_previous := private.admin_period_metrics_scoped_v1(p_previous_from, p_previous_to, p_data_scope);

  select least(
    coalesce((select min(started_at) from private.admin_scoped_usage_sessions(p_data_scope)), 'infinity'::timestamptz),
    coalesce((select min(occurred_at) from private.admin_scoped_usage_events(p_data_scope)), 'infinity'::timestamptz)
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
    from private.admin_scoped_usage_events(p_data_scope)
    where occurred_at >= p_from and occurred_at < p_to
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
    from private.admin_scoped_usage_events(p_data_scope)
    where occurred_at >= p_from and occurred_at < p_to
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
    from private.admin_scoped_usage_sessions(p_data_scope)
    where started_at >= p_from and started_at < p_to
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
    from private.admin_scoped_usage_sessions(p_data_scope)
    where started_at >= p_from and started_at < p_to
    group by coalesce(device_category, 'unknown')
  ) d;

  return jsonb_build_object(
    'dataScope', p_data_scope,
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
        from private.admin_scoped_usage_sessions(p_data_scope)
        where ended_at is null
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

-- Scoped recent sign-in and recent-use ledgers.
create or replace function public.admin_recent_sign_in_directory_scoped_v1(
  p_actor_user_id uuid,
  p_limit integer,
  p_request_key text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 7), 1), 25);
  v_items jsonb := '[]'::jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid recent-sign-in request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260823));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce(a.details->>'dataScope', '') <> p_data_scope
      )
  ) then
    raise exception 'Recent-sign-in request key conflict';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.last_sign_in_at desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      u.id,
      p.display_name,
      u.email,
      p.school,
      coalesce(r.role::text, 'student') as role,
      case
        when signin.signed_in_at is null then u.last_sign_in_at
        when u.last_sign_in_at is null then signin.signed_in_at
        else greatest(signin.signed_in_at, u.last_sign_in_at)
      end as last_sign_in_at,
      signin.signed_in_at as monitoring_recorded_at,
      case
        when signin.region is not null and signin.country_code is not null
          then signin.region || ', ' || signin.country_code
        else coalesce(signin.region, signin.country_code)
      end as current_region,
      coalesce(signin.device_category, session.device_category) as current_device_category,
      signin.browser as current_browser,
      signin.operating_system as current_operating_system,
      signin.language as current_language,
      coalesce(counts.answered_question_count, 0) as answered_question_count,
      greatest(
        0,
        coalesce(token_grant.token_limit, 0) - coalesce(token_usage.used_tokens, 0)
      ) as free_grades_remaining,
      coalesce(beta.enabled, false) as free_beta_enabled,
      beta.expires_at as free_beta_expires_at,
      subscription.plan_code as subscription_plan,
      subscription.status as subscription_status,
      subscription.starts_at as subscription_starts_at,
      subscription.expires_at as subscription_expires_at,
      public.admin_subscription_category(u.id) as subscription_category,
      case
        when coalesce(r.role::text, 'student') in ('admin', 'founder_admin', 'super_admin')
          then 'Admin & Staff access'
        when coalesce(beta.enabled, false)
          and (beta.expires_at is null or beta.expires_at > now())
          then 'Founding Beta'
        when subscription.status = 'active'
          and subscription.starts_at <= now()
          and (subscription.expires_at is null or subscription.expires_at > now())
          then 'Active subscription'
        else 'Introductory access'
      end as effective_access
    from auth.users u
    left join public.profiles p on p.id = u.id
    left join public.user_roles r on r.user_id = u.id
    left join private.admin_user_answer_counts_scoped_v1(p_data_scope) counts on counts.user_id = u.id
    left join public.introductory_token_grants token_grant on token_grant.user_id = u.id
    left join lateral (
      select count(*)::integer as used_tokens
      from public.introductory_token_ledger ledger
      where ledger.grant_id = token_grant.id
        and ledger.event_type = 'consumed'
    ) token_usage on true
    left join public.free_beta_access beta on beta.user_id = u.id
    left join lateral (
      select
        s.plan_code,
        s.status,
        s.starts_at,
        s.expires_at
      from public.subscriptions s
      where s.user_id = u.id
      order by s.updated_at desc, s.created_at desc
      limit 1
    ) subscription on true
    left join lateral (
      select
        e.signed_in_at,
        e.device_category,
        e.browser,
        e.operating_system,
        e.region,
        e.country_code,
        e.language
      from public.user_sign_in_events e
      where e.user_id = u.id
      order by e.signed_in_at desc, e.id desc
      limit 1
    ) signin on true
    left join lateral (
      select s.device_category, s.last_seen_at
      from public.usage_sessions s
      where s.user_id = u.id
      order by s.last_seen_at desc, s.id desc
      limit 1
    ) session on true
    where coalesce(u.is_anonymous, false) = false
      and private.admin_reporting_scope_matches(u.id, p_data_scope)
      and coalesce(signin.signed_in_at, u.last_sign_in_at) is not null
    order by
      case
        when signin.signed_in_at is null then u.last_sign_in_at
        when u.last_sign_in_at is null then signin.signed_in_at
        else greatest(signin.signed_in_at, u.last_sign_in_at)
      end desc
    limit v_limit
  ) q;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_sign_in_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_resource_type,
      target_resource_id,
      reason,
      details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_recent_sign_in_directory_scoped_v1',
      'executive_pulse',
      'Authorized recent sign-in monitoring view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'limit', v_limit,
        'resultCount', jsonb_array_length(v_items)
      )
    );
  end if;

  return jsonb_build_object(
    'dataScope', p_data_scope,
    'items', v_items,
    'limit', v_limit,
    'total', jsonb_array_length(v_items)
  );
end;
$$;

create or replace function public.admin_recent_user_activity_directory_scoped_v1(
  p_actor_user_id uuid,
  p_search text,
  p_from timestamptz,
  p_to timestamptz,
  p_limit integer,
  p_offset integer,
  p_request_key text,
  p_data_scope text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_to timestamptz := least(coalesce(p_to, now()), now() + interval '5 minutes');
  v_from timestamptz := coalesce(p_from, least(coalesce(p_to, now()), now()) - interval '30 days');
  v_limit integer := least(greatest(coalesce(p_limit, 100), 1), 100);
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_total bigint := 0;
  v_unique_users bigint := 0;
  v_active_now bigint := 0;
  v_average_duration_seconds bigint := 0;
  v_total_duration_seconds bigint := 0;
  v_items jsonb := '[]'::jsonb;
  v_daily_activity jsonb := '[]'::jsonb;
  v_activity_mix jsonb := '[]'::jsonb;
begin
  perform private.require_admin_data_scope(p_data_scope);
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;
  if char_length(coalesce(v_search, '')) > 180 then
    raise exception 'Recent user search exceeds 180 characters';
  end if;
  if v_to <= v_from or v_to - v_from > interval '366 days' then
    raise exception 'Recent user reporting window is invalid';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid recent user request key required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 20260824));
  if exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_user_activity_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
      and (
        coalesce((a.details->>'limit')::integer, -1) <> v_limit
        or coalesce((a.details->>'offset')::integer, -1) <> v_offset
        or coalesce(a.details->>'from', '') <> v_from::text
        or coalesce(a.details->>'to', '') <> v_to::text
        or coalesce(a.details->>'searchFingerprint', '') <> md5(coalesce(v_search, ''))
        or coalesce(a.details->>'dataScope', '') <> p_data_scope
      )
  ) then
    raise exception 'Recent user request key conflict';
  end if;

  with filtered as materialized (
    select
      s.id,
      s.user_id,
      s.started_at,
      coalesce(s.last_seen_at, s.started_at) as last_activity_at,
      s.ended_at,
      greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )::bigint as duration_seconds
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.user_id is not null
      and private.admin_reporting_scope_matches(s.user_id, p_data_scope)
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
  )
  select
    count(*),
    count(distinct user_id),
    count(*) filter (
      where ended_at is null
        and last_activity_at >= now() - interval '5 minutes'
    ),
    coalesce(round(avg(duration_seconds)), 0)::bigint,
    coalesce(sum(duration_seconds), 0)::bigint
  into
    v_total,
    v_unique_users,
    v_active_now,
    v_average_duration_seconds,
    v_total_duration_seconds
  from filtered;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.last_activity_at desc, q.session_id desc),
    '[]'::jsonb
  )
  into v_items
  from (
    select
      s.id as session_id,
      s.user_id,
      coalesce(nullif(btrim(p.display_name), ''), 'Not provided') as display_name,
      u.email,
      coalesce(nullif(btrim(p.school), ''), 'Not provided') as school,
      coalesce(r.role::text, 'student') as role,
      s.started_at,
      coalesce(s.last_seen_at, s.started_at) as last_activity_at,
      s.ended_at,
      greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )::bigint as duration_seconds,
      (
        s.ended_at is null
        and coalesce(s.last_seen_at, s.started_at) >= now() - interval '5 minutes'
      ) as active_now,
      latest.event_type as latest_event_type,
      latest.page_area as latest_page_area,
      latest.result_category as latest_result_category,
      latest.occurred_at as latest_event_at,
      coalesce(activity.event_count, 0) as event_count,
      coalesce(activity.questions_answered, 0) as questions_answered,
      case
        when signin.region is not null and signin.country_code is not null
          then signin.region || ', ' || signin.country_code
        else coalesce(signin.region, signin.country_code)
      end as current_region,
      coalesce(signin.device_category, s.device_category) as current_device_category,
      signin.browser as current_browser,
      signin.operating_system as current_operating_system,
      public.admin_subscription_category(s.user_id) as subscription_category,
      greatest(
        0,
        coalesce(token_grant.token_limit, 0) - coalesce(token_usage.used_tokens, 0)
      ) as free_grades_remaining,
      case
        when coalesce(r.role::text, 'student') in ('admin', 'founder_admin', 'super_admin')
          then 'Administrator'
        when coalesce(beta.enabled, false)
          and (beta.expires_at is null or beta.expires_at > now())
          then 'Founding Beta'
        when subscription.status = 'active'
          and subscription.starts_at <= now()
          and (subscription.expires_at is null or subscription.expires_at > now())
          then 'Paid access'
        else 'Introductory access'
      end as effective_access
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    left join public.user_roles r on r.user_id = s.user_id
    left join public.free_beta_access beta on beta.user_id = s.user_id
    left join public.introductory_token_grants token_grant on token_grant.user_id = s.user_id
    left join lateral (
      select count(*)::integer as used_tokens
      from public.introductory_token_ledger ledger
      where ledger.grant_id = token_grant.id
        and ledger.event_type = 'consumed'
    ) token_usage on true
    left join lateral (
      select
        sub.status,
        sub.starts_at,
        sub.expires_at
      from public.subscriptions sub
      where sub.user_id = s.user_id
      order by sub.updated_at desc, sub.created_at desc
      limit 1
    ) subscription on true
    left join lateral (
      select
        e.signed_in_at,
        e.device_category,
        e.browser,
        e.operating_system,
        e.region,
        e.country_code
      from public.user_sign_in_events e
      where e.user_id = s.user_id
        and e.signed_in_at >= s.started_at - interval '1 hour'
        and e.signed_in_at <= coalesce(s.last_seen_at, s.started_at) + interval '5 minutes'
      order by e.signed_in_at desc, e.id desc
      limit 1
    ) signin on true
    left join lateral (
      select
        e.event_type,
        e.page_area,
        e.result_category,
        e.occurred_at
      from public.usage_events e
      where e.session_id = s.id
        and private.admin_usage_event_owner(e.user_id, s.user_id) = s.user_id
        and private.admin_reporting_scope_matches(
          private.admin_usage_event_owner(e.user_id, s.user_id),
          p_data_scope
        )
      order by e.occurred_at desc, e.id desc
      limit 1
    ) latest on true
    left join lateral (
      select
        count(*)::integer as event_count,
        count(*) filter (where e.event_type = 'grading_success')::integer as questions_answered
      from public.usage_events e
      where e.session_id = s.id
        and private.admin_usage_event_owner(e.user_id, s.user_id) = s.user_id
        and private.admin_reporting_scope_matches(
          private.admin_usage_event_owner(e.user_id, s.user_id),
          p_data_scope
        )
    ) activity on true
    where s.user_id is not null
      and private.admin_reporting_scope_matches(s.user_id, p_data_scope)
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    order by coalesce(s.last_seen_at, s.started_at) desc, s.id desc
    limit v_limit offset v_offset
  ) q;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.activity_date),
    '[]'::jsonb
  )
  into v_daily_activity
  from (
    select
      (coalesce(s.last_seen_at, s.started_at) at time zone 'Asia/Manila')::date as activity_date,
      count(*)::integer as sessions,
      count(distinct s.user_id)::integer as users,
      coalesce(sum(greatest(
        0,
        extract(epoch from (coalesce(s.ended_at, s.last_seen_at, s.started_at) - s.started_at))
      )), 0)::bigint as duration_seconds
    from public.usage_sessions s
    join auth.users u on u.id = s.user_id
    left join public.profiles p on p.id = s.user_id
    where s.user_id is not null
      and private.admin_reporting_scope_matches(s.user_id, p_data_scope)
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and coalesce(s.last_seen_at, s.started_at) >= v_from
      and coalesce(s.last_seen_at, s.started_at) < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    group by 1
    order by 1
  ) q;

  select coalesce(
    jsonb_agg(to_jsonb(q) order by q.event_count desc, q.event_type),
    '[]'::jsonb
  )
  into v_activity_mix
  from (
    select
      e.event_type,
      count(*)::integer as event_count
    from public.usage_events e
    join public.usage_sessions s on s.id = e.session_id
    join auth.users u on u.id = private.admin_usage_event_owner(
      e.user_id,
      s.user_id
    )
    left join public.profiles p on p.id = u.id
    where private.admin_reporting_scope_matches(
        private.admin_usage_event_owner(e.user_id, s.user_id),
        p_data_scope
      )
      and s.auth_state = 'signed_in'
      and coalesce(u.is_anonymous, false) = false
      and e.occurred_at >= v_from
      and e.occurred_at < v_to
      and (
        v_search is null
        or p.display_name ilike '%' || v_search || '%'
        or p.school ilike '%' || v_search || '%'
        or u.email ilike '%' || v_search || '%'
      )
    group by e.event_type
    order by count(*) desc, e.event_type
    limit 8
  ) q;

  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_recent_user_activity_directory_scoped_v1'
      and a.details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id,
      action_type,
      target_resource_type,
      target_resource_id,
      reason,
      details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      'admin_recent_user_activity_directory_scoped_v1',
      'recent_users',
      'Authorized recent user activity view',
      jsonb_build_object(
        'requestKey', p_request_key,
        'dataScope', p_data_scope,
        'from', v_from::text,
        'to', v_to::text,
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
    'dataScope', p_data_scope,
    'generatedAt', now(),
    'from', v_from,
    'to', v_to,
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'hasMore', v_offset + jsonb_array_length(v_items) < v_total,
    'summary', jsonb_build_object(
      'uniqueUsers', v_unique_users,
      'sessions', v_total,
      'activeNow', v_active_now,
      'averageDurationSeconds', v_average_duration_seconds,
      'totalDurationSeconds', v_total_duration_seconds
    ),
    'dailyActivity', v_daily_activity,
    'activityMix', v_activity_mix,
    'items', v_items
  );
end;
$$;

-- Private implementation functions are never Data API entry points.
revoke all on function private.admin_user_answer_counts_scoped_v1(text)
  from public, anon, authenticated, service_role;
revoke all on function private.admin_period_metrics_scoped_v1(
  timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_preview_answer_history_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_preview_answer_history_with_sources_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_export_answer_history_core_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_export_answer_history_with_context_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_user_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function private.admin_user_engagement_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;

-- Public reporting RPCs are service-role-only and retain in-function founder
-- or capability checks. No browser role receives direct execution rights.
revoke all on function public.admin_dashboard_snapshot_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_overview_engagement_metrics_scoped_v1(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_live_activity_scoped_v1(uuid, integer, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.admin_user_monitoring_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_prepare_user_directory_email_export_scoped_v1(
  uuid, text, integer, text, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_recent_sign_in_directory_scoped_v1(
  uuid, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_recent_user_activity_directory_scoped_v1(
  uuid, text, timestamptz, timestamptz, integer, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_preview_answer_history_by_feature_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.admin_export_answer_history_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, integer, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.phase4_admin_operational_data_scoped_v1(
  uuid, text, text, integer, integer, text
) from public, anon, authenticated, service_role;

grant execute on function public.admin_dashboard_snapshot_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) to service_role;
grant execute on function public.admin_overview_engagement_metrics_scoped_v1(uuid, text)
  to service_role;
grant execute on function public.admin_live_activity_scoped_v1(uuid, integer, text, text)
  to service_role;
grant execute on function public.admin_user_monitoring_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) to service_role;
grant execute on function public.admin_prepare_user_directory_email_export_scoped_v1(
  uuid, text, integer, text, text, text, text
) to service_role;
grant execute on function public.admin_recent_sign_in_directory_scoped_v1(
  uuid, integer, text, text
) to service_role;
grant execute on function public.admin_recent_user_activity_directory_scoped_v1(
  uuid, text, timestamptz, timestamptz, integer, integer, text, text
) to service_role;
grant execute on function public.admin_preview_answer_history_by_feature_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text, text
) to service_role;
grant execute on function public.admin_export_answer_history_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, integer, text, text, text
) to service_role;
grant execute on function public.phase4_admin_operational_data_scoped_v1(
  uuid, text, text, integer, integer, text
) to service_role;

comment on function public.admin_dashboard_snapshot_scoped_v1(
  uuid, timestamptz, timestamptz, timestamptz, timestamptz, text
) is 'Capability-restricted dashboard snapshot partitioned into regular or internal_test immutable-user-id data.';
comment on function public.admin_user_monitoring_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) is 'Audited administrator directory partitioned by explicit immutable-user-id reporting scope.';
comment on function public.admin_preview_answer_history_by_feature_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, text, text, integer, integer, text, text
) is 'Founder-only answer history partitioned by immutable-user-id reporting scope and website feature.';
comment on function public.admin_export_answer_history_scoped_v1(
  uuid, uuid, timestamptz, timestamptz, integer, text, text, text
) is 'Founder-only audited answer export partitioned by immutable-user-id reporting scope.';
comment on function public.phase4_admin_operational_data_scoped_v1(
  uuid, text, text, integer, integer, text
) is 'Founder-only payment, refund, partnership, and access ledgers partitioned by immutable-user-id reporting scope.';

commit;
