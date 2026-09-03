/* themore.js — /themore 한 장짜리 화면. **여행에 딸리지 않은 도구**라 제 주소에 산다.
   ─────────────────────────────────────────────────────────────────────────
   셈은 js/more.js 한 곳에서만 한다(money.js 와 같은 규칙). 여기는 화면뿐이다.

   ★★환율이 두 군데서 온다. 서로 닿는 쪽이 다르기 때문이다:
       신한 1회차 → **서버**(api/more.js). 브라우저에서는 CORS 가 막는다.
       비자 고시  → **브라우저**(여기). 서버에서 부르면 비자 앞단이 챌린지를 띄우는데,
                    CORS 는 열려 있어서 사람 브라우저는 그냥 읽힌다.
     2026-09-03에 17통화 전부 themore.app 이 보여주는 값과 소수점까지 같았다.

   ★★첫 방문에 **오늘 것을 통째로 받아 둔다** — 신한 하나와 통화 열 개의 비자 환율.
     그 뒤로는 통화를 갈아 끼워도 네트워크를 안 타고, 비행기 모드에서도 그날은 돈다.
     받아 둔 것은 localStorage 에 남기되 **오늘 칸만** 둔다(어제 환율로 오늘 답을 내면
     조용히 틀린다). 지난 날짜를 조회한 것은 이 세션에만 두고 저장하지 않는다.

   ★비자에 못 닿으면 신한 **대미환산율**로 갈음하고 안전 여유를 얹는다(MORE.SAFETY).
     999 를 넘지는 않되 포인트를 조금 손해 본다. 화면이 지금 어느 쪽을 쓰는지 늘 적는다 —
     이 계산기는 환율이 틀리면 통째로 틀린다.

   ★환율 보정 칸이 없다. 쓰는 사람의 카드에 **승인시점 환율**이 걸려 있어 긁는 순간
     환율로 확정되기 때문이다. 매입 시점 환율이 적용되는 카드라면 보정이 필요한데,
     셈 자체(MORE.solve 의 pad)는 남아 있으니 그때 칸만 되살리면 된다. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  /* 여행 기록에 쓴 통화 + 앞으로 쓸 것(2026-09-03에 DB 에서 뽑고 INR 을 더했다).
     ★늘릴 때는 신한 고시와 비자 **둘 다**에 있는지 먼저 확인한다 — 하나라도
       없으면 갈음으로 밀리거나 아예 못 센다.
     ★원화는 뺐다 — 국내 결제는 적립이 1배라 셈이 다르고 비자 환율도 없다.
     ★기본값은 달러. 비자가 바꿀 것이 없어(환율 1) 언제나 정확하다. */
  const CURS = ['USD', 'JPY', 'HKD', 'THB', 'TWD', 'CNY', 'EUR', 'SGD', 'MOP', 'IDR', 'INR'];

  /* 통화 앞에 붙일 국기. **U.guessCountry 를 안 쓴다** — 저쪽은 새 여행 폼에서
     나라를 미리 골라 주는 것이라 USD·EUR 을 일부러 비워 둔다(여러 나라니까).
     여기서는 그저 그 돈을 가리키는 표지라 달러는 미국, 유로는 EU 깃발이 맞다. */
  const CUR_CC = { USD: 'US', JPY: 'JP', HKD: 'HK', THB: 'TH', TWD: 'TW',
                   CNY: 'CN', EUR: 'EU', SGD: 'SG', MOP: 'MO', IDR: 'ID', INR: 'IN' };
  /* 지역표시문자 두 글자가 곳 국기다. U.flag 는 나라 목록을 보는데 EU 는 거기
     없으므로(나라가 아니다) 여기서만 코드포인트로 만든다. */
  const flagOf = cc => String.fromCodePoint(...[...cc].map(ch => 0x1F1E6 + ch.charCodeAt(0) - 65));

  /* ★★국기를 **그림으로** 그리는 기계인가. 윈도우는 안 그리고 'US' 두 글자로
     떨어뜨리는데, 그러면 고르개가 'US USD' 로 읽힌다. 그럴 때는 안 붙인다.
     ★폭으로는 못 가른다 — 대체 글자가 진짜 국기보다 좁게 나오기도 한다
       (2026-09-02 측정: 국기 19.8 vs 'JP' 24.2 — 판정이 뒤집혔다).
       **색으로 가른다.** 검게 찍어 보고 색이 남아 있으면 그림이다.
     ★app.js 에도 같은 판별기가 있다. 합치지 않고 둔다 — 저쪽은 여권·카드 바탕을
       재는 데까지 얽혀 있어서, 고르개 하나 때문에 건드릴 자리가 아니다. */
  function drawsFlags() {
    try {
      const c = document.createElement('canvas');
      c.width = c.height = 28;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.fillStyle = '#fff'; x.fillRect(0, 0, 28, 28);
      x.fillStyle = '#000'; x.textBaseline = 'top';
      x.font = '22px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
      x.fillText('🇯🇵', 0, 0);
      const d = x.getImageData(0, 0, 28, 28).data;
      for (let i = 0; i < d.length; i += 4) {
        if (Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 30) return true;
      }
    } catch (e) { /* 캔버스를 못 쓰면 안전한 쪽(글자)으로 */ }
    return false;
  }

  /* 표를 몇 줄까지 세울 것인가. 눈금은 5,999원부터 천 원 단위라 열여섯 줄이면
     20,999원까지다 — 밥값·기념품·택시가 다 그 안에 들어온다. 서른 줄을 세우면
     화면이 세 배로 길어지는데 아래쪽 절반은 이득률이 5% 밑이라 볼 일이 없다. */
  const ROWS = 16;

  /* 얼마나 거슬러 볼 수 있게 할 것인가. 비자는 약 1년치를 주지만(실측: 270일 전은 되고
     365일 전은 거부) **석 달이면 충분하다** — 지난 결제를 검산하는 일은 명세서가 나온
     직후에나 하지, 반년 전 것을 다시 들추지는 않는다. 칸을 좁히면 잘못 고를 일도 준다. */
  const BACK_DAYS = 90;

  const KEY = 'trip.more.v2';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };

  let autoAmt = true;                    // '이만큼 긁으면' 이 아직 자동으로 채운 값인가
  const sh = new Map();                  // 고시일자 → 신한 응답
  const visa = new Map();                // '통화|고시일자' → 비자 환율
  const TODAY = MORE.fxDay(MORE.kstNow());
  let day = TODAY;                       // 지금 보고 있는 고시일자

  /* 지난 방문에 받아 둔 오늘 것을 먼저 깐다 — 네트워크가 없어도 화면이 선다. */
  if (saved.day === TODAY) {
    if (saved.sh) sh.set(TODAY, saved.sh);
    Object.entries(saved.v || {}).forEach(([c, v]) => { if (v > 0) visa.set(`${c}|${saved.on}`, v); });
  } else {
    saved = {};                          // 날이 바뀌었으면 통째로 버린다
  }

  // ── 환율 받아 오기 ────────────────────────────────────────────────────
  async function askSh(d) {
    if (sh.has(d)) return sh.get(d);
    const r = await fetch(`/api/more?at=${encodeURIComponent(d)}`);
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.error || `환율을 가져오지 못했습니다 (${r.status})`);
    sh.set(d, b);
    if (d === TODAY) { saved.day = TODAY; saved.on = b.on; saved.sh = b; keep(); }
    return b;
  }

  /* 비자 고시환율.
     ★★amount=1 로 물으면 IDR 처럼 단위가 작은 통화는 환산액이 0 으로 반올림돼
       {"status":"success"} 만 온다. 100 을 넣으면 나온다(환율은 금액과 무관하다).
     ★★fromCurr·toCurr 이름이 뒤집혀 있다. '1엔이 몇 달러인가' 를 얻으려면
       fromCurr=USD&toCurr=JPY 로 물어야 한다 — 응답의 originalValues 가 그렇게 답한다. */
  async function askVisa(cur, on) {
    const k = `${cur}|${on}`;
    if (visa.has(k)) return visa.get(k);
    const md = `${on.slice(5, 7)}%2F${on.slice(8, 10)}%2F${on.slice(0, 4)}`;
    const u = 'https://usa.visa.com/cmsapi/fx/rates'
            + `?amount=100&fee=0&utcConvertedDate=${md}&exchangedate=${md}`
            + `&fromCurr=USD&toCurr=${encodeURIComponent(cur)}`;
    const j = await (await fetch(u)).json();
    const v = parseFloat(j && j.originalValues && j.originalValues.fxRateVisa);
    if (!(v > 0)) throw new Error('비자가 그 날짜의 환율을 주지 않았습니다');
    visa.set(k, v);
    if (saved.day === TODAY && saved.on === on) {
      saved.v = saved.v || {}; saved.v[cur] = v; keep();
    }
    return v;
  }

  /* ★한 번은 더 물어본다. 통화를 빠르게 갈아 끼우면 비자가 간간이 빈손으로 답한다
     (2026-09-03에 18개를 연달아 부르다 하나가 그랬다). 갈음으로 떨어지면 답이 조용히
     보수적으로 바뀌므로, 그 전에 한 번만 다시 두드린다. */
  async function pullVisa(cur, on) {
    for (let i = 0; i < 2; i += 1) {
      if (i) await new Promise(r => setTimeout(r, 600));
      try { return await askVisa(cur, on); } catch (e) { /* 갈음으로 간다 */ }
    }
    return null;
  }

  /* ★★**999 꼬리.** 이 카드는 청구액의 끝 세 자리를 두 배로 돌려준다 — 그게 이 화면의
     전부다. 그래서 청구액이 나오는 자리마다 꼬리를 갈라 밝힌다. 5,996 을 보면
     996×2 가 보이고, 13,973 은 973 뿐이라서 나쁘 줄임이 한눈에 읽힌다.
     ★장식이 아니라 **규칙을 그린 것**이다. 그래서 5,000원 미만이면 적립이 없으므로
       꼬리를 안 밝힌다 — 문장 하나 안 쓰고 그 규칙을 가르친다. */
  function won(n) {
    const s = n.toLocaleString('ko-KR');
    const i = s.lastIndexOf(',');
    if (i < 0 || n < MORE.MIN) return esc(s);
    return `${esc(s.slice(0, i + 1))}<b>${esc(s.slice(i + 1))}</b>`;
  }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function draw() {
    const cur = $('mc-cur').value;
    const rate = sh.get(day);
    if (!rate) return;

    const isUsd = cur === 'USD';
    const api = isUsd ? 1 : visa.get(`${cur}|${rate.on}`);
    const fall = rate.usd[cur];                       // 신한 대미환산율(그물)
    const how = isUsd ? 'usd' : (api > 0 ? 'api' : (fall > 0 ? 'fall' : 'none'));
    const v = how === 'fall' ? MORE.hedge(fall) : api;

    if (!(v > 0)) {
      $('mc-tab').innerHTML = '';
      $('mc-src').textContent = `${cur} 환율을 구하지 못했습니다.`;
      return;
    }
    $('mc-amt').placeholder = cur;

    /* 역방향 — 목표 청구금액마다 '얼마를 부르면 되나'. 여기가 계산기의 본체다.
       ★먼저 낸다. **첫 줄이 곧 '이만큼 긁으면' 의 기본값**이기 때문이다. */
    const list = MORE.targets().slice(0, ROWS).map(t => {
      const s = MORE.solve(t, v, rate.tt, cur, 0);
      if (!s) return null;
      const b = MORE.bill(s.foreign, v, rate.tt, rate.mid);
      return b ? { f: s.foreign, b } : null;
    }).filter(Boolean);

    /* ★칸을 비워 두지 않는다. 열자마자 5,999원에 가장 가까운 금액이 들어가 있어야
       그 자리에서 바로 읽고 그대로 부를 수 있다. 통화를 바꾸면 그 통화의 첫 줄로 갈린다.
       ★사람이 한 번이라도 고치면 그때부터 손대지 않는다 — 남이 적은 것을 덮지 않는다. */
    if (autoAmt && list.length) $('mc-amt').value = String(list[0].f);

    /* 정방향 — '이만큼 긁으면 얼마 찍히나'. 화면 맨 위 큰 칸 셋이 이 답이다. */
    const amt = parseFloat($('mc-amt').value);
    const one = amt > 0 ? MORE.bill(amt, v, rate.tt, rate.mid) : null;
    /* ★★₩ 를 안 붙인다. Plex Mono 에 ₩ 가 없어서 대체 글꼴로 떨어지는데(폭 12.10 vs
       숫자 13.20), 거기에 음수 자간이 겹쳐 **숫자를 파고든다**(2026-09-03 아이폰).
       아래 표에서 쓰는 방식과 같게 — 단위는 머리칸(청구 · 원)이 말하고 칸은 수만 적는다. */
    $('mc-krw').innerHTML = one ? won(one.krw) : '—';
    /* ★5,000원 미만이면 한 푼도 안 쌓인다. 0P 라고 적으면 '적립이 되긴 하는데 0' 으로
       읽히므로, 안 되는 이유를 그 자리에 적는다. */
    $('mc-pt').textContent = !one ? '—'
      : one.point ? one.point.toLocaleString('ko-KR') + 'P' : '없음';
    $('mc-pt').classList.toggle('warn', !!one && !one.point);
    $('mc-gain').textContent = one ? one.gain.toFixed(1) + '%' : '—';
    $('mc-gain').classList.toggle('warn', !!one && one.gain < 0);

    /* ★★금액에 기호를 안 붙인다. 통화를 갈아 끼우며 보는 화면이라 **위안이 ¥ 로 찍히면
       엔으로 읽힌다**(U.money 는 CNY 도 ¥ 다 — 여행 하나에 통화 하나일 때는 문제가 없었다).
       ★그리고 U.money 는 센트가 0 이면 '.00' 을 떼는데($5, ฿306.7), 여기서는 서른 줄이
         세로로 서므로 자릿수가 들쭉날쭉해진다. 통화는 머리칸이 말하고 칸은 수만 적는다. */
    const d = MORE.digits(cur);
    const fmt = x => x.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

    /* ★★**쓸모없는 답을 내놓고 끝내지 않는다.** 6.00 을 넣으면 청구 8,391 — 꼬리가
       391 이라 782P 뿐인데, 42센트만 더 긁으면 8,987 이 되어 1,974P 다. 그 답은 이미
       아래 표에 있지만 사람이 눈으로 찾아 견줘야 했다(2026-09-04). 이 화면이 있는
       이유가 바로 그 비교인데, 정작 비교를 사람에게 떠넘기고 있었다.
     ★가장 **가까운** 줄을 고른다. 가장 이득이 큰 줄이 아니다 — 5,999 로 내려가라는
       말은 6달러를 쓰려던 사람에게 소용이 없다. 위아래를 가리지 않는다: 4.30 을 넣었으면
       1센트를 **덜** 긁는 것이 답이다.
     ★적립이 늘지 않는 줄은 아예 후보가 아니다. 그래서 이미 제일 좋은 값을 넣었으면
       이 줄은 뜨지 않는다 — 할 말이 없을 때 자리를 차지하지 않는다. */
    const near = one && list.reduce((best, x) => {
      if (x.f === amt || x.b.point <= one.point) return best;
      return (!best || Math.abs(x.f - amt) < Math.abs(best.f - amt)) ? x : best;
    }, null);
    $('mc-near').hidden = !near;
    if (near) {
      const gap = fmt(Math.abs(+(near.f - amt).toFixed(d)));
      $('mc-near').innerHTML = `<button type="button" data-f="${near.f}">`
        + `<b>${esc(gap)}</b> ${near.f > amt ? '더' : '덜'} 긁으면 `
        + `<b>${(near.b.point - one.point).toLocaleString('ko-KR')}P</b> 더 쌓입니다`
        + `<span class="mgo">${esc(fmt(near.f))} → ${won(near.b.krw)}</span></button>`;
    }

    $('mc-tab').innerHTML = list.length ? `
      <table class="mtab">
        <thead><tr><th>긁을 금액 · ${esc(cur)}</th><th>청구</th><th>이득</th></tr></thead>
        <tbody>${list.map(x => `
          <tr${x.f === amt ? ' class="on"' : ''}>
            <th scope="row"><button type="button" data-f="${x.f}">${esc(fmt(x.f))}</button></th>
            <td class="krw">${won(x.b.krw)}</td>
            <td class="${x.b.gain < 0 ? 'warn' : ''}">${x.b.gain.toFixed(1)}%</td>
          </tr>`).join('')}</tbody>
      </table>` : '';

    /* ★어느 환율로 셌는지 반드시 적는다. 이 계산기는 환율이 틀리면 통째로 틀린다. */
    /* 두 줄로 갈라 적는다 — 신한과 비자는 **다른 곳에서 온 다른 값**이라
       한 줄에 이어 붙이면 어디서 끊어 읽어야 하는지가 안 보인다. */
    const moved = rate.on !== day;      // 주말·공휴일이면 직전 영업일로 물러난다
    const l1 = `신한 USD/KRW <b>${rate.tt.toLocaleString('ko-KR')}</b> · ${rate.round}회차 `
             + `${esc(rate.on)} ${esc(rate.at || '')}`
             + (moved ? ` <span class="warn">(${esc(day)} 은 고시가 없어 직전 영업일)</span>` : '');
    const l2 = isUsd
      /* 달러일 때도 줄을 비우지 않는다 — 통화를 갈아 끼울 때마다 높이가 바뀌면
         아래 표가 튀다. 빈 자리를 두는 대신 그 사실이 뜻하는 바를 적는다. */
      ? '비자 — 달러는 바꿀 것이 없어 언제나 정확합니다'
      : `비자 ${esc(cur)}/USD <b>${v.toPrecision(8)}</b>`
        + (how === 'fall'
            ? ' <span class="warn">— 비자에 못 닿아 신한 대미환산율로 갈음하고 안전 여유 '
              + `${MORE.SAFETY}% 를 얹었습니다. 999 를 넘지는 않지만 포인트를 조금 손해 봅니다.</span>`
            : '');
    $('mc-src').innerHTML = `<span>${l1}</span><span>${l2}</span>`;
  }

  // ── 부르기 ────────────────────────────────────────────────────────────
  let busy = 0;
  async function load() {
    const cur = $('mc-cur').value;
    const me = ++busy;
    day = MORE.fxDay($('mc-when').value) || TODAY;

    if (!sh.has(day)) {
      $('mc-src').textContent = '환율을 가져오는 중…';
      try { await askSh(day); } catch (e) {
        if (me !== busy) return;
        $('mc-tab').innerHTML = '';
        $('mc-src').textContent = e.message;
        return;
      }
      if (me !== busy) return;
    }
    draw();                                   // 신한만으로 먼저 그린다(그물 값이라도 보인다)

    const on = sh.get(day).on;
    if (cur !== 'USD' && !visa.has(`${cur}|${on}`)) {
      await pullVisa(cur, on);
      if (me !== busy) return;
      draw();
    }
    if (day === TODAY) warmUp(on);
  }

  /* 첫 방문에 오늘 것을 통째로 받아 둔다 — 그 뒤로는 통화를 갈아 끼워도 네트워크가 없다.
     ★한 번에 몰지 않고 한 통화씩 띄엄띄엄 부른다. 연달아 던지면 비자가 빈손으로 답한다.
     ★실패해도 아무 말 안 한다 — 그 통화를 실제로 고를 때 다시 부르고, 그때도 안 되면
       갈음으로 떨어지면서 화면이 그렇게 적는다. */
  let warmed = false;
  async function warmUp(on) {
    if (warmed) return;
    warmed = true;
    for (const c of CURS) {
      if (c === 'USD' || visa.has(`${c}|${on}`)) continue;
      await new Promise(r => setTimeout(r, 400));
      try { await askVisa(c, on); } catch (e) { /* 다음에 */ }
      if ($('mc-cur').value === c) draw();
    }
  }

  // ── 시작 ──────────────────────────────────────────────────────────────
  const withFlag = drawsFlags();
  $('mc-cur').innerHTML = CURS.map(c =>
    `<option value="${esc(c)}">${withFlag ? flagOf(CUR_CC[c]) + ' ' : ''}${esc(c)}</option>`).join('');
  $('mc-cur').value = 'USD';
  const now = MORE.kstNow();
  $('mc-when').value = now;
  $('mc-when').max = now;
  $('mc-when').min = MORE.kstDay(Date.now() - BACK_DAYS * 864e5) + 'T00:00';

  /* 금액이 적힌 것을 누르면 위 칸이 그 값으로 바뀐다 — 줄을 눈으로 고르고 손으로
     옮겨 적는 일이 없게. 고른 줄은 표에서 짚어 준다(.on).
     ★표만이 아니라 **권하는 줄(mnudge)도 같은 단추**다. 자리를 나누지 않고 한 곳에서 듣는다. */
  document.addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (!b) return;
    $('mc-amt').value = b.dataset.f;
    autoAmt = false;
    draw();
  });

  $('mc-form').addEventListener('input', e => {
    if (e.target.id === 'mc-amt') { autoAmt = false; draw(); return; }  // 금액만 바뀌면 다시 안 부른다
    if (e.target.id === 'mc-cur') autoAmt = true;      // 통화가 바뀌면 그 통화의 첫 줄로
    load();
  });
  load();
})();
