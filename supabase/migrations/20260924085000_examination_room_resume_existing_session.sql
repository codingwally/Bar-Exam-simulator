begin;

-- Recover an unfinished student session when the browser lost its local
-- session token but the current room key and exact roster identity still
-- verify. Existing immutable answer revisions are preserved.

create or replace function examination_room_v1.protect_student_session_binding()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.id is distinct from old.id
     or new.activation_id is distinct from old.activation_id
     or new.exam_id is distinct from old.exam_id
     or new.institution_id is distinct from old.institution_id
     or new.exam_version_id is distinct from old.exam_version_id
     or new.roster_id is distinct from old.roster_id
     or new.consent_request_hash is distinct from old.consent_request_hash
     or new.client_instance_id is distinct from old.client_instance_id
     or new.started_at is distinct from old.started_at
     or new.created_at is distinct from old.created_at then
    raise exception using
      errcode = '55000',
      message = 'student session identity and consent binding are immutable';
  end if;

  if new.session_token_hash is distinct from old.session_token_hash
     and not (
       old.session_status in ('created', 'active')
       and new.session_status = old.session_status
       and not exists (
         select 1
         from examination_room_v1.submissions sub
         where sub.session_id = old.id
       )
     ) then
    raise exception using
      errcode = '55000',
      message = 'student session tokens can rotate only for unfinished active sessions';
  end if;

  return new;
end;
$$;

