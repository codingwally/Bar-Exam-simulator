import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ADMIN_PULSE_EVENT_TYPES,
  AdminPulseError,
  adminPulseEnabled,
  adminPulseNotification,
  adminPulseWebPushConfigured,
  authorizeAdminPulse,
  classifyWebPushFailure,
  drainAdminPulseDeliveries,
  normalizeAdminPulsePushRequest,
  normalizeAdminPulseSnapshotRequest,
} from './admin-pulse-core.mjs';

const VALID_P256DH = `B${'a'.repeat(86)}`;
const VALID_AUTH = 'b'.repeat(22);
const VALID_PUBLIC_VAPID = `B${'c'.repeat(86)}`;
const VALID_PRIVATE_VAPID = 'd'.repeat(43);
const EVENT_ID = '11111111-1111-4111-8111-111111111111';
const DELIVERY_ID = '22222222-2222-4222-8222-222222222222';
const CLAIM_TOKEN = '33333333-3333-4333-8333-333333333333';

function enabledEnv() {
  return {
    ADMIN_PULSE_ENABLED: 'true',
    ADMIN_PULSE_WEB_PUSH_ENABLED: 'true',
    ADMIN_PULSE_VAPID_PUBLIC_KEY: VALID_PUBLIC_VAPID,
    ADMIN_PULSE_VAPID_PRIVATE_KEY: VALID_PRIVATE_VAPID,
    ADMIN_PULSE_VAPID_SUBJECT: 'mailto:support@duediligence.ph',
  };
}

test('Admin Pulse is default-off and a disabled drain performs no storage work', async () => {
  assert.equal(adminPulseEnabled({}), false);
  assert.equal(adminPulseWebPushConfigured({}), false);
  let rpcCalls = 0;
  const result = await drainAdminPulseDeliveries({}, {
    rpc: async () => {
      rpcCalls += 1;
    },
  });
  assert.deepEqual(result, {
    status: 'disabled',
    claimed: 0,
    delivered: 0,
    retried: 0,
    stale: 0,
    dead: 0,
  });
  assert.equal(rpcCalls, 0);
});

test('snapshot input is bounded and rejects unsupported fields', () => {
  assert.deepEqual(normalizeAdminPulseSnapshotRequest(null), { limit: 50 });
  assert.deepEqual(normalizeAdminPulseSnapshotRequest({ limit: 100 }), { limit: 100 });
  assert.throws(
    () => normalizeAdminPulseSnapshotRequest({ limit: 0 }),
    (error) => error instanceof AdminPulseError
      && error.code === 'INVALID_ADMIN_PULSE_REQUEST',
  );
  assert.throws(
    () => normalizeAdminPulseSnapshotRequest({ search: 'email@example.com' }),
    /unsupported field/i,
  );
});

test('standard Chrome and Apple PushSubscription endpoints are accepted without a host allowlist', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/example-subscription-token',
    'https://web.push.apple.com/QHh5YXBwbGUtcHVzaC10b2tlbg',
  ]) {
    const normalized = normalizeAdminPulsePushRequest({
      operation: 'upsert',
      subscription: {
        endpoint,
        expirationTime: Date.now() + 86400000,
        keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
      },
    });
    assert.equal(normalized.operation, 'upsert');
    assert.equal(normalized.subscription.endpoint, endpoint);
    assert.equal(normalized.subscription.keys.p256dh, VALID_P256DH);
  }

  assert.deepEqual(normalizeAdminPulsePushRequest({
    operation: 'remove',
    subscription: {
      endpoint: 'https://web.push.apple.com/revoked-endpoint',
    },
  }), {
    operation: 'remove',
    subscription: {
      endpoint: 'https://web.push.apple.com/revoked-endpoint',
    },
  });
});

test('push subscription validation rejects insecure endpoints, credentials, and malformed keys', () => {
  const base = {
    operation: 'upsert',
    subscription: {
      endpoint: 'https://push.example.test/subscription',
      expirationTime: null,
      keys: { p256dh: VALID_P256DH, auth: VALID_AUTH },
    },
  };
  for (const endpoint of [
    'http://push.example.test/subscription',
    'https://username:password@push.example.test/subscription',
    'not-a-url',
  ]) {
    assert.throws(
      () => normalizeAdminPulsePushRequest({
        ...base,
        subscription: { ...base.subscription, endpoint },
      }),
      (error) => error instanceof AdminPulseError
        && error.code === 'INVALID_PUSH_SUBSCRIPTION',
    );
  }
  assert.throws(
    () => normalizeAdminPulsePushRequest({
      ...base,
      subscription: {
        ...base.subscription,
        keys: { p256dh: 'short', auth: VALID_AUTH },
      },
    }),
    /encryption keys are invalid/i,
  );
});

