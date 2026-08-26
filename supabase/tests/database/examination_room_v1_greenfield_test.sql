begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(139);

select has_schema(
  'examination_room_v1',
  'the private Examination Room v1 schema exists'
);

select tables_are(
  'examination_room_v1',
  array[
    'answer_revisions',
    'audit_events',
    'exam_roster',
    'exam_versions',
    'exams',
    'grade_revision_items',
    'grade_revisions',
    'institutions',
    'email_delivery_events',
    'owner_identity_corrections',
    'owner_key_envelopes',
    'privacy_acceptances',
    'privacy_notice_versions',
    'professor_access_requests',
    'proctoring_artifacts',
    'proctoring_incidents',
    'questions',
    'recovery_snapshots',
    'result_email_delivery_events',
    'result_releases',
    'room_activations',
    'staff_memberships',
    'student_identities',
    'student_sessions',
    'submission_answers',
    'submission_receipts',
    'submissions'
  ],
  'only the expected normalized v1 tables exist in the schema'
);

select ok(
  not exists (
    select 1
    from pg_catalog.pg_namespace n,
         lateral pg_catalog.aclexplode(
           coalesce(n.nspacl, pg_catalog.acldefault('n', n.nspowner))
         ) acl
    where n.nspname = 'examination_room_v1'
      and acl.grantee = 0
      and acl.privilege_type = 'USAGE'
  ),
  'PUBLIC has no schema usage'
);

select ok(
  not has_schema_privilege('anon', 'examination_room_v1', 'USAGE'),
  'anon has no schema usage'
);

select ok(
  not has_schema_privilege('authenticated', 'examination_room_v1', 'USAGE'),
  'authenticated has no schema usage'
);

select ok(
  has_schema_privilege('service_role', 'examination_room_v1', 'USAGE'),
  'service_role has schema usage for the application service boundary'
);

select ok(
  (
    select count(*) = 3
      and bool_and(
        (r.rolname = 'service_role' and r.rolbypassrls)
        or (r.rolname in ('anon', 'authenticated') and not r.rolbypassrls)
      )
    from pg_catalog.pg_roles r
    where r.rolname in ('anon', 'authenticated', 'service_role')
  ),
  'only service_role can bypass forced RLS among application roles'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  ),
  0::bigint,
  'row-level security is enabled on every v1 table'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and not c.relforcerowsecurity
  ),
  0::bigint,
  'row-level security is forced on every v1 table'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_policy p
    join pg_catalog.pg_class c on c.oid = p.polrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
  ),
  0::bigint,
  'no client-facing RLS policies bypass the service-mediated boundary'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(c.relacl, pg_catalog.acldefault('r', c.relowner))
    ) acl
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and acl.grantee = 0
  ),
  0::bigint,
  'PUBLIC has no table privileges'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('anon', c.oid, 'SELECT')
        or has_table_privilege('anon', c.oid, 'INSERT')
        or has_table_privilege('anon', c.oid, 'UPDATE')
        or has_table_privilege('anon', c.oid, 'DELETE')
        or has_table_privilege('anon', c.oid, 'TRUNCATE')
        or has_table_privilege('anon', c.oid, 'REFERENCES')
        or has_table_privilege('anon', c.oid, 'TRIGGER')
      )
  ),
  0::bigint,
  'anon has no table privileges'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and (
        has_table_privilege('authenticated', c.oid, 'SELECT')
        or has_table_privilege('authenticated', c.oid, 'INSERT')
        or has_table_privilege('authenticated', c.oid, 'UPDATE')
        or has_table_privilege('authenticated', c.oid, 'DELETE')
        or has_table_privilege('authenticated', c.oid, 'TRUNCATE')
        or has_table_privilege('authenticated', c.oid, 'REFERENCES')
        or has_table_privilege('authenticated', c.oid, 'TRIGGER')
      )
  ),
  0::bigint,
  'authenticated has no table privileges'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relkind in ('r', 'p')
      and not (
        has_table_privilege('service_role', c.oid, 'SELECT')
        and has_table_privilege('service_role', c.oid, 'INSERT')
        and has_table_privilege('service_role', c.oid, 'UPDATE')
        and has_table_privilege('service_role', c.oid, 'DELETE')
      )
  ),
  0::bigint,
  'service_role has the required table privileges'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'examination_room_v1'
      and p.prosecdef
  ),
  0::bigint,
  'the v1 schema contains no SECURITY DEFINER functions'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'examination_room_v1'
      and position('search_path=pg_catalog' in coalesce(array_to_string(p.proconfig, ','), '')) = 0
  ),
  0::bigint,
  'every private trigger function pins search_path to pg_catalog'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'examination_room_v1'
      and acl.privilege_type = 'EXECUTE'
      and (
        acl.grantee = 0
        or acl.grantee in (
          select r.oid
          from pg_catalog.pg_roles r
          where r.rolname in ('anon', 'authenticated', 'service_role')
        )
      )
  ),
  0::bigint,
  'private trigger functions are not directly executable by API or service roles'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'examination_room_v1_api',
        'examination_room_v1_authorize_staff',
        'examination_room_v1_professor_access',
        'examination_room_v1_staff_context',
        'examination_room_v1_manage_staff'
      )
      and p.prosecdef
      and position('search_path=pg_catalog' in coalesce(array_to_string(p.proconfig, ','), '')) > 0
  ),
  5::bigint,
  'all public v1 RPCs are SECURITY DEFINER with a pinned search_path'
);

select ok(
  (
    select count(*) = 5
      and bool_and(has_function_privilege('service_role', p.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('anon', p.oid, 'EXECUTE'))
      and bool_and(not has_function_privilege('authenticated', p.oid, 'EXECUTE'))
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'examination_room_v1_api',
        'examination_room_v1_authorize_staff',
        'examination_room_v1_professor_access',
        'examination_room_v1_staff_context',
        'examination_room_v1_manage_staff'
      )
  )
  and not exists (
    select 1
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    cross join lateral pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    where n.nspname = 'public'
      and p.proname in (
        'examination_room_v1_api',
        'examination_room_v1_authorize_staff',
        'examination_room_v1_professor_access',
        'examination_room_v1_staff_context',
        'examination_room_v1_manage_staff'
      )
      and acl.grantee = 0
      and acl.privilege_type = 'EXECUTE'
  ),
  'only service_role can execute the public authorization RPC'
);

select is(
  (
    select count(*)
    from information_schema.columns
    where table_schema = 'examination_room_v1'
      and column_name in (
        'key', 'raw_key', 'room_key', 'activation_key', 'exam_key',
        'session_token', 'idempotency_key', 'password', 'secret', 'authorization'
      )
  ),
  0::bigint,
  'no raw key, token, password, or secret columns exist'
);

select has_column(
  'examination_room_v1', 'room_activations', 'key_hash',
  'room activations persist only a one-way key verifier'
);

select has_column(
  'examination_room_v1', 'student_sessions', 'session_token_hash',
  'student sessions persist only a token hash'
);

select has_column(
  'examination_room_v1', 'submissions', 'idempotency_key_hash',
  'submissions persist only a hashed idempotency key'
);

select has_column(
  'examination_room_v1', 'result_releases', 'idempotency_key_hash',
  'result releases persist only a hashed idempotency key'
);

select has_column(
  'examination_room_v1', 'professor_access_requests', 'requested_institution_id',
  'Professor signup requests bind to an exact institution before administrator review'
);

select has_column(
  'examination_room_v1', 'professor_access_requests', 'request_status',
  'Professor signup requests preserve their review lifecycle'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_index index_record
    join pg_catalog.pg_class table_record on table_record.oid = index_record.indrelid
    join pg_catalog.pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = 'examination_room_v1'
      and table_record.relname = 'professor_access_requests'
      and index_record.indisunique
      and pg_catalog.pg_get_expr(index_record.indpred, index_record.indrelid) like '%request_status%pending%'
  ),
  'a Professor account can have only one pending activation request at a time'
);

select ok(
  (
    select count(*) >= 7
    from pg_catalog.pg_constraint constraint_record
    join pg_catalog.pg_class source_table on source_table.oid = constraint_record.conrelid
    join pg_catalog.pg_namespace source_schema on source_schema.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = constraint_record.confrelid
    join pg_catalog.pg_namespace target_schema on target_schema.oid = target_table.relnamespace
    where source_schema.nspname = 'examination_room_v1'
      and target_schema.nspname = 'examination_room_v1'
      and target_table.relname = 'institutions'
      and constraint_record.contype = 'f'
  ),
  'institution-root records cannot become orphaned from their law-school boundary'
);

select is(
  (
    select pg_catalog.pg_get_expr(d.adbin, d.adrelid)
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where n.nspname = 'examination_room_v1'
      and c.relname = 'exams'
      and a.attname = 'anonymous_grading'
  ),
  'false',
  'anonymous grading defaults to false'
);

select ok(
  (
    select a.attnotnull
    from pg_catalog.pg_attribute a
    join pg_catalog.pg_class c on c.oid = a.attrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relname = 'student_identities'
      and a.attname = 'full_name'
      and not a.attisdropped
  ),
  'verified real name is required on student identities'
);

