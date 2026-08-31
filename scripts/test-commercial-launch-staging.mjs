import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  completeMandatoryCommercialProfile,
  provisionMandatoryCommercialChoice,
} from './staging-commercial-user.mjs';

const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
const PUBLISHABLE_KEY = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');

assert.equal(SUPABASE_URL, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.equal(
  WORKER_URL,
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
);
assert.match(SERVICE_ROLE_KEY, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
assert.match(PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);

const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
const createdUsers = [];
const createdInviteHashes = [];
const createdNotificationIds = [];
let currentLegalPolicy = null;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const serviceHeaders = {
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json',
};

function requestKey(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}

async function jsonRequest(url, options = {}, expected = [200]) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(120_000),
  });
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.code || body?.message || body?.error?.code || 'invalid JSON'}`,
    );
  }
  return { response, body };
}

async function serviceGet(resource) {
  return (await jsonRequest(`${SUPABASE_URL}/rest/v1/${resource}`, {
    headers: serviceHeaders,
  })).body;
}

async function serviceWrite(resource, method, payload, expected = [200, 201, 204]) {
  return (await jsonRequest(`${SUPABASE_URL}/rest/v1/${resource}`, {
    method,
    headers: {
      ...serviceHeaders,
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }, expected)).body;
}

async function serviceRpc(name, payload, expected = [200, 204]) {
  return (await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(payload),
  }, expected)).body;
}

async function serviceRpcFailure(name, payload) {
  return (await jsonRequest(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify(payload),
  }, [400])).body;
}

function philippineDate(instant = new Date()) {
  const values = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function compatiblePaymentMethods(pricing, plan) {
  return pricing.paymentMethods.filter((method) => (
    method.enabled === true
      && method.visible === true
      && typeof method.qrUrl === 'string'
      && method.qrUrl.trim().length > 0
      && (!method.planCode || method.planCode === plan.planCode)
      && (
        method.qrAmountMode === 'generic'
        || method.qrAmountCentavos === plan.priceCentavos
      )
  ));
}

function validatePublicPricingResponse(payload) {
  assert.equal(payload.ok, true);
  assert.ok(payload.pricing && typeof payload.pricing === 'object');
  const pricing = payload.pricing;
  assert.match(pricing.revisionId, UUID_PATTERN);
  assert.equal(payload.revisionId, pricing.revisionId);
  assert.ok(Number.isFinite(Date.parse(pricing.serverNow)));
  assert.equal(payload.serverNow, pricing.serverNow);
  assert.ok(Array.isArray(pricing.plans));
  assert.ok(Array.isArray(pricing.paymentMethods));
  assert.deepEqual(payload.plans, pricing.plans);
  for (const plan of pricing.plans) {
    assert.match(plan.versionId, UUID_PATTERN);
    assert.ok(typeof plan.planCode === 'string' && plan.planCode.length > 0);
    assert.ok(typeof plan.name === 'string' && plan.name.length > 0);
    assert.ok(Number.isInteger(plan.priceCentavos) && plan.priceCentavos >= 0);
    if (plan.checkoutEnabled === true) assert.ok(plan.priceCentavos > 0);
    assert.equal(plan.currency, 'PHP');
    assert.ok(['fixed_end', 'rolling_days'].includes(plan.entitlementMode));
    const compatibleMethods = compatiblePaymentMethods(pricing, plan);
    if (plan.checkoutOpen === true) {
      assert.ok(
        compatibleMethods.length > 0,
        `Checkout-open plan ${plan.planCode} must expose a compatible QR-backed payment method.`,
      );
    }
    if (plan.status === 'payment_channel_required') {
      assert.equal(plan.checkoutOpen, false);
      assert.equal(compatibleMethods.length, 0);
    }
  }
  if (pricing.plans.length === 0) {
    assert.equal(
      pricing.paymentMethods.length,
      0,
      'An intentionally empty public catalog must not expose an orphan payment QR.',
    );
  }
  return pricing;
}

function accessEvidence(access) {
  return {
    accessMode: access.accessMode,
    accountLabel: access.accountLabel,
    unlimited: access.unlimited,
    tokenLimit: access.tokenLimit,
    tokensUsed: access.tokensUsed,
    tokensReserved: access.tokensReserved,
    tokensRemaining: access.tokensRemaining,
    entitlementEndsAt: access.entitlementEndsAt,
  };
}

async function createUser(label) {
  const email = `dd-commercial-${label}-${runId}@duediligence.ph`;
  const password = `Dd!${randomBytes(24).toString('base64url')}9z`;
  const user = (await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: serviceHeaders,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { display_name: `Commercial ${label}` },
    }),
  }, [200, 201])).body;
  createdUsers.push(user.id);

  const session = (await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  })).body;
  assert.ok(session.access_token);

  assert.ok(currentLegalPolicy?.termsVersion);
  assert.ok(currentLegalPolicy?.privacyVersion);
  const acceptance = await workerPost('/beta/access/accept-terms', {}, session.access_token);
  assert.deepEqual(acceptance.acceptance, {
    recorded: true,
    termsVersion: currentLegalPolicy.termsVersion,
    privacyVersion: currentLegalPolicy.privacyVersion,
    acceptedAt: acceptance.acceptance.acceptedAt,
  });
  assert.ok(Number.isFinite(Date.parse(acceptance.acceptance.acceptedAt)));
  const persisted = await serviceGet(
    `terms_acceptances?user_id=eq.${encodeURIComponent(user.id)}`
      + `&terms_version=eq.${encodeURIComponent(currentLegalPolicy.termsVersion)}`
      + `&privacy_version=eq.${encodeURIComponent(currentLegalPolicy.privacyVersion)}`
      + '&select=id,accepted_at',
  );
  assert.equal(persisted.length, 1);
  return { id: user.id, email, token: session.access_token };
}

async function deleteUser(userId) {
  await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders,
  }, [200, 204]);
}

async function workerPost(path, payload, token = null) {
  return (await jsonRequest(`${WORKER_URL}${path}`, {
    method: 'POST',
    headers: {
      Origin: WORKER_URL,
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  })).body;
}

async function accessSnapshot(userId) {
  return serviceRpc('phase4_access_snapshot', {
    p_user_id: userId,
    p_activate_trial: false,
    p_request_key: null,
  });
}

async function reserve(userId, key, question, track = 'bar_practice') {
  return serviceRpc('phase4_reserve_grade_v2', {
    p_user_id: userId,
    p_request_key: key,
    p_question_bank_id: question,
    p_examination_track: track,
  });
}

async function verifySoftLaunchStaging() {
  const rows = await serviceGet(
    'platform_access_settings?singleton=eq.true&select=soft_launch_enabled,commercial_launch_enabled,public_pricing_enabled,global_beta_all_access_enabled,current_terms_version,current_privacy_version,introductory_token_limit,introductory_token_disclosure_version,early_access_manual_renewal_at',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].soft_launch_enabled, true);
  assert.equal(rows[0].commercial_launch_enabled, true);
  assert.equal(rows[0].public_pricing_enabled, true);
  assert.equal(rows[0].global_beta_all_access_enabled, false);
  assert.equal(rows[0].current_terms_version, 'terms-soft-launch-v1-2026-08-21');
  assert.equal(rows[0].current_privacy_version, 'privacy-soft-launch-v1-2026-08-21');
  assert.equal(rows[0].introductory_token_limit, 5);
  assert.ok(rows[0].introductory_token_disclosure_version);
  assert.ok(rows[0].early_access_manual_renewal_at);
}

let outcome;
try {
  console.log('STAGING_GATE: verifying isolated soft-launch policy');
  await verifySoftLaunchStaging();

  const legalPolicyResponse = await workerPost('/beta/access/policy', {});
  assert.equal(legalPolicyResponse.ok, true);
  assert.equal(legalPolicyResponse.policy.commercialLaunchEnabled, true);
  currentLegalPolicy = legalPolicyResponse.policy.legal;
  assert.deepEqual(currentLegalPolicy, {
    termsVersion: 'terms-soft-launch-v1-2026-08-21',
    privacyVersion: 'privacy-soft-launch-v1-2026-08-21',
  });

  const freeUser = await createUser('free');
  const retryUser = await createUser('retry');
  const foundingUser = await createUser('founding');
  const provisionalUser = await createUser('provisional');

  const commercialProfile = (user, label) => ({
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    workerUrl: WORKER_URL,
    token: user.token,
    displayName: `Commercial ${label}`,
    termsVersion: currentLegalPolicy.termsVersion,
    privacyVersion: currentLegalPolicy.privacyVersion,
  });
  await Promise.all([
    provisionMandatoryCommercialChoice(commercialProfile(freeUser, 'Free')),
    provisionMandatoryCommercialChoice(commercialProfile(retryUser, 'Retry')),
    completeMandatoryCommercialProfile(commercialProfile(foundingUser, 'Founding')),
    completeMandatoryCommercialProfile(commercialProfile(provisionalUser, 'Provisional')),
  ]);

  console.log('STAGING_GATE: validating the Founder-published pricing catalog');
  const plans = await workerPost('/plans', {});
  const publicPricing = validatePublicPricingResponse(plans);

  const freeInitial = await accessSnapshot(freeUser.id);
  assert.equal(freeInitial.accessMode, 'introductory');
  assert.equal(freeInitial.accountLabel, 'Introductory access');
  assert.equal(freeInitial.unlimited, false);
  assert.equal(freeInitial.tokenLimit, 5);
  assert.equal(freeInitial.tokensRemaining, 5);
  assert.equal(freeInitial.resetAt, null);

  console.log('STAGING_GATE: proving idempotent retry and failed-grade release');
  const retryKey = requestKey('commercial_retry');
  const firstRetry = await reserve(retryUser.id, retryKey, `SYNTH-RETRY-${runId}`);
  const replayRetry = await reserve(retryUser.id, retryKey, `SYNTH-RETRY-${runId}`);
  assert.equal(firstRetry.allowed, true);
  assert.equal(replayRetry.allowed, true);
  assert.equal(replayRetry.replayed, true);
  assert.equal(replayRetry.reservationId, firstRetry.reservationId);
  await serviceRpc('phase4_release_grade', {
    p_user_id: retryUser.id,
    p_reservation_id: firstRetry.reservationId,
    p_reason: 'grading_failed',
  });
  const retryReleased = await accessSnapshot(retryUser.id);
  assert.equal(retryReleased.tokensUsed, 0);
  assert.equal(retryReleased.tokensReserved, 0);
  assert.equal(retryReleased.tokensRemaining, 5);

  console.log('STAGING_GATE: proving six concurrent requests cannot exceed five');
  const concurrent = await Promise.all(Array.from({ length: 6 }, (_, index) => reserve(
    freeUser.id,
    requestKey(`commercial_concurrent_${index}`),
    `SYNTH-COMMERCIAL-${index}-${runId}`,
    ['bar_practice', 'subject_matter', 'mock_bar', 'bar_feels', 'quiz', 'doctrine_review'][index],
  )));
  const accepted = concurrent.filter((item) => item.allowed === true && item.reservationId);
  const denied = concurrent.filter((item) => item.allowed !== true);
  assert.equal(accepted.length, 5);
  assert.equal(denied.length, 1);
  assert.equal(denied[0].basis, 'trial_tokens_exhausted');
  assert.equal(denied[0].reason, 'trial_tokens_exhausted');
  await Promise.all(accepted.map((item) => serviceRpc('phase4_finalize_grade', {
    p_user_id: freeUser.id,
    p_reservation_id: item.reservationId,
  })));
  const freeExhausted = await accessSnapshot(freeUser.id);
  assert.equal(freeExhausted.tokensUsed, 5);
  assert.equal(freeExhausted.tokensReserved, 0);
  assert.equal(freeExhausted.tokensRemaining, 0);
  assert.equal(freeExhausted.allowed, false);
  assert.equal(freeExhausted.basis, 'trial_tokens_exhausted');

  console.log('STAGING_GATE: proving Founding Beta hash claim and fixed expiry');
  const foundingHash = createHash('sha256')
    .update(foundingUser.email.trim().toLowerCase())
    .digest('hex');
  createdInviteHashes.push(foundingHash);
  const foundingExpiresAt = new Date(
    Date.parse(publicPricing.serverNow) + (24 * 60 * 60 * 1000),
  ).toISOString();
  await serviceWrite('founding_beta_invites', 'POST', {
    email_hash: foundingHash,
    access_ends_at: foundingExpiresAt,
  });
  const founding = await accessSnapshot(foundingUser.id);
  assert.equal(founding.accessMode, 'founding_beta');
  assert.equal(founding.basis, 'founding_beta');
  assert.equal(founding.accountLabel, 'Complimentary Access');
  assert.equal(founding.unlimited, true);
  assert.equal(Date.parse(founding.entitlementEndsAt), Date.parse(foundingExpiresAt));

  // Refresh immediately before exercising checkout so an Admin publication
  // during the longer quota/founding checks cannot leave us using stale IDs.
  const paymentPricing = validatePublicPricingResponse(await workerPost('/plans', {}));
  const checkoutPlan = paymentPricing.plans.find((plan) => (
    plan.checkoutOpen === true && compatiblePaymentMethods(paymentPricing, plan).length > 0
  ));
  let paymentOutcome;
  if (checkoutPlan) {
    console.log('STAGING_GATE: proving versioned payment capture and exact retry');
    const paymentMethod = compatiblePaymentMethods(paymentPricing, checkoutPlan)[0];
    assert.match(paymentMethod.versionId, UUID_PATTERN);
    const paymentPayload = {
      p_user_id: provisionalUser.id,
      p_plan_version_id: checkoutPlan.versionId,
      p_payment_channel_version_id: paymentMethod.versionId,
      p_payment_date: philippineDate(new Date(Date.parse(paymentPricing.serverNow))),
      p_payment_reference: `SYNTH-${runId}`,
      p_proof_bucket: 'payment-proofs',
      p_proof_path: `${provisionalUser.id}/${randomUUID()}.png`,
      p_proof_mime_type: 'image/png',
      p_proof_size_bytes: 1024,
      p_proof_sha256: createHash('sha256').update(`payment-${runId}`).digest('hex'),
    };
    const payment = await serviceRpc('phase4_create_payment_request_v2', paymentPayload);
    const paymentId = payment.id;
    assert.equal(payment.status, 'pending');
    assert.equal(payment.pricingRevisionId, paymentPricing.revisionId);
    assert.equal(payment.planVersionId, checkoutPlan.versionId);
    assert.equal(payment.paymentChannelVersionId, paymentMethod.versionId);
    assert.equal(payment.planCode, checkoutPlan.planCode);
    assert.equal(payment.planName, checkoutPlan.name);
    assert.equal(payment.amountCentavos, checkoutPlan.priceCentavos);
    assert.equal(payment.currency, checkoutPlan.currency);
    assert.equal(payment.durationDays, checkoutPlan.durationDays ?? null);
    assert.equal(payment.entitlementMode, checkoutPlan.entitlementMode);
    if (checkoutPlan.fixedEntitlementEndsAt) {
      assert.equal(
        Date.parse(payment.fixedEndsAt),
        Date.parse(checkoutPlan.fixedEntitlementEndsAt),
      );
    } else {
      assert.equal(payment.fixedEndsAt, null);
    }
    assert.equal(payment.provisionalGrantReused, false);
    assert.equal(payment.replayed, false);
    assert.ok(Number.isFinite(Date.parse(payment.provisionalAccessExpiresAt)));
    const notifications = await serviceGet(
      `outbound_notifications?related_resource_id=eq.${payment.id}&select=id`,
    );
    assert.equal(notifications.length, 1);
    createdNotificationIds.push(...notifications.map((item) => item.id));
    const provisional = await accessSnapshot(provisionalUser.id);
    assert.equal(provisional.accessMode, 'provisional');
    assert.equal(provisional.accountLabel, `${checkoutPlan.name} — pending`);
    assert.equal(provisional.unlimited, true);
    const repeatedPayment = await serviceRpc('phase4_create_payment_request_v2', paymentPayload);
    assert.equal(repeatedPayment.id, payment.id);
    assert.equal(repeatedPayment.replayed, true);
    assert.equal(repeatedPayment.provisionalGrantReused, false);
    assert.equal(repeatedPayment.provisionalAccessExpiresAt, payment.provisionalAccessExpiresAt);
    const distinctPaymentFailure = await serviceRpcFailure('phase4_create_payment_request_v2', {
      ...paymentPayload,
      p_payment_reference: `SYNTH-DISTINCT-${runId}`,
      p_proof_path: `${provisionalUser.id}/${randomUUID()}.png`,
      p_proof_sha256: createHash('sha256').update(`distinct-${runId}`).digest('hex'),
    });
    assert.match(
      String(distinctPaymentFailure?.message || ''),
      /payment request is already awaiting review/i,
    );
    const [paymentRows, historyRows, notificationRows] = await Promise.all([
      serviceGet(`payment_requests?user_id=eq.${provisionalUser.id}&select=id,provisional_access_expires_at`),
      serviceGet(`payment_request_history?payment_request_id=eq.${paymentId}&action=eq.submitted&select=id`),
      serviceGet(`outbound_notifications?related_resource_id=eq.${paymentId}&select=id`),
    ]);
    assert.equal(paymentRows.length, 1);
    assert.equal(paymentRows[0].id, paymentId);
    assert.equal(
      Date.parse(paymentRows[0].provisional_access_expires_at),
      Date.parse(payment.provisionalAccessExpiresAt),
    );
    assert.equal(historyRows.length, 1);
    assert.equal(notificationRows.length, 1);
    const provisionalAfterRetries = await accessSnapshot(provisionalUser.id);
    assert.equal(
      Date.parse(provisionalAfterRetries.entitlementEndsAt),
      Date.parse(payment.provisionalAccessExpiresAt),
    );
    paymentOutcome = {
      checkoutState: 'verified',
      planCode: checkoutPlan.planCode,
      amountCentavos: checkoutPlan.priceCentavos,
      durationDays: checkoutPlan.durationDays ?? null,
      exactRetry: true,
    };
  } else {
    console.log('STAGING_GATE: proving unpublished or incompatible checkout fails closed');
    assert.ok(paymentPricing.plans.every((plan) => plan.checkoutOpen !== true));
    const failClosedPlan = paymentPricing.plans.find(
      (plan) => plan.status === 'payment_channel_required',
    ) || paymentPricing.plans.find(
      (plan) => ['upcoming', 'unavailable', 'closed', 'legacy'].includes(plan.status),
    ) || paymentPricing.plans[0] || null;
    if (failClosedPlan) {
      const before = accessEvidence(await accessSnapshot(provisionalUser.id));
      const paymentFailure = await serviceRpcFailure('phase4_create_payment_request_v2', {
        p_user_id: provisionalUser.id,
        p_plan_version_id: failClosedPlan.versionId,
        p_payment_channel_version_id: randomUUID(),
        p_payment_date: philippineDate(new Date(Date.parse(paymentPricing.serverNow))),
        p_payment_reference: `SYNTH-CLOSED-${runId}`,
        p_proof_bucket: 'payment-proofs',
        p_proof_path: `${provisionalUser.id}/${randomUUID()}.png`,
        p_proof_mime_type: 'image/png',
        p_proof_size_bytes: 1024,
        p_proof_sha256: createHash('sha256').update(`closed-${runId}`).digest('hex'),
      });
      assert.match(
        String(paymentFailure?.message || ''),
        failClosedPlan.status === 'payment_channel_required'
          ? /Payment method is not compatible/
          : /Selected pricing plan is not open/,
      );
      const paymentRows = await serviceGet(
        `payment_requests?user_id=eq.${provisionalUser.id}&select=id`,
      );
      assert.equal(paymentRows.length, 0);
      const after = accessEvidence(await accessSnapshot(provisionalUser.id));
      assert.deepEqual(after, before);
    }
    paymentOutcome = {
      checkoutState: 'fail_closed',
      displayedPlans: paymentPricing.plans.length,
      paymentCreated: false,
    };
  }

  outcome = {
    ok: true,
    runId,
    pricingRevisionId: paymentPricing.revisionId,
    publicCatalog: paymentPricing.plans.map((plan) => plan.planCode),
    introductoryTokens: { limit: 5, concurrentAccepted: 5, concurrentDenied: 1 },
    failedGradeReleased: true,
    foundingBeta: { claimedByHash: true, unlimited: true },
    provisionalPayment: paymentOutcome,
  };
} finally {
  console.log('STAGING_GATE: cleaning exact synthetic commercial records');
  const cleanupErrors = [];
  // Notifications intentionally do not cascade from payment requests. Discover
  // them again before user deletion so even an assertion immediately after a
  // successful payment cannot leave synthetic Admin inbox residue.
  for (const userId of createdUsers) {
    const paymentRows = await serviceGet(
      `payment_requests?user_id=eq.${encodeURIComponent(userId)}&select=id`,
    ).catch((error) => {
      cleanupErrors.push(error);
      return [];
    });
    for (const paymentRow of paymentRows) {
      const notificationRows = await serviceGet(
        `outbound_notifications?related_resource_id=eq.${encodeURIComponent(paymentRow.id)}&select=id`,
      ).catch((error) => {
        cleanupErrors.push(error);
        return [];
      });
      createdNotificationIds.push(...notificationRows.map((item) => item.id));
    }
  }
  for (const notificationId of [...new Set(createdNotificationIds)].reverse()) {
    await serviceWrite(
      `outbound_notifications?id=eq.${encodeURIComponent(notificationId)}`,
      'DELETE',
      undefined,
    ).catch((error) => cleanupErrors.push(error));
  }
  for (const inviteHash of createdInviteHashes.reverse()) {
    await serviceWrite(
      `founding_beta_invites?email_hash=eq.${encodeURIComponent(inviteHash)}`,
      'DELETE',
      undefined,
    ).catch((error) => cleanupErrors.push(error));
  }
  for (const userId of createdUsers.reverse()) {
    await deleteUser(userId).catch((error) => cleanupErrors.push(error));
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Commercial staging cleanup failed.');
  }
  console.log(`STAGING_GATE: synthetic_cleanup=true run_id=${runId}`);
}

for (const userId of createdUsers) {
  const residue = await serviceGet(`grade_reservations?user_id=eq.${userId}&select=id`);
  assert.equal(residue.length, 0, 'Synthetic quota reservations must be removed.');
  const paymentResidue = await serviceGet(`payment_requests?user_id=eq.${userId}&select=id`);
  assert.equal(paymentResidue.length, 0, 'Synthetic payment records must be removed.');
}
for (const inviteHash of createdInviteHashes) {
  const residue = await serviceGet(
    `founding_beta_invites?email_hash=eq.${encodeURIComponent(inviteHash)}&select=email_hash`,
  );
  assert.equal(residue.length, 0, 'Synthetic Founding Beta invite must be removed.');
}

console.log(JSON.stringify(outcome, null, 2));
