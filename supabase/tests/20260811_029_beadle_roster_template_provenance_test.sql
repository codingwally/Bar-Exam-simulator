-- Transactional behavior for mandatory official Beadle class-list provenance.
-- Synthetic records and short-lived receipts always roll back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '38000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'roster-professor@example.invalid',
    '{}'::jsonb, '{"full_name":"Roster Professor"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '38000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'roster-outsider@example.invalid',
    '{}'::jsonb, '{"full_name":"Roster Outsider"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '38000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'roster-beadle@example.invalid',
    '{}'::jsonb, '{"full_name":"Roster Beadle"}'::jsonb,
    now(), now(), false, false
  );

insert into public.exam_room_professors (user_id, activated_by)
values (
  '38000000-0000-4000-8000-000000000001'::uuid,
  '38000000-0000-4000-8000-000000000001'::uuid
);

insert into public.exam_room_classrooms (
  id, public_id, owner_professor_id, title, school_name, academic_term
) values (
  '38000000-0000-4000-8000-000000000010'::uuid,
  '38000000-0000-4000-8000-000000000011'::uuid,
  '38000000-0000-4000-8000-000000000001'::uuid,
  'Official Template Room', 'Synthetic College of Law', 'Beta 2026'
);

insert into public.exam_room_exams (
  id, public_id, classroom_id, owner_professor_id, title, instructions,
  requested_question_count, status, integrity_preset, include_questionnaire
) values (
  '38000000-0000-4000-8000-000000000020'::uuid,
  '38000000-0000-4000-8000-000000000021'::uuid,
  '38000000-0000-4000-8000-000000000010'::uuid,
  '38000000-0000-4000-8000-000000000001'::uuid,
  'Official Template Examination', 'Answer every question.',
  1, 'draft', 'standard', false
);

insert into public.exam_room_beadle_assignments (
  id, exam_id, beadle_user_id, assigned_by, assigned_at, expires_at
) values (
  '38000000-0000-4000-8000-000000000025'::uuid,
  '38000000-0000-4000-8000-000000000020'::uuid,
  '38000000-0000-4000-8000-000000000003'::uuid,
  '38000000-0000-4000-8000-000000000001'::uuid,
  now(), now() + interval '1 day'
);

do $beadle_roster_template_behavior$
declare
  v_owner constant uuid := '38000000-0000-4000-8000-000000000001'::uuid;
  v_outsider constant uuid := '38000000-0000-4000-8000-000000000002'::uuid;
  v_beadle constant uuid := '38000000-0000-4000-8000-000000000003'::uuid;
  v_exam_id constant uuid := '38000000-0000-4000-8000-000000000020'::uuid;
  v_exam_public constant uuid := '38000000-0000-4000-8000-000000000021'::uuid;
  v_source_hash constant text := repeat('a', 64);
  v_rows jsonb := jsonb_build_array(
    jsonb_build_object(
      'email', 'first.student@example.invalid',
      'studentNumber', '00123',
      'candidateNumber', '00123',
      'displayName', 'Student, First Q.'
    ),
    jsonb_build_object(
      'email', 'second.student@example.invalid',
      'studentNumber', '00234',
      'candidateNumber', '00234',
      'displayName', 'Student, Second R.'
    )
  );
  v_reordered_rows jsonb;
  v_changed_rows jsonb;
  v_response jsonb;
  v_replay jsonb;
  v_invalid jsonb;
  v_receipt_id uuid;
  v_second_receipt_id uuid;
  v_expired_receipt_id uuid;
  v_beadle_receipt_id uuid;
  v_before integer;
