/* 세계지도 외곽선 한 줄 만들기 — 빌드 때 한 번 돌리고 결과(js/worldmap.js)만 커밋한다.
   의존성 없음: TopoJSON 을 직접 풀고 밀러 도법도 직접 센다. */
const fs = require('fs');
const T = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

// ── TopoJSON 풀기 (arcs 는 델타 부호화돼 있다)
const { scale: [sx, sy], translate: [tx, ty] } = T.transform;
const arcs = T.arcs.map(a => {
  let x = 0, y = 0;
  return a.map(([dx, dy]) => { x += dx; y += dy; return [x * sx + tx, y * sy + ty]; });
});
const ringOf = idx => {
  const out = [];
  idx.forEach(i => {
    const a = i < 0 ? arcs[~i].slice().reverse() : arcs[i];
    out.push(...(out.length ? a.slice(1) : a));
  });
  return out;
};
const L = T.objects.land;
const geo = L.type === 'GeometryCollection' ? L.geometries[0] : L;
const polys = geo.type === 'MultiPolygon' ? geo.arcs : [geo.arcs];

// ── 밀러 도법. 정거원통(equirectangular)은 고위도가 지나치게 늘어난다.
/* ★★자르지 말고 **가린다.** 위도를 잘라서 좌표를 눌러 붙이면 북극·남극이 납작한 띠로
   변해 지도 위아래에 선이 하나씩 생긴다(2026-09-03에 실제로 그랬다).
   투영은 넉넉한 범위(84N~60S)로 해 두고, 보여 줄 창은 viewBox 로 잘라 낸다 —
   창 밖의 그린란드 북단은 그려지되 안 보일 뿐이다. */
const LAT_N = 84, LAT_S = -60;                 // 투영 범위(넉넉히)
const SHOW_N = 74, SHOW_S = -56;               // 보여 줄 창 — 남극은 아래 ring 필터로 뺀다
const mill = lat => 1.25 * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) * 0.4));
const Y0 = mill(LAT_N), Y1 = mill(LAT_S);
const W = 1000, H = Math.round(W * (Y0 - Y1) / (2 * Math.PI) * 10) / 10;
const px = lng => (lng + 180) / 360 * W;
const py = lat => (Y0 - mill(Math.max(LAT_S, Math.min(LAT_N, lat)))) / (Y0 - Y1) * H;

// ── 고리 넓이(화면 좌표 기준)로 자잘한 섬을 걷는다
const area = r => { let s = 0; for (let i = 0, n = r.length; i < n; i++) { const a = r[i], b = r[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return Math.abs(s) / 2; };
const MIN = +process.argv[3] || 3;             // px^2

/* 점 솎기 + 정수 좌표 + 상대 이동. 1000폭 viewBox 를 343px 에 그리므로 1단위=0.34px 다 —
   3단위(1px) 아래로 붙은 점은 눈에 안 보인다. 소수를 버리고 델타로 적으면 숫자가 짧아진다. */
const THIN = +process.argv[4] || 3;
let d = '', kept = 0, dropped = 0;
const wrapR = [], wrapL = [];
polys.forEach(poly => poly.forEach(ringIdx => {
  const ll = ringOf(ringIdx);
  /* 자르는 대신 **버린다.** 남극을 LAT_S 로 눌러 붙이면 바닥에 납작한 띠가 하나 생긴다
     — 지도가 아니라 선이 된다. 잘림선 밖에 통째로 있는 고리는 그냥 빼 버린다. */
  if (Math.max(...ll.map(q => q[1])) < SHOW_S) { dropped++; return; }
  /* ★★날짜변경선을 넘는 고리(러시아 동쪽 끝, 피지…)는 x 가 1000에서 0으로 튀면서
     지도를 **가로지르는 줄**을 긋는다(2026-09-03에 두 줄이 그어졌다).
     튀는 자리마다 폭을 더하거나 빼서 고리를 이어 붙이고, 넘어간 쪽은 아래에서
     한 벌 더 그린다 — viewBox 가 알아서 잘라 준다. */
  let shift = 0, prev = null;
  const raw = ll.map(([lng, lat]) => {
    let x = px(lng);
    if (prev !== null) {
      if (x - prev > W / 2) shift -= W;
      else if (prev - x > W / 2) shift += W;
    }
    prev = x;
    return [x + shift, py(lat)];
  });
  if (area(raw) < MIN) { dropped++; return; }
  const pts = [];
  raw.forEach((q, i) => {
    const r = [Math.round(q[0]), Math.round(q[1])];
    if (!pts.length) { pts.push(r); return; }
    const a = pts[pts.length - 1];
    if (Math.abs(r[0] - a[0]) + Math.abs(r[1] - a[1]) >= THIN || i === raw.length - 1) pts.push(r);
  });
  if (pts.length < 4) { dropped++; return; }
  kept++;
  let [cx, cy] = pts[0];
  d += `M${cx} ${cy}`;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - cx, dy = pts[i][1] - cy;
    if (!dx && !dy) continue;
    d += dy === 0 ? `h${dx}` : dx === 0 ? `v${dy}` : `l${dx} ${dy}`;
    cx = pts[i][0]; cy = pts[i][1];
  }
  d += 'Z';
  /* 창(0~W) 밖으로 삐져나갔으면 반대쪽에도 한 벌. 지구는 둥그니까. */
  const xs = pts.map(q => q[0]);
  if (Math.min(...xs) < 0) wrapR.push(pts);
  if (Math.max(...xs) > W) wrapL.push(pts);
}));

/* 넘어간 고리를 폭만큼 옮겨 한 번 더 그린다 */
const again = (list, dxAll) => list.forEach(pts => {
  let cx = pts[0][0] + dxAll, cy = pts[0][1];
  d += `M${cx} ${cy}`;
  for (let i = 1; i < pts.length; i++) {
    const nx = pts[i][0] + dxAll, ny = pts[i][1];
    const dx = nx - cx, dy = ny - cy;
    if (!dx && !dy) continue;
    d += dy === 0 ? `h${dx}` : dx === 0 ? `v${dy}` : `l${dx} ${dy}`;
    cx = nx; cy = ny;
  }
  d += 'Z';
});
again(wrapR, W);
again(wrapL, -W);
const vy = Math.round(py(SHOW_N)), vh = Math.round(py(SHOW_S)) - Math.round(py(SHOW_N));
console.error(`고리 ${kept}개 유지 · ${dropped}개 버림 · viewBox 0 ${vy} ${W} ${vh} (${(W/vh).toFixed(2)}:1) · path ${d.length}자`);
process.stdout.write(JSON.stringify({ vb: `0 ${vy} ${W} ${vh}`, w: W, vy, vh, latN: LAT_N, latS: LAT_S, d }));
