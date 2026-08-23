const CACHE_VERSION = 'duediligence-shell-20260823-auth-entry-flow-1';
const SHELL = Object.freeze([
  '/offline.html',
  '/assets/brand/icon-192.png',
  '/assets/phase2.css?release=payment-admin-hotfix-20260821-1',
  '/assets/private-beta-landing.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
  '/assets/due-diligence-controls.css?v=subject-matter-controls-20260817-4',
  '/assets/quorum-first-shell.css?v=auth-entry-flow-20260823-1',
  '/assets/quorum-first-shell.js?v=approved-renovation-20260821-2',
  '/assets/study-workspace.css?v=master-experience-20260813-1&release=subject-matter-gil-fixes-20260817-4',
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
