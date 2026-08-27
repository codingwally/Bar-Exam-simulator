import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..');
const migrationPaths = [
  '20260825183055_examination_room_v1_greenfield.sql',
  '20260826130536_examination_room_owner_command_center.sql',
  '20260827010000_examination_room_open_admission_flow.sql',
  '20260827020000_examination_room_result_email_delivery.sql',
  '20260827190036_examination_room_key_delivery_nullable_creator.sql',
  '20260827193000_examination_room_lifecycle_controls.sql',
  '20260828123000_examination_room_recorded_media.sql',
  '20260828124000_examination_room_immediate_key_access.sql',
].map((filename) => join(repositoryRoot, 'supabase', 'migrations', filename));
const databaseTestPath = join(
  repositoryRoot,
  'supabase',
  'tests',
  'database',
  'examination_room_v1_greenfield_test.sql',
);
const pgliteVersion = '0.5.7';

function candidateModules() {
  const candidates = [];
  if (process.env.EXAMINATION_ROOM_PGLITE_MODULE) {
    candidates.push(resolve(process.env.EXAMINATION_ROOM_PGLITE_MODULE));
  }
  candidates.push(join(
    tmpdir(),
    `duediligence-examination-room-pglite-${pgliteVersion}`,
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'index.js',
  ));
  for (const entry of readdirSync(tmpdir(), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('codex-examroom-pglite-')) continue;
    candidates.push(join(
      tmpdir(),
      entry.name,
      'node_modules',
      '@electric-sql',
      'pglite',
      'dist',
      'index.js',
    ));
  }
  return candidates;
}

function resolvePgliteModule() {
  const existing = candidateModules().find((candidate) => existsSync(candidate));
  if (existing) return existing;

  const installRoot = join(tmpdir(), `duediligence-examination-room-pglite-${pgliteVersion}`);
  mkdirSync(installRoot, { recursive: true });
  const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmExecutable, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--prefix',
    installRoot,
    `@electric-sql/pglite@${pgliteVersion}`,
  ], { stdio: 'inherit' });
  const installed = candidateModules().find((candidate) => existsSync(candidate));
  if (!installed) throw new Error('Pinned PGlite installation completed without a loadable module.');
  return installed;
}

async function scalar(database, sql, params = []) {
  const result = await database.query(sql, params);
  const firstRow = result.rows[0];
  return firstRow ? Object.values(firstRow)[0] : undefined;
}

function repeatHex(pair) {
  return pair.repeat(32);
}

async function expectDatabaseError(action, pattern, label) {
  let error;
  try {
    await action();
  } catch (caught) {
    error = caught;
  }
  assert(error, `${label}: expected a database error`);
  assert.match(error.message, pattern, label);
}

const pgTapCompatibilityHarness = `
  create schema if not exists extensions authorization postgres;
  create table if not exists extensions.local_pgtap_state (
    singleton boolean primary key default true check (singleton),
    planned integer,
    executed integer not null default 0,
    failures text[] not null default '{}'::text[]
  );
  insert into extensions.local_pgtap_state (singleton)
  values (true)
  on conflict (singleton) do nothing;

  create or replace function extensions.local_pgtap_record(
    p_passed boolean,
    p_description text,
    p_detail text default null
  )
  returns text
  language plpgsql
  as $$
  declare
    assertion_number integer;
  begin
    update extensions.local_pgtap_state
    set executed = executed + 1,
        failures = case when coalesce(p_passed, false)
          then failures
          else array_append(failures, coalesce(p_description, 'unnamed assertion') || coalesce(': ' || p_detail, ''))
        end
    where singleton
    returning executed into assertion_number;
    return case when coalesce(p_passed, false) then 'ok ' else 'not ok ' end
      || assertion_number::text || ' - ' || coalesce(p_description, 'unnamed assertion');
  end;
  $$;

  create or replace function extensions.plan(p_count integer)
  returns text
  language plpgsql
  as $$
  begin
    update extensions.local_pgtap_state
    set planned = p_count, executed = 0, failures = '{}'::text[]
    where singleton;
    return '1..' || p_count::text;
  end;
  $$;

  create or replace function extensions.ok(p_value boolean, p_description text)
  returns text
  language sql
  as $$
    select extensions.local_pgtap_record(p_value, p_description);
  $$;

  create or replace function extensions.is(
    p_actual anycompatible,
    p_expected anycompatible,
    p_description text
  )
  returns text
  language sql
  as $$
    select extensions.local_pgtap_record(
      p_actual is not distinct from p_expected,
      p_description,
      'actual=' || coalesce(p_actual::text, 'NULL') || ', expected=' || coalesce(p_expected::text, 'NULL')
    );
  $$;

  create or replace function extensions.has_schema(p_schema text, p_description text)
  returns text
  language sql
  as $$
    select extensions.local_pgtap_record(
      exists (select 1 from pg_catalog.pg_namespace where nspname = p_schema),
      p_description,
      'schema=' || p_schema
    );
  $$;

  create or replace function extensions.has_column(
    p_schema text,
    p_table text,
    p_column text,
    p_description text
  )
  returns text
  language sql
  as $$
    select extensions.local_pgtap_record(
      exists (
        select 1 from information_schema.columns
        where table_schema = p_schema and table_name = p_table and column_name = p_column
      ),
      p_description,
      p_schema || '.' || p_table || '.' || p_column
    );
  $$;

  create or replace function extensions.tables_are(
    p_schema text,
    p_expected text[],
    p_description text
  )
  returns text
  language plpgsql
  as $$
  declare
    actual_tables text[];
    expected_tables text[];
  begin
    select coalesce(array_agg(table_record.relname::text order by table_record.relname::text), '{}'::text[])
    into actual_tables
    from pg_catalog.pg_class table_record
    join pg_catalog.pg_namespace schema_record on schema_record.oid = table_record.relnamespace
    where schema_record.nspname = p_schema and table_record.relkind in ('r', 'p');
    select coalesce(array_agg(item order by item), '{}'::text[])
    into expected_tables
    from unnest(p_expected) item;
    return extensions.local_pgtap_record(
      actual_tables = expected_tables,
      p_description,
      'actual=' || actual_tables::text || ', expected=' || expected_tables::text
    );
  end;
  $$;

  create or replace function extensions.set_eq(
    p_query text,
    p_expected text[],
    p_description text
  )
  returns text
  language plpgsql
  as $$
  declare
    actual_values text[];
    expected_values text[];
  begin
    execute format(
      'select coalesce(array_agg(distinct value order by value), ARRAY[]::text[]) from (%s) result(value)',
      p_query
    ) into actual_values;
    select coalesce(array_agg(distinct item order by item), '{}'::text[])
    into expected_values
    from unnest(p_expected) item;
    return extensions.local_pgtap_record(
      actual_values = expected_values,
      p_description,
      'actual=' || actual_values::text || ', expected=' || expected_values::text
    );
  end;
  $$;

  create or replace function extensions.lives_ok(p_query text, p_description text)
  returns text
  language plpgsql
  as $$
  begin
    execute p_query;
    return extensions.local_pgtap_record(true, p_description);
  exception when others then
    return extensions.local_pgtap_record(false, p_description, sqlstate || ': ' || sqlerrm);
  end;
  $$;

  create or replace function extensions.throws_ok(
    p_query text,
    p_expected_state text,
    p_expected_message text,
    p_description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute p_query;
    return extensions.local_pgtap_record(false, p_description, 'statement did not throw');
  exception when others then
    return extensions.local_pgtap_record(
      sqlstate = p_expected_state and sqlerrm = p_expected_message,
      p_description,
      'state=' || sqlstate || ', message=' || sqlerrm
    );
  end;
  $$;

  create or replace function extensions.throws_like(
    p_query text,
    p_expected_pattern text,
    p_description text
  )
  returns text
  language plpgsql
  as $$
  begin
    execute p_query;
    return extensions.local_pgtap_record(false, p_description, 'statement did not throw');
  exception when others then
    return extensions.local_pgtap_record(
      sqlerrm like p_expected_pattern,
      p_description,
      'message=' || sqlerrm
    );
  end;
  $$;

  create or replace function extensions.finish()
  returns setof text
  language plpgsql
  as $$
  declare
    state_record extensions.local_pgtap_state%rowtype;
  begin
    select * into state_record from extensions.local_pgtap_state where singleton;
    if state_record.planned is distinct from state_record.executed
       or cardinality(state_record.failures) > 0 then
      raise exception 'local pgTAP failure: planned %, executed %, failures %',
        state_record.planned, state_record.executed, state_record.failures;
    end if;
    return next 'ok - ' || state_record.executed::text || ' assertions';
  end;
  $$;
`;

const modulePath = resolvePgliteModule();
const { PGlite } = await import(pathToFileURL(modulePath).href);
const database = new PGlite();
await database.waitReady;

