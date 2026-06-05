/* Kill-switch service worker.
   The previous build registered a service worker; this replacement unregisters
   itself and clears all caches so no stale shell is served. It is intentionally
   NOT registered by the app anymore — it only runs for browsers that still have
   the old worker, to clean them up. */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((c) => c.navigate(c.url));
    } catch (e) { /* ignore */ }
  })());
});
