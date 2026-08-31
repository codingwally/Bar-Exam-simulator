import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'dd-september-pricing-bundle-'));
const output = path.join(temporary, 'release.sql');
const normalized = (value) => String(value).replace(/\r\n?/gu, '\n');
const hash = (value) => createHash('sha256').update(normalized(value)).digest('hex');

try {
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'build-september-pricing-release-bundle.mjs'),
    '--output', output,
  ], { cwd: root, stdio: 'pipe' });
  const [bundle, schedule, payment] = await Promise.all([
    readFile(output, 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831100000_september_pricing_cutover.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831101000_proof_only_payment_evidence.sql'), 'utf8'),
  ]);
  const scheduleHash = hash(schedule);
  const paymentHash = hash(payment);

  assert.match(bundle, /^\\set ON_ERROR_STOP on/mu);
  assert.equal((bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length, 2);
  assert.ok(bundle.includes(`sha256:${scheduleHash}`));
  assert.ok(bundle.includes(`sha256:${paymentHash}`));
  assert.match(bundle, /Unrecorded September pricing state detected; refusing unsafe adoption/u);
  assert.match(bundle, /Partial September pricing ledger detected; refusing non-atomic repair/u);
  assert.match(bundle, /commit;[\s\S]*-- Rollback-only production\/staging proof[\s\S]*rollback;/u);
  assert.match(bundle, /SEPTEMBER_PRICING_RELEASE_PROBE_PASSED/u);
  assert.doesNotMatch(bundle, /supabase\s+db\s+(push|reset)|supabase\s+migration\s+up/iu);
  for (const unrelated of ['20260828133000', '20260830054727', '20260831170000']) {
    assert.doesNotMatch(bundle, new RegExp(`version = '${unrelated}'`, 'u'));
  }
  console.log(JSON.stringify({ ok: true, migrations: 2, probe: 'embedded-rollback-only' }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
