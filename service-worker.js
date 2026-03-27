// VERA GYM App - Service Worker
const CACHE_NAME = 'veragym-app-v1';
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
  const url = e.request.url;

  // Supabase API: 네트워크 전용 (캐시 불가)
  if (url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }

  // HTML + JS: 네트워크 우선 → 항상 최신 버전 보장, 오프라인 시 캐시 폴백
  // (매번 캐시 버전을 올리지 않아도 코드 변경이 즉시 반영됨)
  const isHtmlOrJs = url.includes('/veragym-app/') &&
    (url.endsWith('.html') || url.endsWith('.js') || url.endsWith('/veragym-app/'));

  if (isHtmlOrJs) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
          }
          return res;
        })
        .catch(() => caches.match(e.request))
    );
    return;
  }

  // 아이콘·매니페스트: 캐시 우선 (거의 변경 없음)
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
