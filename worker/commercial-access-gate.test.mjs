import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import coreWorker from './index.mjs';
import commercialWorker, {
  REQUIRED_PAYMENT_VERIFIER_COUNT,
  bytesToBase64,
  normalizePaymentVerificationRecipients,
  sendPaymentVerificationEmail,
  dispatchQueuedPaymentNotification,
  drainPaymentNotificationQueue,
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

test('browser presents token access and the current Regular Subscription checkout', () => {
  assert.match(frontend, /five one-time practice tokens/i);
  assert.match(frontend, /Regular Subscription/);
  assert.doesNotMatch(frontend, /Early Access/);
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
      fields: {},
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
    assert.match(dispatched.body.text, /Customer-provided payment fields: private proof only/);
    assert.doesNotMatch(dispatched.body.text, /transaction reference|customer-provided payment date|customer note/i);
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

const notificationPaymentId = '00000000-0000-4000-8000-000000000002';
const suppressedNotificationModes = [undefined, null, '', ' ', 'suppressed', ' SUPPRESSED ', 'invalid', 'enable', false, true, 0, 1, {}, []];
const inaccessiblePaymentContext = new Proxy({}, { get: () => assert.fail('Suppressed notification must not read private context') });

test('suppressed/default/invalid verifier mode stops before any claim, Storage, recipient or provider request', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; assert.fail('Suppression must make zero transport calls'); });
  for (const mode of suppressedNotificationModes) {
    const env = new Proxy({}, { get: (_target, key) => {
      if (key === 'PAYMENT_NOTIFICATION_EMAIL_MODE') return mode;
      assert.fail('Suppression must not read transport configuration');
    } });
    assert.deepEqual(await sendPaymentVerificationEmail(env, inaccessiblePaymentContext),
      { status: 'suppressed', providerId: null, recipientCount: 0 });
    assert.deepEqual(await dispatchQueuedPaymentNotification(env, notificationPaymentId),
      { status: 'suppressed', recipientCount: 0, paymentRequestId: notificationPaymentId });
    assert.deepEqual(await dispatchQueuedPaymentNotification(env),
      { status: 'suppressed', recipientCount: 0, paymentRequestId: null });
  }
  assert.equal(calls, 0);
});

test('suppressed verifier drain stops after one result without consuming queue attempts', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; assert.fail('Suppressed drain must not claim'); });
  for (const mode of suppressedNotificationModes) {
    assert.deepEqual(await drainPaymentNotificationQueue({ PAYMENT_NOTIFICATION_EMAIL_MODE: mode }, 10),
      [{ status: 'suppressed', recipientCount: 0, paymentRequestId: null }]);
  }
  assert.equal(calls, 0);
});

test('actual scheduled wrapper keeps suppressed verifier and receipt drains transport-free', async (t) => {
  let calls = 0; let coreCalls = 0;
  t.mock.method(globalThis, 'fetch', () => { calls++; assert.fail('Suppressed scheduled notification must not fetch'); });
  t.mock.method(coreWorker, 'scheduled', () => { coreCalls++; return 'unrelated-core-scheduled'; });
  for (const mode of [undefined, 'suppressed', 'invalid']) {
    const waiting = [];
    assert.equal(commercialWorker.scheduled({}, {
      PAYMENT_NOTIFICATION_EMAIL_MODE: mode, SUBSCRIPTION_RECEIPT_EMAIL_MODE: 'suppressed',
    }, { waitUntil: promise => waiting.push(promise) }), 'unrelated-core-scheduled');
    assert.deepEqual(await Promise.all(waiting), [
      [{ status: 'suppressed', recipientCount: 0, paymentRequestId: null }],
      [{ status: 'suppressed', paymentRequestId: null }],
    ]);
  }
  assert.equal(coreCalls, 3); assert.equal(calls, 0);
});

