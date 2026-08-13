-- Examination Room reliability foundation.
--
-- Additive changes only:
--   * bounded, conflict-preserving student multi-device sessions;
--   * leased backup/email delivery claims with stale-work recovery;
--   * monotonic provider-delivery state transitions.
--
-- This migration does not alter questions, answers, grades, grading rules,
-- subscriptions, payments, or unrelated application tables.

begin;

-- -------------------------------------------------------------------------
-- Safe multi-device student sessions
-- -------------------------------------------------------------------------

drop index if exists public.exam_room_one_active_session_idx;

create unique index if not exists exam_room_one_active_device_session_idx
  on public.exam_room_sessions (attempt_id, device_instance_hash)
  where status = 'active';

create index if not exists exam_room_active_sessions_attempt_idx
  on public.exam_room_sessions (attempt_id, last_seen_at desc)
  where status = 'active';

create or replace function public.exam_room_open_session_v3(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_device_instance_hash text,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
  v_epoch integer;
  v_active_count integer;
  v_resumed boolean := false;
  v_request jsonb;
  v_response jsonb;
begin
  v_request := jsonb_build_object(
    'attemptId', p_attempt_public_id,
    'deviceInstanceHash', p_device_instance_hash
  );
  v_response := public.exam_room_command_begin_v2(
    p_student_user_id, 'open_session_v3', p_request_key, v_request
  );
  if v_response is not null then return v_response; end if;
  if p_device_instance_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_DEVICE_HASH_INVALID';
  end if;

  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  if v_attempt.status <> 'in_progress'
    or clock_timestamp() >= v_attempt.server_deadline
  then
    return public.exam_room_command_complete_v2(
      p_student_user_id, 'open_session_v3', p_request_key, v_request,
      jsonb_build_object(
        'ok', false,
        'code', 'ATTEMPT_CLOSED',
        'status', v_attempt.status
      )
    );
  end if;

  select * into v_session
  from public.exam_room_sessions session
  where session.attempt_id = v_attempt.id
    and session.student_user_id = p_student_user_id
    and session.device_instance_hash = p_device_instance_hash
    and session.status = 'active'
  for update;

  if found then
    v_resumed := true;
    update public.exam_room_sessions
    set last_seen_at = clock_timestamp()
    where id = v_session.id
    returning * into v_session;
    insert into public.exam_room_session_events (
      session_id, attempt_id, actor_user_id, event_type, epoch
    ) values (
      v_session.id, v_attempt.id, p_student_user_id, 'resumed', v_session.epoch
    );
  else
    select count(*)::integer into v_active_count
    from public.exam_room_sessions session
    where session.attempt_id = v_attempt.id
      and session.status = 'active';
    if v_active_count >= 3 then
      return public.exam_room_command_complete_v2(
        p_student_user_id, 'open_session_v3', p_request_key, v_request,
        jsonb_build_object(
          'ok', false,
          'code', 'SESSION_LIMIT_REACHED',
          'activeSessionCount', v_active_count,
          'maximumSessions', 3,
          'recovery', 'Close one of your active examination sessions, then try again.'
        )
      );
    end if;
    select coalesce(max(session.epoch), 0) + 1 into v_epoch
    from public.exam_room_sessions session
    where session.attempt_id = v_attempt.id;
    insert into public.exam_room_sessions (
      attempt_id, student_user_id, epoch, device_instance_hash
    ) values (
      v_attempt.id, p_student_user_id, v_epoch, p_device_instance_hash
    ) returning * into v_session;
    insert into public.exam_room_session_events (
      session_id, attempt_id, actor_user_id, event_type, epoch
    ) values (
      v_session.id, v_attempt.id, p_student_user_id, 'opened', v_session.epoch
    );
  end if;

  update public.exam_room_attempts
  set publication_id = coalesce(publication_id, (
        select exam.current_publication_id
        from public.exam_room_exams exam
        where exam.id = v_attempt.exam_id
      )),
      last_heartbeat_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where id = v_attempt.id;

  select count(*)::integer into v_active_count
  from public.exam_room_sessions session
  where session.attempt_id = v_attempt.id
    and session.status = 'active';

  perform public.exam_room_append_audit_v2(
    p_student_user_id, v_attempt.exam_id, v_attempt.id,
    'session', v_session.id,
    case when v_resumed then 'session_resumed' else 'session_opened' end,
    p_request_key,
    jsonb_build_object(
      'epoch', v_session.epoch,
      'activeSessionCount', v_active_count,
      'maximumSessions', 3
    )
  );
  v_response := jsonb_build_object(
    'ok', true,
    'sessionId', v_session.public_id,
    'epoch', v_session.epoch,
    'status', v_session.status,
    'resumed', v_resumed,
    'activeSessionCount', v_active_count,
    'maximumSessions', 3,
    'serverNow', clock_timestamp(),
    'serverDeadline', v_attempt.server_deadline,
    'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
  );
  return public.exam_room_command_complete_v2(
    p_student_user_id, 'open_session_v3', p_request_key, v_request, v_response
  );
exception
  when unique_violation then
    select * into v_session
    from public.exam_room_sessions session
    where session.attempt_id = v_attempt.id
      and session.student_user_id = p_student_user_id
      and session.device_instance_hash = p_device_instance_hash
      and session.status = 'active';
    if not found then raise; end if;
    return jsonb_build_object(
      'ok', true,
      'sessionId', v_session.public_id,
      'epoch', v_session.epoch,
      'status', v_session.status,
      'resumed', true,
      'maximumSessions', 3,
      'serverNow', clock_timestamp(),
      'serverDeadline', v_attempt.server_deadline,
      'answerSetHash', public.exam_room_answer_set_hash_v2(v_attempt.id)
    );
end;
$$;

create or replace function public.exam_room_student_sessions_v1(
  p_student_user_id uuid,
  p_attempt_public_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_sessions jsonb;
begin
  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.student_user_id = p_student_user_id;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'sessionId', session.public_id,
    'epoch', session.epoch,
    'status', session.status,
    'openedAt', session.opened_at,
    'lastSeenAt', session.last_seen_at
  ) order by session.last_seen_at desc), '[]'::jsonb)
  into v_sessions
  from public.exam_room_sessions session
  where session.attempt_id = v_attempt.id
    and session.student_user_id = p_student_user_id
    and session.status = 'active';

  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.public_id,
    'maximumSessions', 3,
    'sessions', v_sessions
  );
