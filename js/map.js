/* map.js — 지도. 마커와 하루치 동선.
   ─────────────────────────────────────────────────────────────────────────
   좌표는 이미 갖고 있다(구글맵 링크에서 뽑았다). 지도는 **그것을 그리기만 한다.**
   구글맵 JS API 는 붙이지 않는다 — 약관이 자체 호스팅을 막고, 우리는 그럴 이유가 없다.

   ★★래스터(Leaflet) 에서 **벡터(MapLibre GL)** 로 옮겼다. 이유는 하나다: **글자.**
     래스터 타일은 글자가 그림에 구워져 나온다. 그래서 오사카에서는 難波五丁目 로만 나오고
     language 파라미터를 붙여도 응답이 한 바이트도 안 바뀐다(2026-09-01 실측).
     벡터는 글자를 브라우저가 직접 그리므로 text-field 를 한국어로 바꿔칠 수 있다.
     대가: 지도 코드가 43KB → 242KB(gzip) 로 늘고 WebGL 이 필요하다.
     여행 지도에서 지명을 못 읽는 것보다는 그쪽이 낫다.

   ★동선은 **같은 날 안에서만** 잇는다. 3일차 저녁과 4일차 아침을 이으면
     자정에 이동한 것처럼 읽힌다. 날짜를 건너뛰는 선은 그리지 않는다.
   ★선은 직선이다. 실제 도로 경로가 아니다(그건 유료 API 다) — 화면에 그렇게 적는다. */
