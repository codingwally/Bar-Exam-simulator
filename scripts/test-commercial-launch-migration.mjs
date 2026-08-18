import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const migration = readFileSync(new URL(
  '../supabase/migrations/20260818024644_commercial_launch_access.sql',
  import.meta.url,
), 'utf8');

function functionBlock(name, occurrence = 0) {
  const marker = `create or replace function public.${name}`;
  let start = -1;
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    start = migration.indexOf(marker, from);
    assert.notEqual(start, -1, `${name} function occurrence ${occurrence + 1} must exist`);
    from = start + marker.length;
  }
  const end = migration.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `${name} function must have a complete SQL body`);
  return migration.slice(start, end + 4);
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

test('commercial migration is transactional, additive, and installs disabled', () => {
  assert.equal((migration.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((migration.match(/^commit;$/gmi) || []).length, 1);
  assert.doesNotMatch(migration, /^\s*(?:drop\s+table|truncate\s+table)\b/gmi);
  assert.match(migration, /commercial_launch_enabled boolean not null default false/);
  assert.match(migration, /public_pricing_enabled boolean not null default false/);
  assert.match(migration, /free_daily_grade_limit integer not null default 5/);
  assert.match(migration, /quota_timezone text not null default 'Asia\/Manila'/);
});

test('launch dates, price, and legal versions are fixed to the approved policy', () => {
  assert.match(migration, /early_access_sales_close_at[\s\S]*'2026-09-01 23:59:59\+08'/);
  assert.match(migration, /early_access_entitlement_ends_at[\s\S]*'2026-10-01 23:59:59\+08'/);
  assert.match(migration, /commercial_terms_version[\s\S]*'terms-commercial-v1-2026-08-18'/);
  assert.match(migration, /commercial_privacy_version[\s\S]*'privacy-commercial-v1-2026-08-18'/);
  assert.match(migration, /where plan_code = 'early_access_beta'/);
  assert.match(migration, /price_php = 149\.00/);
  assert.match(migration, /duration_days = null/);
  assert.match(migration, /One-time payment\. No automatic renewal\. Later pricing is unannounced\./);
});

test('public catalog exposes only Free and one-time Early Access', () => {
  const catalog = functionBlock('phase4_plan_catalog');
  assert.match(catalog, /'planCode', 'free'[\s\S]*'priceCentavos', 0/);
  assert.match(catalog, /'planCode', 'early_access_beta'[\s\S]*'priceCentavos', 14900/);
  assert.match(catalog, /'billing', 'one_time'/);
  assert.match(catalog, /Next paid-plan pricing will be announced separately\./);
  assert.doesNotMatch(catalog, /'planCode',\s*'(?:standard|premium)'/);
  assert.match(
    migration,
    /set status = 'retired', checkout_enabled = false, promotional = false[\s\S]*where plan_code in \('standard', 'premium'\)/,
  );
  assert.match(
    migration,
    /where flag_key in \('VERDICT_PDF_PREMIUM_REQUIRED', 'AI_PREPARED_BETA_BADGE'\)/,
  );
});

test('single-question quota is atomic, cross-track, replay-safe, and counts active holds', () => {
  const reserve = functionBlock('phase4_reserve_grade_v2');
  for (const track of [
    'bar_practice', 'subject_matter', 'mock_bar', 'bar_feels',
    'quiz', 'doctrine_review', 'examination_room',
  ]) assert.match(reserve, new RegExp(`'${track}'`));
  assert.match(reserve, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 401\)\)/);
  assert.match(reserve, /where request_key = p_request_key for update/);
  assert.match(reserve, /v_existing\.status in \('reserved','completed'\)/);
  assert.match(reserve, /status = 'expired'[\s\S]*release_reason = 'reservation_timeout'/);
  assert.match(
    reserve,
    /\(status = 'completed' and usage_date_ph = public\.phase4_ph_date\(v_now\)\)[\s\S]*or \(status = 'reserved' and reservation_expires_at > v_now\)/,
  );
  assert.match(reserve, /if v_count >= v_settings\.free_daily_grade_limit/);
  assert.match(reserve, /'reason', 'daily_limit_reached'/);
  assert.match(reserve, /usage_date_ph = public\.phase4_ph_date\(v_now\)/);
  assert.match(reserve, /consumes_quota = v_consumes/);
});

