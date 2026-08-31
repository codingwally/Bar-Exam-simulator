import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { sanitizePublicPricingSnapshot } from '../worker/pricing-core.mjs';

const read = (path, encoding = 'utf8') => readFile(new URL(`../${path}`, import.meta.url), encoding);
const [
  index,
  renderer,
  experience,
  phase2Css,
  pricingCss,
  schedule,
  payment,
  pagesBuilder,
  pagesTest,
  serviceWorker,
  workerIndex,
  pricingCore,
  accessCore,
  qr,
] = await Promise.all([
  read('index.html'),
  read('assets/pricing-renderer.js'),
  read('assets/phase2-experience.js'),
  read('assets/phase2.css'),
  read('assets/pricing-renderer.css'),
  read('supabase/migrations/20260831100000_september_pricing_cutover.sql'),
  read('supabase/migrations/20260831101000_proof_only_payment_evidence.sql'),
  read('scripts/build-pages-artifact.mjs'),
  read('scripts/test-pages-artifact.mjs'),
  read('service-worker.js'),
  read('worker/index.mjs'),
  read('worker/pricing-core.mjs'),
  read('worker/access-core.mjs'),
  read('assets/payments/bpi-instapay-199-qr.png', null),
]);

const features = [
  'Quick Drills & Doctrine Review',
  'Syllabus-Based Review',
  'Bar Question Practice',
  'Bar Exam Simulation',
  'Pedro — Private AI Study Assistant',
  'ALAC Grading, Model Answers & Legal Sources',
  'Saved Progress, Personal Analytics & PDF Exports',
  'Study Room Beta — Join Open Live Rooms',
];
for (const feature of features) assert.ok(schedule.includes(`'${feature}'`), `Missing ${feature}`);
assert.doesNotMatch(schedule.slice(schedule.indexOf("'Regular Subscription'")), /2026 Bar Forecast/u);
assert.match(schedule, /'Regular Subscription'[\s\S]*19900[\s\S]*30[\s\S]*'rolling_days'/u);

for (const copy of [
  'Everything included',
  'days from payment',
  'Manual verification required.',
  'BPI InstaPay',
  'Pay exactly ₱',
  'DUE DILIGENCE',
  'PHP ',
  'Transfer fees may apply',
]) assert.ok(renderer.includes(copy), `Approved renderer copy missing: ${copy}`);
assert.match(experience, /Regular Subscription · ₱199 · 30 Days/u);

assert.match(renderer, /channelCode === 'bpi_instapay'[\s\S]*qrUrl === '\/assets\/payments\/bpi-instapay-199-qr\.png'[\s\S]*qrAmountMode === 'exact'/u);
assert.match(renderer, /data-payment-method-version-id=/u);
assert.doesNotMatch(renderer, /Gilmar|GILMAR/u);

