import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260818113000_require_access_choice_and_payment_notifications.sql',
  import.meta.url,
), 'utf8');
const wrapper = readFileSync(new URL('../worker/commercial-hotfix-wrapper.mjs', import.meta.url), 'utf8');
const accessCore = readFileSync(new URL('../worker/access-core.mjs', import.meta.url), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const productionConfig = readFileSync(new URL('../worker/wrangler.toml', import.meta.url), 'utf8');
const stagingConfig = readFileSync(new URL('../worker/wrangler.staging.toml', import.meta.url), 'utf8');

function functionBlock(name) {
  const marker = `create or replace function public.${name}`;
  const start = migration.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} must have a complete SQL body`);
  return migration.slice(start, end + 4);
}

test('migration installs the mandatory choice behind a disabled activation flag', () => {
  assert.match(migration, /mandatory_access_choice_enabled boolean not null default false/);
  assert.match(migration, /launch_trial_ends_at timestamptz not null[\s\S]*2026-09-01 23:59:59\+08/);
  assert.match(migration, /trial_program in \('legacy', 'commercial_launch_2026'\)/);
  assert.match(migration, /'launch_trial'/);
});

test('commercial access resolver denies untouched accounts and preserves privileged precedence', () => {
  const snapshot = functionBlock('phase4_access_snapshot');
  assert.match(snapshot, /v_role = 'super_admin'/);
  assert.match(snapshot, /v_role = 'founder_admin'/);
  assert.match(snapshot, /v_settings\.global_beta_all_access_enabled/);
  assert.match(snapshot, /v_beta\.access_program = 'founding_beta_2026'/);
  assert.match(snapshot, /v_subscription\.id is not null/);
  assert.match(snapshot, /v_payment\.id is not null/);
  assert.match(snapshot, /v_basis := 'launch_trial'/);
  assert.match(snapshot, /v_basis := 'plan_selection_required'/);
  assert.match(snapshot, /'choiceRequired'/);
  assert.match(snapshot, /'remainingToday',[\s\S]*when not v_allowed then 0/);
});

test('launch trial is explicit, fixed-date, one-use, and service-role only', () => {
  const choose = functionBlock('phase4_choose_launch_trial');
  assert.match(choose, /mandatory_access_choice_enabled/);
  assert.match(choose, /Current Terms and Privacy acceptance is required/);
  assert.match(choose, /Complete the required profile/);
  assert.match(choose, /trial_program[\s\S]*'commercial_launch_2026'/);
  assert.match(choose, /The launch trial has already been used/);
  assert.match(migration, /revoke all on function public\.phase4_choose_launch_trial\(uuid, text\)[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.phase4_choose_launch_trial\(uuid, text\) to service_role/);
});

test('public catalog shows only Launch Trial and ₱149 Early Access when activated', () => {
  const catalog = functionBlock('phase4_plan_catalog');
  assert.match(catalog, /'name',[\s\S]*'Launch Trial'/);
  assert.match(catalog, /'billing',[\s\S]*'fixed_trial'/);
  assert.match(catalog, /'pricePhp', 149/);
  assert.match(catalog, /'billing', 'one_time'/);
  assert.doesNotMatch(catalog, /'planCode',\s*'(?:standard|premium)'/);
});

test('payment verifier data and delivery queue are private and retryable', () => {
  assert.match(migration, /create table if not exists public\.payment_verifier_recipients/);
  assert.match(migration, /create table if not exists public\.payment_notification_deliveries/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.payment_verifier_recipients from public, anon, authenticated/);
  assert.match(migration, /phase4_enqueue_payment_notification_trigger/);
  assert.match(migration, /for update skip locked/);
  assert.match(migration, /phase4_complete_payment_notification/);
  assert.match(migration, /phase4_fail_payment_notification/);
  assert.doesNotMatch(migration, /@gmail\.com/i);
});

test('Worker wrapper owns trial selection and sends attached proofs through Resend', () => {
  assert.match(wrapper, /TRIAL_ENDPOINT = '\/access\/choose-trial'/);
  assert.match(wrapper, /phase4_choose_launch_trial/);
  assert.match(wrapper, /phase4_claim_payment_notification/);
  assert.match(wrapper, /attachments:\s*\[\{/);
  assert.match(wrapper, /bytesToBase64/);
  assert.match(wrapper, /Idempotency-Key/);
  assert.match(wrapper, /bcc/);
  assert.match(wrapper, /processPendingPaymentNotifications/);
  assert.doesNotMatch(wrapper, /@gmail\.com/i);
});

test('frontend makes both access paths actionable and keeps the mandatory gate server-backed', () => {
  assert.match(frontend, /Use free trial until September 1/);
  assert.match(frontend, /\/access\/choose-trial/);
  assert.match(frontend, /plan_selection_required/);
  assert.match(frontend, /trial_expired/);
  assert.match(frontend, /dd4-clickable-plan/);
  assert.match(frontend, /#dd2-native-close, #dd2-native-back/);
  assert.match(frontend, /loadProtectedQuestion[\s\S]*refreshAccess\(\)[\s\S]*!access\?\.allowed/);
});

test('normalizer preserves zero-credit locked states and explicit choice errors', () => {
  assert.match(accessCore, /Math\.max\(\s*0,[\s\S]*rawDailyLimit/);
  assert.match(accessCore, /PLAN_SELECTION_REQUIRED/);
  assert.match(accessCore, /TRIAL_EXPIRED/);
  assert.match(accessCore, /PROFILE_REQUIRED/);
  assert.match(accessCore, /mandatoryAccessChoiceEnabled/);
});

test('production enables payment notification while staging suppresses delivery', () => {
  assert.match(productionConfig, /main = "commercial-hotfix-wrapper\.mjs"/);
  assert.match(productionConfig, /PAYMENT_NOTIFICATION_EMAIL_MODE = "enabled"/);
  assert.match(stagingConfig, /main = "commercial-hotfix-wrapper\.mjs"/);
  assert.match(stagingConfig, /PAYMENT_NOTIFICATION_EMAIL_MODE = "suppressed"/);
});
