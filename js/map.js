/* map.js — 지도. 마커와 하루치 동선.
   ─────────────────────────────────────────────────────────────────────────
   좌표는 이미 갖고 있다(구글맵 링크에서 뽑았다). 지도는 **그것을 그리기만 한다.**
   그래서 Leaflet + OpenStreetMap 으로 충분하다 — 구글맵 JS API 를 붙이지 않는다.
     · Leaflet 은 자체 호스팅이 된다(구글맵이 약관으로 금지하는 그것). js/vendor/ 에 커밋했다.
     · 마커는 divIcon 으로 직접 그린다 — Leaflet 기본 아이콘 PNG 를 부르지 않는다.
       덕분에 CSP 는 **타일 호스트 하나만** 열면 된다.

   ★동선은 **같은 날 안에서만** 잇는다. 3일차 저녁과 4일차 아침을 이으면
     자정에 이동한 것처럼 읽힌다. 날짜를 건너뛰는 선은 그리지 않는다.
   ★선은 직선이다. 실제 도로 경로가 아니다(그건 유료 API 다) — 화면에 그렇게 적는다. */
const Maps = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  const KVAR = { 숙소: 'k-stay', 식사: 'k-eat', 관광: 'k-see', 이동: 'k-move', 쇼핑: 'k-buy', 기타: 'k-etc' };

  let map = null, layer = null, tiles = null;
  let trip = null, rows = [], days = [], pick = null;
  let onPick = () => {};

  /* ── 밑그림 ────────────────────────────────────────────────────────────
     **MapTiler 하나만 쓴다.** 위성도 일반 지도도 거기 다 있고, 다크 변형까지 있어서
     CSS 필터로 억지로 어둡게 만들 필요가 없다.

     ★전에는 Esri 위성 + OSM 지도 + OSM 을 multiply 로 얹은 라벨 흉내까지 셋이 섞여 있었다.
       키가 없어도 돌게 하려던 폴백이었는데, 키가 생긴 뒤로는 **코드만 복잡하게** 만들었다.
       (그 여정: OSM 기본은 분홍 고속도로가 화면을 갈랐고, CARTO 는 워터마크를 박았고,
        Esri 참조 레이어는 이 지역에서 빈 타일만 줬다. 결론은 '깨끗한 위성+라벨은 공짜가 아니다'.)
     ★그래서 이제 키는 **필수**다. 없거나 막히면 지도가 빈 채로 남으므로,
       조용히 비워 두지 않고 화면에 그렇게 적는다(tileerror). */
  const MT = (typeof MAPTILER_KEY === 'string' && MAPTILER_KEY.trim()) ? MAPTILER_KEY.trim() : '';
  const ATTR = '&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> '
             + '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
  const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

  /* 고른 조합이 어떤 스타일이 되는가.
       위성 + 길이름 → hybrid   (사진 위에 도로·지명이 얹혀 나온다)
       위성          → satellite
       지도          → streets-v2 / streets-v2-dark (시스템 테마를 따른다) */
  /* ★v4 를 쓴다. v1/v2 는 라벨이 **현지 문자**로 나온다(오사카에서 難波五丁目·日本橋) —
     v4 는 로마자로 적어 준다(Nanba·Dotonbori). 한국 사람이 일본을 다닐 때는 그쪽이 읽힌다.
     ★한글은 래스터로 안 된다. 타일에 글자가 구워져 나오고 language 파라미터는 무시된다
       (2026-09-01 실측: 파라미터 유무에 응답 바이트가 동일). 벡터로 가야 바꿀 수 있다. */
  function styleName() {
    if (base === 'sat') return labels ? 'hybrid-v4' : 'satellite';
    return prefersDark() ? 'streets-v2-dark' : 'streets-v4';
  }

  const KEY = 'trip_basemap', KEY2 = 'trip_maplabels';
  let base = (() => { try { return localStorage.getItem(KEY) === 'map' ? 'map' : 'sat'; } catch (e) { return 'sat'; } })();
  let labels = (() => { try { const v = localStorage.getItem(KEY2); return v == null ? true : v === '1'; } catch (e) { return true; } })();

  function setBasemap() {
    const el = $('map');
    el.dataset.base = base;
    el.dataset.labels = String(labels);
    if (tiles) map.removeLayer(tiles);

    if (!MT) { $('map-note').textContent = '지도 키가 없습니다 — js/map-config.js 를 확인하세요.'; }
    else {
      /* ★글자를 키운다: **@2x 타일을 512px 칸에 z-1 로 깐다.**
         래스터 타일은 글자 크기가 그림에 구워져 있어 CSS 로 못 키운다. 대신 한 단계 낮은
         배율의 레티나 타일을 두 배 칸에 깔면 같은 땅을 보면서 글자만 커진다.
         (대가: 아주 높은 배율에서 세부가 한 단계 덜 나온다. 여행 지도에서 필요한 것은
          '어디쯤인가' 라 그 교환이 맞다.) */
      tiles = L.tileLayer(`https://api.maptiler.com/maps/${styleName()}/{z}/{x}/{y}@2x.png?key=${MT}`, {
        maxZoom: 20,
        tileSize: 512,
        zoomOffset: -1,
        attribution: ATTR,
        /* ★★타일에만 출처를 보낸다. vercel.json 의 `Referrer-Policy: same-origin` 은
           다른 도메인으로 나가는 요청에 Referer 를 아예 안 붙이고, MapTiler 는 출처로
           키를 검증하므로 'Invalid key' 가 뜬다(2026-09-01 에 그렇게 막혔다 —
           curl 로는 헤더를 손으로 넣어서 200 이 왔다).
           요소별 정책이 문서 정책을 이긴다. 오리진만 가고 **경로는 안 간다** —
           여행 id 가 든 주소가 새어 나가지 않는다. */
        referrerPolicy: 'strict-origin-when-cross-origin',
      });
      /* 키가 죽거나 한도를 넘기면 타일이 조용히 안 온다 — 빈 판만 남으면 원인을 알 수 없다 */
      let told = false;
      tiles.on('tileerror', () => {
        if (told) return; told = true;
        $('map-note').textContent = '지도 타일을 받지 못했습니다 — 키 또는 사용 한도를 확인하세요.';
      });
      tiles.addTo(map);
    }

    foldAttribution();
    $('lblbtn').setAttribute('aria-pressed', String(labels));
    $('lblbtn').hidden = base !== 'sat';     // '지도' 에는 원래 라벨이 있다
    document.querySelectorAll('#basepick button[data-base]').forEach(x =>
      x.setAttribute('aria-selected', String(x.dataset.base === base)));
  }

  /* ★저작자 표시는 **지울 수 없다.** MapTiler 약관과 OSM 의 ODbL 이 둘 다 요구한다 —
     지도 데이터가 OpenStreetMap 에서 오기 때문이고, 이건 취향이 아니라 라이선스다.
     대신 **ⓘ 로 접어 둔다.** 눌러야 펴진다 — 표시는 살아 있고 지도는 안 가린다.
     (Mapbox·MapTiler 의 공식 SDK 도 좁은 화면에서 같은 모양을 쓴다.)
     ★Leaflet 이 레이어를 갈 때마다 이 칸을 다시 그리므로 setBasemap 끝에서 다시 건다. */
  function foldAttribution() {
    const ac = map && map.attributionControl && map.attributionControl.getContainer();
    if (!ac || ac.dataset.folded) return;
    ac.dataset.folded = '1';
    ac.classList.add('attr-fold');
    const i = document.createElement('button');
    i.type = 'button'; i.className = 'attr-i'; i.textContent = 'ⓘ';
    i.setAttribute('aria-label', '지도 저작자 표시 보기');
    i.addEventListener('click', ev => { ev.stopPropagation(); ac.classList.toggle('open'); });
    ac.insertBefore(i, ac.firstChild);
  }

  function ensureMap() {
    if (map) return map;
    /* ★한 손가락으로도 끌 수 있게 둔다. 전에는 페이지 스크롤이 지도에 걸리는 것을 막으려고
       폰에서 dragging 을 껐는데, 그러면 **지도가 고장난 것처럼** 느껴진다 —
       위성 지도는 끌고 확대하라고 있는 것이다. 페이지는 지도 위아래 여백으로 스크롤한다. */
    map = L.map('map', { zoomControl: true, attributionControl: true });
    /* ★'Leaflet' 앞머리를 뗀다. Leaflet 은 그것을 **요구하지 않는다**(예의로 붙는 것이고
       공식적으로 끄는 방법을 준다). 저작자 표시는 두 줄로 넘어가면 지도를 덮으므로
       **의무인 것만** 남긴다 — MapTiler 와 OpenStreetMap. 둘 다 링크를 유지한다. */
    map.attributionControl.setPrefix(false);
    layer = L.layerGroup().addTo(map);
    setBasemap();
    /* 시스템 테마가 바뀌면 '지도' 쪽 회색조도 따라가야 한다 */
    /* 시스템 테마가 바뀌면 '지도' 스타일도 밝고 어두운 것으로 갈아 끼운다 */
    matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (map && base === 'map') setBasemap(); });
    return map;
  }

  const withGeo = list => list.filter(r => GEO.ok(r));

  function drawTabs() {
    const el = $('mapdays');
    if (!days.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = days.map((d, i) =>
      `<button type="button" role="tab" data-day="${esc(d)}" aria-selected="${String(pick === d)}">D${i + 1}</button>`
    ).join('') +
      `<button type="button" role="tab" data-day="" aria-selected="${String(pick === null)}">전체</button>`;
  }

  function pinIcon(r, n) {
    const k = KVAR[r.kind] || 'k-etc';
    return L.divIcon({
      className: '',                       // Leaflet 기본 클래스를 비운다(흰 사각형이 생긴다)
      html: `<span class="mpin${r.done ? ' is-done' : ''}" style="--k: var(--${k})">${n}</span>`,
      iconSize: [22, 22],
      iconAnchor: [11, 11],
    });
  }

  function draw() {
    ensureMap();
    layer.clearLayers();

    const show = pick ? [pick] : days;
    const pts = [];
    let missing = 0;

    show.forEach(d => {
      const list = rows.filter(r => r.on_date === d);
      missing += list.length - withGeo(list).length;
      const geo = withGeo(list);
      if (!geo.length) return;

      // 하루치 동선 — 이 날 안에서만 잇는다
      if (geo.length > 1) {
        L.polyline(geo.map(r => [r.lat, r.lng]), {
          color: getComputedStyle(document.documentElement).getPropertyValue('--route').trim() || '#2B4ACB',
          weight: 2.5, opacity: .75, dashArray: '1 6', lineCap: 'round',
        }).addTo(layer);
      }
      geo.forEach((r, i) => {
        pts.push([r.lat, r.lng]);
        /* ★이름을 마커 위에 **늘 띄운다.** 핀만 있으면 '1번이 어디였더라' 를 확인하러
           일정 탭으로 돌아가게 된다 — 지도를 여는 이유가 그걸 안 하기 위해서다.
           permanent 툴팁은 pointer-events 를 받지 않으므로 지도를 끄는 데 방해되지 않는다. */
        L.marker([r.lat, r.lng], { icon: pinIcon(r, i + 1), keyboard: true, title: r.name })
          .addTo(layer)
          .bindTooltip(esc(r.name), {
            permanent: true, direction: 'top', offset: [0, -13],
            className: 'mlbl', opacity: 1,
          })
          .on('click', () => onPick(r.id));
      });
    });

    /* 좌표가 없어 지도에서 빠진 일정을 **반드시 적는다.**
       조용히 빠지면 동선이 틀렸다는 것을 알 방법이 없다. */
    const note = $('map-note');
    const parts = [];
    if (missing) parts.push(`좌표 없는 일정 ${missing} — 지도에 없습니다`);
    if (pts.length > 1) parts.push('선은 직선입니다 (실제 이동 경로가 아닙니다)');
    note.textContent = parts.join(' · ');

    if (pts.length) {
      map.fitBounds(L.latLngBounds(pts), { padding: [36, 36], maxZoom: 16 });
    } else {
      map.setView([36.5, 127.9], 6);      // 아무것도 없으면 한반도 전체
      note.textContent = '이 여행에는 좌표가 있는 일정이 없습니다 — 구글맵 링크를 붙이면 여기에 찍힙니다';
    }
    /* 탭이 숨어 있는 동안 만들어진 지도는 크기를 0 으로 안다.
       보이게 된 뒤에 한 번 알려 줘야 타일이 제자리에 깔린다. */
    setTimeout(() => map.invalidateSize(), 0);
  }

  /* ★크기가 바뀌면 알려 줘야 한다. Leaflet 은 컨테이너 크기를 제 안에 기억하고 있어서,
     폰을 돌리거나 창을 줄이면 **타일이 일부만 깔린 채로 남는다**(2026-09-01 실측 — 화면의
     3분의 1만 그려졌다). 그림이 깨진 것처럼 보이는데 원인은 크기 정보 하나다.
     자주 오는 이벤트라 한 박자 묶어서 부른다. */
  let rz = 0;
  addEventListener('resize', () => {
    if (!map) return;
    clearTimeout(rz);
    rz = setTimeout(() => map.invalidateSize(), 150);
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
      if (pick && !days.includes(pick)) pick = null;
      drawTabs();
      draw();
    },
  };
})();
