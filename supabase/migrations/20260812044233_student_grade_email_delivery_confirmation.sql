-- Provider-confirmed student-result delivery and bounded Professor retry.
--
-- The existing `status = sent` value means that the email provider accepted
-- the request. It does not prove that the recipient mail server accepted the
-- message. This additive migration keeps that legacy contract intact while
-- tracking the provider delivery lifecycle separately.

begin;

alter table public.exam_room_email_jobs
  add column if not exists delivery_status text not null default 'pending',
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists provider_event_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists last_provider_event text;

alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_delivery_status_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_delivery_status_check check (
    delivery_status in (
      'pending', 'accepted', 'delayed', 'delivered', 'bounced',
      'complained', 'failed', 'suppressed', 'unknown'
    )
  );

alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_jobs_last_provider_event_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_jobs_last_provider_event_check check (
    last_provider_event is null
    or last_provider_event in (
      'email.sent', 'email.delivered', 'email.delivery_delayed',
      'email.bounced', 'email.complained', 'email.failed'
    )
  );

update public.exam_room_email_jobs
set delivery_status = case
    when provider_id like 'suppressed:%' then 'suppressed'
    when status = 'sent' and provider_id is not null then 'accepted'
    when status = 'failed' then 'failed'
    else 'pending'
  end,
  provider_accepted_at = case
    when status = 'sent' and provider_id is not null
      then coalesce(provider_accepted_at, sent_at, created_at)
    else provider_accepted_at
  end
where delivery_status = 'pending';

create index if not exists exam_room_email_delivery_status_idx
  on public.exam_room_email_jobs (exam_id, email_type, delivery_status, created_at desc)
  where email_type = 'student_result';

create unique index if not exists exam_room_email_provider_id_uq
  on public.exam_room_email_jobs (provider_id)
  where provider_id is not null and provider_id not like 'suppressed:%';

create table if not exists public.exam_room_email_delivery_events (
  id uuid primary key default extensions.gen_random_uuid(),
  email_job_id uuid not null references public.exam_room_email_jobs(id) on delete cascade,
  provider_event_id text not null check (
    char_length(provider_event_id) between 6 and 200
    and provider_event_id ~ '^[A-Za-z0-9_-]+$'
  ),
  provider_event_type text not null check (
    provider_event_type in (
      'email.sent', 'email.delivered', 'email.delivery_delayed',
      'email.bounced', 'email.complained', 'email.failed'
    )
  ),
  provider_event_at timestamptz not null,
  received_at timestamptz not null default clock_timestamp(),
  unique (provider_event_id)
);

create index if not exists exam_room_email_delivery_events_job_idx
  on public.exam_room_email_delivery_events (email_job_id, provider_event_at desc);

alter table public.exam_room_email_delivery_events enable row level security;
alter table public.exam_room_email_delivery_events force row level security;
revoke all on table public.exam_room_email_delivery_events from public, anon, authenticated;
revoke all on table public.exam_room_email_delivery_events from service_role;
grant select, insert on table public.exam_room_email_delivery_events to service_role;

