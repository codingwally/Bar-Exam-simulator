import assert from 'node:assert/strict';
import test from 'node:test';

import coreWorker from './index.mjs';
import { paymentEmailText } from './commercial-entry.mjs';
import {
  normalizePricingAdminAction,
  PricingValidationError,
  sanitizePublicPricingSnapshot,
  validatePricingAsset,
} from './pricing-core.mjs';
import { normalizePaymentFields } from './payment-core.mjs';
import { subscriptionReceiptContent } from './subscription-receipt.mjs';

const ORIGIN = 'https://duediligence.ph';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REVISION_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_149_ID = '22222222-2222-4222-8222-222222222222';
const PLAN_199_ID = '33333333-3333-4333-8333-333333333333';
const CHANNEL_ID = '44444444-4444-4444-8444-444444444444';
const PAYMENT_ID = '55555555-5555-4555-8555-555555555555';
const ASSET_ID = '66666666-6666-4666-8666-666666666666';
const DRAFT_ID = '77777777-7777-4777-8777-777777777777';

const env = Object.freeze({
  ALLOWED_ORIGIN: ORIGIN,
  SUPABASE_URL: 'https://project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
  PRIVATE_BETA_GATE_ENABLED: 'false',
});

function request(path, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set('Origin', ORIGIN);
  return new Request(`https://api.example.test${path}`, { ...init, headers });
}

function publishedSnapshot() {
  return {
    revisionId: REVISION_ID,
    serverNow: '2026-09-02T00:00:00.000Z',
    revision: {
      id: REVISION_ID,
      revisionNumber: 4,
      effectiveAt: '2026-09-02T00:00:00.000Z',
      publishedAt: '2026-08-31T06:00:00.000Z',
      internalActorId: USER_ID,
    },
    page: {
      eyebrow: 'Choose your access',
      title: 'Plans & Pricing',
      intro: 'Published content.',
      notice: 'September 1 is a transition day.',
      finePrint: 'Manual payment; no automatic renewal.',
      privateMemo: 'must not leak',
    },
    plans: [
      {
        versionId: PLAN_149_ID,
        planCode: 'early_access_beta',
        name: 'Legacy Early Access',
        badge: 'Legacy',
        priceCentavos: 14900,
        durationDays: null,
        entitlementMode: 'fixed_end',
        fixedEntitlementEndsAt: '2027-01-01T00:00:00Z',
        description: 'Available before cutoff only.',
        features: ['Legacy access'],
        ctaLabel: 'Legacy',
        renewalNote: 'No new checkout.',
        visible: false,
        displayStartsAt: '2026-01-01T00:00:00Z',
        displayEndsAt: '2026-09-01T00:00:00Z',
        displayOpen: false,
        checkoutEnabled: false,
        checkoutStartsAt: '2026-01-01T00:00:00Z',
        checkoutEndsAt: '2026-09-01T00:00:00Z',
        checkoutOpen: false,
        sortOrder: 1,
        databaseOnlySecret: 'no',
      },
      {
        versionId: PLAN_199_ID,
        planCode: 'bar_review_30_day',
        name: '30-Day Access',
        badge: 'Current',
        priceCentavos: 19900,
        currency: 'PHP',
        durationDays: 30,
        description: 'Thirty days from approval.',
        features: ['All paid study tools'],
        ctaLabel: 'Subscribe',
        renewalNote: 'Manual renewal only.',
        visible: true,
        displayStartsAt: '2026-09-02T00:00:00Z',
        displayEndsAt: null,
        displayOpen: true,
        checkoutEnabled: true,
        checkoutStartsAt: '2026-09-02T00:00:00Z',
        checkoutEndsAt: null,
        checkoutOpen: true,
        sortOrder: 2,
      },
    ],
    paymentMethods: [{
      versionId: CHANNEL_ID,
      channelCode: 'bpi_instapay',
      planCode: 'bar_review_30_day',
      label: 'BPI InstaPay',
      accountName: 'Due Diligence',
      accountDetails: 'Account ending 1234',
      instructions: 'Pay the exact published amount.',
      qrAsset: {
        assetId: ASSET_ID,
        sha256: 'a'.repeat(64),
        mimeType: 'image/png',
        width: 256,
        height: 256,
        objectPath: 'must-not-leak.png',
      },
      qrUrl: `/pricing/assets/${ASSET_ID}`,
      qrAmountMode: 'exact',
      qrAmountCentavos: 19900,
      enabled: true,
      sortOrder: 1,
    }, {
      versionId: '88888888-8888-4888-8888-888888888888',
      channelCode: 'legacy_bpi_qr',
      planCode: 'early_access_beta',
      label: 'Legacy BPI QR',
      accountName: 'Due Diligence',
      accountDetails: 'Legacy static asset',
      instructions: 'Legacy only.',
      qrAsset: null,
      qrUrl: '/assets/payments/bpi-instapay-qr.png',
      qrAmountMode: 'generic',
      qrAmountCentavos: null,
      enabled: false,
      sortOrder: 2,
    }],
    faqs: [{ id: 'renewal', question: 'Does it renew?', answer: 'No.', visible: true, sortOrder: 1 }],
    serviceRoleOnly: 'must not leak',
  };
}

