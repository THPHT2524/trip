/* api/_wikidata.js — 공항 코드로 한글 이름을 찾는다.

   왜 여기 있나: 항공편 피드(api/flight.js)가 주는 공항 이름은 영어다. 예전에는
   js/util.js 안에 IATA→한글 표를 손으로 들고 있었는데, 새로 가는 공항마다
   사람이 한 줄씩 심어야 했다(2026-09-08 푸꾸옥이 그렇게 영어로 들어왔다).
   이제는 코드로 물어서 받아 온다 — 표를 없앴다.

   ★왜 브라우저가 아니라 서버인가: vercel.json 의 CSP `connect-src` 가 self·supabase·
     maptiler 뿐이다. 이 하나 때문에 CSP 를 여는 것은 손해가 크다. 서버는 어차피
     코드를 손에 쥐고 있고, 응답도 이미 한 시간 캐시된다.

   ★파일 이름 앞의 `_` 는 Vercel 이 이 파일을 **함수로 만들지 않게** 한다.
     불러다 쓰는 조각이지 엔드포인트가 아니다. tools 쪽 일괄 변환도 이걸 쓴다 —
     화면에 적히는 이름과 옛 줄을 고치는 이름이 **같은 규칙에서 나와야** 한다.

   ─ 고르는 규칙 ────────────────────────────────────────────────────────────
   ICAO 먼저, 없으면 IATA, 그것도 아니면 영문 그대로.
   ★ICAO 를 앞에 두는 까닭(2026-09-08 실측, 공항 70곳):
     · ICAO 는 비행장 하나에 코드 하나다. IATA 는 도시·터미널 단위라 EWR 은
       '뉴어크 리버티 국제공항' 과 **같은 이름의 철도역**이 함께 걸린다.
     · IATA 는 공항이 닫히면 수십 년 뒤 **재사용**된다. ICAO 는 사실상 안 그런다.
     · 그 70곳에서 ICAO 누락은 0개였다 — 앞에 둬도 잃는 게 없다.

   ★후보가 **정확히 하나일 때만** 쓴다. 김해(RKPK)·떤선녓(VVTS)처럼 군 비행장이
     같은 코드를 달고 있는 곳이 있다. 이름이 '공항' 으로 끝나는 것만 남기면
     '김해공군기지' 와 '…국제공항역' 이 함께 걸러진다 — 마침 여권 지도가 점을
     찍는 규칙과 같은 잣대다. 문 닫은 공항도 질의에서 뺀다(아래 주석). 그러고도
     둘이면 **포기한다**: 잘못 고른 이름은 못 고른 이름보다 나쁘다. 화면에서 한 번
     고치시면 그만이다. */

const SPARQL = 'https://query.wikidata.org/sparql';

/* 위키데이터는 신원을 밝히지 않는 요청을 막는다. 연락처 대신 저장소를 적어 둔다. */
const UA = 'thpht-trip/1.0 (https://github.com/THPHT2524/trip) airport-name-lookup';

/* 함수 인스턴스가 살아 있는 동안은 다시 안 묻는다. 여행 하나에 같은 공항이
   두 번 나오는 일이 흔하고(가는 편의 도착지 = 오는 편의 출발지), 시간표와 달리
   공항 이름은 몇 해에 한 번 바뀐다. 빈 문자열도 답이므로 같이 담는다. */
const memo = new Map();

const isAirport = s => /공항$/.test(s);          // 공군기지·…역을 함께 걸러낸다

/* ★위키데이터의 한국어 **라벨이 낡은** 곳. 공항이 개명했는데 라벨이 안 따라온 것들이라
   이건 취향이 아니라 **틀린 이름**이다 — 그래서 여기서 덮는다.
   ⚠ 이 목록에 '그냥 다르게 부르고 싶은 이름' 을 넣지 않는다. 그러면 걷어낸 일흔 줄짜리
     표가 이름만 바꿔 되살아난다. 들어올 자격은 하나다: **지금 그 이름이 아니다.**
   ★한국어 문서 제목(schema:about)은 둘 다 이미 맞다. 그럼 제목을 먼저 보면 되지
     않느냐 — 70곳으로 재 보니 열여덟이 갈리는데 이득이 고르지 않았다(2026-09-08).
     PQC 는 제목이 '즈엉동 공항' 과 '푸꾸옥 국제공항' 둘이라 못 정하게 되고,
     BCN 은 '주제프 타라델랴스 바르셀로나 엘프라트 공항' 이 된다. 둘을 적는 편이 싸다.
   ★IATA·ICAO 를 둘 다 담는다 — 세 글자와 네 글자는 섞일 일이 없다. */
