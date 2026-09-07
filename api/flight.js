/* api/flight.js — 항공편 번호로 두 공항을 찾아 온다 (Vercel 서버리스 함수).

   왜 필요한가: 여행은 대개 **항공권을 사면서** 시작된다. 그 순간 손에 있는 것은
   편명과 날짜 둘뿐인데, 거기서 나라·기간·통화와 **첫 줄·마지막 줄 공항**이 다 나온다.
   손으로 적으면 여덟 값이고, 좌표는 구글맵 링크를 따로 붙여야 겨우 들어온다 —
   그 좌표가 없어서 여권 지도에서 통째로 빠지는 여행이 실제로 있었다(2026-09-07 하얼빈).

   호출 규약:  GET /api/flight?no=7C1301&date=2026-08-29
   응답:       { no, date, from:{...}, to:{...} }
               from/to = { iata, name, city, cc, lat, lng, on, time }
               on·time 은 **그 공항에서 보는 시계**의 날짜와 시각(YYYY-MM-DD / HH:MM).
               ★밤 비행기는 뜬 날과 내린 날이 다르다 — 날짜를 같이 주지 않으면
                 화면이 출발일에 도착 줄을 적는다.

   ★★**뜻은 여기서 안 붙인다.** 어느 공항이 첫 줄이고 어느 쪽이 마지막 줄인지는
     브라우저(js/app.js 의 새 여행 폼)가 정한다 — 가는 편은 도착지를, 오는 편은
     출발지를 쓴다. 서버는 '이 편명의 두 끝' 만 알려 준다.
     api/gmaps.js 가 '펼치기만 하고 해석은 안 한다' 고 적어 둔 것과 같은 규칙이다.

   ★키가 없으면 **501 로 분명히 말한다.** 조용히 빈 값을 주면 화면은 '못 찾았다' 로
     읽고, 사람은 편명을 몇 번씩 다시 친다. 안 켜 둔 것과 못 찾은 것은 다른 일이다.

   ★★공급자는 **한 함수 뒤에 둔다**(pick 아래 shape). 무료 한도나 응답 형식이 바뀌면
     그 함수만 갈아 끼우면 된다 — 값을 쓰는 쪽은 위의 규약만 안다. */

const HOST = 'aerodatabox.p.rapidapi.com';
const KEY = process.env.AERODATABOX_KEY || '';

const SB_URL = process.env.SUPABASE_URL || 'https://slakyumsnufoywxrdhhx.supabase.co';
const SB_ANON = process.env.SUPABASE_ANON_KEY || 'sb_publishable_5xTTEUeViqzY1JgFLv0z6A_NAVJZcUz';

/* 인증·속도제한은 api/fx.js 와 같은 몸짓이다 — 두 함수가 다르게 굴면 한쪽만 고쳐진다 */
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

/* ★환율(120/분)보다 훨씬 좁게 잡는다. 이건 **여행을 만들 때 두 번** 불리는 것이고,
   무료 한도가 달 단위로 걸려 있어서 오타 반복이 곧 한 달치를 태운다. */
const RATE_MAX = 10;
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

/* 편명 — 'KE 123', 'ke123', '7C1301' 을 한 꼴로 편다.
   ★공백을 지우고 대문자로. 항공사 코드는 두 자(7C·KE)거나 세 자(ANA 같은 ICAO)다. */
function normNo(v) {
  const s = String(v || '').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{2,3}\d{1,4}[A-Z]?$/.test(s) ? s : '';
}

/* 현지 시각만 뽑는다. 공급자는 '2026-08-29 08:50+09:00' 처럼 준다 —
   ★UTC 로 바꾸지 않는다. 일정에 적히는 시각은 **그 나라에서 보는 시계**다. */
function local(t) {
  const s = String((t && (t.local || t)) || '');
  const d = s.match(/(\d{4}-\d{2}-\d{2})/);
  const m = s.match(/(\d{2}):(\d{2})/);
  return { on: d ? d[1] : '', time: m ? `${m[1]}:${m[2]}` : '' };
}

function side(x) {
  const a = (x && x.airport) || {};
  const loc = a.location || {};
  const lat = Number(loc.lat), lng = Number(loc.lon != null ? loc.lon : loc.lng);
  const t = local(x && (x.scheduledTime || x.revisedTime));
  return {
    iata: a.iata || a.icao || '',
    name: a.name || a.shortName || '',
    city: a.municipalityName || '',
    cc: a.countryCode || '',
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    on: t.on,
    time: t.time,
  };
}

/* ★★공급자 응답 → 우리 규약. **여기만 공급자를 안다.**
   ★한 편명이 하루에 여러 구간일 수 있다(경유·이원구간). 날짜가 맞는 것을 고르고,
     없으면 첫 번째를 쓴다 — 고르지 못했다고 아무것도 안 주는 것보다 낫다. */
