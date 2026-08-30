import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

const STAGING_SUPABASE_URL = 'https://hlzqmreeoghbldnhlybr.supabase.co';
const STAGING_WORKER_URL =
  'https://duediligence-examinations-staging.wallyesteban1993.workers.dev';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ALLOWED_EVENTS = new Set([
  'new_subscriber',
  'home_wall_post',
  'support_request',
  'user_active',
  'new_sign_in',
]);
const REQUEST_TIMEOUT_MS = 15_000;

function configuration() {
  const supabaseUrl = String(
    process.env.STAGING_SUPABASE_URL || STAGING_SUPABASE_URL,
  ).replace(/\/+$/u, '');
  const workerUrl = String(
    process.env.STAGING_ADMIN_PULSE_WORKER_URL || STAGING_WORKER_URL,
  ).replace(/\/+$/u, '');
  const origin = String(
    process.env.STAGING_ADMIN_PULSE_ORIGIN || STAGING_WORKER_URL,
  ).replace(/\/+$/u, '');
  const serviceRoleKey = String(
    process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY || '',
  ).trim();
  const publishableKey = String(
    process.env.STAGING_SUPABASE_PUBLISHABLE_KEY || '',
  ).trim();
  const vapidPublicKey = String(
    process.env.ADMIN_PULSE_VAPID_PUBLIC_KEY || '',
  ).trim();

  assert.equal(supabaseUrl, STAGING_SUPABASE_URL);
  assert.equal(workerUrl, STAGING_WORKER_URL);
  assert.equal(origin, STAGING_WORKER_URL);
  assert.match(serviceRoleKey, /^sb_secret_[A-Za-z0-9_-]{20,}$/u);
  assert.match(publishableKey, /^sb_publishable_[A-Za-z0-9_-]{20,}$/u);
  assert.match(vapidPublicKey, /^B[A-Za-z0-9_-]{86}$/u);
  return Object.freeze({
    origin,
    publishableKey,
    serviceRoleKey,
    supabaseUrl,
    vapidPublicKey,
    workerUrl,
  });
}

async function responseBody(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.toLowerCase().includes('application/json')) return null;
  return response.json().catch(() => null);
}

async function requestJson(url, options = {}, statuses = [200]) {
  const response = await fetch(url, {
    redirect: 'error',
    ...options,
    signal: options.signal || AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const body = await responseBody(response);
  if (!statuses.includes(response.status)) {
    const code = body?.error?.code || body?.code || 'REMOTE_ERROR';
    throw new Error(`${options.method || 'GET'} ${new URL(url).pathname} returned ${response.status} ${code}`);
  }
  return { body, response };
}

function serviceHeaders(config, contentType = false) {
  return {
    apikey: config.serviceRoleKey,
    ...(contentType ? { 'Content-Type': 'application/json' } : {}),
  };
}

async function createUser(config, label, runId, createdUsers) {
  const email = `dd-admin-pulse-${label}-${runId}@example.com`;
  const password = `Dd!${randomBytes(30).toString('base64url')}9z`;
  const { body: createdBody } = await requestJson(
    `${config.supabaseUrl}/auth/v1/admin/users`,
    {
      method: 'POST',
      headers: serviceHeaders(config, true),
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: `Synthetic Admin Pulse ${label}` },
      }),
    },
    [200, 201],
  );
  const created = createdBody?.user || createdBody;
  assert.match(String(created?.id || ''), UUID_PATTERN);
  const cleanup = { id: created.id, token: null };
  createdUsers.push(cleanup);

  const { body: session } = await requestJson(
    `${config.supabaseUrl}/auth/v1/token?grant_type=password`,
    {
      method: 'POST',
      headers: {
        apikey: config.publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, password }),
    },
  );
  assert.ok(String(session?.access_token || '').length > 80);
  cleanup.token = session.access_token;
  return Object.freeze({ id: created.id, token: session.access_token });
}

