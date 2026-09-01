/* api/gmaps.js — 구글맵 단축 링크를 펼친다 (Vercel 서버리스 함수).

   왜 필요한가: 폰에서 공유하면 `maps.app.goo.gl/AbCd` 같은 단축 링크가 나온다.
   전체 URL 을 얻으려면 리다이렉트를 따라가야 하는데 브라우저에서는 CORS 에 막힌다
   (구글이 Access-Control-Allow-Origin 을 주지 않는다). 서버가 대신 따라갈 수밖에 없다.
   stock 의 api/naver.js 와 완전히 같은 상황이고, 구조도 그 파일을 따랐다.

   호출 규약:  GET /api/gmaps?u=<단축 링크>
   응답:       { url: "https://www.google.com/maps/place/..." }

   ★★**펼치기만 하고 해석하지 않는다.** 장소명·좌표를 뽑는 일은 js/gmaps.js 가 한다.
     서버에서도 파싱하면 같은 규칙이 두 곳에 생기고, 구글이 URL 형식을 바꿀 때 한쪽만 고쳐진다.
     (stock 의 api/etf.js 가 같은 이유로 '표 파싱은 서버, 해석은 브라우저' 로 갈라 놨다.)

   ★전체 URL 은 애초에 여기 오지 않는다 — js/gmaps.js 가 브라우저에서 바로 파싱하고
     needsServer 인 것만 보낸다. 그래도 여기서 한 번 더 확인한다. */

/* 받아 줄 입력. **이 목록이 SSRF 방어선이다** — 안 하면 내 도메인이 아무 데나
   요청을 던지는 통로가 된다. 구글 단축 링크 두 형태만 연다. */
const IN_HOST = {
  'maps.app.goo.gl': /^\/[A-Za-z0-9_-]{4,40}\/?$/,
  'goo.gl': /^\/maps\/[A-Za-z0-9_-]{4,40}\/?$/,
};

/* ★★폰에서 공유하면 뒤에 추적 파라미터가 붙는다 — iOS 는 `?g_st=ic`, 안드로이드는 `?g_st=iw`,
     공유 경로에 따라 `?utm_source=...` 도 붙는다. 전에는 정규식이 **문자열 끝**을 요구해서
     그런 링크가 전부 403 이었다 — 즉 **폰에서 붙여넣으면 자동 채움이 한 번도 안 됐다**
     (2026-09-01. 데스크톱 전체 URL 은 브라우저에서 파싱하니 멀쩡해서 오래 안 보였다).
   ★고치는 방향은 정규식을 느슨하게 푸는 쪽이 아니다. URL 로 **분해**해서 호스트와 경로만
     보고, 질의문자열과 조각은 **버린 뒤 정규 형태로 다시 만든다.** 단축 코드만 있으면
     펼쳐지므로 잃는 것이 없고, 서버가 따라가는 주소는 오히려 더 좁아진다. */
function canonical(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  const re = IN_HOST[u.hostname];
  if (!re || !re.test(u.pathname)) return null;
  return 'https://' + u.hostname + u.pathname.replace(/\/+$/, '');
}

/* 따라가는 중에 닿아도 되는 곳. 구글 밖으로 나가면 거기서 멈춘다 —
   단축 링크가 언제든 남의 사이트를 가리키게 바뀔 수 있다. */
const HOP_OK = /^https:\/\/([a-z0-9-]+\.)*google\.[a-z.]{2,6}\//i;

const MAX_HOPS = 5;

/* ★★**브라우저인 척하면 안 된다.** 데스크톱 Chrome UA 를 보내면 구글이 302 대신
     '앱으로 열기' 중간 페이지(200 + JS)를 준다 — Location 헤더가 없으니 펼치기가
     통째로 실패한다. 그 HTML 안에 목적지가 들어 있지도 않다(찾아봤다).
     2026-09-01 같은 링크로 실측:
        Chrome UA        → 200  (중간 페이지)
        UA 없음·curl·봇  → 302  Location: .../maps/place/간사이+국제공항/...
     평범한 클라이언트로 자기를 밝히면 구글이 그냥 리다이렉트를 준다.
   ★이건 '봇 탐지 우회' 의 반대다 — 원래 우리는 봇이고, 봇인 척을 그만두는 것이다. */
const UA = 'trip-app/1.0 (+https://thpht-trip.vercel.app)';

/* 인증 — 로그인한 사용자만 이 프록시를 쓸 수 있다.
   값은 js/supabase-config.js 와 같은 공개 값이다(anon 키는 브라우저에 노출되도록 설계된 키).
   환경변수가 있으면 그쪽을 먼저 쓴다. */
const SB_URL = process.env.SUPABASE_URL || 'https://slakyumsnufoywxrdhhx.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5xTTEUeViqzY1JgFLv0z6A_NAVJZcUz';

