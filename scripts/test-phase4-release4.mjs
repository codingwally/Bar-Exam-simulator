import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url));
const text = (relative) => read(relative).toString('utf8');
const accessMigration = text('supabase/migrations/20260730_005_phase4_access_subscriptions.sql');
const migration = text('supabase/migrations/20260730_008_phase4_payments_partnerships.sql');
const preflight = text('supabase/review/phase4_production_preflight.sql');
const worker = text('worker/index.mjs');
const paymentCore = text('worker/payment-core.mjs');
const frontend = text('assets/phase2-experience.js');
const publicPage = text('index.html');
const admin = text('admin/admin.js');
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
assert.match(paymentCore, /!\['early_access_beta', 'standard'\]\.includes\(planCode\)/);
assert.match(frontend, /assets\/payments\/gcash\.png/);
assert.match(frontend, /maribank/);
assert.match(
  frontend,
  /async function submitPayment\(event\) \{\s*event\.preventDefault\(\);\s*const form = event\.currentTarget;[\s\S]*?form\.reset\(\);/,
  'Payment success must reset the captured form after awaiting the Worker.',
);
assert.match(
  frontend,
  /async function submitPartnership\(event\) \{\s*event\.preventDefault\(\);\s*const form = event\.currentTarget;[\s\S]*?form\.reset\(\);/,
  'Partnership success must reset the captured form after awaiting the Worker.',
);
assert.match(frontend, /Held in Abeyance/);
assert.match(frontend, /Further proceedings pending\. Premium enrollment is not yet available\./);
assert.match(frontend, /Joint Venture/);
assert.match(frontend, /plansandpricing@duediligence\.ph|Founder verifies the payment/);
assert.match(
  frontend,
  /function showEntry\(options = \{\}\) \{\s*const completed = Boolean\(options\.completed\);\s*hideNativeView\(\);/,
  'Authentication must replace, not stack behind, a native commerce view.',
);
assert.match(admin, /Payment Review/);
assert.match(admin, /Refunds/);
assert.match(admin, /Joint Ventures/);
assert.match(
  admin,
  /actionButton\('Review', 'payment_review', row\.id, \{ status: row\.status \}\)\.value/,
);
assert.match(
  admin,
  /actionButton\('View private proof', 'view_payment_proof', row\.id, \{\}\)\.value/,
);
assert.match(publicPage, /assets\/phase2-experience\.js\?v=release-c-20260729-1/);
assert.match(publicPage, /assets\/phase4-experience\.js\?v=phase4-20260729-2/);
assert.match(text('admin/index.html'), /admin\.css\?v=phase4-20260728-2/);
assert.match(text('admin/index.html'), /subscription-actions-core\.js\?v=admin-actions-20260729-3/);
assert.match(text('admin/index.html'), /admin\.js\?v=quorum-20260803-1/);
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
  'assets/payments/gcash.png':
    'E750530C71EB0445FD8F801B70DE25B338504C63CEB55881B311B3AA48FA2D7F',
  'assets/payments/maribank.png':
    '1F6269F117AC35BB0B7D45636605413D610903732347211E1591399905972CD1',
})) {
  const actual = createHash('sha256').update(read(relative)).digest('hex').toUpperCase();
  assert.equal(actual, expected, `${relative} must preserve the approved QR pixels`);
}

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
