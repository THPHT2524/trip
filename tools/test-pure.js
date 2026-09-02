#!/usr/bin/env node
/* 순수 함수 회귀 — 무빌드·무의존.  node tools/test-pure.js
 *
 * js/geo.js 와 js/gmaps.js 는 DOM 도 네트워크도 타지 않는다. 그래서 화면 없이 확인할 수 있고,
 * 확인할 수 있으니 확인한다. 이 둘이 이 앱에서 가장 조용히 틀릴 수 있는 코드다 —
 * 좌표를 잘못 뽑아도 화면은 멀쩡해 보이고 핀만 엉뚱한 곳에 찍힌다.
 */
const GEO = require('../js/geo.js');
const GM  = require('../js/gmaps.js');
const API = require('../api/gmaps.js');   // canonical() 만 쓴다

let pass = 0, fail = 0;
const eq = (got, want, msg) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.log(`  x ${msg}\n      받음 ${JSON.stringify(got)}\n      기대 ${JSON.stringify(want)}`); }
};
const near = (got, want, tol, msg) => {
  const ok = got != null && Math.abs(got - want) <= tol;
  if (ok) pass++; else { fail++; console.log(`  x ${msg}\n      받음 ${got}  기대 ${want}±${tol}`); }
};

// ── GEO ────────────────────────────────────────────────────────────────
// 오사카성 → 도톤보리. 손으로 낸 직선 약 3.06km (dLat 2.07km · dLng 2.25km)
near(GEO.dist({lat:34.6873,lng:135.5259}, {lat:34.6687,lng:135.5013}), 3062, 40, '오사카성→도톤보리 직선거리');
eq(GEO.dist({lat:0,lng:0}, {lat:0,lng:0}), 0, '같은 점은 0');
eq(GEO.dist(null, {lat:0,lng:0}), null, '한쪽이 없으면 null');
eq(GEO.dist({lat:0,lng:0}, {lat:200,lng:0}), null, '범위 밖이면 null');
// 적도에서 경도 1도 ≈ 111.3km
near(GEO.dist({lat:0,lng:0}, {lat:0,lng:1}), 111319, 300, '적도 경도 1도');

eq(GEO.label(0), '0m', '0m');
eq(GEO.label(423), '420m', '1km 미만은 10m 단위');
eq(GEO.label(940), '940m', '950 미만은 m');
eq(GEO.label(999), '1.0km', '★999m 는 1000m 가 아니라 1.0km 다');
eq(GEO.label(3160), '3.2km', '10km 미만은 소수점 한 자리');
eq(GEO.label(38400), '38km', '10km 이상은 정수');
eq(GEO.label(null), '', '없으면 빈 문자열');

eq(GEO.ok({lat:34.6,lng:135.5}), true, '정상 좌표');
eq(GEO.ok({lat:34.6}), false, 'lng 없음');
eq(GEO.ok({lat:'34.6',lng:135}), false, '문자열은 안 받는다');

// ★사람이 읽을 이름이 아닌 것을 장소명에 넣지 않는다
eq(GM.parse('https://www.google.com/maps/place/?q=place_id:ChIJN1t_tDeuEmsRUsoyG83frY4'), null,
   '★place_id 는 이름이 아니다 — 좌표도 없으면 실패로 본다');
eq(GM.parse('https://www.google.com/maps/search/?api=1&query=%EC%98%A4%EC%82%AC%EC%B9%B4%EC%84%B1').name,
   '오사카성', '한글 장소명은 그대로 읽는다');

// ── MONEY: 현금 지갑 ────────────────────────────────────────────────────
// ★환전은 지출이 아니다(돈을 바꾼 것뿐). 그 현금으로 산 것이 지출이다.
// ★여러 번 뽑으면 환율이 다르다 — 보유 현금의 **가중평균**으로 센다.
const MONEY = require('../js/money.js');
const row = (o) => ({ id: o.id, cost: o.c, cost_cur: o.cur || 'JPY', fx: o.fx ?? null, settle: o.s ?? null });