function pick(body, date) {
  const list = Array.isArray(body) ? body : (body && Array.isArray(body.flights) ? body.flights : []);
  if (!list.length) return null;
  const on = f => String(((f.departure || {}).scheduledTime || {}).local || '').slice(0, 10);
  return list.find(f => on(f) === date) || list[0];
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') { res.status(405).json({ error: 'GET 만 받습니다.' }); return; }

  const raw = req.headers['authorization'] || '';
  const token = raw.replace(/^Bearer\s+/i, '').trim();
  if (!(await authorized(req))) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(401).json({ error: '로그인이 필요합니다.' });
    return;
  }
  const wait = overLimit(token);
  if (wait) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Retry-After', String(wait));
    res.status(429).json({ error: `요청이 너무 잦습니다. ${wait}초 뒤에 다시 시도하세요.` });
    return;
  }

  const q = (req.query && req.query) || {};
  const no = normNo(q.no);
  const date = String(q.date || '').trim();
  if (!no) { res.status(400).json({ error: '편명을 확인하세요 — 7C1301 처럼 적습니다.' }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { res.status(400).json({ error: 'date=YYYY-MM-DD 가 필요합니다.' }); return; }

  if (!KEY) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(501).json({ error: '항공편 조회가 아직 안 켜져 있습니다 — 공항과 시각을 직접 적어 주세요.' });
    return;
  }

  const url = `https://${HOST}/flights/number/${encodeURIComponent(no)}/${date}`
            + '?withAircraftImage=false&withLocation=true';
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  let body;
  try {
    const r = await fetch(url, {
      signal: ctl.signal,
      headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': HOST, Accept: 'application/json' },
    });
    /* ★★없는 편은 **204** 로 온다(2026-09-07, KE001 로 실측). 404 가 아니다 —
       그리고 204 는 r.ok 가 참이라 그대로 두면 밑에서 json() 이 빈 몸통에 걸려
       502 '가져오지 못했습니다' 가 된다. 다시 해보라는 말인데 다시 해도 같다.
     ★못 찾은 것은 고장이 아니다: 편명이 틀렸거나 아직 시간표에 없는 것이다. */
    if (r.status === 204 || r.status === 404) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(404).json({ error: `${no} ${date} 편을 못 찾았습니다. 편명과 날짜를 확인하세요.` });
      return;
    }
    if (r.status === 429) {
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({ error: '이 달 조회 한도를 다 썼습니다 — 직접 적어 주세요.' });
      return;
    }
    if (!r.ok) throw new Error('bad status ' + r.status);
    body = await r.json();
  } catch (e) {
    const timedOut = e && e.name === 'AbortError';
    res.setHeader('Cache-Control', 'no-store');
    res.status(timedOut ? 504 : 502).json({
      error: timedOut ? '항공편 조회가 오래 걸립니다 — 직접 적어 주세요.'
                      : '항공편을 가져오지 못했습니다 — 직접 적어 주세요.',
    });
    return;
  } finally { clearTimeout(timer); }

  const f = pick(body, date);
  const from = f && side(f.departure);
  const to = f && side(f.arrival);
  /* 좌표가 없으면 이 기능이 하려던 일의 절반이 없는 것이다 — 못 찾은 것으로 친다.
     ★★그런데 **왜** 비었는지가 둘이다: 정말 그 편 자료가 없거나, 공급자가 응답
       형식을 바꿨거나. 뒤쪽이면 화면만 보고는 영영 모른다 — 그래서 **본 열쇠들을
       같이 적어 준다.** 그 한 줄이면 side()/pick() 을 어디로 고칠지 바로 안다.
       값은 안 싣는다: 고치는 데 필요한 것은 이름이지 내용이 아니다. */
  if (!from || !to || from.lat == null || to.lat == null) {
    const f0 = Array.isArray(body) ? body[0] : body;
    const ks = o => (o && typeof o === 'object' ? Object.keys(o).slice(0, 12).join(',') : '-');
    const saw = f0 && typeof f0 === 'object'
      ? `flight[${ks(f0)}] departure[${ks(f0.departure)}] airport[${ks((f0.departure || {}).airport)}]`
      : `본문이 ${Array.isArray(body) ? '빈 배열' : typeof body}`;
    res.setHeader('Cache-Control', 'no-store');
    res.status(404).json({
      error: `${no} ${date} 편의 공항 정보가 비어 있습니다. 직접 적어 주세요. (받은 것: ${saw})`,
      saw,
    });
    return;
  }

  /* 시간표는 잘 안 바뀐다. 오타로 같은 편을 두 번 물어도 한 번만 나가게 한다. */
  res.setHeader('Cache-Control', 'private, max-age=3600');
  res.status(200).json({ no, date, from, to });
};
