export const ADMIN_PULSE_EVENT_TYPES = Object.freeze([
  'new_subscriber',
  'home_wall_post',
  'support_request',
  'user_active',
  'new_sign_in',
]);

const EVENT_COPY = Object.freeze({
  new_subscriber: Object.freeze({
    title: 'New subscriber',
    body: 'A subscription was approved. Open Due Diligence Pulse for details.',
    urgency: 'normal',
  }),
  home_wall_post: Object.freeze({
    title: 'New Home Wall post',
    body: 'A new post was published. Open Due Diligence Pulse for details.',
    urgency: 'normal',
  }),
  support_request: Object.freeze({
    title: 'New support request',
    body: 'A support request needs review. Open Due Diligence Pulse for details.',
    urgency: 'high',
  }),
  user_active: Object.freeze({
    title: 'User active',
    body: 'A user started using the website. Open Due Diligence Pulse for details.',
    urgency: 'normal',
  }),
  new_sign_in: Object.freeze({
    title: 'New sign-in',
    body: 'A user signed in. Open Due Diligence Pulse for details.',
    urgency: 'normal',
  }),
});

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const VAPID_PUBLIC_KEY_PATTERN = /^[A-Za-z0-9_-]{80,180}$/;
const VAPID_PRIVATE_KEY_PATTERN = /^[A-Za-z0-9_-]{40,100}$/;

export class AdminPulseError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AdminPulseError';
    this.code = code;
    this.status = status;
  }
}

function enabledValue(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

export function adminPulseEnabled(env) {
  return enabledValue(env?.ADMIN_PULSE_ENABLED);
}

export function adminPulseWebPushConfigured(env) {
  const publicKey = String(env?.ADMIN_PULSE_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env?.ADMIN_PULSE_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env?.ADMIN_PULSE_VAPID_SUBJECT || '').trim();
  return enabledValue(env?.ADMIN_PULSE_WEB_PUSH_ENABLED)
    && VAPID_PUBLIC_KEY_PATTERN.test(publicKey)
    && VAPID_PRIVATE_KEY_PATTERN.test(privateKey)
    && /^(?:mailto:|https:\/\/)[^\s]+$/i.test(subject);
}

export function adminPulsePublicVapidKey(env) {
  if (!adminPulseEnabled(env)) return null;
  const publicKey = String(env?.ADMIN_PULSE_VAPID_PUBLIC_KEY || '').trim();
  return VAPID_PUBLIC_KEY_PATTERN.test(publicKey) ? publicKey : null;
}

export function emptyAdminPulseSnapshot(now = new Date()) {
  return {
    generatedAt: now.toISOString(),
    activeUsers: { count: 0 },
    events: [],
  };
}

export function normalizeAdminPulseSnapshotRequest(payload) {
  if (payload == null) return { limit: 50 };
  if (typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminPulseError(
      'INVALID_ADMIN_PULSE_REQUEST',
      'The Admin Pulse snapshot request must be an object.',
    );
  }
  const unsupported = Object.keys(payload).filter((key) => key !== 'limit');
  if (unsupported.length) {
    throw new AdminPulseError(
      'INVALID_ADMIN_PULSE_REQUEST',
      'The Admin Pulse snapshot request contains an unsupported field.',
    );
  }
  const limit = payload.limit == null ? 50 : Number(payload.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new AdminPulseError(
      'INVALID_ADMIN_PULSE_REQUEST',
      'Admin Pulse accepts between 1 and 100 events.',
    );
  }
  return { limit };
}

function normalizeEndpoint(value) {
  const endpoint = String(value || '').trim();
  if (endpoint.length < 16 || endpoint.length > 2048 || /[\u0000-\u001f\u007f]/u.test(endpoint)) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push endpoint is invalid.',
    );
  }
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push endpoint is invalid.',
    );
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || !url.hostname) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push endpoint must be a secure HTTPS address.',
    );
  }
  return url.href;
}

function normalizeExpirationTime(value) {
  if (value == null) return null;
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp <= Date.now() || timestamp > Date.now() + 10 * 365 * 86400000) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push subscription expiration is invalid.',
    );
  }
  return new Date(timestamp).toISOString();
}

export function normalizeAdminPulsePushRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'A Web Push subscription request is required.',
    );
  }
  const unsupported = Object.keys(payload).filter((key) => !['operation', 'subscription'].includes(key));
  if (unsupported.length) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push request contains an unsupported field.',
    );
  }
  const operation = String(payload.operation || '').trim().toLowerCase();
  if (!['upsert', 'remove'].includes(operation)) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'Choose whether to add or remove the Web Push subscription.',
    );
  }
  const subscription = payload.subscription;
  if (!subscription || typeof subscription !== 'object' || Array.isArray(subscription)) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'A Web Push subscription is required.',
    );
  }
  const endpoint = normalizeEndpoint(subscription.endpoint);
  if (operation === 'remove') {
    return { operation, subscription: { endpoint } };
  }

  const keys = subscription.keys;
  if (!keys || typeof keys !== 'object' || Array.isArray(keys)) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push encryption keys are required.',
    );
  }
  const p256dh = String(keys.p256dh || '').trim();
  const auth = String(keys.auth || '').trim();
  if (!BASE64URL_PATTERN.test(p256dh)
      || p256dh.length < 80
      || p256dh.length > 180
      || !BASE64URL_PATTERN.test(auth)
      || auth.length < 16
      || auth.length > 64) {
    throw new AdminPulseError(
      'INVALID_PUSH_SUBSCRIPTION',
      'The Web Push encryption keys are invalid.',
    );
  }
  return {
    operation,
    subscription: {
      endpoint,
      expirationTime: normalizeExpirationTime(subscription.expirationTime),
      keys: { p256dh, auth },
    },
  };
}

