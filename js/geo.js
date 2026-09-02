/* geo.js — 좌표로 계산하는 것만. 여기에는 DOM 도 네트워크도 없다.
   구글맵 URL 을 읽고 쓰는 일은 gmaps.js 가 맡는다 — 이 파일은 순수 산수다.

   왜 따로 두나: 정거장 사이에 적히는 거리는 이 앱의 서명인데, 그 값이 맞는지는
   화면 없이 확인할 수 있어야 한다(tools/test-pure.js 가 그렇게 한다). */
const GEO = (function () {

  const R = 6371008.8;          // 지구 평균 반지름(m) — IUGG 평균반지름
  const rad = d => d * Math.PI / 180;

  /* 두 지점의 **직선거리**(m). 하버사인.
     ★도로 거리가 아니다. 트리플은 경로 API 로 실제 이동거리를 내므로 값이 다르다 —
       화면에 '직선' 이라고 적어서 그 차이를 숨기지 않는다. */
  function dist(a, b) {
    if (!ok(a) || !ok(b)) return null;
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 +
              Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
  }

  /* 좌표 한 쌍이 쓸 만한가. lat/lng 가 뒤바뀐 것까지는 못 잡는다(둘 다 유효 범위일 수 있다). */
  function ok(p) {
    return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng)
        && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;
  }

  /* 사람이 읽는 거리.
     ★1km 미만은 m 로, 10m 단위로 끊는다 — 걸어서 갈 거리에 3m 는 뜻이 없다.
     ★10km 넘으면 소수점을 버린다 — '38.4km' 의 .4 는 직선거리에서 의미가 없다.
     ★경계는 1000 이 아니라 **950** 이다. 1000 으로 두면 999m 가 반올림되어 '1000m' 로
       나온다 — 자릿수가 넷인 m 표기는 km 로 적어야 할 것을 안 적은 것이다. */
  function label(m) {
    if (m == null || !Number.isFinite(m)) return '';
    if (m < 950) return Math.round(m / 10) * 10 + 'm';
    if (m < 10000) return (Math.round(m / 100) / 10).toFixed(1) + 'km';
    return Math.round(m / 1000) + 'km';
  }

  /* ★좌표를 R 미터 안에서 묶어 **몇 군데였나**를 센다. 여행에 '도시' 칸이 없으므로
     장소가 몰려 있는 덩어리를 하나로 본다 — 오사카 여행이면 간사이공항·오사카·교토 셋이다.
     ★이웃 병합이다(한 점이 닿으면 같은 덩어리). 완전연결이 아니라 사슬처럼 이어지지만,
       도시 사이가 수십 km 씩 떨어진 여행에서는 그 차이가 안 난다.
     ★R 은 10~30km 어디로 잡아도 이 여행에서 같은 답(3)이 나왔다(2026-09-02). 15km 로 둔다. */
  function areas(pts, meters) {
    const list = (pts || []).filter(ok);
    const R = meters || 15000;
    const seen = new Set();
    let n = 0;
    list.forEach((p, i) => {
      if (seen.has(i)) return;
      n += 1;
      const q = [i]; seen.add(i);
      for (let k = 0; k < q.length; k++) {
        list.forEach((c, j) => {
          if (seen.has(j)) return;
          const d = dist(list[q[k]], c);
          if (d != null && d <= R) { q.push(j); seen.add(j); }
        });
      }
    });
    return n;
  }

  return { dist, label, ok, areas };
})();

if (typeof module !== 'undefined') module.exports = GEO;   // tools/test-pure.js 용
