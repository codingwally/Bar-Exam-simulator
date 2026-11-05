begin;

-- Intake and official finalization are separate transactions. A Worker can
-- disappear after intake without losing the immutable payload or receipt.
do $preflight$
declare
  student_api text := pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure);
begin
  if strpos(student_api, 'pendingSubmission') = 0
     or strpos(student_api, 'audit_request_hash') = 0
     or strpos(student_api, ':student.submit') = 0 then
    raise exception 'Verify and apply the ordered submission intent and audit-hash migrations before durable intake';
  end if;
end
$preflight$;

create table examination_room_v1.submission_intake (
  session_id uuid primary key references examination_room_v1.student_sessions(id) on delete restrict,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  finalization_payload jsonb not null check (jsonb_typeof(finalization_payload) = 'object'),
  accepted_at timestamptz not null default clock_timestamp(),
  next_attempt_at timestamptz not null default clock_timestamp(),
  attempt_count integer not null default 0,
  last_error_code text,
  backup_recipient text,
  backup_attempts integer not null default 0,
  backup_due_at timestamptz not null default clock_timestamp(),
  backup_lease uuid,
  backup_lease_until timestamptz,
  backup_finished boolean not null default false,
  backup_provider_id text,
  backup_error_code text,
  official_result jsonb
);

alter table examination_room_v1.submission_intake enable row level security;
alter table examination_room_v1.submission_intake force row level security;
revoke all on examination_room_v1.submission_intake from public, anon, authenticated, service_role;
create index submission_intake_pending_idx
  on examination_room_v1.submission_intake(next_attempt_at, session_id)
  where official_result is null;

create function examination_room_v1.intake_official_receipt(p_session_id uuid, p_request_hash text)
returns jsonb
language sql stable
set search_path = pg_catalog
as $$
  select jsonb_build_object(
    'ok', true,
    'submission', jsonb_build_object(
      'id', s.id,
      'status', 'accepted',
      'receiptId', r.id,
      'receiptCode', r.receipt_code,
      'manifestHash', r.receipt_sha256,
      'receivedAt', s.received_at,
      'submittedAt', s.submitted_at_client,
      'examVersion', s.submission_manifest -> 'examinationVersion',
      'answerCount', (
        select count(*) from jsonb_array_elements(s.submission_manifest -> 'questions') q
        where nullif(q ->> 'answer', '') is not null
      )
    )
  )
  from examination_room_v1.submissions s
  join examination_room_v1.submission_receipts r on r.submission_id = s.id
  where s.session_id = p_session_id and s.idempotency_key_hash = p_request_hash
    and s.submission_status = 'accepted'
$$;

revoke all on function examination_room_v1.intake_official_receipt(uuid, text)
  from public, anon, authenticated, service_role;

