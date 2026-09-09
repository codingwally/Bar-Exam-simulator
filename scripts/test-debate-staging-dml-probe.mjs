import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { buildProbe, captureFixture, executableStatements, HISTORICAL_PROBE_BASE, PROBE_BASE, validateCapturedFixture } from './debate-staging-dml-probe.mjs';

test('review artifact is reproducible from exact migrations and current real service envelopes', async () => {
  const result = await buildProbe();
  assert.equal(result.sql, await readFile(new URL(`../${PROBE_BASE}.sql`, import.meta.url), 'utf8'));
  assert.equal(result.readback, await readFile(new URL(`../${PROBE_BASE}.readback.sql`, import.meta.url), 'utf8'));
  assert.deepEqual(result.manifest, JSON.parse(await readFile(new URL(`../${PROBE_BASE}.manifest.json`, import.meta.url), 'utf8')));
  assert.equal(result.manifest.functionBodies, 22);
  assert.equal(result.manifest.claims.localSqlExecuted, false);
  assert.equal(result.manifest.claims.hostedSqlExecuted, false);
  assert.equal(result.manifest.claims.schemaInstallRollback, false);
  assert.ok(result.sql.indexOf("'ROLLBACK_SENTINEL_PRESENT'") < result.sql.indexOf('\nROLLBACK;'));
  assert.ok(result.sql.indexOf("'POST_ROLLBACK_PROBE_ROWS_ABSENT'") > result.sql.indexOf('\nROLLBACK;'));
  assert.ok(!/\b(?:INSERT INTO|DELETE FROM|UPDATE)\s+(?:auth\.|private\.|storage\.)/i.test(result.sql));
});

test('current actual service capture rejects a stale source pin and any changed command or envelope', async () => {
  const actual = await captureFixture();
  const frozen = JSON.parse(await readFile(new URL(`../${PROBE_BASE}.fixtures.json`, import.meta.url), 'utf8'));
  assert.doesNotThrow(() => validateCapturedFixture(frozen, actual));
  const stale = structuredClone(frozen); stale.sourceHashLf = '0'.repeat(64);
  assert.throws(() => validateCapturedFixture(stale, actual), /captured service source must still match/);
  const changedInput = structuredClone(frozen); changedInput.inputs[1].payload.title = 'Changed request';
  assert.throws(() => validateCapturedFixture(changedInput, actual));
  const changedState = structuredClone(frozen); changedState.envelopes[1].state.title = 'Changed saved state';
  assert.throws(() => validateCapturedFixture(changedState, actual), /Frozen envelopes must match/);
  const changedReceipt = structuredClone(frozen); changedReceipt.envelopes[1].receipt.revision = 99;
  assert.throws(() => validateCapturedFixture(changedReceipt, actual), /Frozen envelopes must match/);
});

test('successor keeps historical files immutable and labels execution as not yet performed', async () => {
  const expected = { 'fixtures.json': '02be235d5758910ab4c2382ca815b582fd04ee666217b08a5648ed325152bcfb', sql: '7c828bd9b0784532f20a2881c8b9af317f76f877be3e274f560686d8eb11cc76', 'readback.sql': '3df9e67986d99daba6e861f89398d140ed44f67619154678087f71e05ba46691' };
  for (const [extension, sha] of Object.entries(expected)) {
    const bytes = await readFile(new URL(`../${HISTORICAL_PROBE_BASE}.${extension}`, import.meta.url));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), sha);
  }
  const { manifest } = await buildProbe();
  assert.equal(manifest.sourceHashes.serviceLf, '398557be44e80197fc7323220d3078c11d7fc596fe73c590229b9e4d559fa493');
  assert.equal(manifest.predecessor.serviceSourceHashLf, '0a9d665f58c47f0adb78901822dce625ab2df7ca5dd5bb2a7c4212b5868cdd58');
  assert.equal(manifest.predecessor.normalizedActualEnvelopesIdentical, true);
  assert.equal(manifest.predecessor.envelopeCount, 2);
  assert.equal(manifest.predecessor.historicalHostedEvidenceReusedForCurrentExecutionClaim, false);
});

