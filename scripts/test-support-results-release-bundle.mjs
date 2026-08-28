import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'support-results-release-test-'));
const outputPath = path.join(temporaryDirectory, 'support-results-release.sql');
const builderPath = path.join(root, 'scripts', 'build-support-results-release-bundle.mjs');
const expected = [
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
  assert.equal(summary.liveProbe, 'scripts/probe-support-results-release.sql');
  assert.match(summary.sha256, /^[0-9a-f]{64}$/u);
  assert.equal(summary.sha256, createHash('sha256').update(bundle).digest('hex'));

  for (const release of summary.releases) {
    const rawSource = await readFile(
      path.join(root, 'supabase', 'migrations', release.file),
      'utf8',
    );
    const source = rawSource.replace(/\r\n?/gu, '\n');
    assert.equal((source.match(/^\s*begin;\s*$/gimu) || []).length, 1);
    assert.equal((source.match(/^\s*commit;\s*$/gimu) || []).length, 1);
    assert.equal((source.match(/^\s*notify pgrst, 'reload schema';\s*$/gimu) || []).length, 1);
    assert.equal(release.sha256, createHash('sha256').update(source).digest('hex'));
    const syntheticCrLf = source.replace(/\n/gu, '\r\n');
    assert.equal(
      createHash('sha256').update(syntheticCrLf.replace(/\r\n?/gu, '\n')).digest('hex'),
      release.sha256,
    );
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
  assert.match(bundle, /support_results_ledger_any/u);
  assert.match(bundle, /support_results_ledger_complete/u);
  assert.match(bundle, /support_results_ledger_exact/u);
  assert.match(bundle, /Partial Support results migration ledger detected/u);
  assert.match(bundle, /do not match the reviewed names and source hashes/u);
  assert.match(bundle, /reapplying their reviewed function and privilege definitions/u);
  assert.equal(
    (bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length,
    2,
  );
  for (const postflightContract of [
    'admin_support_queue_v1(uuid,text,integer,integer,text)',
    'examination_history_by_track_v1(uuid,text,integer,integer)',
    'sensitive_data_viewed',
    'a.user_id = p_user_id',
    'service_role',
    'authenticated',
    'search_path=""',
    'aclexplode',
    "pg_get_userbyid(function_row.proowner) = 'postgres'",
  ]) {
    assert.ok(bundle.includes(postflightContract), `Postflight is missing ${postflightContract}.`);
  }
  assert.doesNotMatch(builder, /readdir|glob|supabase\s+(?:db\s+push|migration\s+up)/u);
  assert.ok(builder.includes("rawSource.replace(/\\r\\n?/gu, '\\n')"));
  assert.match(builder, /beginCount !== 1 \|\| commitCount !== 1/u);
  assert.match(builder, /flag: 'wx'/u);

  const applyCommit = bundle.indexOf('\ncommit;\n');
  const rollbackProbe = bundle.indexOf('-- The committed functions are now exercised', applyCommit);
  assert.ok(applyCommit > priorMarker, 'The migration transaction must commit after both bodies.');
  assert.ok(rollbackProbe > applyCommit, 'The rollback-only live probe must begin after migration commit.');
  const applySection = bundle.slice(0, rollbackProbe);
  assert.equal((applySection.match(/^\s*begin;\s*$/gimu) || []).length, 1);
  assert.equal((applySection.match(/^\s*commit;\s*$/gimu) || []).length, 1);
  const probeSection = bundle.slice(rollbackProbe);
  assert.equal((probeSection.match(/^\s*begin;\s*$/gimu) || []).length, 1);
  assert.equal((probeSection.match(/^\s*rollback;\s*$/gimu) || []).length, 1);
  assert.equal((probeSection.match(/^\s*commit;\s*$/gimu) || []).length, 0);
  assert.match(probeSection, /SUPPORT_RESULTS_PROBE_NONADMIN_ACCEPTED/u);
  assert.match(probeSection, /SUPPORT_RESULTS_PROBE_EMPTY_OWNER_HISTORY_FAILED/u);
  assert.match(probeSection, /SUPPORT_RESULTS_PROBE_CROSS_OWNER_HISTORY/u);
  assert.match(probeSection, /SUPPORT_RESULTS_PROBE_INVALID_TRACK_ACCEPTED/u);
  assert.doesNotMatch(probeSection, /raise notice/iu);

  const workflows = [
    '.github/workflows/staging-e2e-gate.yml',
    '.github/workflows/deploy-worker.yml',
    '.github/workflows/deploy.yml',
  ];
  for (const workflowPath of workflows) {
    const workflow = await readFile(path.join(root, workflowPath), 'utf8');
    assert.match(workflow, /support_results_database_preapplied:/u);
    assert.match(workflow, /build-support-results-release-bundle\.mjs/u);
    assert.match(workflow, /test-support-results-release-bundle\.mjs/u);
    assert.match(workflow, /SUPPORT_RESULTS_DATABASE_URL/u);
    assert.match(workflow, /SUPPORT_RESULTS_DATABASE_PREAPPLIED/u);
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

console.log('Atomic Support identity and Bar Simulation results release bundle contracts passed.');
