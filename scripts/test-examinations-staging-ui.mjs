import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sanitizeStagingDiagnostic } from './staging-e2e-diagnostics.mjs';
import { completeMandatoryCommercialProfile } from './staging-commercial-user.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_URL = String(process.env.STAGING_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_ROLE_KEY = String(process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '');
const PUBLISHABLE_KEY = String(process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '');
const WORKER_URL = String(process.env.STAGING_EXAMINATION_WORKER_URL || '').replace(/\/+$/, '');

assert.equal(SUPABASE_URL, 'https://hlzqmreeoghbldnhlybr.supabase.co');
assert.match(SERVICE_ROLE_KEY, /^sb_secret_[A-Za-z0-9_-]{20,}$/);
assert.match(PUBLISHABLE_KEY, /^sb_publishable_[A-Za-z0-9_-]{20,}$/);
assert.equal(
  WORKER_URL,
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev',
);
assert.equal(`${SUPABASE_URL}\n${WORKER_URL}`.includes('hbllomlijfznnuudpdvr'), false);
assert.equal(
  `${SUPABASE_URL}\n${WORKER_URL}`.includes('duediligence-gemini-examiner'),
  false,
);

const runId = `ui-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
const email = `dd-ui-${runId.slice(3)}@example.com`;
const password = `Dd!${randomBytes(30).toString('base64url')}`;
const serviceHeaders = Object.freeze({ apikey: SERVICE_ROLE_KEY });
let userId = null;
let originalLegalVersions = null;

async function jsonRequest(url, options = {}, expected = [200]) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!expected.includes(response.status)) {
    throw new Error(
      `${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status}: `
      + `${body?.message || body?.error?.message || body?.error?.code || body?.code || 'invalid JSON'}`,
    );
  }
  return body;
}

async function createDisposableUser() {
  const user = await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: {
      ...serviceHeaders,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: 'Synthetic Staging UI Examinee' },
    }),
  }, [200, 201]);
  assert.match(user.id, /^[0-9a-f-]{36}$/i);
  userId = user.id;

  await jsonRequest(`${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      role: 'super_admin',
      assigned_by: userId,
      updated_at: new Date().toISOString(),
    }),
  }, [200, 204]);
  const assignedRoles = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/user_roles?user_id=eq.${userId}&select=role`,
    { headers: serviceHeaders },
  );
  assert.deepEqual(assignedRoles, [{ role: 'super_admin' }]);
}

async function prepareDisposableCommercialProfile() {
  const session = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: {
      apikey: PUBLISHABLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  assert.ok(session.access_token, 'The disposable staging session was not created.');
  const acceptance = await jsonRequest(`${WORKER_URL}/beta/access/accept-terms`, {
    method: 'POST',
    headers: {
      Origin: WORKER_URL,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(acceptance?.acceptance?.termsVersion, 'terms-commercial-v1-2026-08-18');
  assert.equal(acceptance?.acceptance?.privacyVersion, 'privacy-commercial-v1-2026-08-18');
  await completeMandatoryCommercialProfile({
    supabaseUrl: SUPABASE_URL,
    publishableKey: PUBLISHABLE_KEY,
    workerUrl: WORKER_URL,
    token: session.access_token,
    displayName: 'Synthetic Staging UI Examinee',
    termsVersion: 'terms-commercial-v1-2026-08-18',
    privacyVersion: 'privacy-commercial-v1-2026-08-18',
  });
}

async function enableCommercialLegalVersions() {
  const settings = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/platform_access_settings`
      + '?singleton=eq.true&select=current_terms_version,current_privacy_version',
    { headers: serviceHeaders },
  );
  assert.equal(settings.length, 1);
  originalLegalVersions = settings[0];
  await jsonRequest(`${SUPABASE_URL}/rest/v1/platform_access_settings?singleton=eq.true`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      current_terms_version: 'terms-commercial-v1-2026-08-18',
      current_privacy_version: 'privacy-commercial-v1-2026-08-18',
    }),
  }, [200, 204]);
}

async function restoreLegalVersions() {
  if (!originalLegalVersions) return;
  await jsonRequest(`${SUPABASE_URL}/rest/v1/platform_access_settings?singleton=eq.true`, {
    method: 'PATCH',
    headers: {
      ...serviceHeaders,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(originalLegalVersions),
  }, [200, 204]);
}

function runVerifier() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(root, 'scripts', 'verify-examinations-staging-ui.mjs')], {
      cwd: root,
      windowsHide: true,
      env: {
        ...process.env,
        STAGING_SITE_URL: WORKER_URL,
        STAGING_UI_EMAIL: email,
        STAGING_UI_PASSWORD: password,
        STAGING_UI_RUN_ID: runId,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = [];
    child.stdout.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    child.on('error', (error) => resolve({ code: 1, output: String(error?.name || 'spawn_error') }));
    child.on('close', (code) => resolve({
      code: Number.isInteger(code) ? code : 1,
      output: Buffer.concat(chunks).toString('utf8'),
    }));
  });
}