select set_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_trigger t
    join pg_catalog.pg_class c on c.oid = t.tgrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and not t.tgisinternal
      and t.tgname like '%_immutable'
  $$,
  array[
    'answer_revisions',
    'audit_events',
    'exam_versions',
    'grade_revision_items',
    'grade_revisions',
    'institutions',
    'email_delivery_events',
    'owner_identity_corrections',
    'owner_key_envelopes',
    'privacy_acceptances',
    'privacy_notice_versions',
    'questions',
    'result_releases',
    'submission_answers',
    'submission_receipts'
  ],
  'published content and evidentiary revision/event tables are append-only'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relname = 'audit_events'
      and con.contype = 'c'
      and position('room[ _-]?' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
  ),
  'audit payload constraints reject raw key field names'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class c on c.oid = con.conrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relname = 'proctoring_incidents'
      and con.contype = 'c'
      and position('room[ _-]?' in pg_catalog.pg_get_constraintdef(con.oid)) > 0
  ),
  'proctoring incident details reject raw key field names'
);

select is(
  (
    select count(*)
    from pg_catalog.pg_constraint con
    join pg_catalog.pg_class source_table on source_table.oid = con.conrelid
    join pg_catalog.pg_namespace source_schema on source_schema.oid = source_table.relnamespace
    join pg_catalog.pg_class target_table on target_table.oid = con.confrelid
    join pg_catalog.pg_namespace target_schema on target_schema.oid = target_table.relnamespace
    where source_schema.nspname = 'examination_room_v1'
      and con.contype = 'f'
      and target_schema.nspname in ('auth', 'storage', 'realtime')
  ),
  0::bigint,
  'the v1 schema has no foreign-key coupling to protected platform schemas'
);

select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) values
      (
        '00000000-0000-0000-0000-000000000103',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'professor-greenfield@example.invalid',
        '{}'::jsonb, '{"full_name":"Professor Greenfield"}'::jsonb,
        now(), now(), false, false
      ),
      (
        '00000000-0000-0000-0000-000000000104',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'student-greenfield@example.invalid',
        '{}'::jsonb, '{"full_name":"Student Greenfield"}'::jsonb,
        now(), now(), false, false
      ),
      (
        '00000000-0000-0000-0000-000000000105',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'admin-a-greenfield@example.invalid',
        '{}'::jsonb, '{"full_name":"Administrator A"}'::jsonb,
        now(), now(), false, false
      ),
      (
        '00000000-0000-0000-0000-000000000106',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'admin-b-greenfield@example.invalid',
        '{}'::jsonb, '{"full_name":"Administrator B"}'::jsonb,
        now(), now(), false, false
      );

    insert into public.user_roles (user_id, role, assigned_by)
    values
      (
        '00000000-0000-0000-0000-000000000105', 'founder_admin',
        '00000000-0000-0000-0000-000000000105'
      ),
      (
        '00000000-0000-0000-0000-000000000106', 'founder_admin',
        '00000000-0000-0000-0000-000000000106'
      )
    on conflict (user_id) do update set role = excluded.role;

    update public.profiles
    set display_name = 'Professor Greenfield',
        law_school_id = 'greenfield-college-of-law',
        school = 'greenfield-college-of-law',
        commercial_category = 'professor',
        commercial_onboarding_completed_at = now()
    where id = '00000000-0000-0000-0000-000000000103';

    insert into public.professor_license_declarations (
      user_id, license_number, declaration_version, declared_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000103', 'TEST-DECLARATION-103',
      'professor-declaration-v1-2026-08-18', now(), now()
    );

    insert into examination_room_v1.institutions (
      id, institution_code, profile_school_id, institution_name,
      bootstrap_request_hash, created_by_user_id
    ) values
      (
        '00000000-0000-0000-0000-000000000102',
        'greenfield-law', 'greenfield-college-of-law', 'Greenfield College of Law',
        repeat('9', 64), '00000000-0000-0000-0000-000000000103'
      ),
      (
        '00000000-0000-0000-0000-000000000107',
        'alternate-law', 'alternate-college-of-law', 'Alternate College of Law',
        repeat('8', 64), '00000000-0000-0000-0000-000000000106'
      );

    insert into examination_room_v1.staff_memberships (
      institution_id, user_id, staff_role, display_name, email_normalized,
      membership_status, grant_reason, granted_by_user_id
    ) values
      (
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000105',
        'admin', 'Administrator A', 'admin-a-greenfield@example.invalid',
        'active', 'Database bridge test institution administrator.',
        '00000000-0000-0000-0000-000000000105'
      ),
      (
        '00000000-0000-0000-0000-000000000107',
        '00000000-0000-0000-0000-000000000106',
        'admin', 'Administrator B', 'admin-b-greenfield@example.invalid',
        'active', 'Database bridge test institution administrator.',
        '00000000-0000-0000-0000-000000000106'
      );

    insert into examination_room_v1.privacy_notice_versions (
      id,
      institution_id,
      notice_code,
      version_number,
      title,
      notice_body,
      body_sha256,
      processing_purposes,
      effective_at,
      created_by_user_id
    ) values (
      '00000000-0000-0000-0000-000000000101',
      '00000000-0000-0000-0000-000000000102',
      'exam-privacy',
      1,
      'Exam privacy notice',
      'Test notice body',
      repeat('a', 64),
      '["exam_delivery"]'::jsonb,
      now(),
      '00000000-0000-0000-0000-000000000103'
    )
  $$,
  'Professor profile, institution boundary, and immutable privacy notice fixtures can be inserted'
);

select is(
  public.examination_room_v1_professor_access(
    'status', '00000000-0000-0000-0000-000000000103', '{}'::jsonb
  )->>'professorRoleSelected',
  'true',
  'the legacy Professor profile remains informational in creator status'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000103',
    '{"institutionId":"00000000-0000-0000-0000-000000000102"}'::jsonb
  )->>'alreadyActive',
  'true',
  'a signed-in creator may select an active workspace without role approval'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000103',
    '{"institutionId":"00000000-0000-0000-0000-000000000102"}'::jsonb
  )->>'institutionId',
  '00000000-0000-0000-0000-000000000102',
  'creator workspace selection preserves the exact institution'
);

select is(
  (
    select count(*) from examination_room_v1.staff_memberships membership
    where membership.user_id = '00000000-0000-0000-0000-000000000103'
  ),
  0::bigint,
  'creator access never self-grants a protected staff membership'
);

select is(
  examination_room_v1.creator_authorized(
    '00000000-0000-0000-0000-000000000104',
    'ddc00000-0000-4000-8000-000000000001'
  ),
  true,
  'a verified signed-in account without the Professor role is a Community examination creator'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000103',
    '{"institutionId":"00000000-0000-0000-0000-000000000102"}'::jsonb
  )->>'duplicate',
  'true',
  'creator workspace selection is idempotent'
);

select is(
  (
    select count(*)
    from examination_room_v1.professor_access_requests request
    where request.user_id = '00000000-0000-0000-0000-000000000103'
  ),
  0::bigint,
  'the retired role-approval queue receives no creator rows'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000103',
    '{"institutionId":"00000000-0000-0000-0000-000000000107"}'::jsonb
  )->>'errorCode',
  'CREATOR_WORKSPACE_FORBIDDEN',
  'a signed-in creator cannot choose an unrelated active school workspace'
);

select ok(
  jsonb_array_length(
    public.examination_room_v1_professor_access(
      'status', '00000000-0000-0000-0000-000000000103', '{}'::jsonb
    ) -> 'availableInstitutions'
  ) >= 2,
  'creator status lists every active examination workspace'
);

select is(
  (
    select count(*)
    from examination_room_v1.professor_access_requests request
    where request.user_id = '00000000-0000-0000-0000-000000000103'
  ),
  0::bigint,
  'switching creator workspaces still creates no approval history'
);

select is(
  (
    select count(*)
    from examination_room_v1.staff_memberships membership
    where membership.user_id = '00000000-0000-0000-0000-000000000103'
  ),
  0::bigint,
  'switching creator workspaces still grants no staff authority'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000103',
    '{"institutionId":"not-a-uuid"}'::jsonb
  )->>'errorCode',
  'CREATOR_WORKSPACE_INVALID',
  'a malformed creator workspace fails with a recoverable code'
);

select is(
  examination_room_v1.creator_authorized(
    '00000000-0000-0000-0000-000000000104',
    '00000000-0000-0000-0000-000000000107'
  ),
  false,
  'verified sign-in alone does not expose an unrelated school workspace'
);

select is(
  public.examination_room_v1_professor_access(
    'request',
    '00000000-0000-0000-0000-000000000104',
    '{"institutionId":"ddc00000-0000-4000-8000-000000000001"}'::jsonb
  )->>'alreadyActive',
  'true',
  'a non-Professor signed-in account needs no extra activation request for Community'
);

select is(
  jsonb_array_length(
    public.examination_room_v1_professor_access(
      'status', '00000000-0000-0000-0000-000000000104', '{}'::jsonb
    ) -> 'availableInstitutions'
  ),
  1,
  'an unassigned non-Professor account sees only the shared Community creator workspace'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'session',
    '00000000-0000-0000-0000-000000000104',
    'ddc00000-0000-4000-8000-000000000001',
    '{}'::jsonb
  )->>'ok',
  'true',
  'a non-Professor signed-in creator can enter the Community Professor workspace'
);

