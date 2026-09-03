/* api/more.js — 더모아 계산에 쓸 환율 (Vercel 서버리스 함수).
   ─────────────────────────────────────────────────────────────────────────
   왜 api/fx.js 로 안 되나: 저쪽은 네이버 **일별 종가**를 준다. 더모아 셈에 필요한 것은
   그날 **1회차** 신한 전신환매도율이고, 둘은 같은 날에도 다르다
   (2026-09-03 실측: 신한 1회차 1,382.50 · 네이버 종가 1,373.70 — 0.64%).
   5,999원에서 38원 차이라 999 경계를 그냥 넘어간다. 그리고 엔·바트는 **비자 환율**로
   달러를 거치는데 그 값은 네이버에 아예 없다.

   ★★그래서 themore.app 의 공개 API 를 그대로 끌어온다. 브라우저에서는 못 부른다 —
     CORS 를 안 열어 두었고(thpht-trip.vercel.app 에서 실측 Failed to fetch),
     우리 CSP 도 connect-src 'self' 다. **서버끼리는** 인증도 헤더도 없이 열려 있다.

   ★남의 무료 API 다. 지키는 쪽으로 만든다:
     · 고시는 **하루에 두 번**(0시·9시) 바뀌므로 칸이 이틀치라도 넷뿐이다 → 세게 캐시한다
     · 우리가 누구인지 User-Agent 에 밝힌다. 막고 싶으면 막을 수 있어야 한다
     · 죽으면 계산기만 안 뜨면 된다. 여행 기록은 이것과 무관하다

   호출 규약:  GET /api/more?at=2026-09-03T09
   응답:       { at, on, type, tt, mid, visa: { JPY: 0.0063175122, ... } }
               tt  신한 전신환매도율(USD/KRW) — 카드가 이 값으로 청구한다
               mid 매매기준율 — 이득률의 기준('수수료 없는 카드였다면')
               visa 그 통화 1단위가 몇 달러인가 */

const UP = 'https://api.themore.app/api/v1/rate';
/* ★HTTP 헤더는 latin-1 만 된다 — 한글을 넣었다가 fetch 가 통째로 터졌다(ByteString). */
const UA = 'thpht-trip/1.0 (+https://thpht-trip.vercel.app; personal travel log)';

/* themore 가 데이터를 갖고 있는 시작점. 그 앞을 물어봐야 빈 값만 온다. */
const FLOOR = '2023-12-01';

const SB_URL = process.env.SUPABASE_URL || 'https://slakyumsnufoywxrdhhx.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5xTTEUeViqzY1JgFLv0z6A_NAVJZcUz';

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
  } catch (e) { return false; }        // 못 물어보면 통과시키지 않는다(fail closed)
}

/* 계산기를 여는 사람 한 명이 한 번에 한 칸만 본다. 폴링이 없다. */
const RATE_MAX = 30;
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

/* 받아 둔 칸. 지난 칸의 고시는 다시 안 바뀌므로 인스턴스가 사는 동안 그대로 쓴다.
   ★오늘 칸은 짧게만 잡는다 — 9시 5분까지 비자 환율이 갱신되는 중일 수 있다. */
const memo = new Map();
const FRESH = 5 * 60 * 1000;

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET 만 받습니다.' }); return; }
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

  const at = String((req.query || {}).at || '');
  if (!/^\d{4}-\d{2}-\d{2}T(00|09)$/.test(at)) {
    res.status(400).json({ error: 'at=YYYY-MM-DDT00 또는 T09 가 필요합니다.' });
    return;
  }
  const day = at.slice(0, 10);
  const today = kstToday();
  if (day < FLOOR || day > today) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(422).json({ error: `${FLOOR} 부터 오늘까지만 볼 수 있습니다.` });
    return;
  }

  const past = day < today;
  const hit = memo.get(at);
  if (hit && (past || Date.now() - hit.at < FRESH)) {
    res.setHeader('Cache-Control', `private, max-age=${past ? 86400 : 300}`);
    res.status(200).json(hit.body);
    return;
  }

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`${UP}?date=${encodeURIComponent(at)}`, {
      signal: ctl.signal,
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const b = await r.json();
    const sh = (b && b.sh) || {};
    const tt = +sh.usdkrw_tt_rate;
    const mid = +sh.usdkrw_midrate;
    if (!(tt > 0) || !(mid > 0)) throw new Error('no rate');

    /* 우리가 쓰는 모양으로 바꿔서 넘긴다 — 저쪽 응답 모양이 바뀌어도 고칠 곳이 여기뿐이다. */
    const visa = {};
    (Array.isArray(b.visa) ? b.visa : []).forEach(v => {
      const c = String(v && v.currency || '').toUpperCase();
      const x = +(v && v.usdFxRate);
      if (/^[A-Z]{3}$/.test(c) && x > 0) visa[c] = x;
    });

    const body = {
      at,
      on: sh.fxRateDateTime || null,   // 이 고시가 언제 것인가(주말이면 직전 영업일)
      type: sh.fxRateType || null,     // 'AC' 면 1회차 확정, 아니면 예측
      tt, mid, visa,
    };
    memo.set(at, { at: Date.now(), body });
    if (memo.size > 60) {              // 과거 칸이 쌓여도 인스턴스 하나에 60칸이면 넉넉하다
      for (const k of memo.keys()) { if (memo.size <= 40) break; memo.delete(k); }
    }
    res.setHeader('Cache-Control', `private, max-age=${past ? 86400 : 300}`);
    res.status(200).json(body);
  } catch (e) {
    /* 지난 칸이라도 받아 둔 게 있으면 그걸 준다 — 없는 것보다 낫다. */
    if (hit) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(hit.body);
      return;
    }
    const timedOut = e && e.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-store');
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? '환율 응답 시간 초과' : '환율을 가져오지 못했습니다.',
      detail: String((e && e.message) || e),
    });
  } finally { clearTimeout(timer); }
};
