import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url));
const text = (relative) => read(relative).toString('utf8');
const accessMigration = text('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');
const migration = text('supabase/migrations/20260730_008_phase4_payments_partnerships.sql');
const premiumMigration = text('supabase/migrations/20260804_014_premium_499_entitlements.sql');
const commercialMigration = text('supabase/migrations/20260818024644_commercial_launch_access.sql');
const softLaunchMigration = text('supabase/migrations/20260821120000_soft_launch_five_token_trial.sql');
const goTymeMigration = text('supabase/migrations/20260820174602_add_gotyme_payment_channel.sql');
const preflight = text('supabase/review/phase4_production_preflight.sql');
const worker = text('worker/index.mjs');
const paymentCore = text('worker/payment-core.mjs');
const frontend = text('assets/phase2-experience.js');
const publicPage = text('index.html');
const admin = text('admin/admin.js');
const adminPage = text('admin/index.html');
const adminStyles = text('admin/admin.css');
const workflow = text('.github/workflows/deploy.yml');
const productionBundleBuilder = text('scripts/build-phase4-production-bundle.mjs');

for (const table of [
  'payment_requests',
  'payment_request_history',
  'refund_requests',
  'refund_request_history',
  'partnership_inquiries',
  'partnership_inquiry_history',
  'outbound_notifications',
]) {
  assert.match(migration, new RegExp(`create table if not exists public\\.${table}\\b`));
  assert.ok(migration.includes(`'${table}'`), `${table} must be included in the least-privilege table loop`);
}
assert.match(
  migration,
  /execute format\('revoke all on public\.%I from public, anon, authenticated',v_table\)/,
);

for (const rpc of [
  'phase4_plan_catalog',
  'phase4_create_payment_request',
  'phase4_student_billing_snapshot',
  'phase4_create_refund_request',
  'phase4_create_partnership_inquiry',
  'phase4_admin_operational_data',
  'phase4_admin_execute_action',
  'phase4_payment_proof_context',
]) {
  assert.match(migration, new RegExp(`function public\\.${rpc}\\b`));
  assert.ok(worker.includes(`'${rpc}'`), `${rpc} must be called by the Worker`);
}

assert.match(accessMigration, /alter table public\.plan_catalog[\s\S]*duration_days[\s\S]*checkout_enabled/);
assert.match(accessMigration, /price_php = 149\.00[\s\S]*where plan_code = 'early_access_beta'/);
assert.match(accessMigration, /price_php = 249\.00[\s\S]*where plan_code = 'standard'/);
assert.match(accessMigration, /price_php = 499\.00[\s\S]*checkout_enabled = false[\s\S]*where plan_code = 'premium'/);
assert.match(premiumMigration, /price_php = 499\.00[\s\S]*checkout_enabled = true[\s\S]*where plan_code = 'premium'/);
assert.match(premiumMigration, /duration_days = null/);
assert.match(premiumMigration, /Premium payment approval requires an explicit future expiration/);
assert.match(migration, /duration_days=30/);
assert.match(migration, /make_interval\(days=>v_plan\.duration_days\)/);
assert.match(migration, /payment_method,\s*reference_normalized/);
assert.match(migration, /jsonb_has_forbidden_keys/);
assert.match(migration, /payment-proofs/);
assert.match(migration, /public\s*=\s*false|false,\s*6 \* 1024 \* 1024/);

for (const route of [
  '/plans',
  '/payments/submit',
  '/payments/status',
  '/refunds/submit',
  '/partnerships',
  '/admin/phase4-data',
  '/admin/phase4-action',
  '/admin/payment-proof',
]) {
  assert.ok(worker.includes(`'${route}'`), `${route} must exist`);
}