select is(
  public.examination_room_v1_professor_access(
    'status',
    '00000000-0000-0000-0000-000000000199',
    '{}'::jsonb
  )->>'errorCode',
  'PROFESSOR_SIGN_IN_REQUIRED',
  'an unknown account still fails the verified sign-in boundary'
);

select throws_ok(
  $$
    update examination_room_v1.privacy_notice_versions
    set title = 'Changed'
    where id = '00000000-0000-0000-0000-000000000101'
  $$,
  '55000',
  'examination_room_v1.privacy_notice_versions is append-only',
  'privacy notice versions cannot be updated'
);

select throws_ok(
  $$
    delete from examination_room_v1.privacy_notice_versions
    where id = '00000000-0000-0000-0000-000000000101'
  $$,
  '55000',
  'examination_room_v1.privacy_notice_versions is append-only',
  'privacy notice versions cannot be deleted'
);

select lives_ok(
  $$
    do $publication$
    begin
    update auth.users
    set email = 'professor-greenfield-new@example.invalid'
    where id = '00000000-0000-0000-0000-000000000103';

    insert into examination_room_v1.exams (
      id,
      institution_id,
      owner_user_id,
      title
    ) values (
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000103',
      'Sealed publication test'
    );

    insert into examination_room_v1.exam_versions (
      id,
      exam_id,
      institution_id,
      version_number,
      title_snapshot,
      instructions,
      duration_seconds,
      privacy_notice_version_id,
      content_sha256
    ) values (
      '00000000-0000-0000-0000-000000000202',
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000102',
      1,
      'Sealed publication test',
      'Answer all questions.',
      3600,
      '00000000-0000-0000-0000-000000000101',
      repeat('c', 64)
    );

    insert into examination_room_v1.questions (
      id,
      exam_version_id,
      position,
      question_key,
      question_kind,
      prompt,
      points,
      content_sha256
    ) values (
      '00000000-0000-0000-0000-000000000203',
      '00000000-0000-0000-0000-000000000202',
      1,
      'q001',
      'essay',
      'Discuss the issue.',
      100,
      repeat('d', 64)
    );

    update examination_room_v1.questions
    set prompt = 'Discuss the corrected issue.'
    where id = '00000000-0000-0000-0000-000000000203';

    update examination_room_v1.exam_versions
    set publication_manifest = '{"schemaVersion":"examination-room/publication/v1"}'::jsonb,
        publication_status = 'published',
        published_by_user_id = '00000000-0000-0000-0000-000000000103',
        published_at = now()
    where id = '00000000-0000-0000-0000-000000000202';

    update examination_room_v1.exams
    set status = 'published',
        current_published_version_id = '00000000-0000-0000-0000-000000000202'
    where id = '00000000-0000-0000-0000-000000000201';
    end;
    $publication$;
  $$,
  'an exam publication bundle can be assembled and sealed atomically'
);

select is(
  (
    select owner_user_id::text
    from examination_room_v1.exams
    where id = '00000000-0000-0000-0000-000000000201'
  ),
  '00000000-0000-0000-0000-000000000103',
  'the sealed examination remains bound to its verified signed-in creator'
);

select is(
  public.examination_room_v1_authorize_staff(
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000107',
    'professor'
  ),
  false,
  'Professor approval does not cross institution boundaries'
);

select throws_ok(
  $$
    update examination_room_v1.exams
    set owner_user_id = '00000000-0000-0000-0000-000000000104'
    where id = '00000000-0000-0000-0000-000000000201'
  $$,
  '55000',
  'examination owner and workspace are immutable after creation',
  'a creator-owned examination cannot be reassigned after creation'
);

select throws_ok(
  $$
    insert into examination_room_v1.exams (
      id, institution_id, owner_user_id, title
    ) values (
      '00000000-0000-0000-0000-000000000205',
      '00000000-0000-0000-0000-000000000102',
      '00000000-0000-0000-0000-000000000199',
      'Unverified owner probe'
    )
  $$,
  '42501',
  'exam owner must be a verified account in an active examination workspace',
  'an unknown account cannot become an examination owner'
);

select is(
  examination_room_v1.creator_authorized(
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000102'
  ),
  true,
  'the private creator predicate recognizes the exact verified owner workspace'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'session',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000102',
    '{}'::jsonb
  ) #>> '{professor,authorized}',
  'true',
  'the successful Professor session contract carries the explicit authorization flag'
);

select is(
  public.examination_room_v1_staff_context(
    '00000000-0000-0000-0000-000000000103'
  )->>'institutionId',
  '00000000-0000-0000-0000-000000000102',
  'staff context resolves an unambiguous active institution'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'exam',
    '00000000-0000-0000-0000-000000000103',
    '00000000-0000-0000-0000-000000000102',
    '{"examId":"00000000-0000-0000-0000-000000000201"}'::jsonb
  )->>'ok',
  'true',
  'the registered dispatcher executes the authorized professor exam query'
);

select is(
  public.examination_room_v1_api(
    'student',
    'preview',
    null,
    '00000000-0000-0000-0000-000000000102',
    '{"roomKey":"must-not-cross-the-boundary"}'::jsonb
  )->>'errorCode',
  'RAW_SECRET_REJECTED',
  'the dispatcher rejects a raw room key before any operation handling'
);

select lives_ok(
  $$
    insert into examination_room_v1.exam_versions (
      id,
      exam_id,
      institution_id,
      version_number,
      title_snapshot,
      instructions,
      duration_seconds,
      privacy_notice_version_id,
      content_sha256
    ) values (
      '00000000-0000-0000-0000-000000000204',
      '00000000-0000-0000-0000-000000000201',
      '00000000-0000-0000-0000-000000000102',
      2,
      'Building version',
      'Still editable.',
      3600,
      '00000000-0000-0000-0000-000000000101',
      repeat('f', 64)
    )
  $$,
  'a later version can remain in editable building state'
);

select throws_ok(
  $$
    update examination_room_v1.questions
    set exam_version_id = '00000000-0000-0000-0000-000000000204'
    where id = '00000000-0000-0000-0000-000000000203'
  $$,
  '55000',
  'published exam questions are immutable',
  'a published question cannot be moved into a building version'
);

select lives_ok(
  $$
    do $regrant$
    begin
      update examination_room_v1.staff_memberships
      set membership_status = 'revoked',
          revoked_by_user_id = '00000000-0000-0000-0000-000000000103',
          revoked_at = now(),
          revocation_reason = 'Test revocation'
      where institution_id = '00000000-0000-0000-0000-000000000102'
        and user_id = '00000000-0000-0000-0000-000000000103'
        and staff_role = 'professor'
        and membership_status = 'active';

      insert into examination_room_v1.staff_memberships (
        institution_id,
        user_id,
        staff_role,
        granted_by_user_id
      ) values (
        '00000000-0000-0000-0000-000000000102',
        '00000000-0000-0000-0000-000000000103',
        'professor',
        '00000000-0000-0000-0000-000000000103'
      );
    end;
    $regrant$;
  $$,
  'a revoked staff role can be re-granted with a new history row'
);

select is(
  (
    select count(*)
    from examination_room_v1.staff_memberships m
    where m.institution_id = '00000000-0000-0000-0000-000000000102'
      and m.user_id = '00000000-0000-0000-0000-000000000103'
      and m.staff_role = 'professor'
  ),
  1::bigint,
  'an optional legacy staff assignment can still be granted without gating creator access'
);

select ok(
  (
    select position('prior.recorded_at < new.recorded_at' in p.prosrc) > 0
      and position('prior.created_at <= new.created_at' in p.prosrc) > 0
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'examination_room_v1'
      and p.proname = 'validate_privacy_acceptance'
  ),
  'privacy withdrawals must follow the accepted event chronologically'
);

select ok(
  (
    select position('prior.release_action = ''release''' in p.prosrc) > 0
      and position('prior.occurred_at < new.occurred_at' in p.prosrc) > 0
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'examination_room_v1'
      and p.proname = 'ensure_releasable_grade'
  )
  and exists (
    select 1
    from pg_catalog.pg_index i
    join pg_catalog.pg_class c on c.oid = i.indexrelid
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'examination_room_v1'
      and c.relname = 'result_releases_one_revocation_per_release_idx'
      and i.indisunique
  ),
  'a result revocation targets one earlier release and can occur only once'
);

select throws_ok(
  $$
    update examination_room_v1.exam_versions
    set title_snapshot = 'Changed after publication'
    where id = '00000000-0000-0000-0000-000000000202'
  $$,
  '55000',
  'examination_room_v1.exam_versions is immutable except for its one-way publication seal',
  'a sealed published exam version cannot be changed'
);

select throws_ok(
  $$
    insert into examination_room_v1.questions (
      exam_version_id,
      position,
      question_key,
      question_kind,
      prompt,
      points,
      content_sha256
    ) values (
      '00000000-0000-0000-0000-000000000202',
      2,
      'q002',
      'essay',
      'This late question must be rejected.',
      0,
      repeat('e', 64)
    )
  $$,
  '55000',
  'published exam questions are immutable',
  'questions cannot be appended after the version is sealed'
);

