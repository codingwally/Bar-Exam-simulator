import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

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
let originalSettings = null;
let currentLegalPolicy = null;

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

async function activateCommercialStaging() {
  const rows = await serviceGet(
    'platform_access_settings?singleton=eq.true&select=commercial_launch_enabled,public_pricing_enabled,global_beta_all_access_enabled,current_terms_version,current_privacy_version',
  );
  assert.equal(rows.length, 1);
  originalSettings = rows[0];
  await serviceWrite('platform_access_settings?singleton=eq.true', 'PATCH', {
    commercial_launch_enabled: true,
    public_pricing_enabled: true,
    global_beta_all_access_enabled: false,
    current_terms_version: 'terms-commercial-v1-2026-08-18',
    current_privacy_version: 'privacy-commercial-v1-2026-08-18',
  });
}

async function restoreStagingSettings() {
  if (!originalSettings) return;
  await serviceWrite('platform_access_settings?singleton=eq.true', 'PATCH', originalSettings);
}

let outcome;
try {
  console.log('STAGING_GATE: enabling isolated commercial policy verification');
  await activateCommercialStaging();

  const legalPolicyResponse = await workerPost('/beta/access/policy', {});
  assert.equal(legalPolicyResponse.ok, true);
  assert.equal(legalPolicyResponse.policy.commercialLaunchEnabled, true);
  currentLegalPolicy = legalPolicyResponse.policy.legal;
  assert.deepEqual(currentLegalPolicy, {
    termsVersion: 'terms-commercial-v1-2026-08-18',
    privacyVersion: 'privacy-commercial-v1-2026-08-18',
  });

  const freeUser = await createUser('free');
  const retryUser = await createUser('retry');
  const foundingUser = await createUser('founding');
  const provisionalUser = await createUser('provisional');

  console.log('STAGING_GATE: validating Free and Early Access public catalog');
  const plans = await workerPost('/plans', {});
  assert.equal(plans.ok, true);
  assert.deepEqual(plans.plans.map((plan) => plan.planCode), ['free', 'early_access_beta']);
  assert.equal(plans.plans[0].priceCentavos, 0);
  assert.equal(plans.plans[1].priceCentavos, 14900);
  assert.equal(plans.plans[1].billing, 'one_time');
  assert.equal(plans.plans[1].checkoutEnabled, true);

  const freeInitial = await accessSnapshot(freeUser.id);
  assert.equal(freeInitial.accessMode, 'free');
  assert.equal(freeInitial.accountLabel, 'Free');
  assert.equal(freeInitial.unlimited, false);
  assert.equal(freeInitial.dailyLimit, 5);
  assert.equal(freeInitial.remainingToday, 5);
  assert.match(freeInitial.resetAt, /T00:00:00\+08:00$/);

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
  assert.equal(retryReleased.completedToday, 0);
  assert.equal(retryReleased.reservedToday, 0);
  assert.equal(retryReleased.remainingToday, 5);

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
  assert.equal(denied[0].basis, 'daily_limit_reached');
  await Promise.all(accepted.map((item) => serviceRpc('phase4_finalize_grade', {
    p_user_id: freeUser.id,
    p_reservation_id: item.reservationId,
  })));
  const freeExhausted = await accessSnapshot(freeUser.id);
  assert.equal(freeExhausted.completedToday, 5);
  assert.equal(freeExhausted.reservedToday, 0);
  assert.equal(freeExhausted.remainingToday, 0);
  assert.equal(freeExhausted.allowed, false);
  assert.equal(freeExhausted.basis, 'daily_limit_reached');

  console.log('STAGING_GATE: proving Founding Beta hash claim and fixed expiry');
  const foundingHash = createHash('sha256')
    .update(foundingUser.email.trim().toLowerCase())
    .digest('hex');
  createdInviteHashes.push(foundingHash);
  await serviceWrite('founding_beta_invites', 'POST', {
    email_hash: foundingHash,
    access_ends_at: '2026-09-01T23:59:59+08:00',
  });
  const founding = await accessSnapshot(foundingUser.id);
  assert.equal(founding.accessMode, 'founding_beta');
  assert.equal(founding.accountLabel, 'Founding Beta');
  assert.equal(founding.unlimited, true);
  assert.equal(founding.entitlementEndsAt, '2026-09-01T15:59:59+00:00');

  console.log('STAGING_GATE: proving one nonrenewable provisional payment window');
  const paymentKey = requestKey('commercial_payment');
  const payment = await serviceRpc('phase4_create_payment_request', {
    p_user_id: provisionalUser.id,
    p_plan_code: 'early_access_beta',
    p_amount_php: 149,
    p_payment_method: 'bpi_instapay',
    p_payment_date: new Date().toISOString().slice(0, 10),
    p_transaction_reference: `SYNTH-${runId}`,
    p_student_note: `Synthetic staging payment verification ${runId}`,
    p_proof_object_path: `${provisionalUser.id}/${randomUUID()}.png`,
    p_proof_original_name: 'synthetic-proof.png',
    p_proof_mime_type: 'image/png',
    p_proof_size_bytes: 1024,
    p_proof_sha256: 'a'.repeat(64),
    p_request_key: paymentKey,
  });
  assert.equal(payment.status, 'pending');
  assert.equal(payment.amountCentavos, 14900);
  assert.ok(Number.isFinite(Date.parse(payment.provisionalAccessExpiresAt)));
  const notifications = await serviceGet(
    `outbound_notifications?related_resource_id=eq.${payment.id}&select=id`,
  );
  createdNotificationIds.push(...notifications.map((item) => item.id));
  const provisional = await accessSnapshot(provisionalUser.id);
  assert.equal(provisional.accessMode, 'provisional');
  assert.equal(provisional.accountLabel, 'Early Access — pending');
  assert.equal(provisional.unlimited, true);
  const repeatedPayment = await serviceRpc('phase4_create_payment_request', {
    p_user_id: provisionalUser.id,
    p_plan_code: 'early_access_beta',
    p_amount_php: 149,
    p_payment_method: 'bpi_instapay',
    p_payment_date: new Date().toISOString().slice(0, 10),
    p_transaction_reference: `SYNTH-REPEAT-${runId}`,
    p_student_note: `Synthetic replay verification ${runId}`,
    p_proof_object_path: `${provisionalUser.id}/${randomUUID()}.png`,
    p_proof_original_name: 'synthetic-repeat.png',
    p_proof_mime_type: 'image/png',
    p_proof_size_bytes: 1024,
    p_proof_sha256: 'b'.repeat(64),
    p_request_key: requestKey('commercial_payment_replay'),
  });
  assert.equal(repeatedPayment.id, payment.id);
  assert.equal(repeatedPayment.provisionalGrantReused, true);
  assert.equal(repeatedPayment.provisionalAccessExpiresAt, payment.provisionalAccessExpiresAt);

  outcome = {
    ok: true,
    runId,
    publicCatalog: ['free', 'early_access_beta'],
    freeQuota: { limit: 5, concurrentAccepted: 5, concurrentDenied: 1 },
    failedGradeReleased: true,
    foundingBeta: { claimedByHash: true, unlimited: true },
    provisionalPayment: { oneTimeWindow: true, amountCentavos: 14900 },
  };
} finally {
  console.log('STAGING_GATE: restoring policy and cleaning commercial records');
  const cleanupErrors = [];
  await restoreStagingSettings().catch((error) => cleanupErrors.push(error));
  for (const notificationId of createdNotificationIds.reverse()) {
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
