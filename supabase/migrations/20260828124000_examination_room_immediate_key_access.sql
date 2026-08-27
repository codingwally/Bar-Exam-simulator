begin;

-- Admin approval and key issuance are one atomic state transition. The caller
-- may continue sending a closing timestamp for backwards compatibility, but
-- neither an opening timestamp nor a closing timestamp is required. A missing
-- or already-past closing timestamp receives a conservative recovery horizon;
-- owner close, block, revoke, archive, and replacement controls still win.
do $immediate_admin_activation$
declare
  source_definition text;
  patched_definition text;
  old_declaration text := $old$  request_hash text;
  event_time timestamptz;
  activation_id uuid;$old$;
  new_declaration text := $new$  request_hash text;
  event_time timestamptz;
  activation_expires_at timestamptz;
  activation_id uuid;$new$;
  old_event_time text := $old$    event_time := clock_timestamp();
    if coalesce((p_payload ->> 'replaceCurrent')::boolean, false) then$old$;
  new_event_time text := $new$    event_time := clock_timestamp();
    activation_expires_at := case
      when nullif(btrim(p_payload ->> 'closesAt'), '') is null
        then event_time + interval '180 days'
      when (p_payload ->> 'closesAt')::timestamptz <= event_time
        then event_time + interval '180 days'
      else (p_payload ->> 'closesAt')::timestamptz
    end;
    if coalesce((p_payload ->> 'replaceCurrent')::boolean, false) then$new$;
  old_activation_values text := $old$      request_hash,
      'scheduled',
      (p_payload ->> 'opensAt')::timestamptz,
      (p_payload ->> 'closesAt')::timestamptz,$old$;
  new_activation_values text := $new$      request_hash,
      'open',
      event_time,
      activation_expires_at,$new$;
  old_activation_response text := $old$        'status', 'scheduled',
        'opensAt', (p_payload ->> 'opensAt')::timestamptz,
        'expiresAt', (p_payload ->> 'closesAt')::timestamptz,$old$;
  new_activation_response text := $new$        'status', 'open',
        'opensAt', event_time,
        'expiresAt', activation_expires_at,$new$;
  replay_guard_start integer;
  replay_return_relative integer;
  replay_return_length integer := length('      return replay;');
  new_replay_return text := $new_replay_return$      if activation_status = 'scheduled' then
        update examination_room_v1.room_activations activation
        set activation_status = 'open',
            opens_at = least(activation.opens_at, clock_timestamp()),
            deactivated_at = null,
            deactivated_by_user_id = null,
            deactivation_reason = null
        where activation.id = activation_id
          and activation.activation_status = 'scheduled'
          and activation.closes_at > clock_timestamp();
        select activation.activation_status into activation_status
        from examination_room_v1.room_activations activation
        where activation.id = activation_id;
      end if;
      if activation_status = 'open' then
        replay := jsonb_set(replay, '{activation,status}', to_jsonb('open'::text), true)
          || jsonb_build_object('status', 'open');
      end if;
      return replay;$new_replay_return$;
begin
  source_definition := replace(
    pg_catalog.pg_get_functiondef(
      'examination_room_v1.api_admin(text,uuid,uuid,jsonb)'::regprocedure
    ),
    chr(13) || chr(10),
    chr(10)
  );

  patched_definition := replace(source_definition, old_declaration, new_declaration);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not extend api_admin declarations';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(source_definition, old_event_time, new_event_time);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not install the optional activation window';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(source_definition, old_activation_values, new_activation_values);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not make issued keys open immediately';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(source_definition, old_activation_response, new_activation_response);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not update the activation receipt';
  end if;
  source_definition := patched_definition;

  replay_guard_start := strpos(
    source_definition,
    'if stored_key_hash <> p_payload ->> ''roomKeyHash'' then'
  );
  replay_return_relative := strpos(
    substring(source_definition from replay_guard_start),
    '      return replay;'
  );
  if replay_guard_start = 0 or replay_return_relative = 0 then
    raise exception 'immediate key access migration could not locate strict activation replay';
  end if;
  patched_definition := overlay(
    source_definition placing new_replay_return
    from replay_guard_start + replay_return_relative - 1
    for replay_return_length
  );
  if position('''The prior room-key request is already bound to a different key.''' in patched_definition) = 0 then
    raise exception 'immediate key access migration would weaken strict idempotent key replay';
  end if;
  if position('activation_expires_at' in patched_definition) = 0
     or position('''status'', ''open''' in patched_definition) = 0 then
    raise exception 'immediate key access migration did not preserve atomic open-key insertion';
  end if;
  if position('examination_room_v1.api_record_audit' in patched_definition) = 0 then
    raise exception 'immediate key access migration would remove the activation audit';
  end if;
  execute patched_definition;
end;
$immediate_admin_activation$;

-- Compatibility for keys approved before this migration. Non-expired scheduled
-- keys on usable examinations become open in place. Blocked or archived exams
-- retain their denial state and can only be recovered by an explicit owner
-- lifecycle action.
update examination_room_v1.room_activations activation
set activation_status = 'open',
    opens_at = least(activation.opens_at, clock_timestamp()),
    deactivated_at = null,
    deactivated_by_user_id = null,
    deactivation_reason = null
from examination_room_v1.exams exam
where exam.id = activation.exam_id
  and exam.institution_id = activation.institution_id
  and activation.activation_status = 'scheduled'
  and activation.closes_at > clock_timestamp()
  and exam.blocked_at is null
  and exam.deleted_at is null
  and exam.status <> 'archived';

