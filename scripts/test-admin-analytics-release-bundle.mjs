import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'admin-analytics-release-test-'));
const outputPath = path.join(temporaryDirectory, 'admin-analytics-release.sql');
const builderPath = path.join(root, 'scripts', 'build-admin-analytics-release-bundle.mjs');
const expected = [
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
];

try {
  const result = spawnSync(
    process.execPath,
    [builderPath, '--output', outputPath],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const summary = JSON.parse(result.stdout);
  const bundle = await readFile(outputPath, 'utf8');
  const builder = await readFile(builderPath, 'utf8');

  assert.deepEqual(
    summary.releases.map(({ version, file, name }) => ({ version, file, name })),
    expected,
  );
  assert.equal(summary.liveProbe, 'scripts/probe-admin-analytics-release.sql');
  assert.match(summary.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(summary.sha256, createHash('sha256').update(bundle).digest('hex'));

  for (const release of summary.releases) {
    const source = await readFile(
      path.join(root, 'supabase', 'migrations', release.file),
      'utf8',
    );
    assert.equal((source.match(/^\s*begin;\s*$/gimu) || []).length, 1);
    assert.equal((source.match(/^\s*commit;\s*$/gimu) || []).length, 1);
    assert.equal(release.sha256, createHash('sha256').update(source).digest('hex'));
    assert.ok(bundle.includes(`sha256:${release.sha256}`));
    assert.ok(bundle.includes(`name = '${release.name}'`));
  }

  let priorMarker = -1;
  for (const release of expected) {
    const marker = `BEGIN reviewed migration ${release.version}: ${release.name}`;
    const markerIndex = bundle.indexOf(marker);
    assert.ok(markerIndex > priorMarker, `${marker} must appear in release order.`);
    priorMarker = markerIndex;
  }

  assert.match(bundle, /^\\set ON_ERROR_STOP on/mu);
  assert.match(bundle, /pg_advisory_xact_lock/u);
  assert.match(bundle, /lock table supabase_migrations\.schema_migrations/u);
  assert.match(bundle, /admin_analytics_ledger_any/u);
  assert.match(bundle, /admin_analytics_ledger_complete/u);
  assert.match(bundle, /admin_analytics_ledger_exact/u);
  assert.match(bundle, /Partial Admin analytics migration ledger detected/u);
  assert.match(bundle, /do not match the reviewed names and source hashes/u);
  for (const postflightContract of [
    'join private.internal_test_accounts',
    'private.admin_scoped_usage_events(text)',
    'quorum_opened',
    'activehome5minutes',
    "not in (''admin'', ''founder_admin'', ''super_admin'')",
  ]) {
    assert.ok(bundle.includes(postflightContract), `Postflight is missing ${postflightContract}.`);
  }
  assert.equal(
    (bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length,
    3,
  );
  assert.doesNotMatch(builder, /readdir|glob|supabase\s+(?:db\s+push|migration\s+up)/u);
  assert.match(builder, /beginCount !== 1 \|\| commitCount !== 1/u);
  assert.match(builder, /flag: 'wx'/u);

  const applyCommit = bundle.indexOf('\ncommit;\n');
  const rollbackProbe = bundle.indexOf('-- The committed schema is now exercised', applyCommit);
  assert.ok(applyCommit > priorMarker, 'The atomic migration transaction must commit after all three bodies.');
  assert.ok(rollbackProbe > applyCommit, 'The rollback-only live probe must begin after the migration commit.');
  const applySection = bundle.slice(0, rollbackProbe);
  assert.equal((applySection.match(/^\s*begin;\s*$/gimu) || []).length, 1);
  assert.equal((applySection.match(/^\s*commit;\s*$/gimu) || []).length, 1);
  const probeSection = bundle.slice(rollbackProbe);
  assert.equal((probeSection.match(/^\s*begin;\s*$/gimu) || []).length, 1);
  assert.equal((probeSection.match(/^\s*rollback;\s*$/gimu) || []).length, 1);
  assert.equal((probeSection.match(/^\s*commit;\s*$/gimu) || []).length, 0);
  assert.equal((probeSection.match(/set local statement_timeout = '8s';/gu) || []).length, 8);
  assert.equal((probeSection.match(/with response as materialized \(/gu) || []).length, 8);
  assert.doesNotMatch(probeSection, /^\s*do\b/mu);
  assert.doesNotMatch(probeSection, /^\s*for\b/mu);
  assert.match(probeSection, /public\.admin_dashboard_snapshot_scoped_v1/u);
  assert.match(probeSection, /public\.admin_marketing_summary_scoped_v1/u);
  assert.match(probeSection, /public\.admin_live_activity_scoped_v1/u);
  assert.match(probeSection, /public\.admin_recent_sign_in_directory_scoped_v1/u);
  for (const rpc of [
    'admin_dashboard_snapshot_scoped_v1',
    'admin_marketing_summary_scoped_v1',
    'admin_live_activity_scoped_v1',
    'admin_recent_sign_in_directory_scoped_v1',
  ]) {
    assert.equal(
      (probeSection.match(new RegExp(`select public\\.${rpc}\\(`, 'gu')) || []).length,
      2,
      `${rpc} must be probed once per scope as separate SQL statements.`,
    );
  }

  const collision = spawnSync(
    process.execPath,
    [builderPath, '--output', outputPath],
    { cwd: root, encoding: 'utf8' },
  );
  assert.notEqual(collision.status, 0, 'The builder must never overwrite an existing artifact.');
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

console.log('Atomic Admin analytics release bundle contracts passed.');
