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
const U   = require('../js/util.js');
const MORE = require('../js/more.js');
const MORE_API = require('../api/more.js');

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

/* ── 나라·도시는 **사람이 적는다** ─────────────────────────────────────────
   전에는 통화에서 나라를 유추하고 좌표를 15km 로 묶어 도시를 어림했다. 간사이공항이
   오사카·교토와 나란히 '한 지역' 으로 서는 것을 막을 반경이 없었다(공항 35km·교토 42km,
   그 7km 창은 간사이에만 맞는 값). 어림을 다듬는 대신 한 번 적는 쪽으로 갔다. */
eq(U.flag('JP'), '🇯🇵', '나라코드로 국기를 찾는다');
eq(U.flag('ZZ'), '', '모르는 나라는 국기 없음 — 지어내지 않는다');
eq(U.flag(''), '', '안 적었으면 국기 없음');
eq(U.countryName('TW'), '대만', '나라 이름');
eq(U.guessCountry('JPY'), 'JP', '통화로 나라를 미리 골라 준다');
eq(U.guessCountry('EUR'), '', '★유로는 나라가 하나가 아니다 — 비워 둔다');
eq(U.guessCountry('USD'), '', '★달러도 미국 밖에서 쓴다 — 비워 둔다');
eq(U.cityList('오사카, 교토'), ['오사카', '교토'], '쉼표로 나눈다');
eq(U.cityList(' 오사카 · 교토 , '), ['오사카', '교토'], '가운뎃점도, 앞뒤 공백도 걷는다');
eq(U.cityList(''), [], '안 적었으면 없음');
eq(U.cityList(null), [], 'null 도 없음');
/* 나라 목록은 코드가 두 글자 대문자여야 한다 — 표의 제약과 같은 규칙(place.sql) */
eq(U.COUNTRY.every(([c, n, f]) => /^[A-Z]{2}$/.test(c) && n && f), true,
   '★나라 목록의 코드는 전부 두 글자 대문자');
eq(new Set(U.COUNTRY.map(c => c[0])).size, U.COUNTRY.length, '나라코드가 겹치지 않는다');
/* ★한 여행이 두 나라를 걸치는 일이 있다(방콕+프놈펜) — 나라는 쉼표로 이은 목록이다.
   자동으로 뽑는 길도 재 봤지만(MapTiler 역지오코딩) 도시는 못 쓴다:
   간사이공항이 '다지리초' 로 나와서 좌표로 묶던 것과 같은 답이 된다. 나라만 확실하다. */
eq(U.codeList('JP,TH'), ['JP', 'TH'], '쉼표로 이은 나라');
eq(U.flags('JP,TH'), ['🇯🇵', '🇹🇭'], '국기도 여럿');
eq(U.codeList(' jp , TH , JP '), ['JP', 'TH'], '소문자·공백·중복을 걷는다');
/* ★★모르는 코드를 **버리지 않는다.** 이 목록이 고르개의 값을 되읽는 데도 쓰여서,
   아직 새 util.js 를 안 받은 브라우저로 여행 설정을 열었다 저장하면 그 나라가
   말없이 지워졌다 — 실제로 'MV,AE' 가 'AE' 가 됐다(2026-09-02). */
eq(U.codeList('JP,ZZ,TH'), ['JP', 'ZZ', 'TH'], '★모르는 코드도 값으로는 남는다');
eq(U.flags('JP,ZZ,TH'), ['🇯🇵', '🇹🇭'], '국기는 아는 것만 그린다');
eq(U.codeList('MV, aE , 대한민국, X, TOOLONG'), ['MV', 'AE'],
   '모양이 안 맞는 것만 버린다 — 표의 제약과 같은 규칙');
