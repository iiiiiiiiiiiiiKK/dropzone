/*
 * DROPZONE service worker.
 *
 * iOS home-screen PWAs are unforgiving: if a navigation is answered with a stale
 * or partially written index.html it renders a permanent white screen that only
 * reinstalling the app fixes. So this worker:
 *   - never serves a cached document to a navigation request; it always goes to
 *     the network and only falls back to cache when the network truly fails,
 *   - revalidates the shell on activate and drops every older cache,
 *   - answers a failed hashed-asset request with a real 504 instead of an empty
 *     response, so the app can show an error instead of a blank page.
 */
const VERSION = 'v3';
const CACHE = 'dropzone-shell-' + VERSION;
const SHELL = ['./', './index.html', './favicon.svg', './manifest.webmanifest', './icon-maskable.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // Fetch fresh copies: cache.addAll would happily store an error page.
      await Promise.all(
        SHELL.map(async (path) => {
          try {
            const response = await fetch(path, { cache: 'reload' });
            if (response.ok) await cache.put(path, response);
          } catch {
            /* offline install: the runtime cache will fill in later */
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

// Let the page force an update (used by the in-app "reload" affordance).
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') void self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  // The relay config must always be live, and cross-origin fetches are the relay's.
  if (!sameOrigin) return;
  if (url.pathname.endsWith('/config.json') || url.pathname.endsWith('/manifest.webmanifest')) return;

  if (request.mode === 'navigate') {
    // Network-first with an explicit timeout: on a flaky phone connection a hung
    // fetch would otherwise leave the PWA on a white screen forever.
    event.respondWith(
      (async () => {
        try {
          const fresh = await Promise.race([
            fetch(request, { cache: 'no-store' }),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
          ]);
          if (fresh && fresh.ok) {
            const cache = await caches.open(CACHE);
            await cache.put('./index.html', fresh.clone());
            return fresh;
          }
          throw new Error('bad response');
        } catch {
          const cached = await caches.match('./index.html');
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Hashed assets are immutable: cache-first, then network, then a real error.
  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok && (url.pathname.includes('/assets/') || /\.(svg|png|webp|woff2)$/.test(url.pathname))) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        return new Response('', { status: 504, statusText: 'Offline' });
      }
    })(),
  );
});
