-- Mandatory official Beadle class-list template provenance.
--
-- The uploaded workbook itself remains in the Worker request only. This
-- migration records a short-lived proof of exact-template validation without
-- storing the roster rows, then requires and consumes that proof atomically
-- with the existing authoritative roster import.

begin;

create table if not exists public.exam_room_roster_template_validations (
  id uuid primary key default extensions.gen_random_uuid(),
  exam_id uuid not null references public.exam_room_exams(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  template_version text not null,
  source_hash text not null,
  canonical_rows_hash text not null,
  row_count integer not null,
  validated_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  consumed_request_key text,
  constraint exam_room_roster_template_validation_version_check
    check (template_version = 'beadle-roster-v1'),
  constraint exam_room_roster_template_validation_source_hash_check
    check (source_hash ~ '^[0-9a-f]{64}$'),
  constraint exam_room_roster_template_validation_rows_hash_check
    check (canonical_rows_hash ~ '^[0-9a-f]{64}$'),
  constraint exam_room_roster_template_validation_row_count_check
    check (row_count between 1 and 500),
  constraint exam_room_roster_template_validation_expiry_check
    check (expires_at = validated_at + interval '30 minutes'),
  constraint exam_room_roster_template_validation_consumption_check
    check (
      (consumed_at is null and consumed_request_key is null)
      or (
        consumed_at is not null
        and consumed_at >= validated_at
        and consumed_request_key is not null
        and consumed_request_key ~ '^[A-Za-z0-9_-]{16,128}$'
      )
    )
);

create index if not exists exam_room_roster_template_validation_scope_idx
  on public.exam_room_roster_template_validations (
    actor_user_id, exam_id, expires_at desc
  )
  where consumed_at is null;
create index if not exists exam_room_roster_template_validation_exam_idx
  on public.exam_room_roster_template_validations (exam_id);

comment on table public.exam_room_roster_template_validations is
  'Private, short-lived proof that the Worker accepted the exact official Beadle class-list template. Stores hashes and counts only; never roster rows or workbook content.';
comment on column public.exam_room_roster_template_validations.canonical_rows_hash is
  'Hash of normalized roster identity fields sorted by email, not the roster rows themselves.';

alter table public.exam_room_roster_template_validations enable row level security;
alter table public.exam_room_roster_template_validations force row level security;
revoke all privileges on table public.exam_room_roster_template_validations
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.exam_room_roster_template_validations to service_role;

-- Normalize field case, whitespace, JSON object ordering, and row ordering
-- before hashing. The candidate number is an internal compatibility alias for
-- the official template's Student Number column.
create or replace function public.exam_room_roster_rows_hash_v1(
  p_rows jsonb
)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select public.exam_room_hash_json(
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'email', lower(btrim(row_value ->> 'email')),
          'studentNumber', btrim(row_value ->> 'studentNumber'),
          'candidateNumber', btrim(row_value ->> 'candidateNumber'),
          'displayName', btrim(row_value ->> 'displayName')
        )
        order by
          lower(btrim(row_value ->> 'email')),
          btrim(row_value ->> 'studentNumber'),
          btrim(row_value ->> 'displayName')
      ),
      '[]'::jsonb
    )
  )
  from jsonb_array_elements(p_rows) incoming(row_value);
$$;

