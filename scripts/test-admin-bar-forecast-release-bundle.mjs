import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await mkdtemp(path.join(tmpdir(), 'dd-admin-bar-forecast-bundle-'));
const output = path.join(temporary, 'release.sql');
const normalized = (value) => String(value).replace(/\r\n?/gu, '\n');
const hash = (value) => createHash('sha256').update(normalized(value)).digest('hex');

try {
  execFileSync(process.execPath, [
    path.join(root, 'scripts', 'build-admin-bar-forecast-release-bundle.mjs'),
    '--output', output,
  ], { cwd: root, stdio: 'pipe' });
  const [bundle, schedule, payment, forecast] = await Promise.all([
    readFile(output, 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831100000_september_pricing_cutover.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831101000_proof_only_payment_evidence.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831170000_admin_bar_forecast.sql'), 'utf8'),
  ]);
  const scheduleHash = hash(schedule);
  const paymentHash = hash(payment);
  const forecastHash = hash(forecast);

  assert.match(bundle, /^\\set ON_ERROR_STOP on/mu);
  assert.equal(
    (bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length,
    1,
    'Only the Forecast migration may be applied and recorded by this bundle.',
  );
  assert.ok(bundle.includes(`sha256:${scheduleHash}`));
  assert.ok(bundle.includes(`sha256:${paymentHash}`));
  assert.ok(bundle.includes(`sha256:${forecastHash}`));
  const prerequisiteCheck = bundle.indexOf('forecast_prerequisite_ledger_exact');
  const forecastApply = bundle.indexOf('-- BEGIN 20260831170000: admin_bar_forecast');
  const forecastLedger = bundle.indexOf("'20260831170000',", forecastApply);
  const committed = bundle.indexOf('commit;', forecastLedger);
  const authorizationProbe = bundle.indexOf('do $admin_bar_forecast_authorization_probe$', committed);
  const rollback = bundle.indexOf('rollback;', authorizationProbe);
  assert.ok(prerequisiteCheck >= 0 && forecastApply > prerequisiteCheck);
  assert.ok(forecastLedger > forecastApply && committed > forecastLedger);
  assert.ok(authorizationProbe > committed && rollback > authorizationProbe);
  assert.match(bundle, /exact September pricing prerequisites are missing or drifted/u);
  assert.match(bundle, /Unrecorded Admin Bar Forecast state detected; refusing unsafe adoption/u);
  assert.match(bundle, /ADMIN_BAR_FORECAST_RELEASE_PROBE_PASSED/u);
  assert.match(bundle, /BAR_FORECAST_ENABLED/u);
  assert.match(bundle, /BAR_FORECAST_ADMIN_ONLY/u);
  assert.match(bundle, /DD2026_ADMIN_REQUIRED/u);
  assert.doesNotMatch(bundle, /supabase\s+db\s+(push|reset)|supabase\s+migration\s+up/iu);
  assert.doesNotMatch(bundle, /pricing_plan_versions|phase4_create_payment_request/u);
  for (const unrelated of ['20260828133000', '20260830054727']) {
    assert.doesNotMatch(bundle, new RegExp(`version = '${unrelated}'`, 'u'));
  }
  console.log(JSON.stringify({
    ok: true,
    prerequisites: 2,
    migration: '20260831170000',
    bundleSha256: `sha256:${hash(bundle)}`,
    probe: 'embedded-rollback-only',
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
