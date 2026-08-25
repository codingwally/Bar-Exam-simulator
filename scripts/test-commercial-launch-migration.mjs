import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const softLaunch = readFileSync(new URL(
  '../supabase/migrations/20260821120000_soft_launch_five_token_trial.sql',
  import.meta.url,
), 'utf8');
const foundation = readFileSync(new URL(
  '../supabase/migrations/20260818024644_commercial_launch_access.sql',
  import.meta.url,
), 'utf8');
const legalPolicy = readFileSync(new URL(
  '../supabase/migrations/20260818062500_current_legal_policy_contract.sql',
  import.meta.url,
), 'utf8');
const goTyme = readFileSync(new URL(
  '../supabase/migrations/20260820174602_add_gotyme_payment_channel.sql',
  import.meta.url,
), 'utf8');
const subscriberReceipt = readFileSync(new URL(
  '../supabase/migrations/20260824123000_subscription_receipt_delivery.sql',
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

test('subscriber receipts are durable, replay-safe, and backend-only', () => {
  assert.equal((subscriberReceipt.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((subscriberReceipt.match(/^commit;$/gmi) || []).length, 1);
  assert.doesNotMatch(subscriberReceipt, /^\s*(?:drop\s+table|truncate)\b/gmi);
  assert.match(subscriberReceipt, /subscriber_receipt_status in \('pending','sending','sent','failed','suppressed'\)/);
  assert.match(subscriberReceipt, /status = 'approved'/);
  assert.match(subscriberReceipt, /for update skip locked/);
  assert.match(subscriberReceipt, /subscriber_receipt_attempts < 8/);
  assert.match(subscriberReceipt, /subscriber_receipt_last_attempt_at < clock_timestamp\(\) - interval '10 minutes'/);
  for (const signature of [
    'phase4_subscription_receipt_context\\(uuid\\)',
    'phase4_claim_subscription_receipt\\(uuid\\)',
    'phase4_complete_subscription_receipt\\(uuid,text,text,text\\)',
  ]) {
    assert.match(subscriberReceipt, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`));
    assert.match(subscriberReceipt, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to service_role`));
  }
  assert.doesNotMatch(subscriberReceipt, /@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('soft-launch migration is one transaction and preserves existing business records', () => {
  assert.equal((softLaunch.match(/^begin;$/gmi) || []).length, 1);
  assert.equal((softLaunch.match(/^commit;$/gmi) || []).length, 1);
  assert.doesNotMatch(softLaunch, /^\s*(?:drop\s+table|truncate)\b/gmi);
  assert.match(softLaunch, /Existing examinations, grades, questions,[\s\S]*payments, subscriptions/);
  assert.match(softLaunch, /phase4_access_snapshot_pre_soft_launch/);
});

test('one-time token grant is fixed at five, durable, and replay-safe', () => {
  assert.match(softLaunch, /create table if not exists public\.introductory_token_grants/);
  assert.match(softLaunch, /user_id uuid not null unique references auth\.users\(id\) on delete cascade/);
  assert.match(softLaunch, /token_limit integer not null default 5 check \(token_limit = 5\)/);
  assert.match(softLaunch, /create table if not exists public\.introductory_token_ledger/);
  assert.match(softLaunch, /event_type text not null check \(event_type in \('grant','consumed'\)\)/);
  assert.match(softLaunch, /introductory_token_ledger_one_consumption_uidx/);
  assert.match(softLaunch, /on conflict \(user_id\) do nothing/);
  assert.match(softLaunch, /on conflict \(reservation_id\) where event_type = 'consumed' do nothing/);
  assert.doesNotMatch(softLaunch, /midnight|calendar day|daily reset/i);
});

test('token tables and trusted functions are least privilege', () => {
  for (const table of ['introductory_token_grants', 'introductory_token_ledger']) {
    assert.match(
      softLaunch,
      new RegExp(`revoke all on table public\\.${table} from public, anon, authenticated`),
    );
  }
  for (const signature of [
    'phase4_access_snapshot\\(uuid,boolean,text\\)',
    'phase4_reserve_grade_v2\\(uuid,text,text,text\\)',
    'phase4_reserve_submission_batch\\(uuid,text,text,text,integer\\)',
    'phase4_payment_notification_context\\(uuid\\)',
    'phase4_claim_payment_notification\\(uuid\\)',
  ]) {
    assert.match(softLaunch, new RegExp(`revoke all on function public\\.${signature}[\\s\\S]*from public, anon, authenticated`));
    assert.match(softLaunch, new RegExp(`grant execute on function public\\.${signature}[\\s\\S]*to service_role`));
  }
});

test('access precedence protects admins and Founding Beta before ordinary setup gates', () => {
  const snapshot = sectionBetween(
    softLaunch,
    'phase4_access_snapshot',
    'complete_commercial_profile_onboarding_v2',
  );
  assertInOrder(snapshot, [
    "if v_role in ('super_admin','founder_admin') then",
    'elsif v_beta.user_id is not null then',
    'elsif v_reauthentication_required then',
    'elsif not v_profile_complete',
    'elsif v_subscription.id is not null then',
    'elsif v_payment.id is not null then',
    'elsif v_remaining > 0 then',
    "v_basis := 'trial_tokens_exhausted'",
  ], 'soft-launch access precedence');
  assert.match(snapshot, /'choiceRequired', false/);
  assert.match(snapshot, /'planSelectionRequired', false/);
  assert.match(snapshot, /'resetAt', null/);
  assert.match(snapshot, /'tokenLimit', v_grant\.token_limit/);
  assert.match(snapshot, /'tokensRemaining', v_remaining/);
});

test('onboarding requires current policy and explicit token acknowledgement without granting a role', () => {
  const onboarding = sectionBetween(
    softLaunch,
    'complete_commercial_profile_onboarding_v2',
    'phase4_reserve_grade_v2',
  );
  assert.match(onboarding, /auth\.uid\(\)/);
  assert.match(onboarding, /Current Terms and Privacy acceptance is required/);
  assert.match(onboarding, /Five-token disclosure acknowledgement is required/);
  assert.match(onboarding, /char_length\(v_school_name\) not between 2 and 180/);
  assert.match(onboarding, /insert into public\.professor_license_declarations/);
  assert.doesNotMatch(onboarding, /insert\s+into\s+public\.(?:user_roles|subscriptions)/i);
});

test('single and batch reservations are atomic, idempotent, and track-aware', () => {
  const single = sectionBetween(
    softLaunch,
    'phase4_reserve_grade_v2',
    'phase4_reserve_submission_batch',
  );
  assert.match(single, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 401\)\)/);
  assert.match(single, /p_examination_track not in \([\s\S]*'bar_practice'[\s\S]*'subject_matter'[\s\S]*'mock_bar'[\s\S]*'bar_feels'[\s\S]*'quiz'[\s\S]*'doctrine_review'/);
  assert.match(single, /if v_existing\.status in \('reserved','completed'\)/);
  assert.match(single, /v_used \+ v_reserved >= v_grant\.token_limit/);
  assert.match(single, /'reason', 'trial_tokens_exhausted'/);
  assert.match(single, /'reason', coalesce\(v_access->>'basis', 'access_denied'\)/);

  const batch = sectionBetween(softLaunch, 'phase4_reserve_submission_batch');
  assert.match(batch, /pg_advisory_xact_lock\(hashtextextended\(p_user_id::text, 401\)\)/);
  assert.match(batch, /v_used \+ v_reserved \+ p_required_count > v_grant\.token_limit/);
  assert.match(batch, /'reason', 'insufficient_introductory_tokens'/);
  assert.match(batch, /'reason', coalesce\(v_access->>'basis', 'access_denied'\)/);
  assert.match(batch, /v_now \+ interval '6 hours'/);
});

test('only successful finalized reservations consume a token once', () => {
  const trigger = sectionBetween(
    softLaunch,
    'phase4_record_introductory_token_consumption',
    'phase4_access_snapshot',
  );
  assert.match(trigger, /new\.status <> 'completed'/);
  assert.match(trigger, /old\.status = 'completed'/);
  assert.match(trigger, /not new\.consumes_quota/);
  assert.match(trigger, /new\.access_basis <> 'introductory_tokens'/);
  assert.match(trigger, /on conflict \(reservation_id\) where event_type = 'consumed' do nothing/);
  assert.match(foundation, /'provider_timeout'[\s\S]*'grading_failed'[\s\S]*'network_failure'/);
});

test('catalog contains one ₱149 offer with crossed-out ₱199 manual renewal metadata', () => {
  const catalog = sectionBetween(softLaunch, 'phase4_plan_catalog');
  assert.match(catalog, /'planCode', 'early_access_beta'/);
  assert.match(catalog, /'priceCentavos', 14900/);
  assert.match(catalog, /'regularPriceCentavos', v_settings\.early_access_regular_price_centavos/);
  assert.match(catalog, /'renewalPriceCentavos', v_settings\.early_access_regular_price_centavos/);
  assert.match(catalog, /'billing', 'manual_renewal'/);
  assert.match(catalog, /'manualRenewal', true/);
  assert.match(catalog, /'automaticRenewal', false/);
  assert.doesNotMatch(catalog, /'planCode',\s*'(?:free|standard|premium)'/);
});

test('payment verifier delivery is durable and abandoned sends are reclaimed safely', () => {
  assert.match(softLaunch, /verification_email_status in \('pending','sending','sent','failed','suppressed'\)/);
  assert.match(softLaunch, /verification_email_status = 'sending'[\s\S]*interval '10 minutes'/);
  assert.match(softLaunch, /for update skip locked/);
  assert.match(softLaunch, /verification_email_attempts < 8/);
  assert.match(softLaunch, /phase4_payment_notification_context/);
  assert.match(softLaunch, /proofSha256/);
  assert.match(softLaunch, /verification_email_sent_at/);
});

test('current legal policy and GoTyme proof channel remain server-authoritative', () => {
  assert.match(legalPolicy, /'termsVersion', s\.current_terms_version/);
  assert.match(legalPolicy, /'privacyVersion', s\.current_privacy_version/);
  assert.match(legalPolicy, /revoke all on function public\.phase4_global_beta_public_policy\(\)[\s\S]*from public, anon, authenticated/);
  assert.match(goTyme, /payment_method in \('gcash', 'maribank', 'bpi_instapay', 'gotyme_instapay'\)/);
  assert.match(goTyme, /p_payment_method not in \('bpi_instapay', 'gotyme_instapay'\)/);
});

console.log('Soft-launch one-time token, payment, and catalog migration contracts passed.');