test('authorization rejects missing sessions and propagates database non-admin denial', async () => {
  const unauthorized = new AdminPulseError('ADMIN_SIGN_IN_REQUIRED', 'Sign in required.', 401);
  await assert.rejects(
    authorizeAdminPulse(new Request('https://example.test'), {}, {
      requireAdministrator: async () => { throw unauthorized; },
      rpc: async () => assert.fail('RPC must not run without an authenticated user'),
    }),
    (error) => error === unauthorized,
  );

  const forbidden = new AdminPulseError('ADMIN_FORBIDDEN', 'Admin role required.', 403);
  await assert.rejects(
    authorizeAdminPulse(new Request('https://example.test'), {}, {
      requireAdministrator: async () => ({ id: EVENT_ID }),
      rpc: async (_env, functionName, body) => {
        assert.equal(functionName, 'admin_authorization_context');
        assert.equal(body.p_actor_user_id, EVENT_ID);
        throw forbidden;
      },
    }),
    (error) => error === forbidden,
  );
});

test('all and only the five approved event types map to generic lock-screen-safe pushes', () => {
  assert.deepEqual(ADMIN_PULSE_EVENT_TYPES, [
    'new_subscriber',
    'home_wall_post',
    'support_request',
    'user_active',
    'new_sign_in',
  ]);
  for (const eventType of ADMIN_PULSE_EVENT_TYPES) {
    const notification = adminPulseNotification(eventType, EVENT_ID);
    assert.equal(notification.payload.data.eventType, eventType);
    assert.equal(notification.payload.data.eventId, EVENT_ID);
    assert.match(notification.payload.body, /Open Due Diligence Pulse/i);
    assert.doesNotMatch(notification.payload.body, /@|password|token/i);
  }
  assert.equal(adminPulseNotification('support_request', EVENT_ID).options.urgency, 'high');
  assert.throws(
    () => adminPulseNotification('comment', EVENT_ID),
    (error) => error instanceof AdminPulseError
      && error.code === 'INVALID_ADMIN_PULSE_EVENT',
  );
});

test('404 and 410 are provider-agnostic stale endpoints while transient failures retry', () => {
  for (const statusCode of [404, 410]) {
    assert.deepEqual(classifyWebPushFailure({ statusCode }), {
      outcome: 'stale',
      status: statusCode,
      errorCode: `web_push_http_${statusCode}`,
      retryAfterSeconds: null,
    });
  }
  assert.deepEqual(classifyWebPushFailure({
    statusCode: 429,
    headers: { 'retry-after': '120' },
  }), {
    outcome: 'retry',
    status: 429,
    errorCode: 'web_push_http_429',
    retryAfterSeconds: 120,
  });
  assert.equal(classifyWebPushFailure({ statusCode: 400 }).outcome, 'dead');
});

test('delivery drain completes 404 and 410 claims as stale per subscription', async () => {
  const completionCalls = [];
  let claimCalls = 0;
  const result = await drainAdminPulseDeliveries(enabledEnv(), {
    randomUUID: () => CLAIM_TOKEN,
    sendPush: async ({ subscription }) => {
      const statusCode = subscription.endpoint.includes('apple') ? 410 : 404;
      throw Object.assign(new Error('endpoint gone'), { statusCode });
    },
    rpc: async (_env, functionName, body) => {
      if (functionName === 'admin_pulse_cleanup_deliveries_v1') return {};
      if (functionName === 'admin_pulse_claim_deliveries_v1') {
        claimCalls += 1;
        if (claimCalls > 1) return { items: [] };
        return {
          items: [
            {
              deliveryId: DELIVERY_ID,
              eventId: EVENT_ID,
              eventType: 'support_request',
              endpoint: 'https://web.push.apple.com/gone',
              p256dh: VALID_P256DH,
              auth: VALID_AUTH,
            },
            {
              deliveryId: '44444444-4444-4444-8444-444444444444',
              eventId: '55555555-5555-4555-8555-555555555555',
              eventType: 'new_sign_in',
              endpoint: 'https://push.example.test/gone',
              p256dh: VALID_P256DH,
              auth: VALID_AUTH,
            },
          ],
        };
      }
      if (functionName === 'admin_pulse_complete_delivery_v1') {
        completionCalls.push(body);
        return {};
      }
      assert.fail(`Unexpected RPC ${functionName}`);
    },
  });

  assert.equal(result.claimed, 2);
  assert.equal(result.stale, 2);
  assert.deepEqual(completionCalls.map((call) => call.p_outcome), ['stale', 'stale']);
  assert.deepEqual(completionCalls.map((call) => call.p_http_status), [410, 404]);
  assert.ok(completionCalls.every((call) => call.p_claim_token === CLAIM_TOKEN));
});

