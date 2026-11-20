const CACHE_NAME = 'gkpi-book-v1';
const STATIC_ASSETS = ['/', '/index.html', '/Logo.png', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  // Jangan cache request API, Supabase, atau non-GET
  if (request.method !== 'GET' || request.url.includes('/api/') || request.url.includes('supabase.co')) {
    return;
  }

  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});
