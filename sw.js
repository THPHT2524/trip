/* sw.js — 앱 껍데기를 미리 받아 둔다. 현지에서 끊겨도 **앱이 열려야** 한다.
   ─────────────────────────────────────────────────────────────────────────
   무엇을 캐시하나: HTML·CSS·JS·폰트, 즉 **바뀌지 않는 것**만.
   무엇을 안 하나:
     · 일정 데이터 — 그건 outbox.js 가 localStorage 에 둔다(서비스워커가 손댈 이유가 없다).
     · 지도 타일 — MapTiler 약관이 대량 캐시를 권하지 않는다. 오프라인에서 지도는 포기한다.
     · /api/* — 프록시 응답은 세션에 달려 있다. 캐시하면 남의 응답이 나갈 수 있다.
       (/api/more 만은 세션과 무관하지만 **날마다 바뀌는 환율**이라 역시 안 잡는다 —
        어제 고시로 오늘 999 를 맞추면 조용히 틀린다.)

   ★V 를 올려야 새 파일이 나간다. index.html 의 ?v=N 과 함께 올린다.
     안 올리면 이미 받아 간 브라우저가 옛 앱을 계속 쓴다(card-dashboard 에서 실제로 겪은 사고다).

   ★★아래 SHELL 은 **index.html·themore.html 이 싣는 것을 하나도 빠짐없이** 담아야 한다.
     `/js/fx.js` 가 빠져 있었다(2026-09-10에 찾았다). 빠져도 평소에는 안 드러난다 —
     아래 fetch 핸들러가 받아온 것을 캐시에 넣어 주므로 온라인으로 한 번만 열면 채워진다.
     드러나는 자리는 **버전을 올린 직후 처음 여는 곳이 오프라인일 때** 하나뿐이다:
     `?v=` 가 바뀌면 새 URL 이라 캐시에 없는데 install 이 미리 받는 목록에도 없으니
     그 파일만 못 온다. FXS 가 없으면 plan.js 의 reload() 가 거기서 죽어 일정 탭이
     통째로 안 뜬다 — 이 서비스워커를 둔 이유가 그 상황 하나인데 그 상황에서만 깨졌다.
   ★손으로 지키지 않는다. tools/bump.py 의 shell_gap() 이 페이지와 이 목록을 맞대 보고
     빠진 것이 있으면 **아무것도 안 고치고 멈춘다.** */
const V = 536;   // assets-sha:e5c11a57a370
const CACHE = `trip-shell-v${V}`;

const SHELL = [
  '/',
  '/index.html',
  /* 홈 화면 아이콘 한 벌. ?v 가 안 붙는다(vercel.json 이 immutable 로 주는 것은
     /js·/css·/fonts 뿐이다) — 대신 배포마다 V 가 오르므로 캐시가 통째로 갈린다. */
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/themore',
  '/themore.html',
  '/css/app.css?v=536',
  '/css/maplibre-gl-5.24.0.css',
  '/js/vendor/supabase-js-2.111.0.js',
  '/js/vendor/maplibre-gl-csp-5.24.0.js',
  '/js/vendor/maplibre-gl-csp-worker-5.24.0.js',
  '/js/supabase-config.js?v=536',
  '/js/map-config.js?v=536',
  '/js/money.js?v=536',
  '/js/more.js?v=536',
  '/js/themore.js?v=536',
  '/js/util.js?v=536',
  '/js/worldmap.js?v=536',
  '/js/geo.js?v=536',
  '/js/gmaps.js?v=536',
  '/js/db.js?v=536',
  '/js/fx.js?v=536',
  '/js/outbox.js?v=536',
  '/js/plan.js?v=536',
  '/js/map.js?v=536',
  '/js/crew.js?v=536',
  '/js/cost.js?v=536',
  '/js/app.js?v=536',
  '/fonts/ibm-plex-mono-400.woff2?v=536',
  '/fonts/ibm-plex-mono-500.woff2?v=536',
  '/fonts/ibm-plex-mono-600.woff2?v=536',
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
  if (url.pathname.startsWith('/api/')) return;        // 세션에 달렸거나 날마다 바뀐다

  /* 경로 탭(/t/<id>...)은 문서를 달라는 것이다 — 껍데기를 준다.
     서버 리라이트와 같은 판단이라 오프라인에서도 새로고침이 살아 있다. */
  /* ★★**기다리는 데에 끝을 둔다**(2026-09-17). 전에는 fetch 가 던질 때까지 기다렸는데,
     완전히 끊기면 곧바로 던지지만 **느리고 끊길락 말락 한 연결**에서는 브라우저 기본
     시한까지 매달린다 — 현지에서 흔한 것이 바로 그 연결이고, 껍데기는 이미 다 받아
     둔 마당이다. 손에 있는 것을 두고 몇십 초를 기다리는 셈이었다.
   ★3초다. 껍데기가 이미 로컬에 있으므로 그보다 오래 기다려서 얻는 것은 '더 새것'
     하나뿐인데, 문서가 새것인지는 서비스워커가 따로 갱신하며 이미 보고 있다.
   ★시한을 넘겨도 **네트워크를 버리지 않는다.** 캐시에 없으면 그때는 원래 기다리던
     그것을 마저 기다린다 — 시한은 빨리 보여 주기 위한 것이지 포기하려는 것이 아니다. */
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const shell = async () =>
        (await caches.match('/index.html')) || (await caches.match('/')) || null;
      const net = fetch(req);
      net.catch(() => {});          // 캐시로 답해도 이 약속이 미처리로 남지 않게
      try {
        return await Promise.race([
          net,
          new Promise((_, no) => setTimeout(() => no(new Error('slow')), 3000)),
        ]);
      } catch (err) {
        const hit = await shell();
        if (hit) return hit;
        try { return await net; } catch (e2) { return Response.error(); }
      }
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
