// VERA GYM App - Service Worker
const CACHE_NAME = 'veragym-app-v30';
const IMG_CACHE  = 'veragym-app-img-v1'; // 운동 이미지 전용 캐시 (별도 관리)
const MAX_IMG_ENTRIES = 200; // 이미지 캐시 최대 항목 수 (~50MB 기준)

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
  '/veragym-app/image-card.html',
  '/veragym-app/routine-utils.js',
  '/veragym-app/config.js',
  '/veragym-app/manifest.json',
  '/veragym-app/manifest-admin.json',
  '/veragym-app/manifest-member.json',
  '/veragym-app/icons/icon-192.png',
  '/veragym-app/icons/icon-512.png',
  '/veragym-app/icons/icon-admin-192.png',
  '/veragym-app/icons/icon-admin-512.png',
  '/veragym-app/images/anatomy/muscle-front.png',
  '/veragym-app/images/anatomy/muscle-back.png',
  '/veragym-app/images/anatomy/skeleton-front.png',
  '/veragym-app/images/anatomy/skeleton-side.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  const KEEP = new Set([CACHE_NAME, IMG_CACHE]);
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => !KEEP.has(k)).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = e.request.url;

  // ── Supabase Storage 이미지: 캐시 우선 → 없으면 네트워크 + 저장 ──
  // 한번 본 운동 이미지는 기기 캐시에 저장되어 오프라인/느린 네트워크에서도 즉시 표시
  if (url.includes('supabase.co/storage/v1/object/')) {
    e.respondWith(
      caches.open(IMG_CACHE).then(imgCache =>
        imgCache.match(e.request).then(cached => {
          if (cached) return cached; // 캐시 히트 → 즉시 반환
          // 캐시 미스 → 네트워크에서 가져오고 캐시에 저장
          return fetch(e.request).then(res => {
            if (res.ok) {
              imgCache.put(e.request, res.clone()).then(() => {
                // 최대 항목 초과 시 오래된 것부터 제거 (LRU-approximation)
                imgCache.keys().then(keys => {
                  if (keys.length > MAX_IMG_ENTRIES) {
                    keys.slice(0, keys.length - MAX_IMG_ENTRIES).forEach(k => imgCache.delete(k));
                  }
                });
              });
            }
            return res;
          }).catch(() => new Response('', { status: 503 }));
        })
      )
    );
    return;
  }

  // ── 나머지 Supabase API (REST/Auth/Functions/RPC): 네트워크 전용 ──
  if (url.includes('supabase.co')) {
    e.respondWith(fetch(e.request).catch(() => new Response('offline', { status: 503 })));
    return;
  }

  // ── HTML + JS: 네트워크 우선 → 항상 최신 버전 보장, 오프라인 시 캐시 폴백 ──
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

  // ── 아이콘·매니페스트: 캐시 우선 ──
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
