/* sw.js — 앱 껍데기를 미리 받아 둔다. 현지에서 끊겨도 **앱이 열려야** 한다.
   ─────────────────────────────────────────────────────────────────────────
   무엇을 캐시하나: HTML·CSS·JS·폰트, 즉 **바뀌지 않는 것**만.
   무엇을 안 하나:
     · 일정 데이터 — 그건 outbox.js 가 localStorage 에 둔다(서비스워커가 손댈 이유가 없다).
     · 지도 타일 — MapTiler 약관이 대량 캐시를 권하지 않는다. 오프라인에서 지도는 포기한다.
     · /api/* — 프록시 응답은 세션에 달려 있다. 캐시하면 남의 응답이 나갈 수 있다.

   ★V 를 올려야 새 파일이 나간다. index.html 의 ?v=N 과 함께 올린다.
     안 올리면 이미 받아 간 브라우저가 옛 앱을 계속 쓴다(card-dashboard 에서 실제로 겪은 사고다). */
const V = 78;   // assets-sha:c11b9d92d729
const CACHE = `trip-shell-v${V}`;

const SHELL = [
  '/',
  '/index.html',
  '/css/app.css?v=78',
  '/css/maplibre-gl-5.24.0.css',
  '/js/vendor/supabase-js-2.111.0.js',
  '/js/vendor/maplibre-gl-csp-5.24.0.js',
  '/js/vendor/maplibre-gl-csp-worker-5.24.0.js',
  '/js/supabase-config.js?v=78',
  '/js/map-config.js?v=78',
  '/js/money.js?v=78',
  '/js/util.js?v=78',
  '/js/geo.js?v=78',
  '/js/gmaps.js?v=78',
  '/js/db.js?v=78',
  '/js/outbox.js?v=78',
  '/js/plan.js?v=78',
  '/js/map.js?v=78',
  '/js/crew.js?v=78',
  '/js/cost.js?v=78',
  '/js/prep.js?v=78',
  '/js/app.js?v=78',
  '/fonts/ibm-plex-mono-400.woff2',
  '/fonts/ibm-plex-mono-500.woff2',
  '/fonts/ibm-plex-mono-600.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    /* 하나가 404 여도 나머지는 받는다 — addAll 은 하나만 실패해도 전부 버린다.
       배포 직후 파일 하나가 늦게 올라오는 일이 있어서 통째로 실패하면 껍데기가 통째로 없다. */
    await Promise.all(SHELL.map(u => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 타일·Supabase 는 손대지 않는다
  if (url.pathname.startsWith('/api/')) return;        // 세션에 달린 응답은 캐시하지 않는다

  /* 경로 탭(/t/<id>...)은 문서를 달라는 것이다 — 껍데기를 준다.
     서버 리라이트와 같은 판단이라 오프라인에서도 새로고침이 살아 있다. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try { return await fetch(req); }
      catch (err) { return (await caches.match('/index.html')) || (await caches.match('/')) || Response.error(); }
    })());
    return;
  }

  /* 자산은 캐시 우선 — ?v 로 버전을 박아 두었으므로 낡을 수가 없다.
     (내용이 바뀌면 ?v 가 바뀌고, 그러면 다른 URL 이라 새로 받는다.) */
  e.respondWith((async () => {
    const hit = await caches.match(req);
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok) { const c = await caches.open(CACHE); c.put(req, res.clone()); }
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
