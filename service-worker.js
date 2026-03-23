// VERA GYM App - Service Worker
const CACHE_NAME = 'veragym-v6';
const STATIC = [
  '/veragym-app/',
  '/veragym-app/index.html',
  '/veragym-app/admin-login.html',
  '/veragym-app/admin.html',
  '/veragym-app/trainer-login.html',
  '/veragym-app/trainer-dash.html',
  '/veragym-app/session-write.html',
  '/veragym-app/exercise-library.html',
  '/veragym-app/member-view.html',
  '/veragym-app/config.js',
  '/veragym-app/manifest.json',
  '/veragym-app/manifest-member.json',
  '/veragym-app/icons/icon-192.png',
  '/veragym-app/icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Supabase API는 항상 네트워크 우선
  if (e.request.url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }
  // 정적 파일은 캐시 우선
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
