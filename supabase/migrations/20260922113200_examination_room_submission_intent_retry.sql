-- Preserve an idempotent server-side submission intent so a submission that
-- started while the session was active can finish after a transient outage or
-- client retry without creating a general late-submission bypass.

do $migration$
declare
  fn text;
  old_privacy text := $$if p_operation in ('heartbeat', 'record_event', 'save_answer', 'submit')
     and not exists ($$;
  new_privacy text := $$if p_operation in ('heartbeat', 'record_event', 'save_answer', 'submit', 'submission_intent')
     and not exists ($$;
  old_gate text := $$  request_hash := p_payload ->> 'requestHash';
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      return jsonb_set(replay, '{duplicate}', 'true'::jsonb, true);
    end if;
    return replay;
  end if;

  if session_status not in ('created', 'active')
     or lease_expires_at <= clock_timestamp()
     or activation_status <> 'open'
     or clock_timestamp() > activation_closes_at then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'This examination session is no longer active.', 409,
      'Reconnect or ask the professor to review the session. Server-backed answers remain preserved.'
    );
  end if;$$;
  new_gate text := $$  request_hash := p_payload ->> 'requestHash';
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      return jsonb_set(replay, '{duplicate}', 'true'::jsonb, true);
    end if;
    return replay;
  end if;

  if p_operation = 'submission_intent' then
    if session_status not in ('created', 'active')
       or lease_expires_at <= clock_timestamp()
       or activation_status <> 'open'
       or clock_timestamp() > activation_closes_at then
      return examination_room_v1.api_error(
        'SESSION_NOT_ACTIVE', 'This examination session is no longer active.', 409,
        'Reconnect or ask the professor to review the session. Server-backed answers remain preserved.'
      );
    end if;

    update examination_room_v1.student_sessions s
    set session_metadata = coalesce(s.session_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'pendingSubmission',
        jsonb_build_object(
          'requestHash', request_hash,
          'acceptedAt', clock_timestamp(),
          'clientCompletedAt', p_payload ->> 'clientCompletedAt'
        )
      ),
      updated_at = clock_timestamp()
    where s.id = session_id;

    response := jsonb_build_object(
      'ok', true,
      'submissionIntent', jsonb_build_object(
        'requestHash', request_hash,
        'acceptedAt', clock_timestamp()
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.submission_intent',
      'student_session', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if (
       session_status not in ('created', 'active')
       or lease_expires_at <= clock_timestamp()
       or activation_status <> 'open'
       or clock_timestamp() > activation_closes_at
     )
     and not (
       p_operation = 'submit'
       and exists (
         select 1
         from examination_room_v1.student_sessions pending
         where pending.id = session_id
           and pending.session_metadata #>> '{pendingSubmission,requestHash}' = request_hash
       )
     )
     and not (
       p_operation = 'save_answer'
       and coalesce(p_payload ->> 'source', '') = 'submission'
       and exists (
         select 1
         from examination_room_v1.student_sessions pending
         where pending.id = session_id
           and pending.session_metadata #>> '{pendingSubmission,requestHash}'
             = p_payload ->> 'submissionRequestHash'
       )
     ) then
    return examination_room_v1.api_error(
      'SESSION_NOT_ACTIVE', 'This examination session is no longer active.', 409,
      'Reconnect or ask the professor to review the session. Server-backed answers remain preserved.'
    );
  end if;$$;
begin
  select pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure) into fn;

  if position(old_privacy in fn) = 0 then
    raise exception 'api_student privacy gate anchor not found';
  end if;
  fn := replace(fn, old_privacy, new_privacy);

  if position(old_gate in fn) = 0 then
    raise exception 'api_student active gate anchor not found';
  end if;
  fn := replace(fn, old_gate, new_gate);

  execute fn;
end
$migration$;

revoke all on function examination_room_v1.api_student(text, jsonb) from public, anon, authenticated, service_role;
