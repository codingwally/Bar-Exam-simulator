import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releases = Object.freeze([
  {
    version: '20260828133000',
    file: '20260828133000_optimize_internal_test_scoped_usage_helpers.sql',
    name: 'optimize_internal_test_scoped_usage_helpers',
  },
  {
    version: '20260828133500',
    file: '20260828133500_admin_marketing_live_home_metrics.sql',
    name: 'admin_marketing_live_home_metrics',
  },
  {
    version: '20260828134000',
    file: '20260828134000_exclude_admins_from_recent_sign_in_directory.sql',
    name: 'exclude_admins_from_recent_sign_in_directory',
  },
]);

const outputIndex = process.argv.indexOf('--output');
const outputPath = outputIndex >= 0
  ? path.resolve(process.argv[outputIndex + 1] || '')
  : path.join(tmpdir(), `due-diligence-admin-analytics-release-${process.pid}.sql`);
if (!outputPath || outputPath === root) throw new Error('A safe output file is required.');

const prepared = [];
for (const release of releases) {
  const source = await readFile(path.join(root, 'supabase', 'migrations', release.file), 'utf8');
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

const probePath = path.join(root, 'scripts', 'probe-admin-analytics-release.sql');
const probe = await readFile(probePath, 'utf8');
if ((probe.match(/^\s*begin;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*rollback;\s*$/gimu) || []).length !== 1
    || (probe.match(/^\s*commit;\s*$/gimu) || []).length !== 0
    || !/^\\set ON_ERROR_STOP on\s*$/imu.test(probe)) {
  throw new Error('The Admin analytics live probe must be one rollback-only psql transaction.');
}

const [scopedHelpers, marketingLive, recentSignIns] = prepared;
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

const bundle = `-- Generated only from the three reviewed Admin analytics migrations.
-- Existing target ledger rows are accepted only when both name and source hash
-- match this exact release. No unrelated pending Supabase migration is selected.
\\set ON_ERROR_STOP on
begin;
set local lock_timeout = '5s';
set local statement_timeout = '120s';

select pg_advisory_xact_lock(hashtextextended('admin-analytics-release-20260828', 20260828));
lock table supabase_migrations.schema_migrations in share row exclusive mode;

select
  (count(*) > 0) as admin_analytics_ledger_any,
  (count(*) = 3) as admin_analytics_ledger_complete,
  (count(*) filter (where
    ${exactLedgerCondition(scopedHelpers)}
    or ${exactLedgerCondition(marketingLive)}
    or ${exactLedgerCondition(recentSignIns)}
  ) = 3) as admin_analytics_ledger_exact
from supabase_migrations.schema_migrations
where version in (
  '${scopedHelpers.version}',
  '${marketingLive.version}',
  '${recentSignIns.version}'
)
\\gset

\\if :admin_analytics_ledger_any
  \\if :admin_analytics_ledger_complete
    \\if :admin_analytics_ledger_exact
      \\echo 'All three Admin analytics migrations already have the exact reviewed names and source hashes.'
    \\else
      \\echo 'One or more Admin analytics ledger rows do not match the reviewed names and source hashes; refusing cutover.'
      rollback;
      \\quit 3
    \\endif
  \\else
    \\echo 'Partial Admin analytics migration ledger detected; refusing a non-atomic rerun.'
    rollback;
    \\quit 3
  \\endif
\\else
  \\echo 'Applying the three reviewed Admin analytics migrations atomically.'

  -- BEGIN reviewed migration ${scopedHelpers.version}: ${scopedHelpers.name}
  ${scopedHelpers.body}
  ${ledgerInsert(scopedHelpers)}
  -- END reviewed migration ${scopedHelpers.version}: ${scopedHelpers.name}

  -- BEGIN reviewed migration ${marketingLive.version}: ${marketingLive.name}
  ${marketingLive.body}
  ${ledgerInsert(marketingLive)}
  -- END reviewed migration ${marketingLive.version}: ${marketingLive.name}

  -- BEGIN reviewed migration ${recentSignIns.version}: ${recentSignIns.name}
  ${recentSignIns.body}
  ${ledgerInsert(recentSignIns)}
  -- END reviewed migration ${recentSignIns.version}: ${recentSignIns.name}
\\endif

select coalesce(
  (
    select count(*) = 3
    from supabase_migrations.schema_migrations
    where ${exactLedgerCondition(scopedHelpers)}
       or ${exactLedgerCondition(marketingLive)}
       or ${exactLedgerCondition(recentSignIns)}
  )
  and to_regprocedure('private.admin_scoped_usage_events(text)') is not null
  and to_regprocedure('private.admin_scoped_usage_sessions(text)') is not null
  and position(
    'admin_learner_reporting_scope_matches'
    in pg_get_functiondef('private.admin_scoped_usage_events(text)'::regprocedure)
  ) = 0
  and position(
    'join private.internal_test_accounts'
    in lower(pg_get_functiondef('private.admin_scoped_usage_events(text)'::regprocedure))
  ) > 0
  and not has_function_privilege(
    'service_role',
    'private.admin_scoped_usage_events(text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'service_role',
    'private.admin_scoped_usage_sessions(text)',
    'EXECUTE'
  )
  and to_regprocedure(
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)'
  ) is not null
  and to_regprocedure('public.admin_live_activity_scoped_v1(uuid,integer,text,text)') is not null
  and to_regprocedure('public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)') is not null
  and position(
    'quorum_opened'
    in lower(pg_get_functiondef(
      'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)'::regprocedure
    ))
  ) > 0
  and position(
    'activehome5minutes'
    in lower(pg_get_functiondef(
      'public.admin_live_activity_scoped_v1(uuid,integer,text,text)'::regprocedure
    ))
  ) > 0
  and position(
    'not in (''admin'', ''founder_admin'', ''super_admin'')'
    in lower(pg_get_functiondef(
      'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)'::regprocedure
    ))
  ) > 0
  and not has_function_privilege(
    'authenticated',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.admin_marketing_summary_scoped_v1(uuid,timestamptz,timestamptz,timestamptz,timestamptz,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_live_activity_scoped_v1(uuid,integer,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.admin_live_activity_scoped_v1(uuid,integer,text,text)',
    'EXECUTE'
  )
  and not has_function_privilege(
    'authenticated',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'EXECUTE'
  )
  and has_function_privilege(
    'service_role',
    'public.admin_recent_sign_in_directory_scoped_v1(uuid,integer,text,text)',
    'EXECUTE'
  ),
  false
) as admin_analytics_release_ready
\\gset

\\if :admin_analytics_release_ready
  \\echo 'Exact Admin analytics migration ledger and protected RPC postflight passed.'
\\else
  \\echo 'Admin analytics postflight failed; rolling back and refusing Worker cutover.'
  rollback;
  \\quit 3
\\endif

commit;

-- The committed schema is now exercised through the real Admin RPCs. This
-- second transaction always rolls back its live-activity audit writes.
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
