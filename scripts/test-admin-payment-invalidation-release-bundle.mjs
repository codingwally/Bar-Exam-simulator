import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'dd-payment-invalidation-release-'));
const output = path.join(temporary, 'release.sql');
const builderPath = path.join(root, 'scripts', 'build-admin-payment-invalidation-release-bundle.mjs');

try {
  const run = spawnSync(process.execPath, [builderPath, '--output', output], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const summary = JSON.parse(run.stdout);
  const [bundle, migration, builder] = await Promise.all([
    readFile(output, 'utf8'),
    readFile(
      path.join(root, 'supabase/migrations/20260901120000_admin_payment_invalidation.sql'),
      'utf8',
    ),
    readFile(builderPath, 'utf8'),
  ]);

  assert.equal(summary.release.version, '20260901120000');
  assert.equal(summary.release.file, '20260901120000_admin_payment_invalidation.sql');
  assert.equal(summary.release.name, 'admin_payment_invalidation');
  assert.equal(summary.liveProbe, 'scripts/probe-admin-payment-invalidation.sql');
  assert.equal(
    summary.release.sha256,
    createHash('sha256').update(migration.replace(/\r\n?/gu, '\n')).digest('hex'),
  );
  assert.equal(summary.sha256, createHash('sha256').update(bundle).digest('hex'));
  assert.match(bundle, /^\\set ON_ERROR_STOP on/mu);
  assert.equal(
    (bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length,
    1,
  );
  assert.match(bundle, /payment_invalidation_ledger_any/u);
  assert.match(bundle, /payment_invalidation_ledger_exact/u);
  assert.match(bundle, /ledger drift detected; refusing release/u);
  assert.match(bundle, /phase4_admin_invalidate_payment\(uuid,uuid,text,text\)/u);
  assert.match(bundle, /subscriptions_invalidated_payment_cancelled_check/u);
  assert.match(bundle, /not function_row\.prosecdef/u);
  assert.match(bundle, /ADMIN_PAYMENT_INVALIDATION_PROBE_PASSED/u);
  assert.match(bundle, /commit;[\s\S]*rollback;[\s\S]*ADMIN_PAYMENT_INVALIDATION_PROBE_PASSED/u);
  assert.doesNotMatch(builder, /readdir|glob|supabase\s+(?:db\s+push|migration\s+up)/iu);
  assert.match(builder, /flag: 'wx'/u);

  const collision = spawnSync(process.execPath, [builderPath, '--output', output], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.notEqual(collision.status, 0, 'The release builder must not overwrite an artifact.');

  console.log(JSON.stringify({
    ok: true,
    migration: summary.release.version,
    probe: 'embedded-rollback-only',
    attestation: `sha256:${summary.sha256}`,
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