async function assignRole(config, userId, role) {
  const { body } = await requestJson(
    `${config.supabaseUrl}/rest/v1/user_roles?user_id=eq.${encodeURIComponent(userId)}`,
    {
      method: 'PATCH',
      headers: {
        ...serviceHeaders(config, true),
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        role,
        assigned_by: null,
        updated_at: new Date().toISOString(),
      }),
    },
  );
  assert.equal(Array.isArray(body) ? body.length : 0, 1);
  assert.equal(body[0]?.role, role);
}

async function pulsePost(config, path, token, payload, statuses = [200]) {
  const result = await requestJson(
    `${config.workerUrl}${path}`,
    {
      method: 'POST',
      headers: {
        Origin: config.origin,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
      },
      body: JSON.stringify(payload),
    },
    statuses,
  );
  assert.equal(
    result.response.headers.get('access-control-allow-origin'),
    config.origin,
  );
  assert.match(
    String(result.response.headers.get('cache-control') || ''),
    /\bno-store\b/iu,
  );
  return result.body;
}

async function cleanupUsers(config, users) {
  const errors = [];
  for (const user of [...users].reverse()) {
    if (user.token) {
      await requestJson(
        `${config.supabaseUrl}/auth/v1/logout?scope=global`,
        {
          method: 'POST',
          headers: {
            apikey: config.publishableKey,
            Authorization: `Bearer ${user.token}`,
          },
        },
        [204],
      ).catch((error) => errors.push(error));
    }
    await requestJson(
      `${config.supabaseUrl}/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
      {
        method: 'DELETE',
        headers: serviceHeaders(config),
      },
      [200, 204],
    ).catch((error) => errors.push(error));
  }
  return errors;
}

async function run() {
  const config = configuration();
  const runId = `${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;
  const users = [];
  let failure = null;
  let cleanupErrors = [];
  const smokeEndpoint = 'https://push.example.invalid/admin-pulse-staging-smoke';
  try {
    const student = await createUser(config, 'student', runId, users);
    const admin = await createUser(config, 'admin', runId, users);
    await assignRole(config, student.id, 'student');
    await assignRole(config, admin.id, 'admin');

    const denied = await pulsePost(
      config,
      '/admin/pulse/snapshot',
      student.token,
      {},
      [403],
    );
    assert.equal(denied?.ok, false);
    assert.equal(denied?.error?.code, 'ADMIN_FORBIDDEN');

    const snapshot = await pulsePost(
      config,
      '/admin/pulse/snapshot',
      admin.token,
      { limit: 100 },
    );
    assert.equal(snapshot?.ok, true);
    assert.equal(snapshot?.enabled, true);
    assert.equal(snapshot?.vapidPublicKey, config.vapidPublicKey);
    assert.equal(snapshot?.subscribed, false);
    assert.ok(Number.isSafeInteger(snapshot?.snapshot?.activeUsers?.count));
    assert.ok(Array.isArray(snapshot?.snapshot?.events));
    assert.ok(
      snapshot.snapshot.events.every((event) => ALLOWED_EVENTS.has(event?.eventType)),
    );

    const registered = await pulsePost(
      config,
      '/admin/pulse/push-subscription',
      admin.token,
      {
        operation: 'upsert',
        subscription: {
          endpoint: smokeEndpoint,
          expirationTime: null,
          keys: {
            p256dh: `B${'a'.repeat(86)}`,
            auth: 'b'.repeat(22),
          },
        },
      },
    );
    assert.equal(registered?.ok, true);
    assert.equal(registered?.enabled, true);
    assert.equal(registered?.subscribed, true);

    const removed = await pulsePost(
      config,
      '/admin/pulse/push-subscription',
      admin.token,
      {
        operation: 'remove',
        subscription: { endpoint: smokeEndpoint },
      },
    );
    assert.equal(removed?.ok, true);
    assert.equal(removed?.subscribed, false);
    console.log(
      'ADMIN_PULSE_STAGING_POSITIVE: non_admin_denied=true admin_snapshot=true push_registration=true cleanup_pending=true',
    );
  } catch (error) {
    failure = error;
  } finally {
    cleanupErrors = await cleanupUsers(config, users);
  }
  if (failure) throw failure;
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Synthetic Admin Pulse cleanup failed.');
  }
  console.log('ADMIN_PULSE_STAGING_POSITIVE: synthetic_cleanup=true');
}

await run();
