/* api/fx.js — 날짜별 환율 (Vercel 서버리스 함수).
   stock 의 api/naver.js 에서 이식했다. 그쪽은 경로가 열둘이지만 여기는 **환율 하나**만 연다.

   왜 필요한가: 네이버는 어떤 Origin 에도 CORS 를 주지 않는다. 그리고 여행 비용에 필요한 것은
   '지금 환율' 이 아니라 **쓴 날의 환율**인데, 단건 시세 경로는 지금 값만 준다.
   일별 이력은 m.stock.naver.com 의 front-api 에만 있다.

   호출 규약:  GET /api/fx?date=2026-08-29&from=JPY&to=KRW&kind=tts
   응답:       { rate: 8.67, on: "2026-08-29", from: "JPY", to: "KRW", exact: true, kind: "tts" }
               rate 는 **from 1 단위가 to 로 얼마인가** 다. cost * rate = 원화 금액.

   ★★어느 환율인가가 중요하다. 네이버 일별 응답은 넷을 함께 준다:
        closePrice   매매기준율        — 은행이 기준으로 삼는 값. 실제로 내는 돈이 아니다
        sendValue    전신환매도율(TTS) — **카드 결제**가 이 언저리로 잡힌다  → kind=tts (기본)
        cashBuyValue 현찰 살 때        — **환전**해서 현금을 쥘 때 내는 값    → kind=cash
        receiveValue 전신환매입율
      매매기준율로 계산하면 실제보다 싸게 나온다(엔 기준 약 1% — 858.18 vs 866.59).
      쓴 돈을 재는 앱이므로 **기본을 tts 로** 둔다. 매매기준율이 필요하면 kind=base.

   ★★엔은 **100엔 기준**으로 고시된다(FX_JPYKRW 가 '100엔당 원'). 그대로 쓰면 환산액이
     100배가 된다. 여기서 나누어 1엔당으로 맞춘다 — stock 의 README 도 같은 함정을 적어 뒀다.

   ★비공식 엔드포인트다. 깨지면 rate 를 못 내고, 부르는 쪽은 사람이 직접 넣게 둔다.
     자동 채움은 편의지 필수 경로가 아니다. */

const ORIGIN = 'https://m.stock.naver.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
           '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/* 네이버가 주는 원화 대비 코드. 여기 없는 통화는 자동 채움을 포기하고 사람에게 넘긴다 —
   없는 값을 지어내느니 비워 두는 편이 낫다. */
const CODE = {
  USD: 'FX_USDKRW', JPY: 'FX_JPYKRW', EUR: 'FX_EURKRW', CNY: 'FX_CNYKRW',
  GBP: 'FX_GBPKRW', AUD: 'FX_AUDKRW', CAD: 'FX_CADKRW', HKD: 'FX_HKDKRW',
  SGD: 'FX_SGDKRW', THB: 'FX_THBKRW', TWD: 'FX_TWDKRW', VND: 'FX_VNDKRW',
  /* 2026-09-02에 늘렸다 — 발리·마카오·쿠알라룸푸르·마닐라를 넣을 자리가 없었다.
     ★네이버에 없는 코드면 404 가 오고, 부르는 쪽은 '직접 넣어 주세요' 로 떨어진다.
       지어내지 않으므로 없는 통화를 여기 적어 두어도 조용히 틀리지는 않는다. */
  IDR: 'FX_IDRKRW', MOP: 'FX_MOPKRW', MYR: 'FX_MYRKRW', PHP: 'FX_PHPKRW',
};
/* 100 단위로 고시되는 통화. 여기 빠뜨리면 환산액이 조용히 100배가 된다. */
const PER100 = { JPY: true, VND: true, IDR: true };

/* 어느 환율을 쓸 것인가 → 네이버 응답의 어느 칸인가.
   tts  전신환매도율  : 카드로 긁었을 때 청구되는 값에 가장 가깝다 (기본)
   cash 현찰 살 때    : 환전해서 현금을 쥘 때 실제로 낸 값
   base 매매기준율    : 은행 기준값. 실제로 내는 돈은 아니다 */
const FIELD = { tts: 'sendValue', cash: 'cashBuyValue', base: 'closePrice' };

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

const RATE_MAX = 120;                  // 사람이 비용을 적을 때만 불린다. 폴링이 없다
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

/* 그 통화의 '원화 대비' 종가를 날짜에 맞춰 찾는다.
   ★주말·공휴일에는 고시가 없다. 그래서 **그 날짜 이하에서 가장 가까운 거래일**을 쓰고,
     정확히 그 날이 아니면 exact:false 로 알려 준다(화면이 그렇게 적는다). */