eq(U.codeList(''), [], '안 적었으면 없음');
eq(U.flags(null), [], 'null 도 없음');

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
// 사람이 적은 환율이 값을 정한다 — 그래도 현금은 주머니에서 나간다
{
  const r = [ row({id:'e', c:50000, fx:9.4, s:'exchange'}), row({id:'a', c:1000, fx:12, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(t.sum, 12000, '★fx 를 직접 적었으면 얼마로 칠지는 그게 먼저다');
  eq(Math.round(t.cash.bal), 49000,
     '★★그래도 지갑에서는 나간다 — 환율은 값을 정하지 돈이 나갔나를 정하지 않는다');
  eq(Math.round(t.cash.rate * 100) / 100, 9.4,
     '남은 돈의 평균은 안 흔들린다 — 원가는 지갑 환율로 뗀다');
}
/* 실제로 겪은 것: ¥4,000 환전 → ¥970 현금(환율 채워짐) → 남은 돈이 ¥4,000 그대로였다 */
{
  const r = [ row({id:'e', c:4000, fx:8.6245, s:'exchange'}),
              row({id:'a', c:970,  fx:8.6245, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(Math.round(t.cash.bal), 3030, '★¥4,000 에서 ¥970 을 쓰면 ¥3,030 이 남는다');
  eq(Math.round(t.sum), 8366, '¥970 = ₩8,366');
}
// 지갑이 못 대는 현금(잔액 부족)은 적어 둔 환율로 친다
{
  const r = [ row({id:'e', c:500, fx:9.4, s:'exchange'}), row({id:'a', c:1000, fx:12, s:'cash'}) ];
  const t = MONEY.total(r);
  eq(t.sum, 12000, '지갑이 모자라면 적어 둔 환율로');
  eq(Math.round(t.cash.bal), 500, '못 뗐으니 지갑은 그대로');
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

/* 센트가 있는 돈은 센트까지 — $116.37 이 $116 으로 보이면 영수증과 대조가 안 된다 */
eq(U.money(116.37, 'USD'), '$116.37', '★달러는 센트까지');
eq(U.money(116, 'USD'), '$116', '센트가 0 이면 .00 을 달지 않는다');
eq(U.money(1234.567, 'USD'), '$1,234.57', '셋째 자리는 반올림');
eq(U.money(12.5, 'EUR'), '€12.5', '유로도 센트가 있다');
eq(U.money(1960, 'JPY'), '¥1,960', '엔은 소수점을 쓰지 않는다');
eq(U.money(8366.4, 'KRW'), '₩8,366', '원도 소수점을 쓰지 않는다 — 반올림');
eq(U.money(50000, 'VND'), '₫50,000', '동도 정수');
eq(U.money(null, 'USD'), '', '값이 없으면 빈 문자열');

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
  const cols = (re) => ((src.match(re) || [])[1] || '').split(',');
  const pick = {
    shape: cols(/shape:\s*async[\s\S]*?\.select\('([^']+)'\)/),
    /* ★`const trips = {` 부터 찾는다 — items.list 도 같은 이름이라 그냥 찾으면 남의 것을 문다 */
    list: cols(/const trips = \{[\s\S]*?list:\s*async[\s\S]*?\.select\('([^']+)'\)/),
  };
  eq(pick.shape.includes('id'), true, '★DB.trips.shape() 는 id 를 골라야 한다');
  /* ★칸 목록을 손으로 적는 자리라 표에 칸을 더하면 여기가 뒤처진다 — 실제로 두 번 그랬다
     (shape 의 id, list 의 country·cities). 화면이 쓰는 칸을 여기서 못 박는다. */
  ['id', 'name', 'start_on', 'end_on', 'base_cur', 'country', 'cities', 'owner_id']
    .forEach(c => eq(pick.list.includes(c), true, `★DB.trips.list() 는 ${c} 를 골라야 한다`));
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
eq(U.SETTLE, 'KRW', '정산 통화는 원화 하나 — 여행의 base_cur 는 현지통화다');

// ── U: 장소구분 범례 ────────────────────────────────────────────────────
// ★app·plan·map·cost 네 파일에 같은 표가 복사돼 있던 것을 util 로 모았다(2026-09-03).
//   다시 흩어지면 한 화면에서만 색이 어긋나므로, **네 파일에 사본이 없는지** 여기서 지킨다.
eq(U.KINDS.length, 6, '장소구분은 여섯');
eq(U.KINDS.join(','), '숙소,식사,관광,이동,쇼핑,기타', '범례의 차례까지 고정 — 비용 화면이 이 차례로 센다');
U.KINDS.forEach(k => eq(/^k-[a-z]+$/.test(U.kvar(k)), true, `${k} 에 색 이름이 있다`));
eq(U.kvar('식사'), 'k-eat', '식사는 k-eat');
eq(U.kvar('없는구분'), 'k-etc', '모르는 구분은 k-etc 로 떨어진다 — 색 없는 점을 찍지 않는다');
{
  const fs = require('fs'), path = require('path');
  const copies = ['app.js', 'plan.js', 'map.js', 'cost.js'].filter(f =>
    /^\s*const\s+(KVAR|KINDS)\s*=/m.test(
      fs.readFileSync(path.join(__dirname, '../js/' + f), 'utf8')));
  eq(copies.length, 0, `★범례 사본이 다시 생기지 않았다 (생겼다면: ${copies.join(' ') || '없음'})`);
}

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

/* ── MORE: 더모아 ──────────────────────────────────────────────────────
   ★★기대값을 **손으로 짓지 않았다.** 2026-09-03 themore.app 이 화면에 띄운 표를 그대로
     옮겨 적은 것이다(신한 1회차 1,382.50 · 매매기준율 1,369.40 · 비자 JPY 0.0063175122).
     한 번은 기대값을 지어냈다가 멀쩡한 코드를 틀렸다고 판정할 뻔했다 — 출처가 있는
     숫자만 여기 둔다.
   ★버림이 세 번 들어가는 셈이라 **원 단위로** 맞아야 한다. 근사로는 999 경계를 못 지킨다. */
const TT = 1382.5, MID = 1369.4, JPY = 0.0063175122;

// 사이트 USD 표(보정 0%) — [긁을 금액, 청구금액]
const MUSD = [[4.29,5996],[5.00,6993],[5.71,7991],[6.42,8987],[7.15,9998],[7.86,10996],
  [8.57,11993],[9.28,12990],[9.99,13973],[10.72,14998],[11.43,15995],[12.14,16993],
  [12.85,17989],[13.57,18987],[14.29,19998],[15.00,20995],[15.71,21993],[16.42,22989],
  [17.14,23986],[17.86,24998],[18.57,25995],[19.28,26991],[19.99,27975],[20.71,28986],
  [21.43,29997],[22.14,30995],[22.85,31991],[23.57,32989],[24.28,33986],[25.00,34997]];
// 사이트 JPY 표(보정 3%) — [긁을 금액, 청구금액, 수익률]
const MJPY = [[659,5990,29.7],[768,6989,24.6],[877,7988,20.8],[988,8986,17.9],[1099,9999,15.8],
  [1208,10997,13.9],[1317,11996,12.2],[1428,12995,10.9],[1537,13993,9.7],[1647,14991,8.7],
  [1756,15990,7.8],[1867,16989,7.1],[1976,17987,6.3],[2085,18986,5.7],[2196,19999,5.2],
  [2305,20997,4.7],[2416,21996,4.3],[2525,22994,3.8],[2634,23993,3.4],[2743,24992,3.0],
  [2854,25990,2.8],[2963,26988,2.4],[3073,27987,2.2],[3182,28986,1.9],[3294,29999,1.7],
  [3404,30997,1.5],[3513,31995,1.3],[3622,32994,1.0],[3733,33993,0.9],[3842,34992,0.7]];

eq(MORE.targets().length, 30, '표는 서른 줄 — 5,999원부터 34,999원까지');
eq(MORE.targets()[0], 5999, '첫 줄은 5,999원');

let mu = 0, mj = 0;
MORE.targets().forEach((t, i) => {
  const s1 = MORE.solve(t, 1, TT, 'USD', 0);
  if (s1 && s1.foreign === MUSD[i][0] && MORE.bill(s1.foreign, 1, TT, MID).krw === MUSD[i][1]) mu++;
  const s2 = MORE.solve(t, JPY, TT, 'JPY', 3);
  const b2 = s2 && MORE.bill(s2.foreign, JPY, s2.rate, MID);
  if (s2 && s2.foreign === MJPY[i][0] && b2.krw === MJPY[i][1]
      && b2.gain.toFixed(1) === MJPY[i][2].toFixed(1)) mj++;
});
eq(mu, 30, '★USD 서른 줄이 themore.app 실측과 원 단위로 같다 (보정 0%)');
eq(mj, 30, '★JPY 서른 줄이 실측과 같다 — 결제외화·청구금액·수익률 (보정 3%)');

/* ★★수수료를 소수로 두면 여기가 깨진다. `1.011 * 1000` 은 float 에서 1010.9999… 라
   센트 한 자리가 밀리고, 서른 줄 중 딱 두 줄만 조용히 틀렸었다.
   10.00 USD 는 5,000원대가 아니라 **14,001원**이라 13,999 를 넘는다 — 그래서 답이 9.99 다. */
eq(MORE.bill(10, 1, TT, MID).krw, 14001, '★10.00 USD 는 14,001원 (버림 자리가 밀리면 13,987 이 나온다)');
eq(MORE.solve(13999, 1, TT, 'USD', 0).foreign, 9.99, '★13,999원 목표의 답은 10.00 이 아니라 9.99');

const b = MORE.bill(4.29, 1, TT, MID);
eq([b.krw, b.point, b.real], [5996, 1992, 4004], '4.29 USD → 청구·적립·실부담');
eq(b.gain.toFixed(1), '31.8', '4.29 USD 이득률');
const m50 = MORE.bill(3.58, 1, TT, MID);
eq([m50.krw, m50.point, m50.real], [4998, 0, 4998], '4,998원 — 5,000원 미만은 한 푼도 안 쌓인다');
eq(MORE.bill(3.59, 1, TT, MID).point, 24, '5,012원 — 넘기는 순간 잔돈의 2배가 쌓인다');

eq(MORE.bill(0, 1, TT, MID), null, '금액이 없으면 null — 지어내지 않는다');
eq(MORE.bill(10, 0, TT, MID), null, '비자 환율이 없으면 null');
eq(MORE.bill(10, 1, 0, MID), null, '신한 환율이 없으면 null');
eq(MORE.solve(5999, 1, 0, 'USD', 0), null, '환율이 없으면 답도 없다');
eq(MORE.solve(10, 1, TT, 'USD', 0), null, '★한 센트(약 14원)도 못 들어가는 목표면 null — 0 을 답이라고 하지 않는다');
eq(MORE.solve(5999, 1, TT, 'USD', 0).foreign, 4.29, '답은 정확한 소수여야 한다 (9.279999… 같은 먼지가 남으면 안 된다)');
const mf = MORE.solve(12999, 1, TT, 'USD', 0).foreign;
eq(mf === +mf.toFixed(2), true, '★센트 단위로 딱 떨어진다 (928 × 0.01 = 9.279999999999999 를 잡는다)');

/* 보정은 환율을 위로 올린다 → 같은 목표에 **덜** 긁는다. 방향이 뒤집히면 위험한 쪽으로 틀린다. */
eq(MORE.solve(5999, JPY, TT, 'JPY', 3).foreign < MORE.solve(5999, JPY, TT, 'JPY', 0).foreign,
   true, '★보정을 주면 긁을 금액이 줄어든다');

/* ★★util.js 가 화면에 찍는 자릿수와 어긋나면 계산기가 제 답과 다른 금액을 보여준다.
   (MORE 가 NT$132.45 를 답으로 내도 U.money 는 NT$132 로 찍는다) */
let dz = [];
['KRW','JPY','VND','TWD','IDR','USD','EUR','THB','HKD','SGD','MOP','MYR','PHP','AED','MVR','CNY']
  .forEach(c => {
    const shown = /[.]/.test(U.money(1.25, c));
    if (shown !== (MORE.digits(c) > 0)) dz.push(c);
  });
eq(dz, [], '★MORE.digits 와 U.money 의 소수 자릿수가 통화마다 일치한다');

/* 날짜 칸 — 폰이 방콕·하와이 시각이어도 기준은 서울의 아침 고시다. */
const kst = h => Date.UTC(2026, 8, 3, h - 9, 30);      // 한국시간 h시 30분
eq(MORE.kstDay(kst(0)),  '2026-09-03', '한국시간 0:30 은 그날');
eq(MORE.kstDay(kst(23)), '2026-09-03', '한국시간 23:30 도 그날');
eq(MORE.kstDay(Date.UTC(2026, 8, 2, 15, 30)), '2026-09-03', '★UTC 로 9/2 15:30 은 한국의 9/3 이다');
eq(MORE.kstDay(Date.UTC(2026, 8, 2, 14, 30)), '2026-09-02', 'UTC 9/2 14:30 은 아직 한국의 9/2');

/* ── 신한 고시표 파싱 ──────────────────────────────────────────────────
   ★실제 응답에서 다섯 줄만 떼어 왔다(2026-09-03 1회차). 지어낸 값이 아니다. */
const SHFIX = {"dataBody":{"고시일자":"20260903","고시시간_display":"08:19:40","고시회차":1,"R_RIBF3730_1":[
  {"통화CODE":"USD","통화CODE_display":"미국 달러","전신환매도환율":1382.5,"매매기준환율":1369.4},
  {"통화CODE":"JPY","통화CODE_display":"일본 100엔","전신환매도환율":870.42,"매매기준환율":862.15},
  {"통화CODE":"EUR","통화CODE_display":"유럽 유로","전신환매도환율":1602.13,"매매기준환율":1586.59},
  {"통화CODE":"XAU","통화CODE_display":"GOLD (1g)","전신환매도환율":193219.99,"매매기준환율":191306.93},
  {"통화CODE":"VND","통화CODE_display":"베트남 100동","전신환매도환율":5.31,"매매기준환율":5.25}]}};

const SH = MORE_API.parse(SHFIX);
eq([SH.on, SH.at, SH.round], ['2026-09-03', '08:19:40', 1], '고시 일자·시각·회차');
eq([SH.tt, SH.mid], [1382.5, 1369.4], '★USD 전신환매도·매매기준 — themore 가 주던 값과 같다');
eq(SH.usd.USD, 1, '달러의 대미환산은 1');
/* ★★단위를 놓치면 환산액이 조용히 100배가 된다. '일본 100엔' 의 100 을 읽어야 한다. */
near(SH.usd.JPY, 0.0062958, 1e-7, '★엔은 100엔 고시다 — 1엔당으로 고쳐 읽는다');
near(SH.usd.VND, 0.000038338, 1e-9, '★동도 100동 고시다');
near(SH.usd.EUR, 1.1586, 1e-4, '유로는 1유로 고시');
eq(SH.usd.XAU, undefined, '금은 통화가 아니다 — 목록에서 뺀다');
eq(MORE_API.parse({}), null, '빈 응답이면 null');
eq(MORE_API.parse({ dataBody: { R_RIBF3730_1: [] } }), null, '줄이 없으면 null');
eq(MORE_API.parse({ dataBody: { R_RIBF3730_1: [{ '통화CODE': 'JPY', '매매기준환율': 862 }] } }), null,
   '★USD 가 없으면 null — 기준이 없으면 아무것도 못 센다');

/* ── 안전 여유 ────────────────────────────────────────────────────────
   비자 환율을 신한 대미환산율로 갈음할 때, **고른 금액을 진짜 비자 환율로 청구해도**
   목표를 넘지 않아야 한다. 넘으면 999 를 놓쳐 포인트가 통째로 날아간다.
   ★[통화, 신한 대미환산(교차), 비자] — 둘 다 2026-09-03 아침 값 실측이다. */
const MPAIR = [
  ['JPY', 6.2958229882e-3, 0.0063175122], ['EUR', 1.1586023076e+0, 1.160998839],
  ['THB', 3.0122681466e-2, 0.0302297158], ['TWD', 3.1495545494e-2, 0.0315069788],
  ['HKD', 1.2752300277e-1, 0.1275541468], ['SGD', 7.8678253250e-1, 0.7877729639],
  ['CNY', 1.4881700015e-1, 0.1488046627], ['AED', 2.7225792318e-1, 0.2723012199],
  ['MYR', 2.4718854973e-1, 0.2477084469], ['PHP', 1.5977800497e-2, 0.0160071712],
  ['IDR', 5.6302030086e-5, 0.0000563507], ['VND', 3.8337958230e-5, 0.0000382658],
  ['GBP', 1.3482474076e+0, 1.352998647],  ['AUD', 7.1659851030e-1, 0.717799282],
  ['CAD', 7.2225792318e-1, 0.7229605264],
];
let mover = 0, mrows = 0, mworst = 1;
MPAIR.forEach(([c, auto, real]) => {
  MORE.targets().forEach(t => {
    const s2 = MORE.solve(t, MORE.hedge(auto), TT, c, 0);   // 갈음 환율로 금액을 고르고
    if (!s2) return;
    const b2 = MORE.bill(s2.foreign, real, TT, MID);        // 진짜 비자 환율로 청구해 본다
    mrows += 1;
    if (b2.krw > t) mover += 1;
    mworst = Math.min(mworst, b2.point / ((t % 1000) * 2));
  });
});
eq(mrows, 450, '통화 15개 × 목표 30줄');
eq(mover, 0, '★★갈음 환율로 골라도 450줄 전부 목표 이하 — 999 를 넘지 않는다');
eq(mworst > 0.7, true, '그러면서 포인트는 최대치의 70% 아래로 안 떨어진다');
/* 여유를 빼면 넘는 줄이 생겨야 한다 — 안 생기면 이 검사가 아무것도 안 지키는 것이다 */
let bare = 0;
MPAIR.forEach(([c, auto, real]) => MORE.targets().forEach(t => {
  const s2 = MORE.solve(t, auto, TT, c, 0);
  if (s2 && MORE.bill(s2.foreign, real, TT, MID).krw > t) bare += 1;
}));
eq(bare > 0, true, '★여유를 빼면 목표를 넘는 줄이 실제로 생긴다 (여유가 일을 하고 있다)');

// ── ───────────────────────────────────────────────────────────────────
console.log(fail
  ? `\nFAIL - ${pass} 통과 / ${fail} 실패`
  : `PASS - ${pass}개 전부 통과`);
process.exit(fail ? 1 : 0);
