-- Fix Examination Room final submission retries that reused the same audit
-- request hash already occupied by student.submission_intent.
--
-- The client submission idempotency hash remains unchanged. Only the audit/
-- replay fingerprint for the final student.submit event is deterministically
-- namespaced so submission intent and final submit can coexist without
-- violating audit_events_institution_request_key.
--
-- Backward compatibility: already-accepted legacy submissions are replayed
-- from their original raw request hash when an exact student.submit audit
-- event exists.

do $$
declare
  fn text;
  old_replay text := $old$
  request_hash := p_payload ->> 'requestHash';
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
  if replay is not null then
$old$;
  new_replay text := $new$
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
$new$;
  submit_old text := '''submission'', submission_id, request_hash,';
  submit_new text := '''submission'', submission_id, audit_request_hash,';
begin
  select pg_get_functiondef(
    'examination_room_v1.api_student(text,jsonb)'::regprocedure
  ) into fn;

  if strpos(fn, '  audit_request_hash text;') = 0 then
    if strpos(fn, '  request_hash text;') = 0 then
      raise exception 'SUBMIT_AUDIT_HASH_REQUEST_DECLARATION_NOT_FOUND';
    end if;
    fn := replace(
      fn,
      '  request_hash text;',
      '  request_hash text;' || E'\n  audit_request_hash text;'
    );
  end if;

  if strpos(fn, old_replay) = 0 then
    raise exception 'SUBMIT_AUDIT_HASH_REPLAY_ANCHOR_NOT_FOUND';
  end if;
  fn := replace(fn, old_replay, new_replay);

  if strpos(fn, submit_old) = 0 then
    raise exception 'SUBMIT_AUDIT_HASH_FINAL_ANCHOR_NOT_FOUND';
  end if;
  fn := replace(fn, submit_old, submit_new);

  execute fn;
end
$$;

revoke all on function examination_room_v1.api_student(text, jsonb)
  from public, anon, authenticated, service_role;