assert.match(paymentCore, /image\/png/);
assert.match(paymentCore, /image\/jpeg/);
assert.match(paymentCore, /application\/pdf/);
assert.match(paymentCore, /6 \* 1024 \* 1024/);
assert.match(paymentCore, /PLAN_UNAVAILABLE/);
assert.match(paymentCore, /planCode !== 'early_access_beta'/);
assert.match(paymentCore, /\['gotyme_instapay', 'bpi_instapay'\]\.includes\(paymentMethod\)/);
assert.match(paymentCore, /Math\.round\(amountPhp \* 100\) !== 14900/);
assert.doesNotMatch(frontend, /assets\/payments\/gcash\.png|assets\/payments\/maribank\.png/);
assert.match(frontend, /assets\/payments\/gotyme-instapay-149\.png/);
assert.doesNotMatch(frontend, /assets\/payments\/bpi-instapay-149\.png/);
assert.match(frontend, /id="dd2-payment-form"/);
assert.match(frontend, /async function submitCommercialPayment\(event\)/);
assert.match(frontend, /Introductory tokens and Early Access/);
assert.match(frontend, /no automatic charge or automatic renewal/i);
assert.match(frontend, /regular manual-renewal price is ₱199/i);
assert.doesNotMatch(frontend, /Beta access active/);
assert.match(
  frontend,
  /async function submitPartnership\(event\) \{\s*event\.preventDefault\(\);\s*const form = event\.currentTarget;[\s\S]*?form\.reset\(\);/,
  'Partnership success must reset the captured form after awaiting the Worker.',
);
assert.doesNotMatch(frontend, /Premium-only Bar Feels/);
assert.doesNotMatch(frontend, /Explicit expiration set during Founder payment verification/);
assert.match(frontend, /Partnerships/);
assert.doesNotMatch(frontend, /plansandpricing@duediligence\.ph|Founder verifies the payment/);
assert.match(
  frontend,
  /function showEntry\(options = \{\}\) \{\s*const completed = Boolean\(options\.completed\);\s*hideNativeView\(\);/,
  'Authentication must replace, not stack behind, a native commerce view.',
);
assert.match(adminPage, />Payments<\/button>/);
assert.match(adminPage, />Refunds<\/button>/);
assert.match(adminPage, />Partnerships<\/button>/);
assert.match(
  admin,
  /actionButton\('Review', 'payment_review', row\.id, \{[\s\S]*planCode: row\.plan_code/,
);
assert.match(
  admin,
  /actionButton\('View private proof', 'view_payment_proof', row\.id, \{[\s\S]*studentName:[\s\S]*proofMimeType:[\s\S]*\}\)\.value/,
);
assert.match(admin, /function renderPrivatePaymentProof\([\s\S]*private-proof-image[\s\S]*Private access recorded/,
  'Private proof review must render the proof and the persisted access reason inside the dashboard.');
assert.match(admin, /sensitive_data_viewed[\s\S]*payment_proof/,
  'Payments must filter durable Admin audit records to private-proof views.');
assert.match(admin, /Private proof access log[\s\S]*Every private-proof view is recorded here/,
  'Payments must visibly expose recent private-proof access reasons.');
assert.doesNotMatch(admin, /window\.location\.assign\(response\.proof\.url\)/,
  'Private proof review must not navigate the administrator away from the dashboard.');
assert.match(publicPage, /assets\/phase2-experience\.js\?v=non-exam-sweep-20260822-1/);
assert.match(publicPage, /assets\/phase4-experience\.js\?v=non-exam-sweep-20260822-1/);
assert.match(adminPage, /admin\.css\?v=[a-z0-9-]+/i);
assert.match(adminPage, /subscription-actions-core\.js\?v=[a-z0-9-]+/i);
assert.match(adminPage, /admin\.js\?v=[a-z0-9-]+/i);
assert.match(
  adminStyles,
  /\.gate\[hidden\]\s*\{\s*display:\s*none;\s*\}/,
  'The authorized dashboard must not remain blocked by its hidden verification gate.',
);
assert.doesNotMatch(publicPage, /Angel Investors|Sponsored placement|FGMALLARI|Investor solicitation/i);
assert.doesNotMatch(publicPage, /content\/question-bank|website-upload\.json/);
assert.match(workflow, /node scripts\/build-pages-artifact\.mjs/);
assert.match(workflow, /path:\s*'\.pages-dist'/);
for (const version of ['20260730005', '20260730006', '20260730007', '20260730008']) {
  assert.match(productionBundleBuilder, new RegExp(version));
}
assert.match(productionBundleBuilder, /must contain exactly one outer BEGIN and COMMIT/);
assert.match(productionBundleBuilder, /flag: 'wx'/);
assert.match(productionBundleBuilder, /insert into supabase_migrations\.schema_migrations/);
assert.match(productionBundleBuilder, /begin;[\s\S]*commit;/);
assert.match(productionBundleBuilder, /rollbackOnly \? 'rollback' : 'commit'/);
assert.match(productionBundleBuilder, /omitLedger \? 'omitted' : 'included'/);
assert.doesNotMatch(productionBundleBuilder, /db push|service.role|access.token/i);

for (const [relative, expected] of Object.entries({
  'assets/payments/gotyme-instapay-149.png':
    '85D7CCA8CF8A2C3FF7BCEE35F09C682E8CCECD6E7623F128B67AFD43ECE303C1',
})) {
  const actual = createHash('sha256').update(read(relative)).digest('hex').toUpperCase();
  assert.equal(actual, expected, `${relative} must preserve the approved QR pixels`);
}

assert.match(commercialMigration, /payment_method in \('gcash', 'maribank', 'bpi_instapay'\)/);
assert.match(commercialMigration, /if p_payment_method <> 'bpi_instapay'/);
assert.match(goTymeMigration, /payment_method in \('gcash', 'maribank', 'bpi_instapay', 'gotyme_instapay'\)/);
assert.match(goTymeMigration, /p_payment_method not in \('bpi_instapay', 'gotyme_instapay'\)/);
assert.match(goTymeMigration, /validate constraint payment_requests_payment_method_gotyme_check/);
assert.match(goTymeMigration, /to payment_requests_payment_method_check/);
assert.match(softLaunchMigration, /'planCode', 'early_access_beta'/);
assert.match(softLaunchMigration, /'pricePhp', 149/);
assert.match(softLaunchMigration, /'regularPricePhp', 199/);
assert.match(softLaunchMigration, /'manualRenewal', true/);
assert.match(softLaunchMigration, /'automaticRenewal', false/);
assert.match(softLaunchMigration, /'tokenLimit', v_grant\.token_limit/);
assert.doesNotMatch(softLaunchMigration, /'planCode',\s*'free'/);

assert.match(preflight, /PHASE4_PREFLIGHT_PASSED_READ_ONLY/);
assert.doesNotMatch(preflight, /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i);
assert.match(preflight, /expected exactly 8 subjects/);
assert.match(preflight, /expected exactly 2 database question rows/);
assert.match(preflight, /payment-proofs bucket already exists/);
assert.match(preflight, /version = '20260724005821' and name = 'initial_schema'/);
assert.match(preflight, /select count\(\*\) from supabase_migrations\.schema_migrations/);
assert.match(preflight, /PHASE4_PREFLIGHT_LEGACY_GRADE_DISPUTES_PRESENT/);
assert.doesNotMatch(
  preflight,
  /select count\(\*\) from public\.grade_disputes/,
  'Phase 1 intentionally renamed grade_disputes to question_corrections.',
);

for (const source of [migration, preflight, worker, paymentCore, frontend, publicPage, admin]) {
  assert.doesNotMatch(source, /AIza[0-9A-Za-z_-]{20,}/);
  assert.doesNotMatch(source, /service[_-]?role\s*[:=]\s*['"][A-Za-z0-9._-]{20,}/i);
}

console.log('Phase 4 Release 4 commerce and deployment contract checks passed.');
