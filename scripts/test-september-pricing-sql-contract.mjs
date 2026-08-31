import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const schedulePath = '../supabase/migrations/20260831100000_september_pricing_cutover.sql';
const paymentPath = '../supabase/migrations/20260831101000_proof_only_payment_evidence.sql';
const probePath = './probe-september-pricing-release.sql';

const [schedule, payment, probe] = await Promise.all([
  readFile(new URL(schedulePath, import.meta.url), 'utf8'),
  readFile(new URL(paymentPath, import.meta.url), 'utf8'),
  readFile(new URL(probePath, import.meta.url), 'utf8'),
]);

const normalizedSha = (source) => createHash('sha256')
  .update(source.replace(/\r\n?/gu, '\n'))
  .digest('hex');
const scheduleSha = normalizedSha(schedule);
const paymentSha = normalizedSha(payment);

for (const [name, source] of [['schedule', schedule], ['payment', payment]]) {
  assert.equal((source.match(/^\s*begin;\s*$/gimu) || []).length, 1, `${name} migration must begin once.`);
  assert.equal((source.match(/^\s*commit;\s*$/gimu) || []).length, 1, `${name} migration must commit once.`);
  assert.equal((source.match(/^\s*rollback;\s*$/gimu) || []).length, 0, `${name} migration must not roll back.`);
}

