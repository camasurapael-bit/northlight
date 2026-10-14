/* Northlight service worker: makes the app installable and lets the shell open offline.
   Network first for pages and scripts (so updates show immediately), cache as fallback.
   /api/* and anything cross-origin (Firebase, Google) is never cached. */
const CACHE = 'northlight-v2';
const SHELL = ['/', '/index.html', '/styles.css', '/js/store.js', '/js/app.js', '/js/admin.js', '/js/auth.js', '/js/cloud.js', '/js/theme.js', '/js/i18n.js', '/manifest.webmanifest', '/icons/icon-192.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(hit => hit || caches.match('/index.html')))
  );
});
