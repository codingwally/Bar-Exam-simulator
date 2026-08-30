import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async (relativePath) => readFile(path.join(root, relativePath), 'utf8');

const migrationPath = 'supabase/migrations/20260830054727_admin_pricing_revisions.sql';
const probePath = 'scripts/probe-admin-pricing-release.sql';
const stagingPath = '.github/workflows/staging-e2e-gate.yml';
const productionPaths = [
  '.github/workflows/deploy.yml',
  '.github/workflows/deploy-worker.yml',
];
const releaseWorkflowPaths = [stagingPath, ...productionPaths];

const migration = await read(migrationPath);
const probe = await read(probePath);
const migrationSha256 = createHash('sha256')
  .update(migration.replace(/\r\n?/gu, '\n'))
  .digest('hex');
const workflowSources = new Map(
  await Promise.all(releaseWorkflowPaths.map(async (relativePath) => [relativePath, await read(relativePath)])),
);
const validation = await read('.github/workflows/validate-mandatory-early-access.yml');

assert.equal((migration.match(/^\s*begin;\s*$/gimu) || []).length, 1);
assert.equal((migration.match(/^\s*commit;\s*$/gimu) || []).length, 1);
assert.equal((migration.match(/^\s*rollback;\s*$/gimu) || []).length, 0);
assert.match(migration, /create table if not exists public\.pricing_revisions/u);
assert.match(migration, /insert into storage\.buckets/u);
assert.match(migration, /'pricing-assets', 'pricing-assets', false/u);
assert.match(migration, /2026-09-01 00:00:00\+08/u);
assert.match(migration, /2026-09-02 00:00:00\+08/u);
assert.match(migration, /price_centavos = 14900/u);
assert.match(migration, /price_centavos = 19900/u);
assert.match(migration, /duration_days = 30/u);
assert.match(migration, /New 199-peso plan must fail closed until a compatible QR is published/u);
assert.match(migration, /'receiptStatus', to_jsonb\(p\)->>'subscriber_receipt_status'/u);
assert.match(migration, /'receiptAttempts', nullif\(to_jsonb\(p\)->>'subscriber_receipt_attempts', ''\)::integer/u);
assert.doesNotMatch(migration, /p\.subscriber_receipt_(?:status|attempts)/u);

assert.equal((probe.match(/^\s*begin;\s*$/gimu) || []).length, 1);
assert.equal((probe.match(/^\s*rollback;\s*$/gimu) || []).length, 1);
assert.equal((probe.match(/^\s*commit;\s*$/gimu) || []).length, 0);
assert.match(probe, /set local lock_timeout = '5s'/u);
assert.match(probe, /set local statement_timeout = '30s'/u);
assert.ok(
  probe.includes(`sha256:${migrationSha256}`),
  'The live probe must require the exact reviewed migration source hash in the Supabase ledger.',
);
assert.ok(
  probe.lastIndexOf('\nrollback;') > probe.lastIndexOf('$pricing_admin_payment_probe$;'),
  'The live probe must roll back after every synthetic Admin and payment operation.',
);
for (const requiredContract of [
  'ADMIN_PRICING_PROBE_MIGRATION_LEDGER_MISMATCH',
  'ADMIN_PRICING_PROBE_RLS_NOT_FORCED',
  'ADMIN_PRICING_PROBE_DIRECT_SERVICE_TABLE_ACCESS',
  'ADMIN_PRICING_PROBE_RPC_PRIVILEGE_FAILED',
  'ADMIN_PRICING_PROBE_LEGACY_CUTOFF_FAILED',
  'ADMIN_PRICING_PROBE_SEPTEMBER_FIRST_FAILED',
  'ADMIN_PRICING_PROBE_NO_QR_FAIL_CLOSED_FAILED',
  'ADMIN_PRICING_PROBE_PUBLISH_REPLAY_FAILED',
  'ADMIN_PRICING_PROBE_STALE_PAYMENT_REPLAY_FAILED',
  'ADMIN_PRICING_PROBE_FIRST_THIRTY_DAY_TERM_FAILED',
  'ADMIN_PRICING_PROBE_RENEWAL_EXTENSION_FAILED',
  'ADMIN_PRICING_PROBE_UNSAFE_REFUND_CHANGED_CURRENT_ACCESS',
  'ADMIN_PRICING_PROBE_ROLLBACK_FAILED',
  'ADMIN_PRICING_RELEASE_PROBE_PASSED',
]) {
  assert.ok(probe.includes(requiredContract), `Admin pricing probe is missing ${requiredContract}.`);
}
assert.doesNotMatch(probe, /^\s*(?:drop|truncate)\s+/gimu);