end;
$$;

create or replace function public.exam_room_close_student_session_v1(
  p_student_user_id uuid,
  p_attempt_public_id uuid,
  p_session_public_id uuid,
  p_request_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_session public.exam_room_sessions%rowtype;
begin
  if p_request_key !~ '^[A-Za-z0-9_-]{16,128}$' then
    raise exception 'EXAM_ROOM_REQUEST_KEY_INVALID';
  end if;
  select * into v_attempt
  from public.exam_room_attempts attempt
  where attempt.public_id = p_attempt_public_id
    and attempt.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_session
  from public.exam_room_sessions session
  where session.public_id = p_session_public_id
    and session.attempt_id = v_attempt.id
    and session.student_user_id = p_student_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_SESSION_NOT_FOUND'; end if;
  if v_session.status = 'active' then
    update public.exam_room_sessions
    set status = 'closed',
        ended_at = clock_timestamp(),
        ended_by = p_student_user_id,
        end_reason = 'Closed by the signed-in student from the device list.'
    where id = v_session.id;
    insert into public.exam_room_session_events (
      session_id, attempt_id, actor_user_id, event_type, epoch
    ) values (
      v_session.id, v_attempt.id, p_student_user_id, 'closed', v_session.epoch
    );
    perform public.exam_room_append_audit_v2(
      p_student_user_id, v_attempt.exam_id, v_attempt.id,
      'session', v_session.id, 'session_closed', p_request_key,
      jsonb_build_object('epoch', v_session.epoch, 'closedByStudent', true)
    );
  end if;
  return jsonb_build_object(
    'ok', true,
    'attemptId', v_attempt.public_id,
    'sessionId', v_session.public_id,
    'closed', true
  );
end;
$$;

-- -------------------------------------------------------------------------
-- Leased queue claims. A crashed Worker cannot strand work indefinitely.
-- -------------------------------------------------------------------------

alter table public.exam_room_email_jobs
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_until timestamptz;

alter table public.exam_room_email_jobs
  drop constraint if exists exam_room_email_claim_state_check;
alter table public.exam_room_email_jobs
  add constraint exam_room_email_claim_state_check check (
    (claim_token is null and claimed_at is null and lease_until is null)
    or (status = 'processing' and claim_token is not null and claimed_at is not null and lease_until > claimed_at)
  ) not valid;

alter table public.exam_room_backup_outbox
  add column if not exists claim_token uuid,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_until timestamptz;

alter table public.exam_room_backup_outbox
  drop constraint if exists exam_room_backup_claim_state_check;
alter table public.exam_room_backup_outbox
  add constraint exam_room_backup_claim_state_check check (
    (claim_token is null and claimed_at is null and lease_until is null)
    or (status = 'processing' and claim_token is not null and claimed_at is not null and lease_until > claimed_at)
  ) not valid;

create index if not exists exam_room_email_lease_reclaim_idx
  on public.exam_room_email_jobs (lease_until, created_at)
  where status = 'processing';
create index if not exists exam_room_backup_lease_reclaim_idx
  on public.exam_room_backup_outbox (lease_until, created_at)
  where status = 'processing';

create or replace function public.exam_room_claim_email_batch_v2(
  p_limit integer default 20,
  p_lease_seconds integer default 300
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_limit not between 1 and 100
    or p_lease_seconds not between 60 and 1800
  then raise exception 'EXAM_ROOM_BATCH_LIMIT_INVALID'; end if;
  with due as (
    select job.id
    from public.exam_room_email_jobs job
    where job.attempt_count < 8
      and (
        (job.status in ('pending', 'failed') and job.next_attempt_at <= clock_timestamp())
        or (job.status = 'processing' and (job.lease_until is null or job.lease_until <= clock_timestamp()))
      )
    order by job.created_at, job.id
    limit p_limit
    for update skip locked
  ), updated as (
    update public.exam_room_email_jobs job
    set status = 'processing',
        attempt_count = job.attempt_count + 1,
        claim_token = extensions.gen_random_uuid(),
        claimed_at = clock_timestamp(),
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    from due
    where job.id = due.id
    returning job.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.created_at), '[]'::jsonb)
  into v_rows
  from updated;
  return v_rows;
end;
$$;

create or replace function public.exam_room_complete_email_v2(
  p_job_id uuid,
  p_claim_token uuid,
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
      delivery_status = case
        when delivery_status = 'delivered' then 'delivered'
        else v_delivery_status
      end,
      provider_accepted_at = case
        when v_delivery_status = 'accepted' then coalesce(provider_accepted_at, clock_timestamp())
        else provider_accepted_at
      end,
      claim_token = null,
      claimed_at = null,
      lease_until = null
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_until > clock_timestamp();
  if not found then raise exception 'EXAM_ROOM_EMAIL_CLAIM_STALE'; end if;
  return jsonb_build_object(
    'ok', true,
    'jobId', p_job_id,
    'status', 'sent',
    'deliveryStatus', v_delivery_status
  );
end;
$$;

create or replace function public.exam_room_fail_email_v2(
  p_job_id uuid,
  p_claim_token uuid,
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
      delivery_status = case when delivery_status = 'delivered' then 'delivered' else 'failed' end,
      safe_error_code = p_safe_error_code,
      next_attempt_at = clock_timestamp() + least(
        interval '60 minutes',
        make_interval(secs => (2 ^ greatest(attempt_count - 1, 0))::integer * 30)
      ),
      claim_token = null,
      claimed_at = null,
      lease_until = null
  where id = p_job_id
    and status = 'processing'
    and claim_token = p_claim_token;
  if not found then raise exception 'EXAM_ROOM_EMAIL_CLAIM_STALE'; end if;
  return jsonb_build_object('ok', true, 'jobId', p_job_id, 'status', 'failed');
end;
$$;

create or replace function public.exam_room_claim_backup_batch_v2(
  p_limit integer default 10,
  p_lease_seconds integer default 600
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if p_limit not between 1 and 100
    or p_lease_seconds not between 60 and 3600
  then raise exception 'EXAM_ROOM_BATCH_LIMIT_INVALID'; end if;
  with due as (
    select event.id
    from public.exam_room_backup_outbox event
    where event.attempt_count < 12
      and (
        (event.status in ('pending', 'failed') and event.next_attempt_at <= clock_timestamp())
        or (event.status = 'processing' and (event.lease_until is null or event.lease_until <= clock_timestamp()))
      )
    order by event.created_at, event.id
    limit p_limit
    for update skip locked
  ), updated as (
    update public.exam_room_backup_outbox event
    set status = 'processing',
        attempt_count = event.attempt_count + 1,
        processing_started_at = clock_timestamp(),
        claim_token = extensions.gen_random_uuid(),
        claimed_at = clock_timestamp(),
        lease_until = clock_timestamp() + make_interval(secs => p_lease_seconds)
    from due
    where event.id = due.id
    returning event.*
  )
  select coalesce(jsonb_agg(to_jsonb(updated) order by updated.created_at), '[]'::jsonb)
  into v_rows from updated;
  return v_rows;
end;
$$;

create or replace function public.exam_room_complete_backup_v2(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_provider_reference text,
  p_verified_hash text,
  p_google_sheet_id text,
  p_professor_access_removed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.exam_room_backup_outbox%rowtype;
begin
  if p_verified_hash !~ '^[0-9a-f]{64}$'
    or p_provider_reference is null
    or char_length(p_provider_reference) not between 3 and 1000
  then raise exception 'EXAM_ROOM_BACKUP_VERIFICATION_INVALID'; end if;
  update public.exam_room_backup_outbox
  set status = 'synced',
      provider_reference = p_provider_reference,
      verified_hash = p_verified_hash,
      safe_error_code = null,
      synced_at = clock_timestamp(),
      claim_token = null,
      claimed_at = null,
      lease_until = null
  where id = p_outbox_id
    and status = 'processing'
    and claim_token = p_claim_token
    and lease_until > clock_timestamp()
  returning * into v_row;
  if not found then raise exception 'EXAM_ROOM_BACKUP_CLAIM_STALE'; end if;
  update public.exam_room_exams
  set google_sheet_id = coalesce(p_google_sheet_id, google_sheet_id),
      google_professor_access_removed_at = case
        when p_professor_access_removed then coalesce(google_professor_access_removed_at, clock_timestamp())
        else google_professor_access_removed_at
      end,
      updated_at = clock_timestamp()
  where id = v_row.exam_id;
  return jsonb_build_object('ok', true, 'outboxId', v_row.id, 'status', 'synced');
end;
$$;

create or replace function public.exam_room_fail_backup_v2(
  p_outbox_id uuid,
  p_claim_token uuid,
  p_safe_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.exam_room_backup_outbox%rowtype;
begin
  if p_safe_error_code !~ '^[A-Z0-9_]{2,80}$' then
    raise exception 'EXAM_ROOM_SAFE_ERROR_INVALID';
  end if;
  update public.exam_room_backup_outbox
  set status = 'failed',
      safe_error_code = p_safe_error_code,
      next_attempt_at = clock_timestamp() + least(
        interval '60 minutes',
        make_interval(secs => (2 ^ greatest(attempt_count - 1, 0))::integer * 30)
      ),
      claim_token = null,
      claimed_at = null,
      lease_until = null
  where id = p_outbox_id
    and status = 'processing'
    and claim_token = p_claim_token
  returning * into v_row;
  if not found then raise exception 'EXAM_ROOM_BACKUP_CLAIM_STALE'; end if;
  return jsonb_build_object(
    'ok', true,
    'outboxId', v_row.id,
    'status', 'failed',
    'nextAttemptAt', v_row.next_attempt_at
  );
end;
$$;

-- Preserve the strongest observed provider state. Delivery is terminal for
-- display purposes; later accepted/delayed events cannot make it disappear.
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
  v_observed_status text;
  v_effective_status text;
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
  then raise exception 'EXAM_ROOM_EMAIL_EVENT_INVALID'; end if;

  select * into v_job
  from public.exam_room_email_jobs job
  where job.provider_id = p_provider_id
  for update;
  if not found then return jsonb_build_object('ok', true, 'matched', false); end if;

  insert into public.exam_room_email_delivery_events (
    email_job_id, provider_event_id, provider_event_type, provider_event_at
  ) values (
    v_job.id, p_provider_event_id, p_provider_event_type, p_provider_event_at
  ) on conflict (provider_event_id) do nothing
  returning id into v_event_id;
  if v_event_id is null then
    return jsonb_build_object('ok', true, 'matched', true, 'duplicate', true);
  end if;

  v_observed_status := case p_provider_event_type
    when 'email.sent' then 'accepted'
    when 'email.delivered' then 'delivered'
    when 'email.delivery_delayed' then 'delayed'
    when 'email.bounced' then 'bounced'
    when 'email.complained' then 'complained'
    when 'email.failed' then 'failed'
    else 'unknown'
  end;
  v_effective_status := case
    when v_job.delivery_status in ('bounced', 'complained') then v_job.delivery_status
    when v_observed_status in ('bounced', 'complained') then v_observed_status
    when v_job.delivery_status = 'delivered' then 'delivered'
    when v_observed_status = 'delivered' then 'delivered'
    when v_job.delivery_status = 'failed' and v_observed_status in ('accepted', 'delayed') then 'failed'
    else v_observed_status
  end;

  update public.exam_room_email_jobs
  set delivery_status = v_effective_status,
      provider_event_at = greatest(coalesce(provider_event_at, p_provider_event_at), p_provider_event_at),
      last_provider_event = case
        when v_effective_status = v_observed_status then p_provider_event_type
        else last_provider_event
      end,
      delivered_at = case
        when p_provider_event_type = 'email.delivered' then coalesce(delivered_at, p_provider_event_at)
        else delivered_at
      end,
      safe_error_code = case v_effective_status
        when 'bounced' then 'EMAIL_BOUNCED'
        when 'complained' then 'EMAIL_COMPLAINED'
        when 'failed' then 'EMAIL_PROVIDER_FAILED'
        else null
      end
  where id = v_job.id;

  return jsonb_build_object(
    'ok', true,
    'matched', true,
    'duplicate', false,
    'deliveryStatus', v_effective_status
  );
end;
$$;

-- Browser roles remain deny-all; the Worker service role is the only caller.
revoke all on function public.exam_room_open_session_v3(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_student_sessions_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.exam_room_close_student_session_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_claim_email_batch_v2(integer, integer)
  from public, anon, authenticated;
revoke all on function public.exam_room_complete_email_v2(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_fail_email_v2(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_claim_backup_batch_v2(integer, integer)
  from public, anon, authenticated;
revoke all on function public.exam_room_complete_backup_v2(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated;
revoke all on function public.exam_room_fail_backup_v2(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function public.exam_room_open_session_v3(uuid, uuid, text, text)
  to service_role;
grant execute on function public.exam_room_student_sessions_v1(uuid, uuid)
  to service_role;
grant execute on function public.exam_room_close_student_session_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.exam_room_claim_email_batch_v2(integer, integer)
  to service_role;
grant execute on function public.exam_room_complete_email_v2(uuid, uuid, text)
  to service_role;
grant execute on function public.exam_room_fail_email_v2(uuid, uuid, text)
  to service_role;
grant execute on function public.exam_room_claim_backup_batch_v2(integer, integer)
  to service_role;
grant execute on function public.exam_room_complete_backup_v2(uuid, uuid, text, text, text, boolean)
  to service_role;
grant execute on function public.exam_room_fail_backup_v2(uuid, uuid, text)
  to service_role;

comment on function public.exam_room_open_session_v3(uuid, uuid, text, text) is
  'Opens or resumes one of at most three student device sessions without weakening revisioned answer conflict handling.';
comment on function public.exam_room_claim_email_batch_v2(integer, integer) is
  'Claims due or stale Examination Room email work with a bounded tokenized lease.';

commit;
