import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  REQUIRED_PAYMENT_VERIFIER_COUNT,
  bytesToBase64,
  normalizePaymentVerificationRecipients,
  sendPaymentVerificationEmail,
} from './commercial-entry.mjs';

const paywallMigration = readFileSync(new URL(
  '../supabase/migrations/20260818123000_require_early_access.sql',
  import.meta.url,
), 'utf8');
const choiceMigration = readFileSync(new URL(
  '../supabase/migrations/20260818133000_restore_two_option_access_choice.sql',
  import.meta.url,
), 'utf8');
const dailyMigration = readFileSync(new URL(
  '../supabase/migrations/20260818143000_free_trial_five_daily_choice.sql',
  import.meta.url,
), 'utf8');
const verifierMigration = readFileSync(new URL(
  '../supabase/migrations/20260818123100_private_payment_verifiers.sql',
  import.meta.url,
), 'utf8');
const frontend = readFileSync(new URL('../assets/phase4-experience.js', import.meta.url), 'utf8');
const dailyCopy = readFileSync(new URL('../assets/free-trial-five-daily.js', import.meta.url), 'utf8');
const featureLoader = readFileSync(new URL('../assets/feature-loader.js', import.meta.url), 'utf8');
const productionWrangler = readFileSync(new URL('./wrangler.toml', import.meta.url), 'utf8');

test('ordinary commercial accounts are locked until an explicit access choice', () => {
  assert.match(paywallMigration, /v_basis := 'payment_required'/);
  assert.match(choiceMigration, /plan_selection_required/);
  assert.match(choiceMigration, /create or replace function public\.phase4_choose_launch_trial/);
  assert.match(dailyMigration, /v_trial_active/);
  assert.match(dailyMigration, /when v_remaining > 0 then 'daily_free'/);
  assert.match(dailyMigration, /else 'daily_limit_reached'/);
  assert.match(dailyMigration, /'basis', 'plan_selection_required'/);
  assert.match(dailyMigration, /'choiceRequired', true/);
  assert.doesNotMatch(
    dailyMigration,
    /if v_trial_active then[\s\S]*'unlimited', true/,
  );
});

test('public catalog exposes five-per-day Free Trial and ₱149 Early Access', () => {
  assert.match(dailyMigration, /'planCode', 'free'/);
  assert.match(dailyMigration, /'name', 'Free Trial'/);
  assert.match(dailyMigration, /'billing', 'daily_free_trial'/);
  assert.match(dailyMigration, /Five protected question submissions per Philippine day/);
  assert.match(dailyMigration, /Allowance resets at midnight in Asia\/Manila/);
  assert.match(dailyMigration, /'planCode', 'early_access_beta'/);
  assert.match(dailyMigration, /'priceCentavos', 14900/);
  assert.doesNotMatch(dailyMigration, /'planCode',\s*'(?:standard|premium)'/);
});

test('browser preserves the mandatory two-choice Retainer gate', () => {
  assert.match(frontend, /plan_selection_required/);
  assert.match(frontend, /dd2-start-free-trial/);
  assert.match(frontend, /access\/choose/);
  assert.match(frontend, /legacy\.openView\?\.\('pricing'\)/);
  assert.match(frontend, /data-dd2-early-access-card/);
  assert.match(frontend, /dd2-native-close, #dd2-native-back/);
  assert.match(dailyCopy, /5 protected question submissions per Philippine day/);
  assert.match(dailyCopy, /Free Trial · \$\{remaining\} of \$\{limit\} remaining today/);
  assert.match(dailyCopy, /used all 5 Free Trial questions for today/);
  assert.match(featureLoader, /assets\/free-trial-five-daily\.js/);
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

test('production worker uses the secure notification wrapper', () => {
  assert.match(productionWrangler, /^main = "commercial-entry\.mjs"$/m);
  assert.match(productionWrangler, /^PAYMENT_NOTIFICATION_EMAIL_MODE = "enabled"$/m);
  assert.match(
    productionWrangler,
    /^PAYMENT_NOTIFICATION_EMAIL_FROM = "Due Diligence Payments <support@duediligence\.ph>"$/m,
  );
});
