import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const foundation = readFileSync(new URL(
  '../supabase/migrations/20260818024644_commercial_launch_access.sql',
  import.meta.url,
), 'utf8');
const accessChoice = readFileSync(new URL(
  '../supabase/migrations/20260818133000_restore_two_option_access_choice.sql',
  import.meta.url,
), 'utf8');
const dailyChoice = readFileSync(new URL(
  '../supabase/migrations/20260818143000_free_trial_five_daily_choice.sql',
  import.meta.url,
), 'utf8');
const legalPolicyMigration = readFileSync(new URL(
  '../supabase/migrations/20260818062500_current_legal_policy_contract.sql',
  import.meta.url,
), 'utf8');
const legalAcceptanceMigration = readFileSync(new URL(
  '../supabase/migrations/20260818070000_authenticated_legal_acceptance_bridge.sql',
  import.meta.url,
), 'utf8');

function sectionBetween(source, startName, nextName = null) {
  const startMarker = `create or replace function public.${startName}`;
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `${startName} function must exist`);
  if (!nextName) return source.slice(start);
  const nextMarker = `create or replace function public.${nextName}`;
  const end = source.indexOf(nextMarker, start + startMarker.length);
  assert.notEqual(end, -1, `${nextName} must follow ${startName}`);
  return source.slice(start, end);
}

function assertInOrder(source, markers, message) {
  let cursor = -1;
  for (const marker of markers) {
    const next = source.indexOf(marker, cursor + 1);
    assert.notEqual(next, -1, `${message}: missing ${marker}`);
    assert.ok(next > cursor, `${message}: ${marker} is out of order`);
    cursor = next;
  }
}

function assertTransactional(source, label) {
  assert.equal((source.match(/^begin;$/gmi) || []).length, 1, `${label} begins once`);
  assert.equal((source.match(/^commit;$/gmi) || []).length, 1, `${label} commits once`);
  assert.doesNotMatch(source, /^\s*truncate\s+table\b/gmi);
}

test('commercial foundation remains additive, transactional, and installs disabled', () => {
  assertTransactional(foundation, 'commercial foundation');
  assert.doesNotMatch(foundation, /^\s*drop\s+table\b/gmi);
  assert.match(foundation, /commercial_launch_enabled boolean not null default false/);
  assert.match(foundation, /public_pricing_enabled boolean not null default false/);
  assert.match(foundation, /quota_timezone text not null default 'Asia\/Manila'/);
});

test('two-option migration installs its gate disabled for a safe rolling release', () => {
  assertTransactional(accessChoice, 'two-option correction');
  assert.match(accessChoice, /mandatory_access_choice_enabled boolean not null default false/);
  assert.match(accessChoice, /set mandatory_access_choice_enabled = false/);
  assert.match(
    accessChoice,
    /launch_trial_ends_at[\s\S]*'2026-09-01 23:59:59\+08'/,
  );
  assert.doesNotMatch(accessChoice, /^\s*drop\s+table\b/gmi);
});

test('five-daily correction is transactional and preserves existing choices', () => {
  assertTransactional(dailyChoice, 'five-daily correction');
  assert.match(dailyChoice, /free_daily_grade_limit = 5/);
  assert.match(dailyChoice, /commercial_access_choices/);
  assert.match(dailyChoice, /trial_program = 'commercial_launch_2026'/);
  assert.match(dailyChoice, /phase4_access_snapshot_pre_five_daily_choice/);
  assert.doesNotMatch(dailyChoice, /^\s*drop\s+table\b/gmi);
});