export function coarsePushUserAgent(value) {
  const userAgent = String(value || '');
  if (/EdgA?\//i.test(userAgent)) return 'Edge';
  if (/SamsungBrowser\//i.test(userAgent)) return 'Samsung Internet';
  if (/(?:Chrome|CriOS)\//i.test(userAgent)) return 'Chrome';
  if (/(?:Firefox|FxiOS)\//i.test(userAgent)) return 'Firefox';
  if (/Safari\//i.test(userAgent)) return 'Safari';
  return 'Other or privacy-masked';
}

export async function authorizeAdminPulse(request, env, dependencies) {
  const requireAdministrator = dependencies?.requireAdministrator;
  const rpc = dependencies?.rpc;
  if (typeof requireAdministrator !== 'function' || typeof rpc !== 'function') {
    throw new TypeError('Admin Pulse authorization dependencies are required.');
  }
  const user = await requireAdministrator(request, env);
  await rpc(env, 'admin_authorization_context', {
    p_actor_user_id: user.id,
  });
  return user;
}

export function adminPulseNotification(eventType, eventId) {
  if (!ADMIN_PULSE_EVENT_TYPES.includes(eventType)) {
    throw new AdminPulseError(
      'INVALID_ADMIN_PULSE_EVENT',
      'The Admin Pulse event type is unsupported.',
    );
  }
  const normalizedEventId = String(eventId || '').trim().toLowerCase();
  if (!UUID_PATTERN.test(normalizedEventId)) {
    throw new AdminPulseError(
      'INVALID_ADMIN_PULSE_EVENT',
      'The Admin Pulse event identifier is invalid.',
    );
  }
  const copy = EVENT_COPY[eventType];
  return {
    payload: {
      title: copy.title,
      body: copy.body,
      tag: `admin-pulse-${normalizedEventId}`,
      data: {
        eventId: normalizedEventId,
        eventType,
        url: `/admin-pulse/?event=${encodeURIComponent(normalizedEventId)}`,
      },
    },
    options: {
      TTL: eventType === 'support_request' ? 86400 : 21600,
      urgency: copy.urgency,
      topic: `ddp-${normalizedEventId.replace(/-/g, '').slice(0, 28)}`,
    },
  };
}

function webPushErrorStatus(error) {
  const value = Number(error?.statusCode ?? error?.status ?? 0);
  return Number.isInteger(value) && value >= 100 && value <= 599 ? value : null;
}

function retryAfterSeconds(error) {
  const raw = error?.headers?.['retry-after'] ?? error?.headers?.get?.('Retry-After');
  if (raw == null) return null;
  const seconds = Number(raw);
  if (Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3600) return seconds;
  const at = Date.parse(String(raw));
  if (!Number.isFinite(at)) return null;
  return Math.min(3600, Math.max(0, Math.ceil((at - Date.now()) / 1000)));
}

export function classifyWebPushFailure(error) {
  const status = webPushErrorStatus(error);
  if (status === 404 || status === 410) {
    return {
      outcome: 'stale',
      status,
      errorCode: `web_push_http_${status}`,
      retryAfterSeconds: null,
    };
  }
  if (status === 408 || status === 425 || status === 429 || (status != null && status >= 500)) {
    return {
      outcome: 'retry',
      status,
      errorCode: `web_push_http_${status}`,
      retryAfterSeconds: retryAfterSeconds(error),
    };
  }
  if (status != null) {
    return {
      outcome: 'dead',
      status,
      errorCode: `web_push_http_${status}`,
      retryAfterSeconds: null,
    };
  }
  const code = String(error?.code || error?.name || 'web_push_network_error')
    .replace(/[^A-Za-z0-9_-]/g, '_')
    .slice(0, 120);
  return {
    outcome: 'retry',
    status: null,
    errorCode: code || 'web_push_network_error',
    retryAfterSeconds: null,
  };
}

export async function sendAdminPulseWebPush({ subscription, payload, options, env }) {
  const imported = await import('web-push');
  const webPush = imported.default || imported;
  return webPush.sendNotification(
    subscription,
    JSON.stringify(payload),
    {
      ...options,
      vapidDetails: {
        subject: String(env.ADMIN_PULSE_VAPID_SUBJECT).trim(),
        publicKey: String(env.ADMIN_PULSE_VAPID_PUBLIC_KEY).trim(),
        privateKey: String(env.ADMIN_PULSE_VAPID_PRIVATE_KEY).trim(),
      },
    },
  );
}

export async function drainAdminPulseDeliveries(env, dependencies = {}) {
  if (!adminPulseEnabled(env)) {
    return { status: 'disabled', claimed: 0, delivered: 0, retried: 0, stale: 0, dead: 0 };
  }
  if (!adminPulseWebPushConfigured(env)) {
    return { status: 'not_configured', claimed: 0, delivered: 0, retried: 0, stale: 0, dead: 0 };
  }
  const rpc = dependencies.rpc;
  if (typeof rpc !== 'function') throw new TypeError('Admin Pulse RPC dependency is required.');
  const sendPush = dependencies.sendPush || sendAdminPulseWebPush;
  const randomUUID = dependencies.randomUUID || (() => crypto.randomUUID());
  const maxBatches = Math.min(8, Math.max(1, Number(dependencies.maxBatches) || 4));
  const batchSize = Math.min(100, Math.max(1, Number(dependencies.batchSize) || 25));
  const summary = { status: 'processed', claimed: 0, delivered: 0, retried: 0, stale: 0, dead: 0 };

  await rpc(env, 'admin_pulse_cleanup_deliveries_v1', {});

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const claimToken = randomUUID();
    const claimed = await rpc(env, 'admin_pulse_claim_deliveries_v1', {
      p_claim_token: claimToken,
      p_limit: batchSize,
    });
    const items = Array.isArray(claimed?.items) ? claimed.items : [];
    if (!items.length) break;
    summary.claimed += items.length;

    await Promise.all(items.map(async (item) => {
      let completion;
      try {
        const notification = adminPulseNotification(item.eventType, item.eventId);
        const response = await sendPush({
          subscription: {
            endpoint: item.endpoint,
            keys: { p256dh: item.p256dh, auth: item.auth },
          },
          payload: notification.payload,
          options: notification.options,
          env,
        });
        completion = {
          outcome: 'delivered',
          status: Number(response?.statusCode || response?.status || 201),
          errorCode: null,
          retryAfterSeconds: null,
        };
      } catch (error) {
        completion = classifyWebPushFailure(error);
      }

      await rpc(env, 'admin_pulse_complete_delivery_v1', {
        p_delivery_id: item.deliveryId,
        p_claim_token: claimToken,
        p_outcome: completion.outcome,
        p_http_status: completion.status,
        p_error_code: completion.errorCode,
        p_retry_after_seconds: completion.retryAfterSeconds,
      });
      if (completion.outcome === 'delivered') summary.delivered += 1;
      else if (completion.outcome === 'retry') summary.retried += 1;
      else if (completion.outcome === 'stale') summary.stale += 1;
      else summary.dead += 1;
    }));

    if (items.length < batchSize) break;
  }
  return summary;
}

export function scheduleAdminPulseDispatch(env, executionContext, dependencies = {}) {
  if (!adminPulseEnabled(env) || !adminPulseWebPushConfigured(env)) return false;
  const task = drainAdminPulseDeliveries(env, dependencies).catch((error) => {
    console.error('Admin Pulse Web Push drain failed', {
      code: String(error?.code || error?.name || 'ADMIN_PULSE_DRAIN_FAILED').slice(0, 80),
    });
    return { status: 'failed' };
  });
  if (typeof executionContext?.waitUntil === 'function') {
    executionContext.waitUntil(task);
  }
  return true;
}
