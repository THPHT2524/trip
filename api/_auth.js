/* api/_auth.js — 프록시 넷이 문 앞에서 똑같이 하던 두 가지.

   왜 여기 있나: `authorized()` 는 api/flight·fx·gmaps 에 **글자 하나까지 같은 것**이
   세 벌 있었고, `overLimit()` 은 거기에 api/more 까지 네 벌이었다(2026-09-08에 세었다).
   토큰 검증 방식이나 fail-closed 판단을 고칠 일이 생기면 네 곳을 고쳐야 하고,
   세 곳만 고치면 **한 함수만 조용히 옛 규칙으로 남는다** — 그게 인증이면 구멍이다.
   api/_wikidata.js 를 뺀 것과 같은 이유이고, 같은 규칙을 쓴다.

   ★파일 이름 앞의 `_` 는 Vercel 이 이 파일을 **함수로 만들지 않게** 한다.
     불러다 쓰는 조각이지 엔드포인트가 아니다.

   ★★함수마다 **제 인스턴스**를 갖는다. 서버리스라 번들이 따로 만들어지므로 아래 memo 는
     여전히 함수별로 따로 산다 — 합치기 전과 똑같다. 합쳐진 것은 규칙뿐이다. */

/* 값은 js/supabase-config.js 와 같은 공개 값이다(anon 키는 브라우저에 노출되도록
   설계된 키). 환경변수가 있으면 그쪽을 먼저 쓴다. */
const SB_URL = process.env.SUPABASE_URL || 'https://slakyumsnufoywxrdhhx.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5xTTEUeViqzY1JgFLv0z6A_NAVJZcUz';

/* 검증한 토큰은 잠시 기억한다 — 부를 때마다 Supabase 왕복을 붙이지 않기 위해서.
   서버리스 인스턴스가 재사용될 때만 살아 있고, 안 살아 있어도 한 번 더 물어볼 뿐이다. */
const TOKEN_TTL = 5 * 60 * 1000;
const seen = new Map();

/* Authorization 헤더에서 Bearer 토큰만. 없으면 빈 문자열. */
function tokenOf(req) {
  const raw = (req && req.headers && req.headers['authorization']) || '';
  return /^Bearer\s+(.+)$/i.test(raw) ? raw.replace(/^Bearer\s+/i, '').trim() : '';
}

async function authorized(req) {
  const token = tokenOf(req);
  if (!token) return false;
  const hit = seen.get(token);
  if (hit && hit > Date.now()) return true;
  try {
    const r = await fetch(`${SB_URL}/auth/v1/user`, {
      headers: { apikey: SB_ANON, Authorization: `Bearer ${token}` },
    });
    if (!r.ok) { seen.delete(token); return false; }
    if (seen.size > 200) seen.clear();
    seen.set(token, Date.now() + TOKEN_TTL);
    return true;
  } catch (e) { return false; }        // 못 물어보면 통과시키지 않는다(fail closed)
}

/* ── 요청 상한 ────────────────────────────────────────────────────────────
   ★이 프로젝트는 신규 가입이 **열려 있다**(동행자 때문에). 내 데이터는 RLS 가 막지만
     Vercel 함수 실행량은 막지 못한다 — 그 울타리가 이것이다.
   ★서버리스라 인스턴스마다 따로 센다. 완벽한 상한이 아니라 '한 사람이 한 인스턴스를
     끝없이 두드리는 것' 을 막는 정도다.
   ★분당 몇 번인지는 **함수마다 다르다** — 부르는 까닭이 다르기 때문이다. 그래서 수는
     여기 안 적고 부르는 쪽이 정한다: 값을 여기 모으면 왜 그 수인지가 쓰임에서 멀어진다.
   ★돌려주는 것은 **몇 초 쉬어야 하는지**다(0 이면 통과) — Retry-After 에 그대로 싣는다. */
const RATE_WIN = 60 * 1000;

function limiter(max) {
  const rate = new Map();
  return function overLimit(who) {
    const now = Date.now();
    const hit = rate.get(who);
    if (!hit || hit.until <= now) {
      if (rate.size > 500) rate.clear();
      rate.set(who, { n: 1, until: now + RATE_WIN });
      return 0;
    }
    hit.n += 1;
    return hit.n > max ? Math.ceil((hit.until - now) / 1000) : 0;
  };
}

/* 로그인을 안 받는 함수(api/more)는 IP 로 센다 — 셀 열쇠가 없으면 상한이 없는 것과 같다. */
const ipOf = (req) => String((req && req.headers && (req.headers['x-forwarded-for']
  || req.headers['x-real-ip'])) || '').split(',')[0].trim() || 'unknown';

module.exports = { authorized, tokenOf, limiter, ipOf };