for (const [relativePath, workflow] of workflowSources) {
  assert.match(workflow, /pricing_database_preapplied:\s*\n[\s\S]*?required: true[\s\S]*?default: false/u);
  assert.match(workflow, /PRICING_DATABASE_PREAPPLIED: \$\{\{ inputs\.pricing_database_preapplied \}\}/u);
  assert.match(workflow, /20260830054727_admin_pricing_revisions\.sql/u);
  assert.match(workflow, /scripts\/probe-admin-pricing-release\.sql/u);
  assert.match(workflow, /\[\[ "\$PRICING_DATABASE_PREAPPLIED" != "true" \]\]/u);
  assert.match(workflow, /psql "\$PRICING_DATABASE_URL" -X --set=ON_ERROR_STOP=1 --file "\$pricing_probe"/u);
  assert.doesNotMatch(
    workflow,
    /psql "\$PRICING_DATABASE_URL"[^\n]*--file "\$pricing_migration"/u,
    `${relativePath} must never pretend to apply the migration; it may only run the rollback-only probe.`,
  );
  assert.match(workflow, /node scripts\/test-admin-pricing-editor\.mjs/u);
  assert.match(workflow, /node scripts\/test-pricing-public-contract\.mjs/u);
  assert.match(workflow, /node scripts\/test-admin-pricing-release\.mjs/u);
}

const staging = workflowSources.get(stagingPath);
assert.match(staging, /refs\/heads\/feature\/admin-pricing-builder-20260830/u);
assert.match(staging, /PRICING_WORKER_URL: https:\/\/duediligence-examinations-staging\.wallyesteban1993\.workers\.dev/u);
assert.match(staging, /"\$PRICING_WORKER_URL\/plans"/u);

for (const relativePath of productionPaths) {
  const workflow = workflowSources.get(relativePath);
  assert.match(workflow, /PRICING_WORKER_URL: https:\/\/duediligence-api\.wallyesteban1993\.workers\.dev/u);
  assert.match(workflow, /"\$PRICING_WORKER_URL\/plans"/u);
}

for (const workflow of workflowSources.values()) {
  for (const endpoint of [
    '/admin/pricing/query',
    '/admin/pricing/action',
    '/admin/pricing/assets/upload',
  ]) {
    assert.ok(workflow.includes(endpoint), `Release workflow is missing unauthenticated denial check for ${endpoint}.`);
  }
  assert.match(workflow, /401\|403/u);
  assert.match(workflow, /payload\.revisionId/u);
  assert.match(workflow, /payload\.serverNow/u);
}

assert.match(validation, /scripts\/test-admin-pricing-\*\.mjs/u);
assert.match(validation, /scripts\/probe-admin-pricing-release\.sql/u);
assert.match(validation, /node scripts\/test-admin-pricing-editor\.mjs/u);
assert.match(validation, /node scripts\/test-pricing-public-contract\.mjs/u);
assert.match(validation, /node scripts\/test-admin-pricing-release\.mjs/u);

console.log(JSON.stringify({
  ok: true,
  migration: migrationPath,
  migrationSha256,
  probe: probePath,
  probeMode: 'rollback-only',
  releaseWorkflows: releaseWorkflowPaths,
}, null, 2));