create or replace function public.exam_room_complete_email(
  p_job_id uuid,
  p_provider_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_delivery_status text;
begin
  if p_provider_id is null or char_length(p_provider_id) not between 6 and 500 then
    raise exception 'EXAM_ROOM_EMAIL_PROVIDER_ID_INVALID';
  end if;
  v_delivery_status := case
    when p_provider_id like 'suppressed:%' then 'suppressed'
    else 'accepted'
  end;
  update public.exam_room_email_jobs
  set status = 'sent',
      provider_id = p_provider_id,
      safe_error_code = null,
      sent_at = clock_timestamp(),
      delivery_status = v_delivery_status,
      provider_accepted_at = case
        when v_delivery_status = 'accepted' then clock_timestamp()
        else provider_accepted_at
      end,
      last_provider_event = null
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'EXAM_ROOM_EMAIL_JOB_NOT_FOUND'; end if;
  return jsonb_build_object(
    'ok', true,
    'jobId', p_job_id,
    'status', 'sent',
    'deliveryStatus', v_delivery_status
  );
end;
$$;

create or replace function public.exam_room_fail_email(
  p_job_id uuid,
  p_safe_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_safe_error_code !~ '^[A-Z0-9_]{2,80}$' then
    raise exception 'EXAM_ROOM_SAFE_ERROR_INVALID';
  end if;
  update public.exam_room_email_jobs
  set status = 'failed',
      delivery_status = 'failed',
      safe_error_code = p_safe_error_code,
      next_attempt_at = clock_timestamp()
        + least(
          interval '60 minutes',
          make_interval(secs => (2 ^ greatest(attempt_count - 1, 0))::integer * 30)
        )
  where id = p_job_id and status = 'processing';
  if not found then raise exception 'EXAM_ROOM_EMAIL_JOB_NOT_FOUND'; end if;
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'status', 'failed');
end;
$$;

create or replace function public.exam_room_record_email_delivery_event_v1(
  p_provider_id text,
  p_provider_event_id text,
  p_provider_event_type text,
  p_provider_event_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job public.exam_room_email_jobs%rowtype;
  v_event_id uuid;
  v_delivery_status text;
begin
  if p_provider_id is null or char_length(p_provider_id) not between 6 and 500
    or p_provider_event_id is null
    or char_length(p_provider_event_id) not between 6 and 200
    or p_provider_event_id !~ '^[A-Za-z0-9_-]+$'
    or p_provider_event_type not in (
      'email.sent', 'email.delivered', 'email.delivery_delayed',
      'email.bounced', 'email.complained', 'email.failed'
    )
    or p_provider_event_at is null
  then
    raise exception 'EXAM_ROOM_EMAIL_EVENT_INVALID';
  end if;

  select * into v_job
  from public.exam_room_email_jobs job
  where job.provider_id = p_provider_id
  for update;

  -- A Resend account can emit events for non-Examination Room messages.
  -- Acknowledge those events without retaining recipient data or payloads.
  if not found then
    return jsonb_build_object('ok', true, 'matched', false);
  end if;

  insert into public.exam_room_email_delivery_events (
    email_job_id, provider_event_id, provider_event_type, provider_event_at
  ) values (
    v_job.id, p_provider_event_id, p_provider_event_type, p_provider_event_at
  )
  on conflict (provider_event_id) do nothing
  returning id into v_event_id;

  if v_event_id is null then
    return jsonb_build_object('ok', true, 'matched', true, 'duplicate', true);
  end if;

  v_delivery_status := case p_provider_event_type
    when 'email.sent' then 'accepted'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else 'unknown'
  end;

  update public.exam_room_email_jobs
  set delivery_status = v_delivery_status,
      provider_event_at = p_provider_event_at,
      last_provider_event = p_provider_event_type,
      delivered_at = case
        when p_provider_event_type = 'email.delivered'
          then coalesce(delivered_at, p_provider_event_at)
        else delivered_at
      end,
      safe_error_code = case p_provider_event_type
        when 'email.bounced' then 'EMAIL_BOUNCED'
        when 'email.complained' then 'EMAIL_COMPLAINED'
        when 'email.failed' then 'EMAIL_PROVIDER_FAILED'
        else null
      end
  where id = v_job.id
    and (provider_event_at is null or p_provider_event_at >= provider_event_at);

  return jsonb_build_object(
    'ok', true,
    'matched', true,
    'duplicate', false,
    'deliveryStatus', v_delivery_status
  );
end;
$$;

create or replace function public.exam_room_result_delivery_report_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_release public.exam_room_releases%rowtype;
  v_candidates jsonb;
  v_summary jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for share;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select * into v_release
  from public.exam_room_releases release
  where release.exam_id = v_exam.id;

  with submitted_candidates as (
    select attempt.id attempt_id,
      attempt.public_id attempt_public_id,
      attempt.student_user_id,
      attempt.candidate_number,
      roster.display_name student_name,
      roster.student_number,
      roster.canonical_email student_email
    from public.exam_room_attempts attempt
    join public.exam_room_roster roster on roster.id = attempt.roster_id
    where attempt.exam_id = v_exam.id
      and attempt.status in ('submitted', 'auto_submitted', 'sealed')
  ), latest_jobs as (
    select candidate.*,
      latest.id job_id,
      latest.delivery_status,
      latest.provider_accepted_at,
      latest.provider_event_at,
      latest.delivered_at,
      latest.last_provider_event,
      latest.safe_error_code,
      latest.created_at queued_at,
      coalesce(job_count.total_jobs, 0) total_jobs
    from submitted_candidates candidate
    left join lateral (
      select job.*
      from public.exam_room_email_jobs job
      where job.exam_id = v_exam.id
        and job.release_id = v_release.id
        and job.email_type = 'student_result'
        and (
          job.recipient_user_id = candidate.student_user_id
          or job.recipient_email = candidate.student_email
        )
      order by job.created_at desc, job.id desc
      limit 1
    ) latest on true
    left join lateral (
      select count(*)::integer total_jobs
      from public.exam_room_email_jobs job
      where job.exam_id = v_exam.id
        and job.release_id = v_release.id
        and job.email_type = 'student_result'
        and (
          job.recipient_user_id = candidate.student_user_id
          or job.recipient_email = candidate.student_email
        )
    ) job_count on true
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', attempt_public_id,
    'candidateNumber', candidate_number,
    'studentName', coalesce(student_name, candidate_number),
    'studentNumber', student_number,
    'studentEmail', student_email,
    'deliveryStatus', coalesce(delivery_status, 'not_queued'),
    'providerAcceptedAt', provider_accepted_at,
    'providerEventAt', provider_event_at,
    'deliveredAt', delivered_at,
    'lastProviderEvent', last_provider_event,
    'safeErrorCode', safe_error_code,
    'queuedAt', queued_at,
    'sendAttempts', total_jobs,
    'retryable', v_release.id is not null
      and total_jobs between 1 and 3
      and coalesce(delivery_status, 'not_queued') <> 'delivered'
  ) order by coalesce(student_name, candidate_number), candidate_number), '[]'::jsonb)
  into v_candidates
  from latest_jobs;

  select jsonb_build_object(
    'total', count(*),
    'delivered', count(*) filter (where item ->> 'deliveryStatus' = 'delivered'),
    'accepted', count(*) filter (where item ->> 'deliveryStatus' = 'accepted'),
    'delayed', count(*) filter (where item ->> 'deliveryStatus' = 'delayed'),
    'failed', count(*) filter (where item ->> 'deliveryStatus' in ('failed', 'bounced', 'complained')),
    'pending', count(*) filter (where item ->> 'deliveryStatus' in ('pending', 'not_queued', 'unknown'))
  ) into v_summary
  from jsonb_array_elements(v_candidates) item;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'releaseId', v_release.id,
    'released', v_release.id is not null,
    'releasedAt', v_release.released_at,
    'generatedAt', clock_timestamp(),
    'summary', v_summary,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_retry_student_result_email_v1(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_attempt_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_release public.exam_room_releases%rowtype;
  v_attempt public.exam_room_attempts%rowtype;
  v_source public.exam_room_email_jobs%rowtype;
  v_retry public.exam_room_email_jobs%rowtype;
  v_event_key text;
  v_existing_count integer;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  if p_request_key is null or p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID';
  end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
    and exam.owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;

  select * into v_release
  from public.exam_room_releases release
  where release.exam_id = v_exam.id;
  if not found then raise exception 'EXAM_ROOM_RESULTS_NOT_RELEASED'; end if;

  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.exam_id = v_exam.id
    and attempt.status = 'sealed';
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;

  select count(*)::integer into v_existing_count
  from public.exam_room_email_jobs job
  where job.exam_id = v_exam.id
    and job.release_id = v_release.id
    and job.email_type = 'student_result'
    and job.recipient_user_id = v_attempt.student_user_id;
  if v_existing_count < 1 then raise exception 'EXAM_ROOM_RESULT_EMAIL_NOT_FOUND'; end if;
  if v_existing_count >= 4 then raise exception 'EXAM_ROOM_EMAIL_RETRY_LIMIT'; end if;

  select * into v_source
  from public.exam_room_email_jobs job
  where job.exam_id = v_exam.id
    and job.release_id = v_release.id
    and job.email_type = 'student_result'
    and job.recipient_user_id = v_attempt.student_user_id
  order by job.created_at desc, job.id desc
  limit 1;

  v_event_key := 'result_retry_' || substr(md5(p_request_key || v_source.id::text), 1, 32);
  select * into v_retry
  from public.exam_room_email_jobs job
  where job.exam_id = v_exam.id
    and job.email_type = 'student_result'
    and job.recipient_email = v_source.recipient_email
    and job.event_key = v_event_key;

  if not found then
    insert into public.exam_room_email_jobs (
      exam_id, release_id, recipient_user_id, recipient_email,
      email_type, payload, status, next_attempt_at, event_key,
      delivery_status
    ) values (
      v_exam.id, v_release.id, v_source.recipient_user_id,
      v_source.recipient_email, 'student_result', v_source.payload,
      'pending', clock_timestamp(), v_event_key, 'pending'
    ) returning * into v_retry;

    insert into public.exam_room_audit_log (
      actor_user_id, exam_id, classroom_id, attempt_id,
      action, reason, metadata
    ) values (
      p_professor_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id,
      'student_result_email_retried',
      'Professor requested redelivery of a released student result.',
      jsonb_build_object(
        'releaseId', v_release.id,
        'retryJobId', v_retry.id,
        'priorDeliveryStatus', v_source.delivery_status,
        'priorSendCount', v_existing_count
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'attemptId', v_attempt.public_id,
    'queued', true,
    'deliveryStatus', v_retry.delivery_status,
    'sendAttempt', v_existing_count + case when v_retry.created_at > v_source.created_at then 1 else 0 end
  );
end;
$$;

revoke all on function public.exam_room_complete_email(uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_fail_email(uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_record_email_delivery_event_v1(text, text, text, timestamptz)
  from public, anon, authenticated;
revoke all on function public.exam_room_result_delivery_report_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_retry_student_result_email_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.exam_room_complete_email(uuid, text) to service_role;
grant execute on function public.exam_room_fail_email(uuid, text) to service_role;
grant execute on function public.exam_room_record_email_delivery_event_v1(text, text, text, timestamptz)
  to service_role;
grant execute on function public.exam_room_result_delivery_report_v1(uuid, uuid)
  to service_role;
grant execute on function public.exam_room_retry_student_result_email_v1(uuid, uuid, uuid, text)
  to service_role;

comment on column public.exam_room_email_jobs.delivery_status is
  'Provider delivery lifecycle. Legacy status=sent means provider accepted, not recipient delivery.';
comment on function public.exam_room_retry_student_result_email_v1(uuid, uuid, uuid, text) is
  'Queues one bounded, idempotent student-result redelivery for the owning Professor without changing grades.';

commit;
