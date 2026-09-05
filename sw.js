/**
 * sw.js — offline shell.
 *
 * The app itself is cached so it opens with no signal at all. API calls are
 * never cached: the entries live in IndexedDB, and a stale cached response
 * pretending to be fresh is worse than an honest offline state.
 */
const CACHE = 'carelog-v8';

const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'js/store.js',
  'js/units.js',
  'js/push.js',
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

// Resolved once, so the fetch handler can tell a shell file from anything
// else by pathname rather than by guessing at URL shapes.
const SHELL_PATHS = new Set(
  SHELL.map(p => new URL(p, self.registration.scope).pathname)
);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.origin !== location.origin) {
    if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
      e.respondWith(staleWhileRevalidate(req));
    }
    return;
  }

  // ONLY the shell is cached. Everything else on this origin goes straight
  // to the network, untouched.
  //
  // This matters more than it looks: if the sync worker is ever routed
  // under the same domain as the app, a cache-first rule would serve a
  // stale /auth/me or /sync forever and the log would quietly stop
  // updating — with no error anywhere, because a cache hit looks like a
  // perfectly good 200.
  const isShell = req.mode === 'navigate' || SHELL_PATHS.has(url.pathname);
  if (!isShell) return;

  // Shell: cache first. It barely changes and open speed matters here.
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


// ── Push ───────────────────────────────────────────────────────────────────
//
// The push carries no payload, so this reads the context out of IndexedDB
// and fetches what is unanswered. Content never passes through the push
// service; only the fact that something happened does.

function readPushCtx() {
  return new Promise(resolve => {
    const q = indexedDB.open('carelog');
    q.onsuccess = e => {
      try {
        const g = e.target.result.transaction('kv', 'readonly')
                   .objectStore('kv').get('pushCtx');
        g.onsuccess = () => resolve(g.result || null);
        g.onerror   = () => resolve(null);
      } catch { resolve(null); }
    };
    q.onerror = () => resolve(null);
  });
}

self.addEventListener('push', event => {
  event.waitUntil((async () => {
    const ctx = await readPushCtx();

    // userVisibleOnly means a notification is REQUIRED for every push. If
    // the fetch fails, show something plain rather than nothing — a silent
    // drop gets the subscription revoked by the browser.
    let title = 'New check-in';
    let body  = 'Someone let you know how they are feeling.';
    let tag   = 'checkin';

    if (ctx?.base && ctx?.session && ctx?.rid) {
      try {
        const res = await fetch(`${ctx.base}/r/${ctx.rid}/unanswered`, {
          headers: { Authorization: `Bearer ${ctx.session}` },
        });
        if (res.ok) {
          const { entries } = await res.json();
          if (entries?.length) {
            const first = entries[0];
            title = `${first.authorName || 'They'} checked in`;
            body  = entries.length === 1
              ? String(first.kind || '').replace(/^(feel|body|cause)_/, '').replace(/_/g, ' ')
              : `${entries.length} check-ins waiting`;
            tag   = first.id;
          }
        }
      } catch { /* fall through to the plain notification */ }
    }

    await self.registration.showNotification(title, {
      body,
      tag,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      renotify: false,
      requireInteraction: false,
      data: { url: './?checkin=1' },
    });
  })());
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || './';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if ('focus' in c) { await c.focus(); c.postMessage({ type: 'checkin-open' }); return; }
    }
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});
