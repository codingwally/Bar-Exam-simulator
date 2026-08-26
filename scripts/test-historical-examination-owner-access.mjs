import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const restorationMigration = await readFile(new URL(
  '../supabase/migrations/20260827113000_restore_historical_examination_owner_access.sql',
  import.meta.url,
), 'utf8');
const tighteningMigration = await readFile(new URL(
  '../supabase/migrations/20260827133000_require_historical_examination_track.sql',
  import.meta.url,
), 'utf8');
const behavioralTest = await readFile(new URL(
  '../supabase/tests/20260827_038_historical_examination_owner_access_test.sql',
  import.meta.url,
), 'utf8');

test('historical owner access remains narrow, owner-bound, and transactional', () => {
  for (const migration of [restorationMigration, tighteningMigration]) {
    assert.equal((migration.match(/^begin;$/gmi) || []).length, 1);
    assert.equal((migration.match(/^commit;$/gmi) || []).length, 1);
    assert.doesNotMatch(migration, /^\s*(?:drop\s+table|truncate|delete\s+from)\b/gmi);
    assert.match(migration, /attempt\.user_id = p_user_id/);
    assert.match(migration, /definition\.track = v_track/);
    assert.match(migration, /v_track in \('per_subject', 'bar_feels'\)/);
    assert.match(migration, /'basis', 'historical_owner'/);
    assert.match(migration, /raise exception 'EXAM_ACCESS_REQUIRED'/);
  }
  for (const migration of [restorationMigration, tighteningMigration]) {
    assert.doesNotMatch(
      migration,
      /v_track is null and exists/,
      'Every production migration must be safe if a later migration never runs.',
    );
    assert.doesNotMatch(
      migration,
      /'basis', 'historical_owner',[\s\S]{0,120}'track', null/,
      'Historical access must never be granted without an owned attempt or explicit owned track.',
    );
  }
});

test('historical access cannot be invoked directly by browser roles', () => {
  assert.match(
    tighteningMigration,
    /revoke all on function public\.examination_authorize_access\([\s\S]*?from public, anon, authenticated;/,
  );
  assert.match(
    tighteningMigration,
    /grant execute on function public\.examination_authorize_access\([\s\S]*?to service_role;/,
  );
});

test('pgTAP exercises authorization behavior instead of source text alone', () => {
  assert.match(behavioralTest, /insert into auth\.users/);
  assert.match(behavioralTest, /insert into public\.examination_attempts_multi/);
  assert.match(behavioralTest, /another user cannot open an attempt they do not own/);
  assert.match(behavioralTest, /cannot use one track attempt to unlock another track/);
  assert.match(behavioralTest, /without an attempt or track is never unscoped/);
  assert.match(behavioralTest, /anonymous identity is denied/);
  assert.match(behavioralTest, /current valid entitlement still falls through/);
  assert.match(behavioralTest, /rollback;/);
});

test('release migrations do not write Supabase migration history directly', () => {
  assert.doesNotMatch(restorationMigration, /supabase_migrations\.schema_migrations/i);
  assert.doesNotMatch(tighteningMigration, /supabase_migrations\.schema_migrations/i);
});

console.log('Historical examination owner-access migration contract passed.');
