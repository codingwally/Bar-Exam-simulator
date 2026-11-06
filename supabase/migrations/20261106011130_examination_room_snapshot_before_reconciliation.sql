begin;

-- Preserve the complete intake before replaying answer writes. Existing jobs
-- without pendingAnswerWrites continue through the same receipt checks.
create or replace function public.examination_room_v1_submission_intake(
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
  answer_write jsonb;
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
      -- Intake has already committed the complete snapshot. Replay immutable
      -- answer writes inside this savepoint; any failure rolls back all of the
      -- writes while leaving the intake available for the next server retry.
      for answer_write in select value from jsonb_array_elements(
        coalesce(job.finalization_payload -> 'pendingAnswerWrites', '[]'::jsonb)
      ) loop
        if answer_write ->> 'sessionId' is distinct from job.session_id::text
           or answer_write ->> 'sessionTokenHash' is distinct from job.finalization_payload ->> 'sessionTokenHash'
           or answer_write ->> 'submissionRequestHash' is distinct from job.request_hash then
          raise exception 'Invalid preserved answer identity' using errcode = '22023';
        end if;
        final_result := public.examination_room_v1_api('student', 'save_answer', null, null, answer_write);
        if final_result ->> 'ok' is distinct from 'true' then
          raise exception 'Preserved answer reconciliation failed' using errcode = 'P0001';
        end if;
      end loop;
      final_result := public.examination_room_v1_api('student', 'submit', null, null, job.finalization_payload);
      if final_result #>> '{submission,status}' = 'accepted' then
        final_result := examination_room_v1.intake_official_receipt(job.session_id, job.request_hash);
      end if;
      if final_result #>> '{submission,status}' = 'accepted' then
        final_result := final_result || jsonb_build_object('backupManaged', job.backup_recipient is not null);
        update examination_room_v1.submission_intake i
        set official_result = final_result, last_error_code = null, attempt_count = i.attempt_count + 1,
            finalization_payload = i.finalization_payload - 'sessionTokenHash' - 'pendingAnswerWrites'
        where i.session_id = job.session_id;
        processed := processed + 1;
        if p_session_id is not null then return final_result; end if;
      else
        raise exception 'Official receipt is not confirmed' using errcode = 'P0001';
      end if;
    exception when others then
      update examination_room_v1.submission_intake i
      set last_error_code = left(coalesce(final_result #>> '{error,code}', sqlstate), 80), attempt_count = i.attempt_count + 1,
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
