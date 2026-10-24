/* Only the public application shell is cached. API traffic, answers and server
 * responses never enter Cache Storage. Admitted offline work lives in the
 * browser draft store and is never shared between users through a CDN cache. */
// Bump this release version whenever a public shell asset changes. An active
// examination keeps a consistent shell until all its old tabs have closed.
const CACHE = 'dd-constitutional-shell-v5';
const SHELL = ['/practice', '/official', '/student.css', '/student.mjs', '/local-drafts.mjs', '/fonts/inter.woff2', '/fonts/fraunces.woff2'];
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL))));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('dd-constitutional-shell-') && key !== CACHE).map(key => caches.delete(key))))));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || !SHELL.includes(url.pathname)) return;
  // Shared admission query keys are deliberately excluded from Cache Storage.
  const cacheKey = new Request(`${url.origin}${url.pathname}`);
  // The shell is versioned and installed atomically. Serving it directly avoids
  // making a reopened examination depend on a navigation fetch succeeding.
  // Current admission, questions, deadline and receipts always use live APIs.
  event.respondWith(caches.open(CACHE).then(cache => cache.match(cacheKey)).then(cached => cached || fetch(event.request)));
});