async function krwPer(cur, date, kind) {
  if (cur === 'KRW') return { v: 1, on: date, exact: true };
  const code = CODE[cur];
  if (!code) return null;

  const num = s => parseFloat(String(s == null ? '' : s).replace(/,/g, ''));
  const rows = [];

  /* ★pageSize 는 **60이 상한**이다. 100 을 넣으면 400 이 온다
       ("getExchangeClosingPrices.pageSize: must be less than or equal to 60" — 실측).
     지난 여행의 날짜까지 닿아야 하므로 필요한 만큼만 페이지를 넘긴다.
     한 페이지가 60거래일(약 3개월)이라 세 장이면 아홉 달쯤 커버한다. */
  for (let page = 1; page <= 3; page += 1) {
    const url = `${ORIGIN}/front-api/marketIndex/prices?category=exchange`
              + `&reutersCode=${code}&page=${page}&pageSize=60`;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    let body;
    try {
      const r = await fetch(url, {
        signal: ctl.signal,
        headers: { 'User-Agent': UA, Referer: `${ORIGIN}/`, Accept: 'application/json' },
      });
      if (!r.ok) break;
      body = await r.json();
    } finally { clearTimeout(timer); }

    const list = (body && body.result) || [];
    if (!Array.isArray(list) || !list.length) break;
    list.forEach(x => {
      const on = String(x.localTradedAt || '').slice(0, 10);
      /* 원하는 환율이 없는 날이면 매매기준율로 물러난다 — 없는 값을 지어내지 않되,
         한 칸 비었다고 그 날짜를 통째로 버리지도 않는다. */
      const v = num(x[FIELD[kind] || 'closePrice']) || num(x.closePrice);
      if (/^\d{4}-\d{2}-\d{2}$/.test(on) && Number.isFinite(v) && v > 0) rows.push({ on, v });
    });
    // 찾는 날짜까지 내려왔으면 더 넘길 이유가 없다
    if (rows.some(x => x.on <= date)) break;
  }
  if (!rows.length) return null;
  rows.sort((a, b) => (a.on < b.on ? 1 : -1));       // 날짜 내림차순

  const hit = rows.find(x => x.on <= date) || rows[rows.length - 1];
  const per = PER100[cur] ? 100 : 1;
  return { v: hit.v / per, on: hit.on, exact: hit.on === date };
}

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

  const q = req.query || {};
  const date = String(q.date || '').slice(0, 10);
  const from = String(q.from || '').toUpperCase();
  const to = String(q.to || 'KRW').toUpperCase();
  /* 모르는 값이 오면 기본(tts)으로 — 400 을 내느니 쓸 만한 값을 준다 */
  const kind = FIELD[String(q.kind || '').toLowerCase()] ? String(q.kind).toLowerCase() : 'tts';

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'date=YYYY-MM-DD 가 필요합니다.' }); return; }
  if (!/^[A-Z]{3}$/.test(from) || !/^[A-Z]{3}$/.test(to)) { res.status(400).json({ error: '통화 코드가 잘못됐습니다.' }); return; }
  if (from === to) {
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).json({ rate: 1, on: date, from, to, kind, exact: true });
    return;
  }
  if ((from !== 'KRW' && !CODE[from]) || (to !== 'KRW' && !CODE[to])) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(422).json({ error: `${CODE[from] ? to : from} 는 자동으로 못 가져옵니다. 환율을 직접 넣어 주세요.` });
    return;
  }

  try {
    /* 둘 다 원화 대비로 받아 나눈다. KRW 를 거치므로 어느 조합이든 낼 수 있다
       (엔→원, 원→엔, 엔→달러 전부 같은 길이다). */
    const [a, b] = await Promise.all([krwPer(from, date, kind), krwPer(to, date, kind)]);
    if (!a || !b || !b.v) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(502).json({ error: '환율을 가져오지 못했습니다. 직접 넣어 주세요.' });
      return;
    }
    const rate = a.v / b.v;
    // 소수 여섯 자리면 원↔엔·원↔동 어느 쪽으로 가도 자릿수가 남는다
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.status(200).json({
      rate: Math.round(rate * 1e6) / 1e6,
      on: a.on < b.on ? a.on : b.on,
      from, to, kind,
      exact: a.exact && b.exact,
    });
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-store');
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? '환율 응답 시간 초과' : '환율을 가져오지 못했습니다.',
      detail: String((e && e.message) || e),
    });
  }
};
