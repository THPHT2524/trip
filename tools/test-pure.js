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
