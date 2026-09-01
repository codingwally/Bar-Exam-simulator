const CACHE_VERSION = 'duediligence-shell-20260901-forecast-member-access-1';
const EXAMINATION_STUDENT_SHELL = '/examination-room/student.html';
const EXAMINATION_OFFLINE_GRADER = '/examination-room/offline-grading.html';
const SHELL = Object.freeze([
  '/offline.html',
  '/assets/brand/icon-192.png',
  '/assets/brand/favicon-48.png',
  '/admin-pulse/',
  '/admin-pulse/manifest.webmanifest',
  '/admin-pulse/pulse.css?v=admin-pulse-pilot-20260830-1',
  '/admin-pulse/google-identity.js?v=admin-pulse-google-id-token-20260830-1',
  '/admin-pulse/pulse.js?v=admin-pulse-pilot-20260830-1',
  '/assets/phase2.css?release=profile-photo-release2-20260827-1&doors=examination-room-doors-20260826-2&profile=chambers-20260827-1&pricing=regular-checkout-r1',
  '/assets/pricing-checkout-safety.js?v=regular-checkout-r2',
  '/assets/private-beta-landing.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
  '/assets/due-diligence-controls.css?v=subject-matter-controls-20260817-4',
  '/assets/quorum-first-shell.css?v=profile-photo-release2-20260827-1&baseline=public-reliability-20260827-3',
  '/assets/quorum-first-shell.js?v=syllabus-review-20260823-1&forecast=exam-tools-20260901-4',
  '/assets/feature-loader.js?v=profile-photo-release2-20260827-1&baseline=public-reliability-20260827-1&feedback=offline-save-20260827-1&hotfix=ian-provisional-reveal-20260828-1&recovery=subject-review-timeout-20260828-1&cta=home-subscription-20260828-2&collapse=home-read-more-20260828-1&results=history-20260828-1&forecast=member-access-20260901-1',
  '/assets/private-beta-landing.js?v=public-reliability-20260827-2&feedback=quiet-navigation-20260828-1&forecast=exam-tools-20260901-4&auth=login-loop-p0-20260901-1',
  '/assets/profile-photo.js?v=profile-photo-release2-20260827-1',
  '/assets/phase2-experience.js?v=profile-photo-release2-20260827-1&baseline=syllabus-reveal-p0-20260826-2-examination-room-4&profile=chambers-20260827-1&access=paid-expiry-20260827-1&pricing=regular-checkout-r3&legal=explicit-20260901-1&auth=login-loop-p0-20260901-1',
  '/assets/pedro-navigation.js?v=pedro-release2-20260827-1',
  '/assets/icons/navigation/door-open.svg',
  '/assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4&feedback=offline-save-20260827-1',
  EXAMINATION_STUDENT_SHELL,
  EXAMINATION_OFFLINE_GRADER,
  '/examination-room/student.css?v=renovation-20260828-4',
  '/examination-room/view-models.js?v=greenfield-v1-20260826-1',
  '/examination-room/api.js?v=reliability-20260828-1',
  '/examination-room/media-capture.js?v=reliability-20260828-1',
  '/examination-room/student.js?v=reliability-20260828-1',
  '/examination-room/offline-grading.css?v=greenfield-v1-20260826-1',
  '/examination-room/offline-grading-core.js?v=greenfield-v1-20260826-3',
  '/examination-room/offline-grading.js?v=reliability-20260828-1',
  '/assets/phase2-config.js?v=provider-neutral-release2-20260827-1',
  '/assets/auth-session-storage.js?v=auth-persistence-20260812-1',
  '/assets/private-beta-session.js?v=beta-all-access-20260802-1',
  '/assets/bar-forecast.css?v=exam-tools-20260901-4',
  '/assets/bar-forecast.js?v=exam-tools-20260901-5',
  '/assets/icons/navigation/flag.svg',
  '/assets/bar-forecast/forecast-workspace-preview.webp',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith('duediligence-shell-') && key !== CACHE_VERSION)
      .map((key) => caches.delete(key)),
  )));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('authorization')) return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    if ([EXAMINATION_STUDENT_SHELL, EXAMINATION_OFFLINE_GRADER].includes(url.pathname)) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(
                caches.open(CACHE_VERSION).then((cache) => cache.put(url.pathname, copy)),
              );
            }
            return response;
          })
          .catch(() => caches.match(url.pathname)
            .then((cached) => cached || caches.match('/offline.html'))),
      );
      return;
    }
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }
  if (!SHELL.some((path) => url.pathname + url.search === path || url.pathname === path)) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_DUE_DILIGENCE_SHELL') {
    event.waitUntil(caches.delete(CACHE_VERSION));
  }
});