select throws_like(
  $$
    insert into examination_room_v1.audit_events (
      institution_id,
      actor_role,
      event_type,
      subject_type,
      correlation_id,
      request_hash,
      event_data,
      event_hash,
      occurred_at
    ) values (
      '00000000-0000-0000-0000-000000000102',
      'service',
      'test.raw-key-rejection',
      'test',
      '00000000-0000-0000-0000-000000000104',
      repeat('9', 64),
      '{"roomKey":"must-not-persist"}'::jsonb,
      repeat('b', 64),
      now()
    )
  $$,
  '%violates check constraint%',
  'audit events reject payloads containing a raw room key field'
);

create temporary table examination_room_v1_test_payloads (
  payload_name text primary key,
  payload jsonb not null
) on commit drop;

insert into examination_room_v1_test_payloads (payload_name, payload)
values
  (
    'exam',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'title', 'Constitutional Law Functional Examination',
      'subject', 'Constitutional Law',
      'yearLevel', 'Second year',
      'instructions', 'Answer completely using applicable Philippine law.',
      'jurisdiction', 'Philippines',
      'durationMinutes', 120,
      'startsAt', clock_timestamp() + interval '30 minutes',
      'lateSubmissions', 'not_allowed',
      'navigation', 'free',
      'identityMode', 'anonymous_grading',
      'integrityTier', 'standard',
      'cameraRequired', false,
      'microphoneRequired', false,
      'privacyNoticeVersion', 'exam-room-v1',
      'privacyController', 'Participating law school',
      'retentionSummary', 'Records follow the approved institution retention policy.',
      'sourceFileName', null,
      'sourceFileSize', null,
      'questions', jsonb_build_array(jsonb_build_object(
        'questionNumber', 1,
        'questionKey', 'q001',
        'questionKind', 'essay',
        'type', 'essay',
        'prompt', 'Explain separation of powers and apply it to the facts.',
        'points', 20,
        'gradingGuidance', '',
        'wordLimit', 800,
        'choices', '[]'::jsonb,
        'correctOptionIndex', null,
        'acceptedAnswers', '[]'::jsonb
      )),
      'roster', jsonb_build_array(jsonb_build_object(
        'clientId', 'student-functional-1',
        'fullName', 'Maria Theresa Dela Cruz',
        'studentNumber', '2024-10001',
        'email', 'maria.functional@example.edu.ph',
        'subject', 'Constitutional Law',
        'yearLevel', 'Second year',
        'extraMinutes', 0
      ))
    )
  ),
  (
    'draft',
    jsonb_build_object(
      'title', 'Constitutional Law Functional Examination',
      'subject', 'Constitutional Law',
      'yearLevel', 'Second year',
      'instructions', 'Answer completely using applicable Philippine law.',
      'identityMode', 'anonymous_grading',
      'integrityTier', 'standard',
      'privacyNoticeVersion', 'exam-room-v1',
      'questions', jsonb_build_array(jsonb_build_object(
        'questionNumber', 1,
        'questionKey', 'q001',
        'questionKind', 'essay',
        'type', 'essay',
        'prompt', 'Explain separation of powers and apply it to the facts.',
        'points', 20,
        'gradingGuidance', '',
        'wordLimit', 800,
        'choices', '[]'::jsonb,
        'correctOptionIndex', null,
        'acceptedAnswers', '[]'::jsonb
      )),
      'questionCount', 1,
      'totalPoints', 20
    )
  );

select lives_ok(
  $$
    insert into auth.users (
      id, instance_id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at, is_sso_user, is_anonymous
    ) values
      (
        '10000000-0000-4000-8000-000000000002',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'professor.functional@example.edu.ph',
        '{}'::jsonb, '{"full_name":"Prof. Elena Villanueva"}'::jsonb,
        now(), now(), false, false
      ),
      (
        '10000000-0000-4000-8000-000000000003',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'admin.functional@example.edu.ph',
        '{}'::jsonb, '{"full_name":"Functional Administrator"}'::jsonb,
        now(), now(), false, false
      );

    update public.profiles
    set display_name = 'Prof. Elena Villanueva',
        law_school_id = 'functional-college-of-law',
        school = 'functional-college-of-law',
        commercial_category = 'professor',
        commercial_onboarding_completed_at = now()
    where id = '10000000-0000-4000-8000-000000000002';

    insert into public.professor_license_declarations (
      user_id, license_number, declaration_version, declared_at, updated_at
    ) values (
      '10000000-0000-4000-8000-000000000002', 'TEST-DECLARATION-FUNCTIONAL',
      'professor-declaration-v1-2026-08-18', now(), now()
    );

    insert into public.user_roles (user_id, role, assigned_by)
    values (
      '10000000-0000-4000-8000-000000000003', 'founder_admin',
      '10000000-0000-4000-8000-000000000003'
    )
    on conflict (user_id) do update set role = excluded.role;

    insert into examination_room_v1.institutions (
      id, institution_code, profile_school_id, institution_name,
      bootstrap_request_hash, created_by_user_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'functional-law', 'functional-college-of-law', 'Functional College of Law',
      repeat('a1', 32), '10000000-0000-4000-8000-000000000003'
    );

    insert into examination_room_v1.staff_memberships (
      institution_id, user_id, staff_role, display_name, email_normalized, granted_by_user_id
    ) values
      (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        'professor',
        'Prof. Elena Villanueva',
        'professor.functional@example.edu.ph',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000003',
        'admin',
        'Functional Administrator',
        'admin.functional@example.edu.ph',
        '10000000-0000-4000-8000-000000000003'
      );

    insert into examination_room_v1.privacy_notice_versions (
      id, institution_id, notice_code, version_number, title, notice_body,
      body_sha256, processing_purposes, effective_at, created_by_user_id
    ) values (
      '10000000-0000-4000-8000-000000000005',
      '10000000-0000-4000-8000-000000000001',
      'exam-room-v1',
      1,
      'Examination privacy notice',
      'Identity, answers, integrity signals, and separately accepted recordings are processed for examination administration.',
      repeat('0', 64),
      '["identity_verification","examination_administration"]'::jsonb,
      clock_timestamp() - interval '1 day',
      '10000000-0000-4000-8000-000000000003'
    );
  $$,
  'functional workflow staff and exact privacy notice can be provisioned'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'save_draft',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'exam', (select payload from examination_room_v1_test_payloads where payload_name = 'exam'),
      'draft', (select payload from examination_room_v1_test_payloads where payload_name = 'draft'),
      'requestHash', repeat('1', 64),
      'requestedAt', clock_timestamp()
    )
  )->>'ok',
  'true',
  'professor save_draft atomically persists the normalized draft, question, and roster'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'publish',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'exam', (select payload from examination_room_v1_test_payloads where payload_name = 'exam'),
      'draft', (select payload from examination_room_v1_test_payloads where payload_name = 'draft'),
      'requestHash', repeat('2', 64),
      'requestedAt', clock_timestamp() + interval '1 second'
    )
  ) #>> '{publicationManifest,schemaVersion}',
  'examination-room/publication/v1',
  'publish seals and returns the canonical immutable publication manifest'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'publish',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'exam', (select payload from examination_room_v1_test_payloads where payload_name = 'exam'),
      'draft', (select payload from examination_room_v1_test_payloads where payload_name = 'draft'),
      'requestHash', repeat('2', 64),
      'requestedAt', clock_timestamp() + interval '1 second'
    )
  ) #>> '{publicationManifest,schemaVersion}',
  'examination-room/publication/v1',
  'publish replay returns the original sealed manifest without creating another version'
);

select is(
  (
    select v.content_sha256
    from examination_room_v1.exam_versions v
    where v.exam_id = '10000000-0000-4000-8000-000000000004'
      and v.publication_status = 'published'
  ),
  (
    select examination_room_v1.jsonb_sha256(v.publication_manifest)
    from examination_room_v1.exam_versions v
    where v.exam_id = '10000000-0000-4000-8000-000000000004'
      and v.publication_status = 'published'
  ),
  'publication fingerprint is SHA-256 of the exact canonical immutable manifest'
);

select ok(
  (
    select v.content_sha256 <> repeat('2', 64)
    from examination_room_v1.exam_versions v
    where v.exam_id = '10000000-0000-4000-8000-000000000004'
      and v.publication_status = 'published'
  ),
  'publication fingerprint is independent from the command idempotency hash'
);

select ok(
  (
    select q.content_sha256 <> repeat('2', 64)
    from examination_room_v1.questions q
    join examination_room_v1.exam_versions v on v.id = q.exam_version_id
    where v.exam_id = '10000000-0000-4000-8000-000000000004'
      and q.position = 1
  ),
  'question content has its own normalized content fingerprint'
);

select is(
  public.examination_room_v1_api(
    'admin',
    'activate_exam',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'requestHash', repeat('3', 64),
      'roomKeyHash', repeat('a1', 32),
      'keyHashAlgorithm', 'hmac-sha256-v1',
      'opensAt', clock_timestamp() - interval '5 minutes',
      'closesAt', clock_timestamp() + interval '4 hours',
      'maxSessions', 100,
      'replaceCurrent', false
    )
  )->>'ok',
  'true',
  'admin activate_exam stores only the room-key HMAC and returns an activation receipt'
);