try {
  const databaseTestSql = readFileSync(databaseTestPath, 'utf8');
  const plannedAssertions = Number(databaseTestSql.match(/select\s+plan\((\d+)\)/iu)?.[1]);
  const declaredAssertions = [...databaseTestSql.matchAll(/^select\s+([a-z_][a-z0-9_]*)\s*\(/gimu)]
    .map((match) => match[1].toLowerCase())
    .filter((name) => name !== 'plan' && name !== 'finish').length;
  assert.equal(
    plannedAssertions,
    declaredAssertions,
    'the pgTAP plan matches the number of declared top-level assertions',
  );

  await database.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth authorization postgres;
    create schema storage authorization postgres;

    create table storage.buckets (
      id text primary key,
      name text not null unique,
      public boolean not null default false,
      file_size_limit bigint,
      allowed_mime_types text[]
    );

    create table storage.objects (
      id uuid primary key default gen_random_uuid(),
      bucket_id text not null references storage.buckets(id),
      name text not null,
      metadata jsonb not null default '{}'::jsonb
    );

    create table auth.users (
      id uuid primary key,
      instance_id uuid,
      aud text,
      role text,
      email text unique,
      raw_app_meta_data jsonb not null default '{}'::jsonb,
      raw_user_meta_data jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      is_sso_user boolean not null default false,
      is_anonymous boolean not null default false
    );

    create table public.profiles (
      id uuid primary key references auth.users(id) on delete cascade,
      display_name text,
      law_school_id text,
      law_school_other text,
      school text,
      commercial_category text,
      commercial_onboarding_completed_at timestamptz
    );

    create table public.professor_license_declarations (
      user_id uuid primary key references auth.users(id) on delete cascade,
      license_number text not null check (char_length(btrim(license_number)) between 3 and 80),
      declaration_version text not null default 'professor-declaration-v1-2026-08-18',
      declared_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.user_roles (
      user_id uuid primary key references auth.users(id) on delete cascade,
      role text not null default 'student'
        check (role in ('student', 'admin', 'founder_admin', 'super_admin')),
      assigned_by uuid references auth.users(id),
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );

    create table public.local_role_admins (
      user_id uuid primary key
    );

    create function public.admin_has_capability(p_actor_user_id uuid, p_capability text)
    returns boolean
    language sql
    stable
    security definer
    set search_path = pg_catalog
    as $$
      select p_capability = 'role_admin'
        and (
          exists (
            select 1 from public.local_role_admins role_admin
            where role_admin.user_id = p_actor_user_id
          )
          or exists (
            select 1 from public.user_roles platform_role
            where platform_role.user_id = p_actor_user_id
              and platform_role.role in ('founder_admin', 'super_admin')
          )
        );
    $$;

    create function public.handle_local_auth_user()
    returns trigger
    language plpgsql
    security definer
    set search_path = pg_catalog
    as $$
    begin
      insert into public.profiles (id, display_name)
      values (
        new.id,
        coalesce(
          nullif(new.raw_user_meta_data ->> 'full_name', ''),
          nullif(new.raw_user_meta_data ->> 'name', '')
        )
      )
      on conflict (id) do nothing;

      insert into public.user_roles (user_id, role)
      values (new.id, 'student')
      on conflict (user_id) do nothing;

      return new;
    end;
    $$;

    create trigger on_auth_user_created_local_validation
      after insert on auth.users
      for each row
      execute function public.handle_local_auth_user();
  `);

  await database.exec(readFileSync(migrationPaths[0], 'utf8'));

  // Upgrade fixture: production can already contain a fully materialized
  // recovery row from the greenfield release. The owner-command-center
  // migration must backfill its new availability timestamp before validating
  // the stricter state-machine constraint.
  await database.exec(`
    insert into examination_room_v1.institutions (
      id, institution_code, profile_school_id, institution_name,
      bootstrap_request_hash, created_by_user_id
    ) values (
      '90000000-0000-4000-8000-000000000001', 'upgrade-fixture',
      'upgrade-fixture', 'Upgrade Fixture Law School', repeat('9', 64),
      '90000000-0000-4000-8000-000000000002'
    );

    insert into examination_room_v1.staff_memberships (
      id, institution_id, user_id, staff_role, display_name,
      email_normalized, grant_reason, granted_by_user_id
    ) values (
      '90000000-0000-4000-8000-000000000003',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'professor', 'Upgrade Professor', 'upgrade@example.invalid',
      'Upgrade-path validation fixture.',
      '90000000-0000-4000-8000-000000000002'
    );

    insert into examination_room_v1.privacy_notice_versions (
      id, institution_id, notice_code, version_number, title, notice_body,
      body_sha256, effective_at, created_by_user_id
    ) values (
      '90000000-0000-4000-8000-000000000004',
      '90000000-0000-4000-8000-000000000001',
      'upgrade-warning', 1, 'Upgrade warning', 'Upgrade fixture warning.',
      repeat('8', 64), clock_timestamp(),
      '90000000-0000-4000-8000-000000000002'
    );

    insert into examination_room_v1.exams (
      id, institution_id, owner_user_id, title
    ) values (
      '90000000-0000-4000-8000-000000000005',
      '90000000-0000-4000-8000-000000000001',
      '90000000-0000-4000-8000-000000000002',
      'Upgrade Recovery Fixture'
    );

    insert into examination_room_v1.exam_versions (
      id, exam_id, institution_id, version_number, title_snapshot,
      duration_seconds, privacy_notice_version_id, content_sha256
    ) values (
      '90000000-0000-4000-8000-000000000006',
      '90000000-0000-4000-8000-000000000005',
      '90000000-0000-4000-8000-000000000001', 1,
      'Upgrade Recovery Fixture', 3600,
      '90000000-0000-4000-8000-000000000004', repeat('7', 64)
    );

    insert into examination_room_v1.recovery_snapshots (
      id, exam_id, exam_version_id, snapshot_sequence, snapshot_scope,
      request_hash, encrypted_object_reference, snapshot_sha256,
      encryption_key_reference, record_count, snapshot_status,
      created_by_user_id, retention_until
    ) values (
      '90000000-0000-4000-8000-000000000007',
      '90000000-0000-4000-8000-000000000005',
      '90000000-0000-4000-8000-000000000006', 1, 'full_recovery',
      repeat('6', 64), 'r2://upgrade-fixture/recovery.enc', repeat('5', 64),
      'upgrade-key-v1', 1, 'available',
      '90000000-0000-4000-8000-000000000002',
      clock_timestamp() + interval '30 days'
    );
  `);

  await database.exec(readFileSync(migrationPaths[1], 'utf8'));
  assert.equal(
    await scalar(database, `
      select available_at is not null
      from examination_room_v1.recovery_snapshots
      where id = '90000000-0000-4000-8000-000000000007'
    `),
    true,
    'the owner migration upgrades an existing available recovery snapshot',
  );

  await database.exec(`
    set session_replication_role = replica;
    delete from examination_room_v1.recovery_snapshots where id = '90000000-0000-4000-8000-000000000007';
    delete from examination_room_v1.exam_versions where id = '90000000-0000-4000-8000-000000000006';
    delete from examination_room_v1.exams where id = '90000000-0000-4000-8000-000000000005';
    delete from examination_room_v1.privacy_notice_versions where id = '90000000-0000-4000-8000-000000000004';
    delete from examination_room_v1.staff_memberships where id = '90000000-0000-4000-8000-000000000003';
    delete from examination_room_v1.institutions where id = '90000000-0000-4000-8000-000000000001';
    set session_replication_role = origin;
  `);

  await database.exec(readFileSync(migrationPaths[2], 'utf8'));
  await database.exec(readFileSync(migrationPaths[3], 'utf8'));
  await database.exec(readFileSync(migrationPaths[4], 'utf8'));
  await database.exec(readFileSync(migrationPaths[5], 'utf8'));

  assert.equal(
    Number(await scalar(database, `
      select count(*)
      from pg_catalog.pg_class table_record
      join pg_catalog.pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'examination_room_v1'
        and table_record.relkind in ('r', 'p')
    `)),
    27,
    'the complete greenfield migration creates the expected table set',
  );

  await database.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('10000000-0000-0000-0000-000000000001', 'admin-a@example.invalid', '{"full_name":"Administrator A"}'),
      ('10000000-0000-0000-0000-000000000002', 'admin-b@example.invalid', '{"full_name":"Administrator B"}'),
      ('10000000-0000-0000-0000-000000000003', 'professor-one@example.invalid', '{"full_name":"Professor One"}'),
      ('10000000-0000-0000-0000-000000000004', 'professor-two@example.invalid', '{"full_name":"Professor Two"}'),
      ('10000000-0000-0000-0000-000000000005', 'student@example.invalid', '{"full_name":"Student Account"}'),
      ('10000000-0000-0000-0000-000000000006', 'ordinary-member@example.invalid', '{"full_name":"Ordinary Member"}');

    insert into public.profiles (
      id, display_name, law_school_id, school, commercial_category
    ) values
      ('10000000-0000-0000-0000-000000000001', 'Administrator A', 'school-a', 'School A', 'professor'),
      ('10000000-0000-0000-0000-000000000002', 'Administrator B', 'school-b', 'School B', 'professor'),
      ('10000000-0000-0000-0000-000000000003', 'Professor One', 'school-a', 'School A', 'professor'),
      ('10000000-0000-0000-0000-000000000004', 'Professor Two', 'school-a', 'School A', 'professor'),
      ('10000000-0000-0000-0000-000000000005', 'Student Account', 'school-a', 'School A', 'first_year')
    on conflict (id) do update set
      display_name = excluded.display_name,
      law_school_id = excluded.law_school_id,
      school = excluded.school,
      commercial_category = excluded.commercial_category;

    insert into public.professor_license_declarations (user_id, license_number) values
      ('10000000-0000-0000-0000-000000000003', 'DECLARATION-ONE'),
      ('10000000-0000-0000-0000-000000000004', 'DECLARATION-TWO');

    insert into public.local_role_admins (user_id) values
      ('10000000-0000-0000-0000-000000000001'),
      ('10000000-0000-0000-0000-000000000002');

    insert into examination_room_v1.institutions (
      id, institution_code, profile_school_id, institution_name,
      bootstrap_request_hash, created_by_user_id
    ) values
      (
        '20000000-0000-0000-0000-000000000001', 'school-a', 'school-a', 'School A',
        repeat('a', 64), '10000000-0000-0000-0000-000000000001'
      ),
      (
        '20000000-0000-0000-0000-000000000002', 'school-b', 'school-b', 'School B',
        repeat('b', 64), '10000000-0000-0000-0000-000000000002'
      );

    insert into examination_room_v1.staff_memberships (
      institution_id, user_id, staff_role, display_name, email_normalized,
      membership_status, grant_reason, granted_by_user_id
    ) values
      (
        '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000001',
        'admin', 'Administrator A', 'admin-a@example.invalid', 'active',
        'Disposable local validation administrator.',
        '10000000-0000-0000-0000-000000000001'
      ),
      (
        '20000000-0000-0000-0000-000000000002',
        '10000000-0000-0000-0000-000000000002',
        'admin', 'Administrator B', 'admin-b@example.invalid', 'active',
        'Disposable local validation administrator.',
        '10000000-0000-0000-0000-000000000002'
      );
  `);

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_authorize_staff(
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'admin'
      )
    `),
    true,
    'an active institution administrator with platform Role admin is authorized',
  );
  await database.exec(`
    delete from public.local_role_admins
    where user_id = '10000000-0000-0000-0000-000000000001';
  `);
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_authorize_staff(
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        'admin'
      )
    `),
    false,
    'removing platform Role admin immediately invalidates a stale institution-admin membership',
  );
  await database.exec(`
    insert into public.local_role_admins (user_id)
    values ('10000000-0000-0000-0000-000000000001');
  `);

  assert.equal(
    Number(await scalar(database, `
      select jsonb_array_length(
        public.examination_room_v1_professor_access(
          'status', '10000000-0000-0000-0000-000000000005', '{}'::jsonb
        ) -> 'availableInstitutions'
      )
    `)),
    2,
    'a verified account sees the community workspace and its profile-matched school without seeing unrelated schools',
  );

  assert.equal(
    await scalar(database, `
      select not exists (
        select 1
        from jsonb_array_elements(
          public.examination_room_v1_staff_context(
            '10000000-0000-0000-0000-000000000005'
          ) -> 'creatorWorkspaces'
        ) workspace
        where workspace ->> 'institutionCode' = 'school-b'
      )
    `),
    true,
    'an unrelated law-school workspace is not exposed to a signed-in creator',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_professor_access(
        'request',
        '10000000-0000-0000-0000-000000000003',
        '{"institutionId":"not-a-uuid"}'::jsonb
      ) ->> 'errorCode'
    `),
    'CREATOR_WORKSPACE_INVALID',
    'a malformed explicit creator workspace fails closed',
  );
  assert.equal(
    Number(await scalar(database, `
      select count(*) from examination_room_v1.professor_access_requests
      where user_id = '10000000-0000-0000-0000-000000000003'
    `)),
    0,
    'the creator bridge never creates a Professor approval request',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_professor_access(
        'request',
        '10000000-0000-0000-0000-000000000005',
        '{"institutionId":"20000000-0000-0000-0000-000000000001"}'::jsonb
      ) ->> 'alreadyActive'
    `),
    'true',
    'workspace selection is immediately available to every verified signed-in creator',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_staff_context(
        '10000000-0000-0000-0000-000000000005'
      ) ->> 'creatorAuthorized'
    `),
    'true',
    'creator authorization does not depend on a Professor profile or declaration',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'session',
        '10000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000001',
        '{}'::jsonb
      ) #>> '{professor,authorized}'
    `),
    'true',
    'a signed-in non-Professor creator can open the familiar Professor workspace',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'session',
        '10000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000001',
        '{}'::jsonb
      ) #>> '{professor,displayName}'
    `),
    'Student Account',
    'creator identity falls back to the verified account profile without a staff row',
  );

  await database.exec(`
    insert into examination_room_v1.exams (
      id, institution_id, owner_user_id, title
    ) values (
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000005',
      'Signed-in Creator Ownership Probe'
    );

    update public.user_roles
    set role = 'admin', updated_at = clock_timestamp()
    where user_id = '10000000-0000-0000-0000-000000000001';
  `);

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'exam',
        '10000000-0000-0000-0000-000000000005',
        '20000000-0000-0000-0000-000000000001',
        '{"examId":"30000000-0000-4000-8000-000000000001"}'::jsonb
      ) #>> '{exam,id}'
    `),
    '30000000-0000-4000-8000-000000000001',
    'the exact signed-in creator can read the examination they own',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'exam',
        '10000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000001',
        '{"examId":"30000000-0000-4000-8000-000000000001"}'::jsonb
      ) ->> 'errorCode'
    `),
    'FORBIDDEN',
    'another signed-in creator cannot cross the immutable examination-owner boundary',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'exam',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '{"examId":"30000000-0000-4000-8000-000000000001"}'::jsonb
      ) ->> 'errorCode'
    `),
    'FORBIDDEN',
    'an ordinary institution admin with role_admin capability cannot inspect another creator examination',
  );

  await database.exec(`
    update public.user_roles
    set role = 'founder_admin', updated_at = clock_timestamp()
    where user_id = '10000000-0000-0000-0000-000000000001';
  `);
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'exam',
        '10000000-0000-0000-0000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '{"examId":"30000000-0000-4000-8000-000000000001"}'::jsonb
      ) #>> '{exam,id}'
    `),
    '30000000-0000-4000-8000-000000000001',
    'only an exact Founder or Super Admin may cross the examination-owner boundary for testing',
  );

  await database.exec(`
    update public.profiles
    set commercial_category = 'first_year'
    where id = '10000000-0000-0000-0000-000000000003';
  `);
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'session',
        '10000000-0000-0000-0000-000000000003',
        '20000000-0000-0000-0000-000000000001',
        '{}'::jsonb
      ) ->> 'ok'
    `),
    'true',
    'changing away from the legacy Professor profile does not revoke creator access',
  );

  await database.exec(pgTapCompatibilityHarness);
  let runnablePgTapSql = databaseTestSql.replace(
    /^create extension if not exists pgtap with schema extensions;\s*$/imu,
    '-- Local PGlite validation uses the compatibility harness installed above.',
  );
  await database.exec(runnablePgTapSql);
  await database.exec(readFileSync(migrationPaths[6], 'utf8'));

  // Upgrade fixtures prove that the additive migration opens only usable,
  // non-expired scheduled keys. Blocked and archived examinations retain their
  // lifecycle denial even when an older node issued a scheduled activation.
  await database.exec(`
    insert into examination_room_v1.privacy_notice_versions (
      id, institution_id, notice_code, version_number, title, notice_body,
      body_sha256, effective_at, created_by_user_id
    ) values (
      '91000000-0000-4000-8000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      'immediate-key-upgrade', 1, 'Immediate key upgrade',
      'Immediate key migration fixture.', repeat('1', 64), clock_timestamp(),
      '10000000-0000-0000-0000-000000000001'
    );

    insert into examination_room_v1.exams (
      id, institution_id, owner_user_id, title
    ) values
      (
        '91000000-0000-4000-8000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000005',
        'Usable scheduled upgrade fixture'
      ),
      (
        '91000000-0000-4000-8000-000000000002',
        '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000005',
        'Blocked scheduled upgrade fixture'
      ),
      (
        '91000000-0000-4000-8000-000000000003',
        '20000000-0000-0000-0000-000000000001',
        '10000000-0000-0000-0000-000000000005',
        'Archived scheduled upgrade fixture'
      );

    insert into examination_room_v1.exam_versions (
      id, exam_id, institution_id, version_number, title_snapshot,
      duration_seconds, privacy_notice_version_id, content_sha256,
      publication_status, published_by_user_id, published_at, publication_manifest
    ) values
      (
        '91000000-0000-4000-8000-000000000011',
        '91000000-0000-4000-8000-000000000001',
        '20000000-0000-0000-0000-000000000001', 1,
        'Usable scheduled upgrade fixture', 3600,
        '91000000-0000-4000-8000-000000000004', repeat('2', 64),
        'published', '10000000-0000-0000-0000-000000000001', clock_timestamp(),
        '{"schemaVersion":"examination-room/publication/v1"}'::jsonb
      ),
      (
        '91000000-0000-4000-8000-000000000012',
        '91000000-0000-4000-8000-000000000002',
        '20000000-0000-0000-0000-000000000001', 1,
        'Blocked scheduled upgrade fixture', 3600,
        '91000000-0000-4000-8000-000000000004', repeat('3', 64),
        'published', '10000000-0000-0000-0000-000000000001', clock_timestamp(),
        '{"schemaVersion":"examination-room/publication/v1"}'::jsonb
      ),
      (
        '91000000-0000-4000-8000-000000000013',
        '91000000-0000-4000-8000-000000000003',
        '20000000-0000-0000-0000-000000000001', 1,
        'Archived scheduled upgrade fixture', 3600,
        '91000000-0000-4000-8000-000000000004', repeat('4', 64),
        'published', '10000000-0000-0000-0000-000000000001', clock_timestamp(),
        '{"schemaVersion":"examination-room/publication/v1"}'::jsonb
      );

    update examination_room_v1.exams exam
    set current_published_version_id = case exam.id
      when '91000000-0000-4000-8000-000000000001'::uuid then '91000000-0000-4000-8000-000000000011'::uuid
      when '91000000-0000-4000-8000-000000000002'::uuid then '91000000-0000-4000-8000-000000000012'::uuid
      when '91000000-0000-4000-8000-000000000003'::uuid then '91000000-0000-4000-8000-000000000013'::uuid
    end,
        status = case
          when exam.id = '91000000-0000-4000-8000-000000000003'::uuid then 'archived'
          else 'published'
        end,
        blocked_at = case
          when exam.id = '91000000-0000-4000-8000-000000000002'::uuid then clock_timestamp()
          else null
        end,
        blocked_by_user_id = case
          when exam.id = '91000000-0000-4000-8000-000000000002'::uuid
            then '10000000-0000-0000-0000-000000000001'::uuid
          else null
        end,
        block_reason = case
          when exam.id = '91000000-0000-4000-8000-000000000002'::uuid
            then 'Upgrade denial fixture.'
          else null
        end,
        archived_at = case
          when exam.id = '91000000-0000-4000-8000-000000000003'::uuid then clock_timestamp()
          else null
        end
    where exam.id in (
      '91000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000003'
    );

    insert into examination_room_v1.room_activations (
      id, exam_id, institution_id, exam_version_id, key_hash,
      key_hash_algorithm, request_hash, activation_status,
      opens_at, closes_at, activated_by_user_id
    ) values
      (
        '91000000-0000-4000-8000-000000000021',
        '91000000-0000-4000-8000-000000000001',
        '20000000-0000-0000-0000-000000000001',
        '91000000-0000-4000-8000-000000000011', repeat('5', 64),
        'hmac-sha256-v1', repeat('6', 64), 'scheduled',
        clock_timestamp() + interval '2 hours', clock_timestamp() + interval '1 day',
        '10000000-0000-0000-0000-000000000001'
      ),
      (
        '91000000-0000-4000-8000-000000000022',
        '91000000-0000-4000-8000-000000000002',
        '20000000-0000-0000-0000-000000000001',
        '91000000-0000-4000-8000-000000000012', repeat('7', 64),
        'hmac-sha256-v1', repeat('8', 64), 'scheduled',
        clock_timestamp() + interval '2 hours', clock_timestamp() + interval '1 day',
        '10000000-0000-0000-0000-000000000001'
      ),
      (
        '91000000-0000-4000-8000-000000000023',
        '91000000-0000-4000-8000-000000000003',
        '20000000-0000-0000-0000-000000000001',
        '91000000-0000-4000-8000-000000000013', repeat('9', 64),
        'hmac-sha256-v1', repeat('a', 64), 'scheduled',
        clock_timestamp() + interval '2 hours', clock_timestamp() + interval '1 day',
        '10000000-0000-0000-0000-000000000001'
      );
  `);
  await database.exec(readFileSync(migrationPaths[7], 'utf8'));

  assert.equal(
    await scalar(database, `
      select activation_status = 'open' and opens_at <= clock_timestamp()
      from examination_room_v1.room_activations
      where id = '91000000-0000-4000-8000-000000000021'
    `),
    true,
    'the migration immediately opens a usable scheduled key issued by an older application node',
  );
  assert.equal(
    await scalar(database, `
      select activation_status
      from examination_room_v1.room_activations
      where id = '91000000-0000-4000-8000-000000000022'
    `),
    'scheduled',
    'the migration does not open a blocked examination activation',
  );
  assert.equal(
    await scalar(database, `
      select activation_status
      from examination_room_v1.room_activations
      where id = '91000000-0000-4000-8000-000000000023'
    `),
    'scheduled',
    'the migration does not open an archived examination activation',
  );

  await database.exec(`
    set session_replication_role = replica;
    delete from examination_room_v1.room_activations
    where id in (
      '91000000-0000-4000-8000-000000000021',
      '91000000-0000-4000-8000-000000000022',
      '91000000-0000-4000-8000-000000000023'
    );
    delete from examination_room_v1.exam_versions
    where id in (
      '91000000-0000-4000-8000-000000000011',
      '91000000-0000-4000-8000-000000000012',
      '91000000-0000-4000-8000-000000000013'
    );
    delete from examination_room_v1.exams
    where id in (
      '91000000-0000-4000-8000-000000000001',
      '91000000-0000-4000-8000-000000000002',
      '91000000-0000-4000-8000-000000000003'
    );
    delete from examination_room_v1.privacy_notice_versions
    where id = '91000000-0000-4000-8000-000000000004';
    set session_replication_role = origin;
  `);

  assert.equal(
    await scalar(database, `
      select exists (
        select 1
        from jsonb_array_elements(
          public.examination_room_v1_staff_context(
            '10000000-0000-0000-0000-000000000005'
          ) -> 'creatorWorkspaces'
        ) workspace
        where workspace ->> 'institutionCode' = 'due-diligence-community'
          and (workspace ->> 'active')::boolean
      )
    `),
    true,
    'every verified auth account receives the active Due Diligence Community workspace',
  );

  assert.equal(
    await scalar(database, `
      select user_role.role = 'student'
        and profile.commercial_category is null
        and not exists (
          select 1 from public.professor_license_declarations declaration
          where declaration.user_id = auth_user.id
        )
        and not exists (
          select 1 from examination_room_v1.staff_memberships membership
          where membership.user_id = auth_user.id
        )
      from auth.users auth_user
      join public.profiles profile on profile.id = auth_user.id
      join public.user_roles user_role on user_role.user_id = auth_user.id
      where auth_user.id = '10000000-0000-0000-0000-000000000006'
    `),
    true,
    'the open-admission fixture is an ordinary student-role account with no Professor category, license, or staff assignment',
  );
  assert.equal(
    Number(await scalar(database, `
      select jsonb_array_length(
        public.examination_room_v1_staff_context(
          '10000000-0000-0000-0000-000000000006'
        ) -> 'creatorWorkspaces'
      )
    `)),
    1,
    'an unassigned signed-in account receives exactly the shared Community creator workspace',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_staff_context(
        '10000000-0000-0000-0000-000000000006'
      ) #>> '{creatorWorkspaces,0,institutionCode}'
    `),
    'due-diligence-community',
    'the unassigned account Community fallback is deterministic',
  );
  assert.equal(
    await scalar(database, `
      select examination_room_v1.creator_authorized(
        '10000000-0000-0000-0000-000000000006',
        'ddc00000-0000-4000-8000-000000000001'
      )
    `),
    true,
    'an ordinary signed-in account is authorized in Community without Professor approval',
  );
  assert.equal(
    await scalar(database, `
      select examination_room_v1.creator_authorized(
        '10000000-0000-0000-0000-000000000006',
        '20000000-0000-0000-0000-000000000001'
      )
    `),
    false,
    'open Community admission does not expose an unrelated school workspace',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'session',
        '10000000-0000-0000-0000-000000000006',
        'ddc00000-0000-4000-8000-000000000001',
        '{}'::jsonb
      ) #>> '{professor,displayName}'
    `),
    'Ordinary Member',
    'the ordinary account opens the familiar Professor workspace with its verified identity',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'save_draft',
        '10000000-0000-0000-0000-000000000006',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'exam', jsonb_build_object(
            'examId', '30000000-0000-4000-8000-000000000030',
            'title', 'Ordinary Member Open Admission Proof',
            'subject', 'Remedial Law',
            'yearLevel', 'Practice group',
            'instructions', 'Answer the question.',
            'durationMinutes', 60,
            'startsAt', clock_timestamp(),
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'cameraRequired', false,
            'microphoneRequired', false,
            'privacyNoticeVersion', 'exam-room-v1',
            'admissionMode', 'key_only',
            'allowedEmails', '[]'::jsonb,
            'questions', '[]'::jsonb,
            'roster', '[]'::jsonb
          ),
          'draft', jsonb_build_object(
            'title', 'Ordinary Member Open Admission Proof',
            'subject', 'Remedial Law',
            'yearLevel', 'Practice group',
            'questions', '[]'::jsonb,
            'questionCount', 0,
            'totalPoints', 0
          ),
          'requestHash', repeat('f1', 32),
          'requestedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'draft',
    'an ordinary signed-in account creates and saves an exam without role, license, assignment, or roster upload',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'publish',
        '10000000-0000-0000-0000-000000000006',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'exam', jsonb_build_object(
            'examId', '30000000-0000-4000-8000-000000000030',
            'title', 'Ordinary Member Open Admission Proof',
            'subject', 'Remedial Law',
            'yearLevel', 'Practice group',
            'instructions', 'Answer the question.',
            'durationMinutes', 60,
            'startsAt', clock_timestamp(),
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'cameraRequired', false,
            'microphoneRequired', false,
            'privacyNoticeVersion', 'exam-room-v1',
            'admissionMode', 'key_only',
            'allowedEmails', '[]'::jsonb,
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain jurisdiction over the subject matter.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'roster', '[]'::jsonb
          ),
          'draft', jsonb_build_object(
            'title', 'Ordinary Member Open Admission Proof',
            'subject', 'Remedial Law',
            'yearLevel', 'Practice group',
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain jurisdiction over the subject matter.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'questionCount', 1,
            'totalPoints', 20
          ),
          'requestHash', repeat('f2', 32),
          'requestedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'published',
    'the same ordinary account publishes and requests a student key with no roster upload',
  );
  assert.equal(
    await scalar(database, `
      select exists (
        select 1
        from jsonb_array_elements(
          public.examination_room_v1_api(
            'admin',
            'overview',
            '10000000-0000-0000-0000-000000000001',
            'ddc00000-0000-4000-8000-000000000001',
            '{}'::jsonb
          ) -> 'exams'
        ) exam
        where exam ->> 'examId' = '30000000-0000-4000-8000-000000000030'
          and exam ->> 'status' = 'published'
          and exam -> 'activation' = 'null'::jsonb
      )
    `),
    true,
    'the ordinary creator publication appears in Admin as a final key request awaiting approval',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'publish',
        '10000000-0000-0000-0000-000000000005',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'exam', jsonb_build_object(
            'examId', '30000000-0000-4000-8000-000000000010',
            'title', 'Community Key Only Practice',
            'subject', 'Constitutional Law',
            'yearLevel', 'Second year',
            'instructions', 'Answer all questions.',
            'durationMinutes', 120,
            'startsAt', clock_timestamp(),
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'cameraRequired', false,
            'microphoneRequired', false,
            'privacyNoticeVersion', 'exam-room-v1',
            'admissionMode', 'key_only',
            'allowedEmails', '[]'::jsonb,
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain judicial review.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'roster', '[]'::jsonb
          ),
          'draft', jsonb_build_object(
            'title', 'Community Key Only Practice',
            'subject', 'Constitutional Law',
            'yearLevel', 'Second year',
            'instructions', 'Answer all questions.',
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'privacyNoticeVersion', 'exam-room-v1',
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain judicial review.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'questionCount', 1,
            'totalPoints', 20
          ),
          'requestHash', repeat('d1', 32),
          'requestedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'published',
    'a signed-in non-Professor creator publishes a key-only exam without a roster',
  );
  assert.equal(
    Number(await scalar(database, `
      select count(*) from examination_room_v1.exam_roster
      where exam_id = '30000000-0000-4000-8000-000000000010'
    `)),
    0,
    'key-only publication does not synthesize a roster before a student enters',
  );

  await database.exec(`
    update auth.users
    set email = null
    where id = '10000000-0000-0000-0000-000000000005';

    update examination_room_v1.staff_memberships
    set email_normalized = null
    where institution_id = 'ddc00000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000005';
  `);
  const nullableCreatorApproval = await scalar(database, `
    select public.examination_room_v1_api(
      'admin',
      'email_key',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'examId', '30000000-0000-4000-8000-000000000010',
        'requestHash', repeat('d2', 32),
        'roomKeyHash', repeat('d7', 32),
        'keyHashAlgorithm', 'hmac-sha256-v1',
        'opensAt', clock_timestamp() - interval '1 minute',
        'closesAt', clock_timestamp() + interval '1 day',
        'maxSessions', null,
        'replaceCurrent', false
      )
    )
  `);
  assert.equal(
    nullableCreatorApproval.ok,
    true,
    `a missing creator email never blocks key activation: ${JSON.stringify(nullableCreatorApproval)}`,
  );
  assert.equal(
    nullableCreatorApproval.activation.status,
    'open',
    'Admin approval returns an immediately open activation receipt',
  );
  assert.equal(nullableCreatorApproval.professorEmail, null, 'the activation response preserves a nullable creator email');
  assert.equal(
    await scalar(database, `
      select activation_status
      from examination_room_v1.room_activations
      where exam_id = '30000000-0000-4000-8000-000000000010'
    `),
    'open',
    'Admin approval persists the student key as open without a Professor action',
  );

  await database.exec(`
    update auth.users
    set email = 'student@example.invalid'
    where id = '10000000-0000-0000-0000-000000000005';

    update examination_room_v1.staff_memberships
    set email_normalized = 'student@example.invalid'
    where institution_id = 'ddc00000-0000-4000-8000-000000000001'
      and user_id = '10000000-0000-0000-0000-000000000005';

    do $approval_stress$
    declare
      iteration integer;
      result jsonb;
    begin
      for iteration in 1..100 loop
        result := public.examination_room_v1_api(
          'admin',
          'email_key',
          '10000000-0000-0000-0000-000000000001',
          'ddc00000-0000-4000-8000-000000000001',
          jsonb_build_object(
            'examId', '30000000-0000-4000-8000-000000000010',
            'requestHash', repeat('d2', 32),
            'roomKeyHash', repeat('d7', 32),
            'keyHashAlgorithm', 'hmac-sha256-v1',
            'opensAt', clock_timestamp() - interval '1 minute',
            'closesAt', clock_timestamp() + interval '1 day',
            'maxSessions', null,
            'replaceCurrent', false
          )
        );
        if result ->> 'ok' <> 'true' then
          raise exception 'approval stress failed at iteration %: %', iteration, result;
        end if;
      end loop;
    end;
    $approval_stress$;
  `);
  assert.equal(
    Number(await scalar(database, `
      select count(*)
      from examination_room_v1.room_activations
      where exam_id = '30000000-0000-4000-8000-000000000010'
    `)),
    1,
    '100 repeated approvals retain one idempotent activation',
  );
  assert.equal(
    await scalar(database, `
      select key_hash = repeat('d7', 32)
      from examination_room_v1.room_activations
      where exam_id = '30000000-0000-4000-8000-000000000010'
    `),
    true,
    'the original key verifier is unchanged after 100 exact approval retries',
  );
  const replayWithDifferentKey = await scalar(database, `
    select public.examination_room_v1_api(
        'admin',
        'email_key',
        '10000000-0000-0000-0000-000000000001',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'examId', '30000000-0000-4000-8000-000000000010',
          'requestHash', repeat('d2', 32),
          'roomKeyHash', repeat('d8', 32),
          'keyHashAlgorithm', 'hmac-sha256-v1',
          'opensAt', clock_timestamp() - interval '1 minute',
          'closesAt', clock_timestamp() + interval '1 day',
          'maxSessions', null,
          'replaceCurrent', false
        )
      )
    `);
  assert.equal(
    replayWithDifferentKey.errorCode,
    'ACTIVATION_REPLAY_REQUIRES_NEW_REQUEST',
    'a different verifier cannot silently replace an idempotent active key',
  );

  const activationId = await scalar(database, `
    select id
    from examination_room_v1.room_activations
    where exam_id = '30000000-0000-4000-8000-000000000010'
    order by created_at desc
    limit 1
  `);
  const failedNullableAudit = await scalar(database, `
    select public.examination_room_v1_owner_command(
      'record_email_delivery',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000010',
      jsonb_build_object(
        'activationId', '${activationId}',
        'requestHash', repeat('d9', 32),
        'deliveryKind', 'activation_key',
        'professorRecipient', null,
        'ownerCopyRecipients', jsonb_build_array('owner@duediligence.ph'),
        'providerStatus', 'failed',
        'providerId', null,
        'safeErrorCode', 'provider_503',
        'attemptedAt', clock_timestamp()
      )
    )
  `);
  assert.equal(failedNullableAudit.ok, true, 'owner delivery evidence accepts a nullable creator recipient');
  assert.equal(failedNullableAudit.providerStatus, 'failed');

  const sentNullableAudit = await scalar(database, `
    select public.examination_room_v1_owner_command(
      'record_email_delivery',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000010',
      jsonb_build_object(
        'activationId', '${activationId}',
        'requestHash', repeat('d9', 32),
        'deliveryKind', 'activation_key',
        'professorRecipient', null,
        'ownerCopyRecipients', jsonb_build_array('owner@duediligence.ph'),
        'providerStatus', 'sent',
        'providerId', 'provider-owner-only-1',
        'safeErrorCode', null,
        'attemptedAt', clock_timestamp()
      )
    )
  `);
  assert.equal(sentNullableAudit.ok, true, 'a nullable-recipient delivery retry upgrades durable evidence to sent');
  assert.equal(sentNullableAudit.providerStatus, 'sent');
  assert.equal(sentNullableAudit.providerId, 'provider-owner-only-1');
  assert.equal(
    Number(await scalar(database, `
      select count(*)
      from examination_room_v1.email_delivery_events
      where request_hash = repeat('d9', 32)
        and professor_recipient is null
        and provider_status = 'sent'
    `)),
    1,
    'nullable creator delivery evidence remains one idempotent owner-audit row',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student',
        'preview',
        null,
        null,
        jsonb_build_object(
          'roomKeyHash', repeat('d7', 32),
          'identity', jsonb_build_object(
            'realName', 'Open Key Student',
            'studentNumber', 'OPEN-1001',
            'subject', 'Any entered subject',
            'yearLevel', 'Any entered year'
          )
        )
      ) ->> 'ok'
    `),
    'true',
    'any student can preview immediately after Admin key approval without a Professor open-room action',
  );
  assert.equal(
    Number(await scalar(database, `
      select count(*) from examination_room_v1.exam_roster
      where exam_id = '30000000-0000-4000-8000-000000000010'
    `)),
    1,
    'the key-only preview atomically creates the student identity and exam roster row',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'open_room',
        '10000000-0000-0000-0000-000000000005',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'examId', '30000000-0000-4000-8000-000000000010',
          'requestHash', repeat('d3', 32),
          'openedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'open',
    'legacy open-room calls remain harmless and idempotent after immediate activation',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student',
        'consent',
        null,
        null,
        jsonb_build_object(
          'roomKeyHash', repeat('d7', 32),
          'identity', jsonb_build_object(
            'realName', 'Open Key Student',
            'studentNumber', 'OPEN-1001',
            'subject', 'Any entered subject',
            'yearLevel', 'Any entered year'
          ),
          'consent', jsonb_build_object(
            'noticeVersion', 'exam-room-v1',
            'accepted', true,
            'acceptedAt', clock_timestamp(),
            'recordingAccepted', false
          ),
          'clientEventId', '30000000-0000-4000-8000-000000000011',
          'requestHash', repeat('d4', 32),
          'sessionTokenHash', repeat('d5', 32),
          'clientInstanceId', '30000000-0000-4000-8000-000000000012'
        )
      ) ->> 'ok'
    `),
    'true',
    'student consent starts the dynamically enrolled session',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'revoke_session',
        '10000000-0000-0000-0000-000000000005',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'examId', '30000000-0000-4000-8000-000000000010',
          'sessionId', (
            select session.id
            from examination_room_v1.student_sessions session
            where session.exam_id = '30000000-0000-4000-8000-000000000010'
            limit 1
          ),
          'reason', 'Creator removed this session during monitoring.',
          'requestHash', repeat('d6', 32),
          'revokedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'revoked',
    'the creator can revoke a monitored session with an audit receipt',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student',
        'preview',
        null,
        null,
        jsonb_build_object(
          'roomKeyHash', repeat('d7', 32),
          'identity', jsonb_build_object(
            'realName', 'Open Key Student',
            'studentNumber', 'OPEN-1001',
            'subject', 'Any entered subject',
            'yearLevel', 'Any entered year'
          )
        )
      ) ->> 'errorCode'
    `),
    'SESSION_REVOKED',
    'a revoked session cannot re-enter the same activation',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'professor',
        'publish',
        '10000000-0000-0000-0000-000000000005',
        'ddc00000-0000-4000-8000-000000000001',
        jsonb_build_object(
          'exam', jsonb_build_object(
            'examId', '30000000-0000-4000-8000-000000000020',
            'title', 'Community Allowlist Practice',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'instructions', 'Answer all questions.',
            'durationMinutes', 90,
            'startsAt', clock_timestamp(),
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'cameraRequired', false,
            'microphoneRequired', false,
            'privacyNoticeVersion', 'exam-room-v1',
            'admissionMode', 'email_allowlist',
            'allowedEmails', jsonb_build_array('friend@example.com'),
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain obligations.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'roster', '[]'::jsonb
          ),
          'draft', jsonb_build_object(
            'title', 'Community Allowlist Practice',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'instructions', 'Answer all questions.',
            'identityMode', 'real_names',
            'integrityTier', 'standard',
            'privacyNoticeVersion', 'exam-room-v1',
            'questions', jsonb_build_array(jsonb_build_object(
              'questionNumber', 1,
              'questionKey', 'q001',
              'questionKind', 'essay',
              'type', 'essay',
              'prompt', 'Explain obligations.',
              'points', 20,
              'gradingGuidance', '',
              'wordLimit', 800,
              'choices', '[]'::jsonb,
              'correctOptionIndex', null,
              'acceptedAnswers', '[]'::jsonb
            )),
            'questionCount', 1,
            'totalPoints', 20
          ),
          'requestHash', repeat('e1', 32),
          'requestedAt', clock_timestamp()
        )
      ) ->> 'status'
    `),
    'published',
    'the optional email allowlist publishes without a pre-uploaded roster',
  );

  const allowlistImmediateActivation = await scalar(database, `
    select public.examination_room_v1_api(
      'admin',
      'activate_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      jsonb_build_object(
        'examId', '30000000-0000-4000-8000-000000000020',
        'requestHash', repeat('e2', 32),
        'roomKeyHash', repeat('e3', 32),
        'keyHashAlgorithm', 'hmac-sha256-v1',
        'maxSessions', null,
        'replaceCurrent', false
      )
    )
  `);
  assert.equal(
    allowlistImmediateActivation.ok,
    true,
    `Admin can issue a key without any date/time payload: ${JSON.stringify(allowlistImmediateActivation)}`,
  );
  assert.equal(
    allowlistImmediateActivation.activation.status,
    'open',
    'date-free Admin approval is the final room-opening step',
  );
  assert.equal(
    Date.parse(allowlistImmediateActivation.activation.expiresAt)
      > Date.now() + 170 * 24 * 60 * 60 * 1000,
    true,
    'a missing closing time receives the server recovery horizon instead of blocking approval',
  );

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student',
        'preview',
        null,
        null,
        jsonb_build_object(
          'roomKeyHash', repeat('e3', 32),
          'identity', jsonb_build_object(
            'realName', 'Unlisted Student',
            'studentNumber', 'LIST-1001',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'email', 'not-listed@example.com'
          )
        )
      ) ->> 'errorCode'
    `),
    'STUDENT_EMAIL_NOT_ALLOWED',
    'email allowlist mode rejects an unlisted address before creating a roster row',
  );
  assert.equal(
    await scalar(database, `
      select position(
        'friend@example.com' in public.examination_room_v1_api(
          'student',
          'preview',
          null,
          null,
          jsonb_build_object(
            'roomKeyHash', repeat('e3', 32),
            'identity', jsonb_build_object(
              'realName', 'Unlisted Student',
              'studentNumber', 'LIST-1001',
              'subject', 'Civil Law',
              'yearLevel', 'First year',
              'email', 'not-listed@example.com'
            )
          )
        )::text
      ) = 0
    `),
    true,
    'allowlist rejection never reveals the configured email list',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student',
        'preview',
        null,
        null,
        jsonb_build_object(
          'roomKeyHash', repeat('e3', 32),
          'identity', jsonb_build_object(
            'realName', 'Listed Student',
            'studentNumber', 'LIST-1002',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'email', 'FRIEND@example.com'
          )
        )
      ) ->> 'ok'
    `),
    'true',
    'allowlist entry accepts a normalized listed email and self-enrolls the student',
  );

  await database.exec(`
    insert into examination_room_v1.room_activations (
      id, exam_id, institution_id, exam_version_id, key_hash,
      key_hash_algorithm, request_hash, activation_status,
      opens_at, closes_at, max_sessions, activated_by_user_id
    ) values
      (
        '30000000-0000-4000-8000-000000000031',
        '30000000-0000-4000-8000-000000000020',
        'ddc00000-0000-4000-8000-000000000001',
        (select current_published_version_id from examination_room_v1.exams
         where id = '30000000-0000-4000-8000-000000000020'),
        repeat('e4', 32), 'hmac-sha256-v1', repeat('f4', 32), 'scheduled',
        clock_timestamp() + interval '2 hours', clock_timestamp() + interval '1 day',
        null, '10000000-0000-0000-0000-000000000001'
      ),
      (
        '30000000-0000-4000-8000-000000000032',
        '30000000-0000-4000-8000-000000000020',
        'ddc00000-0000-4000-8000-000000000001',
        (select current_published_version_id from examination_room_v1.exams
         where id = '30000000-0000-4000-8000-000000000020'),
        repeat('e5', 32), 'hmac-sha256-v1', repeat('f5', 32), 'closed',
        clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day',
        null, '10000000-0000-0000-0000-000000000001'
      ),
      (
        '30000000-0000-4000-8000-000000000033',
        '30000000-0000-4000-8000-000000000020',
        'ddc00000-0000-4000-8000-000000000001',
        (select current_published_version_id from examination_room_v1.exams
         where id = '30000000-0000-4000-8000-000000000020'),
        repeat('e6', 32), 'hmac-sha256-v1', repeat('f6', 32), 'revoked',
        clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 day',
        null, '10000000-0000-0000-0000-000000000001'
      ),
      (
        '30000000-0000-4000-8000-000000000034',
        '30000000-0000-4000-8000-000000000020',
        'ddc00000-0000-4000-8000-000000000001',
        (select current_published_version_id from examination_room_v1.exams
         where id = '30000000-0000-4000-8000-000000000020'),
        repeat('e7', 32), 'hmac-sha256-v1', repeat('f7', 32), 'open',
        clock_timestamp() - interval '2 days', clock_timestamp() - interval '1 day',
        null, '10000000-0000-0000-0000-000000000001'
      );
  `);

  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student', 'preview', null, null,
        jsonb_build_object(
          'roomKeyHash', repeat('e4', 32),
          'identity', jsonb_build_object(
            'realName', 'Rolling Release Student',
            'studentNumber', 'LIST-ROLLING-1',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'email', 'friend@example.com'
          )
        )
      ) ->> 'ok'
    `),
    'true',
    'an older scheduled key opens itself during a rolling release without a Professor action',
  );
  assert.equal(
    await scalar(database, `
      select activation_status = 'open' and opens_at <= clock_timestamp()
      from examination_room_v1.room_activations
      where id = '30000000-0000-4000-8000-000000000031'
    `),
    true,
    'rolling-release compatibility promotes only the selected non-expired scheduled key',
  );

  for (const [keyHash, state] of [
    [repeatHex('e5'), 'closed'],
    [repeatHex('e6'), 'revoked'],
    [repeatHex('e7'), 'expired'],
  ]) {
    assert.equal(
      await scalar(database, `
        select public.examination_room_v1_api(
          'student', 'preview', null, null,
          jsonb_build_object(
            'roomKeyHash', '${keyHash}',
            'identity', jsonb_build_object(
              'realName', 'Denied Key Student',
              'studentNumber', 'DENIED-${state.toUpperCase()}',
              'subject', 'Civil Law',
              'yearLevel', 'First year',
              'email', 'friend@example.com'
            )
          )
        ) ->> 'errorCode'
      `),
      'ROOM_KEY_INVALID',
      `${state} activation keys remain denied`,
    );
  }

  await database.exec(`
    insert into examination_room_v1.student_sessions (
      id, activation_id, exam_id, institution_id, exam_version_id, roster_id,
      session_token_hash, consent_request_hash, client_instance_id,
      session_status, started_at, lease_expires_at, ended_at
    ) values (
      '30000000-0000-4000-8000-000000000021',
      (select activation.id from examination_room_v1.room_activations activation
       where activation.exam_id = '30000000-0000-4000-8000-000000000020'
         and activation.key_hash = repeat('e3', 32)
       limit 1),
      '30000000-0000-4000-8000-000000000020',
      'ddc00000-0000-4000-8000-000000000001',
      (select exam.current_published_version_id from examination_room_v1.exams exam
       where exam.id = '30000000-0000-4000-8000-000000000020'),
      (select roster.id
       from examination_room_v1.exam_roster roster
       join examination_room_v1.student_identities identity on identity.id = roster.student_identity_id
       where roster.exam_id = '30000000-0000-4000-8000-000000000020'
         and identity.external_student_id = 'LIST-1002'),
      repeat('a1', 32), repeat('a2', 32),
      '30000000-0000-4000-8000-000000000025',
      'submitted', clock_timestamp() - interval '1 hour',
      clock_timestamp() + interval '1 hour', clock_timestamp()
    );

    insert into examination_room_v1.submissions (
      id, session_id, exam_version_id, idempotency_key_hash, manifest_sha256,
      submission_manifest, answer_count, submitted_at_client
    ) values (
      '30000000-0000-4000-8000-000000000022',
      '30000000-0000-4000-8000-000000000021',
      (select exam.current_published_version_id from examination_room_v1.exams exam
       where exam.id = '30000000-0000-4000-8000-000000000020'),
      repeat('a3', 32), repeat('a4', 32),
      jsonb_build_object('schemaVersion', 'examination-room/submission/v1'),
      0, clock_timestamp()
    );

    insert into examination_room_v1.grade_revisions (
      id, submission_id, exam_version_id, revision_number, client_revision_id,
      manifest_sha256, grading_manifest, grader_user_id, source, grade_status,
      item_count, total_score, maximum_score, general_feedback
    ) values (
      '30000000-0000-4000-8000-000000000023',
      '30000000-0000-4000-8000-000000000022',
      (select exam.current_published_version_id from examination_room_v1.exams exam
       where exam.id = '30000000-0000-4000-8000-000000000020'),
      1, '30000000-0000-4000-8000-000000000026', repeat('a5', 32),
      jsonb_build_object('schemaVersion', 'examination-room/grading/v1'),
      '10000000-0000-0000-0000-000000000005', 'online', 'final',
      1, 18, 20, 'Released result email database proof.'
    );

    insert into examination_room_v1.grade_revision_items (
      grade_revision_id, exam_version_id, question_id, score, maximum_score, feedback
    ) values (
      '30000000-0000-4000-8000-000000000023',
      (select exam.current_published_version_id from examination_room_v1.exams exam
       where exam.id = '30000000-0000-4000-8000-000000000020'),
      (select question.id
       from examination_room_v1.questions question
       join examination_room_v1.exams exam on exam.current_published_version_id = question.exam_version_id
       where exam.id = '30000000-0000-4000-8000-000000000020'
       order by question.position limit 1),
      18, 20, 'Strong analysis.'
    );

    insert into examination_room_v1.result_releases (
      id, submission_id, grade_revision_id, release_action, channel,
      idempotency_key_hash, batch_request_hash, manifest_sha256,
      release_manifest, performed_by_user_id
    ) values (
      '30000000-0000-4000-8000-000000000024',
      '30000000-0000-4000-8000-000000000022',
      '30000000-0000-4000-8000-000000000023', 'release', 'student_portal',
      repeat('a6', 32), repeat('a7', 32), repeat('a8', 32),
      jsonb_build_object(
        'schemaVersion', 'examination-room/result-release/v1',
        'releaseId', '30000000-0000-4000-8000-000000000024'
      ),
      '10000000-0000-0000-0000-000000000005'
    );
  `);

  const firstResultEmailClaim = await scalar(database, `
    select public.examination_room_v1_claim_result_email_deliveries(
      '10000000-0000-0000-0000-000000000005',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      repeat('a7', 32),
      jsonb_build_array(jsonb_build_object(
        'releaseId', '30000000-0000-4000-8000-000000000024',
        'sessionId', '30000000-0000-4000-8000-000000000021'
      )),
      300
    )
  `);
  assert.equal(firstResultEmailClaim.ok, true, 'a released result creates a durable email claim');
  assert.equal(firstResultEmailClaim.items[0].shouldSend, true, 'the first result-email claim owns the provider attempt');
  assert.equal(firstResultEmailClaim.items[0].recipient, 'friend@example.com', 'the outbox uses the canonical normalized student email');
  assert.equal(firstResultEmailClaim.items[0].totalScore, 18, 'the outbox carries the canonical released score');

  const completedResultEmail = await scalar(database, `
    select public.examination_room_v1_complete_result_email_deliveries(
      (select claim_token from examination_room_v1.result_email_delivery_events
       where release_id = '30000000-0000-4000-8000-000000000024'),
      jsonb_build_array(jsonb_build_object(
        'releaseId', '30000000-0000-4000-8000-000000000024',
        'status', 'sent',
        'providerId', 'provider-result-db-proof',
        'safeErrorCode', null
      ))
    )
  `);
  assert.equal(completedResultEmail.ok, true, 'the provider result is durably completed');
  assert.equal(completedResultEmail.items[0].status, 'sent', 'provider acceptance is terminal');
  assert.equal(completedResultEmail.items[0].providerId, 'provider-result-db-proof', 'provider evidence remains retrievable');

  const replayedResultEmailClaim = await scalar(database, `
    select public.examination_room_v1_claim_result_email_deliveries(
      '10000000-0000-0000-0000-000000000005',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      repeat('a7', 32),
      jsonb_build_array(jsonb_build_object(
        'releaseId', '30000000-0000-4000-8000-000000000024',
        'sessionId', '30000000-0000-4000-8000-000000000021'
      )),
      300
    )
  `);
  assert.equal(replayedResultEmailClaim.items[0].shouldSend, false, 'a sent result is never reclaimed for duplicate delivery');
  assert.equal(replayedResultEmailClaim.items[0].status, 'sent', 'a retry receives the persisted provider status');
  assert.equal(replayedResultEmailClaim.items[0].providerId, 'provider-result-db-proof', 'a retry receives the original provider id');

  assert.equal(
    await scalar(database, `
      select examination_room_v1.owner_exam_bundle(
        '30000000-0000-4000-8000-000000000020'
      ) #>> '{tables,resultEmailDeliveryEvents,0,provider_id}'
    `),
    'provider-result-db-proof',
    'the owner exam bundle includes exact per-student result-email evidence',
  );

  const reservedMedia = await scalar(database, `
    select public.examination_room_v1_media(
      'reserve',
      jsonb_build_object(
        'sessionId', '30000000-0000-4000-8000-000000000021',
        'sessionTokenHash', repeat('a1', 32),
        'clientArtifactId', '30000000-0000-4000-8000-000000000027',
        'requestHash', repeat('b1', 32),
        'artifactKind', 'camera_chunk',
        'sourceMimeType', 'video/webm;codecs=vp8,opus',
        'encryptedSizeBytes', 1024,
        'objectSha256', repeat('b2', 32),
        'capturedFrom', clock_timestamp() - interval '1 minute',
        'capturedTo', clock_timestamp(),
        'retentionUntil', clock_timestamp() + interval '30 days',
        'provider', 'supabase_storage',
        'providerObjectReference', 'exam-media/session-21/artifact-27.enc',
        'keyEnvelope', jsonb_build_object(
          'algorithm', 'aes-256-gcm-v1',
          'keyVersion', 1,
          'ciphertext', repeat('A', 43),
          'iv', repeat('B', 16),
          'aadSha256', repeat('b3', 32)
        )
      )
    )
  `);
  assert.equal(reservedMedia.ok, true, `recorded media reservation succeeds: ${JSON.stringify(reservedMedia)}`);
  assert.equal(reservedMedia.status, 'prepared');
  assert.equal(reservedMedia.provider, 'supabase_storage');

  const completedMedia = await scalar(database, `
    select public.examination_room_v1_media(
      'complete',
      jsonb_build_object(
        'sessionId', '30000000-0000-4000-8000-000000000021',
        'sessionTokenHash', repeat('a1', 32),
        'clientArtifactId', '30000000-0000-4000-8000-000000000027',
        'requestHash', repeat('b4', 32),
        'provider', 'supabase_storage',
        'providerObjectReference', 'exam-media/session-21/artifact-27.enc',
        'objectSha256', repeat('b2', 32),
        'encryptedSizeBytes', 1024,
        'providerVerified', true,
        'providerResult', jsonb_build_object('etag', 'local-database-proof', 'size', 1024),
        'completedAt', clock_timestamp()
      )
    )
  `);
  assert.equal(completedMedia.ok, true, `recorded media completion succeeds: ${JSON.stringify(completedMedia)}`);
  assert.equal(completedMedia.status, 'completed');
  assert.equal(
    Number(await scalar(database, `
      select count(*)
      from examination_room_v1.proctoring_artifacts artifact
      join examination_room_v1.media_upload_intents intent on intent.artifact_id = artifact.id
      where intent.client_artifact_id = '30000000-0000-4000-8000-000000000027'
        and artifact.encrypted_object_reference = 'exam-media/session-21/artifact-27.enc'
        and intent.intent_status = 'completed'
    `)),
    1,
    'a completed encrypted recording is registered exactly once without storing media bytes',
  );

  const blockedLifecycle = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'block_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      jsonb_build_object(
        'requestHash', repeat('c1', 32),
        'reason', 'Owner paused new admissions for a live reliability review.'
      )
    )
  `);
  assert.equal(blockedLifecycle.ok, true, 'the platform owner can block new student admission');
  assert.equal(blockedLifecycle.existingAnswersPreserved, true);
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_lifecycle_guard(
        '30000000-0000-4000-8000-000000000020'
      ) ->> 'errorCode'
    `),
    'EXAMINATION_BLOCKED',
    'a blocked room rejects only new admission through the lifecycle guard',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student', 'preview', null, null,
        jsonb_build_object(
          'roomKeyHash', repeat('e3', 32),
          'identity', jsonb_build_object(
            'realName', 'Blocked Admission Student',
            'studentNumber', 'BLOCKED-1001',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'email', 'friend@example.com'
          )
        )
      ) ->> 'errorCode'
    `),
    'EXAMINATION_BLOCKED',
    'the keyed student path itself enforces the owner block before creating a roster row',
  );
  assert.equal(
    Number(await scalar(database, `
      select count(*) from examination_room_v1.submissions
      where id = '30000000-0000-4000-8000-000000000022'
    `)),
    1,
    'blocking the room preserves the submitted answer record',
  );

  const unblockedLifecycle = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'unblock_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      jsonb_build_object('requestHash', repeat('c2', 32), 'reason', 'Owner review completed.')
    )
  `);
  assert.equal(unblockedLifecycle.ok, true, 'the platform owner can unblock the same room');

  const archivedLifecycle = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'archive_exam',
      '10000000-0000-0000-0000-000000000005',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      jsonb_build_object('requestHash', repeat('c3', 32), 'reason', 'Creator archived the completed class.')
    )
  `);
  assert.equal(archivedLifecycle.ok, true, 'the signed-in creator can archive an owned published examination');
  assert.equal(archivedLifecycle.recoverable, true);
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_lifecycle_guard(
        '30000000-0000-4000-8000-000000000020'
      ) ->> 'errorCode'
    `),
    'EXAMINATION_ARCHIVED',
    'an archived room no longer accepts a student key',
  );
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_api(
        'student', 'preview', null, null,
        jsonb_build_object(
          'roomKeyHash', repeat('e3', 32),
          'identity', jsonb_build_object(
            'realName', 'Archived Admission Student',
            'studentNumber', 'ARCHIVED-1001',
            'subject', 'Civil Law',
            'yearLevel', 'First year',
            'email', 'friend@example.com'
          )
        )
      ) ->> 'errorCode'
    `),
    'EXAMINATION_ARCHIVED',
    'the keyed student path returns the archived lifecycle denial even after its activation closes',
  );

  const restoredLifecycle = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'restore_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      jsonb_build_object('requestHash', repeat('c4', 32), 'reason', 'Owner restored the complete examination record.')
    )
  `);
  assert.equal(restoredLifecycle.ok, true, 'the platform owner can restore an archived examination');
  assert.equal(restoredLifecycle.status, 'closed');
  assert.equal(restoredLifecycle.needsNewKey, true);

  const reopenedLifecycle = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'reopen_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000020',
      jsonb_build_object('requestHash', repeat('c5', 32), 'reason', 'Owner reopened the exam for a new class and key.')
    )
  `);
  assert.equal(reopenedLifecycle.ok, true, 'the platform owner can reopen a restored published examination');
  assert.equal(reopenedLifecycle.nextAction, 'issue_and_email_key');
  assert.equal(
    await scalar(database, `
      select public.examination_room_v1_lifecycle_query(
        '10000000-0000-0000-0000-000000000001',
        'ddc00000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000020'
      ) #>> '{items,0,status}'
    `),
    'published',
    'the owner command center immediately sees the reopened lifecycle state',
  );

  await database.exec(`
    insert into examination_room_v1.exams (
      id, institution_id, owner_user_id, title
    ) values (
      '30000000-0000-4000-8000-000000000099',
      'ddc00000-0000-4000-8000-000000000001',
      '10000000-0000-0000-0000-000000000006',
      'Recoverable Creator Draft'
    );
  `);
  const deletedDraft = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'delete_draft',
      '10000000-0000-0000-0000-000000000006',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000099',
      jsonb_build_object('requestHash', repeat('c6', 32), 'reason', 'Creator removed this unused draft.')
    )
  `);
  assert.equal(deletedDraft.ok, true, 'any signed-in creator can delete an unpublished owned draft');
  assert.equal(deletedDraft.recoverable, true, 'creator deletion remains recoverable to the platform owner');
  const restoredDraft = await scalar(database, `
    select public.examination_room_v1_lifecycle_command(
      'restore_exam',
      '10000000-0000-0000-0000-000000000001',
      'ddc00000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000099',
      jsonb_build_object('requestHash', repeat('c7', 32), 'reason', 'Owner restored the creator draft after review.')
    )
  `);
  assert.equal(restoredDraft.ok, true, 'the platform owner can restore a creator-deleted draft');
  assert.equal(restoredDraft.status, 'draft');

  console.log(
    `Examination Room database validation passed: all eight additive migrations, ${plannedAssertions}-assertion database suite, plus immediate Admin key activation, date-free approval, rolling scheduled-key compatibility, community creator, roster-free publication, 100-approval idempotency, open admission, allowlist, revoked/closed/expired denial, lifecycle recovery, encrypted media, exact-owner, platform-owner, and upgrade checks.`,
  );
} finally {
  await database.close();
}