const embedded = experience.slice(
  experience.indexOf('if (embedded) {'),
  experience.indexOf('const methodOptions =', experience.indexOf('if (embedded) {')),
);
assert.equal((embedded.match(/<input\b/gu) || []).length, 1, 'Regular checkout must expose one customer input.');
assert.match(embedded, /id="dd2-payment-proof" type="file"/u);
assert.doesNotMatch(embedded, /type="date"|Transaction reference|dd2-payment-reference|dd2-payment-note/u);
assert.match(embedded, /id="dd2-payment-submit" type="submit" disabled/u);
assert.match(experience, /if \(!isRegularSubscriptionPlan\(plan\)\) \{[\s\S]*form\.set\('paymentDate'/u);
assert.match(experience, /state\.regularPaymentQrReady !== true/u);
assert.match(experience, /captureProof\([\s\S]*reconcileProof\(/u);
assert.match(experience, /Pricing changed\. Select the payment proof again/u);
assert.match(experience, /scheduleOneShotRefresh\([\s\S]*onPayload:[\s\S]*loadCommercialPricing\(viewSequence, \{ plansPayload: payload \}\)/u);
assert.match(experience, /onError:[\s\S]*Payment is paused while the current plan is rechecked/u);
assert.doesNotMatch(experience, /incomingRevision[\s\S]*=== currentRevision/u);
assert.match(experience, /if \(!pricingCheckoutSafety\)[\s\S]*Secure payment controls are unavailable/u);

assert.match(phase2Css, /#dd2-payment-proof:focus-visible \+ \.dd2-payment-dropzone/u);
assert.match(phase2Css, /height: min\(878px, calc\(100dvh - 56px\)\)/u);
assert.match(phase2Css, /\.dd2-payment-dropzone \{[\s\S]*min-height: 240px/u);
assert.match(phase2Css, /#dd2-payment-submit \{[\s\S]*min-height: 76px/u);
assert.match(pricingCss, /\.dd-regular-qr-card \{[\s\S]*356px/u);
assert.match(pricingCss, /\.dd-regular-qr-image \{[\s\S]*300px/u);

const safetyAt = index.indexOf('assets/pricing-checkout-safety.js?v=regular-checkout-r1');
const phase2At = index.indexOf('assets/phase2-experience.js?');
assert.ok(safetyAt > 0 && safetyAt < phase2At, 'Checkout safety must load before the checkout controller.');
assert.doesNotMatch(index, /20260914|2026-09-14/u);
assert.doesNotMatch(serviceWorker, /20260914|2026-09-14/u);
assert.match(serviceWorker, /pricing-checkout-safety\.js\?v=regular-checkout-r1/u);

assert.match(pagesBuilder, /assets\/payments\/bpi-instapay-199-qr\.png/u);
assert.match(pagesBuilder, /assets\/pricing-checkout-safety\.js/u);
assert.doesNotMatch(pagesBuilder, /'assets\/payments\/bpi-instapay-149\.png'/u);
assert.match(pagesTest, /!files\.includes\('assets\/payments\/bpi-instapay-149\.png'\)/u);
assert.match(workerIndex, /pathname === '\/pricing\/legacy-149-qr\.png'[\s\S]*handleLegacyPricingQr/u);
assert.match(workerIndex, /private, no-store, max-age=0/u);

const sanitizedPricing = sanitizePublicPricingSnapshot({
  revisionId: 'a9140000-0000-4000-8000-000000000001',
  effectiveAt: '2026-09-13T16:00:00.000Z',
  publishedAt: '2026-08-31T00:00:00.000Z',
  revision: {
    id: 'a9140000-0000-4000-8000-000000000001',
    revisionNumber: 2,
    effectiveAt: '2026-09-13T16:00:00.000Z',
    publishedAt: '2026-08-31T00:00:00.000Z',
  },
  serverNow: '2026-09-13T16:00:00.000Z',
  plans: [{
    versionId: 'a9140000-0000-4000-8000-000000000102',
    planCode: 'bar_access_30d',
    name: 'Regular Subscription',
    priceCentavos: 19900,
    currency: 'PHP',
    durationDays: 30,
    entitlementMode: 'rolling_days',
    visible: true,
    displayOpen: true,
    checkoutEnabled: true,
    checkoutOpen: true,
    displayStartsAt: '2026-09-13T16:00:00.000Z',
    checkoutStartsAt: '2026-09-13T16:00:00.000Z',
  }],
});
const publicPricingText = JSON.stringify(sanitizedPricing);
for (const privateField of [
  'effectiveAt', 'publishedAt', 'displayStartsAt', 'displayEndsAt',
  'checkoutStartsAt', 'checkoutEndsAt',
]) assert.equal(publicPricingText.includes(privateField), false, `${privateField} leaked publicly.`);
assert.match(accessCore, /renewalAt: null[\s\S]*salesCloseAt: null/u);
assert.doesNotMatch(payment.match(/create or replace function public\.phase4_create_payment_request_v3[\s\S]*?\n\$\$;/u)?.[0] || '', /p_payment_date|p_transaction_reference|p_student_note/u);

assert.equal(qr.readUInt32BE(16), 496);
assert.equal(qr.readUInt32BE(20), 496);
assert.equal(
  createHash('sha256').update(qr).digest('hex').toUpperCase(),
  'B1267985EC3263F9E5B2C6AACBBE81E2890E1AA36C0A8B58D7D7AA050CC8741C',
);

console.log(JSON.stringify({
  ok: true,
  publicInputs: ['payment proof'],
  features: features.length,
  qr: { width: 496, height: 496, exactAmountCentavos: 19900 },
  refresh: 'trusted-server-minute-fail-closed',
}, null, 2));
