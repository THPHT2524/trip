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

  let map = null, layer = null;
  let trip = null, rows = [], days = [], pick = null;
  let onPick = () => {};

  function ensureMap() {
    if (map) return map;
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true,
      // 폰에서 한 손가락으로 페이지를 스크롤하다 지도에 걸려 멈추는 것을 막는다.
      // 지도를 옮기려면 두 손가락(또는 마우스 드래그)을 쓴다.
      dragging: !L.Browser.mobile,
      tap: false,
    });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // ODbL 이 요구하는 저작자 표시다. 지우지 말 것.
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
    if (L.Browser.mobile) {
      // 두 손가락으로만 움직인다는 사실을 알려 주지 않으면 '지도가 고장났다' 로 읽힌다
      map.on('movestart', () => {});
      L.DomUtil.addClass(map.getContainer(), 'two-finger');
    }
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