function pngBytes(width = 256, height = 256) {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52], 8);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  return bytes;
}

function authenticatedUserResponse() {
  return Response.json({
    id: USER_ID,
    email: 'founder@example.test',
    user_metadata: { full_name: 'Founder' },
    app_metadata: { provider: 'email' },
  });
}

test('public pricing sanitizer returns every published plan and strips internal fields', () => {
  const pricing = sanitizePublicPricingSnapshot(publishedSnapshot());
  assert.deepEqual(pricing.plans.map((plan) => plan.planCode), [
    'early_access_beta',
    'bar_review_30_day',
  ]);
  assert.equal(pricing.plans[1].priceCentavos, 19900);
  assert.equal(pricing.plans[1].durationDays, 30);
  assert.equal(pricing.plans[1].displayOpen, true);
  assert.equal(pricing.plans[0].entitlementMode, 'fixed_end');
  assert.equal(pricing.plans[0].fixedEntitlementEndsAt, '2027-01-01T00:00:00.000Z');
  assert.equal(pricing.paymentMethods[0].paymentChannelVersionId, CHANNEL_ID);
  assert.equal(pricing.paymentMethods[0].qrUrl, `/pricing/assets/${ASSET_ID}`);
  assert.equal(pricing.paymentMethods[1].qrUrl, '/assets/payments/bpi-instapay-qr.png');
  assert.equal('objectPath' in pricing.paymentMethods[0].qrAsset, false);
  assert.equal('serviceRoleOnly' in pricing, false);
  assert.equal('privateMemo' in pricing.page, false);
});

