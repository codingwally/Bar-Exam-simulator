begin;

-- A missing creator email must never prevent a platform owner from activating a
-- published room. The key remains visible to the owner and can still be sent to
-- the configured owner recipients. Preserve nullable recipient evidence rather
-- than inventing an address or discarding the delivery audit.
alter table examination_room_v1.email_delivery_events
  alter column professor_recipient drop not null;

alter table examination_room_v1.email_delivery_events
  drop constraint if exists email_delivery_events_professor_recipient_check;

alter table examination_room_v1.email_delivery_events
  add constraint email_delivery_events_professor_recipient_check
  check (
    professor_recipient is null
    or (
      professor_recipient = lower(btrim(professor_recipient))
      and position('@' in professor_recipient) > 1
      and length(professor_recipient) between 3 and 320
    )
  );

comment on column examination_room_v1.email_delivery_events.professor_recipient is
  'Nullable examination-creator delivery address captured at the time of the owner action. Owner-copy recipients and provider outcomes remain durable even when the creator has no email.';

-- Preserve every later api_admin improvement by patching the installed
-- definition instead of copying an older version of the function. The response
-- already includes professorEmail, which naturally serializes SQL null as JSON
-- null, and the normal admin activation audit remains mandatory.
do $nullable_creator_activation$
declare
  source_definition text;
  patched_definition text;
  guard_start integer;
  guard_end_relative integer;
  guard_length integer;
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'examination_room_v1.api_admin(text,uuid,uuid,jsonb)'::regprocedure
  );
  guard_start := strpos(
    source_definition,
    'if p_operation = ''email_key'' and professor_email is null then'
  );
  guard_end_relative := strpos(
    substring(source_definition from guard_start),
    '    end if;'
  );
  if guard_start = 0 or guard_end_relative = 0 then
    raise exception 'nullable creator migration could not locate api_admin creator-email guard';
  end if;
  guard_length := guard_end_relative - 1 + length('    end if;');
  patched_definition := overlay(
    source_definition placing '' from guard_start for guard_length
  );
  if position('PROFESSOR_CONTACT_REQUIRED' in patched_definition) <> 0 then
    raise exception 'nullable creator migration did not remove the api_admin creator-email guard';
  end if;
  if position('''professorEmail'', professor_email' in patched_definition) = 0 then
    raise exception 'nullable creator migration would remove the nullable creator-email response';
  end if;
  if position('examination_room_v1.api_record_audit' in patched_definition) = 0 then
    raise exception 'nullable creator migration would remove the owner activation audit';
  end if;
  execute patched_definition;
end;
$nullable_creator_activation$;

-- An idempotent retry may only replay its original key. The previous function
-- could silently rewrite a scheduled activation hash before the first student
-- entered. Replacement now remains an explicit email_key/rotate_key action.
do $strict_activation_replay$
declare
  source_definition text;
  patched_definition text;
  replay_start integer;
  replay_return_relative integer;
  new_replay_guard text := $new_replay_guard$if stored_key_hash <> p_payload ->> 'roomKeyHash' then
        return examination_room_v1.api_error(
          'ACTIVATION_REPLAY_REQUIRES_NEW_REQUEST',
          'The prior room-key request is already bound to a different key.',
          409,
          'Use the explicit Rotate key action if the current key must be replaced.'
        );
      end if;
$new_replay_guard$;
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'examination_room_v1.api_admin(text,uuid,uuid,jsonb)'::regprocedure
  );
  replay_start := strpos(
    source_definition,
    'if stored_key_hash <> p_payload ->> ''roomKeyHash'' then'
  );
  replay_return_relative := strpos(
    substring(source_definition from replay_start),
    '      return replay;'
  );
  if replay_start = 0 or replay_return_relative = 0 then
    raise exception 'nullable creator migration could not locate api_admin replay guard';
  end if;
  patched_definition := overlay(
    source_definition placing new_replay_guard
    from replay_start for replay_return_relative - 1
  );
  if position('set key_hash = p_payload ->> ''roomKeyHash''' in patched_definition) <> 0 then
    raise exception 'strict replay migration did not remove the mutable key-hash update';
  end if;
  if position('examination_room_v1.api_record_audit' in patched_definition) = 0 then
    raise exception 'strict replay migration would remove the owner activation audit';
  end if;
  execute patched_definition;
end;
$strict_activation_replay$;

-- Nullable creator recipients must compare with SQL null-safe equality during
-- a delivery-audit retry so an owner-only email can be upgraded from failed to
-- sent without creating conflicting evidence.
do $nullable_creator_delivery_audit$
declare
  source_definition text;
  patched_definition text;
  old_recipient_match text := 'and persisted.professor_recipient = excluded.professor_recipient';
  new_recipient_match text := 'and persisted.professor_recipient is not distinct from excluded.professor_recipient';
begin
  source_definition := pg_catalog.pg_get_functiondef(
    'public.examination_room_v1_owner_command(text,uuid,uuid,uuid,jsonb)'::regprocedure
  );
  patched_definition := replace(source_definition, old_recipient_match, new_recipient_match);
  if patched_definition = source_definition then
    raise exception 'nullable creator migration could not locate owner delivery-audit recipient match';
  end if;
  if position('email_delivery_events' in patched_definition) = 0 then
    raise exception 'nullable creator migration would remove owner delivery evidence';
  end if;
  execute patched_definition;
end;
$nullable_creator_delivery_audit$;

notify pgrst, 'reload schema';

commit;
