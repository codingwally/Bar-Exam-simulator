/* Only the public application shell is cached. API traffic, answers and server
 * responses never enter Cache Storage. Admitted offline work lives in the
 * browser draft store and is never shared between users through a CDN cache. */
// Bump this release version whenever a public shell asset changes. An active
// examination keeps a consistent shell until all its old tabs have closed.
const CACHE = "dd-exam-platform-shell-v7";
const SHELL = [
  "/index.html",
  "/student.css",
  "/student.mjs",
  "/local-drafts.mjs",
  "/fonts/inter.woff2",
  "/fonts/fraunces.woff2",
  ...[
    "menu",
    "x",
    "flag",
    "chevron-left",
    "chevron-right",
    "sliders-horizontal",
    "check",
    "circle-check",
  ].map((name) => `/icons/${name}.svg`),
];
self.addEventListener("install", (event) =>
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                (key.startsWith("dd-constitutional-shell-") ||
                  key.startsWith("dd-exam-platform-shell-")) &&
                key !== CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      ),
  ),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  const navigation =
    ["/practice", "/official"].includes(url.pathname) ||
    /^\/exam\/[a-z0-9_-]+\/?$/.test(url.pathname);
  if (
    event.request.method !== "GET" ||
    url.origin !== self.location.origin ||
    (!SHELL.includes(url.pathname) && !navigation)
  )
    return;
  // Shared admission query keys are deliberately excluded from Cache Storage.
  const cacheKey = new Request(
    `${url.origin}${navigation ? "/index.html" : url.pathname}`,
  );
  // The shell is versioned and installed atomically. Serving it directly avoids
  // making a reopened examination depend on a navigation fetch succeeding.
  // Current admission, questions, deadline and receipts always use live APIs.
  event.respondWith(
    caches
      .open(CACHE)
      .then((cache) => cache.match(cacheKey))
      .then((cached) => cached || fetch(event.request)),
  );
});
