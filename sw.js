const CACHE = 'gurogu-v4';
const STATIC = ['/index.html', '/manifest.json', '/gurogu-market-logo.png'];

// 설치 시 정적 파일 즉시 캐시 (파일 하나 실패해도 설치 중단되지 않도록 개별 캐싱)
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then(cache =>
      Promise.all(STATIC.map(url => cache.add(url).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
});

// 활성화 시 구 캐시 삭제
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// fetch 가로채기 — stale-while-revalidate
// 캐시에 있으면 즉시 반환 + 백그라운드에서 최신본 업데이트
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // 외부 요청(Supabase, Cloudflare Worker, CDN 등)은 그냥 통과
  if (url.origin !== self.location.origin) return;
  // GET 요청만 캐시 처리
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.open(CACHE).then(cache =>
      cache.match(e.request).then(cached => {
        const networkFetch = fetch(e.request)
          .then(response => {
            if (response.ok) cache.put(e.request, response.clone());
            return response;
          })
          .catch(() => cached); // 오프라인이면 캐시 반환

        // 캐시 있으면 즉시 반환하고 백그라운드에서 업데이트
        return cached || networkFetch;
      })
    )
  );
});

// 백그라운드 푸시 수신 (앱이 닫혀있을 때)
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || '구로구마켓';
  const options = {
    body: data.body || '',
    icon: '/gurogu-market-logo.png',
    badge: '/gurogu-market-logo.png',
    data: data,
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// 알림 클릭 시 앱 열기 + 해당 상품/후기로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const itemId = event.notification.data?.itemId || '';
  const openUrl = itemId ? `/?noti=${encodeURIComponent(itemId)}` : '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // 앱이 이미 열려 있으면 포커스 + postMessage로 이동 지시
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.focus();
          if (itemId) client.postMessage({ type: 'NOTI_NAV', itemId });
          return;
        }
      }
      // 앱이 닫혀 있으면 URL 파라미터로 열기
      if (clients.openWindow) return clients.openWindow(openUrl);
    })
  );
});