test('/plans returns the authoritative full snapshot with compatibility fields', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/rest/v1/rpc/phase4_pricing_snapshot')) {
      return Response.json(publishedSnapshot());
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await coreWorker.fetch(request('/plans', { method: 'POST' }), env, {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.plans.map((plan) => plan.planCode), [
      'early_access_beta',
      'bar_review_30_day',
    ]);
    assert.deepEqual(payload.pricing.plans, payload.plans);
    assert.equal(payload.serverNow, '2026-09-02T00:00:00.000Z');
    assert.equal(payload.revisionId, REVISION_ID);
    assert.equal(calls.length, 1);
    assert.doesNotMatch(calls[0].url, /phase4_plan_catalog/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('/plans preserves the September 1 transition gap without reviving legacy checkout', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/rest/v1/rpc/phase4_pricing_snapshot')) {
      return Response.json({
        revisionId: REVISION_ID,
        serverNow: '2026-09-01T04:00:00.000Z',
        page: publishedSnapshot().page,
        plans: [],
        paymentMethods: [],
        faqs: [],
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await coreWorker.fetch(request('/plans', { method: 'POST' }), env, {});
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.plans, []);
    assert.deepEqual(payload.pricing.paymentMethods, []);
    assert.equal(payload.serverNow, '2026-09-01T04:00:00.000Z');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('payment field normalization ignores browser price and plan labels', () => {
  const normalized = normalizePaymentFields({
    planVersionId: PLAN_199_ID,
    paymentChannelVersionId: CHANNEL_ID,
    paymentDate: '2026-09-02',
    paymentReference: 'BPI-REF-199',
    amountPhp: 0.01,
    planCode: 'early_access_beta',
    paymentMethod: 'cash',
  });
  assert.deepEqual(normalized, {
    planVersionId: PLAN_199_ID,
    paymentChannelVersionId: CHANNEL_ID,
    paymentDate: '2026-09-02',
    paymentReference: 'BPI-REF-199',
  });
});

test('/payments/submit forwards only version IDs and lets the database return trusted amount and term', async () => {
  const originalFetch = globalThis.fetch;
  let paymentRpcBody = null;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/auth/v1/user') return authenticatedUserResponse();
    if (pathname.startsWith('/storage/v1/object/payment-proofs/')) {
      return new Response(null, { status: 200 });
    }
    if (pathname === '/rest/v1/rpc/phase4_create_payment_request_v2') {
      paymentRpcBody = JSON.parse(init.body);
      return Response.json({
        id: PAYMENT_ID,
        status: 'pending',
        planCode: 'bar_review_30_day',
        planVersionId: PLAN_199_ID,
        paymentChannelVersionId: CHANNEL_ID,
        pricingRevisionId: REVISION_ID,
        planName: '30-Day Access',
        amountPhp: 199,
        amountCentavos: 19900,
        currency: 'PHP',
        durationDays: 30,
        entitlementMode: 'rolling_days',
        fixedEndsAt: null,
        submittedAt: '2026-09-02T01:02:03Z',
        provisionalAccessExpiresAt: null,
        provisionalGrantReused: false,
        replayed: false,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const form = new FormData();
    form.set('planVersionId', PLAN_199_ID);
    form.set('paymentChannelVersionId', CHANNEL_ID);
    form.set('paymentDate', '2026-09-02');
    form.set('paymentReference', 'BPI-REF-199');
    form.set('amountPhp', '0.01');
    form.set('planCode', 'early_access_beta');
    form.set('proof', new Blob([pngBytes()], { type: 'image/png' }), 'proof.png');
    const response = await coreWorker.fetch(request('/payments/submit', {
      method: 'POST',
      headers: { Authorization: 'Bearer verified-test-token', 'X-Request-ID': 'payment-test-request-0001' },
      body: form,
    }), env, {});
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.payment.amountCentavos, 19900);
    assert.equal(payload.payment.amountPhp, 199);
    assert.equal(payload.payment.durationDays, 30);
    assert.equal(payload.payment.planName, '30-Day Access');
    assert.equal(paymentRpcBody.p_plan_version_id, PLAN_199_ID);
    assert.equal(paymentRpcBody.p_payment_channel_version_id, CHANNEL_ID);
    assert.equal(paymentRpcBody.p_payment_reference, 'BPI-REF-199');
    assert.equal('p_amount_php' in paymentRpcBody, false);
    assert.equal('p_plan_code' in paymentRpcBody, false);
    assert.equal('p_payment_method' in paymentRpcBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ordinary administrators are denied from the pricing editor before pricing RPC access', async () => {
  const originalFetch = globalThis.fetch;
  const paths = [];
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    paths.push(pathname);
    if (pathname === '/auth/v1/user') return authenticatedUserResponse();
    if (pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role: 'admin' });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const response = await coreWorker.fetch(request('/admin/pricing/query', {
      method: 'POST',
      headers: { Authorization: 'Bearer ordinary-admin-token' },
      body: JSON.stringify({ operation: 'editor_snapshot' }),
    }), env, {});
    assert.equal(response.status, 403);
    const payload = await response.json();
    assert.equal(payload.error.code, 'PRICING_ADMIN_FORBIDDEN');
    assert.equal(paths.includes('/rest/v1/rpc/phase4_admin_pricing_snapshot'), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('founder pricing action forwards optimistic-lock and config fields to the generic RPC', async () => {
  const originalFetch = globalThis.fetch;
  let actionBody = null;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/auth/v1/user') return authenticatedUserResponse();
    if (pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role: 'founder_admin' });
    }
    if (pathname === '/rest/v1/rpc/phase4_admin_pricing_action') {
      actionBody = JSON.parse(init.body);
      return Response.json({
        ok: true,
        operation: 'save_draft',
        requestKey: 'pricing-save-request-0001',
        revisionId: DRAFT_ID,
        lockVersion: 8,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  const config = { page: { title: 'Plans & Pricing' }, plans: [], paymentMethods: [], faqs: [] };
  try {
    const response = await coreWorker.fetch(request('/admin/pricing/action', {
      method: 'POST',
      headers: { Authorization: 'Bearer founder-pricing-token' },
      body: JSON.stringify({
        operation: 'save_draft',
        requestKey: 'pricing-save-request-0001',
        expectedDraftVersion: 7,
        draftRevisionId: DRAFT_ID,
        expectedLiveRevisionId: REVISION_ID,
        config,
      }),
    }), env, {});
    assert.equal(response.status, 200);
    assert.deepEqual(actionBody, {
      p_actor_user_id: USER_ID,
      p_operation: 'save_draft',
      p_request_key: 'pricing-save-request-0001',
      p_expected_lock_version: 7,
      p_draft_revision_id: DRAFT_ID,
      p_source_revision_id: REVISION_ID,
      p_publish_at: null,
      p_config: config,
      p_reason: null,
      p_confirmed: false,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('rollback binds its target and expected live revision to separate RPC slots', () => {
  const rollbackTargetId = '99999999-9999-4999-8999-999999999999';
  const action = normalizePricingAdminAction({
    operation: 'rollback',
    requestKey: 'pricing-rollback-0001',
    sourceRevisionId: rollbackTargetId,
    expectedLiveRevisionId: REVISION_ID,
    reason: 'Restore the previously approved pricing revision.',
    confirmed: true,
  });

  assert.equal(action.sourceRevisionId, rollbackTargetId);
  assert.equal(action.draftRevisionId, REVISION_ID);
  assert.throws(
    () => normalizePricingAdminAction({
      operation: 'rollback',
      requestKey: 'pricing-rollback-0002',
      sourceRevisionId: rollbackTargetId,
      reason: 'Restore the previously approved pricing revision.',
      confirmed: true,
    }),
    (error) => error instanceof PricingValidationError
      && error.code === 'INVALID_PRICING_REVISION'
      && /current live revision/u.test(error.message),
  );
});

test('QR validation accepts real PNG structure and rejects SVG or unreasonable dimensions', () => {
  const valid = validatePricingAsset(pngBytes(256, 256), 'image/png', 'payment-qr.png');
  assert.equal(valid.width, 256);
  assert.equal(valid.height, 256);
  assert.throws(
    () => validatePricingAsset(
      new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
      'image/svg+xml',
      'payment-qr.svg',
    ),
    (error) => error instanceof PricingValidationError && error.status === 415,
  );
  assert.throws(
    () => validatePricingAsset(pngBytes(32, 32), 'image/png', 'tiny.png'),
    (error) => error instanceof PricingValidationError
      && error.code === 'UNSAFE_PRICING_ASSET_DIMENSIONS',
  );
});

test('Founder QR upload stores an immutable private object and registers computed metadata', async () => {
  const originalFetch = globalThis.fetch;
  let uploadPath = null;
  let registration = null;
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/auth/v1/user') return authenticatedUserResponse();
    if (pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role: 'founder_admin' });
    }
    if (pathname.startsWith('/storage/v1/object/pricing-assets/')) {
      uploadPath = decodeURIComponent(pathname.split('/pricing-assets/')[1]);
      assert.equal(init.method, 'POST');
      assert.equal(init.headers['x-upsert'], 'false');
      assert.equal(init.headers['Content-Type'], 'image/png');
      return Response.json({ Key: uploadPath });
    }
    if (pathname === '/rest/v1/rpc/phase4_admin_register_pricing_asset') {
      registration = JSON.parse(init.body);
      return Response.json({
        assetId: ASSET_ID,
        bucketId: registration.p_bucket_id,
        objectPath: registration.p_object_path,
        mimeType: registration.p_mime_type,
        sizeBytes: registration.p_size_bytes,
        width: registration.p_width,
        height: registration.p_height,
        sha256: registration.p_sha256,
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const form = new FormData();
    form.set('requestKey', 'pricing-upload-request-0001');
    form.set('file', new Blob([pngBytes()], { type: 'image/png' }), 'checkout-qr.png');
    const response = await coreWorker.fetch(request('/admin/pricing/assets/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer founder-upload-token' },
      body: form,
    }), env, {});
    assert.equal(response.status, 201);
    const payload = await response.json();
    assert.equal(payload.asset.assetId, ASSET_ID);
    assert.equal(payload.asset.width, 256);
    assert.equal(payload.asset.height, 256);
    assert.equal(payload.asset.mimeType, 'image/png');
    assert.match(uploadPath, /^assets\/[0-9a-f]{2}\/[0-9a-f-]+-[0-9a-f]{64}\.png$/u);
    assert.equal(registration.p_actor_user_id, USER_ID);
    assert.equal(registration.p_request_key, 'pricing-upload-request-0001');
    assert.equal(registration.p_object_path, uploadPath);
    assert.equal(registration.p_size_bytes, pngBytes().byteLength);
    assert.match(registration.p_sha256, /^[0-9a-f]{64}$/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('failed QR registration deletes the newly uploaded orphan', async () => {
  const originalFetch = globalThis.fetch;
  const storageMethods = [];
  globalThis.fetch = async (url, init = {}) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/auth/v1/user') return authenticatedUserResponse();
    if (pathname === '/rest/v1/rpc/admin_authorization_context') {
      return Response.json({ authorized: true, role: 'super_admin' });
    }
    if (pathname.startsWith('/storage/v1/object/pricing-assets/')) {
      storageMethods.push(init.method || 'GET');
      return new Response(null, { status: 200 });
    }
    if (pathname === '/rest/v1/rpc/phase4_admin_register_pricing_asset') {
      return Response.json({ message: 'temporary database outage' }, { status: 500 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const form = new FormData();
    form.set('requestKey', 'pricing-upload-request-0002');
    form.set('file', new Blob([pngBytes()], { type: 'image/png' }), 'checkout-qr.png');
    const response = await coreWorker.fetch(request('/admin/pricing/assets/upload', {
      method: 'POST',
      headers: { Authorization: 'Bearer super-upload-token' },
      body: form,
    }), env, {});
    assert.equal(response.status, 503);
    assert.deepEqual(storageMethods, ['POST', 'DELETE']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('public QR endpoint hides unpublished assets and streams published assets with immutable caching', async () => {
  const originalFetch = globalThis.fetch;
  let published = false;
  let storageReads = 0;
  globalThis.fetch = async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === '/rest/v1/rpc/phase4_pricing_public_asset') {
      return Response.json(published ? {
        assetId: ASSET_ID,
        bucketId: 'pricing-assets',
        objectPath: `assets/aa/${ASSET_ID}.png`,
        mimeType: 'image/png',
        sizeBytes: pngBytes().byteLength,
        width: 256,
        height: 256,
        sha256: 'a'.repeat(64),
      } : null);
    }
    if (pathname.startsWith('/storage/v1/object/pricing-assets/')) {
      storageReads += 1;
      return new Response(pngBytes(), { headers: { 'Content-Type': 'application/octet-stream' } });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
  try {
    const hidden = await coreWorker.fetch(new Request(
      `https://api.example.test/pricing/assets/${ASSET_ID}`,
    ), env, {});
    assert.equal(hidden.status, 404);
    assert.equal(storageReads, 0);

    published = true;
    const visible = await coreWorker.fetch(new Request(
      `https://api.example.test/pricing/assets/${ASSET_ID}`,
    ), env, {});
    assert.equal(visible.status, 200);
    assert.equal(visible.headers.get('Content-Type'), 'image/png');
    assert.equal(visible.headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(visible.headers.get('ETag'), `"${'a'.repeat(64)}"`);
    assert.equal(visible.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
    assert.deepEqual(new Uint8Array(await visible.arrayBuffer()), pngBytes());
    assert.equal(storageReads, 1);

    const cached = await coreWorker.fetch(new Request(
      `https://api.example.test/pricing/assets/${ASSET_ID}`,
      { headers: { 'If-None-Match': `"${'a'.repeat(64)}"` } },
    ), env, {});
    assert.equal(cached.status, 304);
    assert.equal(storageReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('verifier email uses trusted dynamic plan, amount, term, and channel context', () => {
  const text = paymentEmailText({
    payment: {
      id: PAYMENT_ID,
      planVersionId: PLAN_199_ID,
      planCode: 'bar_review_30_day',
      planName: '30-Day Access',
      amountCentavos: 19900,
      currency: 'PHP',
      durationDays: 30,
      paymentChannelLabel: 'BPI InstaPay',
      paymentDate: '2026-09-02',
      paymentReference: 'BPI-REF-199',
      submittedAt: '2026-09-02T01:02:03Z',
    },
    user: { id: USER_ID, email: 'student@example.test' },
    proof: { name: 'proof.png', type: 'image/png', size: 24 },
    proofHash: 'b'.repeat(64),
  });
  assert.match(text, /30-Day Access/);
  assert.match(text, /₱199\.00/);
  assert.match(text, /30 days from approval/);
  assert.match(text, /BPI InstaPay/);
  assert.doesNotMatch(text, /₱149\.00/);
});

test('receipt uses dynamic captured context and retains historical Early Access fallback', () => {
  const current = subscriptionReceiptContent({
    payment: {
      id: PAYMENT_ID,
      planVersionId: PLAN_199_ID,
      planCode: 'bar_review_30_day',
      planName: '30-Day Access',
      amountCentavos: 19900,
      currency: 'PHP',
      durationDays: 30,
      paymentChannelLabel: 'BPI InstaPay',
      paymentReference: 'BPI-REF-199',
      paymentDate: '2026-09-02',
      approvedAt: '2026-09-02T02:00:00Z',
      purchasedStartsAt: '2026-09-02T02:00:00Z',
      purchasedEndsAt: '2026-10-02T02:00:00Z',
    },
    user: { displayName: 'Student' },
    subscription: { expiresAt: '2026-10-02T02:00:00Z' },
  });
  assert.match(current.subject, /30-Day Access/);
  assert.match(current.text, /₱199\.00/);
  assert.match(current.text, /Term: 30 days from approval/);
  assert.match(current.text, /Access begins:/);
  assert.match(current.text, /Access through:/);
  assert.match(current.internalReference, /^DD-PAY-/);
  assert.doesNotMatch(current.text, /Plan: Early Access/);

  const historical = subscriptionReceiptContent({
    payment: {
      id: PAYMENT_ID,
      amountPhp: 149,
      paymentMethod: 'bpi_instapay',
      transactionReference: 'LEGACY-149',
      paymentDate: '2026-08-31',
    },
    user: { displayName: 'Legacy Student' },
    subscription: {},
  });
  assert.match(historical.subject, /Early Access/);
  assert.match(historical.text, /₱149\.00/);
  assert.match(historical.text, /Legacy Early Access terms/);
  assert.match(historical.internalReference, /^DD-EA-/);
});