const ADMIN_PULSE_NOTIFICATIONS = Object.freeze({
  new_subscriber: Object.freeze({
    title: 'New subscriber',
    body: 'A subscription was activated. Open Due Diligence Pulse for details.',
  }),
  home_wall_post: Object.freeze({
    title: 'New Home Wall post',
    body: 'A post was published. Open Due Diligence Pulse for details.',
  }),
  support_request: Object.freeze({
    title: 'New support request',
    body: 'A request needs administrator attention. Open Due Diligence Pulse for details.',
  }),
  user_active: Object.freeze({
    title: 'Website activity',
    body: 'People are currently using Due Diligence. Open Pulse for the live count.',
  }),
  new_sign_in: Object.freeze({
    title: 'New sign-in',
    body: 'A new authenticated session was recorded. Open Due Diligence Pulse for details.',
  }),
});

function adminPulseNotificationPayload(pushEvent) {
  let payload = {};
  try {
    payload = pushEvent.data?.json?.() || {};
  } catch {
    payload = {};
  }
  const data = payload?.data && typeof payload.data === 'object'
    ? payload.data
    : {};
  const eventType = String(data.eventType || '').trim().toLowerCase();
  const copy = ADMIN_PULSE_NOTIFICATIONS[eventType] || Object.freeze({
    title: 'Due Diligence update',
    body: 'Important website activity was recorded. Open Due Diligence Pulse for details.',
  });
  const rawEventId = String(data.eventId || '').trim();
  const eventId = /^[A-Za-z0-9_-]{1,160}$/u.test(rawEventId) ? rawEventId : '';
  const query = eventId ? `?event=${encodeURIComponent(eventId)}` : '';
  return {
    copy,
    eventId,
    eventType,
    url: `/admin-pulse/${query}`,
  };
}

self.addEventListener('push', (event) => {
  const payload = adminPulseNotificationPayload(event);
  const tagSuffix = payload.eventId || `${payload.eventType || 'update'}-${Date.now()}`;
  event.waitUntil(self.registration.showNotification(payload.copy.title, {
    body: payload.copy.body,
    icon: '/assets/brand/icon-192.png',
    badge: '/assets/brand/favicon-48.png',
    tag: `due-diligence-pulse-${tagSuffix}`,
    renotify: payload.eventType === 'support_request',
    requireInteraction: payload.eventType === 'support_request',
    data: {
      type: 'ADMIN_PULSE_NOTIFICATION',
      eventId: payload.eventId,
      url: payload.url,
    },
  }));
});

self.addEventListener('notificationclick', (event) => {
  if (event.notification?.data?.type !== 'ADMIN_PULSE_NOTIFICATION') return;
  event.notification.close();
  const requestedUrl = new URL(event.notification.data.url || '/admin-pulse/', self.location.origin);
  const safeUrl = requestedUrl.origin === self.location.origin
      && requestedUrl.pathname.startsWith('/admin-pulse/')
    ? requestedUrl
    : new URL('/admin-pulse/', self.location.origin);
  const eventId = String(event.notification.data.eventId || '');
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const pulseWindow = windows.find((client) => {
      try {
        return new URL(client.url).pathname.startsWith('/admin-pulse/');
      } catch {
        return false;
      }
    });
    if (pulseWindow) {
      pulseWindow.postMessage({ type: 'ADMIN_PULSE_NOTIFICATION_OPENED', eventId });
      await pulseWindow.focus();
      return;
    }
    await self.clients.openWindow(safeUrl.href);
  })());
});
