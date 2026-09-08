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
     찍는 규칙과 같은 잣대다. 그러고도 둘이면 **포기한다**: 잘못 고른 이름은
     못 고른 이름보다 나쁘다. 화면에서 한 번 고치시면 그만이다. */

const SPARQL = 'https://query.wikidata.org/sparql';

/* 위키데이터는 신원을 밝히지 않는 요청을 막는다. 연락처 대신 저장소를 적어 둔다. */
const UA = 'thpht-trip/1.0 (https://github.com/THPHT2524/trip) airport-name-lookup';

/* 함수 인스턴스가 살아 있는 동안은 다시 안 묻는다. 여행 하나에 같은 공항이
   두 번 나오는 일이 흔하고(가는 편의 도착지 = 오는 편의 출발지), 시간표와 달리
   공항 이름은 몇 해에 한 번 바뀐다. 빈 문자열도 답이므로 같이 담는다. */
const memo = new Map();

const isAirport = s => /공항$/.test(s);          // 공군기지·…역을 함께 걸러낸다

/* 코드 여럿을 한 번에 묻는다. 돌려주는 것은 **하나로 정해진 것만** 담은 Map 이다.
   ★네 글자면 ICAO, 세 글자면 IATA — 길이로 갈리므로 어느 쪽으로 걸렸는지
     따로 물을 필요가 없다. */
async function lookup(codes) {
  const want = [...new Set(codes.filter(c => /^[A-Z0-9]{3,4}$/.test(c)))];
  const ask = want.filter(c => !memo.has(c));

  if (ask.length) {
    const q = `SELECT ?code ?ko WHERE {
      VALUES ?code { ${ask.map(c => `"${c}"`).join(' ')} }
      { ?a wdt:P239 ?code } UNION { ?a wdt:P238 ?code }
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

/* ICAO 먼저, 그 다음 IATA. 둘 다 못 정하면 빈 문자열(= 부르는 쪽이 영문을 쓴다). */
function pick(found, icao, iata) {
  return found.get(String(icao || '').toUpperCase())
      || found.get(String(iata || '').toUpperCase())
      || '';
}

module.exports = { lookup, pick };