test('DML guard rejects a commit, schema mutation, anonymous block, second transaction and out-of-scope deletion', async () => {
  const { sql } = await buildProbe();
  for (const inserted of ['COMMIT;', 'CREATE TABLE public.bad(id integer);', 'DO $$ BEGIN NULL; END $$;', 'BEGIN;', 'DELETE FROM public.user_roles;', 'TRUNCATE public.debate_v3_audit;']) {
    assert.throws(() => executableStatements(sql.replace('\nROLLBACK;', `\n${inserted}\nROLLBACK;`)), inserted);
  }
  assert.doesNotThrow(() => executableStatements(sql));
});

test('the final readback has no write or credential operations and does not assert unobserved migration versions', async () => {
  const { sql, readback } = await buildProbe();
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|COMMIT|CREATE|ALTER|DROP|DO|CALL)\b/i.test(readback));
  assert.ok(!/schema_migrations WHERE version\s*(?:=|IN)\s*\(?\s*'202609090801(?:39|43)'/i.test(sql));
  for (const name of ['IDEMPOTENT_REPLAY','STALE_REVISION','OWNER_IMMUTABLE','NONMEMBER_REJECTED','STALE_JOB_COMPLETION_REJECTED','STUDY_CATALOG_V1_V2_READ_PARITY','AUDIT_NEGATIVE_PRIVILEGES']) assert.ok(sql.includes(name), name);
});

