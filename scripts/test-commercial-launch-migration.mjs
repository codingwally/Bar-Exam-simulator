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
const legalPolicyMigration = readFileSync(new URL(
  '../supabase/migrations/20260818062500_current_legal_policy_contract.sql',
  import.meta.url,
), 'utf8');
const legalAcceptanceMigration = readFileSync(new URL(
  '../supabase/migrations/20260818070000_authenticated_legal_acceptance_bridge.sql',
  import.meta.url,
), 'utf8');

function functionBlock(source, name, occurrence = 0) {
  const marker = `create or replace function public.${name}`;
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(marker, from);
    assert.notEqual(start, -1, `${name} function occurrence ${occurrence + 1} must exist`);
    from = start + marker.length;
  }
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} function must have a complete SQL body`);
  return source.slice(start, end + 4);
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
  assert.doesNotMatch(source, /^\s*(?:truncate\s+table)\b/gmi);
}

test('commercial foundation remains additive, transactional, and installs disabled', () => {
  assertTransactional(foundation, 'commercial foundation');
  assert.doesNotMatch(foundation, /^\s*drop\s+table\b/gmi);
  assert.match(foundation, /commercial_launch_enabled boolean not null default false/);
  assert.match(foundation, /public_pricing_enabled boolean not null default false/);
  assert.match(foundation, /quota_timezone text not null default 'Asia\/Manila'/);
});

test('two-option corrective migration is transactional and installs its gate disabled', () => {
  assertTransactional(accessChoice, 'two-option correction');
  assert.match(
    accessChoice,
    /mandatory_access_choice_enabled boolean not null default false/,
  );
  assert.match(
    accessChoice,
    /set mandatory_access_choice_enabled = false/,
  );
  assert.match(
    accessChoice,
    /launch_trial_ends_at[\s\S]*'2026-09-01 23:59:59\+08'/,
  );
  assert.doesNotMatch(accessChoice, /^\s*drop\s+table\b/gmi);
});

test('current legal policy is server-authoritative, non-sensitive, and least privilege', () => {
  assertTransactional(legalPolicyMigration, 'legal policy');
  assert.doesNotMatch(legalPolicyMigration, /^\s*(?:drop|truncate|delete|update|insert)\b/gmi);
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

test('current legal acceptance is backend-only, user-bound, and idempotent', () => {
  assertTransactional(legalAcceptanceMigration, 'legal acceptance');
  assert.doesNotMatch(legalAcceptanceMigration, /^\s*(?:drop|truncate|delete|update)\b/gmi);
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
  assert.match(foundation, /where plan_code = 'early_access_beta'/);
  assert.match(foundation, /price_php = 149\.00/);
  assert.match(foundation, /duration_days = null/);
  assert.match(foundation, /One-time payment\. No automatic renewal/);
});

test('public catalog exposes the required Free Trial and ₱149 Early Access choices', () => {
  const catalog = functionBlock(accessChoice, 'phase4_plan_catalog');
  assert.match(catalog, /'planCode', 'free'/);
  assert.match(catalog, /'name', 'Free Trial'/);
  assert.match(catalog, /'priceCentavos', 0/);
  assert.match(catalog, /'billing', 'fixed_launch_trial'/);
  assert.match(catalog, /September 1, 2026 at 11:59 PM Philippine time/);
  assert.match(catalog, /'planCode', 'early_access_beta'/);
  assert.match(catalog, /'priceCentavos', 14900/);
  assert.match(catalog, /'billing', 'one_time'/);
  assert.match(catalog, /October 1, 2026/);
  assert.doesNotMatch(catalog, /'planCode',\s*'(?:standard|premium)'/);
});

test('ordinary commercial access precedence ends in explicit choice, not automatic daily free', () => {
  const snapshot = functionBlock(accessChoice, 'phase4_access_snapshot');
  assertInOrder(snapshot, [
    "v_role = 'super_admin'",
    "v_role = 'founder_admin'",
    'v_settings.global_beta_all_access_enabled',
    'v_settings.commercial_launch_enabled',
  ], 'top-level access precedence');
  assertInOrder(snapshot, [
    "v_beta.access_program = 'founding_beta_2026'",
    'v_subscription.id is not null',
    'v_payment.id is not null',
    'v_settings.mandatory_access_choice_enabled',
    "v_basis := 'launch_trial'",
    "v_basis := 'trial_expired'",
    "v_basis := 'plan_selection_required'",
  ], 'commercial access precedence');
  assert.match(snapshot, /'choiceRequired'/);
  assert.match(snapshot, /'trialAvailable'/);
  assert.match(snapshot, /'mandatoryAccessChoiceEnabled'/);
  assert.match(snapshot, /'dailyLimit'[\s\S]*when v_settings\.commercial_launch_enabled then 0/);
  assert.match(snapshot, /'remainingToday'[\s\S]*when v_settings\.commercial_launch_enabled then 0/);
  assert.doesNotMatch(snapshot, /v_basis\s*:=\s*'daily_free'/);
  assert.doesNotMatch(snapshot, /daily_limit_reached/);
});

test('Free Trial can start only through the explicit trusted choice function', () => {
  const chooseTrial = functionBlock(accessChoice, 'phase4_choose_launch_trial');
  assert.match(chooseTrial, /p_request_key !~ '\^\[A-Za-z0-9_-\]\{16,128\}\$'/);
  assert.match(chooseTrial, /mandatory_access_choice_enabled/);
  assert.match(chooseTrial, /Current Terms and Privacy acceptance is required/);
  assert.match(chooseTrial, /Complete the required profile before choosing access/);
  assert.match(chooseTrial, /trial_program = 'commercial_launch_2026'/);
  assert.match(chooseTrial, /v_settings\.launch_trial_ends_at/);
  assert.match(chooseTrial, /The Free Trial has already been used/);
  assert.match(chooseTrial, /return public\.phase4_access_snapshot/);

  const snapshot = functionBlock(accessChoice, 'phase4_access_snapshot');
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
  const reserve = functionBlock(foundation, 'phase4_reserve_grade_v2');
  const batch = functionBlock(foundation, 'phase4_reserve_submission_batch');
  const finalize = functionBlock(foundation, 'phase4_finalize_submission_batch');

  for (const track of [
    'bar_practice', 'subject_matter', 'mock_bar', 'bar_feels',
    'quiz', 'doctrine_review', 'examination_room',
  ]) assert.match(reserve, new RegExp(`'${track}'`));

  assert.match(reserve, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 401\)\)/);
  assert.match(reserve, /where request_key = p_request_key for update/);
  assert.match(reserve, /v_existing\.status in \('reserved','completed'\)/);
  assert.match(reserve, /status = 'expired'[\s\S]*release_reason = 'reservation_timeout'/);
  assert.match(batch, /p_required_count not between 1 and 100/);
  assert.match(batch, /reservation_expires_at[\s\S]*v_now \+ interval '6 hours'/);
  assert.match(finalize, /batch_ordinal <= p_completed_count and status = 'reserved'/);
  assert.match(finalize, /batch_ordinal > p_completed_count and status = 'reserved'/);
});

test('failed grading releases safely and successful grading finalizes once', () => {
  const reserve = functionBlock(foundation, 'phase4_reserve_grade_v2');
  const finalize = functionBlock(foundation, 'phase4_finalize_grade');
  assert.match(
    reserve,
    /v_existing\.status in \('released','expired'\)[\s\S]*'provider_capacity'[\s\S]*'provider_rate_limit'[\s\S]*'provider_timeout'[\s\S]*'provider_unavailable'[\s\S]*'grading_failed'[\s\S]*'network_failure'/,
  );
  assert.match(finalize, /if v_reservation\.status <> 'reserved' then/);
  assert.match(finalize, /set status = 'completed', completed_at = v_now/);
});

test('Founding Beta roster stores hashes only and remains server controlled', () => {
  assert.match(foundation, /create table if not exists public\.founding_beta_invites/);
  assert.match(foundation, /email_hash text primary key/);
  assert.match(foundation, /force row level security/);
  assert.doesNotMatch(
    foundation,
    /[A-Z0-9._%+-]+@gmail\.com\b/i,
    'Founding Beta Gmail addresses must never be committed in plaintext.',
  );
  const roster = foundation.match(
    /from unnest\(array\[([\s\S]*?)\]::text\[\]\) as roster\(email_hash\)/,
  )?.[1] || '';
  const hashes = [...roster.matchAll(/'([0-9a-f]{64})'/g)].map((match) => match[1]);
  assert.equal(hashes.length, 18);
  assert.equal(new Set(hashes).size, 18);
});

test('payment proof remains one-time provisional access with fixed paid expiry', () => {
  const payment = functionBlock(foundation, 'phase4_create_payment_request');
  const review = functionBlock(foundation, 'phase4_admin_review_payment');
  assert.match(payment, /p_plan_code[\s\S]*<> 'early_access_beta'/);
  assert.match(payment, /round\(coalesce\(p_amount_php, 0\), 2\) <> 149\.00/);
  assert.match(payment, /v_now > v_settings\.early_access_sales_close_at/);
  assertInOrder(payment, [
    'where request_key = p_request_key',
    "where user_id = p_user_id and plan_code = 'early_access_beta'",
    'insert into public.payment_requests',
  ], 'payment idempotency checks');
  assert.match(payment, /v_now \+ interval '24 hours'/);
  assert.match(review, /v_settings\.early_access_entitlement_ends_at/);
  assert.match(review, /v_status = 'rejected'[\s\S]*provisional_access_revoked_at/);
});

test('refund contract preserves the seven-day prorated formula', () => {
  const refund = functionBlock(foundation, 'phase4_create_refund_request');
  assert.match(
    refund,
    /public\.phase4_ph_date\(v_now\) > public\.phase4_ph_date\(v_start\) \+ 6/,
  );
  assert.match(
    refund,
    /149\.00 \* v_unused_seconds \/ v_total_seconds/,
  );
  assert.match(
    refund,
    /provisional_access_revoked_at = coalesce\(provisional_access_revoked_at, v_now\)/,
  );
  assert.match(refund, /set status = 'cancelled'/);
});

test('commercial onboarding cannot grant an application role', () => {
  const onboarding = functionBlock(foundation, 'complete_commercial_profile_onboarding');
  assert.match(onboarding, /auth\.uid\(\)/);
  assert.match(onboarding, /'first_year','second_year','third_year','fourth_year','fifth_year','review','professor'/);
  assert.match(onboarding, /insert into public\.professor_license_declarations/);
  assert.doesNotMatch(
    onboarding,
    /user_roles|founder_admin|super_admin|insert\s+into\s+public\.subscriptions/i,
  );
});

test('Examination Room still reserves immutable question count before entry', () => {
  const hold = functionBlock(foundation, 'phase4_prepare_exam_room_hold');
  const start = functionBlock(foundation, 'exam_room_start_attempt_commercial_v1');
  const trigger = functionBlock(foundation, 'phase4_finalize_exam_room_quota_on_submission');
  assert.match(hold, /phase4_reserve_submission_batch\([\s\S]*'examination_room'/);
  assertInOrder(start, [
    'exam_room_student_waiting_room_v4',
    'phase4_prepare_exam_room_hold',
    'exam_room_start_attempt_v4',
    'phase4_extend_exam_room_hold',
  ], 'direct Examination Room entry');
  assert.match(trigger, /jsonb_array_elements\(coalesce\(new\.answer_snapshot/);
  assert.match(trigger, /phase4_finalize_submission_batch/);
});

test('new access-choice functions remain least privilege', () => {
  for (const signature of [
    'phase4_choose_launch_trial\(uuid, text\)',
    'phase4_access_snapshot\(uuid, boolean, text\)',
    'phase4_plan_catalog\(\)',
  ]) {
    assert.match(
      accessChoice,
      new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`),
    );
    assert.match(
      accessChoice,
      new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to service_role`),
    );
  }
});

console.log('Commercial launch and two-option access migration contract checks passed.');