select is(
  public.examination_room_v1_api(
    'admin',
    'email_key',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'requestHash', repeat('4', 64),
      'roomKeyHash', repeat('b2', 32),
      'keyHashAlgorithm', 'hmac-sha256-v1',
      'opensAt', clock_timestamp() - interval '5 minutes',
      'closesAt', clock_timestamp() + interval '4 hours',
      'maxSessions', 100,
      'replaceCurrent', true
    )
  )->>'professorEmail',
  'professor.functional@example.edu.ph',
  'email_key replaces the verifier and returns the verified professor delivery contact'
);

select is(
  public.examination_room_v1_owner_query(
    'access',
    '10000000-0000-4000-8000-000000000002',
    null, null, '{}'::jsonb
  )->>'errorCode',
  'PLATFORM_OWNER_REQUIRED',
  'a Professor cannot enter the platform-owner command center'
);

select is(
  public.examination_room_v1_owner_query(
    'access',
    '10000000-0000-4000-8000-000000000003',
    null, null, '{}'::jsonb
  )->>'ownerOnly',
  'true',
  'a Founder can enter the platform-owner command center'
);

select is(
  jsonb_array_length(
    public.examination_room_v1_owner_query(
      'command_center',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      null,
      '{}'::jsonb
    ) -> 'exams'
  ),
  1,
  'the owner command center lists the published examination without code or hidden rows'
);

select is(
  public.examination_room_v1_owner_command(
    'store_key_envelope',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'activationId', (
        select id from examination_room_v1.room_activations
        where exam_id = '10000000-0000-4000-8000-000000000004'
          and activation_status = 'scheduled'
        order by created_at desc limit 1
      ),
      'algorithm', 'aes-256-gcm-v1',
      'keyVersion', 1,
      'ciphertext', repeat('A', 32),
      'iv', repeat('B', 24),
      'aadSha256', repeat('c', 64)
    )
  )->>'escrowed',
  'true',
  'the Worker can bind an encrypted owner-viewable key envelope to the current activation'
);

select is(
  public.examination_room_v1_owner_query(
    'key_envelope',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    '{}'::jsonb
  )->>'ciphertext',
  repeat('A', 32),
  'the owner key query returns the exact encrypted envelope for Worker-side reveal'
);

select throws_ok(
  $$
    update examination_room_v1.owner_key_envelopes
    set ciphertext_base64 = repeat('Z', 32)
  $$,
  '55000',
  'examination_room_v1.owner_key_envelopes is append-only',
  'room-key escrow history cannot be rewritten'
);

select is(
  public.examination_room_v1_owner_command(
    'record_email_delivery',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'activationId', (
        select id from examination_room_v1.room_activations
        where exam_id = '10000000-0000-4000-8000-000000000004'
          and activation_status = 'scheduled'
        order by created_at desc limit 1
      ),
      'requestHash', repeat('1d', 32),
      'deliveryKind', 'key_resend',
      'professorRecipient', 'professor.functional@example.edu.ph',
      'ownerCopyRecipients', jsonb_build_array('owner@duediligence.ph'),
      'providerStatus', 'failed',
      'safeErrorCode', 'network_error',
      'attemptedAt', clock_timestamp() - interval '2 minutes'
    )
  )->>'providerStatus',
  'failed',
  'the first failed key-email attempt is returned as the persisted audit status'
);

select is(
  public.examination_room_v1_owner_command(
    'record_email_delivery',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'activationId', (
        select id from examination_room_v1.room_activations
        where exam_id = '10000000-0000-4000-8000-000000000004'
          and activation_status = 'scheduled'
        order by created_at desc limit 1
      ),
      'requestHash', repeat('1d', 32),
      'deliveryKind', 'key_resend',
      'professorRecipient', 'professor.functional@example.edu.ph',
      'ownerCopyRecipients', jsonb_build_array('owner@duediligence.ph'),
      'providerStatus', 'sent',
      'providerId', 'email-retry-success',
      'attemptedAt', clock_timestamp() - interval '1 minute'
    )
  )->>'providerStatus',
  'sent',
  'a successful retry monotonically upgrades the same email-delivery audit row'
);

select is(
  public.examination_room_v1_owner_command(
    'record_email_delivery',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'activationId', (
        select id from examination_room_v1.room_activations
        where exam_id = '10000000-0000-4000-8000-000000000004'
          and activation_status = 'scheduled'
        order by created_at desc limit 1
      ),
      'requestHash', repeat('1d', 32),
      'deliveryKind', 'key_resend',
      'professorRecipient', 'professor.functional@example.edu.ph',
      'ownerCopyRecipients', jsonb_build_array('owner@duediligence.ph'),
      'providerStatus', 'failed',
      'safeErrorCode', 'provider_503',
      'attemptedAt', clock_timestamp()
    )
  )->>'providerStatus',
  'sent',
  'a later failed retry returns the earlier persisted success instead of downgrading it'
);

select is(
  (
    select provider_status || ':' || provider_id || ':' || coalesce(safe_error_code, 'none')
    from examination_room_v1.email_delivery_events
    where request_hash = repeat('1d', 32)
  ),
  'sent:email-retry-success:none',
  'the successful provider evidence remains the single durable row after a failed retry'
);

select throws_ok(
  $$
    update examination_room_v1.email_delivery_events
    set provider_status = 'failed',
        provider_id = null,
        safe_error_code = 'network_error',
        attempted_at = clock_timestamp()
    where request_hash = repeat('1d', 32)
  $$,
  '55000',
  'email delivery status may advance only from failed or not configured to sent',
  'direct writes cannot downgrade a recorded successful key-email delivery'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'open_room',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'roomKeyHash', repeat('b2', 32),
      'requestHash', repeat('5', 64),
      'openedAt', clock_timestamp()
    )
  )->>'status',
  'open',
  'professor open_room opens only the activation matching the current key verifier'
);

select is(
  public.examination_room_v1_api(
    'student',
    'preview',
    null,
    null,
    jsonb_build_object(
      'roomKeyHash', repeat('b2', 32),
      'identity', jsonb_build_object(
        'realName', 'Maria Theresa Dela Cruz',
        'studentNumber', '2024-10001',
        'subject', 'Constitutional Law',
        'yearLevel', 'Second year'
      )
    )
  ) #>> '{metadata,examId}',
  '10000000-0000-4000-8000-000000000004',
  'student preview derives institution from the key hash and exact roster identity'
);

select is(
  public.examination_room_v1_api(
    'student',
    'consent',
    null,
    null,
    jsonb_build_object(
      'roomKeyHash', repeat('b2', 32),
      'identity', jsonb_build_object(
        'realName', 'Maria Theresa Dela Cruz',
        'studentNumber', '2024-10001',
        'subject', 'Constitutional Law',
        'yearLevel', 'Second year'
      ),
      'consent', jsonb_build_object(
        'noticeVersion', 'wrong-notice',
        'accepted', true,
        'acceptedAt', clock_timestamp(),
        'recordingAccepted', false
      ),
      'clientEventId', '10000000-0000-4000-8000-000000000010',
      'requestHash', repeat('0a', 32),
      'sessionTokenHash', repeat('c3', 32),
      'clientInstanceId', '10000000-0000-4000-8000-000000000011'
    )
  )->>'errorCode',
  'PRIVACY_CONSENT_VERSION_MISMATCH',
  'student consent rejects any notice version other than the exact published version'
);

select is(
  public.examination_room_v1_api(
    'student',
    'consent',
    null,
    null,
    jsonb_build_object(
      'roomKeyHash', repeat('b2', 32),
      'identity', jsonb_build_object(
        'realName', 'Maria Theresa Dela Cruz',
        'studentNumber', '2024-10001',
        'subject', 'Constitutional Law',
        'yearLevel', 'Second year'
      ),
      'consent', jsonb_build_object(
        'noticeVersion', 'exam-room-v1',
        'accepted', true,
        'acceptedAt', clock_timestamp(),
        'recordingAccepted', false
      ),
      'clientEventId', '10000000-0000-4000-8000-000000000012',
      'requestHash', repeat('6', 64),
      'sessionTokenHash', repeat('c3', 32),
      'clientInstanceId', '10000000-0000-4000-8000-000000000013'
    )
  )->>'ok',
  'true',
  'student consent creates a version-bound acceptance and HMAC-protected session'
);

select is(
  public.examination_room_v1_api(
    'student',
    'consent',
    null,
    null,
    jsonb_build_object(
      'roomKeyHash', repeat('b2', 32),
      'identity', jsonb_build_object(
        'realName', 'Maria Theresa Dela Cruz',
        'studentNumber', '2024-10001',
        'subject', 'Constitutional Law',
        'yearLevel', 'Second year'
      ),
      'consent', jsonb_build_object(
        'noticeVersion', 'exam-room-v1',
        'accepted', true,
        'acceptedAt', clock_timestamp(),
        'recordingAccepted', false
      ),
      'clientEventId', '10000000-0000-4000-8000-000000000012',
      'requestHash', repeat('6', 64),
      'sessionTokenHash', repeat('c4', 32),
      'clientInstanceId', '10000000-0000-4000-8000-000000000013'
    )
  )->>'ok',
  'true',
  'lost consent response can rotate the unused token verifier without creating another session'
);

