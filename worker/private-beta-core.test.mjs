import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRIVATE_BETA_ACCESS_SECONDS,
  PRIVATE_BETA_PENDING_SECONDS,
  PrivateBetaError,
  constantTimeHexEqual,
  createPrivateBetaToken,
  hmacHex,
  sha256Hex,
  validatePrivateBetaAcknowledgements,
  verifyPrivateBetaAccessCode,
  verifyPrivateBetaToken,
} from './private-beta-core.mjs';

const signingKey = 'test-signing-key-that-is-at-least-thirty-two-bytes-long';
const pepper = 'test-code-pepper-that-is-at-least-thirty-two-bytes-long';
const disclosureVersion = 'beta-disclosure-v1-2026-07-31';
const fixedNow = Date.UTC(2026, 6, 31, 8, 0, 0);
const userId = '10000000-0000-4000-8000-000000000001';

test('access-code comparison is trimmed, case-sensitive, and verifier-only', async () => {
  const verifier = await hmacHex(pepper, 'CaseSensitive-Access');
  assert.equal(await verifyPrivateBetaAccessCode(
    '  CaseSensitive-Access  ',
    { verifier, pepper },
  ), true);
  assert.equal(await verifyPrivateBetaAccessCode(
    'casesensitive-access',
    { verifier, pepper },
  ), false);
  assert.equal(await verifyPrivateBetaAccessCode(
    'different',
    { verifier, pepper },
  ), false);
  assert.equal(constantTimeHexEqual(verifier, verifier), true);
  assert.equal(constantTimeHexEqual(verifier, `${verifier}0`), false);
});

test('missing private-beta verifier configuration fails closed', async () => {
  await assert.rejects(
    verifyPrivateBetaAccessCode('anything', { verifier: '', pepper }),
    (error) => (
      error instanceof PrivateBetaError
      && error.code === 'PRIVATE_BETA_NOT_CONFIGURED'
      && error.status === 503
    ),
  );
});

test('pending token is opaque, signed, disclosure-bound, and exactly 15 minutes', async () => {
  const created = await createPrivateBetaToken({
    type: 'pending',
    disclosureVersion,
    lifetimeSeconds: PRIVATE_BETA_PENDING_SECONDS,
  }, signingKey, { nowMs: fixedNow });
  assert.equal(created.token.includes('private-beta access code'), false);
  assert.equal(created.payload.exp - created.payload.iat, 15 * 60);
  const verified = await verifyPrivateBetaToken(created.token, signingKey, {
    expectedType: 'pending',
    disclosureVersion,
    nowMs: fixedNow + 14 * 60 * 1000,
  });
  assert.equal(verified.jti, created.payload.jti);
  await assert.rejects(
    verifyPrivateBetaToken(created.token, signingKey, {
      expectedType: 'pending',
      disclosureVersion,
      nowMs: fixedNow + 15 * 60 * 1000,
    }),
    /verified again/i,
  );
});

test('access token is user-bound and has a 12-hour absolute lifetime', async () => {
  const created = await createPrivateBetaToken({
    type: 'access',
    subject: userId,
    disclosureVersion,
    lifetimeSeconds: PRIVATE_BETA_ACCESS_SECONDS,
  }, signingKey, { nowMs: fixedNow });
  assert.equal(created.payload.exp - created.payload.iat, 12 * 60 * 60);
  const verified = await verifyPrivateBetaToken(created.token, signingKey, {
    expectedType: 'access',
    expectedSubject: userId,
    disclosureVersion,
    nowMs: fixedNow + 11 * 60 * 60 * 1000,
  });
  assert.equal(verified.sub, userId);
  await assert.rejects(
    verifyPrivateBetaToken(created.token, signingKey, {
      expectedType: 'access',
      expectedSubject: '20000000-0000-4000-8000-000000000002',
      disclosureVersion,
      nowMs: fixedNow,
    }),
    /verified again/i,
  );
});

test('tampering with an opaque token is rejected', async () => {
  const created = await createPrivateBetaToken({
    type: 'pending',
    disclosureVersion,
    lifetimeSeconds: PRIVATE_BETA_PENDING_SECONDS,
  }, signingKey, { nowMs: fixedNow });
  const tampered = `${created.token.slice(0, -1)}${created.token.endsWith('A') ? 'B' : 'A'}`;
  await assert.rejects(
    verifyPrivateBetaToken(tampered, signingKey, {
      expectedType: 'pending',
      disclosureVersion,
      nowMs: fixedNow,
    }),
    /verified again/i,
  );
});

test('all three affirmative acknowledgements are required', () => {
  assert.equal(validatePrivateBetaAcknowledgements({
    aiLimitations: true,
    educationalOnly: true,
    termsAndPrivacy: true,
  }), true);
  assert.equal(validatePrivateBetaAcknowledgements({
    aiLimitations: true,
    educationalOnly: true,
    termsAndPrivacy: false,
  }), false);
  assert.equal(validatePrivateBetaAcknowledgements({}), false);
});

test('hash helpers never return the unhashed input', async () => {
  const input = 'opaque-test-reference';
  const digest = await sha256Hex(input);
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.notEqual(digest, input);
});