// ₩470,000 → ¥50,000 (9.4원/엔) 을 뽑고 ¥1,000 짜리를 현금으로 먹었다
{
  const r = [ row({id:'x', c:50000, fx:9.4, s:'exchange'}), row({id:'a', c:1000, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(Math.round(t.sum), 9400, '★현금 결제는 환전 환율로 — ¥1,000 = ₩9,400');
  eq(t.cnt, 1, '★환전은 지출 건수에 안 들어간다');
  eq(Math.round(t.cash.bal), 49000, '지갑에 ¥49,000 남는다');
  eq(Math.round(t.cash.rate * 100) / 100, 9.4, '남은 돈의 환율도 9.4');
}
// 두 번 나눠 뽑으면 평균 환율로 센다 (¥50,000@9.4 + ¥50,000@10.0 → 9.7)
{
  const r = [ row({id:'e1', c:50000, fx:9.4, s:'exchange'}),
              row({id:'e2', c:50000, fx:10,  s:'exchange'}),
              row({id:'a',  c:10000, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(Math.round(t.sum), 97000, '★가중평균 9.7원/엔 — 마지막 환율(10)도 첫 환율(9.4)도 아니다');
  eq(Math.round(t.cash.bal), 90000, '지갑 ¥90,000');
}
// 지갑이 모자라면 지어내지 않는다
{
  const r = [ row({id:'e', c:1000, fx:9.4, s:'exchange'}), row({id:'a', c:5000, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(t.miss, 1, '★안 적은 환전이 있으면 그 줄은 모른다고 남긴다');
  eq(t.sum, 0, '모르는 줄은 합계에 안 들어간다');
}
// 사람이 적은 환율이 언제나 이긴다
{
  const r = [ row({id:'e', c:50000, fx:9.4, s:'exchange'}), row({id:'a', c:1000, fx:12, s:'cash'}) ];
  eq(MONEY.total(r).sum, 12000, '★fx 를 직접 적었으면 지갑보다 그게 먼저다');
}
// 카드(기본)는 지갑을 건드리지 않는다
{
  const r = [ row({id:'e', c:50000, fx:9.4, s:'exchange'}), row({id:'a', c:1000, fx:8.7}) ];
  const t = MONEY.total(r);
  eq(t.sum, 8700, '카드는 제 환율로');
  eq(Math.round(t.cash.bal), 50000, '★카드로 긁어도 현금은 그대로 있다');
}
// 원화로 낸 줄은 환율이 필요 없다
eq(MONEY.total([row({id:'a', c:30000, cur:'KRW'})]).sum, 30000, '원화 결제는 그대로');
eq(MONEY.SETTLE, 'KRW', '정산 통화는 원화');

/* ★★id 없는 줄을 넘기면 셈이 조용히 부푼다 — per 맵의 키가 전부 undefined 라
   한 칸에 덮어써지고, 합계가 '마지막 줄 × 줄 수' 가 된다.
   실제로 DB.trips.shape() 가 id 를 안 골라서 홈 카드에 ₩1,132,209(실제 ₩621,366)가
   떴다(2026-09-02). 셈을 부르는 쪽이 id 를 빠뜨리지 못하게 여기서 못박는다. */
{
  const withId = [row({id:'a', c:10000, cur:'KRW'}), row({id:'b', c:20000, cur:'KRW'})];
  eq(MONEY.total(withId).sum, 30000, 'id 가 있으면 줄마다 따로 센다');
  const noId = withId.map(r => { const x = { ...r }; delete x.id; return x; });
  eq(MONEY.total(noId).sum !== 30000, true,
     '★id 가 없으면 합계가 틀린다 — 부르는 쪽이 id 를 꼭 골라야 한다는 뜻');
}
/* ★하루 띠·홈 카드·비용 탭이 **같은 rows 집합**을 세는지. 장소 줄만 세면 결제 줄에
   붙은 돈이 통째로 빠진다 — 실제로 하루 띠가 ₩595,238 → ₩177,238 로 떨어졌다. */
{
  const parent = row({ id: 'p', c: null, cur: 'KRW' });
  const kid = { ...row({ id: 'k', c: 428000, cur: 'KRW' }), parent_id: 'p' };
  const stopsOnly = [parent];
  eq(MONEY.total(stopsOnly).sum, 0, '장소 줄만 세면 0 — 그 자리 돈은 결제 줄에 있다');
  eq(MONEY.total([parent, kid]).sum, 428000, '★결제 줄까지 세야 하루 합계가 맞는다');
}
/* 부르는 쪽 세 곳이 실제로 id 를 고르는지 원문에서 확인한다 (셈은 맞는데 입력이 빠지는 사고) */
{
  const src = require('fs').readFileSync(require('path').join(__dirname, '../js/db.js'), 'utf8');
  const sel = (src.match(/shape:\s*async[\s\S]*?\.select\('([^']+)'\)/) || [])[1] || '';
  eq(sel.split(',').includes('id'), true, '★DB.trips.shape() 는 id 를 골라야 한다');
}

// ── MONEY.shares: 각자 냄은 **인원(qty)** 으로 나눈다 ────────────────────
// ★동행자 수로 나누면 셋 중 둘만 기차를 탄 경우가 틀어진다.
{
  const crew = ['A', 'B', 'C'];
  // 셋이 각자 카드로 찍었다 → 셋에게 하나씩
  eq(MONEY.shares({ split: true, qty: 3 }, 9000, crew).map(s => [s.id, s.krw]),
     [['A',3000],['B',3000],['C',3000]], '★인원 = 동행자 수면 각자에게 붙는다');
  // 셋 중 둘만 탔다 → 누구였는지 모른다. 지어내지 않는다
  eq(MONEY.shares({ split: true, qty: 2 }, 6000, crew), [{ id: null, group: 2, krw: 6000 }],
     '★인원이 동행자 수와 다르면 누구인지 모른다 — 한 칸으로 남긴다');
  // 각자 냄이 아니면 낸 사람 하나
  eq(MONEY.shares({ payer_id: 'A' }, 5000, crew), [{ id: 'A', krw: 5000 }], '보통 줄은 낸 사람에게');
  eq(MONEY.shares({}, 5000, crew), [{ id: null, krw: 5000 }], '안 적었으면 주인 없음');
}

// ── U: 정산 통화 ───────────────────────────────────────────────────────
const U = require('../js/util.js');
eq(U.SETTLE, 'KRW', '정산 통화는 원화 하나 — 여행의 base_cur 는 현지통화다');

// ── api/gmaps.js: 단축 링크 정규화 (SSRF 방어선) ────────────────────────
// ★폰 공유 링크에는 추적 파라미터가 붙는다. 전에 이걸 403 으로 막아서
//   **폰에서 붙여넣은 링크는 자동 채움이 한 번도 안 됐다.**
const C = API.canonical;
eq(C('https://maps.app.goo.gl/AbCd1234'), 'https://maps.app.goo.gl/AbCd1234', '기본형');
eq(C('https://maps.app.goo.gl/AbCd1234?g_st=ic'), 'https://maps.app.goo.gl/AbCd1234', '★iOS 공유 파라미터를 버린다');
eq(C('https://maps.app.goo.gl/AbCd1234?g_st=iw'), 'https://maps.app.goo.gl/AbCd1234', '★안드로이드 공유 파라미터');
eq(C('https://maps.app.goo.gl/AbCd1234/?utm_source=x#f'), 'https://maps.app.goo.gl/AbCd1234', '★끝 슬래시·조각도 버린다');
eq(C('https://goo.gl/maps/AbCd1234?x=1'), 'https://goo.gl/maps/AbCd1234', '옛 단축 형식');
eq(C('http://maps.app.goo.gl/AbCd1234'), null, 'http 는 안 받는다');
eq(C('https://maps.app.goo.gl.evil.com/AbCd1234'), null, '★호스트를 앞에 붙인 사칭');
eq(C('https://maps.app.goo.gl/AbCd1234/../../x'), null, '경로 탈출');
eq(C('https://evil.com/maps/AbCd1234'), null, '남의 호스트');
eq(C('https://maps.app.goo.gl/ab'), null, '너무 짧은 코드');
eq(C('https://www.google.com/maps/place/X'), null, '전체 URL 은 서버가 안 받는다 (브라우저가 파싱한다)');

// ── GM: 전체 URL ───────────────────────────────────────────────────────
// ★핵심 — @ 는 지도 중심이고 !3d/!4d 가 핀이다. 둘이 다른 URL 로 확인한다.
const full = 'https://www.google.com/maps/place/%EC%98%A4%EC%82%AC%EC%B9%B4%EC%84%B1/'
           + '@34.6800000,135.5100000,15z/data=!3m1!4b1!4m6!3m5!1s0x6000e0f2:0x2'
           + '!8m2!3d34.6873153!4d135.5259!16s%2Fg%2F11c';
const r1 = GM.parse(full);
eq(r1.name, '오사카성', '장소명을 디코딩한다');
eq(r1.lat, 34.6873153, '★@ 가 아니라 !3d 를 쓴다');
eq(r1.lng, 135.5259,   '★@ 가 아니라 !4d 를 쓴다');
eq(r1.approx, false, '핀 좌표라 approx 아님');

// 이름에 `+` 와 홑따옴표가 들어오는 경우 (해외 구성종목처럼 실제로 온다)
const r2 = GM.parse("https://www.google.com/maps/place/McDonald's+Dotonbori/@34.66,135.50,17z/data=!8m2!3d34.6688!4d135.5010");
eq(r2.name, "McDonald's Dotonbori", '+ 는 공백, 홑따옴표는 그대로 (이스케이프는 화면의 몫)');
eq(r2.lat, 34.6688, '홑따옴표가 있어도 좌표는 뽑는다');

// !3d 쌍이 여럿일 때 !8m2 블록을 고른다
const many = 'https://www.google.com/maps/place/X/@1,1,10z/data=!3d11.1!4d22.2!8m2!3d33.3!4d44.4';
eq(GM.parse(many).lat, 33.3, '!8m2 블록을 먼저 고른다');

// 핀이 없으면 @ 로 떨어지되 approx 를 세운다
const r3 = GM.parse('https://www.google.com/maps/@34.6937,135.5023,15z');
eq(r3.lat, 34.6937, '핀이 없으면 @ 를 쓴다');
eq(r3.approx, true, '★그때는 approx — 화면이 그렇게 적어야 한다');
eq(r3.name, null, '이름 없음');

// ?q= / ?query=
eq(GM.parse('https://www.google.com/maps/search/?api=1&query=34.6873%2C135.5259').lat, 34.6873, 'query 의 좌표');
eq(GM.parse('https://maps.google.com/?q=Osaka+Castle').name, 'Osaka Castle', 'q 의 이름');

// ── GM: 단축 링크 ──────────────────────────────────────────────────────
eq(GM.needsServer('https://maps.app.goo.gl/AbCd1234'), true, '단축 링크는 서버가 필요');
eq(GM.parse('https://maps.app.goo.gl/AbCd1234'), { needsServer: true, url: 'https://maps.app.goo.gl/AbCd1234' }, '단축은 펼치지 않고 넘긴다');
eq(GM.needsServer('https://www.google.com/maps/place/X/@1,1,10z'), false, '전체 URL 은 서버 불필요');

// ── GM: 좌표 붙여넣기 · 실패 ───────────────────────────────────────────
eq(GM.parse('34.6873, 135.5259'), { name: null, lat: 34.6873, lng: 135.5259, approx: false, url: null }, '좌표만 붙여넣기');
eq(GM.parse('그냥 메모'), null, '지도 링크가 아니면 null');
eq(GM.parse(''), null, '빈 문자열');
eq(GM.parse('https://naver.me/abc'), null, '남의 지도는 안 받는다');
eq(GM.parse('https://www.google.com/maps/place//@,,17z'), null, '이름도 좌표도 없으면 null');

// ── GM: URL 만들기 ─────────────────────────────────────────────────────
eq(GM.dirUrl({lat:34.6873,lng:135.5259}, {lat:34.6687,lng:135.5013}),
   'https://www.google.com/maps/dir/?api=1&origin=34.6873,135.5259&destination=34.6687,135.5013',
   '길찾기 URL');
eq(GM.dirUrl({lat:34.6,lng:135.5}, null), null, '한쪽이 없으면 길찾기도 없다');
eq(GM.placeUrl({ map_url: 'https://maps.app.goo.gl/Z', lat: 1, lng: 2 }),
   'https://maps.app.goo.gl/Z', '★원본 링크가 있으면 그것을 연다 (파싱이 틀렸어도 원본은 맞다)');
eq(GM.placeUrl({ lat: 34.6873, lng: 135.5259 }),
   'https://www.google.com/maps/search/?api=1&query=34.6873%2C135.5259', '원본이 없으면 좌표로 연다');
eq(GM.placeUrl({}), null, '좌표도 링크도 없으면 열 곳이 없다');

// ── ───────────────────────────────────────────────────────────────────
console.log(fail
  ? `\nFAIL - ${pass} 통과 / ${fail} 실패`
  : `PASS - ${pass}개 전부 통과`);
process.exit(fail ? 1 : 0);
