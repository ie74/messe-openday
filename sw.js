const CACHE = 'openday-v9';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'brand-mark.svg', 'favicon.png?v=9', 'apple-touch-icon.png?v=8',
  'icon-192.png?v=8', 'icon-512.png?v=8', 'icon-maskable-512.png?v=8'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter(key => key !== CACHE && /^(evento-|openday-)/.test(key))
      .map(key => caches.delete(key)));
    // Disiscrive i dispositivi che usavano la versione precedente dell'app.
    try {
      const subscription = await self.registration.pushManager?.getSubscription();
      if (subscription) await subscription.unsubscribe();
    } catch (error) { console.warn('Rimozione iscrizione precedente:', error); }
    await self.clients.claim();
  })());
});

// Rete prima, cache come riserva. Le API e i dati personali non vengono cachati qui.
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  event.respondWith((async () => {
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      if (event.request.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
