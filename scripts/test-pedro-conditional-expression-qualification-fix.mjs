import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  join,
  resolve,
} from 'node:path';
import { pathToFileURL } from 'node:url';

const originalPath = new URL(
  '../supabase/migrations/20260827143000_pedro_private_study_inbox.sql',
  import.meta.url,
);
const fixPath = new URL(
  '../supabase/migrations/20260828132000_pedro_conditional_expression_qualification_fix.sql',
  import.meta.url,
);
const original = readFileSync(originalPath, 'utf8').replace(/\r\n/g, '\n');
const fix = readFileSync(fixPath, 'utf8').replace(/\r\n/g, '\n');

const invalidLeast = 'pg_catalog.least(';
const invalidGreatest = 'pg_catalog.greatest(';
const countToken = (source, token) => source.split(token).length - 1;

assert.equal(countToken(original, invalidLeast), 5);
assert.equal(countToken(original, invalidGreatest), 6);
// Each forbidden token appears once only as a quoted postflight search needle.
assert.equal(countToken(fix, invalidLeast), 1);
assert.equal(countToken(fix, invalidGreatest), 1);
assert.equal((fix.match(/^begin;$/gmu) || []).length, 1);
assert.equal((fix.match(/^commit;$/gmu) || []).length, 1);

function extractDefinition(source, start, next) {
  const startAt = source.indexOf(start);
  const endAt = source.indexOf(next, startAt + start.length);
  assert.notEqual(startAt, -1, `Missing function start: ${start}`);
  assert.notEqual(endAt, -1, `Missing function boundary: ${next}`);
  return source.slice(startAt, endAt).trim();
}

const functionSpecs = [
  {
    start: 'create or replace function public.pedro_reserve_turn(',
    originalNext:
      'create or replace function public.pedro_search_published_content(',
    fixNext:
      'create or replace function public.pedro_search_published_content(',
    signature: 'public.pedro_reserve_turn(uuid, uuid, text, text)',
  },
  {
    start: 'create or replace function public.pedro_search_published_content(',
    originalNext: 'create or replace function public.pedro_complete_turn(',
    fixNext: 'create or replace function public.pedro_history(',
    signature:
      'public.pedro_search_published_content(uuid, uuid, integer, text[], integer)',
  },
  {
    start: 'create or replace function public.pedro_history(',
    originalNext:
      'create or replace function public.subject_matter_target_question(',
    fixNext: 'revoke all on function public.pedro_reserve_turn(',
    signature:
      'public.pedro_history(uuid, uuid, integer, timestamptz, uuid)',
  },
];

for (const spec of functionSpecs) {
  const originalDefinition = extractDefinition(
    original,
    spec.start,
    spec.originalNext,
  );
  const fixedDefinition = extractDefinition(fix, spec.start, spec.fixNext);
  const expectedDefinition = originalDefinition
    .replaceAll(invalidLeast, 'least(')
    .replaceAll(invalidGreatest, 'greatest(');

  assert.equal(
    fixedDefinition,
    expectedDefinition,
    `${spec.signature} must differ only by removing invalid qualification`,
  );
  assert.match(
    fix,
    new RegExp(
      `revoke all on function ${spec.signature.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')}[\\s\\S]*from public, anon, authenticated;`,
      'u',
    ),
  );
  assert.match(
    fix,
    new RegExp(
      `grant execute on function ${spec.signature.replace(/[.*+?^$\{\}()|[\]\\]/g, '\\$&')}[\\s\\S]*to service_role;`,
      'u',
    ),
  );
}

