import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

const APPROVED_STAGING_SUPABASE = 'https://hlzqmreeoghbldnhlybr.supabase.co';
const APPROVED_STAGING_WORKER = 'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';

async function jsonResponse(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: options.signal || AbortSignal.timeout(60_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.error?.code || body?.error?.message || body?.message || 'invalid JSON'}`,
    );
  }
  return body;
}

export async function completeMandatoryCommercialProfile({
  supabaseUrl,
  publishableKey,
  workerUrl,
  token,
  displayName,
  termsVersion,
  privacyVersion,
}) {
  assert.equal(supabaseUrl, APPROVED_STAGING_SUPABASE);
  assert.equal(workerUrl, APPROVED_STAGING_WORKER);
  assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
  assert.ok(typeof token === 'string' && token.length > 40, 'A staging user session is required.');
  assert.ok(typeof termsVersion === 'string' && termsVersion.length > 5);
  assert.ok(typeof privacyVersion === 'string' && privacyVersion.length > 5);

  const authHeaders = {
    apikey: publishableKey,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  await jsonResponse(`${supabaseUrl}/rest/v1/rpc/complete_commercial_profile_onboarding`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify({
      p_display_name: String(displayName || 'Synthetic staging member').slice(0, 120),
      p_law_school_id: 'other',
      p_law_school_other: 'Synthetic Staging Law School',
      p_category: 'review',
      p_professor_license_number: null,
      p_terms_version: termsVersion,
      p_privacy_version: privacyVersion,
    }),
  });
}

export async function provisionMandatoryCommercialChoice(options) {
  await completeMandatoryCommercialProfile(options);

  const {
    workerUrl,
    token,
  } = options;

  const choice = await jsonResponse(`${workerUrl}/access/choose`, {
    method: 'POST',
    headers: {
      Origin: workerUrl,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Request-ID': `staging_access_${randomUUID().replaceAll('-', '')}`,
    },
    body: JSON.stringify({ choice: 'free' }),
  });
  assert.equal(choice.ok, true);
  assert.equal(choice.choice, 'free');
  assert.equal(choice.access?.allowed, true);
  assert.equal(choice.access?.accessMode, 'free');
  assert.equal(choice.access?.choiceRequired, false);
}
