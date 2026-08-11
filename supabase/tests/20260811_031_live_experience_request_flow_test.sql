-- Transactional staging behavior for the live-experience and Examination Room
-- request-flow migrations. Every synthetic row is rolled back.

begin;
set local search_path = public, extensions, auth, pg_temp;

insert into auth.users (
  id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at, is_sso_user, is_anonymous
) values
  (
    '4a000000-0000-4000-8000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'request-professor@example.invalid',
    '{}'::jsonb, '{"full_name":"Request Professor"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '4a000000-0000-4000-8000-000000000002'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'request-admin-a@example.invalid',
    '{}'::jsonb, '{"full_name":"Request Administrator A"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '4a000000-0000-4000-8000-000000000003'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'request-admin-b@example.invalid',
    '{}'::jsonb, '{"full_name":"Request Administrator B"}'::jsonb,
    now(), now(), false, false
  ),
  (
    '4a000000-0000-4000-8000-000000000004'::uuid,
    '00000000-0000-0000-0000-000000000000'::uuid,
    'authenticated', 'authenticated', 'request-student@example.invalid',
    '{}'::jsonb, '{"full_name":"Request Student"}'::jsonb,
    now(), now(), false, false
  );

update public.user_roles
set role = 'super_admin'
where user_id in (
  '4a000000-0000-4000-8000-000000000002'::uuid,
  '4a000000-0000-4000-8000-000000000003'::uuid
);

do $live_experience_behavior$
declare
  v_professor constant uuid := '4a000000-0000-4000-8000-000000000001'::uuid;
  v_admin_a constant uuid := '4a000000-0000-4000-8000-000000000002'::uuid;
  v_admin_b constant uuid := '4a000000-0000-4000-8000-000000000003'::uuid;
  v_student constant uuid := '4a000000-0000-4000-8000-000000000004'::uuid;
  v_request jsonb;
  v_replay jsonb;
  v_request_id uuid;
  v_activation jsonb;
  v_redemption jsonb;
  v_class_public_id uuid;
  v_class_id uuid;
  v_exam jsonb;
  v_exam_id uuid;
  v_credential_id uuid;
  v_context jsonb;
  v_proof jsonb;
  v_proof_id uuid;
  v_forum_entry jsonb;
  v_forum_entry_id text;
  v_forum_view jsonb;
  v_identity jsonb;