assert.match(fix, /pg_get_functiondef/u);
assert.match(fix, /function_record\.prosecdef/u);
assert.match(fix, /search_path=""/u);
assert.match(fix, /has_function_privilege\('anon'/u);
assert.match(fix, /has_function_privilege\(\s*'authenticated'/u);
assert.match(fix, /has_function_privilege\(\s*'service_role'/u);

const runtimeRoot = mkdtempSync(join(tmpdir(), 'pedro-pglite-runtime-'));
const expectedParent = resolve(tmpdir());
const resolvedRuntimeRoot = resolve(runtimeRoot);
assert.equal(dirname(resolvedRuntimeRoot), expectedParent);
assert.match(basename(resolvedRuntimeRoot), /^pedro-pglite-runtime-/u);

let database;
try {
  const npmExecutable = process.platform === 'win32' ? process.execPath : 'npm';
  const npmArguments = process.platform === 'win32'
    ? [
        join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      ]
    : [];
  execFileSync(
    npmExecutable,
    [
      ...npmArguments,
      'install',
      '--prefix',
      resolvedRuntimeRoot,
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--package-lock=false',
      '--no-save',
      '@electric-sql/pglite@0.5.7',
    ],
    {
      stdio: 'pipe',
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024,
    },
  );

  const pglitePath = join(
    resolvedRuntimeRoot,
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'index.js',
  );
  const pgcryptoPath = join(
    resolvedRuntimeRoot,
    'node_modules',
    '@electric-sql',
    'pglite',
    'dist',
    'contrib',
    'pgcrypto.js',
  );
  const { PGlite } = await import(pathToFileURL(pglitePath).href);
  const { pgcrypto } = await import(pathToFileURL(pgcryptoPath).href);
  database = new PGlite({ extensions: { pgcrypto } });
  await database.waitReady;

  const baseline = String.raw`
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create schema extensions;
create schema supabase_migrations;
create extension if not exists pgcrypto with schema extensions;

create table supabase_migrations.schema_migrations (
  version text primary key,
  statements text[],
  name text
);
insert into supabase_migrations.schema_migrations(version, statements, name)
values ('20260827133000', array[]::text[], 'require_historical_examination_track');

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
  display_name text
);

create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('student','professor','admin','founder_admin','super_admin'))
);

create or replace function public.release2_fixture_handle_user()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  insert into public.profiles(id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  insert into public.user_roles(user_id, role) values (new.id, 'student');
  return new;
end;
$$;

create trigger release2_fixture_handle_user
after insert on auth.users
for each row execute function public.release2_fixture_handle_user();

create table public.platform_access_settings (
  singleton boolean primary key check (singleton),
  current_terms_version text not null,
  current_privacy_version text not null
);
insert into public.platform_access_settings
values (true, 'release2-test-terms', 'release2-test-privacy');

create table public.terms_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  terms_version text not null,
  privacy_version text not null,
  acceptance_source text not null,
  unique(user_id, terms_version, privacy_version)
);

create table public.plan_catalog (
  plan_code text primary key
);
insert into public.plan_catalog values ('standard');

create table public.subscriptions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plan_catalog(plan_code),
  status text not null,
  starts_at timestamptz,
  expires_at timestamptz,
  source text not null,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  reason text,
  version integer not null default 1
);
create unique index subscriptions_one_live_per_user_idx
on public.subscriptions(user_id)
where status in ('trialing','pending_payment','active','paused');

create table public.payment_requests (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_code text not null references public.plan_catalog(plan_code),
  trusted_amount_php numeric(10,2) not null,
  payment_method text not null,
  payment_date date not null,
  transaction_reference text not null,
  reference_normalized text generated always as (lower(btrim(transaction_reference))) stored,
  student_note text,
  proof_object_path text not null unique,
  proof_original_name text not null,
  proof_mime_type text not null,
  proof_size_bytes integer not null,
  proof_sha256 text not null,
  status text not null,
  request_key text not null unique,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id),
  review_reason text,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

create table public.dd2026_content_items (
  id text primary key,
  content_type text not null,
  subject text not null,
  title text not null,
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.dd2026_content_versions (
  id uuid primary key,
  content_id text not null references public.dd2026_content_items(id) on delete cascade,
  revision integer not null,
  source_version text not null,
  source_status text not null,
  payload jsonb not null,
  checksum text not null,
  lifecycle_state text not null,
  ai_prepared_beta boolean not null default true,
  author_user_id uuid references auth.users(id),
  editor_user_id uuid references auth.users(id),
  reviewer_user_id uuid references auth.users(id),
  publisher_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  submitted_for_review_at timestamptz,
  reviewed_at timestamptz,
  published_at timestamptz,
  archived_at timestamptz,
  unique(content_id, revision),
  unique(content_id, checksum)
);
alter table public.dd2026_content_items
add constraint dd2026_content_items_current_published_version_fkey
foreign key(current_published_version_id)
references public.dd2026_content_versions(id)
on delete set null deferrable initially deferred;

create table public.examination_definitions (
  id uuid primary key,
  track text,
  assessment_kind text,
  status text,
  active_version_id uuid,
  title text,
  subject text
);
create table public.examination_versions (
  id uuid primary key,
  exam_id uuid references public.examination_definitions(id),
  status text,
  question_count integer,
  duration_seconds integer,
  default_timer_mode text,
  allowed_timer_modes text[],
  instructions text,
  grading_route text,
  answer_release_rule text
);
alter table public.examination_definitions
add constraint examination_definitions_active_version_fkey
foreign key(active_version_id) references public.examination_versions(id)
deferrable initially deferred;

create table public.examination_questions (
  id uuid primary key,
  source_type text,
  review_status text,
  publication_ready boolean,
  topic text,
  subject text,
  doctrine text
);
create table public.examination_version_questions (
  version_id uuid references public.examination_versions(id) on delete cascade,
  question_id uuid references public.examination_questions(id) on delete cascade,
  primary key(version_id, question_id)
);
create table public.subject_matter_placements (
  exam_id uuid references public.examination_definitions(id) on delete cascade,
  question_id uuid references public.examination_questions(id) on delete cascade,
  course_name text,
  year_level integer,
  term integer,
  primary key(exam_id, question_id)
);
create table public.examination_attempts_multi (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  version_id uuid references public.examination_versions(id),
  status text,
  submitted_at timestamptz,
  started_at timestamptz default now(),
  subject_matter_skipped_at timestamptz
);
create table public.examination_responses (
  attempt_id uuid references public.examination_attempts_multi(id) on delete cascade,
  question_id uuid references public.examination_questions(id),
  answer_text text,
  primary key(attempt_id, question_id)
);
create table public.subject_matter_cycles (
  user_id uuid references auth.users(id) on delete cascade,
  subject text,
  year_level integer,
  term integer,
  seen_question_ids uuid[] not null default '{}',
  active_version_id uuid,
  updated_at timestamptz not null default now(),
  primary key(user_id, subject, year_level, term)
);
create or replace function public.examination_authorize_access(
  p_user_id uuid,
  p_track text,
  p_version_id uuid,
  p_attempt_id uuid,
  p_activate_trial boolean
)
returns void language plpgsql security definer set search_path = ''
as $$ begin return; end; $$;

create table public.forum_profile_avatars (
  user_id uuid primary key references auth.users(id) on delete cascade,
  object_path text not null unique,
  mime_type text not null,
  byte_size integer not null,
  width integer not null,
  height integer not null,
  crop_x numeric not null default 0.5,
  crop_y numeric not null default 0.5,
  updated_at timestamptz not null default now()
);

create or replace function public.forum_assert_member(p_user_id uuid)
returns void language plpgsql stable security definer set search_path = ''
as $$
begin
  if p_user_id is null
     or not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'FORUM_AUTHENTICATION_REQUIRED';
  end if;
end;
$$;

create or replace function public.forum_set_profile_avatar(
  p_user_id uuid,
  p_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
begin
  perform public.forum_assert_member(p_user_id);
  return jsonb_build_object('updated', false);
end;
$$;
revoke all on function public.forum_set_profile_avatar(uuid,jsonb)
from public, anon, authenticated;
grant execute on function public.forum_set_profile_avatar(uuid,jsonb)
to service_role;
`;

  await database.exec(baseline);
  await database.exec(original);
  await database.exec(fix);

  const runtimeUserId = 'b2723000-0000-4000-8000-000000000001';
  await database.query(
    `insert into auth.users (
       id, instance_id, aud, role, email, raw_app_meta_data,
       raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
     ) values (
       $1::uuid, '00000000-0000-0000-0000-000000000000'::uuid,
       'authenticated', 'authenticated', 'pedro-fix-runtime@example.invalid',
       '{}'::jsonb, '{"full_name":"Pedro fix runtime"}'::jsonb,
       now(), now(), false, false
     )`,
    [runtimeUserId],
  );
  await database.query(
    `update public.user_roles
     set role = 'founder_admin'
     where user_id = $1::uuid`,
    [runtimeUserId],
  );
  await database.query(
    `insert into public.terms_acceptances (
       user_id, terms_version, privacy_version, acceptance_source
     ) values (
       $1::uuid, 'release2-test-terms', 'release2-test-privacy', 'runtime_test'
     )`,
    [runtimeUserId],
  );

  const reservedResult = await database.query(
    `select public.pedro_reserve_turn(
       $1::uuid, null, 'pedrofixruntime001', 'Explain due diligence.'
     ) as value`,
    [runtimeUserId],
  );
  const reserved = reservedResult.rows[0].value;
  assert.equal(reserved.state, 'reserved');
  assert.equal(reserved.accessKind, 'operator');
  assert.equal(reserved.claimVersion, 1);

  const inProgressResult = await database.query(
    `select public.pedro_reserve_turn(
       $1::uuid, $2::uuid, 'pedrofixruntime001', 'Explain due diligence.'
     ) as value`,
    [runtimeUserId, reserved.threadId],
  );
  const inProgress = inProgressResult.rows[0].value;
  assert.equal(inProgress.state, 'in_progress');
  assert.equal(Number.isInteger(inProgress.retryAfterSeconds), true);
  assert.equal(inProgress.retryAfterSeconds >= 1, true);
  assert.equal(inProgress.retryAfterSeconds <= 60, true);

  const searchResult = await database.query(
    `select public.pedro_search_published_content(
       $1::uuid, $2::uuid, $3::integer, '{}'::text[], 999
     ) as value`,
    [runtimeUserId, reserved.turnId, reserved.claimVersion],
  );
  assert.deepEqual(searchResult.rows[0].value, { candidates: [] });

  const historyResult = await database.query(
    `select public.pedro_history(
       $1::uuid, $2::uuid, 999, null, null
     ) as value`,
    [runtimeUserId, reserved.threadId],
  );
  assert.equal(historyResult.rows[0].value.threadId, reserved.threadId);
  assert.equal(historyResult.rows[0].value.accessKind, 'operator');
  assert.deepEqual(historyResult.rows[0].value.messages, []);

  const catalogResult = await database.query(`
    select
      pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            'public.pedro_reserve_turn(uuid,uuid,text,text)'
          )
        )),
        'pg_catalog.greatest('
      ) as reserve_greatest,
      pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            'public.pedro_search_published_content(uuid,uuid,integer,text[],integer)'
          )
        )),
        'pg_catalog.least('
      ) as search_least,
      pg_catalog.strpos(
        pg_catalog.lower(pg_catalog.pg_get_functiondef(
          pg_catalog.to_regprocedure(
            'public.pedro_history(uuid,uuid,integer,timestamptz,uuid)'
          )
        )),
        'pg_catalog.greatest('
      ) as history_greatest
  `);
  assert.deepEqual(catalogResult.rows[0], {
    reserve_greatest: 0,
    search_least: 0,
    history_greatest: 0,
  });

  await database.exec('set role anon;');
  await assert.rejects(
    database.query(
      `select public.pedro_history(
         $1::uuid, $2::uuid, 10, null, null
       )`,
      [runtimeUserId, reserved.threadId],
    ),
    /permission denied/i,
  );
  await database.exec('reset role;');

  await database.exec('set role service_role;');
  const serviceResult = await database.query(
    `select public.pedro_history(
       $1::uuid, $2::uuid, 10, null, null
     ) as value`,
    [runtimeUserId, reserved.threadId],
  );
  assert.equal(serviceResult.rows[0].value.accessKind, 'operator');
  await database.exec('reset role;');

  console.log(JSON.stringify({
    status: 'PASS',
    sourceTransform: {
      functions: 3,
      removedLeastQualifications: 5,
      removedGreatestQualifications: 6,
      otherDefinitionChanges: 0,
    },
    runtime: {
      migrationExecuted: true,
      reserve: 'PASS',
      inProgressRetryBound: 'PASS',
      searchLimitBound: 'PASS',
      historyLimitBound: 'PASS',
      grants: 'PASS',
    },
  }, null, 2));
} finally {
  if (database) await database.close();
  assert.equal(dirname(resolvedRuntimeRoot), expectedParent);
  assert.match(basename(resolvedRuntimeRoot), /^pedro-pglite-runtime-/u);
  rmSync(resolvedRuntimeRoot, { recursive: true, force: true });
}
