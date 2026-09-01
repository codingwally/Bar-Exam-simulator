import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migration = await readFile(
  new URL('../supabase/migrations/20260902090000_unlimited_forecast_access.sql', import.meta.url),
  'utf8',
);

test('Forecast database access follows the current server-authoritative unlimited snapshot', () => {
  assert.match(migration, /create or replace function public\.dd2026_bar_forecast_access_allowed/iu);
  assert.match(migration, /security definer[\s\S]*set search_path = ''/iu);
  assert.match(migration, /public\.dd2026_is_admin\(p_actor_user_id\)/u);
  assert.match(
    migration,
    /public\.phase4_access_snapshot\(p_actor_user_id, false, null\)/u,
  );
  assert.match(migration, /v_access ->> 'allowed'[\s\S]*v_access ->> 'unlimited'/u);
  assert.doesNotMatch(
    migration,
    /from public\.(?:subscriptions|free_beta_access)/iu,
    'Forecast must not maintain a narrower parallel list of unlimited entitlement sources.',
  );
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
