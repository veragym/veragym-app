/**
 * 베라짐 PWA Service Worker
 * - 핵심 파일 오프라인 캐싱
 * - 네트워크 우선, 실패 시 캐시 제공
 */

const CACHE_NAME = 'veragym-v1';
const STATIC_ASSETS = [
  '/trainer/trainer-login.html',
  '/trainer/trainer-dash.html',
  '/trainer/exercise-library.html',
  '/trainer/session-write.html',
  '/trainer/member-view.html',
  '/trainer/config.js',
  '/trainer/icons/icon-192.png',
  '/trainer/icons/icon-512.png',
];

// 설치 — 핵심 파일 캐싱
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// 활성화 — 구버전 캐시 정리
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 요청 처리 — 네트워크 우선, 실패 시 캐시
self.addEventListener('fetch', event => {
  // Supabase API 요청은 캐시 건드리지 않음
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // 성공하면 캐시 업데이트
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});
