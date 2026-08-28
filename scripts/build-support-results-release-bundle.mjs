import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = Object.freeze([
  {
    version: '20260828152931',
    file: '20260828152931_admin_support_requester_identity.sql',
    name: 'admin_support_requester_identity',
  },
  {
    version: '20260828154159',
    file: '20260828154159_bar_simulation_result_history.sql',
    name: 'bar_simulation_result_history',
  },
]);

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-support-results-release-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const prepared = [];
for (const release of releases) {
  const rawSource = await readFile(path.join(root, 'supabase', 'migrations', release.file), 'utf8');
  const source = rawSource.replace(/\r\n?/gu, '\n');
  const beginCount = (source.match(/^\s*begin;\s*$/gimu) || []).length;
  const commitCount = (source.match(/^\s*commit;\s*$/gimu) || []).length;
  if (beginCount !== 1 || commitCount !== 1) {
    throw new Error(`${release.file} must contain exactly one outer BEGIN and COMMIT.`);
  }

  prepared.push({
    ...release,
    sha256: createHash('sha256').update(source).digest('hex'),
    body: source
      .replace(/^\s*begin;\s*$/imu, '')
      .replace(/^\s*commit;\s*$/imu, '')
      .trim(),
  });
}

const probePath = path.join(root, 'scripts', 'probe-support-results-release.sql');
const probe = await readFile(probePath, 'utf8');
if ((probe.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*rollback;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*commit;\s*$/gimu) || []).length !== 0
    || !/^\\set ON_ERROR_STOP on\s*$/imu.test(probe)) {
  throw new Error('The Support results live probe must be one rollback-only psql transaction.');
}

const ledgerInsert = (release) => `insert into supabase_migrations.schema_migrations
  (version, statements, name)
values (
  '${release.version}',
  array['sha256:${release.sha256}'],
  '${release.name}'
);`;
const exactLedgerCondition = (release) => `(version = '${release.version}'
      and name = '${release.name}'
      and 'sha256:${release.sha256}' = any(coalesce(statements, array[]::text[])))`;

const [supportIdentity, resultHistory] = prepared;
const bundle = `-- Generated only from the two reviewed Support identity and Bar Simulation
-- result-history migrations. Existing ledger rows are accepted only when their
-- exact version, name, and source hash match this release.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('support-results-release-20260828', 20260828));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

select
  (count(*) > 0) as support_results_ledger_any,
  (count(*) = 2) as support_results_ledger_complete,
  (count(*) filter (where
    ${exactLedgerCondition(supportIdentity)}
    or ${exactLedgerCondition(resultHistory)}
  ) = 2) as support_results_ledger_exact
from supabase_migrations.schema_migrations
where version in ('${supportIdentity.version}', '${resultHistory.version}')
\\gset

\\if :support_results_ledger_any
  \\if :support_results_ledger_complete
    \\if :support_results_ledger_exact
      \\echo 'Both Support results migrations have exact ledger rows; reapplying their reviewed function and privilege definitions.'
    \\else
      \\echo 'One or more Support results ledger rows do not match the reviewed names and source hashes; refusing cutover.'
      rollback;
      \\quit 3
    \\endif
  \\else
    \\echo 'Partial Support results migration ledger detected; refusing a non-atomic rerun.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\echo 'Applying the two reviewed Support results migrations atomically.'
\\endif

-- BEGIN reviewed migration ${supportIdentity.version}: ${supportIdentity.name}
${supportIdentity.body}
\\if :support_results_ledger_any
\\else
  ${ledgerInsert(supportIdentity)}
\\endif
-- END reviewed migration ${supportIdentity.version}: ${supportIdentity.name}

-- BEGIN reviewed migration ${resultHistory.version}: ${resultHistory.name}
${resultHistory.body}
\\if :support_results_ledger_any
\\else
  ${ledgerInsert(resultHistory)}
\\endif
-- END reviewed migration ${resultHistory.version}: ${resultHistory.name}

select coalesce(
  (
    select count(*) = 2
    from supabase_migrations.schema_migrations
    where ${exactLedgerCondition(supportIdentity)}
       or ${exactLedgerCondition(resultHistory)}
  )
  and exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.oid = 'public.admin_support_queue_v1(uuid,text,integer,integer,text)'::regprocedure
      and function_row.prosecdef
      and function_row.provolatile = 'v'
      and pg_get_userbyid(function_row.proowner) = 'postgres'
      and function_row.proconfig = array['search_path=""']::text[]
  )
  and exists (
    select 1
    from pg_proc function_row
    join pg_namespace namespace_row
      on namespace_row.oid = function_row.pronamespace
    where namespace_row.nspname = 'public'
      and function_row.oid = 'public.examination_history_by_track_v1(uuid,text,integer,integer)'::regprocedure
      and function_row.prosecdef
      and function_row.provolatile = 's'
      and pg_get_userbyid(function_row.proowner) = 'postgres'
      and function_row.proconfig = array['search_path=""']::text[]
  )
  and not has_function_privilege(
    'anon',
    'public.admin_support_queue_v1(uuid,text,integer,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_support_queue_v1(uuid,text,integer,integer,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.admin_support_queue_v1(uuid,text,integer,integer,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'anon',
    'public.examination_history_by_track_v1(uuid,text,integer,integer)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.examination_history_by_track_v1(uuid,text,integer,integer)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.examination_history_by_track_v1(uuid,text,integer,integer)',
    'EXECUTE'
  )
  and not exists (
    select 1
    from pg_proc function_row
    cross join lateral aclexplode(
      coalesce(function_row.proacl, acldefault('f', function_row.proowner))
    ) privilege_row
    where function_row.oid in (
      'public.admin_support_queue_v1(uuid,text,integer,integer,text)'::regprocedure,
      'public.examination_history_by_track_v1(uuid,text,integer,integer)'::regprocedure
    )
      and privilege_row.privilege_type = 'EXECUTE'
      and privilege_row.grantee <> function_row.proowner
      and privilege_row.grantee <> (
        select role_row.oid
        from pg_roles role_row
        where role_row.rolname = 'service_role'
      )
  )
  and position(
    'sensitive_data_viewed'
    in pg_get_functiondef(
      'public.admin_support_queue_v1(uuid,text,integer,integer,text)'::regprocedure
    )
  ) > 0
  and position(
    'a.user_id = p_user_id'
    in pg_get_functiondef(
      'public.examination_history_by_track_v1(uuid,text,integer,integer)'::regprocedure
    )
  ) > 0,
  false
) as support_results_release_ready
\\gset

\\if :support_results_release_ready
  \\echo 'Exact Support results ledger, privileges, and RPC postflight passed.'
\\else
  \\echo 'Support results postflight failed; rolling back and refusing Worker cutover.'
  rollback;
  \\quit 3
\\endif

commit;

-- The committed functions are now exercised using rollback-only synthetic
-- support data and read-only owner-scoped examination history checks.
${probe.trim()}
`;

await writeFile(outputPath, bundle, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify({
  outputPath,
  bytes: Buffer.byteLength(bundle),
  sha256: createHash('sha256').update(bundle).digest('hex'),
  releases: prepared.map(({ version, file, name, sha256 }) => ({
    version,
    file,
    name,
    sha256,
  })),
  liveProbe: path.relative(root, probePath).replaceAll(path.sep, '/'),
}, null, 2));
