-- Ensure accepted/replayed Examination Room submissions expose submittedAt.
-- This keeps older open student tabs from retrying an already-accepted submission
-- merely because the database historically returned only receivedAt.

do $migration$
declare
  fn text;
  old_replay text := $old$
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
  if replay is not null then
    if p_operation = 'submit' and replay ->> 'ok' = 'true' then
      return jsonb_set(replay, '{duplicate}', 'true'::jsonb, true);
    end if;
    return replay;
  end if;
$old$;
  new_replay text := $new$
  replay := examination_room_v1.api_replay(institution_id, request_hash, 'student.' || p_operation);
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
$new$;
  old_response text := $old$
        'receiptId', answer_revision_id,
        'receivedAt', clock_timestamp()
$old$;
  new_response text := $new$
        'receiptId', answer_revision_id,
        'submittedAt', (submission_manifest ->> 'submittedAt')::timestamptz,
        'receivedAt', clock_timestamp()
$new$;
begin
  select pg_get_functiondef('examination_room_v1.api_student(text,jsonb)'::regprocedure)
  into fn;

  if position(old_replay in fn) > 0 then
    fn := replace(fn, old_replay, new_replay);
  end if;

  if position(old_response in fn) > 0 then
    fn := replace(fn, old_response, new_response);
  end if;

  execute fn;
end
$migration$;