test('enabled verifier keeps claim, original proof, recipient lookup, unchanged envelope/key and completion order', async (t) => {
  const bytes = new TextEncoder().encode('original synthetic proof');
  const proofHash = createHash('sha256').update(bytes).digest('hex');
  const payment = {
    id: notificationPaymentId, status: 'pending', submittedAt: '2026-09-08T00:00:00.000Z',
    provisionalAccessExpiresAt: '2026-09-09T00:00:00.000Z', paymentMethod: 'bpi_instapay',
    amountCentavos: 14900, planName: 'Regular Subscription', durationDays: 30,
    proofObjectPath: 'synthetic-owner/original.png', proofBucket: 'payment-proofs',
    proofOriginalName: 'original.png', proofMimeType: 'image/png', proofSizeBytes: bytes.length, proofSha256: proofHash,
    user: { email: 'subscriber@example.test', displayName: 'Synthetic Subscriber' },
  };
  const recipients = ['one@example.test', 'two@example.test', 'three@example.test', 'four@example.test', 'five@example.test'];
  const env = { PAYMENT_NOTIFICATION_EMAIL_MODE: 'enabled', SUPABASE_URL: 'https://project.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', PAYMENT_NOTIFICATION_EMAIL_FROM: 'Payments <payments@example.test>',
    RESEND_API_KEY: 'synthetic-provider' };
  // Reference the unchanged sender directly, then require the queued enabled path
  // to emit precisely that same provider envelope and idempotency key.
  let reference;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(String(url), 'https://api.resend.com/emails');
    reference = { body: JSON.parse(options.body), key: options.headers['Idempotency-Key'] };
    return Response.json({ id: 'synthetic-accepted' });
  });
  await sendPaymentVerificationEmail(env, { payment, user: payment.user, fields: { paymentMethod: payment.paymentMethod },
    recipients, proof: { bytes, hash: proofHash, name: 'original.png', type: 'image/png', size: bytes.length } });
  const order = []; let queueState = 'pending'; let attempts = 0;
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url); const body = options.body ? JSON.parse(options.body) : null;
    if (target.endsWith('/rpc/phase4_claim_payment_notification')) {
      order.push('claim'); assert.deepEqual(body, { p_payment_request_id: notificationPaymentId });
      if (queueState !== 'pending') return Response.json(null);
      queueState = 'sending'; attempts++; return Response.json(payment);
    }
    if (target.endsWith('/storage/v1/object/payment-proofs/synthetic-owner/original.png')) {
      order.push('proof'); return new Response(bytes);
    }
    if (target.includes('/rest/v1/payment_verification_recipients?')) {
      order.push('recipients'); return Response.json(recipients.map((email, i) => ({ email, display_order: i + 1 })));
    }
    if (target === 'https://api.resend.com/emails') {
      order.push('provider'); assert.deepEqual(JSON.parse(options.body), reference.body);
      assert.equal(options.headers['Idempotency-Key'], reference.key);
      assert.equal(reference.key, `payment-verification-${notificationPaymentId}`);
      return Response.json({ id: 'synthetic-accepted' });
    }
    if (target.endsWith('/rpc/phase4_complete_payment_notification')) {
      order.push('complete');
      assert.deepEqual(body, { p_payment_request_id: notificationPaymentId, p_status: 'sent',
        p_provider_id: 'synthetic-accepted', p_error: null });
      queueState = body.p_status; return Response.json(null);
    }
    assert.fail('Unexpected mocked notification request');
  });
  assert.deepEqual(await dispatchQueuedPaymentNotification(env, notificationPaymentId),
    { status: 'sent', recipientCount: 5, paymentRequestId: notificationPaymentId });
  assert.deepEqual(order, ['claim', 'proof', 'recipients', 'provider', 'complete']);
  assert.equal(attempts, 1);
  assert.deepEqual(await dispatchQueuedPaymentNotification(env, notificationPaymentId), { status: 'idle', recipientCount: 0 });
  assert.equal(attempts, 1); assert.equal(order.filter(value => value === 'provider').length, 1);
});

test('enabled unreadable-proof failure still settles the existing failed outcome without calling provider', async (t) => {
  const order = [];
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (url, options = {}) => {
    const target = String(url);
    if (target.endsWith('/rpc/phase4_claim_payment_notification')) {
      order.push('claim'); return Response.json({ id: notificationPaymentId,
        proofObjectPath: 'synthetic-owner/missing.png', proofBucket: 'payment-proofs' });
    }
    if (target.endsWith('/storage/v1/object/payment-proofs/synthetic-owner/missing.png')) {
      order.push('proof'); return new Response(null, { status: 400 });
    }
    if (target.endsWith('/rpc/phase4_complete_payment_notification')) {
      order.push('complete'); assert.deepEqual(JSON.parse(options.body), {
        p_payment_request_id: notificationPaymentId, p_status: 'failed', p_provider_id: null,
        p_error: 'Canonical payment proof could not be read (400).',
      }); return Response.json(null);
    }
    assert.fail('Proof failure must not reach recipient lookup or provider');
  });
  assert.deepEqual(await dispatchQueuedPaymentNotification({
    PAYMENT_NOTIFICATION_EMAIL_MODE: 'enabled', SUPABASE_URL: 'https://project.example.test',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  }, notificationPaymentId), { status: 'failed', recipientCount: 0, paymentRequestId: notificationPaymentId });
  assert.deepEqual(order, ['claim', 'proof', 'complete']);
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
