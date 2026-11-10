const CACHE = 'dropzone-shell-v2';
const SHELL = ['./', './index.html', './favicon.svg', './manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Network-first for navigation so a redeploy is picked up, cache-first for hashed assets.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Runtime config and the manifest must always be fresh, never cached.
  if (url.pathname.endsWith('/config.json') || url.pathname.endsWith('/manifest.webmanifest')) return;
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put('./index.html', copy)).catch(() => undefined);
          return response;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || Response.error())),
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((hit) =>
      hit ||
      fetch(request).then((response) => {
        if (response.ok && (url.pathname.includes('/assets/') || url.pathname.endsWith('.svg'))) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => undefined);
        }
        return response;
      }),
    ),
  );
});