-- The Worker calls this only after verifying the XLSX signature, workbook
-- structure, and exact three official headers. Database validation is repeated
-- here before a receipt is issued, keeping authorization and roster rules at
-- the trust boundary.
create or replace function public.exam_room_register_roster_template_validation_v1(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_template_version text,
  p_source_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_class public.exam_room_classrooms%rowtype;
  v_validation jsonb;
  v_template_errors jsonb := '[]'::jsonb;
  v_receipt public.exam_room_roster_template_validations%rowtype;
  v_rows_hash text;
  v_now timestamptz := clock_timestamp();
begin
  if p_actor_user_id is null or p_exam_public_id is null then
    raise exception 'EXAM_ROOM_REQUEST_INVALID';
  end if;
  if p_template_version is distinct from 'beadle-roster-v1'
    or p_source_hash is null
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED';
  end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
  for update;
  if not found then
    raise exception 'EXAM_ROOM_EXAM_NOT_FOUND';
  end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_ROSTER_LOCKED';
  end if;

  select * into v_class
  from public.exam_room_classrooms classroom
  where classroom.id = v_exam.classroom_id
  for share;

  v_validation := public.exam_room_validate_roster(
    v_exam.owner_professor_id,
    v_class.public_id,
    p_rows
  );
  if not coalesce((v_validation ->> 'ok')::boolean, false) then
    return v_validation;
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) incoming(row_value)
    where jsonb_typeof(row_value) <> 'object'
      or not (
        row_value ? 'email'
        and row_value ? 'studentNumber'
        and row_value ? 'candidateNumber'
        and row_value ? 'displayName'
      )
      or exists (
        select 1
        from jsonb_object_keys(row_value) as row_fields(field_name)
        where field_name not in (
          'email', 'studentNumber', 'candidateNumber', 'displayName'
        )
      )
  ) then
    v_template_errors := v_template_errors || jsonb_build_array(
      jsonb_build_object(
        'row', 0,
        'code', 'ROSTER_TEMPLATE_ROW_INVALID',
        'message', 'Use only Email Address, Student Number, and Student Name from the official class-list template.'
      )
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) incoming(row_value)
    where char_length(btrim(coalesce(row_value ->> 'displayName', ''))) not between 1 and 200
  ) then
    v_template_errors := v_template_errors || jsonb_build_array(
      jsonb_build_object(
        'row', 0,
        'code', 'ROSTER_NAME_REQUIRED',
        'message', 'Enter every student name as Last Name, First Name, Middle Initial.'
      )
    );
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) incoming(row_value)
    where btrim(coalesce(row_value ->> 'candidateNumber', ''))
      <> btrim(coalesce(row_value ->> 'studentNumber', ''))
  ) then
    v_template_errors := v_template_errors || jsonb_build_array(
      jsonb_build_object(
        'row', 0,
        'code', 'ROSTER_TEMPLATE_ROW_INVALID',
        'message', 'The official class-list template uses the Student Number as the exam number.'
      )
    );
  end if;

  if jsonb_array_length(v_template_errors) > 0 then
    return jsonb_build_object(
      'ok', false,
      'rowCount', jsonb_array_length(p_rows),
      'errors', v_template_errors
    );
  end if;

  v_rows_hash := public.exam_room_roster_rows_hash_v1(p_rows);
  insert into public.exam_room_roster_template_validations (
    exam_id,
    actor_user_id,
    template_version,
    source_hash,
    canonical_rows_hash,
    row_count,
    validated_at,
    expires_at
  ) values (
    v_exam.id,
    p_actor_user_id,
    p_template_version,
    p_source_hash,
    v_rows_hash,
    jsonb_array_length(p_rows),
    v_now,
    v_now + interval '30 minutes'
  )
  returning * into v_receipt;

  perform public.exam_room_append_audit_v2(
    p_actor_user_id,
    v_exam.id,
    null,
    'roster_template_validation',
    v_receipt.id,
    'roster_template_validated',
    null,
    jsonb_build_object(
      'templateVersion', v_receipt.template_version,
      'sourceHash', v_receipt.source_hash,
      'canonicalRowsHash', v_receipt.canonical_rows_hash,
      'rowCount', v_receipt.row_count,
      'expiresAt', v_receipt.expires_at
    )
  );

  return jsonb_build_object(
    'ok', true,
    'examId', v_exam.public_id,
    'templateReceiptId', v_receipt.id,
    'templateVersion', v_receipt.template_version,
    'templateReceiptExpiresAt', v_receipt.expires_at,
    'rowCount', v_receipt.row_count
  );
end;
$$;