test('failed grading can release and safely retry without consuming a use', () => {
  const reserve = functionBlock('phase4_reserve_grade_v2');
  const finalize = functionBlock('phase4_finalize_grade');
  assert.match(
    reserve,
    /v_existing\.status in \('released','expired'\)[\s\S]*'provider_capacity'[\s\S]*'provider_rate_limit'[\s\S]*'provider_timeout'[\s\S]*'provider_unavailable'[\s\S]*'grading_failed'[\s\S]*'network_failure'/,
  );
  assert.match(finalize, /if v_reservation\.status <> 'reserved' then/);
  assert.match(finalize, /set status = 'completed', completed_at = v_now/);
  assert.doesNotMatch(finalize, /status = 'completed'[\s\S]*before/i);
});

test('multi-question sessions reserve before entry and release every unused hold', () => {
  const reserve = functionBlock('phase4_reserve_submission_batch');
  const finalize = functionBlock('phase4_finalize_submission_batch');
  const release = functionBlock('phase4_release_submission_batch');
  assert.match(reserve, /p_required_count not between 1 and 100/);
  assert.match(reserve, /if v_used \+ p_required_count > v_settings\.free_daily_grade_limit/);
  assert.match(reserve, /'reason', 'insufficient_daily_allowance'/);
  assert.match(reserve, /reservation_expires_at[\s\S]*v_now \+ interval '6 hours'/);
  assert.match(finalize, /batch_ordinal <= p_completed_count and status = 'reserved'/);
  assert.match(finalize, /batch_ordinal > p_completed_count and status = 'reserved'/);
  assert.match(finalize, /'releasedCount', v_released/);
  assert.match(release, /where user_id = p_user_id and session_request_key = p_session_request_key[\s\S]*and status = 'reserved'/);
});

test('commercial access precedence is deterministic and server-authoritative', () => {
  const snapshot = functionBlock('phase4_access_snapshot');
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
    "v_basis := 'daily_free'",
  ], 'commercial access precedence');
  for (const key of [
    'accessMode', 'accountLabel', 'unlimited', 'dailyLimit', 'completedToday',
    'reservedToday', 'remainingToday', 'resetAt', 'checkoutOpen',
    'priceCentavos', 'salesCloseAt', 'entitlementEndsAt',
  ]) assert.match(snapshot, new RegExp(`'${key}'`));
  assert.match(snapshot, /public\.phase4_ph_date\(v_now\)/);
  assert.match(snapshot, /public\.phase4_ph_reset_at\(v_now\)/);
  assert.match(snapshot, /count\(\*\) filter \([\s\S]*where status = 'completed'[\s\S]*usage_date_ph = public\.phase4_ph_date\(v_now\)/);
  assert.match(snapshot, /count\(\*\) filter \(\s*where status = 'reserved'/);
  assert.match(snapshot, /greatest\(0, v_settings\.free_daily_grade_limit - v_completed - v_reserved\)/);
});

test('Subject Matter read wrappers permit the commercial resolver to claim Founding Beta access', () => {
  assert.match(migration, /alter function public\.subject_matter_catalog\(uuid\) volatile;/);
  assert.match(
    migration,
    /alter function public\.subject_matter_performance\(uuid, text, integer\) volatile;/,
  );
});