test('current legal policy is server-authoritative and least privilege', () => {
  assertTransactional(legalPolicyMigration, 'legal policy');
  assert.match(legalPolicyMigration, /'termsVersion', s\.current_terms_version/);
  assert.match(legalPolicyMigration, /'privacyVersion', s\.current_privacy_version/);
  assert.match(legalPolicyMigration, /'commercialLaunchEnabled', s\.commercial_launch_enabled/);
  assert.match(
    legalPolicyMigration,
    /revoke all on function public\.phase4_global_beta_public_policy\(\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    legalPolicyMigration,
    /grant execute on function public\.phase4_global_beta_public_policy\(\)[\s\S]*to service_role/,
  );
});

test('current legal acceptance is user-bound and idempotent', () => {
  assertTransactional(legalAcceptanceMigration, 'legal acceptance');
  assert.match(legalAcceptanceMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(legalAcceptanceMigration, /where u\.id = p_user_id/);
  assert.match(legalAcceptanceMigration, /s\.current_terms_version/);
  assert.match(legalAcceptanceMigration, /s\.current_privacy_version/);
  assert.match(
    legalAcceptanceMigration,
    /on conflict \(user_id, terms_version, privacy_version\) do nothing/,
  );
});

test('approved dates, price, and commercial legal versions remain fixed', () => {
  assert.match(foundation, /early_access_sales_close_at[\s\S]*'2026-09-01 23:59:59\+08'/);
  assert.match(foundation, /early_access_entitlement_ends_at[\s\S]*'2026-10-01 23:59:59\+08'/);
  assert.match(foundation, /commercial_terms_version[\s\S]*'terms-commercial-v1-2026-08-18'/);
  assert.match(foundation, /commercial_privacy_version[\s\S]*'privacy-commercial-v1-2026-08-18'/);
  assert.match(foundation, /price_php = 149\.00/);
  assert.match(foundation, /One-time payment\. No automatic renewal/);
});

test('public catalog exposes five-daily Free Trial and ₱149 Early Access', () => {
  const catalog = sectionBetween(dailyChoice, 'phase4_plan_catalog');
  assert.match(catalog, /'planCode', 'free'/);
  assert.match(catalog, /'name', 'Free Trial'/);
  assert.match(catalog, /'priceCentavos', 0/);
  assert.match(catalog, /'billing', 'daily_free_trial'/);
  assert.match(catalog, /five protected question submissions per Philippine calendar day/i);
  assert.match(catalog, /Allowance resets at midnight in Asia\/Manila/);
  assert.match(catalog, /'planCode', 'early_access_beta'/);
  assert.match(catalog, /'priceCentavos', 14900/);
  assert.match(catalog, /'billing', 'one_time'/);
  assert.match(catalog, /October 1, 2026/);
  assert.doesNotMatch(catalog, /'planCode',\s*'(?:standard|premium)'/);
});

test('ordinary commercial access requires choice before daily Free Trial', () => {
  const snapshot = sectionBetween(
    dailyChoice,
    'phase4_access_snapshot',
    'phase4_plan_catalog',
  );
  assert.match(snapshot, /v_trial_selected/);
  assert.match(snapshot, /v_trial_active/);
  assert.match(snapshot, /v_settings\.free_daily_grade_limit - v_used/);
  assertInOrder(snapshot, [
    "if v_trial_active then",
    "when v_remaining > 0 then 'daily_free'",
    "else 'daily_limit_reached'",
    "if v_trial_selected then",
    "'basis', 'trial_expired'",
    "'basis', 'plan_selection_required'",
  ], 'explicit Free Trial precedence');
  assert.match(snapshot, /'choiceRequired'/);
  assert.match(snapshot, /'trialAvailable'/);
  assert.match(snapshot, /'mandatoryAccessChoiceEnabled'/);
  assert.match(snapshot, /'dailyLimit', v_settings\.free_daily_grade_limit/);
  assert.match(snapshot, /'remainingToday', v_remaining/);
  assert.match(snapshot, /'unlimited', false/);
  assert.doesNotMatch(
    snapshot,
    /if v_trial_active then[\s\S]*'unlimited', true/,
  );
});

test('Free Trial starts only through the explicit trusted choice function', () => {
  const chooseTrial = sectionBetween(
    accessChoice,
    'phase4_choose_launch_trial',
    'phase4_access_snapshot',
  );
  assert.match(chooseTrial, /mandatory_access_choice_enabled/);
  assert.match(chooseTrial, /Current Terms and Privacy acceptance is required/);
  assert.match(chooseTrial, /Complete the required profile before choosing access/);
  assert.match(chooseTrial, /trial_program = 'commercial_launch_2026'/);
  assert.match(chooseTrial, /v_settings\.launch_trial_ends_at/);
  assert.match(chooseTrial, /The Free Trial has already been used/);
  assert.match(chooseTrial, /return public\.phase4_access_snapshot/);

  const snapshot = sectionBetween(
    accessChoice,
    'phase4_access_snapshot',
    'phase4_plan_catalog',
  );
  assert.match(
    snapshot,
    /if p_activate_trial and v_terms_ok and not v_settings\.commercial_launch_enabled/,
  );
  assert.doesNotMatch(
    snapshot,
    /if p_activate_trial and v_terms_ok and v_settings\.commercial_launch_enabled/,
  );
});

test('single and multi-question reservations remain atomic and replay-safe', () => {
  assert.match(
    foundation,
    /create or replace function public\.phase4_reserve_grade_v2[\s\S]*pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 401\)\)/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_reserve_submission_batch[\s\S]*p_required_count not between 1 and 100/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_reserve_submission_batch[\s\S]*v_now \+ interval '6 hours'/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_finalize_submission_batch[\s\S]*batch_ordinal <= p_completed_count and status = 'reserved'/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_finalize_submission_batch[\s\S]*batch_ordinal > p_completed_count and status = 'reserved'/,
  );
});

