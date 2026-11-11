/* Koda Production Service Worker - Multi-Device Instant Auto-Update Architecture */
const CACHE_NAME = 'koda-app-v1.0.6';
const CORE_ASSETS = [
  './',
  './index.html',
  './login.html',
  './chat.html',
  './profile.html',
  './theme-styles.css',
  './theme-manager.js',
  './update-manager.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable-192.png',
  './icon-maskable-512.png',
  './apple-touch-icon.png'
];

// Install: Pre-cache core shell & immediately skip waiting
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      for (const asset of CORE_ASSETS) {
        try {
          await cache.add(new Request(asset, { cache: 'reload' }));
        } catch (_) {}
      }
    })
  );
});

// Activate: Purge stale caches & immediately claim all clients across all tabs
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    ).then(async () => {
      await self.clients.claim();
      // Notify all connected clients of the updated service worker
      const clients = await self.clients.matchAll({ type: 'window' });
      for (const client of clients) {
        client.postMessage({ type: 'KODA_SW_UPDATED', version: '1.0.6' });
      }
    })
  );
});

// Message listener for skip waiting or manual reload trigger
self.addEventListener('message', event => {
  if (event.data && (event.data.action === 'skipWaiting' || event.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

// Fetch: Strategy depending on request type
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // 1. NEVER cache dynamic endpoints: APIs, SSE, version checks, admin, health
  if (
    url.pathname.includes('/api/') ||
    url.pathname.endsWith('/version.json') ||
    url.pathname.endsWith('/admin') ||
    url.pathname.endsWith('/health')
  ) {
    return;
  }

  // 2. Navigation Requests (HTML pages: /, /chat, etc.): Strict Network-First
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
          }
          return response;
        })
        .catch(async () => {
          // If offline, serve cached page or fallback
          const cached = await caches.match(event.request);
          if (cached) return cached;
          if (url.pathname.includes('/chat')) {
            return (await caches.match('./chat.html')) || (await caches.match('./index.html'));
          }
          if (url.pathname.includes('/profile')) {
            return (await caches.match('./profile.html')) || (await caches.match('./index.html'));
          }
          if (url.pathname.includes('/login')) {
            return (await caches.match('./login.html')) || (await caches.match('./index.html'));
          }
          return (await caches.match('./index.html')) || (await caches.match('./'));
        })
    );
    return;
  }

  // 3. Static Assets: Network-first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then(response => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