begin
  if has_table_privilege('anon', 'public.exam_room_requests', 'select')
    or has_table_privilege('authenticated', 'public.exam_room_requests', 'insert')
    or has_table_privilege('anon', 'public.verdict_archived_records', 'select')
    or has_table_privilege('authenticated', 'public.forum_anonymous_identity_audits', 'select')
  then raise exception 'LIVE_EXPERIENCE_DIRECT_TABLE_ACCESS_FAILED'; end if;

  if has_function_privilege('anon', 'public.exam_room_submit_request(uuid,text,text,text,text,date,time without time zone,text,integer,integer,text,text,text,text,text,text)', 'execute')
    or has_function_privilege('authenticated', 'public.forum_resolve_anonymous_identity(uuid,text,text)', 'execute')
    or not has_function_privilege('service_role', 'public.exam_room_submit_request(uuid,text,text,text,text,date,time without time zone,text,integer,integer,text,text,text,text,text,text)', 'execute')
  then raise exception 'LIVE_EXPERIENCE_FUNCTION_BOUNDARY_FAILED'; end if;

  v_request := public.exam_room_submit_request(
    v_professor, 'Request Professor', 'Synthetic College of Law',
    'Labor Law', 'Labor Law Midterm Examination', current_date + 7,
    '09:00'::time, 'Asia/Manila', 120, 40, 'essay',
    null, null, 'professor', 'Transactional staging request.',
    'request_flow_submit_0001'
  );
  v_request_id := (v_request ->> 'requestId')::uuid;
  v_replay := public.exam_room_submit_request(
    v_professor, 'Request Professor', 'Synthetic College of Law',
    'Labor Law', 'Labor Law Midterm Examination', current_date + 7,
    '09:00'::time, 'Asia/Manila', 120, 40, 'essay',
    null, null, 'professor', 'Transactional staging request.',
    'request_flow_submit_0001'
  );
  if (v_request ->> 'replayed')::boolean
    or not (v_replay ->> 'replayed')::boolean
    or v_replay ->> 'requestId' <> v_request_id::text
  then raise exception 'EXAM_ROOM_REQUEST_REPLAY_FAILED'; end if;

  begin
    perform public.exam_room_submit_request(
      v_professor, 'Request Professor', 'Synthetic College of Law',
      'Labor Law', 'Changed title must conflict', current_date + 7,
      '09:00'::time, 'Asia/Manila', 120, 40, 'essay',
      null, null, 'professor', 'Transactional staging request.',
      'request_flow_submit_0001'
    );
    raise exception 'EXAM_ROOM_REQUEST_CONFLICT_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_REQUEST_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  perform public.exam_room_claim_request(v_admin_a, v_request_id, 'request_flow_claim_0001');
  begin
    perform public.exam_room_prepare_quotation(
      v_admin_b, v_request_id, 250000, 'Unauthorized quotation attempt.',
      'request_flow_quote_unauthorized'
    );
    raise exception 'EXAM_ROOM_CROSS_ADMIN_QUOTATION_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_QUOTATION_INVALID' then raise; end if;
  end;

  perform public.exam_room_prepare_quotation(
    v_admin_a, v_request_id, 250000, 'Quotation for the requested room.',
    'request_flow_quote_0001'
  );
  v_activation := public.exam_room_generate_provisional_key(
    v_admin_a, v_request_id, repeat('a', 64), now() + interval '2 days',
    'request_flow_key_0001'
  );
  if v_activation ->> 'targetEmail' <> 'request-professor@example.invalid'
    or (v_activation ->> 'paymentVerified')::boolean
  then raise exception 'EXAM_ROOM_PROVISIONAL_KEY_FAILED'; end if;

  v_redemption := public.exam_room_redeem_professor_activation(
    v_professor, repeat('a', 64), repeat('b', 64)
  );
  v_class_public_id := (v_redemption ->> 'classroomId')::uuid;
  select id into v_class_id from public.exam_room_classrooms where public_id = v_class_public_id;
  if v_class_id is null or not exists (
    select 1 from public.exam_room_requests
    where public_id = v_request_id and classroom_id = v_class_id
  ) then raise exception 'EXAM_ROOM_REQUEST_ACTIVATION_BINDING_FAILED'; end if;

  v_exam := public.exam_room_create_exam(
    v_professor, v_class_public_id, 'Request Flow Examination',
    'Answer the essay question using ALAC.', 1, 'standard', false
  );
  select id into v_exam_id from public.exam_room_exams
  where public_id = (v_exam ->> 'examId')::uuid;
  insert into public.exam_room_credentials (
    exam_id, credential_type, token_hash, status, expires_at, created_by
  ) values (
    v_exam_id, 'student_exam', repeat('c', 64), 'active',
    now() + interval '1 day', v_professor
  ) returning id into v_credential_id;

  begin
    insert into public.exam_room_student_access_issuances (
      exam_id, credential_id, roster_count, roster_snapshot_hash,
      request_key, issued_by
    ) values (
      v_exam_id, v_credential_id, 1, repeat('d', 64),
      'request_flow_access_0001', v_professor
    );
    raise exception 'EXAM_ROOM_UNVERIFIED_PAYMENT_ACCESS_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_PAYMENT_VERIFICATION_REQUIRED' then raise; end if;
  end;

  v_context := public.exam_room_payment_proof_upload_context(v_professor, v_request_id);
  v_proof := public.exam_room_register_payment_proof(
    v_professor, v_request_id,
    (v_context ->> 'objectPrefix') || repeat('e', 24) || '.jpg',
    'payment-proof.jpg', 'image/jpeg', 1024, repeat('f', 64),
    'request_flow_proof_0001'
  );
  v_proof_id := (v_proof ->> 'proofId')::uuid;
  v_replay := public.exam_room_register_payment_proof(
    v_professor, v_request_id,
    (v_context ->> 'objectPrefix') || repeat('e', 24) || '.jpg',
    'payment-proof.jpg', 'image/jpeg', 1024, repeat('f', 64),
    'request_flow_proof_0001'
  );
  if (v_proof ->> 'replayed')::boolean
    or not (v_replay ->> 'replayed')::boolean
    or v_replay ->> 'proofId' <> v_proof_id::text
  then raise exception 'EXAM_ROOM_PAYMENT_PROOF_REPLAY_FAILED'; end if;

  begin
    perform public.exam_room_register_payment_proof(
      v_professor, v_request_id,
      (v_context ->> 'objectPrefix') || repeat('1', 24) || '.jpg',
      'different-proof.jpg', 'image/jpeg', 1024, repeat('2', 64),
      'request_flow_proof_0001'
    );
    raise exception 'EXAM_ROOM_PAYMENT_PROOF_CONFLICT_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_PAYMENT_PROOF_IDEMPOTENCY_CONFLICT' then raise; end if;
  end;

  begin
    perform public.exam_room_payment_proof_review_context(v_admin_b, v_request_id, v_proof_id);
    raise exception 'EXAM_ROOM_CROSS_ADMIN_PROOF_REVIEW_WAS_ALLOWED';
  exception when others then
    if sqlerrm <> 'EXAM_ROOM_ADMINISTRATOR_REQUIRED' then raise; end if;
  end;
  perform public.exam_room_payment_proof_review_context(v_admin_a, v_request_id, v_proof_id);
  perform public.exam_room_review_payment_proof(
    v_admin_a, v_request_id, v_proof_id, 'verified', null,
    'request_flow_review_0001'
  );

  insert into public.exam_room_student_access_issuances (
    exam_id, credential_id, roster_count, roster_snapshot_hash,
    request_key, issued_by
  ) values (
    v_exam_id, v_credential_id, 1, repeat('d', 64),
    'request_flow_access_0001', v_professor
  );

  v_forum_entry := public.forum_quorum_command_v2(v_professor, 'create_entry', jsonb_build_object(
    'body', 'Anonymous Labor Law discussion grounded in the stated facts.',
    'entryType', 'discuss_legal_issue', 'subject', 'Labor Law',
    'category', 'philippine_jurisprudence', 'opinionOnly', true,
    'isAnonymous', true
  ));
  v_forum_entry_id := v_forum_entry ->> 'entryId';
  perform public.forum_quorum_command_v2(v_professor, 'register_attachment', jsonb_build_object(
    'entryId', v_forum_entry_id,
    'objectPath', 'entries/' || v_forum_entry_id || '/' || repeat('3', 24) || '.jpg',
    'mimeType', 'image/jpeg', 'byteSize', 1024, 'sortOrder', 1,
    'altText', 'Synthetic legal study note'
  ));
  perform public.forum_quorum_command_v2(v_professor, 'register_attachment', jsonb_build_object(
    'entryId', v_forum_entry_id,
    'objectPath', 'entries/' || v_forum_entry_id || '/' || repeat('4', 24) || '.jpg',
    'mimeType', 'image/jpeg', 'byteSize', 1024, 'sortOrder', 2,
    'altText', 'Second synthetic legal study note'
  ));
  v_forum_view := public.forum_quorum_query_v2(v_student, 'entry', jsonb_build_object(
    'entryId', v_forum_entry_id
  ));
  if v_forum_view #>> '{entry,author,displayName}' <> 'Anonymous member 1'
    or (v_forum_view #>> '{entry,author,anonymous}')::boolean is not true
    or v_forum_view #> '{entry,author}' ? 'userId'
    or jsonb_array_length(v_forum_view #> '{entry,images}') <> 2
  then raise exception 'FORUM_ANONYMOUS_MULTI_IMAGE_FAILED'; end if;

  begin
    perform public.forum_resolve_anonymous_identity(
      v_student, v_forum_entry_id, 'A valid reason that must still be unauthorized.'
    );
    raise exception 'FORUM_ANONYMOUS_IDENTITY_STUDENT_ACCESS_WAS_ALLOWED';
  exception when others then
    if sqlerrm not like '%Founder administrator authorization required%' then raise; end if;
  end;
  v_identity := public.forum_resolve_anonymous_identity(
    v_admin_a, v_forum_entry_id,
    'Safety review of a specifically reported anonymous entry.'
  );
  if v_identity ->> 'userId' <> v_professor::text
    or not exists (
      select 1 from public.forum_anonymous_identity_audits
      where actor_user_id = v_admin_a and target_user_id = v_professor
    )
  then raise exception 'FORUM_ANONYMOUS_IDENTITY_AUDIT_FAILED'; end if;

  if jsonb_array_length(public.dd2026_verdict_records(v_student, false, 200, 0)->'items') <> 0
  then raise exception 'VERDICT_EMPTY_HISTORY_FAILED'; end if;
end;
$live_experience_behavior$;

rollback;
