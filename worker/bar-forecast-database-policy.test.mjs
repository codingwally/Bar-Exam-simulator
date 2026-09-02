import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260902090000_unlimited_forecast_access.sql', import.meta.url),
  'utf8',
);
const repairMigration = await readFile(
  new URL('../supabase/migrations/20260902093000_fix_unlimited_forecast_entitlement_readonly.sql', import.meta.url),
  'utf8',
);

test('Forecast database access follows the current server-authoritative unlimited entitlements', () => {
  assert.match(migration, /create or replace function public\.dd2026_bar_forecast_access_allowed/iu);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/iu);
  assert.match(migration, /public\.dd2026_is_admin\(p_actor_user_id\)/u);
  assert.match(
    migration,
    /from public\.free_beta_access[\s\S]*access_program = 'founding_beta_2026'/u,
  );
  assert.match(migration, /return true;[\s\S]*from public\.subscriptions/u);
  assert.match(migration, /from public\.subscriptions[\s\S]*source in \('manual_payment', 'admin_adjustment', 'migration'\)/u);
  assert.match(migration, /from public\.payment_requests[\s\S]*provisional_access_expires_at/u);
  assert.doesNotMatch(migration, /phase4_access_snapshot\(/u, 'The stable helper must not invoke the mutating access snapshot.');
  assert.match(migration, /statement_timestamp\(\)/u);
});

test('Forecast database access remains service-only', () => {
  assert.match(
    migration,
    /revoke all on function public\.dd2026_bar_forecast_access_allowed\(uuid\)[\s\S]*from public, anon, authenticated/iu,
  );
  assert.match(
    migration,
    /grant execute on function public\.dd2026_bar_forecast_access_allowed\(uuid\)[\s\S]*to service_role/iu,
  );
  assert.doesNotMatch(migration, /grant execute[\s\S]*to (?:anon|authenticated)/iu);
});

test('the follow-up repair migration preserves the read-only helper contract', () => {
  assert.match(repairMigration, /create or replace function public\.dd2026_bar_forecast_access_allowed/iu);
  assert.match(repairMigration, /stable[\s\S]*security definer[\s\S]*set search_path = ''/iu);
  assert.doesNotMatch(repairMigration, /phase4_access_snapshot\(/u);
  assert.match(repairMigration, /from public\.free_beta_access[\s\S]*founding_beta_2026/u);
  assert.match(repairMigration, /from public\.subscriptions[\s\S]*manual_payment/u);
  assert.match(repairMigration, /from public\.payment_requests[\s\S]*provisional_access_expires_at/u);
  assert.match(
    repairMigration,
    /revoke all on function public\.dd2026_bar_forecast_access_allowed\(uuid\)[\s\S]*grant execute on function public\.dd2026_bar_forecast_access_allowed\(uuid\)[\s\S]*to service_role/iu,
  );
});