const FIX = {
  KLAS: '해리 리드 국제공항', LAS: '해리 리드 국제공항',   // 2021 개명, 라벨은 '매캐런'
  OTHH: '하마드 국제공항', DOH: '하마드 국제공항',        // 2014 개항, 라벨은 '뉴도하'
};

/* 코드 여럿을 한 번에 묻는다. 돌려주는 것은 **하나로 정해진 것만** 담은 Map 이다.
   ★네 글자면 ICAO, 세 글자면 IATA — 길이로 갈리므로 어느 쪽으로 걸렸는지
     따로 물을 필요가 없다. */
async function lookup(codes) {
  const want = [...new Set(codes.filter(c => /^[A-Z0-9]{3,4}$/.test(c)))];
  const ask = want.filter(c => !memo.has(c));

  if (ask.length) {
    /* ★★**문 닫은 공항을 뺀다**(2026-09-08). 도시가 공항을 새로 지어 옮기면 코드가
         그대로 넘어가서 **같은 코드에 항목이 둘**이 된다 — 칭다오가 2021년에 류팅을
         닫고 자오둥을 열었고, TAO·ZSQD 가 둘 다에 걸려 있어 못 정하고 있었다.
       ⚠ 폐항 날짜(P576)만 보면 안 걸린다 — 류팅에는 그 칸이 비어 있고, 대신
         '이곳의 개방 상태(P5817) = 폐쇄됨(Q11639308)' 으로 적혀 있다. 둘 다 본다.
       ⚠ '다음으로 이어짐(P1366)' 도 써 봤다가 걷었다. 리스본·돈므앙이 통째로
         사라진다 — 새 공항 계획이 있거나 한때 주공항 자리를 넘긴 것뿐인데
         **멀쩡히 살아 있는** 공항이다. 죽은 것만 빼야지 밀려난 것까지 빼면 안 된다.
       ★코드 74개로 재 보니 TAO 만 풀리고 나머지는 하나도 안 바뀌었다. */
    const q = `SELECT ?code ?ko WHERE {
      VALUES ?code { ${ask.map(c => `"${c}"`).join(' ')} }
      { ?a wdt:P239 ?code } UNION { ?a wdt:P238 ?code }
      FILTER NOT EXISTS { ?a wdt:P576 ?gone }
      FILTER NOT EXISTS { ?a wdt:P5817/wdt:P279* wd:Q11639308 }
      ?a rdfs:label ?ko . FILTER(lang(?ko) = "ko") }`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    try {
      const r = await fetch(`${SPARQL}?format=json&query=${encodeURIComponent(q)}`,
                            { signal: ctl.signal, headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' } });
      if (!r.ok) throw new Error('bad status ' + r.status);
      const j = await r.json();
      const bag = new Map();
      for (const b of (((j.results || {}).bindings) || [])) {
        const c = ((b.code || {}).value || '').toUpperCase();
        const ko = ((b.ko || {}).value || '').trim();
        if (!c || !isAirport(ko)) continue;
        if (!bag.has(c)) bag.set(c, new Set());
        bag.get(c).add(ko);                       // 같은 이름이 분류 수만큼 오므로 Set
      }
      if (memo.size > 400) memo.clear();
      for (const c of ask) {
        const hit = bag.get(c);
        memo.set(c, hit && hit.size === 1 ? [...hit][0] : '');
      }
    } catch (e) {
      /* 못 물어봐도 일은 굴러가야 한다 — 영문 이름이 남는다.
         ★다만 **기억하지는 않는다.** 실패를 '없음' 으로 담아 두면 잠깐 끊긴 것이
           그 인스턴스가 사는 내내 영어로 굳는다. */
    } finally { clearTimeout(timer); }
  }

  const out = new Map();
  for (const c of want) if (memo.get(c)) out.set(c, memo.get(c));
  return out;
}

/* ICAO 먼저, 그 다음 IATA. 둘 다 못 정하면 빈 문자열(= 부르는 쪽이 영문을 쓴다).
   ★낡은 라벨을 덮는 FIX 가 무엇보다 먼저다. */
function pick(found, icao, iata) {
  const I = String(icao || '').toUpperCase(), A = String(iata || '').toUpperCase();
  return FIX[I] || FIX[A] || found.get(I) || found.get(A) || '';
}

module.exports = { lookup, pick };