async function listSyntheticExamIds() {
  if (!userId) return [];
  const rows = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/examination_definitions`
      + `?select=id&created_by=eq.${userId}&test_only=eq.true`,
    { headers: serviceHeaders },
  );
  return rows.map((row) => row.id).filter((id) => /^[0-9a-f-]{36}$/i.test(id));
}

async function deleteSyntheticExam(examId) {
  const versions = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/examination_versions?select=id&exam_id=eq.${examId}`,
    { headers: serviceHeaders },
  );
  const versionIds = versions.map((item) => item.id);
  if (versionIds.length) {
    await jsonRequest(
      `${SUPABASE_URL}/rest/v1/examination_attempts_multi`
        + `?version_id=in.(${versionIds.join(',')})`,
      {
        method: 'DELETE',
        headers: { ...serviceHeaders, Prefer: 'return=minimal' },
      },
      [200, 204],
    );
    await jsonRequest(
      `${SUPABASE_URL}/rest/v1/examination_versions?id=in.(${versionIds.join(',')})`,
      {
        method: 'PATCH',
        headers: {
          ...serviceHeaders,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify({
          status: 'retired',
          retired_at: new Date().toISOString(),
        }),
      },
      [200, 204],
    );
  }
  await jsonRequest(`${SUPABASE_URL}/rest/v1/examination_definitions?id=eq.${examId}`, {
    method: 'DELETE',
    headers: { ...serviceHeaders, Prefer: 'return=minimal' },
  }, [200, 204]);
  const remaining = await jsonRequest(
    `${SUPABASE_URL}/rest/v1/examination_definitions?select=id&id=eq.${examId}`,
    { headers: serviceHeaders },
  );
  assert.equal(remaining.length, 0, 'A disposable staging examination was not removed.');
}

async function deleteSyntheticUserRecords() {
  if (!userId) return;
  const targets = [
    ['examination_beta_access', `user_id=eq.${userId}`],
    ['examination_participants', `user_id=eq.${userId}`],
    ['examination_audit_log', `actor_user_id=eq.${userId}`],
    ['usage_events', `user_id=eq.${userId}`],
    ['usage_sessions', `user_id=eq.${userId}`],
  ];
  for (const [table, query] of targets) {
    await jsonRequest(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      method: 'DELETE',
      headers: { ...serviceHeaders, Prefer: 'return=minimal' },
    }, [200, 204]);
  }
}

async function deleteDisposableUser() {
  if (!userId) return;
  await jsonRequest(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: serviceHeaders,
  }, [200, 204]);
}

let verifier = null;
let verifierFailure = null;
try {
  await enableCommercialLegalVersions();
  await createDisposableUser();
  await prepareDisposableCommercialProfile();
  verifier = await runVerifier();
  if (verifier.code !== 0) {
    verifierFailure = sanitizeStagingDiagnostic(verifier.output, SERVICE_ROLE_KEY)
      .replaceAll(password, '[credential]')
      .replaceAll(email, '[email]');
  }
} finally {
  const cleanupErrors = [];
  const examIds = await listSyntheticExamIds().catch((error) => {
    cleanupErrors.push(error);
    return [];
  });
  for (const examId of examIds.reverse()) {
    await deleteSyntheticExam(examId).catch((error) => cleanupErrors.push(error));
  }
  await deleteSyntheticUserRecords().catch((error) => cleanupErrors.push(error));
  await deleteDisposableUser().catch((error) => cleanupErrors.push(error));
  await restoreLegalVersions().catch((error) => cleanupErrors.push(error));
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Disposable staging UI cleanup failed.');
  }
  console.log(`EXAMINATIONS_UI_STAGING: synthetic_cleanup=true run_id=${runId}`);
}

assert.equal(verifier?.code, 0, verifierFailure || 'The staging UI verifier did not complete.');
const parsed = JSON.parse(verifier.output);
assert.equal(parsed.ok, true);
assert.deepEqual(parsed.consoleErrors, []);
assert.deepEqual(parsed.networkErrors, []);
assert.deepEqual(parsed.pageErrors, []);
console.log(JSON.stringify({
  ok: true,
  runId,
  states: parsed.examinations.length,
  responsiveChecks: Object.keys(parsed.responsive).length,
  accessibilityChecks: Object.keys(parsed.accessibility).length,
  reducedMotionChecks: Object.keys(parsed.reducedMotion).length,
  highZoomChecks: Object.keys(parsed.highZoom).length,
}, null, 2));