/* 검증한 토큰은 잠시 기억한다 — 링크를 붙일 때마다 Supabase 왕복을 붙이지 않기 위해서.
   서버리스 인스턴스가 재사용될 때만 살아 있고, 안 살아 있어도 한 번 더 물어볼 뿐이다. */
const TOKEN_TTL = 5 * 60 * 1000;
const seen = new Map();

async function authorized(req) {
  const raw = req.headers['authorization'] || '';
  const token = /^Bearer\s+(.+)$/i.test(raw) ? raw.replace(/^Bearer\s+/i, '').trim() : '';
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
  } catch (e) {
    return false;               // Supabase 에 못 물어보면 통과시키지 않는다(fail closed)
  }
}

/* 토큰당 요청 상한.
   ★이 프로젝트는 신규 가입이 **열려 있다**(동행자 때문에). 내 데이터는 RLS 가 막지만
     Vercel 함수 실행량은 막지 못한다 — 그 울타리가 이것이다.
   ★서버리스라 인스턴스마다 따로 센다. 완벽한 상한이 아니라 '한 사람이 한 인스턴스를
     끝없이 두드리는 것' 을 막는 정도다.
   ★상한이 stock(600)보다 낮은 이유: 이 프록시는 **사람이 링크를 붙일 때만** 불린다.
     폴링이 없으므로 분당 60 이면 손으로 붙일 수 있는 속도를 한참 넘는다. */
const RATE_MAX = 60;
const RATE_WIN = 60 * 1000;
const rate = new Map();

function overLimit(token) {
  const now = Date.now();
  const hit = rate.get(token);
  if (!hit || hit.until <= now) {
    if (rate.size > 500) rate.clear();
    rate.set(token, { n: 1, until: now + RATE_WIN });
    return 0;
  }
  hit.n += 1;
  return hit.n > RATE_MAX ? Math.ceil((hit.until - now) / 1000) : 0;
}

/* 리다이렉트를 손으로 따라간다.
   ★fetch 의 자동 추적(redirect:'follow')을 쓰지 않는 이유: 중간에 어디를 거쳤는지 볼 수 없어
     구글 밖으로 새는 것을 막을 수 없다. 한 걸음씩 확인한다. */
async function expand(start) {
  let url = start;
  for (let i = 0; i < MAX_HOPS; i++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 6000);
    let r;
    try {
      r = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
      });
    } finally {
      clearTimeout(timer);
    }

    if (r.status < 300 || r.status >= 400) return { url, status: r.status };

    const next = r.headers.get('location');
    if (!next) return { url, status: r.status };
    const abs = new URL(next, url).toString();
    if (!HOP_OK.test(abs)) {
      return { err: '구글 밖으로 나가는 링크입니다.', to: abs };
    }
    url = abs;
  }
  return { err: '리다이렉트가 너무 깊습니다.' };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'GET 만 받습니다.' });
    return;
  }
  if (!(await authorized(req))) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }
  const wait = overLimit(String(req.headers['authorization'] || ''));
  if (wait) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: `요청이 너무 잦습니다. ${wait}초 뒤에 다시 시도하세요.` });
    return;
  }

  const u = String((req.query && req.query.u) || '').trim();
  if (!u) { res.status(400).json({ error: 'u 파라미터가 필요합니다.' }); return; }
  const start = canonical(u);
  if (!start) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(403).json({ error: '구글맵 단축 링크만 펼칠 수 있습니다.' });
    return;
  }

  try {
    const out = await expand(start);
    if (out.err) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(422).json({ error: out.err });
      return;
    }
    /* ★펼쳐지지 않고 **그대로** 돌아오는 경우 — 구글이 리다이렉트 대신 200 을 줬다는 뜻이다.
       그때 성공(200)으로 돌려주면 브라우저는 같은 단축 링크를 또 파싱하려 들고
       화면에는 아무 일도 안 일어난 것처럼 보인다. 실패로 못박고 다음 수를 알려 준다. */
    if (IN_HOST[new URL(out.url).hostname]) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(422).json({
        error: '구글이 이 링크를 펼쳐 주지 않았습니다 — 링크를 브라우저에서 연 뒤 주소창의 전체 주소를 붙여넣어 주세요.',
      });
      return;
    }
    /* private — 공유 캐시(Vercel 엣지)에 남기지 않는다. public 으로 두면 인증을 통과한 응답이
       캐시에 올라가 인증 없는 요청에도 나갈 수 있다. 같은 단축 링크는 늘 같은 곳을 가리키므로
       브라우저에는 넉넉히 둔다. */
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).json({ url: out.url });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-store');
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? '구글 응답 시간 초과' : '링크를 펼치지 못했습니다.',
      detail: String((e && e.message) || e),
    });
  }
};

module.exports.canonical = canonical;   // tools/test-pure.js 용
