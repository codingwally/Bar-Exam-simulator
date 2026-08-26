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

    create table auth.users (
      id uuid primary key,
      instance_id uuid,
      aud text,
      role text,
      email text not null unique,
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

  assert.equal(
    Number(await scalar(database, `
      select count(*)
      from pg_catalog.pg_class table_record
      join pg_catalog.pg_namespace schema_record on schema_record.oid = table_record.relnamespace
      where schema_record.nspname = 'examination_room_v1'
        and table_record.relkind in ('r', 'p')
    `)),
    26,
    'the complete greenfield migration creates the expected table set',
  );

  await database.exec(`
    insert into auth.users (id, email, raw_user_meta_data) values
      ('10000000-0000-0000-0000-000000000001', 'admin-a@example.invalid', '{"full_name":"Administrator A"}'),
      ('10000000-0000-0000-0000-000000000002', 'admin-b@example.invalid', '{"full_name":"Administrator B"}'),
      ('10000000-0000-0000-0000-000000000003', 'professor-one@example.invalid', '{"full_name":"Professor One"}'),
      ('10000000-0000-0000-0000-000000000004', 'professor-two@example.invalid', '{"full_name":"Professor Two"}'),
      ('10000000-0000-0000-0000-000000000005', 'student@example.invalid', '{"full_name":"Student Account"}');

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
    'any verified signed-in account can enumerate active examination-creator workspaces',
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

  console.log(
    `Examination Room database validation passed: full migration, ${plannedAssertions}-assertion database suite, plus targeted signed-in creator, exact-owner, platform-owner, and upgrade checks.`,
  );
} finally {
  await database.close();
}
