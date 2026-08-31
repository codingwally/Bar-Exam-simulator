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
  const [bundle, schedule, payment, forecast, consentVersion, runtimeIntegrity] = await Promise.all([
    readFile(output, 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831100000_september_pricing_cutover.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831101000_proof_only_payment_evidence.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260831170000_admin_bar_forecast.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260901010837_admin_bar_forecast_consent_version.sql'), 'utf8'),
    readFile(path.join(root, 'supabase', 'migrations', '20260901014500_admin_bar_forecast_runtime_integrity.sql'), 'utf8'),
  ]);
  const scheduleHash = hash(schedule);
  const paymentHash = hash(payment);
  const forecastHash = hash(forecast);
  const consentVersionHash = hash(consentVersion);
  const runtimeIntegrityHash = hash(runtimeIntegrity);
  assert.equal(
    runtimeIntegrityHash,
    'a304e4a9b0ba364812e6e49a308930907c2eb3eea65f5c22cce6db61a73ad548',
    'The runtime-integrity migration must retain its reviewed normalized-LF hash.',
  );

  assert.match(bundle, /^\\set ON_ERROR_STOP on/mu);
  assert.equal(
    (bundle.match(/insert into supabase_migrations\.schema_migrations/gu) || []).length,
    3,
    'Only the three exact Forecast migrations may be applied and recorded by this bundle.',
  );
  assert.ok(bundle.includes(`sha256:${scheduleHash}`));
  assert.ok(bundle.includes(`sha256:${paymentHash}`));
  assert.ok(bundle.includes(`sha256:${forecastHash}`));
  assert.ok(bundle.includes(`sha256:${consentVersionHash}`));
  assert.ok(bundle.includes(`sha256:${runtimeIntegrityHash}`));
  const prerequisiteCheck = bundle.indexOf('forecast_prerequisite_ledger_exact');
  const forecastApply = bundle.indexOf('-- BEGIN 20260831170000: admin_bar_forecast');
  const forecastLedger = bundle.indexOf("'20260831170000',", forecastApply);
  const consentApply = bundle.indexOf('-- BEGIN 20260901010837: admin_bar_forecast_consent_version');
  const consentLedger = bundle.indexOf("'20260901010837',", consentApply);
  const runtimeIntegrityApply = bundle.indexOf('-- BEGIN 20260901014500: admin_bar_forecast_runtime_integrity');
  const runtimeIntegrityLedger = bundle.indexOf("'20260901014500',", runtimeIntegrityApply);
  const committed = bundle.indexOf('commit;', runtimeIntegrityLedger);
  const authorizationProbe = bundle.indexOf('do $admin_bar_forecast_authorization_probe$', committed);
  const rollback = bundle.indexOf('rollback;', authorizationProbe);
  assert.ok(prerequisiteCheck >= 0 && forecastApply > prerequisiteCheck);
  assert.ok(forecastLedger > forecastApply && consentApply > forecastLedger);
  assert.ok(consentLedger > consentApply && runtimeIntegrityApply > consentLedger);
  assert.ok(runtimeIntegrityLedger > runtimeIntegrityApply && committed > runtimeIntegrityLedger);
  assert.ok(authorizationProbe > committed && rollback > authorizationProbe);
  assert.match(bundle, /exact September pricing prerequisites are missing or drifted/u);
  assert.match(bundle, /Unrecorded admin_bar_forecast state detected; refusing unsafe adoption/u);
  assert.match(bundle, /Unrecorded admin_bar_forecast_consent_version state detected; refusing unsafe adoption/u);
  assert.match(bundle, /admin_bar_forecast_runtime_integrity migration ledger drift detected; refusing release/u);
  assert.match(bundle, /Unrecorded admin_bar_forecast_runtime_integrity state detected; refusing unsafe adoption/u);
  const runtimeStateAlias = bundle.indexOf('as forecast_runtime_integrity_state_any');
  const runtimeStateStart = bundle.lastIndexOf('select exists (', runtimeStateAlias);
  const runtimeStateEnd = bundle.indexOf('\\gset', runtimeStateAlias);
  assert.ok(runtimeStateStart >= 0 && runtimeStateAlias > runtimeStateStart
    && runtimeStateEnd > runtimeStateAlias);
  const runtimeStateProbe = bundle.slice(runtimeStateStart, runtimeStateEnd);
  assert.match(runtimeStateProbe, /DD2026_BAR_FORECAST_INTEGRITY_INVALID/u);
  assert.match(runtimeStateProbe, /v_checksum_count/u);
  assert.match(runtimeStateProbe, /v_editorial_count/u);
  assert.match(runtimeStateProbe, /v\.payload ->> ''id'' = i\.id/u);
  assert.match(bundle, /count\(\*\) = 3[\s\S]*as forecast_postflight_exact/u);
  assert.match(bundle, /postflight passed for all three migrations/u);
  assert.match(bundle, /ADMIN_BAR_FORECAST_PROBE_RUNTIME_INTEGRITY_FUNCTION_FAILED/u);
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
    migrations: ['20260831170000', '20260901010837', '20260901014500'],
    bundleSha256: `sha256:${hash(bundle)}`,
    probe: 'embedded-rollback-only',
  }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
