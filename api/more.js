/* api/more.js — 더모아 계산에 쓸 **신한 1회차 고시환율** (Vercel 서버리스 함수).
   ─────────────────────────────────────────────────────────────────────────
   왜 api/fx.js 로 안 되나: 저쪽은 네이버 **일별 종가**를 준다. 더모아 셈에 필요한 것은
   그날 **1회차**(오전 첫 고시) 신한 전신환매도율이다. 2026-09-03 실측으로 신한 1회차
   1,382.50 · 네이버 종가 1,373.70 — 0.64% 벌어진다. 5,999원에서 38원이면 999 경계를
   그냥 넘어가므로 종가로 계산하면 **틀린 금액을 알려 주는 계산기**가 된다.

   ★★처음에는 themore.app 의 API 를 끌어왔다가 막혔다(2026-09-03). 같은 회선에서
     브라우저는 200, 서버는 403 → 나중엔 응답 자체가 없음. 데이터센터 필터가 아니라
     **자기 페이지 밖에서는 안 쓰게 막아 둔 것**이다. 브라우저인 척해서 뚫지 않는다.
     대신 신한은행이 제 고시표를 그대로 열어 두고 있어서 **원천에서 직접** 받는다 —
     남에게 기대지 않고, 값도 themore 가 주던 것과 세 날짜 모두 정확히 같았다.

   ★비자 환율은 여기서 못 준다. 비자 공식 API 는 Cloudflare 챌린지에 막히고, 신한의
     대미환산율(제 매매기준율끼리의 교차)은 비자와 최대 0.35% 어긋난다(엔 기준
     5,999원에서 21원). 그래서 그 값을 '갈음' 으로 주고, 부르는 쪽이 안전 여유를 얹거나
     사람이 비자 환율을 직접 넣게 한다 — js/more.js 의 SAFETY 를 보라.

   호출 규약:  GET /api/more?at=2026-09-03            (한국시간 날짜)
   응답:       { on, at, round, tt, mid, usd: { JPY: 0.0062958, ... } }
               on    실제 고시 일자 — 주말·공휴일이면 직전 영업일이 온다
               tt    USD/KRW 전신환매도율 — 카드가 이 값으로 청구한다
               mid   USD/KRW 매매기준율 — 이득률의 기준('수수료 없는 카드였다면')
               usd   그 통화 1단위가 몇 달러인가 (신한 매매기준율끼리의 교차) */

const UP = 'https://bank.shinhan.com/serviceEndpoint/httpDigital';
/* ★HTTP 헤더는 latin-1 만 된다 — 한글을 넣었다가 fetch 가 통째로 터졌다(ByteString). */
const UA = 'thpht-trip/1.0 (+https://thpht-trip.vercel.app; personal travel log)';

/* 신한이 데이터를 갖고 있는 범위 밖을 물으면 FAIL 이 온다. 넉넉히 잡아 둔다. */
const FLOOR = '2000-01-01';

/* ★★여기만 **로그인 없이** 연다(2026-09-03). 앱의 다른 프록시(api/fx·api/gmaps)와 다르다.
     왜 되나: 오가는 것이 **공개 고시환율뿐**이라 지킬 개인 정보가 없고, 아래 memo 가
     날짜별로 붙들고 있어서 **누가 몇 번을 부르든 신한에는 하루 한두 번**만 나간다.
   ★그래도 남는 위험은 우리 함수를 낭비당하는 것이다. 그래서 둘로 막는다:
       ① IP 별 분당 상한 — 사람 한 명에게는 넉넉하고 긁어 가기에는 좁다
       ② 응답에 s-maxage — 같은 날짜는 Vercel 가장자리가 대신 내주고 함수는 안 깨어난다
   ★공개라고 해서 아무 말이나 내보내지 않는다. 응답에 사용자와 관련된 것은 한 칸도 없다. */
const RATE_MAX = 20;
const RATE_WIN = 60 * 1000;
const rate = new Map();

const ipOf = (req) => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '')
  .split(',')[0].trim() || 'unknown';

function overLimit(who) {
  const now = Date.now();
  const hit = rate.get(who);
  if (!hit || hit.until <= now) {
    if (rate.size > 500) rate.clear();
    rate.set(who, { n: 1, until: now + RATE_WIN });
    return 0;
  }
  hit.n += 1;
  return hit.n > RATE_MAX ? Math.ceil((hit.until - now) / 1000) : 0;
}

/* ★★신한 응답을 우리 모양으로. **여기만 순수 함수라** tools/test-pure.js 가 검증한다.
   ★단위가 통화마다 다르다 — '일본 100엔' · '베트남 100동' 처럼 표시 이름에 배수가
     적혀 있다. 놓치면 환산액이 조용히 100배가 된다(api/fx.js 도 같은 함정을 적어 뒀다).
   ★대미환산환율 칸을 그냥 쓰지 않는다. 소수 넷째 자리에서 잘려 있어서(엔 0.6296)
     매매기준율끼리 직접 나누는 편이 정확하다. */