begin
  if not exists (
    select 1
    from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname = 'exam_room_roster_template_validations'
      and relation.relrowsecurity
      and relation.relforcerowsecurity
  )
    or has_table_privilege(
      'anon', 'public.exam_room_roster_template_validations', 'SELECT'
    )
    or has_table_privilege(
      'authenticated', 'public.exam_room_roster_template_validations', 'SELECT'
    )
    or not has_table_privilege(
      'service_role', 'public.exam_room_roster_template_validations', 'SELECT'
    )
    or has_function_privilege(
      'anon',
      'public.exam_room_register_roster_template_validation_v1(uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or has_function_privilege(
      'authenticated',
      'public.exam_room_import_exam_roster_v3(uuid,uuid,jsonb,text,text,uuid,text)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.exam_room_register_roster_template_validation_v1(uuid,uuid,text,text,jsonb)',
      'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.exam_room_import_exam_roster_v3(uuid,uuid,jsonb,text,text,uuid,text)',
      'EXECUTE'
    )
    or has_function_privilege(
      'service_role', 'public.exam_room_roster_rows_hash_v1(jsonb)', 'EXECUTE'
    )
    or not has_function_privilege(
      'service_role',
      'public.exam_room_import_exam_roster_v2(uuid,uuid,jsonb,text,text)',
      'EXECUTE'
    )
  then
    raise exception 'ROSTER_TEMPLATE_PRIVILEGE_BOUNDARY_FAILED';
  end if;

  if exists (
    select 1
    from information_schema.columns column_definition
    where column_definition.table_schema = 'public'
      and column_definition.table_name = 'exam_room_roster_template_validations'
      and column_definition.column_name in (
        'rows', 'roster_rows', 'workbook', 'workbook_content', 'source_content'
      )
  ) then
    raise exception 'ROSTER_TEMPLATE_RECEIPT_STORES_CONTENT';
  end if;

  select count(*)::integer into v_before
  from public.exam_room_roster_template_validations;

  begin
    perform public.exam_room_register_roster_template_validation_v1(
      v_owner, v_exam_public, 'beadle-roster-v0', v_source_hash, v_rows
    );
    raise exception 'ROSTER_TEMPLATE_WRONG_VERSION_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'ROSTER_TEMPLATE_WRONG_VERSION_WAS_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED' then
        raise exception 'ROSTER_TEMPLATE_WRONG_VERSION_ERROR: %', sqlerrm;
      end if;
  end;

  begin
    perform public.exam_room_register_roster_template_validation_v1(
      v_outsider, v_exam_public, 'beadle-roster-v1', v_source_hash, v_rows
    );
    raise exception 'ROSTER_TEMPLATE_OUTSIDER_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'ROSTER_TEMPLATE_OUTSIDER_WAS_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_OPERATOR_REQUIRED' then
        raise exception 'ROSTER_TEMPLATE_OUTSIDER_ERROR: %', sqlerrm;
      end if;
  end;

  v_invalid := public.exam_room_register_roster_template_validation_v1(
    v_owner,
    v_exam_public,
    'beadle-roster-v1',
    v_source_hash,
    jsonb_build_array(jsonb_build_object(
      'email', 'invalid-row@example.invalid',
      'studentNumber', '00345',
      'candidateNumber', '00345',
      'displayName', '',
      'unapprovedColumn', 'must not be accepted'
    ))
  );
  if coalesce((v_invalid ->> 'ok')::boolean, true)
    or not (
      v_invalid -> 'errors' @> '[{"code":"ROSTER_TEMPLATE_ROW_INVALID"}]'::jsonb
    )
    or not (
      v_invalid -> 'errors' @> '[{"code":"ROSTER_NAME_REQUIRED"}]'::jsonb
    )
    or (select count(*) from public.exam_room_roster_template_validations) <> v_before
  then
    raise exception 'ROSTER_TEMPLATE_INVALID_ROWS_ISSUED_RECEIPT';
  end if;

  v_response := public.exam_room_register_roster_template_validation_v1(
    v_beadle, v_exam_public, 'beadle-roster-v1', v_source_hash, v_rows
  );
  v_beadle_receipt_id := (v_response ->> 'templateReceiptId')::uuid;
  if (v_response ->> 'ok')::boolean is not true
    or not exists (
      select 1
      from public.exam_room_roster_template_validations receipt
      where receipt.id = v_beadle_receipt_id
        and receipt.actor_user_id = v_beadle
        and receipt.exam_id = v_exam_id
    )
  then
    raise exception 'ROSTER_TEMPLATE_ACTIVE_BEADLE_FAILED';
  end if;

  v_response := public.exam_room_register_roster_template_validation_v1(
    v_owner, v_exam_public, 'beadle-roster-v1', v_source_hash, v_rows
  );
  v_receipt_id := (v_response ->> 'templateReceiptId')::uuid;
  if (v_response ->> 'ok')::boolean is not true
    or v_response ->> 'examId' <> v_exam_public::text
    or v_response ->> 'templateVersion' <> 'beadle-roster-v1'
    or (v_response ->> 'rowCount')::integer <> 2
    or v_response ->> 'templateReceiptExpiresAt' is null
    or not exists (
      select 1
      from public.exam_room_roster_template_validations receipt
      where receipt.id = v_receipt_id
        and receipt.exam_id = v_exam_id
        and receipt.actor_user_id = v_owner
        and receipt.source_hash = v_source_hash
        and receipt.template_version = 'beadle-roster-v1'
        and receipt.row_count = 2
        and receipt.expires_at = receipt.validated_at + interval '30 minutes'
        and receipt.consumed_at is null
    )
  then
    raise exception 'ROSTER_TEMPLATE_VALID_RECEIPT_FAILED';
  end if;

  -- Canonical hashing ignores row order, email case, and surrounding spaces.
  v_reordered_rows := jsonb_build_array(
    jsonb_build_object(
      'email', ' SECOND.STUDENT@example.invalid ',
      'studentNumber', ' 00234 ',
      'candidateNumber', '00234',
      'displayName', ' Student, Second R. '
    ),
    jsonb_build_object(
      'email', 'FIRST.STUDENT@example.invalid',
      'studentNumber', '00123',
      'candidateNumber', ' 00123 ',
      'displayName', 'Student, First Q.'
    )
  );
  v_response := public.exam_room_import_exam_roster_v3(
    v_owner,
    v_exam_public,
    v_reordered_rows,
    'roster_template_import_0001',
    v_source_hash,
    v_receipt_id,
    'beadle-roster-v1'
  );
  if (v_response ->> 'ok')::boolean is not true
    or (v_response ->> 'imported')::integer <> 2
    or (v_response ->> 'templateValidated')::boolean is not true
    or v_response ->> 'templateReceiptId' <> v_receipt_id::text
    or (select count(*) from public.exam_room_roster roster
        where roster.classroom_id = '38000000-0000-4000-8000-000000000010'::uuid
          and roster.status = 'active') <> 2
    or not exists (
      select 1
      from public.exam_room_roster_template_validations receipt
      where receipt.id = v_receipt_id
        and receipt.consumed_at is not null
        and receipt.consumed_request_key = 'roster_template_import_0001'
    )
  then
    raise exception 'ROSTER_TEMPLATE_ATOMIC_IMPORT_FAILED';
  end if;

  v_replay := public.exam_room_import_exam_roster_v3(
    v_owner,
    v_exam_public,
    v_reordered_rows,
    'roster_template_import_0001',
    v_source_hash,
    v_receipt_id,
    'beadle-roster-v1'
  );
  if v_replay <> v_response
    or (select count(*) from public.exam_room_roster_template_validations receipt
        where receipt.id = v_receipt_id and receipt.consumed_at is not null) <> 1
  then
    raise exception 'ROSTER_TEMPLATE_SAME_REQUEST_RETRY_FAILED';
  end if;

  begin
    perform public.exam_room_import_exam_roster_v3(
      v_owner,
      v_exam_public,
      v_reordered_rows,
      'roster_template_import_0002',
      v_source_hash,
      v_receipt_id,
      'beadle-roster-v1'
    );
    raise exception 'ROSTER_TEMPLATE_RECEIPT_REUSE_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'ROSTER_TEMPLATE_RECEIPT_REUSE_WAS_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED' then
        raise exception 'ROSTER_TEMPLATE_RECEIPT_REUSE_ERROR: %', sqlerrm;
      end if;
  end;

  v_response := public.exam_room_register_roster_template_validation_v1(
    v_owner, v_exam_public, 'beadle-roster-v1', v_source_hash, v_rows
  );
  v_second_receipt_id := (v_response ->> 'templateReceiptId')::uuid;
  v_changed_rows := jsonb_set(
    v_rows,
    '{0,displayName}',
    to_jsonb('Changed, Student Q.'::text)
  );
  begin
    perform public.exam_room_import_exam_roster_v3(
      v_owner,
      v_exam_public,
      v_changed_rows,
      'roster_template_import_0003',
      v_source_hash,
      v_second_receipt_id,
      'beadle-roster-v1'
    );
    raise exception 'ROSTER_TEMPLATE_CHANGED_ROWS_WERE_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'ROSTER_TEMPLATE_CHANGED_ROWS_WERE_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH' then
        raise exception 'ROSTER_TEMPLATE_CHANGED_ROWS_ERROR: %', sqlerrm;
      end if;
  end;
  if exists (
    select 1
    from public.exam_room_roster_template_validations receipt
    where receipt.id = v_second_receipt_id and receipt.consumed_at is not null
  ) then
    raise exception 'ROSTER_TEMPLATE_MISMATCH_CONSUMED_RECEIPT';
  end if;

  insert into public.exam_room_roster_template_validations (
    id, exam_id, actor_user_id, template_version, source_hash,
    canonical_rows_hash, row_count, validated_at, expires_at
  ) values (
    '38000000-0000-4000-8000-000000000030'::uuid,
    v_exam_id,
    v_owner,
    'beadle-roster-v1',
    v_source_hash,
    public.exam_room_roster_rows_hash_v1(v_rows),
    2,
    now() - interval '31 minutes',
    now() - interval '1 minute'
  )
  returning id into v_expired_receipt_id;
  begin
    perform public.exam_room_import_exam_roster_v3(
      v_owner,
      v_exam_public,
      v_rows,
      'roster_template_import_0004',
      v_source_hash,
      v_expired_receipt_id,
      'beadle-roster-v1'
    );
    raise exception 'ROSTER_TEMPLATE_EXPIRED_RECEIPT_WAS_ACCEPTED';
  exception
    when others then
      if sqlerrm = 'ROSTER_TEMPLATE_EXPIRED_RECEIPT_WAS_ACCEPTED' then
        raise;
      end if;
      if sqlerrm <> 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED' then
        raise exception 'ROSTER_TEMPLATE_EXPIRED_RECEIPT_ERROR: %', sqlerrm;
      end if;
  end;
end;
$beadle_roster_template_behavior$;

rollback;
