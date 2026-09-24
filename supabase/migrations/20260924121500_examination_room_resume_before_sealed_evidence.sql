begin;

-- Existing unfinished attempts must resume before the ordinary consent writer
-- touches immutable/idempotent evidence. This avoids retrying a sealed audit
-- record when a browser lost its local session credential.

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
  v_activation_closes_at timestamptz;
  v_controls jsonb;
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
    a.closes_at,
    v.controls,
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
    v_activation_closes_at,
    v_controls,
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
      lease_expires_at = case
        when coalesce(v_controls ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
          then v_activation_closes_at
        else s.lease_expires_at
      end,
      last_heartbeat_at = greatest(coalesce(s.last_heartbeat_at, s.started_at), clock_timestamp()),
      updated_at = clock_timestamp()
  where s.id = v_session_id
  returning s.lease_expires_at into v_lease_expires_at;

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

  -- The retry may reuse the original begin fingerprint. Audit evidence is
  -- append-only, so never try to overwrite or duplicate the sealed row.
  if not exists (
    select 1
    from examination_room_v1.audit_events ae
    where ae.institution_id = v_institution_id
      and ae.request_hash = v_request_hash
  ) then
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
  end if;

  return v_response;
end;
$$;

revoke all on function examination_room_v1.recover_existing_student_session(jsonb)
  from public, anon, authenticated;

-- In Professor-review/practice rooms, an attempt stays usable until the room
-- is closed rather than expiring merely because its nominal duration elapsed.
create or replace function examination_room_v1.apply_open_room_lease()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  v_closes_at timestamptz;
  v_controls jsonb;
begin
  select a.closes_at, v.controls
  into v_closes_at, v_controls
  from examination_room_v1.room_activations a
  join examination_room_v1.exam_versions v on v.id = new.exam_version_id
  where a.id = new.activation_id
    and a.exam_version_id = new.exam_version_id;

  if coalesce(v_controls ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
     and v_closes_at is not null then
    new.lease_expires_at := v_closes_at;
  end if;

  return new;
end;
$$;

drop trigger if exists student_sessions_open_room_lease on examination_room_v1.student_sessions;
create trigger student_sessions_open_room_lease
before insert on examination_room_v1.student_sessions
for each row
execute function examination_room_v1.apply_open_room_lease();

-- Put recovery ahead of the normal consent/replay writer.
do $$
declare
  ddl text;
  old_fragment text := $old$
  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = 'consent'
     and student_result #>> '{error,code}' = 'SESSION_ALREADY_EXISTS' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;
$old$;
  new_fragment text := $new$
  -- Resume first. Do not enter the ordinary consent/replay writer when this
  -- student already owns an unfinished session for the same open room.
  if p_operation = 'consent' and exists (
    select 1
    from examination_room_v1.room_activations a
    join examination_room_v1.student_sessions s on s.activation_id = a.id
    join examination_room_v1.exam_roster er on er.id = s.roster_id
    join examination_room_v1.student_identities si on si.id = er.student_identity_id
    where a.key_hash = safe_payload ->> 'roomKeyHash'
      and a.activation_status = 'open'
      and a.closes_at > clock_timestamp()
      and s.session_status in ('created', 'active')
      and upper(si.external_student_id) = upper(safe_payload #>> '{identity,studentNumber}')
      and lower(btrim(si.full_name)) = lower(btrim(safe_payload #>> '{identity,realName}'))
      and lower(btrim(er.accommodations ->> 'subject')) = lower(btrim(safe_payload #>> '{identity,subject}'))
      and lower(btrim(er.accommodations ->> 'yearLevel')) = lower(btrim(safe_payload #>> '{identity,yearLevel}'))
      and not exists (
        select 1
        from examination_room_v1.submissions sub
        where sub.session_id = s.id
      )
  ) then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;

  student_result := examination_room_v1.api_student(p_operation, safe_payload);

  if p_operation = 'consent'
     and student_result #>> '{error,code}' = 'SESSION_ALREADY_EXISTS' then
    return examination_room_v1.recover_existing_student_session(safe_payload);
  end if;
$new$;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='examination_room_v1_api'
    and pg_get_function_identity_arguments(p.oid)='p_scope text, p_operation text, p_actor_user_id uuid, p_institution_id uuid, p_payload jsonb';

  if position(new_fragment in ddl) = 0 then
    if position(old_fragment in ddl) = 0 then
      raise exception 'Expected Examination Room API recovery fragment was not found';
    end if;
    ddl := replace(ddl, old_fragment, new_fragment);
    execute ddl;
  end if;
end;
$$;

-- Make the value returned to a newly admitted browser match the row written by
-- the open-room lease trigger.
do $$
declare
  ddl text;
  old_fragment text := $old$
    lease_expires_at := least(
      activation_closes_at,
      clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
    );
$old$;
  new_fragment text := $new$
    lease_expires_at := case
      when coalesce(controls_payload ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
        then activation_closes_at
      else least(
        activation_closes_at,
        clock_timestamp() + make_interval(secs => duration_seconds + extra_minutes * 60)
      )
    end;
$new$;
begin
  select pg_get_functiondef(p.oid)
  into ddl
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='examination_room_v1'
    and p.proname='api_student'
    and pg_get_function_identity_arguments(p.oid)='p_operation text, p_payload jsonb';

  if position(new_fragment in ddl) = 0 then
    if position(old_fragment in ddl) = 0 then
      raise exception 'Expected Examination Room lease fragment was not found';
    end if;
    ddl := replace(ddl, old_fragment, new_fragment);
    execute ddl;
  end if;
end;
$$;

update examination_room_v1.student_sessions s
set lease_expires_at = a.closes_at,
    updated_at = clock_timestamp()
from examination_room_v1.room_activations a
join examination_room_v1.exam_versions v on v.id = a.exam_version_id
where s.activation_id = a.id
  and s.exam_version_id = v.id
  and s.session_status in ('created','active')
  and coalesce(v.controls ->> 'lateSubmissions', 'not_allowed') = 'professor_review'
  and a.activation_status = 'open'
  and a.closes_at > clock_timestamp()
  and s.lease_expires_at is distinct from a.closes_at;

commit;
