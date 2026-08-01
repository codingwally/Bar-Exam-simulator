-- Founder-only, audited export of a single user's saved examination responses.
-- This adds no browser table grants and does not alter grading entitlements.

begin;

create or replace function public.admin_export_user_responses(
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
set search_path = public, pg_temp
as $$
declare
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
begin
  perform public.phase4_require_founder(p_actor_user_id);
  if p_target_user_id is null
     or not exists (select 1 from auth.users where id = p_target_user_id) then
    raise exception 'Target user not found';
  end if;
  if p_from is null or p_to is null or p_from >= p_to
     or p_to - p_from > interval '366 days' then
    raise exception 'Valid export window of at most 366 days required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 2000 then
    raise exception 'Valid export row limit required';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) not between 5 and 1000 then
    raise exception 'Export reason must be 5 to 1000 characters';
  end if;
  if coalesce(p_request_key, '') !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'Valid export request key required';
  end if;

  with response_rows as (
    select
      'practice'::text as record_source,
      a.user_id,
      a.id as attempt_id,
      'Mock Bar'::text as exam_title,
      a.subject,
      a.question_bank_id as question_id,
      null::text as question_text,
      'current_published_bank_lookup_required'::text as question_provenance,
      a.answer_text as student_answer,
      a.status,
      a.score,
      a.timer_mode,
      a.elapsed_seconds,
      a.submitted_at,
      a.completed_at
    from public.exam_attempts a
    where a.user_id = p_target_user_id
      and a.submitted_at >= p_from
      and a.submitted_at < p_to

    union all

    select
      'formal_exam'::text,
      a.user_id,
      a.id,
      d.title,
      coalesce(d.subject, q.subject),
      coalesce(nullif(q.source_key, ''), q.id::text),
      vq.prompt_snapshot,
      'immutable_exam_snapshot'::text,
      r.answer_text,
      a.status,
      null::numeric,
      a.timer_mode,
      a.elapsed_seconds,
      coalesce(a.submitted_at, a.started_at),
      a.submitted_at
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    join public.examination_responses r on r.attempt_id = a.id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id and vq.question_id = r.question_id
    join public.examination_questions q on q.id = r.question_id
    where a.user_id = p_target_user_id
      and coalesce(a.submitted_at, a.started_at) >= p_from
      and coalesce(a.submitted_at, a.started_at) < p_to
  )
  select count(*) into v_total from response_rows;

  if v_total > p_limit then
    return jsonb_build_object(
      'items', '[]'::jsonb,
      'total', v_total,
      'tooMany', true
    );
  end if;

  with response_rows as (
    select
      'practice'::text as record_source,
      a.user_id,
      a.id as attempt_id,
      'Mock Bar'::text as exam_title,
      a.subject,
      a.question_bank_id as question_id,
      null::text as question_text,
      'current_published_bank_lookup_required'::text as question_provenance,
      a.answer_text as student_answer,
      a.status,
      a.score,
      a.timer_mode,
      a.elapsed_seconds,
      a.submitted_at,
      a.completed_at
    from public.exam_attempts a
    where a.user_id = p_target_user_id
      and a.submitted_at >= p_from
      and a.submitted_at < p_to

    union all

    select
      'formal_exam'::text,
      a.user_id,
      a.id,
      d.title,
      coalesce(d.subject, q.subject),
      coalesce(nullif(q.source_key, ''), q.id::text),
      vq.prompt_snapshot,
      'immutable_exam_snapshot'::text,
      r.answer_text,
      a.status,
      null::numeric,
      a.timer_mode,
      a.elapsed_seconds,
      coalesce(a.submitted_at, a.started_at),
      a.submitted_at
    from public.examination_attempts_multi a
    join public.examination_versions v on v.id = a.version_id
    join public.examination_definitions d on d.id = v.exam_id
    join public.examination_responses r on r.attempt_id = a.id
    join public.examination_version_questions vq
      on vq.version_id = a.version_id and vq.question_id = r.question_id
    join public.examination_questions q on q.id = r.question_id
    where a.user_id = p_target_user_id
      and coalesce(a.submitted_at, a.started_at) >= p_from
      and coalesce(a.submitted_at, a.started_at) < p_to
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'recordSource', record_source,
    'userId', user_id,
    'attemptId', attempt_id,
    'examTitle', exam_title,
    'subject', subject,
    'questionId', question_id,
    'questionText', question_text,
    'questionProvenance', question_provenance,
    'studentAnswer', student_answer,
    'status', status,
    'score', score,
    'timerMode', timer_mode,
    'elapsedSeconds', elapsed_seconds,
    'submittedAt', submitted_at,
    'completedAt', completed_at
  ) order by submitted_at desc, record_source, attempt_id, question_id), '[]'::jsonb)
  into v_items
  from response_rows;

  perform pg_advisory_xact_lock(hashtextextended(p_request_key, 1801));
  if not exists (
    select 1
    from public.admin_audit_log
    where actor_user_id = p_actor_user_id
      and action_type = 'sensitive_data_viewed'
      and target_resource_type = 'user_question_answer_export'
      and details->>'requestKey' = p_request_key
  ) then
    insert into public.admin_audit_log (
      actor_user_id, action_type, target_user_id,
      target_resource_type, target_resource_id, reason, details
    ) values (
      p_actor_user_id,
      'sensitive_data_viewed',
      p_target_user_id,
      'user_question_answer_export',
      p_target_user_id::text,
      btrim(p_reason),
      jsonb_build_object(
        'requestKey', p_request_key,
        'from', p_from,
        'to', p_to,
        'resultCount', v_total
      )
    );
  end if;

  return jsonb_build_object(
    'items', v_items,
    'total', v_total,
    'tooMany', false
  );
end;
$$;

revoke all on function public.admin_export_user_responses(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) from public, anon, authenticated;
grant execute on function public.admin_export_user_responses(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) to service_role;

comment on function public.admin_export_user_responses(
  uuid, uuid, timestamptz, timestamptz, integer, text, text
) is 'Founder-only, reason-required, audited export of one user''s saved question responses.';

commit;