select is(
  public.examination_room_v1_api(
    'student',
    'resume',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c3', 32)
    )
  )->>'errorCode',
  'SESSION_INVALID',
  'a rotated or incorrect student session token cannot resume the examination'
);

select is(
  public.examination_room_v1_api(
    'student',
    'session_context',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32)
    )
  ) #>> '{privacyConsent,noticeVersion}',
  'exam-room-v1',
  'session_context returns the exact accepted notice and canonical publication'
);

select is(
  public.examination_room_v1_api(
    'student',
    'save_answer',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('7', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000014',
      'answerRevision', jsonb_build_object(
        'attemptId', (
          select id from examination_room_v1.student_sessions
          where consent_request_hash = repeat('6', 64)
        ),
        'examinationId', '10000000-0000-4000-8000-000000000004',
        'examinationVersion', 1,
        'publicationHash', (
          select content_sha256 from examination_room_v1.exam_versions
          where exam_id = '10000000-0000-4000-8000-000000000004'
            and publication_status = 'published'
        ),
        'questionNumber', 1,
        'questionKey', 'q001',
        'questionType', 'essay',
        'revision', 1,
        'answer', 'Checks and balances preserve the separation of powers.'
      ),
      'answerHash', repeat('d5', 32),
      'flagged', false,
      'source', 'manual_save',
      'savedAt', clock_timestamp()
    )
  ) #>> '{revision,revision}',
  '1',
  'save_answer appends the first server-backed answer revision'
);

select is(
  public.examination_room_v1_api(
    'student',
    'save_answer',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('7', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000014',
      'answerRevision', '{}'::jsonb,
      'answerHash', repeat('d5', 32),
      'flagged', false,
      'source', 'manual_save',
      'savedAt', clock_timestamp()
    )
  ) #>> '{revision,revision}',
  '1',
  'save_answer replay returns the original receipt before revalidating a regenerated payload'
);

select is(
  (
    select count(*)
    from examination_room_v1.answer_revisions
    where idempotency_key_hash = repeat('7', 64)
  ),
  1::bigint,
  'answer replay leaves exactly one append-only revision'
);

select is(
  public.examination_room_v1_api(
    'student',
    'heartbeat',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('8', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000015',
      'connected', true,
      'currentQuestion', 1,
      'occurredAt', clock_timestamp()
    )
  )->>'ok',
  'true',
  'heartbeat updates only mutable session liveness state'
);

select is(
  public.examination_room_v1_api(
    'student',
    'record_event',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('9', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000016',
      'incidentKind', 'focus_lost',
      'severity', 'warning',
      'occurredAt', clock_timestamp(),
      'durationMs', 500,
      'details', '{"reason":"window_blur"}'::jsonb
    )
  )->>'ok',
  'true',
  'record_event appends a reviewable browser signal without treating it as proof'
);

select is(
  public.examination_room_v1_api(
    'student',
    'submit',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('a', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000017',
      'submissionManifest', jsonb_build_object(
        'schemaVersion', 'examination-room/submission/v1',
        'submissionId', '10000000-0000-4000-8000-000000000020',
        'attemptId', (
          select id from examination_room_v1.student_sessions
          where consent_request_hash = repeat('6', 64)
        ),
        'examinationId', '10000000-0000-4000-8000-000000000004',
        'examinationVersion', 1,
        'publicationHash', (
          select content_sha256 from examination_room_v1.exam_versions
          where exam_id = '10000000-0000-4000-8000-000000000004'
            and publication_status = 'published'
        ),
        'identityMode', 'anonymous_grading',
        'studentIdentity', jsonb_build_object(
          'realName', 'Maria Theresa Dela Cruz',
          'studentNumber', '2024-10001',
          'subject', 'Constitutional Law',
          'yearLevel', 'Second year'
        ),
        'gradingIdentity', jsonb_build_object(
          'mode', 'anonymous_grading',
          'anonymousCandidateId', (
            select er.grading_alias
            from examination_room_v1.student_sessions ss
            join examination_room_v1.exam_roster er on er.id = ss.roster_id
            where ss.consent_request_hash = repeat('6', 64)
          )
        ),
        'submittedAt', clock_timestamp(),
        'privacyConsent', jsonb_build_object(
          'noticeVersion', 'exam-room-v1',
          'accepted', true,
          'acceptedAt', (
            select to_char(pa.recorded_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
            from examination_room_v1.privacy_acceptances pa
            join examination_room_v1.student_sessions ss on ss.id = pa.session_id
            where ss.consent_request_hash = repeat('6', 64)
              and pa.decision = 'accepted'
            order by pa.recorded_at desc
            limit 1
          ),
          'recordingAccepted', false
        ),
        'questions', jsonb_build_array(jsonb_build_object(
          'questionNumber', 1,
          'questionKey', 'q001',
          'revision', 1,
          'answer', 'Checks and balances preserve the separation of powers.'
        )),
        'questionCount', 1,
        'maxPoints', 20
      ),
      'manifestHash', repeat('e6', 32),
      'answerSelections', jsonb_build_array(jsonb_build_object(
        'questionNumber', 1,
        'questionKey', 'q001',
        'revision', 1
      ))
    )
  ) #>> '{submission,status}',
  'accepted',
  'submit freezes the selected answer set and issues the receipt last'
);

select is(
  public.examination_room_v1_api(
    'student',
    'submit',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('a', 64),
      'clientEventId', '10000000-0000-4000-8000-000000000017'
    )
  )->>'duplicate',
  'true',
  'submission replay remains idempotent after the session is already terminal'
);

select is(
  (
    select count(*)
    from examination_room_v1.submission_receipts r
    where r.submission_id = '10000000-0000-4000-8000-000000000020'
  ),
  1::bigint,
  'idempotent submission has exactly one immutable server receipt'
);

select is(
  public.examination_room_v1_owner_command(
    'correct_student_identity',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'studentIdentityId', (
        select roster.student_identity_id
        from examination_room_v1.exam_roster roster
        where roster.exam_id = '10000000-0000-4000-8000-000000000004'
        order by roster.created_at, roster.id
        limit 1
      ),
      'email', 'wrong.student@example.edu.ph',
      'reason', 'Owner recorded a deliberately wrong email before testing explicit removal.',
      'requestHash', repeat('cd', 32)
    )
  ) #>> '{after,email}',
  'wrong.student@example.edu.ph',
  'owner identity correction can record a corrected student email explicitly'
);

select ok(
  public.examination_room_v1_owner_command(
    'correct_student_identity',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'studentIdentityId', (
        select roster.student_identity_id
        from examination_room_v1.exam_roster roster
        where roster.exam_id = '10000000-0000-4000-8000-000000000004'
        order by roster.created_at, roster.id
        limit 1
      ),
      'clearEmail', true,
      'reason', 'Owner removed the deliberately wrong email after checking the school record.',
      'requestHash', repeat('ce', 32)
    )
  ) #> '{after,email}' = 'null'::jsonb,
  'owner identity correction explicitly clears a wrong student email and records null in its receipt'
);

update examination_room_v1.student_sessions
set session_status = 'active', ended_at = null
where consent_request_hash = repeat('6', 64);

select is(
  public.examination_room_v1_api(
    'student',
    'submit',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('af', 32),
      'clientEventId', '10000000-0000-4000-8000-000000000018',
      'submissionManifest', jsonb_set(
        (
          select sub.submission_manifest
          from examination_room_v1.submissions sub
          join examination_room_v1.student_sessions ss on ss.id = sub.session_id
          where ss.consent_request_hash = repeat('6', 64)
        ),
        '{studentIdentity,realName}',
        '"Another Student"'::jsonb
      ),
      'manifestHash', repeat('af', 32),
      'answerSelections', jsonb_build_array(jsonb_build_object(
        'questionNumber', 1,
        'questionKey', 'q001',
        'revision', 1
      ))
    )
  )->>'errorCode',
  'SUBMISSION_BINDING_MISMATCH',
  'submission rejects identity evidence that differs from the verified session roster'
);

update examination_room_v1.student_sessions
set session_status = 'submitted', ended_at = clock_timestamp()
where consent_request_hash = repeat('6', 64);

select is(
  public.examination_room_v1_api(
    'professor',
    'grading',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object('examId', '10000000-0000-4000-8000-000000000004')
  ) #>> '{sessions,0,sessionId}',
  examination_room_v1.uuid_from_hash(repeat('a', 64))::text,
  'anonymous grading exposes an opaque grading-session identifier instead of the monitoring session identifier'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'monitor',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object('examId', '10000000-0000-4000-8000-000000000004')
  ) #>> '{sessions,0,fullName}',
  'Maria Theresa Dela Cruz',
  'monitoring retains the verified real identity even when grading is anonymous'
);