test('migration defines an append-only deduplicated five-event outbox and current-admin claim fence', async () => {
  const sql = await readFile(new URL(
    '../supabase/migrations/20260830193000_admin_pulse_notifications.sql',
    import.meta.url,
  ), 'utf8');
  assert.match(sql, /capture_enabled boolean not null default false/i);
  assert.match(sql, /delivery_enabled boolean not null default false/i);
  assert.match(sql, /'captureEnabled', v_capture_enabled/i);
  assert.match(sql, /'deliveryEnabled', v_delivery_enabled/i);
  assert.match(sql, /if not v_capture_enabled or not v_delivery_enabled then[\s\S]*capture and delivery are not enabled/i);
  assert.match(sql, /dedupe_key text not null unique/i);
  assert.match(sql, /on conflict \(dedupe_key\) do nothing/i);
  assert.match(sql, /active_material_check check \(/i);
  assert.match(sql, /v_data_scope = 'regular'/i);
  assert.match(sql, /event\.data_scope = 'regular'/i);
  assert.match(sql, /revoke all on public\.admin_pulse_events[\s\S]*service_role/i);
  for (const fragment of [
    'new_subscriber:user:',
    'home_wall_post:forum_post:',
    'support_request:support_request:',
    'user_active:usage_session:',
    'new_sign_in:user_sign_in_event:',
  ]) {
    assert.ok(sql.includes(fragment), `missing stable dedupe fragment ${fragment}`);
  }
  for (const trigger of [
    'admin_pulse_subscription_activated',
    'admin_pulse_home_wall_post',
    'admin_pulse_support_request',
    'admin_pulse_user_active',
    'admin_pulse_new_sign_in',
  ]) {
    assert.match(sql, new RegExp(`create trigger ${trigger}`, 'i'));
  }
  assert.match(sql, /create table if not exists private\.admin_pulse_subscriber_first_seen/i);
  assert.match(sql, /on conflict \(user_id\) do nothing[\s\S]*returning user_id into v_first_seen_user_id/i);
  assert.match(sql, /new\.status <> 'active'[\s\S]*old\.status is not distinct from 'active'/i);
  assert.match(sql, /join public\.user_roles role_row[\s\S]*role_row\.role::text in \('admin', 'founder_admin', 'super_admin'\)/i);
  assert.match(sql, /status = 'stale'[\s\S]*endpoint = null[\s\S]*p256dh = null[\s\S]*auth_secret = null/i);
});

test('index exposes only the stable authenticated snapshot and push-subscription routes', async () => {
  const source = await readFile(new URL('./index.mjs', import.meta.url), 'utf8');
  assert.match(source, /pathname === '\/admin\/pulse\/snapshot'/);
  assert.match(source, /pathname === '\/admin\/pulse\/push-subscription'/);
  assert.match(source, /authorizeAdminPulse\(request, env/);
  assert.match(source, /const enabled = result\?\.captureEnabled === true/);
  assert.match(source, /result\?\.deliveryEnabled === true[\s\S]*adminPulseWebPushConfigured\(env\)/);
  assert.match(source, /command\.operation === 'upsert' && !adminPulseEnabled\(env\)/);
  assert.match(source, /enabled:\s*false,[\s\S]*vapidPublicKey:\s*null,[\s\S]*subscribed:\s*false/);
});
