-- Admin-only, all-time engagement metrics and per-user answer counts.
-- This migration does not change learner access, grading, question content,
-- authentication, or any simulator route.

begin;

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
set search_path = public, pg_temp
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
set search_path = public, pg_temp
as $$
declare
  v_signed_in_accounts bigint := 0;
  v_users_with_answers bigint := 0;
  v_questions_answered bigint := 0;
  v_practice_answered bigint := 0;
  v_examination_answered bigint := 0;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'analytics_viewer') then
    raise exception 'Analytics capability required';
  end if;

  select count(*)
    into v_signed_in_accounts
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

  return jsonb_build_object(
    'scope', 'all_time',
    'generatedAt', now(),
    'signedInAccounts', v_signed_in_accounts,
    'usersWithAnswers', v_users_with_answers,
    'questionsAnswered', v_questions_answered,
    'practiceQuestionsAnswered', v_practice_answered,
    'examinationQuestionsAnswered', v_examination_answered,
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
set search_path = public, pg_temp
as $$
declare
  v_directory jsonb;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.admin_authorization_context(p_actor_user_id);
  if not public.admin_has_capability(p_actor_user_id, 'learner_analytics_viewer') then
    raise exception 'Learner analytics capability required';
  end if;

  v_directory := public.admin_user_directory(
    p_actor_user_id,
    p_search,
    p_limit,
    p_offset,
    p_request_key,
    p_access_purpose
  );

  select coalesce(
    jsonb_agg(
      d.item || jsonb_build_object(
        'last_sign_in_at', u.last_sign_in_at,
        'has_signed_in', u.last_sign_in_at is not null,
        'practice_answered_count', coalesce(c.practice_answered, 0),
        'examination_answered_count', coalesce(c.examination_answered, 0),
        'answered_question_count', coalesce(c.answered_question_count, 0),
        'last_answered_at', c.last_answered_at
      )
      order by d.ordinality
    ),
    '[]'::jsonb
  )
  into v_items
  from jsonb_array_elements(coalesce(v_directory->'items', '[]'::jsonb))
    with ordinality as d(item, ordinality)
  left join auth.users u on u.id = (d.item->>'id')::uuid
  left join public.admin_user_answer_counts() c on c.user_id = u.id;

  return jsonb_set(v_directory, '{items}', v_items, true);
end;
$$;

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
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_recipient_key not in ('wally', 'gilmar', 'ice', 'emrico') then
    raise exception 'Approved founder recipient required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;

  v_result := public.admin_user_engagement_directory(
    p_actor_user_id,
    p_search,
    least(greatest(coalesce(p_limit, 5000), 1), 5000),
    0,
    p_request_key,
    'csv_export'
  );

  return v_result || jsonb_build_object('recipientKey', p_recipient_key);
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
set search_path = public, pg_temp
as $$
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
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if p_result_count is null or p_result_count < 0 or p_result_count > 5000 then
    raise exception 'Valid exported row count required';
  end if;
  if char_length(coalesce(p_provider_id, '')) > 180
     or char_length(coalesce(p_safe_error_code, '')) > 120 then
    raise exception 'Delivery receipt metadata is too long';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 2020));
  if not exists (
    select 1
    from public.admin_audit_log a
    where a.actor_user_id = p_actor_user_id
      and a.action_type = 'sensitive_data_viewed'
      and a.target_resource_type = 'admin_user_directory_email_delivery'
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
      'admin_user_directory_email_delivery',
      p_recipient_key,
      btrim(p_reason),
      jsonb_build_object(
        'requestKey', p_request_key,
        'recipientKey', p_recipient_key,
        'status', p_status,
        'resultCount', p_result_count,
        'providerId', nullif(left(coalesce(p_provider_id, ''), 180), ''),
        'safeErrorCode', nullif(left(coalesce(p_safe_error_code, ''), 120), '')
      )
    );
  end if;

  return jsonb_build_object(
    'recorded', true,
    'status', p_status,
    'recipientKey', p_recipient_key
  );
end;
$$;

revoke all on function public.admin_user_answer_counts()
  from public, anon, authenticated;
revoke all on function public.admin_overview_engagement_metrics(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_user_engagement_directory(
  uuid, text, integer, integer, text, text
) from public, anon, authenticated;
revoke all on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) from public, anon, authenticated;
revoke all on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) from public, anon, authenticated;

grant execute on function public.admin_user_answer_counts() to service_role;
grant execute on function public.admin_overview_engagement_metrics(uuid) to service_role;
grant execute on function public.admin_user_engagement_directory(
  uuid, text, integer, integer, text, text
) to service_role;
grant execute on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) to service_role;
grant execute on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) to service_role;

comment on function public.admin_overview_engagement_metrics(uuid)
  is 'Admin-only all-time signed-in-account and answered-question aggregates.';
comment on function public.admin_user_engagement_directory(
  uuid, text, integer, integer, text, text
) is 'Audited administrator user directory augmented with per-user answer counts.';
comment on function public.admin_prepare_user_directory_email_export(
  uuid, text, integer, text, text, text
) is 'Founder-only preparation of an allowlisted user-directory email export.';
comment on function public.admin_record_user_directory_email_delivery(
  uuid, text, text, text, text, integer, text, text
) is 'Founder-only privacy-safe delivery receipt for a user-directory email export.';

commit;