select ok(
  public.examination_room_v1_api(
    'professor',
    'grading',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object('examId', '10000000-0000-4000-8000-000000000004')
  ) #>> '{sessions,0,realFullName}' = 'Maria Theresa Dela Cruz'
  and public.examination_room_v1_api(
    'professor',
    'grading',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object('examId', '10000000-0000-4000-8000-000000000004')
  ) #>> '{sessions,0,realStudentNumber}' = '2024-10001'
  and nullif(public.examination_room_v1_api(
    'professor',
    'grading',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object('examId', '10000000-0000-4000-8000-000000000004')
  ) #>> '{sessions,0,gradingAlias}', '') is not null,
  'authorized grading returns real identity plus the optional grading alias for Professor-controlled reveal'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'grading_context',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'questionReference', 'q001'
    )
  ) #>> '{submissionManifest,attemptId}',
  examination_room_v1.uuid_from_hash(repeat('a', 64))::text,
  'anonymous grading context replaces the real attempt identifier with the opaque grading identifier'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'grading_context',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'questionReference', 'q001'
    )
  ) #>> '{submissionManifest,studentIdentity,realName}',
  (
    select er.grading_alias
    from examination_room_v1.student_sessions ss
    join examination_room_v1.exam_roster er on er.id = ss.roster_id
    where ss.consent_request_hash = repeat('6', 64)
  ),
  'anonymous grading context replaces the real student name with the grading alias'
);

select ok(
  position(
    'Maria Theresa Dela Cruz' in public.examination_room_v1_api(
      'professor',
      'grading_context',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'examId', '10000000-0000-4000-8000-000000000004',
        'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
        'questionReference', 'q001'
      )
    )::text
  ) = 0,
  'anonymous grading context contains no real student name'
);

select is(
  public.examination_room_v1_grading_contexts(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object('requests', jsonb_build_array(jsonb_build_object(
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'questionReferences', jsonb_build_array('q001')
    )))
  ) #>> '{contexts,0,sessionId}',
  examination_room_v1.uuid_from_hash(repeat('a', 64))::text,
  'batched offline grading contexts preserve request order and anonymous session identity'
);

select is(
  public.examination_room_v1_grading_contexts(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object('requests', jsonb_build_array(jsonb_build_object(
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'questionReferences', jsonb_build_array('not-a-question')
    )))
  ) ->> 'errorCode',
  'GRADING_CONTEXT_INVALID',
  'batched offline grading contexts reject questions outside the submitted examination version'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'save_grade',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'requestHash', repeat('ba', 32),
      'clientRevisionId', '10000000-0000-4000-8000-000000000019',
      'gradingHash', repeat('ba', 32),
      'gradingManifest', jsonb_build_object(
        'schemaVersion', 'examination-room/grading/v1',
        'submissionId', '10000000-0000-4000-8000-000000000020',
        'publicationHash', (
          select content_sha256 from examination_room_v1.exam_versions
          where exam_id = '10000000-0000-4000-8000-000000000004'
            and publication_status = 'published'
        ),
        'status', 'draft',
        'graderId', '10000000-0000-4000-8000-000000000003'
      )
    )
  )->>'errorCode',
  'GRADING_MANIFEST_INVALID',
  'grading evidence rejects a grader identity that differs from the signed-in professor'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'save_grade',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
      'requestHash', repeat('b', 64),
      'clientRevisionId', '10000000-0000-4000-8000-000000000021',
      'gradingHash', repeat('1a', 32),
      'gradingManifest', jsonb_build_object(
        'schemaVersion', 'examination-room/grading/v1',
        'revisionId', '10000000-0000-4000-8000-000000000022',
        'submissionId', '10000000-0000-4000-8000-000000000020',
        'publicationHash', (
          select content_sha256 from examination_room_v1.exam_versions
          where exam_id = '10000000-0000-4000-8000-000000000004'
            and publication_status = 'published'
        ),
        'revision', 1,
        'status', 'draft',
        'graderId', '10000000-0000-4000-8000-000000000002',
        'gradedAt', clock_timestamp(),
        'scores', jsonb_build_array(jsonb_build_object(
          'questionNumber', 1,
          'questionKey', 'q001',
          'pointsAwarded', 18,
          'maxPoints', 20,
          'feedback', 'Sound legal analysis.'
        )),
        'scoreCount', 1,
        'totalPointsAwarded', 18,
        'maxPoints', 20,
        'overallFeedback', 'Well organized.'
      )
    )
  ) #>> '{revision,revision}',
  '1',
  'save_grade appends a complete normalized grade revision and item set'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'release_results',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionIds', jsonb_build_array(examination_room_v1.uuid_from_hash(repeat('a', 64))),
      'requestHash', repeat('c', 64),
      'releases', jsonb_build_array(jsonb_build_object(
        'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
        'gradingHash', repeat('2b', 32),
        'releaseHash', repeat('3c', 32),
        'releaseRequestHash', repeat('d', 64),
        'gradingManifest', jsonb_build_object(
          'schemaVersion', 'examination-room/grading/v1',
          'revisionId', '10000000-0000-4000-8000-000000000023',
          'submissionId', '10000000-0000-4000-8000-000000000020',
          'publicationHash', (
            select content_sha256 from examination_room_v1.exam_versions
            where exam_id = '10000000-0000-4000-8000-000000000004'
              and publication_status = 'published'
          ),
          'revision', 2,
          'status', 'final',
          'graderId', '10000000-0000-4000-8000-000000000002',
          'gradedAt', '2026-08-26T05:00:00.000Z',
          'scores', jsonb_build_array(jsonb_build_object(
            'questionNumber', 1,
            'questionKey', 'q001',
            'pointsAwarded', 18,
            'maxPoints', 20,
            'feedback', 'Sound legal analysis.'
          )),
          'scoreCount', 1,
          'totalPointsAwarded', 18,
          'maxPoints', 20,
          'overallFeedback', 'Well organized.'
        ),
        'releaseManifest', jsonb_build_object(
          'schemaVersion', 'examination-room/result-release/v1',
          'releaseId', '10000000-0000-4000-8000-000000000024',
          'submissionId', '10000000-0000-4000-8000-000000000020',
          'publicationHash', (
            select content_sha256 from examination_room_v1.exam_versions
            where exam_id = '10000000-0000-4000-8000-000000000004'
              and publication_status = 'published'
          ),
          'selectedRevisionId', '10000000-0000-4000-8000-000000000023',
          'selectedRevision', 2,
          'releasedAt', '2026-08-26T05:00:01.000Z',
          'releasedBy', '10000000-0000-4000-8000-000000000002',
          'result', jsonb_build_object(
            'gradedAt', '2026-08-26T05:00:00.000Z',
            'scores', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'pointsAwarded', 18,
              'maxPoints', 20,
              'feedback', 'Sound legal analysis.'
            )),
            'totalPointsAwarded', 18,
            'maxPoints', 20,
            'overallFeedback', 'Well organized.'
          )
        )
      ))
    )
  )->>'released',
  '1',
  'release_results appends the final grade before the immutable result release'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'release_results',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'sessionIds', jsonb_build_array(examination_room_v1.uuid_from_hash(repeat('a', 64))),
      'requestHash', repeat('ca', 32),
      'releases', jsonb_build_array(jsonb_build_object(
        'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
        'gradingHash', repeat('cb', 32),
        'releaseHash', repeat('cc', 32),
        'releaseRequestHash', repeat('cd', 32),
        'gradingManifest', (
          select gr.grading_manifest || jsonb_build_object(
            'revisionId', '10000000-0000-4000-8000-000000000025',
            'revision', 3,
            'gradedAt', '2026-08-26T05:01:00.000Z'
          )
          from examination_room_v1.grade_revisions gr
          where gr.submission_id = '10000000-0000-4000-8000-000000000020'
          order by gr.revision_number desc
          limit 1
        ),
        'releaseManifest', (
          select rr.release_manifest || jsonb_build_object(
            'releaseId', '10000000-0000-4000-8000-000000000026',
            'selectedRevisionId', '10000000-0000-4000-8000-000000000025',
            'selectedRevision', 3,
            'releasedAt', '2026-08-26T05:01:01.000Z',
            'result', (rr.release_manifest -> 'result') || jsonb_build_object(
              'gradedAt', '2026-08-26T05:01:00.000Z',
              'totalPointsAwarded', 17
            )
          )
          from examination_room_v1.result_releases rr
          where rr.submission_id = '10000000-0000-4000-8000-000000000020'
            and rr.release_action = 'release'
          order by rr.occurred_at desc
          limit 1
        )
      ))
    )
  )->>'errorCode',
  'RESULT_RELEASE_MISMATCH',
  'result release rejects student-facing totals that differ from the linked final grade revision'
);

select is(
  public.examination_room_v1_import_grades(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'requestHash', repeat('91', 32),
      'grades', jsonb_build_array(jsonb_build_object(
        'examId', '10000000-0000-4000-8000-000000000004',
        'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
        'requestHash', repeat('92', 32),
        'clientRevisionId', '10000000-0000-4000-8000-000000000030',
        'gradingHash', repeat('93', 32),
        'gradingManifest', (
          select grade.grading_manifest || jsonb_build_object(
            'revisionId', '10000000-0000-4000-8000-000000000031',
            'revision', 3,
            'status', 'draft',
            'gradedAt', '2026-08-26T05:02:00.000Z',
            'scores', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1, 'questionKey', 'q001',
              'pointsAwarded', 19, 'maxPoints', 20,
              'feedback', 'Offline grading import.'
            )),
            'scoreCount', 1,
            'totalPointsAwarded', 19,
            'maxPoints', 20,
            'overallFeedback', 'Imported atomically from the offline grader.'
          )
          from examination_room_v1.grade_revisions grade
          where grade.submission_id = '10000000-0000-4000-8000-000000000020'
          order by grade.revision_number desc limit 1
        )
      ))
    )
  )->>'importedCount',
  '1',
  'offline grading imports a verified batch through one database transaction'
);