test('failed grading releases safely and successful grading finalizes once', () => {
  assert.match(
    foundation,
    /'provider_capacity'[\s\S]*'provider_rate_limit'[\s\S]*'provider_timeout'[\s\S]*'provider_unavailable'[\s\S]*'grading_failed'[\s\S]*'network_failure'/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_finalize_grade[\s\S]*if v_reservation\.status <> 'reserved' then/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_finalize_grade[\s\S]*set status = 'completed', completed_at = v_now/,
  );
});

test('Founding Beta roster stores hashes only and remains server controlled', () => {
  assert.match(foundation, /create table if not exists public\.founding_beta_invites/);
  assert.match(foundation, /email_hash text primary key/);
  assert.match(foundation, /force row level security/);
  assert.doesNotMatch(foundation, /[A-Z0-9._%+-]+@gmail\.com\b/i);
  const roster = foundation.match(
    /from unnest\(array\[([\s\S]*?)\]::text\[\]\) as roster\(email_hash\)/,
  )?.[1] || '';
  const hashes = [...roster.matchAll(/'([0-9a-f]{64})'/g)].map((match) => match[1]);
  assert.equal(hashes.length, 18);
  assert.equal(new Set(hashes).size, 18);
});

test('payment proof remains one-time provisional access with fixed paid expiry', () => {
  assert.match(
    foundation,
    /create or replace function public\.phase4_create_payment_request[\s\S]*round\(coalesce\(p_amount_php, 0\), 2\) <> 149\.00/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_create_payment_request[\s\S]*v_now \+ interval '24 hours'/,
  );
  assert.match(
    foundation,
    /create or replace function public\.phase4_admin_review_payment[\s\S]*v_settings\.early_access_entitlement_ends_at/,
  );
});

test('refund contract preserves the seven-day prorated formula', () => {
  assert.match(
    foundation,
    /create or replace function public\.phase4_create_refund_request[\s\S]*public\.phase4_ph_date\(v_now\) > public\.phase4_ph_date\(v_start\) \+ 6/,
  );
  assert.match(foundation, /149\.00 \* v_unused_seconds \/ v_total_seconds/);
  assert.match(
    foundation,
    /provisional_access_revoked_at = coalesce\(provisional_access_revoked_at, v_now\)/,
  );
});

test('commercial onboarding cannot grant an application role', () => {
  const onboarding = sectionBetween(
    foundation,
    'complete_commercial_profile_onboarding',
    'phase4_activate_commercial_launch',
  );
  assert.match(onboarding, /auth\.uid\(\)/);
  assert.match(onboarding, /insert into public\.professor_license_declarations/);
  assert.doesNotMatch(
    onboarding,
    /user_roles|founder_admin|super_admin|insert\s+into\s+public\.subscriptions/i,
  );
});

test('Examination Room still reserves immutable question count before entry', () => {
  assert.match(
    foundation,
    /create or replace function public\.phase4_prepare_exam_room_hold[\s\S]*phase4_reserve_submission_batch\([\s\S]*'examination_room'/,
  );
  assert.match(
    foundation,
    /create or replace function public\.exam_room_start_attempt_commercial_v1[\s\S]*exam_room_student_waiting_room_v4[\s\S]*phase4_prepare_exam_room_hold[\s\S]*exam_room_start_attempt_v4[\s\S]*phase4_extend_exam_room_hold/,
  );
});

test('new access-choice functions remain least privilege', () => {
  assert.match(
    accessChoice,
    /revoke all on function public\.phase4_choose_launch_trial\(uuid, text\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    accessChoice,
    /grant execute on function public\.phase4_choose_launch_trial\(uuid, text\)[\s\S]*to service_role/,
  );
  for (const signature of [
    'phase4_access_snapshot_pre_five_daily_choice\\s*\\(\\s*uuid\\s*,\\s*boolean\\s*,\\s*text\\s*\\)',
    'phase4_access_snapshot\\s*\\(\\s*uuid\\s*,\\s*boolean\\s*,\\s*text\\s*\\)',
    'phase4_plan_catalog\\s*\\(\\s*\\)',
  ]) {
    assert.match(
      dailyChoice,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`),
    );
    assert.match(
      dailyChoice,
      new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to service_role`),
    );
  }
});

console.log('Commercial launch and five-daily access-choice migration contract checks passed.');