function parse(body) {
  const b = (body && body.dataBody) || {};
  const rows = b.R_RIBF3730_1;
  if (!Array.isArray(rows) || !rows.length) return null;

  const unit = (r) => {
    const m = String(r['통화CODE_display'] || '').match(/(\d+)/);
    return m ? +m[1] : 1;
  };
  const usdRow = rows.find(r => r['통화CODE'] === 'USD');
  if (!usdRow) return null;
  const tt = +usdRow['전신환매도환율'];
  const mid = +usdRow['매매기준환율'];
  if (!(tt > 0) || !(mid > 0)) return null;

  /* 금·은은 통화가 아니다(XAU 는 1g 값이라 섞이면 통화 목록이 지저분해진다). */
  const usd = {};
  rows.forEach(r => {
    const c = String(r['통화CODE'] || '').toUpperCase();
    const v = +r['매매기준환율'];
    if (!/^[A-Z]{3}$/.test(c) || c === 'XAU' || c === 'XAG' || !(v > 0)) return;
    usd[c] = (v / unit(r)) / mid;
  });

  const on = String(b['고시일자'] || '');
  return {
    on: /^\d{8}$/.test(on) ? `${on.slice(0, 4)}-${on.slice(4, 6)}-${on.slice(6)}` : null,
    at: b['고시시간_display'] || null,
    round: +b['고시회차'] || null,
    tt, mid, usd,
  };
}

async function ask(day) {                       // day = 'YYYYMMDD'
  const payload = {
    dataBody: {
      ricInptRootInfo: { serviceType: 'GU', serviceCode: 'F3730', language: 'ko',
                         isRule: 'N', webUri: '/index.jsp' },
      '조회구분': '', '조회일자': day, '고시회차': 1,
      '조회일자_display': '', startPoint: '', endPoint: '',
    },
    dataHeader: { trxCd: 'RSHRC0213A01', language: 'ko', subChannel: '49', channelGbn: 'D0' },
  };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(UP, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json; charset=UTF-8',
                 'User-Agent': UA, Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!r.ok) throw new Error(`신한은행이 ${r.status} 를 돌려줬습니다`);
    return parse(await r.json());
  } finally { clearTimeout(timer); }
}

/* 받아 둔 날짜. 지난 날의 1회차는 다시 안 바뀌므로 인스턴스가 사는 동안 그대로 쓴다.
   ★오늘 것만 짧게 잡는다 — 아침 고시 전에 물어봤을 수 있다. */
const memo = new Map();
const FRESH = 5 * 60 * 1000;

/* s-maxage 를 함께 준다 — 같은 날짜를 다시 물으면 Vercel 가장자리가 내주고 함수는
   깨어나지 않는다. 지난 날의 1회차는 다시 안 바뀌므로 하루, 오늘 것은 5분. */
const cache = (past) => {
  const n = past ? 86400 : 300;
  return `public, max-age=${n}, s-maxage=${n}`;
};

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const dayBefore = (d) => new Date(Date.parse(`${d}T00:00:00Z`) - 864e5).toISOString().slice(0, 10);

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET 만 받습니다.' }); return; }
  const wait = overLimit(ipOf(req));
  if (wait) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: `요청이 너무 잦습니다. ${wait}초 뒤에 다시 시도하세요.` });
    return;
  }

  const at = String((req.query || {}).at || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) {
    res.status(400).json({ error: 'at=YYYY-MM-DD 가 필요합니다.' });
    return;
  }
  const today = kstToday();
  if (at < FLOOR || at > today) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(422).json({ error: '오늘까지만 볼 수 있습니다.' });
    return;
  }

  const past = at < today;
  const hit = memo.get(at);
  if (hit && (past || Date.now() - hit.saved < FRESH)) {
    res.setHeader('Cache-Control', cache(past));
    res.status(200).json(hit.body);
    return;
  }

  try {
    /* ★주말·공휴일은 신한이 알아서 직전 영업일로 물러난다(일요일에 물으면 금요일 고시가
       온다). 다만 **아침 고시 전**에 물으면 값이 없으므로 그때만 하루 뒤로 물러선다 —
       하와이·미국에서는 한국시간 새벽에도 가게가 열려 있다. */
    let got = await ask(at.replace(/-/g, ''));
    if (!got && at === today) got = await ask(dayBefore(at).replace(/-/g, ''));
    if (!got) throw new Error('그 날짜의 고시가 없습니다');

    const body = { ...got, asked: at };
    memo.set(at, { saved: Date.now(), body });
    if (memo.size > 60) {
      for (const k of memo.keys()) { if (memo.size <= 40) break; memo.delete(k); }
    }
    res.setHeader('Cache-Control', cache(past));
    res.status(200).json(body);
  } catch (e) {
    if (hit) {                                  // 받아 둔 게 있으면 그거라도 준다
      res.setHeader('Cache-Control', 'no-store');
      res.status(200).json(hit.body);
      return;
    }
    /* ★★왜 못 가져왔는지를 화면까지 올린다. 처음에는 '환율을 가져오지 못했습니다' 만
       떠서 원인을 못 보고 로그를 따로 뒤져야 했다. 고칠 수 있는 사람이 한 명뿐인 앱이라
       그 한 명에게 이유를 보여 주는 편이 낫다. */
    const timedOut = e && e.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-store');
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? '환율 응답 시간 초과 — 잠시 뒤 다시 열어 보세요.'
                      : `환율을 가져오지 못했습니다 — ${String((e && e.message) || e)}`,
    });
  }
};

module.exports.parse = parse;                   // tools/test-pure.js 용