select is(
  public.examination_room_v1_import_grades(
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'requestHash', repeat('94', 32),
      'grades', jsonb_build_array(
        jsonb_build_object(
          'examId', '10000000-0000-4000-8000-000000000004',
          'sessionId', examination_room_v1.uuid_from_hash(repeat('a', 64)),
          'requestHash', repeat('95', 32),
          'clientRevisionId', '10000000-0000-4000-8000-000000000032',
          'gradingHash', repeat('96', 32),
          'gradingManifest', (
            select grade.grading_manifest || jsonb_build_object(
              'revisionId', '10000000-0000-4000-8000-000000000033',
              'revision', 4,
              'status', 'draft',
              'gradedAt', '2026-08-26T05:03:00.000Z'
            )
            from examination_room_v1.grade_revisions grade
            where grade.submission_id = '10000000-0000-4000-8000-000000000020'
            order by grade.revision_number desc limit 1
          )
        ),
        jsonb_build_object('examId', '99999999-9999-4999-8999-999999999999')
      )
    )
  )->>'errorCode',
  'GRADE_IMPORT_ATOMIC_FAILURE',
  'one rejected offline grade rejects the complete batch'
);

select ok(
  not exists (
    select 1 from examination_room_v1.grade_revisions
    where id = '10000000-0000-4000-8000-000000000033'
  ),
  'a rejected offline batch leaves no partial grade revision behind'
);

select is(
  public.examination_room_v1_api(
    'student',
    'result',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32)
    )
  )->>'available',
  'true',
  'student result exposes only a released and non-revoked result'
);

insert into examination_room_v1.privacy_acceptances (
  notice_version_id, roster_id, session_id, exam_version_id, client_event_id,
  decision, prior_acceptance_id, accepted_features, evidence_sha256, capture_method, recorded_at
)
select
  pa.notice_version_id,
  pa.roster_id,
  pa.session_id,
  pa.exam_version_id,
  '10000000-0000-4000-8000-000000000027',
  'withdrawn',
  pa.id,
  '{}'::jsonb,
  repeat('de', 32),
  'checkbox',
  greatest(clock_timestamp(), pa.recorded_at + interval '1 millisecond')
from examination_room_v1.privacy_acceptances pa
join examination_room_v1.student_sessions ss on ss.id = pa.session_id
where ss.consent_request_hash = repeat('6', 64)
  and pa.decision = 'accepted'
order by pa.recorded_at desc
limit 1;

select is(
  public.examination_room_v1_api(
    'student',
    'heartbeat',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32),
      'requestHash', repeat('df', 32),
      'clientEventId', '10000000-0000-4000-8000-000000000028',
      'occurredAt', clock_timestamp(),
      'connected', true,
      'currentQuestion', 1
    )
  )->>'errorCode',
  'PRIVACY_CONSENT_REQUIRED',
  'consent withdrawal stops further heartbeat and monitoring data writes'
);

update examination_room_v1.student_sessions
set session_status = 'revoked', ended_at = coalesce(ended_at, clock_timestamp())
where consent_request_hash = repeat('6', 64);

select is(
  public.examination_room_v1_api(
    'student',
    'result',
    null,
    null,
    jsonb_build_object(
      'sessionId', (
        select id from examination_room_v1.student_sessions
        where consent_request_hash = repeat('6', 64)
      ),
      'sessionTokenHash', repeat('c4', 32)
    )
  )->>'errorCode',
  'SESSION_REVOKED',
  'a revoked session verifier cannot retrieve a released result'
);

select is(
  public.examination_room_v1_api(
    'admin',
    'create_snapshot',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'requestHash', repeat('e', 64),
      'scope', 'full_recovery',
      'requestedAt', clock_timestamp()
    )
  ) #>> '{snapshot,status}',
  'pending',
  'admin snapshot creates a durable pending handoff for encrypted object materialization'
);

select ok(
  (
    select count(*) = count(distinct rs.snapshot_sequence)
    from examination_room_v1.recovery_snapshots rs
    where rs.exam_id = '10000000-0000-4000-8000-000000000004'
  ),
  'all snapshot-producing paths allocate distinct per-exam sequences through the advisory-lock allocator'
);

select ok(
  not exists (
    select 1
    from examination_room_v1.audit_events a
    where a.event_hash = a.request_hash
  ),
  'audit event hashes bind canonical event content and chain predecessor instead of reusing request fingerprints'
);

select is(
  public.examination_room_v1_api(
    'professor',
    'close_room',
    '10000000-0000-4000-8000-000000000002',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'requestHash', repeat('f', 64),
      'closedAt', clock_timestamp()
    )
  )->>'status',
  'closed',
  'professor close_room closes active room and session state atomically'
);

select is(
  public.examination_room_v1_api(
    'admin',
    'revoke_key',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'examId', '10000000-0000-4000-8000-000000000004',
      'requestHash', repeat('0f', 32),
      'reason', 'Functional test completed.',
      'revokedAt', clock_timestamp()
    )
  )->>'ok',
  'true',
  'administrator revocation remains safe and idempotent after room closure'
);

select is(
  jsonb_array_length(
    public.examination_room_v1_owner_query(
      'exam_detail',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000004',
      '{}'::jsonb
    ) #> '{bundle,tables,questions}'
  ),
  1,
  'the owner examination bundle includes every published question'
);

select ok(
  jsonb_array_length(
    public.examination_room_v1_owner_query(
      'exam_detail',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000004',
      '{}'::jsonb
    ) #> '{bundle,tables,answerRevisions}'
  ) >= 1,
  'the owner examination bundle includes student answer revision history'
);

select ok(
  jsonb_array_length(
    public.examination_room_v1_owner_query(
      'exam_detail',
      '10000000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000004',
      '{}'::jsonb
    ) #> '{bundle,tables,gradeRevisions}'
  ) >= 1,
  'the owner examination bundle includes the complete grade revision history'
);

with snapshot_page_fixture as (
  select
    series,
    examination_room_v1.jsonb_sha256(jsonb_build_object('pagingSnapshot', series)) as request_hash,
    (select coalesce(max(snapshot.snapshot_sequence), 0)
     from examination_room_v1.recovery_snapshots snapshot
     where snapshot.exam_id = '10000000-0000-4000-8000-000000000004') + series as snapshot_sequence
  from generate_series(1, 101) series
)
insert into examination_room_v1.recovery_snapshots (
  id, exam_id, exam_version_id, snapshot_sequence, snapshot_scope,
  request_hash, record_count, snapshot_status, created_by_user_id,
  retention_until, source_kind
)
select
  examination_room_v1.uuid_from_hash(fixture.request_hash),
  '10000000-0000-4000-8000-000000000004',
  (select exam.current_published_version_id
   from examination_room_v1.exams exam
   where exam.id = '10000000-0000-4000-8000-000000000004'),
  fixture.snapshot_sequence,
  'full_recovery',
  fixture.request_hash,
  0,
  'pending',
  '10000000-0000-4000-8000-000000000003',
  clock_timestamp() + interval '365 days',
  'manual'
from snapshot_page_fixture fixture;

select ok(
  not exists (
    select 1
    from jsonb_array_elements(
      public.examination_room_v1_owner_query(
        'recovery_detail',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        jsonb_build_object('limit', 100, 'offset', 0)
      ) -> 'snapshots'
    ) listed
    where listed ->> 'id' = examination_room_v1.uuid_from_hash(
      examination_room_v1.jsonb_sha256(jsonb_build_object('pagingSnapshot', 1))
    )::text
  )
  and public.examination_room_v1_owner_query(
    'recovery_detail',
    '10000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000004',
    jsonb_build_object(
      'snapshotId', examination_room_v1.uuid_from_hash(
        examination_room_v1.jsonb_sha256(jsonb_build_object('pagingSnapshot', 1))
      ),
      'limit', 100,
      'offset', 0
    )
  ) #>> '{snapshots,0,id}' = examination_room_v1.uuid_from_hash(
    examination_room_v1.jsonb_sha256(jsonb_build_object('pagingSnapshot', 1))
  )::text,
  'exact recovery lookup retrieves a checkpoint older than the first 100-row page'
);

select ok(
  (
    select count(*) = 1
      and bool_and(snapshot.source_kind = 'result_release')
      and bool_and(snapshot.request_hash = repeat('c', 64))
    from examination_room_v1.recovery_snapshots snapshot
    where snapshot.exam_id = '10000000-0000-4000-8000-000000000004'
      and snapshot.source_kind in ('grade_revision', 'result_release')
  ),
  'an atomic result-release batch queues one exact recovery event without per-student amplification'
);

select * from finish();
rollback;