const Maps = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;


  let map = null, markers = [], route = { type: 'FeatureCollection', features: [] };
  let trip = null, rows = [], days = [], pick = null;
  let spots = [], cur = -1, quiet = false;   // 카드 띠 — quiet 은 되먹임 막기
  /* ★고른 곳을 **id 로** 기억한다. 일정 탭에 갔다 오면 지도 탭이 통째로 다시 그려지는데,
     그때 첫 카드로 되돌아가 버렸다(2026-09-05). 자리(번호)가 아니라 그 곳 자체를
     기억해야 날이 바뀌었는지 돌아온 것인지를 가릴 수 있다. */
  let lastId = null;
  let onPick = () => {};

  /* ── 밑그림 ────────────────────────────────────────────────────────────
     **MapTiler 하나만 쓴다.** 위성도 일반 지도도 거기 다 있고 다크 변형까지 있다.
     ★전에는 Esri 위성 + OSM 지도 + OSM 을 multiply 로 얹은 라벨 흉내까지 셋이 섞여 있었다.
       키가 없어도 돌게 하려던 폴백이었는데 키가 생긴 뒤로는 코드만 복잡하게 만들었다.
     ★그래서 키는 **필수**다. 없거나 막히면 지도가 빈 채로 남으므로 화면에 그렇게 적는다. */
  const MT = (typeof MAPTILER_KEY === 'string' && MAPTILER_KEY.trim()) ? MAPTILER_KEY.trim() : '';
  const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

  /* 고른 조합이 어떤 스타일이 되는가.
       위성 + 길 이름 → hybrid-v4     위성 → satellite-v4
       지도          → streets-v4 / streets-v4-dark (시스템 테마를 따른다)
     ★v4 를 쓴다. v1/v2 는 역·상점 아이콘도 도로 색 구분도 없어서 훨씬 밋밋하다. */
  function styleName() {
    if (base === 'sat') return labels ? 'hybrid-v4' : 'satellite-v4';
    return prefersDark() ? 'streets-v4-dark' : 'streets-v4';
  }
  const styleUrl = () => `https://api.maptiler.com/maps/${styleName()}/style.json?key=${MT}`;

  const KEY = 'trip_basemap', KEY2 = 'trip_maplabels';
  /* ★기본은 '지도' 다. 위성은 어디에 뭐가 있는지는 보여 주지만 뭐가 뭔지는 못 읽는다 —
     일정을 훑는 화면에서는 지명과 도로가 먼저다. 위성은 단추 하나 거리에 있고 고른 것은 기억한다. */
  let base = (() => { try { return localStorage.getItem(KEY) === 'sat' ? 'sat' : 'map'; } catch (e) { return 'map'; } })();
  let labels = (() => { try { const v = localStorage.getItem(KEY2); return v == null ? true : v === '1'; } catch (e) { return true; } })();

  /* ── 라벨을 한국어로 ───────────────────────────────────────────────────
     ★★실측이 먼저다. 오사카 도심 z14 타일을 직접 뜯어 세어 보니(2026-09-01):
          이름 있는 지물 754개 중 name:ko 는 55개(7%), name:en 은 493개(65%).
        국가·도시 줌에서는 name:ko 가 거의 100% 라 넓게 보면 전부 한글로 보이지만
        **골목까지 내려가면 한글은 7%뿐이다.** 그래서 한국어 → 영어 → 현지어로 떨어뜨린다.
        (영어를 한 칸 끼우지 않으면 오사카 골목이 통째로 일본어가 된다. 끼우면 그 자리가
         Nanba 처럼 읽히는 로마자가 된다.)
     ★절차는 MapTiler 가 자기 SDK 에서 하는 것과 같다(maptiler-sdk-js/src/Map.ts):
        · symbol 레이어의 text-field 만 손댄다
        · **원본을 기억해 둔다** — 두 번째 호출이 이미 바꾼 것을 또 바꾸면 안 된다
        · "{name}" 하나면 통째로 치환, "… {name} …" 이면 concat 으로 엮는다
        · 배열(식)이 name 을 참조하면 통째로 치환한다
     ★{ref}·{number} 는 건드리지 않는다 — 국도 방패와 번지수다. */
  const LANG = ['coalesce', ['get', 'name:ko'], ['get', 'name:en'], ['get', 'name']];
  /* ★★**지명은 사전 순서가 다르다**(2026-09-04). 위 순서는 오사카 골목을 위한 것인데,
     그걸 지명에도 쓰면 **한국이 로마자로 뜬다** — 한국 지명은 name:ko 를 안 달아 두는
     곳이 많고(구미·영천·경산) name:en 에는 'Gumi-si' 같은 음차가 들어 있어서, 한글
     name 을 두고 그 음차가 뽑힌다. 정작 일본은 name:ko 가 있어서 한글로 나온다.
   ★그래서 **지명·물·산에서만 name 을 영어보다 앞에 둔다.** 여기서 name 은 그 땅에
     적힌 이름이라, 한국에서는 한글이고 일본에서는 name:ko 가 이미 이겨서 안 쓰인다
     (위 주석의 실측: 도시 줌에서 name:ko 는 거의 100%).
   ★가게 이름(poi)은 그대로 둔다 — 거기서 name 을 앞세우면 오사카 골목이 통째로
     일본어가 된다. 그게 이 순서를 처음 정한 이유다. */
  const LANG_PLACE = ['coalesce', ['get', 'name:ko'], ['get', 'name'], ['get', 'name:en']];
  const PLACE_LAYERS = new Set(['place', 'water_name', 'mountain_peak']);
  const NAME_TOKEN = /\{name(?::[\w-]+)?\}/;
  const original = new window.Map();          // layerId → 원래 text-field

  function localized(tf, lang) {
    if (typeof tf === 'string') {
      if (!NAME_TOKEN.test(tf)) return null;
      if (new RegExp('^' + NAME_TOKEN.source + '$').test(tf)) return lang;
      const parts = tf.split(new RegExp(NAME_TOKEN.source, 'g'));
      const out = ['concat'];
      parts.forEach((p, i) => { out.push(p); if (i < parts.length - 1) out.push(lang); });
      return out;
    }
    if (Array.isArray(tf)) {
      const s = JSON.stringify(tf);
      return (s.includes('"name"') || s.includes('"name:')) ? lang : null;
    }
    return null;
  }

  function localizeLabels() {
    const style = map.getStyle();
    if (!style || !style.layers) return;
    style.layers.forEach(l => {
      if (l.type !== 'symbol' || !l.layout || !('text-field' in l.layout)) return;
      let tf;
      if (original.has(l.id)) tf = original.get(l.id);
      else { tf = map.getLayoutProperty(l.id, 'text-field'); original.set(l.id, tf); }
      const lang = PLACE_LAYERS.has(l['source-layer']) ? LANG_PLACE : LANG;
      const next = tf == null ? null : localized(tf, lang);
      if (next) map.setLayoutProperty(l.id, 'text-field', next);
    });
  }

  /* ── 동선 선 ───────────────────────────────────────────────────────────
     ★스타일을 갈면 소스와 레이어가 **함께 날아간다**(마커는 DOM 이라 남는다).
       그래서 style.load 마다 다시 얹는다. */
  /* ★★`map.isStyleLoaded()` 를 쓰면 **안 된다.** MapTiler 스타일에는 저작자 표시만 담은
     `maptiler_attribution` 소스가 들어 있는데 url 도 tiles 도 없어서 **영원히 로드되지
     않는다.** 그래서 isStyleLoaded() 가 항상 false 고, 여기서 걸러 버리면 동선 선이
     한 번도 안 그려진다(2026-09-01 실측 — 선이 안 나와서 찾았다).
     스타일이 준비됐는지는 style.load 로 직접 센다. */
  let styleReady = false;
  function addRoute() {
    if (!map || !styleReady) return;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2B4ACB';
    if (map.getSource('route')) { map.getSource('route').setData(route); return; }
    map.addSource('route', { type: 'geojson', data: route });
    map.addLayer({
      id: 'route', type: 'line', source: 'route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.75, 'line-dasharray': [1, 3] },
    });
  }

  /* ★실제로 **달라졌을 때만** 갈아 끼운다. open() 이 탭을 열 때마다 부르는데
     같은 스타일을 다시 setStyle 하면 지도가 통째로 다시 그려진다(깜빡인다). */
  let curStyle = '';
  function setBasemap() {
    const el = $('map');
    el.dataset.base = base;
    el.dataset.labels = String(labels);
    const u = styleUrl();
    if (map && u !== curStyle) { curStyle = u; styleReady = false; original.clear(); map.setStyle(u); }
    $('lblbtn').setAttribute('aria-pressed', String(labels));
    $('lblbtn').hidden = base !== 'sat';     // '지도' 에는 원래 라벨이 있다
    document.querySelectorAll('#basepick button[data-base]').forEach(x =>
      x.setAttribute('aria-selected', String(x.dataset.base === base)));
  }

  function ensureMap() {
    if (map) return map;
    if (!MT) { $('map-note').textContent = '지도 키가 없습니다 — js/map-config.js 를 확인하세요.'; return null; }
    try {
      /* ★워커를 **파일로** 준다. 기본 빌드는 워커를 blob: 으로 만들어서 CSP 에
         worker-src blob: 을 열어야 한다. csp 전용 빌드는 그럴 필요가 없다. */
      maplibregl.setWorkerUrl('/js/vendor/maplibre-gl-csp-worker-5.24.0.js');
      curStyle = styleUrl();
      map = new maplibregl.Map({
        container: 'map',
        style: curStyle,
        center: [127.9, 36.5], zoom: 5,
        attributionControl: false,          // 아래에서 접히는 것으로 다시 단다
        /* ★한글·일본어·중국어는 서버 글리프를 받지 않고 **브라우저 글꼴로 그린다.**
           CJK 글리프를 전부 받으면 수십 MB 다. 이 범위만 로컬로 처리하게 맡긴다. */
        localIdeographFontFamily: "'Apple SD Gothic Neo','Noto Sans KR','Malgun Gothic',sans-serif",
      });
    } catch (e) {
      $('map-note').textContent = '이 브라우저에서 지도를 열지 못했습니다 (WebGL 미지원).';
      return null;
    }
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    /* ★저작자 표시는 **지울 수 없다.** MapTiler 약관과 OSM 의 ODbL 이 둘 다 요구한다 —
       지도 데이터가 OpenStreetMap 에서 오기 때문이고 이건 취향이 아니라 라이선스다.
       compact 는 MapLibre 가 공식으로 주는 접힘 모양이다(ⓘ 를 눌러야 펴진다).
       표시는 살아 있고 지도는 안 가린다. 문구는 스타일이 들고 오므로 우리가 적지 않는다. */
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

    map.on('style.load', () => { styleReady = true; localizeLabels(); addRoute(); });
    /* 키가 죽거나 한도를 넘기면 타일이 조용히 안 온다 — 빈 판만 남으면 원인을 알 수 없다 */
    let told = false;
    map.on('error', e => {
      if (told) return; told = true;
      const s = e && e.error && e.error.status;
      $('map-note').textContent = (s === 403 || s === 401)
        ? '지도 타일이 거부됐습니다 — MapTiler 키의 허용 출처를 확인하세요.'
        : '지도 타일을 받지 못했습니다 — 키 또는 사용 한도를 확인하세요.';
    });
    /* 시스템 테마가 바뀌면 '지도' 스타일도 밝고 어두운 것으로 갈아 끼운다 */
    matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (map && base === 'map') setBasemap(); });
    return map;
  }

  /* ★결제 줄(parent_id 가 있는 줄)은 지도에 안 찍는다 — 장소는 부모가 이미 갖고 있어서
     같은 자리에 핀이 겹치고 동선이 제자리를 맴돈다. */
  const withGeo = list => list.filter(r => !r.parent_id && GEO.ok(r));

  function drawTabs() {
    const el = $('mapdays');
    if (!days.length) { el.hidden = true; return; }
    el.hidden = false;
    /* ★'전체' 를 뺐다(2026-09-05). 지도에서 사흘치를 한꺼번에 켜면 핀이 서로를 가리고
       하루 동선이 다른 날 동선과 엉킨다 — 지도는 **하루씩** 보는 물건이다.
       그리고 아래 카드 띠도 하루치여야 넘기는 일이 끝이 있다. */
    el.innerHTML = days.map((d, i) =>
      `<button type="button" role="tab" data-day="${esc(d)}" aria-selected="${String(pick === d)}">Day ${i + 1}</button>`
    ).join('');
  }

  /* ★이름을 마커 위에 **늘 띄운다.** 핀만 있으면 '1번이 어디였더라' 를 확인하러
     일정 탭으로 돌아가게 된다 — 지도를 여는 이유가 그걸 안 하기 위해서다.
     이름표와 핀을 한 요소에 담고, 아래끝을 좌표에 맞춘 뒤 핀 반지름만큼 내린다. */
  function pinEl(r, n, idx) {
    const k = U.kvar(r.kind);
    const el = document.createElement('div');
    el.className = 'mk';
    el.title = r.name;
    el.innerHTML = `<span class="mlbl">${esc(r.name)}</span>`
      + `<span class="mpin${r.done ? ' is-done' : ''}" style="--k: var(--${k})">${n}</span>`;
    /* ★핀을 눌러도 **지도를 안 떠난다**(2026-09-05). 전에는 일정 탭으로 데려갔는데,
       지도를 여는 이유가 그 왕복을 안 하기 위해서였다 — 이제 아래 카드가 그 자리에서
       답한다. 일정으로 가는 길은 카드 안에 단추로 남겨 둔다. */
    el.addEventListener('click', () => select(idx, true));
    return el;
  }

  /* ── 정거장 카드 띠 ─────────────────────────────────────────────────────
     ★지도에 핀만 있으면 '이게 뭐였지' 가 생기고, 그걸 풀려고 일정 탭으로 돌아가게 된다.
       핀 위 이름표가 절반을 풀었고, 이 띠가 나머지를 푼다 — 시각·구분·쓴 돈까지 그 자리에서.
     ★옆으로 넘기면 지도가 따라간다. 목록을 훑는 몸짓과 지도를 훑는 몸짓이 하나가 된다.
     ⚠ 스크롤로 고른 것을 다시 스크롤시키면 되먹임이 돈다 — quiet 로 막는다. */
  function cardHtml(s2, i) {
    const r = s2.r;
    const t = r.at_time ? String(r.at_time).slice(0, 5) : '';
    const cost = (r.cost != null) ? U.money(r.cost, r.cost_cur || (trip && trip.base_cur)) : '';
    const url = r.map_url || GM.placeUrl(r.name);
    return `<article class="mcard" data-i="${i}">
      <span class="mcn" style="--k: var(--${U.kvar(r.kind)})">${s2.n}</span>
      <span class="mcb">
        <span class="mct">${t ? `<em>${esc(t)}</em>` : ''}<b>${esc(r.name)}</b></span>
        <span class="mcm">${esc(r.kind)}${cost ? ` · ${esc(cost)}` : ''}</span>
      </span>
      <span class="mca">
        <a class="act" href="${esc(url)}" target="_blank" rel="noopener">길찾기</a>
        <button class="act" type="button" data-go="${esc(r.id)}">일정</button>
      </span>
    </article>`;
  }

  /* 고른 표시만 옮긴다 — 지도는 안 건드린다 */
  function mark(i) {
    cur = i;
    lastId = spots[i] ? spots[i].r.id : null;
    markers.forEach((m, j) => m.getElement().classList.toggle('is-on', j === i));
    [...$('mstrip').children].forEach((c, j) => c.classList.toggle('is-on', j === i));
  }

  function drawStrip() {
    const el = $('mstrip');
    if (!spots.length) { el.hidden = true; el.innerHTML = ''; cur = -1; return; }
    el.hidden = false;
    el.innerHTML = spots.map(cardHtml).join('');
    /* ★날을 바꾸면 **첫 카드로 되돌린다**(2026-09-05). 안 되돌리면 3일차에서 보던
       자리가 1일차에 그대로 남아, 엉뚱한 카드가 가운데 서 있다.
       ★다만 지도는 안 옮긴다 — 날을 막 열었을 때는 그날 전체가 보여야 하고(fitBounds),
         한 곳으로 파고드는 것은 고른 다음의 일이다. */
    /* 돌아온 것이면 보던 카드로, 날이 바뀐 것이면 첫 카드로 */
    const back = lastId ? spots.findIndex(x => x.r.id === lastId) : -1;
    const i = back >= 0 ? back : 0;
    quiet = true;
    el.scrollLeft = i ? el.children[i].offsetLeft - (el.clientWidth - el.children[i].offsetWidth) / 2 : 0;
    setTimeout(() => { quiet = false; }, 120);
    mark(i);
    return back >= 0;
  }

  /* 가운데에 온 카드를 고른 것으로 본다 */
  function nearest() {
    const el = $('mstrip');
    const mid = el.scrollLeft + el.clientWidth / 2;
    let best = 0, gap = Infinity;
    [...el.children].forEach((c, i) => {
      const d = Math.abs(c.offsetLeft + c.offsetWidth / 2 - mid);
      if (d < gap) { gap = d; best = i; }
    });
    return best;
  }

  function select(i, scroll) {
    if (i < 0 || i >= spots.length) return;
    mark(i);
    const el = $('mstrip');
    if (scroll) {
      /* ⚠ behavior:'smooth' 를 쓰지 않는다. 부드러운 스크롤은 애니메이션 루프가 돌 때만
         움직이는데, 안 돌면 **아무 데도 안 간다** — 조용히 실패한다. 핀을 눌렀는데 띠가
         그대로 있는 것보다 툭 옮겨 가는 편이 낫다(2026-09-05, 실측으로 확인). */
      quiet = true;
      el.scrollLeft = el.children[i].offsetLeft - (el.clientWidth - el.children[i].offsetWidth) / 2;
      setTimeout(() => { quiet = false; }, 120);
    }
    const r = spots[i].r;
    /* 띠가 아래를 가리므로 그만큼 위로 올려 **보이는 곳의 가운데**에 놓는다 */
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const to = { center: [r.lng, r.lat], zoom: Math.max(map.getZoom(), 15.2), offset: [0, -46] };
    if (still) map.jumpTo(to); else map.easeTo(Object.assign({ duration: 420 }, to));
  }

  function draw() {
    if (!ensureMap()) return;
    markers.forEach(m => m.remove());
    markers = [];
    spots = [];

    const show = pick ? [pick] : days;   // pick 은 open() 이 늘 채운다
    const lines = [], pts = [];

    show.forEach(d => {
      const list = rows.filter(r => r.on_date === d);
      const geo = withGeo(list);
      if (!geo.length) return;

      // 하루치 동선 — 이 날 안에서만 잇는다
      if (geo.length > 1) {
        lines.push({
          type: 'Feature', properties: {},
          geometry: { type: 'LineString', coordinates: geo.map(r => [r.lng, r.lat]) },
        });
      }
      geo.forEach((r, i) => {
        pts.push([r.lng, r.lat]);
        const idx = spots.length;
        spots.push({ r: r, n: i + 1 });
        markers.push(new maplibregl.Marker({ element: pinEl(r, i + 1, idx), anchor: 'bottom', offset: [0, 11] })
          .setLngLat([r.lng, r.lat]).addTo(map));
      });
    });

    route = { type: 'FeatureCollection', features: lines };
    addRoute();
    const restored = drawStrip();

    /* 좌표가 없어 지도에서 빠진 일정을 **반드시 적는다.**
       조용히 빠지면 동선이 틀렸다는 것을 알 방법이 없다. */
    /* ★★안내문을 **아예 걷었다**(2026-09-05). 남는 것은 진짜 고장났을 때뿐이다
       (타일이 안 오거나, 이 여행에 좌표가 하나도 없거나 — 아래 두 자리).
       ★'선은 직선입니다' — 늘 켜져 있는 말이고 점선 자체가 이미 그 뜻이다.
       ★'좌표 없는 일정 N' — 정상인 화면에서 매번 뜨는 경고는 곧 안 읽히고, 안 읽히는
         경고는 진짜 문제도 못 알린다. 좌표 없는 장소는 일정 탭에서 지도 단추가 없는
         것으로 이미 드러난다.
       ⚠ 이 말들이 자리를 비운 덕에 날짜 탭이 지도 위로 내려올 수 있었다. */
    const note = $('map-note');
    note.textContent = '';

    if (restored) {
      /* 보던 곳으로 돌아왔으면 그 곳을 다시 잡는다 — 그날 전체로 물러서지 않는다.
         크기를 알려 준 뒤에 옮겨야 가운데가 맞다(아래 resize 와 같은 틱). */
      setTimeout(() => select(cur, false), 0);
    } else if (pts.length) {
      const b = new maplibregl.LngLatBounds();
      pts.forEach(p => b.extend(p));
      map.fitBounds(b, { padding: 36, maxZoom: 16, animate: false });
    } else {
      map.jumpTo({ center: [127.9, 36.5], zoom: 5 });      // 아무것도 없으면 한반도 전체
      note.textContent = '이 여행에는 좌표가 있는 일정이 없습니다 — 구글맵 링크를 붙이면 여기에 찍힙니다';
    }
    /* 탭이 숨어 있는 동안 만들어진 지도는 크기를 0 으로 안다.
       보이게 된 뒤에 한 번 알려 줘야 타일이 제자리에 깔린다. */
    setTimeout(() => map.resize(), 0);
  }

  /* ★크기가 바뀌면 알려 줘야 한다. 컨테이너 크기를 제 안에 기억하고 있어서
     폰을 돌리거나 창을 줄이면 **화면 일부만 그려진 채로 남는다**(2026-09-01 실측).
     자주 오는 이벤트라 한 박자 묶어서 부른다. */
  let rz = 0;
  addEventListener('resize', () => {
    if (!map) return;
    clearTimeout(rz);
    rz = setTimeout(() => map.resize(), 150);
  });

  /* 띠를 넘기면 지도가 따라간다. 손을 뗀 뒤에 판단해야 넘기는 중에 지도가 출렁이지 않는다. */
  let sc = 0;
  $('mstrip').addEventListener('scroll', () => {
    if (quiet) return;
    clearTimeout(sc);
    sc = setTimeout(() => {
      const i = nearest();
      if (i !== cur) select(i, false);
    }, 90);
  }, { passive: true });

  $('mstrip').addEventListener('click', e => {
    const go = e.target.closest('[data-go]');
    if (go) { onPick(go.dataset.go); return; }
    const c = e.target.closest('.mcard');
    if (c) select(+c.dataset.i, true);
  });

  $('basepick').addEventListener('click', e => {
    const b = e.target.closest('button[data-base]');
    if (b && b.dataset.base !== base) {
      base = b.dataset.base;
      try { localStorage.setItem(KEY, base); } catch (err) {}
      setBasemap();
      return;
    }
    if (e.target.closest('#lblbtn')) {
      labels = !labels;
      try { localStorage.setItem(KEY2, labels ? '1' : '0'); } catch (err) {}
      setBasemap();
    }
  });

  $('mapdays').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    pick = b.dataset.day || null;
    drawTabs(); draw();
  });

  return {
    onPick(fn) { onPick = fn; },
    /* plan.js 가 이미 받아 둔 rows 를 그대로 쓴다 — 탭을 옮겼다고 다시 받지 않는다. */
    open(t, list, day) {
      trip = t;
      rows = list || [];
      days = [...new Set(rows.map(r => r.on_date))].sort();
      if (trip && trip.start_on && trip.end_on) {
        const all = [];
        for (let d = trip.start_on; d <= trip.end_on; d = U.addDays(d, 1)) all.push(d);
        days.forEach(d => { if (!all.includes(d)) all.push(d); });
        days = all.sort();
      }
      if (day !== undefined) pick = day;
      if (!pick || !days.includes(pick)) {
        /* 하루만 보는 화면이라 빈 값이 없다. 일정이 있는 첫날로 연다 —
           빈 날로 열면 지도가 아무것도 없는 채로 뜬다. */
        const has = days.filter(d => withGeo(rows.filter(r => r.on_date === d)).length);
        pick = has[0] || days[0] || null;
      }
      drawTabs();
      setBasemap();
      draw();
    },
  };
})();
