CREATE OR REPLACE FUNCTION examination_room_v1.api_student(p_operation text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog'
AS $function$
#variable_conflict use_variable
declare
  institution_id uuid;
  exam_id uuid;
  exam_version_id uuid;
  activation_id uuid;
  roster_id uuid;
  student_identity_id uuid;
  session_id uuid;
  submission_id uuid;
  question_id uuid;
  answer_revision_id uuid;
  notice_version_id uuid;
  activation_status text;
  session_status text;
  notice_code text;
  full_name text;
  student_number text;
  student_email text;
  grading_alias text;
  subject_name text;
  year_level text;
  professor_name text;
  request_hash text;
  audit_request_hash text;
  session_token_hash text;
  stored_token_hash text;
  publication_hash text;
  integrity_tier text;
  controls_payload jsonb;
  publication_manifest jsonb;
  submission_manifest jsonb;
  response jsonb;
  replay jsonb;
  answer_item jsonb;
  answer_selection jsonb;
  result_manifest jsonb;
  activation_opens_at timestamptz;
  activation_closes_at timestamptz;
  lease_expires_at timestamptz;
  occurred_at timestamptz;
  duration_seconds integer;
  extra_minutes integer;
  maximum_sessions integer;
  next_revision integer;
  expected_count integer;
  matched_count integer;
  affected_count integer;
  recording_required boolean;
  recording_accepted boolean;
  accepted_at timestamptz;
  accepted_features jsonb;
  expected_question_type text;
begin
  if p_operation in ('preview', 'consent') then
    select
      a.id,
      a.institution_id,
      a.exam_id,
      a.exam_version_id,
      a.activation_status,
      a.opens_at,
      a.closes_at,
      a.max_sessions,
      v.controls,
      v.publication_manifest,
      v.content_sha256,
      v.duration_seconds,
      v.privacy_notice_version_id,
      n.notice_code,
      er.id,
      er.student_identity_id,
      si.full_name,
      coalesce(er.accommodations ->> 'enteredStudentNumber', si.external_student_id),
      si.email_normalized,
      er.grading_alias,
      er.accommodations ->> 'subject',
      er.accommodations ->> 'yearLevel',
      coalesce((er.accommodations ->> 'extraMinutes')::integer, 0),
      sm.display_name
    into
      activation_id,
      institution_id,
      exam_id,
      exam_version_id,
      activation_status,
      activation_opens_at,
      activation_closes_at,
      maximum_sessions,
      controls_payload,
      publication_manifest,
      publication_hash,
      duration_seconds,
      notice_version_id,
      notice_code,
      roster_id,
      student_identity_id,
      full_name,
      student_number,
      student_email,
      grading_alias,
      subject_name,
      year_level,
      extra_minutes,
      professor_name
    from examination_room_v1.room_activations a
    join examination_room_v1.exam_versions v on v.id = a.exam_version_id
    join examination_room_v1.exams e on e.id = a.exam_id
    join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
    join examination_room_v1.exam_roster er on er.exam_id = a.exam_id and er.roster_status in ('invited', 'eligible', 'completed')
    join examination_room_v1.student_identities si on si.id = er.student_identity_id and si.identity_status = 'active'
    left join lateral (
      select m.display_name
      from examination_room_v1.staff_memberships m
      where m.institution_id = a.institution_id
        and m.user_id = e.owner_user_id
        and m.membership_status = 'active'
      order by (m.staff_role = 'professor') desc, m.granted_at desc
      limit 1
    ) sm on true
    where a.key_hash = p_payload ->> 'roomKeyHash'
      and a.activation_status in ('scheduled', 'open')
      and a.closes_at > clock_timestamp()
      and si.email_normalized = lower(btrim(p_payload #>> '{identity,email}'))
    order by a.created_at desc
    limit 1;

    if activation_id is null then
      if exists (
        select 1
        from examination_room_v1.room_activations a
        where a.key_hash = p_payload ->> 'roomKeyHash'
          and a.activation_status in ('scheduled', 'open')
          and a.closes_at > clock_timestamp()
      ) then
        return examination_room_v1.api_error(
          'STUDENT_IDENTITY_INVALID', 'The entered identity does not exactly match the examination roster.', 400,
          'Use the complete registered name, student number, subject, and year level.'
        );
      end if;
      return examination_room_v1.api_error(
        'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
        'Copy the complete current key from the administrator message and try again.'
      );
    end if;

    if p_operation = 'preview' then
      select jsonb_build_object(
        'ok', true,
        'metadata', jsonb_build_object(
          'examId', e.id,
          'title', e.title,
          'subject', subject_name,
          'yearLevel', year_level,
          'durationMinutes', duration_seconds / 60,
          'startsAt', controls_payload -> 'startsAt',
          'professor', coalesce(professor_name, 'Professor'),
          'questionCount', jsonb_array_length(publication_manifest -> 'questions'),
          'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard'),
          'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
          'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
          'privacyNoticeVersion', notice_code,
          'privacyController', coalesce(controls_payload ->> 'privacyController', ''),
          'retentionSummary', coalesce(controls_payload ->> 'retentionSummary', ''),
          'activationStatus', activation_status,
          'safeguards', jsonb_build_array(
            'Fullscreen may be requested by the examination settings.',
            'Focus and connection changes are recorded for professor review.',
            'Browser signals are review evidence, not automatic proof of misconduct.'
          )
        ),
        'identity', jsonb_build_object(
          'fullName', full_name,
          'studentNumber', student_number,
          'yearLevel', year_level
        ),
        'notice', jsonb_build_object(
          'version', n.notice_code,
          'title', n.title,
          'body', n.notice_body,
          'purposes', n.processing_purposes
        )
      )
      into response
      from examination_room_v1.exams e
      join examination_room_v1.privacy_notice_versions n on n.id = notice_version_id
      where e.id = exam_id;
      return response;
    end if;

    -- Consent creation and capacity checks serialize on the chosen activation;
    -- read-only previews never take this shared hot-row lock.
    perform 1
    from examination_room_v1.room_activations a
    where a.id = activation_id
    for update;
    perform 1
    from examination_room_v1.exam_roster er
    where er.id = roster_id
    for update;

    request_hash := p_payload ->> 'requestHash';
    session_token_hash := p_payload ->> 'sessionTokenHash';
    recording_required := coalesce(controls_payload ->> 'integrityTier', 'standard') = 'recorded_proctoring'
      or coalesce((controls_payload ->> 'cameraRequired')::boolean, false)
      or coalesce((controls_payload ->> 'microphoneRequired')::boolean, false);
    recording_accepted := coalesce((p_payload #>> '{consent,recordingAccepted}')::boolean, false);

    if activation_status <> 'open' or clock_timestamp() < activation_opens_at then
      return examination_room_v1.api_error(
        'ROOM_NOT_OPEN', 'The professor has not opened this examination room yet.', 409,
        'Wait for the professor to open the room, then choose Agree and begin again.'
      );
    end if;
    if p_payload #>> '{consent,noticeVersion}' <> notice_code
       or not coalesce((p_payload #>> '{consent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_VERSION_MISMATCH', 'Consent must accept the exact current privacy notice.', 412,
        'Review the current notice shown on screen and agree again.'
      );
    end if;
    if recording_required and not recording_accepted then
      return examination_room_v1.api_error(
        'RECORDING_CONSENT_REQUIRED', 'This examination requires separate recording consent.', 412,
        'Agree to recording or ask the professor for another permitted arrangement.'
      );
    end if;

    replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.consent');
    if replay is not null then
      if replay ->> 'ok' = 'false' then return replay; end if;
      select s.id, s.session_token_hash
      into session_id, stored_token_hash
      from examination_room_v1.student_sessions s
      where s.consent_request_hash = request_hash
        and s.activation_id = activation_id
        and s.roster_id = roster_id
      for update;
      if session_id is null then
        return examination_room_v1.api_error(
          'CONSENT_REPLAY_INVALID', 'The prior consent receipt cannot be recovered.', 409,
          'Return to the join page and create a new consent request.'
        );
      end if;
      if stored_token_hash <> session_token_hash then
        update examination_room_v1.student_sessions s
        set session_token_hash = session_token_hash
        where s.id = session_id;
      end if;
      select v.publication_manifest, v.content_sha256
      into publication_manifest, publication_hash
      from examination_room_v1.student_sessions s
      join examination_room_v1.exam_versions v on v.id = s.exam_version_id
      where s.id = session_id;
      replay := replay || jsonb_build_object(
        'publicationManifest', publication_manifest,
        'publicationHash', publication_hash
      );
      return replay;
    end if;

    if maximum_sessions is not null
       and (select count(*) from examination_room_v1.student_sessions s where s.activation_id = activation_id) >= maximum_sessions then
      return examination_room_v1.api_error(
        'ROOM_SESSION_LIMIT_REACHED', 'This room has reached its configured session limit.', 409,
        'Ask the professor or administrator to review the room capacity.'
      );
    end if;
    if exists (
      select 1 from examination_room_v1.student_sessions s
      where s.activation_id = activation_id and s.roster_id = roster_id
    ) then
      return examination_room_v1.api_error(
        'SESSION_ALREADY_EXISTS', 'A session already exists for this student and room.', 409,
        'Resume the existing session with its issued session token.'
      );
    end if;

    session_id := gen_random_uuid();
    lease_expires_at := case
      when coalesce(controls_payload ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
        then activation_closes_at
      else least(
        activation_closes_at,
        clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
      )
    end;
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id, session_status,
      identity_verified_at, identity_verification_method, started_at,
      last_heartbeat_at, lease_expires_at, session_metadata
    ) values (
      session_id,
      activation_id,
      exam_id,
      institution_id,
      exam_version_id,
      roster_id,
      session_token_hash,
      request_hash,
      (p_payload ->> 'clientInstanceId')::uuid,
      'active',
      clock_timestamp(),
      'room_key_roster_match',
      clock_timestamp(),
      clock_timestamp(),
      lease_expires_at,
      jsonb_build_object('connected', true, 'currentQuestion', 1)
    );

    insert into examination_room_v1.privacy_acceptances (
      notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
      decision, accepted_features, evidence_sha256, capture_method, recorded_at
    ) values (
      notice_version_id,
      roster_id,
      session_id,
      exam_version_id,
      (p_payload ->> 'clientEventId')::uuid,
      'accepted',
      jsonb_build_object(
        'recordingAccepted', recording_accepted,
        'cameraRequired', coalesce((controls_payload ->> 'cameraRequired')::boolean, false),
        'microphoneRequired', coalesce((controls_payload ->> 'microphoneRequired')::boolean, false),
        'integrityTier', coalesce(controls_payload ->> 'integrityTier', 'standard')
      ),
      request_hash,
      'checkbox',
      (p_payload #>> '{consent,acceptedAt}')::timestamptz
    );

    response := jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', session_id,
        'status', 'active',
        'startedAt', clock_timestamp(),
        'leaseExpiresAt', lease_expires_at,
        'anonymousCandidateId', grading_alias
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.consent',
      'student_session', session_id, request_hash, clock_timestamp(), response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  session_id := nullif(p_payload ->> 'sessionId', '')::uuid;
  session_token_hash := p_payload ->> 'sessionTokenHash';
  select
    s.institution_id,
    s.exam_id,
    s.exam_version_id,
    s.activation_id,
    s.roster_id,
    er.student_identity_id,
    s.session_status,
    s.lease_expires_at,
    a.activation_status,
    a.opens_at,
    a.closes_at,
    v.controls,
    v.publication_manifest,
    v.content_sha256,
    v.privacy_notice_version_id,
    n.notice_code,
    si.full_name,
    si.external_student_id,
    si.email_normalized,
    er.grading_alias,
    er.accommodations ->> 'subject',
    er.accommodations ->> 'yearLevel'
  into
    institution_id,
    exam_id,
    exam_version_id,
    activation_id,
    roster_id,
    student_identity_id,
    session_status,
    lease_expires_at,
    activation_status,
    activation_opens_at,
    activation_closes_at,
    controls_payload,
    publication_manifest,
    publication_hash,
    notice_version_id,
    notice_code,
    full_name,
    student_number,
    student_email,
    grading_alias,
    subject_name,
    year_level
  from examination_room_v1.student_sessions s
  join examination_room_v1.room_activations a on a.id = s.activation_id
  join examination_room_v1.exam_versions v on v.id = s.exam_version_id
  join examination_room_v1.privacy_notice_versions n on n.id = v.privacy_notice_version_id
  join examination_room_v1.exam_roster er on er.id = s.roster_id
  join examination_room_v1.student_identities si on si.id = er.student_identity_id
  where s.id = session_id
    and s.session_token_hash = session_token_hash
  for update of s;

  if institution_id is null then
    return examination_room_v1.api_error(
      'SESSION_INVALID', 'The examination session could not be verified.', 401,
      'Return to the join page and enter the same room key and student details.'
    );
  end if;

  if p_operation = 'result' and session_status = 'revoked' then
    return examination_room_v1.api_error(
      'SESSION_REVOKED', 'This examination credential has been revoked.', 401,
      'Ask the examination administrator to review access to the released result.'
    );
  end if;

  if p_operation in ('resume', 'session_context') then
    select jsonb_build_object(
      'ok', true,
      'session', jsonb_build_object(
        'id', s.id,
        'status', s.session_status,
        'startedAt', s.started_at,
        'lastHeartbeatAt', s.last_heartbeat_at,
        'leaseExpiresAt', s.lease_expires_at,
        'submittedAt', s.ended_at
      ),
      'publicationManifest', publication_manifest,
      'publicationHash', publication_hash,
      'studentIdentity', jsonb_build_object(
        'realName', full_name,
        'studentNumber', student_number,
        'subject', subject_name,
        'yearLevel', year_level
      ),
      'studentEmail', student_email,
      'privacyConsent', consent.item,
      'answerRevisions', coalesce(answers.items, '[]'::jsonb),
      'nextRevisionByQuestion', coalesce(answers.next_revisions, '{}'::jsonb),
      'anonymousCandidateId', grading_alias
    )
    into response
    from examination_room_v1.student_sessions s
    left join lateral (
      select jsonb_build_object(
        'noticeVersion', notice_code,
        'accepted', true,
        'acceptedAt', to_char(pa.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'recordingAccepted', coalesce((pa.accepted_features ->> 'recordingAccepted')::boolean, false)
      ) as item
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = s.id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawal
          where withdrawal.prior_acceptance_id = pa.id and withdrawal.decision = 'withdrawn'
        )
      order by pa.recorded_at desc
      limit 1
    ) consent on true
    left join lateral (
      with latest as (
        select distinct on (ar.question_id)
          ar.question_id,
          ar.answer_payload,
          ar.idempotency_key_hash,
          ar.revision_number
        from examination_room_v1.answer_revisions ar
        where ar.session_id = s.id
        order by ar.question_id, ar.revision_number desc
      ), next_values as (
        select q.question_key, coalesce(max(ar.revision_number), 0) + 1 as next_revision
        from examination_room_v1.questions q
        left join examination_room_v1.answer_revisions ar
          on ar.question_id = q.id and ar.session_id = s.id
        where q.exam_version_id = s.exam_version_id
        group by q.question_key
      )
      select
        coalesce((
          select jsonb_agg(
            latest.answer_payload || jsonb_build_object('idempotencyKey', latest.idempotency_key_hash)
            order by q.position
          )
          from latest
          join examination_room_v1.questions q on q.id = latest.question_id
        ), '[]'::jsonb) as items,
        coalesce((select jsonb_object_agg(next_values.question_key, next_values.next_revision) from next_values), '{}'::jsonb) as next_revisions
    ) answers on true
    where s.id = session_id;

    if p_operation = 'session_context' and response -> 'privacyConsent' = 'null'::jsonb then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;
    return response;
  end if;

  if p_operation = 'result' then
    select rr.release_manifest
    into result_manifest
    from examination_room_v1.submissions sub
    join examination_room_v1.result_releases rr
      on rr.submission_id = sub.id and rr.release_action = 'release'
    where sub.session_id = session_id
      and not exists (
        select 1 from examination_room_v1.result_releases revoked
        where revoked.supersedes_release_id = rr.id and revoked.release_action = 'revoke'
      )
    order by rr.occurred_at desc
    limit 1;

    if result_manifest is null then
      return jsonb_build_object('ok', true, 'available', false, 'status', 'awaiting_release');
    end if;
    return jsonb_build_object(
      'ok', true,
      'available', true,
      'releasedAt', result_manifest -> 'releasedAt',
      'result', result_manifest -> 'result'
    );
  end if;

  if p_operation in ('heartbeat', 'record_event', 'save_answer', 'submit', 'submission_intent')
     and not exists (
       select 1
       from examination_room_v1.privacy_acceptances pa
       where pa.session_id = session_id
         and pa.notice_version_id = notice_version_id
         and pa.decision = 'accepted'
         and not exists (
           select 1
           from examination_room_v1.privacy_acceptances withdrawn
           where withdrawn.prior_acceptance_id = pa.id
             and withdrawn.decision = 'withdrawn'
         )
     ) then
    return examination_room_v1.api_error(
      'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
      'Return to the join page and review the current notice.'
    );
  end if;

  request_hash := p_payload ->> 'requestHash';
  audit_request_hash := case
    when p_operation = 'submit' then
      encode(extensions.digest(request_hash || ':student.submit', 'sha256'), 'hex')
    else request_hash
  end;

  replay := examination_room_v1.api_replay(
    institution_id,
    audit_request_hash,
    'student.' || p_operation
  );

  if replay is null
     and p_operation = 'submit'
     and exists (
       select 1
       from examination_room_v1.audit_events legacy
       where legacy.institution_id = institution_id
         and legacy.request_hash = request_hash
         and legacy.event_type = 'student.submit'
     ) then
    replay := examination_room_v1.api_replay(
      institution_id,
      request_hash,
      'student.submit'
    );
  end if;

  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      if replay #>> '{submission,submittedAt}' is null then
        select sub.submitted_at_client
        into occurred_at
        from examination_room_v1.submissions sub
        where sub.session_id = session_id
          and sub.idempotency_key_hash = request_hash
        order by sub.received_at desc
        limit 1;

        if occurred_at is not null then
          replay := jsonb_set(
            replay,
            '{submission,submittedAt}',
            to_jsonb(occurred_at),
            true
          );
        end if;
      end if;
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
  end if;

  occurred_at := coalesce((p_payload ->> 'occurredAt')::timestamptz, clock_timestamp());

  if p_operation = 'heartbeat' then
    update examination_room_v1.student_sessions s
    set last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), occurred_at),
        session_metadata = s.session_metadata || jsonb_build_object(
          'connected', coalesce((p_payload ->> 'connected')::boolean, true),
          'currentQuestion', coalesce((p_payload ->> 'currentQuestion')::integer, 1)
        )
    where s.id = session_id;
    response := jsonb_build_object(
      'ok', true,
      'sessionId', session_id,
      'receivedAt', clock_timestamp(),
      'connected', coalesce((p_payload ->> 'connected')::boolean, true)
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.heartbeat',
      'student_session', session_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'record_event' then
    insert into examination_room_v1.proctoring_incidents (
      session_id, client_event_id, incident_kind, source, severity,
      occurred_at, duration_ms, details
    ) values (
      session_id,
      (p_payload ->> 'clientEventId')::uuid,
      p_payload ->> 'incidentKind',
      'browser_signal',
      coalesce(p_payload ->> 'severity', 'info'),
      occurred_at,
      nullif(p_payload ->> 'durationMs', '')::integer,
      coalesce(p_payload -> 'details', '{}'::jsonb)
    )
    returning id into answer_revision_id;
    response := jsonb_build_object('ok', true, 'incidentId', answer_revision_id, 'recordedAt', clock_timestamp());
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.record_event',
      'proctoring_incident', answer_revision_id, request_hash, occurred_at, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'save_answer' then
    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    answer_item := p_payload -> 'answerRevision';
    select q.id, coalesce(q.configuration ->> 'type', replace(q.question_kind, '_', '-'))
    into question_id, expected_question_type
    from examination_room_v1.questions q
    where q.exam_version_id = exam_version_id
      and q.position = (answer_item ->> 'questionNumber')::integer
      and q.question_key = answer_item ->> 'questionKey';
    if question_id is null
       or (answer_item ->> 'attemptId')::uuid <> session_id
       or (answer_item ->> 'examinationId')::uuid <> exam_id
       or coalesce((answer_item ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or answer_item ->> 'questionType' <> expected_question_type
       or answer_item ->> 'publicationHash' <> publication_hash then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'The answer does not belong to this exact examination session and version.', 409,
        'Refresh the examination. Your other saved answers remain preserved.'
      );
    end if;
    select coalesce(max(ar.revision_number), 0) + 1
    into next_revision
    from examination_room_v1.answer_revisions ar
    where ar.session_id = session_id and ar.question_id = question_id;
    if (answer_item ->> 'revision')::integer <> next_revision then
      return examination_room_v1.api_error(
        'ANSWER_REVISION_CONFLICT', 'A newer answer revision already exists for this question.', 409,
        'Refresh the saved answer state, then save again.'
      );
    end if;

    answer_revision_id := gen_random_uuid();
    insert into examination_room_v1.answer_revisions (
      id, session_id, exam_version_id, question_id, revision_number,
      client_revision_id, idempotency_key_hash, answer_format, answer_payload,
      answer_sha256, is_flagged, source, saved_at
    ) values (
      answer_revision_id,
      session_id,
      exam_version_id,
      question_id,
      next_revision,
      (p_payload ->> 'clientEventId')::uuid,
      request_hash,
      case
        when answer_item ->> 'questionType' = 'multiple-choice' then 'choice'
        when answer_item ->> 'questionType' = 'true-false' then 'boolean'
        else 'plain_text'
      end,
      answer_item,
      p_payload ->> 'answerHash',
      coalesce((p_payload ->> 'flagged')::boolean, false),
      coalesce(p_payload ->> 'source', 'autosave'),
      (p_payload ->> 'savedAt')::timestamptz
    );
    response := jsonb_build_object(
      'ok', true,
      'revision', jsonb_build_object(
        'id', answer_revision_id,
        'questionKey', answer_item ->> 'questionKey',
        'revision', next_revision,
        'savedAt', p_payload -> 'savedAt',
        'flagged', coalesce((p_payload ->> 'flagged')::boolean, false)
      )
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.save_answer',
      'answer_revision', answer_revision_id, request_hash,
      (p_payload ->> 'savedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  if p_operation = 'submit' then
    submission_manifest := p_payload -> 'submissionManifest';

    select pa.recorded_at, pa.accepted_features
    into accepted_at, accepted_features
    from examination_room_v1.privacy_acceptances pa
    where pa.session_id = session_id
      and pa.notice_version_id = notice_version_id
      and pa.decision = 'accepted'
      and not exists (
        select 1
        from examination_room_v1.privacy_acceptances withdrawn
        where withdrawn.prior_acceptance_id = pa.id
          and withdrawn.decision = 'withdrawn'
      )
    order by pa.recorded_at desc
    limit 1;

    if coalesce(submission_manifest ->> 'schemaVersion', '') <> 'examination-room/submission/v1'
       or (submission_manifest ->> 'attemptId')::uuid <> session_id
       or (submission_manifest ->> 'examinationId')::uuid <> exam_id
       or coalesce((submission_manifest ->> 'examinationVersion')::integer, -1) <> (publication_manifest ->> 'version')::integer
       or submission_manifest ->> 'publicationHash' <> publication_hash
       or submission_manifest ->> 'identityMode' <> coalesce(controls_payload ->> 'identityMode', 'real_names')
       or submission_manifest -> 'studentIdentity' is distinct from jsonb_build_object(
         'realName', full_name,
         'studentNumber', student_number,
         'subject', subject_name,
         'yearLevel', year_level
       )
       or submission_manifest -> 'gradingIdentity' is distinct from (case
         when coalesce(controls_payload ->> 'identityMode', 'real_names') = 'anonymous_grading' then
           jsonb_build_object('mode', 'anonymous_grading', 'anonymousCandidateId', grading_alias)
         else
           jsonb_build_object('mode', 'real_names', 'displayName', full_name, 'studentNumber', student_number)
       end)
       or submission_manifest #>> '{privacyConsent,noticeVersion}' <> notice_code
       or not coalesce((submission_manifest #>> '{privacyConsent,accepted}')::boolean, false) then
      return examination_room_v1.api_error(
        'SUBMISSION_BINDING_MISMATCH', 'The submission does not match this exact session, publication, and consent.', 409,
        'Reconnect to the examination and submit the server-backed answers again.'
      );
    end if;

    if submission_manifest -> 'privacyConsent' is distinct from jsonb_build_object(
         'noticeVersion', notice_code,
         'accepted', true,
         'acceptedAt', to_char(accepted_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
         'recordingAccepted', coalesce((accepted_features ->> 'recordingAccepted')::boolean, false)
       ) then
      return examination_room_v1.api_error(
        'SUBMISSION_CONSENT_MISMATCH', 'The submission consent evidence does not match the immutable server receipt.', 409,
        'Reconnect to the examination and submit the server-backed consent receipt again.'
      );
    end if;

    if not exists (
      select 1
      from examination_room_v1.privacy_acceptances pa
      where pa.session_id = session_id
        and pa.notice_version_id = notice_version_id
        and pa.decision = 'accepted'
        and not exists (
          select 1 from examination_room_v1.privacy_acceptances withdrawn
          where withdrawn.prior_acceptance_id = pa.id and withdrawn.decision = 'withdrawn'
        )
    ) then
      return examination_room_v1.api_error(
        'PRIVACY_CONSENT_REQUIRED', 'The exact current privacy consent is missing or withdrawn.', 412,
        'Return to the join page and review the current notice.'
      );
    end if;

    expected_count := jsonb_array_length(coalesce(p_payload -> 'answerSelections', '[]'::jsonb));
    if expected_count <> (select count(*) from examination_room_v1.questions q where q.exam_version_id = exam_version_id)
       or expected_count <> jsonb_array_length(coalesce(submission_manifest -> 'questions', '[]'::jsonb))
       or coalesce((submission_manifest ->> 'questionCount')::integer, -1) <> expected_count
       or coalesce((submission_manifest ->> 'maxPoints')::numeric, -1) <>
          (select coalesce(sum(q.points), 0) from examination_room_v1.questions q where q.exam_version_id = exam_version_id) then
      return examination_room_v1.api_error(
        'SUBMISSION_ANSWER_MISSING', 'Every question must have one saved answer revision before submission.', 400,
        'Return to the listed question, save an answer, then submit again.'
      );
    end if;

    select count(*)::integer
    into matched_count
    from jsonb_array_elements(p_payload -> 'answerSelections') selected(value)
    join examination_room_v1.questions q
      on q.exam_version_id = exam_version_id
     and q.position = (selected.value ->> 'questionNumber')::integer
     and q.question_key = selected.value ->> 'questionKey'
    join examination_room_v1.answer_revisions ar
      on ar.session_id = session_id
     and ar.question_id = q.id
     and ar.revision_number = (selected.value ->> 'revision')::integer
    join lateral (
      select manifest_question.value
      from jsonb_array_elements(submission_manifest -> 'questions') manifest_question(value)
      where (manifest_question.value ->> 'questionNumber')::integer = q.position
        and manifest_question.value ->> 'questionKey' = q.question_key
        and (manifest_question.value ->> 'revision')::integer = ar.revision_number
        and manifest_question.value -> 'answer' = ar.answer_payload -> 'answer'
    ) bound on true;

    if matched_count <> expected_count then
      return examination_room_v1.api_error(
        'ANSWER_BINDING_MISMATCH', 'One or more submitted answers does not match its saved server revision.', 409,
        'Refresh the saved-answer state and submit again.'
      );
    end if;

    submission_id := (submission_manifest ->> 'submissionId')::uuid;
    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      submission_id,
      session_id,
      exam_version_id,
      request_hash,
      p_payload ->> 'manifestHash',
      submission_manifest,
      expected_count,
      (submission_manifest ->> 'submittedAt')::timestamptz
    );

    for answer_selection in select value from jsonb_array_elements(p_payload -> 'answerSelections')
    loop
      select q.id, ar.id
      into question_id, answer_revision_id
      from examination_room_v1.questions q
      join examination_room_v1.answer_revisions ar
        on ar.question_id = q.id
       and ar.session_id = session_id
       and ar.revision_number = (answer_selection ->> 'revision')::integer
      where q.exam_version_id = exam_version_id
        and q.position = (answer_selection ->> 'questionNumber')::integer
        and q.question_key = answer_selection ->> 'questionKey';
      insert into examination_room_v1.submission_answers (
        submission_id, session_id, question_id, answer_revision_id
      ) values (
        submission_id, session_id, question_id, answer_revision_id
      );
    end loop;

    insert into examination_room_v1.submission_receipts (
      submission_id, receipt_sha256, receipt_payload
    ) values (
      submission_id,
      p_payload ->> 'manifestHash',
      jsonb_build_object(
        'schemaVersion', 'examination-room/submission-receipt/v1',
        'submissionId', submission_id,
        'manifestHash', p_payload ->> 'manifestHash',
        'answerCount', expected_count,
        'receivedAt', clock_timestamp()
      )
    ) returning id into answer_revision_id;

    update examination_room_v1.student_sessions s
    set session_status = 'submitted', ended_at = clock_timestamp()
    where s.id = session_id;
    update examination_room_v1.exam_roster er
    set roster_status = 'completed'
    where er.id = roster_id;

    insert into examination_room_v1.recovery_snapshots (
      exam_id, exam_version_id, snapshot_sequence, snapshot_scope, request_hash,
      record_count, snapshot_status, retention_until
    ) values (
      exam_id,
      exam_version_id,
      examination_room_v1.next_snapshot_sequence(exam_id),
      'answer_state',
      request_hash,
      expected_count,
      'pending',
      clock_timestamp() + interval '365 days'
    );

    response := jsonb_build_object(
      'ok', true,
      'submission', jsonb_build_object(
        'id', submission_id,
        'status', 'accepted',
        'receiptId', answer_revision_id,
        'submittedAt', (submission_manifest ->> 'submittedAt')::timestamptz,
        'receivedAt', clock_timestamp()
      ),
      'duplicate', false
    );
    perform examination_room_v1.api_record_audit(
      institution_id, exam_id, session_id, null, 'student', 'student.submit',
      'submission', submission_id, audit_request_hash,
      (submission_manifest ->> 'submittedAt')::timestamptz, response,
      (p_payload ->> 'clientEventId')::uuid
    );
    return response;
  end if;

  return examination_room_v1.api_error(
    'UNKNOWN_OPERATION', 'The student operation is not implemented.', 400,
    'Refresh the examination and try a listed action.'
  );
end;
$function$
;