-- Import requires the exact proof returned above. A same-request retry returns
-- the completed v3 command receipt before inspecting the consumed template
-- proof. A different request cannot reuse it.
create or replace function public.exam_room_import_exam_roster_v3(
  p_actor_user_id uuid,
  p_exam_public_id uuid,
  p_rows jsonb,
  p_request_key text,
  p_source_hash text,
  p_template_receipt_id uuid,
  p_template_version text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_exam public.exam_room_exams%rowtype;
  v_receipt public.exam_room_roster_template_validations%rowtype;
  v_request jsonb;
  v_response jsonb;
  v_import_response jsonb;
  v_rows_hash text;
  v_inner_request_key text;
begin
  v_request := jsonb_build_object(
    'examId', p_exam_public_id,
    'rows', p_rows,
    'sourceHash', p_source_hash,
    'templateReceiptId', p_template_receipt_id,
    'templateVersion', p_template_version
  );
  v_response := public.exam_room_command_begin_v2(
    p_actor_user_id,
    'import_exam_roster_v3',
    p_request_key,
    v_request
  );
  if v_response is not null then
    return v_response;
  end if;

  if p_template_version is distinct from 'beadle-roster-v1'
    or p_source_hash is null
    or p_source_hash !~ '^[0-9a-f]{64}$'
    or p_template_receipt_id is null
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_REQUIRED';
  end if;

  select * into v_exam
  from public.exam_room_exams exam
  where exam.public_id = p_exam_public_id
  for update;
  if not found then
    raise exception 'EXAM_ROOM_EXAM_NOT_FOUND';
  end if;
  if not public.exam_room_is_operator_v2(p_actor_user_id, v_exam.id, true) then
    raise exception 'EXAM_ROOM_OPERATOR_REQUIRED';
  end if;
  if not public.exam_room_can_manage_roster_v2(p_actor_user_id, v_exam.id) then
    raise exception 'EXAM_ROOM_ROSTER_LOCKED';
  end if;

  v_rows_hash := public.exam_room_roster_rows_hash_v1(p_rows);
  select * into v_receipt
  from public.exam_room_roster_template_validations receipt
  where receipt.id = p_template_receipt_id
  for update;

  if not found
    or v_receipt.actor_user_id <> p_actor_user_id
    or v_receipt.exam_id <> v_exam.id
  then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_INVALID';
  end if;
  if v_receipt.consumed_at is not null then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED';
  end if;
  if v_receipt.expires_at <= clock_timestamp() then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_EXPIRED';
  end if;
  if v_receipt.template_version <> p_template_version
    or v_receipt.source_hash <> p_source_hash
    or v_receipt.canonical_rows_hash <> v_rows_hash
  then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_MISMATCH';
  end if;

  v_inner_request_key := 'template_' || replace(v_receipt.id::text, '-', '_');
  v_import_response := public.exam_room_import_exam_roster_v2(
    p_actor_user_id,
    p_exam_public_id,
    p_rows,
    v_inner_request_key,
    p_source_hash
  );
  if not coalesce((v_import_response ->> 'ok')::boolean, false) then
    return v_import_response;
  end if;

  update public.exam_room_roster_template_validations receipt
  set consumed_at = clock_timestamp(),
      consumed_request_key = p_request_key
  where receipt.id = v_receipt.id
    and receipt.consumed_at is null;
  if not found then
    raise exception 'EXAM_ROOM_ROSTER_TEMPLATE_RECEIPT_USED';
  end if;

  perform public.exam_room_append_audit_v2(
    p_actor_user_id,
    v_exam.id,
    null,
    'roster_template_validation',
    v_receipt.id,
    'roster_template_consumed',
    p_request_key,
    jsonb_build_object(
      'templateVersion', v_receipt.template_version,
      'sourceHash', v_receipt.source_hash,
      'canonicalRowsHash', v_receipt.canonical_rows_hash,
      'rowCount', v_receipt.row_count
    )
  );

  v_response := v_import_response || jsonb_build_object(
    'templateReceiptId', v_receipt.id,
    'templateVersion', v_receipt.template_version,
    'templateValidated', true
  );
  return public.exam_room_command_complete_v2(
    p_actor_user_id,
    'import_exam_roster_v3',
    p_request_key,
    v_request,
    v_response
  );
end;
$$;

-- The canonical-hash helper is internal. The previous v2 importer temporarily
-- retains its service-role grant for a DB-first rolling deployment; the new
-- Worker routes all exam-scoped uploads through v3. Browser roles have never
-- been able to execute either importer. Retire v2 after every Worker version
-- has moved off it.
revoke all on function public.exam_room_roster_rows_hash_v1(jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.exam_room_register_roster_template_validation_v1(
  uuid, uuid, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.exam_room_register_roster_template_validation_v1(
  uuid, uuid, text, text, jsonb
) to service_role;

revoke all on function public.exam_room_import_exam_roster_v3(
  uuid, uuid, jsonb, text, text, uuid, text
) from public, anon, authenticated;
grant execute on function public.exam_room_import_exam_roster_v3(
  uuid, uuid, jsonb, text, text, uuid, text
) to service_role;

commit;
