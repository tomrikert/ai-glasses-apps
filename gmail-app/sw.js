// Service Worker — Gmail for Meta Ray-Ban Display Glasses
// Cache-first for app shell, network-first for Gmail API
const CACHE = 'gmail-glasses-v1';
// Relative paths so the app works whether served from a domain root or a
// GitHub Pages subpath (e.g. /ai-glasses-apps/). Resolved against sw.js's URL.
const SHELL  = ['./', './index.html', './style.css', './app.js'];

self.addEventListener('install', e =>
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
);

self.addEventListener('activate', e =>
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
);

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // Network-only for auth and Gmail API (always need fresh data)
  if (url.includes('googleapis.com') || url.includes('accounts.google.com')) {
    e.respondWith(fetch(e.request).catch(() =>
      new Response(JSON.stringify({ error: 'offline' }), { headers: { 'Content-Type': 'application/json' } })
    ));
    return;
  }

  // Cache-first for app shell
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res.ok && e.request.method === 'GET') {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()));
        }
        return res;
      });
    })
  );
});
