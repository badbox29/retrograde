/**
 * sw.js — offline shell.
 *
 * The app itself is cached so it opens with no signal at all. API calls are
 * never cached: the entries live in IndexedDB, and a stale cached response
 * pretending to be fresh is worse than an honest offline state.
 */
const CACHE = 'carelog-v2';

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/store.js',
  'js/api.js',
  'js/packs.js',
  'js/sync.js',
  'js/ui.js',
  'js/app.js',
  'manifest.webmanifest',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept the worker or Google's endpoints.
  if (url.origin !== location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // Shell: cache first, it barely changes and speed matters more here.
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => caches.match('index.html')))
  );
});

function staleWhileRevalidate(req) {
  return caches.open(CACHE).then(c =>
    c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res.ok) c.put(req, res.clone()); return res; })
                            .catch(() => hit);
      return hit || net;
    })
  );
}
