-- Admin performance fix: keep the existing API, authorization, audit logging,
-- search, pagination, and response fields while replacing repeated per-user
-- scans with set-based aggregation limited to the visible directory page.

begin;

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
  v_scope text;
  v_limit integer;
  v_offset integer := greatest(coalesce(p_offset, 0), 0);
  v_max_limit integer;
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_result_count integer := 0;
begin
  v_scope := private.require_admin_data_scope(p_data_scope);
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
  left join private.internal_test_accounts classified on classified.user_id = u.id
  where coalesce(u.is_anonymous, false) = false
    and case
      when v_scope = 'internal_test' then classified.user_id is not null
      else classified.user_id is null
    end
    and (
      v_search is null
      or p.display_name ilike '%' || v_search || '%'
      or p.school ilike '%' || v_search || '%'
      or u.email ilike '%' || v_search || '%'
    );

  if p_access_purpose <> 'csv_export' or v_total <= v_limit then
    with page_users as materialized (
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
        e.status as entitlement_status
      from auth.users u
      left join public.profiles p on p.id = u.id
      left join public.user_roles r on r.user_id = u.id
      left join public.user_entitlements e on e.user_id = u.id
      left join private.internal_test_accounts classified on classified.user_id = u.id
      where coalesce(u.is_anonymous, false) = false
        and case
          when v_scope = 'internal_test' then classified.user_id is not null
          else classified.user_id is null
        end
        and (
          v_search is null
          or p.display_name ilike '%' || v_search || '%'
          or p.school ilike '%' || v_search || '%'
          or u.email ilike '%' || v_search || '%'
        )
      order by coalesce(p.created_at, u.created_at) desc
      limit v_limit offset v_offset
    ),
    session_stats as materialized (
      select
        s.user_id,
        max(s.last_seen_at) as last_active_at,
        count(*)::bigint as session_count
      from public.usage_sessions s
      join page_users page_user on page_user.id = s.user_id
      group by s.user_id
    ),
    grade_counts as materialized (
      select
        grade_event.owner_id,
        count(*)::bigint as successful_grade_count
      from (
        select coalesce(ev.user_id, event_session.user_id) as owner_id
        from public.usage_events ev
        left join public.usage_sessions event_session
          on event_session.id = ev.session_id
        where ev.event_type = 'grading_success'
      ) grade_event
      join page_users page_user on page_user.id = grade_event.owner_id
      group by grade_event.owner_id
    )
    select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc), '[]'::jsonb)
      into v_items
    from (
      select
        page_user.id,
        page_user.display_name,
        page_user.email,
        page_user.school,
        page_user.enrollment_status,
        page_user.year_level,
        page_user.created_at,
        page_user.profile_completed_at,
        page_user.role,
        page_user.plan_code,
        page_user.entitlement_status,
        session_stats.last_active_at,
        coalesce(session_stats.session_count, 0)::bigint as session_count,
        coalesce(grade_counts.successful_grade_count, 0)::bigint as successful_grade_count,
        consent.opted_in as marketing_consent
      from page_users page_user
      left join session_stats on session_stats.user_id = page_user.id
      left join grade_counts on grade_counts.owner_id = page_user.id
      left join lateral (
        select mc.opted_in
        from public.marketing_consents mc
        where mc.user_id = page_user.id
        order by mc.changed_at desc
        limit 1
      ) consent on true
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

  with directory_items as materialized (
    select
      d.item,
      d.ordinality,
      (d.item->>'id')::uuid as user_id
    from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
      with ordinality as d(item, ordinality)
  ),
  target_users as materialized (
    select distinct user_id from directory_items
  ),
  answer_events as (
    select
      attempt.user_id,
      1::bigint as practice_count,
      0::bigint as examination_count,
      attempt.submitted_at as answered_at
    from public.exam_attempts attempt
    join target_users target on target.user_id = attempt.user_id
    where nullif(btrim(attempt.answer_text), '') is not null

    union all

    select
      attempt.user_id,
      0::bigint,
      1::bigint,
      response.saved_at
    from public.examination_responses response
    join public.examination_attempts_multi attempt
      on attempt.id = response.attempt_id
    join target_users target on target.user_id = attempt.user_id
    where nullif(btrim(response.answer_text), '') is not null
  ),
  answer_counts as materialized (
    select
      answer_event.user_id,
      sum(answer_event.practice_count)::bigint as practice_answered,
      sum(answer_event.examination_count)::bigint as examination_answered,
      count(*)::bigint as answered_question_count,
      max(answer_event.answered_at) as last_answered_at
    from answer_events answer_event
    group by answer_event.user_id
  ),
  practice_scores as (
    select
      attempt.user_id,
      attempt.score::numeric as score,
      coalesce(attempt.completed_at, attempt.submitted_at) as graded_at
    from public.exam_attempts attempt
    join target_users target on target.user_id = attempt.user_id
    where attempt.score is not null
      and nullif(btrim(attempt.answer_text), '') is not null
  ),
  formal_scores as (
    select
      attempt.user_id,
      case
        when human_review.finalized_at is not null then human_review.score
        else ai_assessment.score
      end::numeric as score,
      case
        when human_review.finalized_at is not null then human_review.finalized_at
        else ai_assessment.finalized_at
      end as graded_at
    from public.examination_responses response
    join public.examination_attempts_multi attempt
      on attempt.id = response.attempt_id
    join target_users target on target.user_id = attempt.user_id
    left join public.examination_ai_assessments ai_assessment
      on ai_assessment.attempt_id = attempt.id
     and ai_assessment.question_id = response.question_id
    left join lateral (
      select examiner_review.score, examiner_review.finalized_at
      from public.examination_examiner_assignments examiner_assignment
      join public.examination_examiner_reviews examiner_review
        on examiner_review.assignment_id = examiner_assignment.id
       and examiner_review.question_id = response.question_id
      where examiner_assignment.attempt_id = attempt.id
      order by
        (examiner_review.finalized_at is not null) desc,
        examiner_review.finalized_at desc nulls last,
        examiner_review.saved_at desc,
        examiner_assignment.created_at desc
      limit 1
    ) human_review on true
    where nullif(btrim(response.answer_text), '') is not null
      and case
        when human_review.finalized_at is not null then human_review.score
        else ai_assessment.score
      end is not null
  ),
  all_scores as (
    select * from practice_scores
    union all
    select * from formal_scores
  ),
  score_counts as materialized (
    select
      score_row.user_id,
      count(*)::bigint as graded_answer_count,
      round(avg(score_row.score), 1) as average_score,
      (array_agg(score_row.score order by score_row.graded_at desc))[1] as latest_score,
      max(score_row.graded_at) as last_graded_at
    from all_scores score_row
    group by score_row.user_id
  )
  select coalesce(
    jsonb_agg(
      (directory_item.item - 'last_active_at' - 'session_count') || jsonb_strip_nulls(jsonb_build_object(
        'last_sign_in_at', auth_user.last_sign_in_at,
        'has_signed_in', auth_user.last_sign_in_at is not null,
        'practice_answered_count', coalesce(answer_count.practice_answered, 0),
        'examination_answered_count', coalesce(answer_count.examination_answered, 0),
        'answered_question_count', coalesce(answer_count.answered_question_count, 0),
        'last_answered_at', answer_count.last_answered_at,
        'graded_answer_count', coalesce(score_count.graded_answer_count, 0),
        'average_score', score_count.average_score,
        'latest_score', score_count.latest_score,
        'last_graded_at', score_count.last_graded_at,
        'subscription_category', case
          when coalesce((directory_item.item->>'role') in ('admin', 'founder_admin', 'super_admin'), false)
            then 'Admin & Staff'
          when subscription.status = 'active'
            and subscription.plan_code = 'premium'
            and coalesce(subscription.starts_at, now()) <= now()
            and (subscription.expires_at is null or subscription.expires_at > now())
            then 'Premium'
          when subscription.status = 'active'
            and subscription.plan_code <> 'premium'
            and coalesce(subscription.starts_at, now()) <= now()
            and (subscription.expires_at is null or subscription.expires_at > now())
            then 'Regular'
          when coalesce((directory_item.item->>'role') = 'beta_tester', false)
            or coalesce(settings.global_beta_all_access_enabled, false)
            then 'Beta Tester'
          else 'Regular'
        end,
        'subscription_id', subscription.id,
        'subscription_plan', subscription.plan_code,
        'subscription_status', subscription.status,
        'subscription_source', subscription.source,
        'subscription_starts_at', subscription.starts_at,
        'subscription_expires_at', subscription.expires_at,
        'trial_expires_at', trial.expires_at,
        'free_beta_enabled', coalesce(beta.enabled, false),
        'free_beta_expires_at', beta.expires_at,
        'beta_all_access_enabled', coalesce(settings.global_beta_all_access_enabled, false),
        'current_legal_accepted', legal_acceptance.id is not null,
        'effective_access', case
          when legal_acceptance.id is null then 'Legal acceptance required'
          when coalesce((directory_item.item->>'role') in ('super_admin', 'founder_admin'), false)
            then 'Admin & Staff access'
          when coalesce(settings.global_beta_all_access_enabled, false)
            then 'Beta All Access'
          when subscription.currently_active then 'Active subscription'
          else 'No active subscription'
        end
      ))
      order by directory_item.ordinality
    ),
    '[]'::jsonb
  ) into v_items
  from directory_items directory_item
  join auth.users auth_user on auth_user.id = directory_item.user_id
  left join answer_counts answer_count on answer_count.user_id = auth_user.id
  left join score_counts score_count on score_count.user_id = auth_user.id
  left join public.access_trials trial on trial.user_id = auth_user.id
  left join public.free_beta_access beta on beta.user_id = auth_user.id
  left join public.platform_access_settings settings on settings.singleton = true
  left join public.terms_acceptances legal_acceptance
    on legal_acceptance.user_id = auth_user.id
   and legal_acceptance.terms_version = settings.current_terms_version
   and legal_acceptance.privacy_version = settings.current_privacy_version
  left join lateral (
    select
      subscription_row.id,
      subscription_row.plan_code,
      subscription_row.status,
      subscription_row.source,
      subscription_row.starts_at,
      subscription_row.expires_at,
      (
        subscription_row.status = 'active'
        and subscription_row.starts_at <= now()
        and (subscription_row.expires_at is null or subscription_row.expires_at > now())
      ) as currently_active
    from public.subscriptions subscription_row
    where subscription_row.user_id = auth_user.id
      and subscription_row.status in ('active', 'paused', 'pending_payment', 'trialing')
    order by
      (subscription_row.status = 'active') desc,
      subscription_row.updated_at desc,
      subscription_row.created_at desc
    limit 1
  ) subscription on true;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

comment on function private.admin_user_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) is 'Admin user directory with set-based page-scoped session and grading aggregation.';

comment on function private.admin_user_engagement_directory_scoped_v1(
  uuid, text, integer, integer, text, text, text
) is 'Admin engagement directory enriched with answer, score, access, and subscription metrics only for the requested page of users.';

commit;