test('Founding Beta matching stores only hashes and grants no client access', () => {
  assert.match(migration, /create table if not exists public\.founding_beta_invites/);
  assert.match(migration, /email_hash text primary key check \(email_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(migration, /default '2026-09-01 23:59:59\+08'/);
  assert.match(migration, /force row level security/);
  assert.match(migration, /revoke all on public\.%I from public, anon, authenticated/);
  assert.doesNotMatch(
    migration,
    /[A-Z0-9._%+-]+@gmail\.com\b/i,
    'The approved Founding Beta roster must never be committed as plaintext Gmail addresses.',
  );
  const roster = migration.match(/from unnest\(array\[([\s\S]*?)\]::text\[\]\) as roster\(email_hash\)/)?.[1] || '';
  const hashes = [...roster.matchAll(/'([0-9a-f]{64})'/g)].map((match) => match[1]);
  assert.equal(hashes.length, 18, 'The approved Founding Beta roster must contain exactly 18 hashes.');
  assert.equal(new Set(hashes).size, 18, 'Founding Beta hashes must be unique.');
  const claim = functionBlock('phase4_claim_founding_beta');
  assert.match(claim, /p_email_hash[\s\S]*'\^\[0-9a-f\]\{64\}\$'/);
  assert.match(claim, /access_program[\s\S]*'founding_beta_2026'/);
});

test('payment proof is one-time provisional access and cannot be extended by replay', () => {
  const payment = functionBlock('phase4_create_payment_request');
  assert.match(payment, /p_plan_code[\s\S]*<> 'early_access_beta'/);
  assert.match(payment, /round\(coalesce\(p_amount_php, 0\), 2\) <> 149\.00/);
  assert.match(payment, /v_now > v_settings\.early_access_sales_close_at/);
  assertInOrder(payment, [
    'where request_key = p_request_key',
    "where user_id = p_user_id and plan_code = 'early_access_beta'",
    'insert into public.payment_requests',
  ], 'payment idempotency checks');
  assert.match(payment, /provisional_access_expires_at[\s\S]*v_now \+ interval '24 hours'/);
  assert.match(payment, /'provisionalAccessExpiresAt'/);
});

test('approval fixes October expiry while rejection revokes provisional access', () => {
  const review = functionBlock('phase4_admin_review_payment');
  assert.match(review, /v_settings\.early_access_entitlement_ends_at/);
  assert.match(review, /v_status = 'rejected'[\s\S]*provisional_access_revoked_at/);
  assert.match(review, /v_status = 'approved'[\s\S]*v_subscription\.id/);
});

test('refund contract applies the approved seven-day prorated formula', () => {
  const refund = functionBlock('phase4_create_refund_request');
  assert.match(refund, /public\.phase4_ph_date\(v_now\) > public\.phase4_ph_date\(v_start\) \+ 6/);
  assert.match(refund, /v_total_seconds := greatest\(1, extract\(epoch from \(v_settings\.early_access_entitlement_ends_at - v_start\)\)\)/);
  assert.match(refund, /v_unused_seconds := greatest\(0, extract\(epoch from \(v_settings\.early_access_entitlement_ends_at - v_now\)\)\)/);
  assert.match(refund, /least\(149\.00, greatest\(0, round\(149\.00 \* v_unused_seconds \/ v_total_seconds, 2\)\)\)/);
  assert.match(refund, /provisional_access_revoked_at = coalesce\(provisional_access_revoked_at, v_now\)/);
  assert.match(refund, /set status = 'cancelled'/);
});

test('commercial onboarding cannot grant a role or administrator authority', () => {
  const onboarding = functionBlock('complete_commercial_profile_onboarding');
  assert.match(onboarding, /auth\.uid\(\)/);
  assert.match(onboarding, /'first_year','second_year','third_year','fourth_year','fifth_year','review','professor'/);
  assert.match(onboarding, /if v_category = 'professor'[\s\S]*Professor license declaration is required/);
  assert.match(onboarding, /insert into public\.professor_license_declarations/);
  assert.doesNotMatch(onboarding, /user_roles|founder_admin|super_admin|insert\s+into\s+public\.subscriptions/i);
});

test('Examination Room reserves the immutable question count before entry and finalizes from the first snapshot', () => {
  const preview = functionBlock('phase4_exam_room_allowance_preview');
  const hold = functionBlock('phase4_prepare_exam_room_hold');
  const start = functionBlock('exam_room_start_attempt_commercial_v1');
  const byCode = functionBlock('exam_room_start_attempt_by_code_commercial_v1');
  const beadle = functionBlock('exam_room_start_beadle_attempt_commercial_v1');
  const trigger = functionBlock('phase4_finalize_exam_room_quota_on_submission');
  assert.match(preview, /count\(\*\)[\s\S]*exam_room_questions/);
  assert.match(preview, /remainingToday[\s\S]*v_required/);
  assert.match(hold, /phase4_reserve_submission_batch\([\s\S]*'examination_room'/);
  assert.match(hold, /phase4_exam_room_reservation_key\(p_user_id, v_exam\.id\)/);
  assertInOrder(start, [
    'exam_room_student_waiting_room_v4',
    'phase4_prepare_exam_room_hold',
    'exam_room_start_attempt_v4',
    'phase4_extend_exam_room_hold',
  ], 'direct Examination Room entry');
  assert.match(byCode, /exam_room_student_waiting_room_by_code_v1[\s\S]*exam_room_start_attempt_commercial_v1/);
  assert.match(beadle, /exam_room_beadle_student_waiting_room_v1[\s\S]*phase4_prepare_exam_room_hold[\s\S]*exam_room_start_beadle_student_attempt_v1/);
  assert.match(trigger, /status = 'reserved'/);
  assert.match(trigger, /jsonb_array_elements\(coalesce\(new\.answer_snapshot/);
  assert.match(trigger, /char_length\(btrim\(coalesce\(item ->> 'answerText', ''\)\)\) > 0/);
  assert.match(trigger, /phase4_finalize_submission_batch/);
  assert.match(migration, /after insert on public\.exam_room_submissions/);
});

test('activation is audited and deliberately leaves Global Beta enabled for the final cutover step', () => {
  const activation = functionBlock('phase4_activate_commercial_launch');
  assert.match(activation, /perform public\.phase4_require_founder\(p_actor_user_id\)/);
  assert.match(activation, /commercial_launch_enabled = true/);
  assert.match(activation, /public_pricing_enabled = true/);
  assert.match(activation, /current_terms_version = commercial_terms_version/);
  assert.match(activation, /current_privacy_version = commercial_privacy_version/);
  assert.match(activation, /'globalBetaStillEnabled', v_settings\.global_beta_all_access_enabled/);
  assert.doesNotMatch(activation, /global_beta_all_access_enabled\s*=\s*false/);
});

test('new private objects and privileged functions are least-privilege only', () => {
  for (const table of ['founding_beta_invites', 'professor_license_declarations']) {
    assert.ok(migration.includes(`'${table}'`));
  }
  for (const name of [
    'phase4_claim_founding_beta', 'phase4_access_snapshot',
    'phase4_reserve_grade_v2', 'phase4_reserve_submission_batch',
    'phase4_finalize_submission_batch', 'phase4_release_submission_batch',
    'phase4_exam_room_allowance_preview', 'phase4_prepare_exam_room_hold',
    'exam_room_start_attempt_commercial_v1',
    'exam_room_start_attempt_by_code_commercial_v1',
    'exam_room_start_beadle_attempt_commercial_v1',
    'phase4_finalize_grade', 'phase4_plan_catalog',
    'phase4_create_payment_request', 'phase4_admin_review_payment',
    'phase4_create_refund_request', 'phase4_activate_commercial_launch',
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}\\b[\\s\\S]*from public, anon, authenticated`));
  }
  for (const signature of [
    'phase4_claim_founding_beta\\(uuid,text\\)',
    'phase4_access_snapshot\\(uuid,boolean,text\\)',
    'phase4_reserve_grade_v2\\(uuid,text,text,text\\)',
    'phase4_reserve_submission_batch\\(uuid,text,text,text,integer\\)',
    'phase4_finalize_submission_batch\\(uuid,text,integer,text\\)',
    'phase4_release_submission_batch\\(uuid,text,text\\)',
    'phase4_exam_room_allowance_preview\\(uuid,uuid\\)',
    'phase4_prepare_exam_room_hold\\(uuid,uuid\\)',
    'exam_room_start_attempt_commercial_v1\\(uuid,uuid,text,text\\)',
    'exam_room_start_attempt_by_code_commercial_v1\\(uuid,text,text,text\\)',
    'exam_room_start_beadle_attempt_commercial_v1\\(uuid,uuid,text\\)',
    'phase4_finalize_grade\\(uuid,uuid\\)',
    'phase4_plan_catalog\\(\\)',
    'phase4_admin_review_payment\\(uuid,uuid,jsonb,text,text\\)',
    'phase4_create_refund_request\\(uuid,uuid,text,text\\)',
    'phase4_activate_commercial_launch\\(uuid,text,text\\)',
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${signature} to service_role`),
      `${signature} must be callable only through the trusted backend grant`,
    );
  }
  assert.match(
    migration,
    /revoke all on function public\.complete_commercial_profile_onboarding\([\s\S]*\) from public, anon;/,
  );
  assert.match(
    migration,
    /grant execute on function public\.complete_commercial_profile_onboarding\([\s\S]*\) to authenticated;/,
  );
});

console.log('Commercial launch migration contract checks passed.');