test('actual installed SQL, rollback sentinel, and expected permission errors in disposable CI PostgreSQL', {
  skip: process.platform !== 'linux' || process.env.GITHUB_ACTIONS !== 'true'
    ? 'Heavy PGlite execution is restricted to an isolated Linux CI runner; no local SQL execution is claimed.' : false,
  timeout: 120000,
}, async () => {
  const require = createRequire(new URL('../worker/package.json', import.meta.url));
  const { PGlite } = require('@electric-sql/pglite');
  const db = new PGlite();
  const read = async relative => (await readFile(new URL(`../${relative}`, import.meta.url), 'utf8')).replaceAll('\r\n', '\n');
  const sha = text => createHash('sha256').update(text).digest('hex');
  const scalar = async query => Object.values((await db.query(query)).rows[0])[0];
  const output = new URL('../artifacts/debate-local-rehearsal/staging-dml-probe-ci/', import.meta.url);
  const report = { kind: 'CI_DISPOSABLE_PGLITE_DML_ROLLBACK', status: 'RUNNING', hostedExecuted: false,
    nativeConcurrentConnections: false, actualHostedHelper: false, schemaInstallRollback: false,
    adaptations: ['PG17 range changed in memory to PG18 for PGlite.', 'Only the hosted admin_authorization_context definition MD5 is replaced in memory with the existing local hardened helper MD5.'],
    checks: [], expectedErrors: [], startedAt: new Date().toISOString() };
  await mkdir(output, { recursive: true });
  try {
    const source = await read('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');
    const start = source.indexOf('create or replace function public.admin_authorization_context(');
    assert.ok(start >= 0);
    const helper = source.slice(start, source.indexOf('\n$$;', start) + 4)
      .replace("if v_role not in ('admin', 'founder_admin', 'super_admin') then", "if v_role is null or v_role not in ('admin', 'founder_admin', 'super_admin') then");
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; grant usage on schema private to service_role;
      alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
      create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',raw_app_meta_data jsonb default '{}');
      create table public.user_roles(user_id uuid primary key references auth.users(id),role text not null default 'student'
        check(role in ('student','beta_tester','admin','founder_admin','super_admin')));
      create table public.admin_capabilities(user_id uuid references auth.users(id),capability text,revoked_at timestamptz);
      create schema supabase_migrations;
      create table supabase_migrations.schema_migrations(version text primary key,name text);
      insert into supabase_migrations.schema_migrations values('20260908151514','astra_study_room_persisted_catalog');
      ${helper}
      revoke all on function public.admin_authorization_context(uuid) from public,anon,authenticated;
      grant execute on function public.admin_authorization_context(uuid) to service_role;`);
    await db.exec(await read('supabase/migrations/20260908144814_astra_study_room_persisted_catalog.sql'));
    await db.exec(await read('supabase/migrations/20260909080139_debate_room_v3.sql'));
    await db.exec(await read('supabase/migrations/20260909080143_study_room_admission_v3.sql'));
    const { sql: hostedSql, readback, manifest } = await buildProbe();
    report.probeBase = PROBE_BASE; report.serviceSourceHashLf = manifest.sourceHashes.serviceLf;
    report.fixtureSha256 = manifest.fixtureSha256; report.probeManifestSha256 = sha(await read(`${PROBE_BASE}.manifest.json`));
    report.generatorSourceHashLf = sha(await read('scripts/debate-staging-dml-probe.mjs'));
    report.predecessor = manifest.predecessor;
    report.hostedArtifactSha256 = sha(hostedSql); report.postgresVersion = await scalar('select version()');
    const helperMd5 = await scalar("select md5(pg_get_functiondef('public.admin_authorization_context(uuid)'::regprocedure))");
    report.localHelperDefinitionMd5 = helperMd5;
    assert.equal(hostedSql.split('BETWEEN 170000 AND 179999').length, 2, 'Exactly one PG17 guard is adapted');
    assert.equal(hostedSql.split('51ea270969dd6283a3e29b8fbff10561').length, 2, 'Exactly one hosted helper fingerprint is adapted');
    const localSql = hostedSql.replace('BETWEEN 170000 AND 179999', 'BETWEEN 180000 AND 189999').replace('51ea270969dd6283a3e29b8fbff10561', helperMd5);
    report.localVariantSha256 = sha(localSql);
    const before = (await db.exec(readback)).flatMap(result => result.rows).find(row => row.rollback_probe)?.rollback_probe;
    assert.equal(before.checkpoint, 'DML_ROLLBACK_ROWS_ABSENT');
    const results = await db.exec(localSql);
    report.checks = results.flatMap(result => result.rows).filter(row => row.check_name).map(row => ({ name: row.check_name, passed: row.passed }));
    assert.equal(report.checks.length, manifest.assertions);
    assert.ok(report.checks.every(check => check.passed === 1));
    const checkpoints = results.flatMap(result => result.rows).filter(row => row.rollback_probe).map(row => row.rollback_probe);
    assert.ok(checkpoints.some(checkpoint => checkpoint.checkpoint === 'DML_CHECKS_PASSED_ROLLBACK_PENDING'));
    assert.ok(checkpoints.some(checkpoint => checkpoint.checkpoint === 'DML_ROLLBACK_ROWS_ABSENT'));
    const after = (await db.exec(readback)).flatMap(result => result.rows).find(row => row.rollback_probe)?.rollback_probe;
    assert.deepEqual(after, before, 'Independent readback preserves Study rows and migration ledger and removes rollback sentinel');
    report.checkpoints = checkpoints; report.independentReadback = after;
    const denials = JSON.parse(await read('docs/debate-room-v3/evidence/staging-dml-rollback-probe.denials.json'));
    for (const probe of denials.probes) {
      try {
        await assert.rejects(() => db.exec(probe.query), error => {
          assert.equal(error.code, probe.expectedSqlstate, probe.name);
          report.expectedErrors.push({ name: probe.name, expectedSqlstate: probe.expectedSqlstate, actualSqlstate: error.code }); return true;
        });
      } finally { await db.exec('rollback'); }
    }
    assert.deepEqual((await db.exec(readback)).flatMap(result => result.rows).find(row => row.rollback_probe)?.rollback_probe, before);
    assert.equal(sha(await read(`${PROBE_BASE}.sql`)), report.hostedArtifactSha256, 'Hosted artifact bytes were never changed for local execution');
    report.status = 'PASS_LOCAL_VERSION_ADAPTED_SQL_AND_EXPECTED_ERRORS';
  } catch (error) {
    report.status = 'FAIL'; report.error = { code: error.code || null, message: error.message };
    await db.exec('rollback').catch(() => {}); throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await writeFile(new URL('report.json', output), JSON.stringify(report, null, 2) + '\n');
    await db.close();
  }
});
