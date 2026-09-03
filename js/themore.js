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

  /* 여행 기록에 실제로 쓴 통화만 세운다(2026-09-03에 DB 에서 뽑았다).
     ★원화는 뺐다 — 국내 결제는 적립이 1배라 셈이 다르고 비자 환율도 없다.
     ★기본값은 달러. 비자가 바꿀 것이 없어(환율 1) 언제나 정확하다. */
  const CURS = ['USD', 'JPY', 'HKD', 'THB', 'TWD', 'CNY', 'EUR', 'SGD', 'MOP', 'IDR'];

  /* 비자는 **약 1년치**만 준다(2026-09-03 실측: 270일 전은 되고 365일 전은 거부).
     그보다 오래된 날짜는 갈음밖에 못 하므로 아예 고르지 못하게 한다. */
  const BACK_DAYS = 365;

  const KEY = 'trip.more.v2';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };

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
      $('mc-one').textContent = '';
      $('mc-src').textContent = `${cur} 환율을 구하지 못했습니다.`;
      return;
    }
    $('mc-amt').placeholder = cur;

    /* 정방향 — '이만큼 긁으면 얼마 찍히나' */
    const amt = parseFloat($('mc-amt').value);
    const one = amt > 0 ? MORE.bill(amt, v, rate.tt, rate.mid) : null;
    $('mc-one').innerHTML = one
      ? `<b>${esc(U.money(one.krw, U.SETTLE))}</b> 청구 · `
        + (one.point ? `${one.point.toLocaleString('ko-KR')}P 적립 · `
                     : `적립 없음(${MORE.MIN.toLocaleString('ko-KR')}원 미만) · `)
        + `<span class="${one.gain < 0 ? 'warn' : ''}">이득 ${one.gain.toFixed(1)}%</span>`
      : '';

    /* 역방향 — 목표 청구금액마다 '얼마를 부르면 되나'. 여기가 계산기의 본체다. */
    const list = MORE.targets().map(t => {
      const s = MORE.solve(t, v, rate.tt, cur, 0);
      if (!s) return null;
      const b = MORE.bill(s.foreign, v, rate.tt, rate.mid);
      return b ? { f: s.foreign, b } : null;
    }).filter(Boolean);

    /* ★★금액에 기호를 안 붙인다. 통화를 갈아 끼우며 보는 화면이라 **위안이 ¥ 로 찍히면
       엔으로 읽힌다**(U.money 는 CNY 도 ¥ 다 — 여행 하나에 통화 하나일 때는 문제가 없었다).
       ★그리고 U.money 는 센트가 0 이면 '.00' 을 떼는데($5, ฿306.7), 여기서는 서른 줄이
         세로로 서므로 자릿수가 들쭉날쭉해진다. 통화는 머리칸이 말하고 칸은 수만 적는다. */
    const d = MORE.digits(cur);
    const fmt = x => x.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });

    $('mc-tab').innerHTML = list.length ? `
      <table class="mtab">
        <thead><tr><th>긁을 금액 · ${esc(cur)}</th><th>청구</th><th>적립</th><th>이득</th></tr></thead>
        <tbody>${list.map(x => `
          <tr>
            <th scope="row">${esc(fmt(x.f))}</th>
            <td>${x.b.krw.toLocaleString('ko-KR')}</td>
            <td>${x.b.point.toLocaleString('ko-KR')}<em>P</em></td>
            <td class="${x.b.gain < 0 ? 'warn' : ''}">${x.b.gain.toFixed(1)}%</td>
          </tr>`).join('')}</tbody>
      </table>` : '';

    /* ★어느 환율로 셌는지 반드시 적는다. 이 계산기는 환율이 틀리면 통째로 틀린다. */
    const moved = rate.on !== day;      // 주말·공휴일이면 직전 영업일로 물러난다
    $('mc-src').innerHTML =
      `신한 USD/KRW <b>${rate.tt.toLocaleString('ko-KR')}</b> · ${rate.round}회차 `
      + `${esc(rate.on)} ${esc(rate.at || '')}`
      + (moved ? ` <span class="warn">(${esc(day)} 은 고시가 없어 직전 영업일)</span>` : '')
      + (isUsd ? '' : ` · 비자 ${esc(cur)} ${v.toPrecision(8)}`)
      + (how === 'fall'
          ? ' <span class="warn">— 비자에 못 닿아 신한 대미환산율로 갈음하고 안전 여유 '
            + `${MORE.SAFETY}% 를 얹었습니다. 999 를 넘지는 않지만 포인트를 조금 손해 봅니다.</span>`
          : '');
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
        $('mc-tab').innerHTML = ''; $('mc-one').textContent = '';
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
  $('mc-cur').innerHTML = CURS.map(c => `<option>${esc(c)}</option>`).join('');
  $('mc-cur').value = 'USD';
  const now = MORE.kstNow();
  $('mc-when').value = now;
  $('mc-when').max = now;
  $('mc-when').min = MORE.kstDay(Date.now() - BACK_DAYS * 864e5) + 'T00:00';

  $('mc-form').addEventListener('input', e => {
    if (e.target.id === 'mc-amt') { draw(); return; }   // 금액만 바뀌면 다시 안 부른다
    if (e.target.id === 'mc-cur') $('mc-amt').value = '';
    load();
  });
  load();
})();
