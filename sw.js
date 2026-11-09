/* SIPELLO service worker: syarat aplikasi bisa dipasang (install) di Android.
   Strategi: jaringan dulu, cadangan dari cache. Panggilan API (Apps Script) tidak pernah di-cache. */
const CACHE = 'sipello-v3';
const SHELL = ['./', 'index.html', 'guru.html', 'guru-scripts.js', 'manifest.json', 'logo-emblem.png', 'logo-mgmp.png', 'logo-pemkab.png', 'icon-192.png', 'icon-512.png', 'login-bg.jpg', 'login-bg-mobile.jpg'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL).catch(function () {}); }));
  self.skipWaiting();
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }));
  self.clients.claim();
});
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;           // CDN & Apps Script: biarkan langsung
  e.respondWith(
    fetch(req, { cache: 'no-cache' }).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req).then(function (r) { return r || caches.match('index.html'); }); })
  );
});