assert.match(schedule, /v_cutover constant timestamptz := '2026-09-14 00:00:00\+08'/u);
assert.match(
  schedule,
  /if v_now >= v_cutover and \([\s\S]*id = v_revision_a[\s\S]*id = v_revision_b[\s\S]*September pricing schedule must be installed before the cutover/u,
  'A raw replay after cutover may verify an already-installed exact schedule but may not install a missing one.',
);
assert.match(
  schedule,
  /drop constraint if exists pricing_payment_channel_versions_qr_public_path_check[\s\S]*qr_public_path = '\/pricing\/legacy-149-qr\.png'[\s\S]*\^\/assets\/payments\//u,
  'The legacy QR exception must be one exact Worker route while retaining the restricted asset path.',
);
assert.match(schedule, /state = 'published',[\s\S]*effective_at = v_now/u);
assert.match(schedule, /state = 'scheduled',[\s\S]*effective_at = v_cutover/u);
assert.match(schedule, /early_access_sales_close_at = '2026-09-14 00:00:00\+08'/u);
const compatibilityWrapper = schedule.slice(
  schedule.indexOf('create or replace function public.phase4_create_payment_request('),
  schedule.indexOf('-- Founding Beta stays valid'),
);
assert.match(compatibilityWrapper, /submitted_at < '2026-09-14 00:00:00\+08'/u);
assert.match(compatibilityWrapper, /v_now >= '2026-09-14 00:00:00\+08'/u);
assert.doesNotMatch(compatibilityWrapper, /2026-09-01 00:00:00\+08/u);
assert.match(schedule, /display_ends_at,[\s\S]*checkout_ends_at/u);
assert.match(schedule, /v_cutover,[\s\S]*true,[\s\S]*null,[\s\S]*v_cutover/u);

const revisionAPublicCopy = schedule.slice(
  schedule.indexOf("'duediligence-pricing-149-through-2026-09-14-v1'"),
  schedule.indexOf("update public.pricing_revisions\n    set state = 'published'"),
);
for (const forbidden of ['Founding Beta', 'Early Access', 'cutoff']) {
  assert.doesNotMatch(revisionAPublicCopy, new RegExp(forbidden, 'iu'), `Revision A public copy leaks ${forbidden}.`);
}

const exactFeatures = [
  'Quick Drills & Doctrine Review',
  'Syllabus-Based Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Pedro — Private AI Study Assistant',
  'ALAC Grading, Model Answers & Legal Sources',
  'Saved Progress, Personal Analytics & PDF Exports',
  'Study Room Beta — Join Open Live Rooms',
];
const revisionB = schedule.slice(schedule.indexOf("'Regular Subscription'"));
for (const feature of exactFeatures) {
  assert.ok(revisionB.includes(`'${feature.replaceAll("'", "''")}'`), `Revision B is missing ${feature}.`);
}
assert.match(revisionB, /'Regular Subscription'/u);
assert.match(revisionB, /19900,[\s\S]*'PHP',[\s\S]*30,[\s\S]*'rolling_days'/u);
assert.match(revisionB, /'\/assets\/payments\/bpi-instapay-199-qr\.png',[\s\S]*19900,[\s\S]*true,[\s\S]*true/u);
assert.match(revisionB, /'BPI InstaPay',[\s\S]*'',\s*\n\s*'',/u);
assert.match(
  schedule,
  /v_now < '2026-09-14 00:00:00\+08'[\s\S]*r\.state = 'scheduled'[\s\S]*v_now >= '2026-09-14 00:00:00\+08'[\s\S]*r\.state in \('scheduled', 'published'\)/u,
  'Exact post-cutover replays must accept automatic scheduled selection and later promotion.',
);

assert.match(schedule, /alter column access_ends_at[\s\S]*set default '2026-10-01 00:00:00\+08'/u);
const betaExtension = schedule.slice(
  schedule.indexOf('create or replace function private.phase4_extend_founding_beta_entitlements'),
  schedule.indexOf('create or replace function private.phase4_founding_beta_claim_open'),
);
assert.match(betaExtension, /where status <> 'revoked'[\s\S]*access_ends_at < p_boundary/u);
assert.match(betaExtension, /where access_program = 'founding_beta_2026'[\s\S]*and enabled/u);
assert.match(betaExtension, /and expires_at is not null[\s\S]*expires_at < p_boundary/u);
assert.match(betaExtension, /not exists \([\s\S]*invite_row\.status = 'revoked'/u);
assert.match(schedule, /select private\.phase4_extend_founding_beta_entitlements\([\s\S]*'2026-10-01 00:00:00\+08'/u);
assert.match(schedule, /private\.phase4_founding_beta_claim_open\([\s\S]*p_at < '2026-10-01 00:00:00\+08'/u);
assert.match(schedule, /if not private\.phase4_founding_beta_claim_open\(v_now\) then[\s\S]*'FOUNDING_BETA_ENDED'/u);
assert.match(schedule, /2026-09-30 23:59:59\.999999\+08[\s\S]*2026-10-01 00:00:00\+08[\s\S]*2026-10-01 00:00:00\.000001\+08/u);
assert.match(schedule, /v_existing_beta\.user_id is not null and not v_existing_beta\.enabled/u);
assert.match(schedule, /v_existing_beta\.expires_at > v_invite\.access_ends_at/u);

const v3Signature = payment.match(
  /create or replace function public\.phase4_create_payment_request_v3\(([\s\S]*?)\)\nreturns jsonb/u,
)?.[1] || '';
assert.match(v3Signature, /p_proof_bucket text/u);
assert.match(v3Signature, /p_proof_sha256 text/u);
assert.doesNotMatch(v3Signature, /payment_date|payment_reference|transaction_reference/iu);

const v3 = payment.slice(
  payment.indexOf('create or replace function public.phase4_create_payment_request_v3'),
  payment.indexOf('-- Existing callers retain the same review signature.'),
);
assert.match(v3, /'pricingv3_'[\s\S]*p_proof_sha256/u);
assert.match(v3, /v_internal_reference := 'proof_sha256_' \|\| lower\(p_proof_sha256\)/u);
assert.match(v3, /payment_evidence_mode[\s\S]*'proof_only'/u);
assert.match(v3, /'paymentEvidenceMode', 'proof_only'/u);
assert.doesNotMatch(v3.match(/return jsonb_build_object\([\s\S]*?'replayed', false\n  \);/u)?.[0] || '', /transactionReference|paymentReference/u);

assert.match(payment, /create trigger phase4_guard_payment_evidence_provenance_trigger/u);
assert.match(payment, /Verified payment time is immutable/u);
assert.match(payment, /v_mode = 'rolling_days' and v_paid_at_text is null/u);
assert.match(payment, /verifiedPaidAt cannot be in the future/u);
assert.match(payment, /verifiedPaidAt cannot be after the proof submission time/u);
assert.match(payment, /verifiedPaidAt cannot precede the plan checkout start/u);
assert.match(payment, /v_base := greatest\(v_paid_at, v_subscription\.expires_at\)/u);
assert.match(payment, /v_expires_at := v_base \+ pg_catalog\.make_interval\(days => v_duration\)/u);
assert.match(payment, /when v_mode = 'rolling_days' then v_paid_at/u);
assert.match(payment, /v_subscription\.expires_at is null then[\s\S]*v_entitlement_changed := false/u);
assert.doesNotMatch(payment, /v_base := greatest\(v_now/u);

for (const field of [
  'paymentEvidenceMode',
  'verifiedPaidAt',
  'verifiedPaidAtBy',
  'verifiedPaidAtVerifiedAt',
  'purchasedStartsAt',
  'purchasedEndsAt',
]) {
  assert.ok(payment.includes(`'${field}'`), `Payment SQL is missing ${field}.`);
}
assert.match(payment, /phase4_admin_operational_data_scoped_v2/u);
assert.match(payment, /item\.value - array\['payment_date', 'transaction_reference'\]/u);
assert.match(payment, /when p\.payment_evidence_mode = 'proof_only' then '\{\}'::jsonb/u);
const studentBilling = payment.slice(
  payment.indexOf('create or replace function public.phase4_student_billing_snapshot'),
  payment.indexOf('create or replace function public.phase4_payment_notification_context'),
);
assert.doesNotMatch(studentBilling, /paid_at_verified_by|verifiedPaidAtBy/u);

assert.equal((probe.match(/^\s*begin;\s*$/gimu) || []).length, 1);
assert.equal((probe.match(/^\s*rollback;\s*$/gimu) || []).length, 1);
assert.equal((probe.match(/^\s*commit;\s*$/gimu) || []).length, 0);
assert.match(probe, /set local lock_timeout = '5s'/u);
assert.match(probe, /set local statement_timeout = '45s'/u);
assert.ok(probe.includes(`sha256:${scheduleSha}`), 'Probe ledger guard has the wrong schedule migration hash.');
assert.ok(probe.includes(`sha256:${paymentSha}`), 'Probe ledger guard has the wrong payment migration hash.');
for (const proof of [
  'SEPTEMBER_PRICING_PROBE_149_BEFORE_FAILED',
  'SEPTEMBER_PRICING_PROBE_149_AT_BOUNDARY_FAILED',
  'SEPTEMBER_PRICING_PROBE_199_BEFORE_BOUNDARY_FAILED',
  'SEPTEMBER_PRICING_PROBE_199_AT_BOUNDARY_FAILED',
  'SEPTEMBER_PRICING_PROBE_199_AFTER_BOUNDARY_FAILED',
  'SEPTEMBER_PRICING_PROBE_BETA_BOUNDARY_GUARD_MISSING',
  'SEPTEMBER_PRICING_PROBE_COMPATIBILITY_CUTOFF_FAILED',
  'SEPTEMBER_PRICING_PROBE_LEGACY_QR_CONSTRAINT_FAILED',
  'SEPTEMBER_PRICING_PROBE_CANONICAL_REVISION_SELECTION_FAILED',
  'SEPTEMBER_PRICING_PROBE_BETA_EXTENSION_FIXTURE_FAILED',
  'SEPTEMBER_PRICING_PROBE_BETA_PRESERVATION_FIXTURES_FAILED',
  'SEPTEMBER_PRICING_PROBE_PROOF_ONLY_REPLAY_FAILED',
  'SEPTEMBER_PRICING_PROBE_MISSING_PAID_AT_ACCEPTED',
  'SEPTEMBER_PRICING_PROBE_FUTURE_PAID_AT_ACCEPTED',
  'SEPTEMBER_PRICING_PROBE_PRE_CHECKOUT_PAID_AT_ACCEPTED',
  'SEPTEMBER_PRICING_PROBE_POST_SUBMISSION_PAID_AT_ACCEPTED',
  'SEPTEMBER_PRICING_PROBE_APPROVAL_DELAY_SHIFTED_TERM',
  'SEPTEMBER_PRICING_PROBE_APPROVAL_REPLAY_EXTENDED_TERM',
  'SEPTEMBER_PRICING_PROBE_STUDENT_REVIEWER_IDENTITY_LEAKED',
  'SEPTEMBER_PRICING_PROBE_RENEWAL_NON_SHORTENING_FAILED',
  'SEPTEMBER_PRICING_PROBE_NONEXPIRING_ACCESS_SHORTENED',
  'SEPTEMBER_PRICING_RELEASE_PROBE_PASSED',
]) {
  assert.ok(probe.includes(proof), `Rollback-only probe is missing ${proof}.`);
}
assert.ok(
  probe.lastIndexOf('\nrollback;') > probe.lastIndexOf('$september_payment_probe$;'),
  'Synthetic payment and subscription operations must be rolled back.',
);
assert.doesNotMatch(probe, /^\s*(drop|truncate)\s+/gimu);

console.log(JSON.stringify({
  ok: true,
  scheduleMigrationSha256: scheduleSha,
  paymentMigrationSha256: paymentSha,
  cutover: '2026-09-14T00:00:00+08:00',
  foundingBetaEndsAt: '2026-10-01T00:00:00+08:00',
  probeMode: 'rollback-only',
}, null, 2));