create function public.examination_room_v1_submission_intake(
  p_operation text,
  p_session_id uuid default null,
  p_request_hash text default null,
  p_token_hash text default null,
  p_payload jsonb default null,
  p_limit integer default 4,
  p_backup_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  job examination_room_v1.submission_intake%rowtype;
  final_result jsonb;
  processed integer := 0;
  delivery_status text;
begin
  if p_operation not in ('read', 'stage', 'drain', 'claim_backup', 'finish_backup') or p_operation is null then
    raise exception 'Invalid submission intake operation' using errcode = '22023';
  end if;

  if p_operation = 'claim_backup' then
    select i.* into job
    from examination_room_v1.submission_intake i
    where i.backup_recipient is not null and not i.backup_finished
      and i.backup_due_at <= clock_timestamp()
      and coalesce(i.backup_lease_until, '-infinity'::timestamptz) <= clock_timestamp()
      and (p_session_id is null or i.session_id = p_session_id)
    order by i.backup_due_at, i.session_id
    limit 1 for update skip locked;

    if not found then return jsonb_build_object('ok', true); end if;
    update examination_room_v1.submission_intake i
    set backup_lease = gen_random_uuid(), backup_lease_until = clock_timestamp() + interval '45 seconds'
    where i.session_id = job.session_id
    returning i.* into job;
    return jsonb_build_object(
      'ok', true, 'sessionId', job.session_id, 'requestHash', job.request_hash,
      'lease', job.backup_lease, 'recipient', job.backup_recipient,
      'manifest', job.finalization_payload -> 'submissionManifest',
      'manifestHash', job.finalization_payload ->> 'manifestHash'
    );
  end if;

  if p_operation = 'finish_backup' then
    delivery_status := p_payload ->> 'status';
    update examination_room_v1.submission_intake i
    set backup_attempts = i.backup_attempts + 1,
        backup_lease = null,
        backup_lease_until = null,
        -- Never silently discard a failed professor backup after a retry limit.
        -- Keep failed jobs claimable with a bounded hourly backoff, so an
        -- external provider outage cannot permanently strand answer delivery.
        -- 'suppressed' is an intentional terminal state for ineligible mail.
        backup_finished = coalesce(delivery_status in ('sent', 'suppressed'), false),
        backup_provider_id = left(p_payload ->> 'providerId', 240),
        backup_error_code = left(p_payload ->> 'safeErrorCode', 80),
        backup_due_at = clock_timestamp() + make_interval(
          secs => case when i.backup_attempts >= 7 then 3600
                       else least(900, 30 * power(2, least(i.backup_attempts, 6))) end
        )
    where i.session_id = p_session_id
      and i.backup_lease::text = p_payload ->> 'lease'
      and i.backup_lease_until > clock_timestamp();
    return jsonb_build_object('ok', true, 'recorded', found);
  end if;

  if p_operation <> 'drain' or p_session_id is not null then
    if not exists (
      select 1 from examination_room_v1.student_sessions s
      where s.id = p_session_id
        and s.session_token_hash = p_token_hash
        and s.session_status <> 'revoked'
    ) then
      return examination_room_v1.api_error(
        'SESSION_INVALID', 'The examination session could not be verified.', 401,
        'Return to the examination room and resume your attempt.'
      );
    end if;

    select * into job from examination_room_v1.submission_intake i where i.session_id = p_session_id;
    if found and job.request_hash is distinct from p_request_hash then
      return examination_room_v1.api_error(
        'SUBMISSION_ALREADY_RECEIVED', 'This attempt already has a preserved submission.', 409,
        'Resume the saved submission and use its original submission request.'
      );
    end if;
    if found and job.official_result is not null then
      return job.official_result;
    end if;
    if job.session_id is null then
      final_result := examination_room_v1.intake_official_receipt(p_session_id, p_request_hash);
      if final_result is not null then
        return final_result || jsonb_build_object('duplicate', true);
      end if;
    end if;
  end if;

  if p_operation = 'stage' and job.session_id is null then
    if jsonb_typeof(p_payload) is distinct from 'object'
       or p_payload ->> 'sessionId' is distinct from p_session_id::text
       or p_payload ->> 'requestHash' is distinct from p_request_hash
       or p_payload ->> 'sessionTokenHash' is distinct from p_token_hash
       or jsonb_typeof(p_payload -> 'submissionManifest') is distinct from 'object'
       or jsonb_typeof(p_payload -> 'answerSelections') is distinct from 'array'
       or not exists (
         select 1 from examination_room_v1.student_sessions s
         where s.id = p_session_id
           and s.session_metadata #>> '{pendingSubmission,requestHash}' = p_request_hash
       ) then
      return examination_room_v1.api_error(
        'SUBMISSION_INTAKE_INVALID', 'The submission could not be preserved on the server.', 409,
        'Keep the local backup and retry using the original submission.'
      );
    end if;

    -- The configured mailbox is only eligible for an exam owned by its
    -- verified account. Other professors' answers stay within their workflow.
    insert into examination_room_v1.submission_intake(session_id, request_hash, finalization_payload, backup_recipient)
    select s.id, p_request_hash, p_payload, (
      select lower(u.email)
      from examination_room_v1.exams e
      join auth.users u on u.id = e.owner_user_id
      where e.id = s.exam_id
        and u.email_confirmed_at is not null
        and lower(u.email) = lower(p_backup_email)
    )
    from examination_room_v1.student_sessions s where s.id = p_session_id
    on conflict (session_id) do nothing;

    select * into strict job from examination_room_v1.submission_intake i where i.session_id = p_session_id;
    if job.request_hash is distinct from p_request_hash then
      return examination_room_v1.api_error(
        'SUBMISSION_ALREADY_RECEIVED', 'This attempt already has a preserved submission.', 409,
        'Resume the saved submission and use its original submission request.'
      );
    end if;
    if job.official_result is not null then return job.official_result; end if;
  end if;

  if p_operation <> 'drain' then
    return jsonb_build_object('ok', true, 'intake', case when job.session_id is null then 'missing' else 'pending' end);
  end if;

  for job in
    select i.*
    from examination_room_v1.submission_intake i
    where i.official_result is null
      and i.next_attempt_at <= clock_timestamp()
      and (i.backup_recipient is null or i.backup_attempts > 0)
      and (p_session_id is null or i.session_id = p_session_id)
    order by i.next_attempt_at, i.session_id
    limit greatest(1, least(coalesce(p_limit, 4), 10))
    for update skip locked
  loop
    begin
      final_result := public.examination_room_v1_api('student', 'submit', null, null, job.finalization_payload);
      if final_result #>> '{submission,status}' = 'accepted' then
        final_result := examination_room_v1.intake_official_receipt(job.session_id, job.request_hash);
      end if;
      if final_result #>> '{submission,status}' = 'accepted' then
        final_result := final_result || jsonb_build_object('backupManaged', job.backup_recipient is not null);
        update examination_room_v1.submission_intake i
        set official_result = final_result, last_error_code = null, attempt_count = i.attempt_count + 1,
            finalization_payload = i.finalization_payload - 'sessionTokenHash'
        where i.session_id = job.session_id;
        processed := processed + 1;
        if p_session_id is not null then return final_result; end if;
      else
        update examination_room_v1.submission_intake i
        set last_error_code = left(coalesce(final_result #>> '{error,code}', 'RECEIPT_UNCONFIRMED'), 80),
            attempt_count = i.attempt_count + 1,
            next_attempt_at = clock_timestamp() + make_interval(secs => least(900, 10 * power(2, least(i.attempt_count, 7))))
        where i.session_id = job.session_id;
      end if;
    exception when others then
      update examination_room_v1.submission_intake i
      set last_error_code = sqlstate, attempt_count = i.attempt_count + 1,
          next_attempt_at = clock_timestamp() + interval '2 minutes'
      where i.session_id = job.session_id;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'intake', 'pending', 'processed', processed);
end;
$$;

revoke all on function public.examination_room_v1_submission_intake(text, uuid, text, text, jsonb, integer, text)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_submission_intake(text, uuid, text, text, jsonb, integer, text)
  to service_role;

commit;