-- Student admission remains backwards compatible with a scheduled key created
-- by an older application node during a rolling release. The lifecycle guard
-- executes before promotion, so blocked and archived rooms cannot be opened by
-- a student. Closed, revoked, and expired activations remain invalid.
do $immediate_student_admission$
declare
  source_definition text;
  patched_definition text;
  old_declaration text := $old$  use_anonymous_grading boolean;
begin$old$;
  new_declaration text := $new$  use_anonymous_grading boolean;
  lifecycle_result jsonb;
begin$new$;
  old_activation_lookup text := $old$  where activation.key_hash = p_payload ->> 'roomKeyHash'
    and activation.activation_status in ('scheduled', 'open')
    and activation.closes_at > clock_timestamp()
  order by activation.created_at desc, activation.id desc
  limit 1;$old$;
  new_activation_lookup text := $new$  where activation.key_hash = p_payload ->> 'roomKeyHash'
  order by activation.created_at desc, activation.id desc
  limit 1;$new$;
  initial_invalid_guard text := $guard$  if activation_row.id is null then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;$guard$;
  lifecycle_and_activation_guard text := $replacement$  if activation_row.id is null then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;

  lifecycle_result := public.examination_room_v1_lifecycle_guard(activation_row.exam_id);
  if lifecycle_result ->> 'ok' <> 'true' then
    return lifecycle_result;
  end if;

  if activation_row.activation_status not in ('scheduled', 'open')
     or activation_row.closes_at <= clock_timestamp() then
    return examination_room_v1.api_error(
      'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
      'Copy the complete current key from the Professor message and try again.'
    );
  end if;

  if activation_row.activation_status = 'scheduled' then
    update examination_room_v1.room_activations activation
    set activation_status = 'open',
        opens_at = least(activation.opens_at, clock_timestamp()),
        deactivated_at = null,
        deactivated_by_user_id = null,
        deactivation_reason = null
    where activation.id = activation_row.id
      and activation.activation_status = 'scheduled'
      and activation.closes_at > clock_timestamp()
    returning activation.* into activation_row;

    if not found then
      select activation.* into activation_row
      from examination_room_v1.room_activations activation
      where activation.key_hash = p_payload ->> 'roomKeyHash'
        and activation.activation_status = 'open'
        and activation.closes_at > clock_timestamp();
    end if;
    if activation_row.id is null then
      return examination_room_v1.api_error(
        'ROOM_KEY_INVALID', 'The room key is expired, revoked, or not recognized.', 401,
        'Copy the complete current key from the Professor message and try again.'
      );
    end if;
  end if;$replacement$;
begin
  source_definition := replace(
    pg_catalog.pg_get_functiondef(
      'examination_room_v1.prepare_student_admission(jsonb)'::regprocedure
    ),
    chr(13) || chr(10),
    chr(10)
  );
  patched_definition := replace(source_definition, old_declaration, new_declaration);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not extend admission declarations';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(source_definition, old_activation_lookup, new_activation_lookup);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not preserve historical key state checks';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(
    source_definition,
    initial_invalid_guard,
    lifecycle_and_activation_guard
  );
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not install lifecycle-safe admission';
  end if;
  if position('public.examination_room_v1_lifecycle_guard(activation_row.exam_id)' in patched_definition) = 0 then
    raise exception 'immediate key access migration would bypass blocked or archived admission';
  end if;
  if position('activation_row.activation_status not in (''scheduled'', ''open'')' in patched_definition) = 0 then
    raise exception 'immediate key access migration would accept revoked or closed keys';
  end if;
  execute patched_definition;
end;
$immediate_student_admission$;

-- Recheck the lifecycle state inside the protected student function as a
-- transaction-race guard between self-admission and preview/consent assembly.
do $immediate_student_lifecycle_race_guard$
declare
  source_definition text;
  patched_definition text;
  old_declaration text := $old$  result_manifest jsonb;
  activation_opens_at timestamptz;$old$;
  new_declaration text := $new$  result_manifest jsonb;
  lifecycle_result jsonb;
  activation_opens_at timestamptz;$new$;
  preview_marker text := $old$    if p_operation = 'preview' then$old$;
  preview_with_guard text := $new$    lifecycle_result := public.examination_room_v1_lifecycle_guard(exam_id);
    if lifecycle_result ->> 'ok' <> 'true' then
      return lifecycle_result;
    end if;

    if p_operation = 'preview' then$new$;
begin
  source_definition := replace(
    pg_catalog.pg_get_functiondef(
      'examination_room_v1.api_student(text,jsonb)'::regprocedure
    ),
    chr(13) || chr(10),
    chr(10)
  );
  patched_definition := replace(source_definition, old_declaration, new_declaration);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not extend student declarations';
  end if;
  source_definition := patched_definition;

  patched_definition := replace(source_definition, preview_marker, preview_with_guard);
  if patched_definition = source_definition then
    raise exception 'immediate key access migration could not install the student lifecycle race guard';
  end if;
  if position('activation_status <> ''open''' in patched_definition) = 0 then
    raise exception 'immediate key access migration would remove the final begin-exam open-state guard';
  end if;
  execute patched_definition;
end;
$immediate_student_lifecycle_race_guard$;

comment on function examination_room_v1.prepare_student_admission(jsonb) is
  'Service-only roster-free admission. Admin-issued keys are immediately open; legacy scheduled keys promote only after lifecycle, status, and expiry checks.';

notify pgrst, 'reload schema';

commit;
