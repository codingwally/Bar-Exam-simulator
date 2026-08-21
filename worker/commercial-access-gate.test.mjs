import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  REQUIRED_PAYMENT_VERIFIER_COUNT,
  bytesToBase64,
  normalizePaymentVerificationRecipients,
  sendPaymentVerificationEmail,
} from './commercial-entry.mjs';

const commercialMigration = readFileSync(new URL(
  '../supabase/migrations/20260821120000_soft_launch_five_token_trial.sql',
  import.meta.url,
), 'utf8');
const verifierMigration = readFileSync(new URL(
  '../supabase/migrations/20260818123100_private_payment_verifiers.sql',
  import.meta.url,
), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const featureLoader = readFileSync(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const phase2Css = readFileSync(new URL('../assets/phase2.css', import.meta.url), 'utf8');
const productionWrangler = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');
const maintenanceEntry = readFileSync(new URL('./maintenance-entry.mjs', import.meta.url), 'utf8');

test('ordinary commercial accounts receive five one-time tokens without a plan choice', () => {
  assert.match(commercialMigration, /create table if not exists public\.introductory_token_grants/);
  assert.match(commercialMigration, /create table if not exists public\.introductory_token_ledger/);
  assert.match(commercialMigration, /token_limit integer not null default 5 check \(token_limit = 5\)/);
  assert.match(commercialMigration, /v_basis := 'introductory_tokens'/);
  assert.match(commercialMigration, /mandatory_access_choice_enabled = false/);
  assert.match(commercialMigration, /global_beta_all_access_enabled = false/);
  assert.doesNotMatch(commercialMigration, /create or replace function public\.phase4_choose_launch_trial/);
});

test('an exhausted introductory allowance cannot reset or over-reserve', () => {
  assert.match(commercialMigration, /raise exception 'INTRODUCTORY_TOKENS_EXHAUSTED'/);
  assert.match(commercialMigration, /'reason', 'insufficient_introductory_tokens'/);
  assert.match(commercialMigration, /introductory_token_ledger_one_consumption_uidx/);
  assert.doesNotMatch(commercialMigration, /Philippine midnight|calendar day|daily reset/i);
});

test('introductory token storage is backend-only and migration replay is safe', () => {
  assert.match(
    commercialMigration,
    /revoke all on table public\.introductory_token_grants from public, anon, authenticated/,
  );
  assert.match(
    commercialMigration,
    /grant select, insert, update, delete on table public\.introductory_token_grants to service_role/,
  );
  assert.match(commercialMigration, /on conflict \(user_id\) do nothing/);
  assert.match(commercialMigration, /terms-soft-launch-v1-2026-08-21/);
  assert.match(commercialMigration, /privacy-soft-launch-v1-2026-08-21/);
});

test('public catalog exposes only ₱149 Early Access with ₱199 manual renewal', () => {
  assert.match(commercialMigration, /'planCode', 'early_access_beta'/);
  assert.match(commercialMigration, /'priceCentavos', 14900/);
  assert.match(commercialMigration, /'regularPriceCentavos', v_settings\.early_access_regular_price_centavos/);
  assert.match(commercialMigration, /'billing', 'manual_renewal'/);
  assert.match(commercialMigration, /'manualRenewal', true/);
  assert.match(commercialMigration, /'automaticRenewal', false/);
  assert.doesNotMatch(commercialMigration, /'planCode',\s*'free'/);
  assert.doesNotMatch(commercialMigration, /'planCode',\s*'(?:standard|premium)'/);
});

test('browser presents token access and a single Early Access checkout', () => {
  assert.match(frontend, /five one-time practice tokens/i);
  assert.match(frontend, /Early Access/);
  assert.doesNotMatch(frontend, /dd2-choose-free/);
  assert.doesNotMatch(frontend, /access\/choose/);
  assert.doesNotMatch(frontend, /plan_selection_required/);
  assert.doesNotMatch(frontend, /new MutationObserver/);
  assert.doesNotMatch(featureLoader, /assets\/free-trial-five-daily\.js/);
  assert.doesNotMatch(phase2Css, /Five successful question submissions per Philippine calendar day/);
});

test('payment verifier directory is private and contains no committed addresses', () => {
  assert.match(verifierMigration, /create table if not exists public\.payment_verification_recipients/);
  assert.match(verifierMigration, /force row level security/);
  assert.match(
    verifierMigration,
    /revoke all on table public\.payment_verification_recipients[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    verifierMigration,
    /grant select on table public\.payment_verification_recipients to service_role/,
  );
  assert.doesNotMatch(verifierMigration, /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
});

test('payment verifier rows are ordered, normalized, deduplicated, and complete', () => {
  const recipients = normalizePaymentVerificationRecipients([
    { email: 'third@example.test', display_order: 3 },
    { email: ' FIRST@EXAMPLE.TEST ', display_order: 1 },
    { email: 'second@example.test', display_order: 2 },
    { email: 'fourth@example.test', display_order: 4 },
    { email: 'fifth@example.test', display_order: 5 },
    { email: 'first@example.test', display_order: 6 },
    { email: 'not-an-email', display_order: 7 },
  ]);
  assert.deepEqual(recipients, [
    'first@example.test',
    'second@example.test',
    'third@example.test',
    'fourth@example.test',
    'fifth@example.test',
  ]);
  assert.equal(recipients.length, REQUIRED_PAYMENT_VERIFIER_COUNT);
});

test('binary proof attachment encoding is stable', () => {
  assert.equal(bytesToBase64(new Uint8Array([0, 1, 2, 253, 254, 255])), 'AAEC/f7/');
});

test('enabled payment email sends one To, four BCCs, and the original proof', async () => {
  const originalFetch = globalThis.fetch;
  let dispatched = null;
  globalThis.fetch = async (url, options) => {
    dispatched = {
      url: String(url),
      headers: options.headers,
      body: JSON.parse(options.body),
    };
    return new Response(JSON.stringify({ id: 'email_test_123' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const proof = new Blob(['sample-proof'], { type: 'image/png' });
  Object.defineProperty(proof, 'name', { value: 'receipt.png' });
  try {
    const result = await sendPaymentVerificationEmail({
      PAYMENT_NOTIFICATION_EMAIL_MODE: 'enabled',
      PAYMENT_NOTIFICATION_EMAIL_FROM: 'Payments <payments@example.test>',
      RESEND_API_KEY: 'test-only-key',
    }, {
      recipients: [
        'first@example.test',
        'second@example.test',
        'third@example.test',
        'fourth@example.test',
        'fifth@example.test',
      ],
      user: {
        id: '00000000-0000-4000-8000-000000000001',
        email: 'subscriber@example.test',
        displayName: 'Test Subscriber',
      },
      payment: {
        id: '00000000-0000-4000-8000-000000000002',
        status: 'pending',
        submittedAt: '2026-08-18T12:00:00.000Z',
        provisionalAccessExpiresAt: '2026-08-19T12:00:00.000Z',
      },
      fields: {
        paymentDate: '2026-08-18',
        transactionReference: 'TEST-REFERENCE-123',
        note: 'Automated contract test',
      },
      proof,
    });

    assert.deepEqual(result, {
      status: 'sent',
      providerId: 'email_test_123',
      recipientCount: 5,
    });
    assert.equal(dispatched.url, 'https://api.resend.com/emails');
    assert.deepEqual(dispatched.body.to, ['first@example.test']);
    assert.deepEqual(dispatched.body.bcc, [
      'second@example.test',
      'third@example.test',
      'fourth@example.test',
      'fifth@example.test',
    ]);
    assert.equal(dispatched.body.reply_to, 'subscriber@example.test');
    assert.equal(dispatched.body.attachments.length, 1);
    assert.equal(dispatched.body.attachments[0].filename, 'receipt.png');
    assert.equal(
      dispatched.body.attachments[0].content,
      bytesToBase64(new TextEncoder().encode('sample-proof')),
    );
    assert.match(dispatched.body.text, /Test Subscriber/);
    assert.match(dispatched.body.text, /TEST-REFERENCE-123/);
    assert.match(dispatched.body.text, /Attached proof SHA-256:/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payment email remains suppressed unless its dedicated mode is enabled', async () => {
  const result = await sendPaymentVerificationEmail(
    { PAYMENT_NOTIFICATION_EMAIL_MODE: 'suppressed' },
    {},
  );
  assert.deepEqual(result, {
    status: 'suppressed',
    providerId: null,
    recipientCount: 0,
  });
});

test('production Worker keeps the secure payment wrapper behind maintenance', () => {
  assert.match(productionWrangler, /^main = "maintenance-entry\.mjs"$/m);
  assert.match(maintenanceEntry, /import applicationWorker from '\.\/commercial-entry\.mjs'/);
  assert.match(maintenanceEntry, /return applicationWorker\.fetch/);
  assert.match(productionWrangler, /^PAYMENT_NOTIFICATION_EMAIL_MODE = "enabled"$/m);
  assert.match(
    productionWrangler,
    /^PAYMENT_NOTIFICATION_EMAIL_FROM = "Due Diligence Payments <support@duediligence\.ph>"$/m,
  );
});
