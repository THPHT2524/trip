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

  let map = null, layer = null, tiles = null, over = null;
  let trip = null, rows = [], days = [], pick = null;
  let onPick = () => {};

  /* ── 밑그림 ────────────────────────────────────────────────────────────
     **기본은 위성이다.** 여행 지도에서 알고 싶은 것은 '거기가 어떻게 생겼나' 이고,
     항공사진은 그 답을 라벨 없이 준다 — 덤으로 우리 마커가 확실히 앞에 선다.
     ★Esri World Imagery 는 **키도 결제도 필요 없다.** 저작자 표시만 하면 된다.
     ★'지도' 로 바꾸면 OSM 을 회색조로 눌러 쓴다. 길 이름과 역이 필요할 때가 있다.
       OSM 기본 스타일을 그대로 쓰지 않는 이유는 그것이 지도 자체를 읽으라고 만든 것이라
       고속도로가 분홍 리본으로 화면을 가르기 때문이다(회색조 처리는 css/app.css).
     ★CARTO Positron 을 잠깐 썼다가 되돌렸다(2026-09-01): 지금은 API 키를 요구해서
       타일에 'API KEY REQUIRED' 워터마크가 박혀 나온다. curl 로는 200 이 와서 되는 줄 알았다 —
       **상태코드만 보고 넘긴 확인이었다.** 키 없는 타일은 눈으로 봐야 한다. */
  const BASE = {
    sat: {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      max: 19,
      attr: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
    },
    map: {
      url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      max: 19,
      attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    },
  };
  const KEY = 'trip_basemap', KEY2 = 'trip_maplabels';
  let base = (() => { try { return localStorage.getItem(KEY) === 'map' ? 'map' : 'sat'; } catch (e) { return 'sat'; } })();
  /* 라벨 오버레이는 **기본 꺼짐**이다. 켜면 길 이름이 보이지만 사진이 어두워지고 지저분해진다 —
     필요할 때만 켜는 편이 맞다. 고른 것은 기억한다. */
  let labels = (() => { try { return localStorage.getItem(KEY2) === '1'; } catch (e) { return false; } })();

  const prefersDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

  function setBasemap() {
    const el = $('map');
    el.dataset.base = base;
    el.dataset.dark = String(prefersDark());
    el.dataset.labels = String(labels);
    if (tiles) map.removeLayer(tiles);
    if (over) { map.removeLayer(over); over = null; }
    const b = BASE[base];
    tiles = L.tileLayer(b.url, { maxZoom: b.max, attribution: b.attr }).addTo(map);
    /* ★라벨 오버레이 — Esri 의 참조 레이어(World_Transportation 등)는 이 지역에서
       **완전히 투명한 타일**만 준다(2026-09-01 실측: 어느 배율에서도 875바이트 = 빈 타일).
       그래서 OSM 을 위에 얹고 **혼합 모드로 흰 배경을 걷어낸다** — 선과 글자만 남는다.
       위성일 때만 뜻이 있다('지도' 는 그 자체가 OSM 이다). */
    if (base === 'sat' && labels) {
      over = L.tileLayer(BASE.map.url, {
        maxZoom: BASE.map.max, className: 'lblover', opacity: 1,
      }).addTo(map);
    }
    $('lblbtn').setAttribute('aria-pressed', String(labels));
    $('lblbtn').hidden = base !== 'sat';
    /* ★bringToFront() 를 부르지 않는다. layer 는 LayerGroup 이라 그 메서드가 없다 —
       불렀다가 ensureMap 이 통째로 죽어 타일이 한 장도 안 깔렸다(2026-09-01).
       애초에 필요 없다: Leaflet 은 마커·오버레이 판을 타일 판 위에 둔다. */
    document.querySelectorAll('#basepick button').forEach(x =>
      x.setAttribute('aria-selected', String(x.dataset.base === base)));
  }

  function ensureMap() {
    if (map) return map;
    /* ★한 손가락으로도 끌 수 있게 둔다. 전에는 페이지 스크롤이 지도에 걸리는 것을 막으려고
       폰에서 dragging 을 껐는데, 그러면 **지도가 고장난 것처럼** 느껴진다 —
       위성 지도는 끌고 확대하라고 있는 것이다. 페이지는 지도 위아래 여백으로 스크롤한다. */
    map = L.map('map', { zoomControl: true, attributionControl: true });
    layer = L.layerGroup().addTo(map);
    setBasemap();
    /* 시스템 테마가 바뀌면 '지도' 쪽 회색조도 따라가야 한다 */
    matchMedia('(prefers-color-scheme: dark)')
      .addEventListener('change', () => { if (map) $('map').dataset.dark = String(prefersDark()); });
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
        L.marker([r.lat, r.lng], { icon: pinIcon(r, i + 1), keyboard: true, title: r.name })
          .addTo(layer)
          .bindTooltip(`${esc(r.name)}${r.at_time ? ' · ' + esc(r.at_time.slice(0, 5)) : ''}`,
                       { direction: 'top', offset: [0, -12] })
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