create or replace function examination_room_v1.recover_existing_student_session(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_session_id uuid;
  v_exam_id uuid;
  v_exam_version_id uuid;
  v_institution_id uuid;
  v_roster_id uuid;
  v_session_status text;
  v_started_at timestamptz;
  v_lease_expires_at timestamptz;
  v_publication_manifest jsonb;
  v_publication_hash text;
  v_grading_alias text;
  v_request_hash text := p_payload ->> 'requestHash';
  v_session_token_hash text := p_payload ->> 'sessionTokenHash';
  v_client_event_id uuid := nullif(p_payload ->> 'clientEventId', '')::uuid;
  v_response jsonb;
begin
  if jsonb_typeof(p_payload) is distinct from 'object'
     or coalesce(p_payload ->> 'roomKeyHash', '') !~ '^[0-9a-f]{64}$'
     or coalesce(v_request_hash, '') !~ '^[0-9a-f]{64}$'
     or coalesce(v_session_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return examination_room_v1.api_error(
      'SESSION_RECOVERY_INVALID',
      'The saved examination could not be reconnected safely.',
      400,
      'Return to the join page, enter the same room key and student details, then try again.'
    );
  end if;

  select
    s.id,
    s.exam_id,
    s.exam_version_id,
    s.institution_id,
    s.roster_id,
    s.session_status,
    s.started_at,
    s.lease_expires_at,
    v.publication_manifest,
    v.content_sha256,
    er.grading_alias
  into
    v_session_id,
    v_exam_id,
    v_exam_version_id,
    v_institution_id,
    v_roster_id,
    v_session_status,
    v_started_at,
    v_lease_expires_at,
    v_publication_manifest,
    v_publication_hash,
    v_grading_alias
  from examination_room_v1.room_activations a
  join examination_room_v1.student_sessions s
    on s.activation_id = a.id
  join examination_room_v1.exam_roster er
    on er.id = s.roster_id
   and er.exam_id = s.exam_id
   and er.institution_id = s.institution_id
  join examination_room_v1.student_identities si
    on si.id = er.student_identity_id
  join examination_room_v1.exam_versions v
    on v.id = s.exam_version_id
  where a.key_hash = p_payload ->> 'roomKeyHash'
    and a.activation_status = 'open'
    and a.closes_at > clock_timestamp()
    and s.session_status in ('created', 'active')
    and upper(si.external_student_id) = upper(p_payload #>> '{identity,studentNumber}')
    and lower(btrim(si.full_name)) = lower(btrim(p_payload #>> '{identity,realName}'))
    and lower(btrim(er.accommodations ->> 'subject')) = lower(btrim(p_payload #>> '{identity,subject}'))
    and lower(btrim(er.accommodations ->> 'yearLevel')) = lower(btrim(p_payload #>> '{identity,yearLevel}'))
    and not exists (
      select 1
      from examination_room_v1.submissions sub
      where sub.session_id = s.id
    )
  order by s.started_at desc
  limit 1
  for update of s;

  if v_session_id is null then
    return examination_room_v1.api_error(
      'SESSION_ALREADY_EXISTS',
      'A session already exists for this student and room, but it could not be safely resumed.',
      409,
      'Use the same room key and exact student details. If this continues, ask the professor to review the session.'
    );
  end if;

  update examination_room_v1.student_sessions s
  set session_token_hash = v_session_token_hash,
      last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), clock_timestamp()),
      updated_at = clock_timestamp()
  where s.id = v_session_id;

  v_response := jsonb_build_object(
    'ok', true,
    'resumed', true,
    'session', jsonb_build_object(
      'id', v_session_id,
      'status', v_session_status,
      'startedAt', v_started_at,
      'leaseExpiresAt', v_lease_expires_at,
      'anonymousCandidateId', v_grading_alias
    ),
    'publicationManifest', v_publication_manifest,
    'publicationHash', v_publication_hash
  );

  perform examination_room_v1.api_record_audit(
    v_institution_id,
    v_exam_id,
    v_session_id,
    null,
    'student',
    'student.session_recovered',
    'student_session',
    v_session_id,
    v_request_hash,
    clock_timestamp(),
    v_response,
    v_client_event_id
  );

  return v_response;
end;
$$;

revoke all on function examination_room_v1.recover_existing_student_session(jsonb)
  from public, anon, authenticated;

create or replace function public.examination_room_v1_api(
  p_scope text,
  p_operation text,
  p_actor_user_id uuid,
  p_institution_id uuid,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $$
#variable_conflict use_variable
declare
  safe_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  exam_id uuid;
  admission_result jsonb;
  student_result jsonb;
begin
  if p_scope is null
     or p_operation is null
     or (p_scope <> 'student' and p_institution_id is null)
     or jsonb_typeof(safe_payload) <> 'object' then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'Scope, operation, an object payload, and workspace for creator views are required.', 400,
      'Refresh Examination Room and try again.'
    );
  end if;

  if safe_payload::text ~* '"(key|token|raw[ _-]?key|room[ _-]?(key|code)|activation[ _-]?(key|code)|exam[ _-]?(key|code)|api[ _-]?key|session[ _-]?token|idempotency[ _-]?key|access[ _-]?(token|code)|refresh[ _-]?token|bearer[ _-]?token|one[ _-]?time[ _-]?code|password|secret|authorization|credential)"[[:space:]]*:' then
    return examination_room_v1.api_error(
      'RAW_SECRET_REJECTED', 'Only one-way hashes or opaque identifiers may reach examination persistence.', 400,
      'Refresh the page and repeat the action without raw credentials.'
    );
  end if;

  if not (
    (p_scope = 'professor' and p_operation in (
      'session', 'exam', 'monitor', 'grading', 'grading_context', 'release_context',
      'save_draft', 'publish', 'open_room', 'close_room', 'revoke_session',
      'save_grade', 'release_results'
    ))
    or (p_scope = 'student' and p_operation in (
      'preview', 'consent', 'resume', 'result', 'session_context', 'save_answer',
      'record_event', 'heartbeat', 'submission_intent', 'submit'
    ))
    or (p_scope = 'admin' and p_operation in (
      'overview', 'activate_exam', 'email_key', 'revoke_key', 'create_snapshot'
    ))
  ) then
    return examination_room_v1.api_error(
      'UNKNOWN_OPERATION', 'The requested Examination Room operation is not registered.', 400,
      'Refresh Examination Room and choose a listed action.'
    );
  end if;

  if p_scope = 'professor' then
    if not examination_room_v1.creator_authorized(p_actor_user_id, p_institution_id) then
      return examination_room_v1.api_error(
        'CREATOR_WORKSPACE_REQUIRED', 'A verified account and active law-school workspace are required.', 403,
        'Sign in, choose an active workspace, then retry.'
      );
    end if;
    if p_operation in ('monitor', 'grading') then
      exam_id := nullif(safe_payload ->> 'examId', '')::uuid;
      return examination_room_v1.api_professor_view(
        p_operation, p_actor_user_id, p_institution_id, exam_id
      );
    end if;
    if p_operation = 'revoke_session' then
      return examination_room_v1.creator_revoke_session(
        p_actor_user_id, p_institution_id, safe_payload
      );
    end if;
    return examination_room_v1.api_professor(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  elsif p_scope = 'admin' then
    if not examination_room_v1.owner_authorized(p_actor_user_id)
       or not exists (
         select 1 from examination_room_v1.institutions institution
         where institution.id = p_institution_id
           and institution.institution_status = 'active'
       ) then
      return examination_room_v1.api_error(
        'PLATFORM_OWNER_REQUIRED', 'Only a Founder or Super Admin may use examination administration.', 403,
        'Sign in with a platform-owner account.'
      );
    end if;
    return examination_room_v1.api_admin(
      p_operation, p_actor_user_id, p_institution_id, safe_payload
    );
  end if;

  if p_operation in ('preview', 'consent') then
    admission_result := examination_room_v1.prepare_student_admission(safe_payload);
    if admission_result ->> 'ok' = 'false' then return admission_result; end if;
    safe_payload := jsonb_set(
      safe_payload,
      '{identity}',
      admission_result -> 'identity',
      true
    );
  end if;

  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = 'consent'
     and student_result #>> '{error,code}' = 'SESSION_ALREADY_EXISTS' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;

  return student_result;
exception
  when invalid_text_representation or datetime_field_overflow then
    return examination_room_v1.api_error(
      'INVALID_REQUEST', 'A supplied identifier, number, or timestamp is invalid.', 400,
      'Refresh the page, correct the highlighted value, and try again.'
    );
  when unique_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_CONFLICT', 'A newer or duplicate record already exists for this action.', 409,
      'Refresh the current server-backed state, then repeat the action only if still needed.'
    );
  when foreign_key_violation or check_violation or not_null_violation then
    return examination_room_v1.api_error(
      'PERSISTENCE_STATE_INVALID', 'The action does not match the current immutable examination state.', 409,
      'Refresh the examination and retry from the latest saved state.'
    );
  when object_not_in_prerequisite_state then
    return examination_room_v1.api_error(
      'IMMUTABLE_RECORD_SEALED', 'That evidence record is already sealed and cannot be changed.', 409,
      'Refresh the view and create a new revision instead of overwriting sealed evidence.'
    );
  when serialization_failure or deadlock_detected then
    return examination_room_v1.api_error(
      'RETRY_REQUIRED', 'Another examination action completed at the same time.', 409,
      'Refresh the current state and retry the action once.'
    );
  when others then
    return examination_room_v1.api_error(
      'PERSISTENCE_INTERNAL_ERROR', 'The database could not complete the examination action safely.', 500,
      'Your prior server-backed work is preserved. Try again; if it continues, contact support.'
    );
end;
$$;

revoke all on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.examination_room_v1_api(text, text, uuid, uuid, jsonb)
  to service_role;

commit;
