const CACHE_VERSION = 'duediligence-shell-20260827-public-reliability-2';
const EXAMINATION_STUDENT_SHELL = '/examination-room/student.html';
const SHELL = Object.freeze([
  '/offline.html',
  '/assets/brand/icon-192.png',
  '/assets/phase2.css?release=examination-room-doors-20260826-2',
  '/assets/private-beta-landing.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
  '/assets/due-diligence-controls.css?v=subject-matter-controls-20260817-4',
  '/assets/quorum-first-shell.css?v=public-reliability-20260827-2',
  '/assets/quorum-first-shell.js?v=syllabus-review-20260823-1',
  '/assets/phase2-experience.js?v=syllabus-reveal-p0-20260826-2',
  '/assets/icons/navigation/door-open.svg',
  '/assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
  EXAMINATION_STUDENT_SHELL,
  '/examination-room/student.css',
  '/examination-room/view-models.js?v=greenfield-v1-20260826-1',
  '/examination-room/api.js?v=greenfield-v1-20260826-5',
  '/examination-room/student.js?v=greenfield-v1-20260826-3',
  '/assets/phase2-config.js?v=greenfield-examination-room-v1-20260826-2',
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
    if (url.pathname === EXAMINATION_STUDENT_SHELL) {
      event.respondWith(
        fetch(request)
          .then((response) => {
            if (response.ok) {
              const copy = response.clone();
              event.waitUntil(
                caches.open(CACHE_VERSION).then((cache) => cache.put(EXAMINATION_STUDENT_SHELL, copy)),
              );
            }
            return response;
          })
          .catch(() => caches.match(EXAMINATION_STUDENT_SHELL)
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
