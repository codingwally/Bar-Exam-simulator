-- DueDiligence 2026 Examination Room: align private source paths, integrity
-- presets, and the owning-professor unlock workflow with the published spec.

begin;

create or replace function public.exam_room_confirm_questions(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_object_path text,
  p_safe_file_name text,
  p_mime_type text,
  p_size_bytes integer,
  p_page_count integer,
  p_content_hash text,
  p_questions jsonb,
  p_warnings jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_source public.exam_room_question_sources%rowtype;
  v_version public.exam_room_question_versions%rowtype;
  v_source_version integer;
  v_question jsonb;
  v_ordinal integer;
  v_prompt text;
  v_count integer;
  v_snapshot_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status <> 'draft' then raise exception 'EXAM_ROOM_EXAM_NOT_DRAFT'; end if;
  if p_mime_type not in ('text/plain', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    or p_size_bytes not between 1 and 10485760
    or (p_page_count is not null and p_page_count not between 1 and 50)
    or p_content_hash !~ '^[0-9a-f]{64}$'
    or p_object_path !~ (
      '^' || p_professor_user_id::text || '/' || v_exam.public_id::text
      || '/[0-9a-f]{64}-[A-Za-z0-9_.-]+$'
    )
    or char_length(btrim(p_safe_file_name)) not between 1 and 180
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_typeof(p_warnings) <> 'array'
  then raise exception 'EXAM_ROOM_QUESTION_SOURCE_INVALID'; end if;

  v_count := jsonb_array_length(p_questions);
  if v_count < 1 or v_count <> v_exam.requested_question_count then
    raise exception 'EXAM_ROOM_QUESTION_COUNT_MISMATCH';
  end if;
  if exists (
    select 1 from (
      select (value ->> 'ordinal')::integer ordinal, count(*) count_rows
      from jsonb_array_elements(p_questions)
      group by 1 having count(*) > 1
    ) d
  ) then raise exception 'EXAM_ROOM_QUESTION_ORDINAL_DUPLICATE'; end if;

  for v_question in select value from jsonb_array_elements(p_questions)
  loop
    begin
      v_ordinal := (v_question ->> 'ordinal')::integer;
    exception when others then
      raise exception 'EXAM_ROOM_QUESTION_ORDINAL_INVALID';
    end;
    v_prompt := v_question ->> 'prompt';
    if v_ordinal not between 1 and v_count or char_length(btrim(v_prompt)) < 1 then
      raise exception 'EXAM_ROOM_QUESTION_INVALID';
    end if;
  end loop;

  if exists (
    select 1 from generate_series(1, v_count) expected
    where not exists (
      select 1 from jsonb_array_elements(p_questions) q
      where (q ->> 'ordinal')::integer = expected
    )
  ) then raise exception 'EXAM_ROOM_QUESTION_SEQUENCE_INVALID'; end if;

  select coalesce(max(source_version), 0) + 1 into v_source_version
  from public.exam_room_question_sources where exam_id = v_exam.id;
  insert into public.exam_room_question_sources (
    exam_id, source_version, object_path, safe_file_name, mime_type,
    size_bytes, page_count, content_hash, extraction_status,
    extraction_warnings, uploaded_by, confirmed_by, confirmed_at
  ) values (
    v_exam.id, v_source_version, p_object_path, p_safe_file_name, p_mime_type,
    p_size_bytes, p_page_count, p_content_hash, 'confirmed',
    p_warnings, p_professor_user_id, p_professor_user_id, now()
  ) returning * into v_source;

  v_snapshot_hash := encode(digest(convert_to(p_questions::text, 'UTF8'), 'sha256'), 'hex');
  insert into public.exam_room_question_versions (
    exam_id, source_id, version_number, question_count, snapshot_hash, confirmed_by
  ) values (
    v_exam.id, v_source.id, v_source_version, v_count, v_snapshot_hash, p_professor_user_id
  ) returning * into v_version;

  for v_question in select value from jsonb_array_elements(p_questions) order by (value ->> 'ordinal')::integer
  loop
    v_ordinal := (v_question ->> 'ordinal')::integer;
    v_prompt := v_question ->> 'prompt';
    insert into public.exam_room_questions (
      question_version_id, ordinal, prompt_text, maximum_points, prompt_hash
    ) values (
      v_version.id, v_ordinal, v_prompt,
      coalesce(nullif(v_question ->> 'maximumPoints', '')::numeric, 5),
      encode(digest(convert_to(v_prompt, 'UTF8'), 'sha256'), 'hex')
    );
  end loop;

  update public.exam_room_exams
  set active_question_version_id = v_version.id,
      status = 'confirmed', updated_at = now()
  where id = v_exam.id;

  perform public.exam_room_queue_backup(
    v_exam.id,
    'exam_confirmed',
    jsonb_build_object(
      'examId', v_exam.public_id,
      'sourceVersion', v_source.source_version,
      'objectPath', v_source.object_path,
      'safeFileName', v_source.safe_file_name,
      'mimeType', v_source.mime_type,
      'sizeBytes', v_source.size_bytes,
      'pageCount', v_source.page_count,
      'contentHash', v_source.content_hash,
      'snapshotHash', v_version.snapshot_hash,
      'questions', p_questions,
      'warnings', p_warnings
    )
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id,
    'questions_confirmed',
    jsonb_build_object(
      'sourceId', v_source.id,
      'questionVersionId', v_version.id,
      'questionCount', v_count,
      'contentHash', v_source.content_hash
    )
  );
  return jsonb_build_object(
    'examId', v_exam.public_id,
    'questionVersionId', v_version.id,
    'questionCount', v_count,
    'snapshotHash', v_version.snapshot_hash,
    'status', 'confirmed'
  );
end;
$$;

create or replace function public.exam_room_schedule_exam(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_opens_at timestamptz,
  p_hard_closes_at timestamptz,
  p_duration_minutes integer,
  p_student_key_hash text,
  p_grading_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_unlock_hash text;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id
  for update;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status <> 'confirmed' or v_exam.active_question_version_id is null then
    raise exception 'EXAM_ROOM_EXAM_NOT_CONFIRMED';
  end if;
  if p_hard_closes_at <= p_opens_at
    or (p_duration_minutes is not null and p_duration_minutes not between 1 and 480)
    or p_student_key_hash !~ '^[0-9a-f]{64}$'
    or p_grading_key_hash !~ '^[0-9a-f]{64}$'
    or p_student_key_hash = p_grading_key_hash
  then raise exception 'EXAM_ROOM_SCHEDULE_INVALID'; end if;
  if not exists (
    select 1 from public.exam_room_roster r
    where r.classroom_id = v_exam.classroom_id and r.status = 'active'
  ) then raise exception 'EXAM_ROOM_ROSTER_REQUIRED'; end if;

  v_unlock_hash := encode(
    extensions.digest(convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'),
    'hex'
  );

  update public.exam_room_exams
  set opens_at = p_opens_at, hard_closes_at = p_hard_closes_at,
      duration_minutes = p_duration_minutes, status = 'scheduled', updated_at = now()
  where id = v_exam.id;

  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, scoped_user_id, status,
    valid_from, expires_at, created_by
  ) values
    (v_exam.id, 'student_exam', p_student_key_hash, null, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id),
    (v_exam.id, 'professor_grading', p_grading_key_hash, p_professor_user_id, 'active', p_hard_closes_at, p_hard_closes_at + interval '180 days', p_professor_user_id),
    (v_exam.id, 'attempt_unlock', v_unlock_hash, p_professor_user_id, 'active', p_opens_at, p_hard_closes_at, p_professor_user_id);

  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, action, metadata
  ) values (
    p_professor_user_id, v_exam.id, v_exam.classroom_id, 'exam_scheduled',
    jsonb_build_object('opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at, 'durationMinutes', p_duration_minutes)
  );
  return jsonb_build_object('examId', v_exam.public_id, 'status', 'scheduled', 'opensAt', p_opens_at, 'hardClosesAt', p_hard_closes_at);
end;
$$;

create or replace function public.exam_room_live_status(
  p_professor_user_id uuid,
  p_exam_public_id uuid,
  p_grading_key_hash text,
  p_rate_key_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_unlock_hash text;
  v_candidates jsonb;
begin
  perform public.exam_room_require_professor(p_professor_user_id);
  select * into v_exam from public.exam_room_exams
  where public_id = p_exam_public_id and owner_professor_id = p_professor_user_id;
  if not found then raise exception 'EXAM_ROOM_EXAM_NOT_FOUND'; end if;
  if v_exam.status not in ('scheduled', 'open', 'closed') then
    raise exception 'EXAM_ROOM_MONITORING_NOT_AVAILABLE';
  end if;
  if p_grading_key_hash !~ '^[0-9a-f]{64}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
  end if;
  v_unlock_hash := encode(
    extensions.digest(convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'),
    'hex'
  );
  v_credential := public.exam_room_check_credential(
    p_professor_user_id, v_exam.id, 'attempt_unlock', v_unlock_hash, p_rate_key_hash
  );
  if not (v_credential ->> 'ok')::boolean then return v_credential; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'attemptId', a.public_id,
    'candidateNumber', a.candidate_number,
    'status', a.status,
    'startedAt', a.started_at,
    'serverDeadline', a.server_deadline,
    'lastHeartbeatAt', a.last_heartbeat_at,
    'submittedAt', a.submitted_at,
    'incidentCount', (
      select count(*) from public.exam_room_integrity_events i
      where i.attempt_id = a.id and i.event_type not in ('warning', 'lock', 'unlock')
    )
  ) order by a.candidate_number), '[]'::jsonb)
  into v_candidates
  from public.exam_room_attempts a
  where a.exam_id = v_exam.id;

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'title', v_exam.title,
    'status', v_exam.status,
    'hardClosesAt', v_exam.hard_closes_at,
    'candidates', v_candidates
  );
end;
$$;

create or replace function public.exam_room_unlock_attempt(
  p_actor_user_id uuid,
  p_attempt_public_id uuid,
  p_reason text,
  p_grading_key_hash text default null,
  p_rate_key_hash text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_attempt public.exam_room_attempts%rowtype;
  v_exam public.exam_room_exams%rowtype;
  v_credential jsonb;
  v_unlock_hash text;
begin
  if char_length(btrim(p_reason)) not between 5 and 1000 then raise exception 'EXAM_ROOM_REASON_REQUIRED'; end if;
  select * into v_attempt from public.exam_room_attempts where public_id = p_attempt_public_id for update;
  if not found then raise exception 'EXAM_ROOM_ATTEMPT_NOT_FOUND'; end if;
  select * into v_exam from public.exam_room_exams where id = v_attempt.exam_id;
  if v_exam.status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  if not public.exam_room_is_admin(p_actor_user_id) then
    if v_exam.owner_professor_id <> p_actor_user_id then raise exception 'EXAM_ROOM_PROFESSOR_REQUIRED'; end if;
    if p_grading_key_hash !~ '^[0-9a-f]{64}$' or p_rate_key_hash !~ '^[0-9a-f]{64}$' then
      raise exception 'EXAM_ROOM_CREDENTIAL_INPUT_INVALID';
    end if;
    v_unlock_hash := encode(
      extensions.digest(convert_to(p_grading_key_hash || ':attempt_unlock', 'UTF8'), 'sha256'),
      'hex'
    );
    v_credential := public.exam_room_check_credential(
      p_actor_user_id, v_exam.id, 'attempt_unlock', v_unlock_hash, p_rate_key_hash
    );
    if not (v_credential ->> 'ok')::boolean then return v_credential; end if;
  end if;
  if v_attempt.status <> 'locked' then return jsonb_build_object('ok', true, 'status', v_attempt.status); end if;
  if now() >= v_attempt.server_deadline then
    return public.exam_room_submit_attempt_internal(v_attempt.id, true, 'deadline-auto-submit');
  end if;
  update public.exam_room_attempts
  set status = 'in_progress', locked_at = null, lock_reason = null, updated_at = now()
  where id = v_attempt.id;
  insert into public.exam_room_integrity_events (
    exam_id, attempt_id, student_user_id, event_type, details
  ) values (
    v_exam.id, v_attempt.id, v_attempt.student_user_id, 'unlock', jsonb_build_object('reason', p_reason)
  );
  insert into public.exam_room_audit_log (
    actor_user_id, exam_id, classroom_id, attempt_id, action, reason
  ) values (p_actor_user_id, v_exam.id, v_exam.classroom_id, v_attempt.id, 'attempt_unlocked', p_reason);
  return jsonb_build_object('ok', true, 'status', 'in_progress');
end;
$$;

create or replace function public.exam_room_forbid_sealed_exam_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.status = 'sealed'
    and coalesce(current_setting('app.exam_room_backup_update', true), '') <> 'on'
  then
    raise exception 'EXAM_ROOM_SEALED';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.exam_room_forbid_sealed_child_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_exam_id uuid;
  v_status text;
begin
  -- Admin grade correction receives a one-row, one-operation bypass. Clearing
  -- it in the guard prevents the transaction-local setting from authorizing
  -- any later mutation in the same request or test transaction.
  if coalesce(current_setting('app.exam_room_admin_correction', true), '') = 'on'
    and tg_table_name = 'exam_room_grades'
    and tg_op = 'UPDATE'
  then
    perform set_config('app.exam_room_admin_correction', 'off', true);
    return new;
  end if;
  if tg_table_name = 'exam_room_attempts' then
    v_exam_id := case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  elsif tg_table_name = 'exam_room_answers' then
    select exam_id into v_exam_id from public.exam_room_attempts
    where id = case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  elsif tg_table_name = 'exam_room_integrity_events' then
    v_exam_id := case when tg_op = 'DELETE' then old.exam_id else new.exam_id end;
  elsif tg_table_name = 'exam_room_grades' then
    select exam_id into v_exam_id from public.exam_room_attempts
    where id = case when tg_op = 'DELETE' then old.attempt_id else new.attempt_id end;
  else
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  select status into v_status from public.exam_room_exams where id = v_exam_id;
  if v_status = 'sealed' then raise exception 'EXAM_ROOM_SEALED'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.exam_room_complete_backup(
  p_outbox_id uuid,
  p_provider_reference text,
  p_verified_hash text,
  p_google_sheet_id text default null,
  p_professor_access_removed boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.exam_room_backup_outbox%rowtype;
begin
  if p_verified_hash !~ '^[0-9a-f]{64}$' or char_length(btrim(p_provider_reference)) not between 1 and 500 then
    raise exception 'EXAM_ROOM_BACKUP_COMPLETION_INVALID';
  end if;
  update public.exam_room_backup_outbox
  set status = 'synced', provider_reference = p_provider_reference,
      verified_hash = p_verified_hash, safe_error_code = null, synced_at = now()
  where id = p_outbox_id and status = 'processing'
  returning * into v_row;
  if not found then raise exception 'EXAM_ROOM_BACKUP_EVENT_NOT_FOUND'; end if;
  if p_google_sheet_id is not null then
    perform set_config('app.exam_room_backup_update', 'on', true);
    update public.exam_room_exams
    set google_sheet_id = p_google_sheet_id,
        google_professor_access_removed_at = case
          when p_professor_access_removed then now()
          else google_professor_access_removed_at
        end,
        updated_at = now()
    where id = v_row.exam_id;
    perform set_config('app.exam_room_backup_update', 'off', true);
  end if;
  return jsonb_build_object('ok', true, 'outboxId', v_row.id, 'status', 'synced');
end;
$$;

revoke all on function public.exam_room_confirm_questions(uuid, uuid, text, text, text, integer, integer, text, jsonb, jsonb)
  from public, anon, authenticated;
revoke all on function public.exam_room_schedule_exam(uuid, uuid, timestamptz, timestamptz, integer, text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_live_status(uuid, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_unlock_attempt(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.exam_room_forbid_sealed_exam_change()
  from public, anon, authenticated;
revoke all on function public.exam_room_forbid_sealed_child_change()
  from public, anon, authenticated;
revoke all on function public.exam_room_complete_backup(uuid, text, text, text, boolean)
  from public, anon, authenticated;

grant execute on function public.exam_room_confirm_questions(uuid, uuid, text, text, text, integer, integer, text, jsonb, jsonb)
  to service_role;
grant execute on function public.exam_room_schedule_exam(uuid, uuid, timestamptz, timestamptz, integer, text, text)
  to service_role;
grant execute on function public.exam_room_live_status(uuid, uuid, text, text)
  to service_role;
grant execute on function public.exam_room_unlock_attempt(uuid, uuid, text, text, text)
  to service_role;
grant execute on function public.exam_room_forbid_sealed_exam_change()
  to service_role;
grant execute on function public.exam_room_forbid_sealed_child_change()
  to service_role;
grant execute on function public.exam_room_complete_backup(uuid, text, text, text, boolean)
  to service_role;

commit;
