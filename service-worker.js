const CACHE_VERSION = 'duediligence-shell-20260827-profile-pedro-release2-1';
const EXAMINATION_STUDENT_SHELL = '/examination-room/student.html';
const EXAMINATION_OFFLINE_GRADER = '/examination-room/offline-grading.html';
const SHELL = Object.freeze([
  '/offline.html',
  '/assets/brand/icon-192.png',
  '/assets/phase2.css?release=profile-photo-release2-20260827-1&doors=examination-room-doors-20260826-2&profile=chambers-20260827-1',
  '/assets/private-beta-landing.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
  '/assets/due-diligence-controls.css?v=subject-matter-controls-20260817-4',
  '/assets/quorum-first-shell.css?v=profile-photo-release2-20260827-1&baseline=public-reliability-20260827-2',
  '/assets/quorum-first-shell.js?v=syllabus-review-20260823-1',
  '/assets/profile-photo.js?v=profile-photo-release2-20260827-1',
  '/assets/phase2-experience.js?v=profile-photo-release2-20260827-1&baseline=syllabus-reveal-p0-20260826-2-examination-room-3&profile=chambers-20260827-1&access=paid-expiry-20260827-1',
  '/assets/pedro-navigation.js?v=pedro-release2-20260827-1',
  '/assets/icons/navigation/door-open.svg',
  '/assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4&feedback=offline-save-20260827-1',
  EXAMINATION_STUDENT_SHELL,
  EXAMINATION_OFFLINE_GRADER,
  '/examination-room/student.css',
  '/examination-room/view-models.js?v=greenfield-v1-20260826-1',
  '/examination-room/api.js?v=greenfield-v1-20260827-9',
  '/examination-room/student.js?v=greenfield-v1-20260827-7',
  '/examination-room/offline-grading.css?v=greenfield-v1-20260826-1',
  '/examination-room/offline-grading-core.js?v=greenfield-v1-20260826-3',
  '/examination-room/offline-grading.js?v=greenfield-v1-20260826-3',
  '/assets/phase2-config.js?v=provider-neutral-release2-20260827-1',
  '/assets/private-beta-session.js?v=beta-all-access-20260802-1',
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
