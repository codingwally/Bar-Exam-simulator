import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migrationPath = new URL(
  '../supabase/migrations/20260730_005_phase4_access_subscriptions.sql',
  import.meta.url,
);
const migration = readFileSync(migrationPath, 'utf8');
const worker = readFileSync(new URL('../worker/index.mjs', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const shellExperience = readFileSync(new URL('../assets/phase2-experience.js', import.meta.url), 'utf8');
const config = readFileSync(new URL('../assets/phase2-config.js', import.meta.url), 'utf8');

for (const table of [
  'platform_access_settings',
  'ai_improvement_consents',
  'access_trials',
  'lifetime_grade_usage',
  'grade_reservations',
  'free_beta_access',
  'free_beta_access_history',
  'subscriptions',
  'subscription_history',
]) {
  assert.match(migration, new RegExp(`public\\.${table}\\b`), `${table} must be created or hardened`);
}

for (const fn of [
  'phase4_access_snapshot',
  'phase4_reserve_grade',
  'phase4_finalize_grade',
  'phase4_release_grade',
]) {
  assert.match(migration, new RegExp(`function public\\.${fn}\\b`));
  assert.match(migration, new RegExp(`grant execute on function public\\.${fn}`));
  assert.match(migration, new RegExp(`to service_role;`));
}

assert.match(migration, /trial_duration_hours\s+integer[\s\S]*check \(trial_duration_hours = 72\)/);
assert.match(migration, /lifetime_free_grades\s+integer[\s\S]*check \(lifetime_free_grades = 3\)/);
assert.match(migration, /pg_advisory_xact_lock/);
assert.match(migration, /on conflict \(user_id\) do nothing/);
assert.match(migration, /role in \('student', 'admin', 'founder_admin', 'super_admin'\)/);
assert.match(migration, /status = 'active'[\s\S]*checkout_enabled = true/);
assert.match(migration, /status = 'disabled'[\s\S]*checkout_enabled = false/);
assert.doesNotMatch(migration, /ceo@|gmail\.com|founders?@/i);

assert.match(worker, /embeddedWebsiteQuestionBank/);
assert.match(worker, /pathname === '\/exam\/question'/);
assert.match(worker, /phase4_reserve_grade/);
assert.match(frontend, /loadProtectedQuestion/);
assert.match(frontend, /AUTHENTICATION_REQUIRED/);
assert.match(
  shellExperience,
  /state\.user = state\.session\?\.user \|\| null;\s*syncAuthUi\(\);[\s\S]*?if \(state\.user\) closeEntry\(\);/,
  'A restored session must close a stale guest or sign-in gate.',
);
assert.match(
  shellExperience,
  /dispatchEvent\(new CustomEvent\('duediligence:session'/,
  'The protected exam layer must be notified after a persisted auth session is restored.',
);
assert.match(
  shellExperience,
  /if \(session && \['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED'\]\.includes\(event\)\) \{\s*closeEntry\(\);/,
  'Verified auth events must close a stale guest gate.',
);
assert.match(config, /terms-commercial-v1-2026-08-18/);
assert.match(config, /privacy-commercial-v1-2026-08-18/);
assert.match(config, /subscriptionEnforcement:\s*true/);

console.log('Phase 4 Release 1 contract checks passed.');
