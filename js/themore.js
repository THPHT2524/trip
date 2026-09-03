/* themore.js — /themore 한 장짜리 화면. **여행에 딸리지 않은 도구**라 제 주소에 산다.
   ─────────────────────────────────────────────────────────────────────────
   셈은 js/more.js 한 곳에서만 한다(money.js 와 같은 규칙). 여기는 화면뿐이다.
   환율은 api/more.js 가 신한은행 고시표에서 1회차를 받아 온다.

   ★★**로그인이 없다.** 앱의 다른 화면과 다른 점이다 — 여기서 오가는 것은 공개 고시환율
     뿐이라 지킬 개인 정보가 없다. 그래서 supabase 번들도 db.js 도 안 싣고, /api/more 를
     그냥 부른다. 주소만 알면 폰에서 바로 열린다.

   ★비자 환율만 우리가 못 가져온다. 비우면 신한 **대미환산율**로 갈음하고 안전 여유를
     얹는다(MORE.SAFETY). 직접 넣으면 그 값이 이기고 여유도 안 쓴다 —
     trip 이 일정 줄의 `fx` 칸에 쓰는 규칙과 같다: **적으면 그게 이기고, 비면 자동.**

   ★고른 통화와 보정값은 기억한다. 비자 환율도 기억하되 **고시일자와 함께** 두고,
     날이 바뀌면 버린다 — 어제 환율로 오늘 답을 내면 조용히 틀린다. */
(function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  const KEY = 'trip.more.v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };

  let rate = null;                       // { on, at, round, tt, mid, usd }

  /* 신한이 고시하는 통화 중 **실제로 카드로 긁을 만한 것**만 고른다.
     마흔넷을 다 세우면 고르는 일이 일이 된다. 없는 통화가 필요해지면 여기 한 줄 늘린다. */
  const CURS = ['JPY', 'USD', 'EUR', 'CNY', 'TWD', 'HKD', 'THB', 'VND', 'SGD',
                'MYR', 'IDR', 'PHP', 'AED', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD'];

  function draw() {
    if (!rate) return;
    const cur = $('mc-cur').value;
    const pad = +$('mc-pad').value || 0;
    saved.cur = cur; saved.pad = $('mc-pad').value; keep();

    /* 달러는 바꿀 것이 없다 — 비자 환율이 1 이라 늘 정확하다. 칸을 아예 감춘다. */
    const isUsd = cur === 'USD';
    $('mc-visabox').hidden = isUsd;
    const auto = isUsd ? 1 : rate.usd[cur];
    const typed = isUsd ? null : parseFloat($('mc-visa').value);
    const exact = isUsd || (typed > 0);
    const visa = exact ? (isUsd ? 1 : typed) : MORE.hedge(auto);

    $('mc-visahint').innerHTML = isUsd
      ? '달러는 비자가 바꿀 것이 없어 <b>언제나 정확합니다</b>.'
      : exact
        ? '넣어 주신 값으로 셉니다 — <b>안전 여유 없이 딱 맞습니다</b>.'
        : (auto > 0
            ? `비우면 신한 대미환산율 <b>${auto.toPrecision(8)}</b> 로 갈음하고 `
              + `안전 여유 ${MORE.SAFETY}% 를 얹습니다. 비자 환율을 넣으면 여유 없이 맞습니다.`
            : `${esc(cur)} 는 신한 고시에 없어 비자 환율을 직접 넣어야 합니다.`);

    if (!(visa > 0)) { $('mc-tab').innerHTML = ''; $('mc-one').textContent = ''; return; }
    $('mc-amt').placeholder = cur;

    /* 정방향 — '이만큼 긁으면 얼마 찍히나'. 보정은 여기에도 먹인다(같은 최악의 경우). */
    const amt = parseFloat($('mc-amt').value);
    const one = amt > 0 ? MORE.bill(amt, visa, rate.tt * (1 + pad / 100), rate.mid) : null;
    $('mc-one').innerHTML = one
      ? `<b>${esc(U.money(one.krw, U.SETTLE))}</b> 청구 · `
        + (one.point ? `${one.point.toLocaleString('ko-KR')}P 적립 · `
                     : `적립 없음(${MORE.MIN.toLocaleString('ko-KR')}원 미만) · `)
        + `<span class="${one.gain < 0 ? 'warn' : ''}">이득 ${one.gain.toFixed(1)}%</span>`
      : '';

    /* 역방향 — 목표 청구금액마다 '얼마를 부르면 되나'. 여기가 계산기의 본체다. */
    const list = MORE.targets().map(t => {
      const s = MORE.solve(t, visa, rate.tt, cur, pad);
      if (!s) return null;
      const b = MORE.bill(s.foreign, visa, s.rate, rate.mid);
      return b ? { f: s.foreign, b } : null;
    }).filter(Boolean);

    $('mc-tab').innerHTML = list.length ? `
      <table class="mtab">
        <thead><tr><th>긁을 금액</th><th>청구</th><th>적립</th><th>이득</th></tr></thead>
        <tbody>${list.map(x => `
          <tr>
            <th scope="row">${esc(U.money(x.f, cur))}</th>
            <td>${x.b.krw.toLocaleString('ko-KR')}</td>
            <td>${x.b.point.toLocaleString('ko-KR')}<em>P</em></td>
            <td class="${x.b.gain < 0 ? 'warn' : ''}">${x.b.gain.toFixed(1)}%</td>
          </tr>`).join('')}</tbody>
      </table>` : '';

    /* ★어느 환율로 셌는지 반드시 적는다. 이 계산기는 환율이 틀리면 통째로 틀린다.
       ★오늘 고시가 아니면(주말·공휴일, 또는 아침 고시 전) 그렇게 말한다. */
    const stale = rate.on !== MORE.kstDay();
    $('mc-src').innerHTML =
      `신한 USD/KRW <b>${rate.tt.toLocaleString('ko-KR')}</b> · ${rate.round}회차 `
      + `${esc(rate.on)} ${esc(rate.at || '')}`
      + (stale ? ' <span class="warn">— 오늘 고시가 아닙니다</span>' : '')
      + (isUsd ? '' : ` · 비자 ${esc(cur)} ${visa.toPrecision(8)}${exact ? '' : ' (갈음)'}`)
      + (pad ? ` · 보정 ${pad}% — <b>표의 청구금액은 최악의 경우</b>입니다. 환율이 안 오르면 그보다 적게 찍힙니다.` : '');
  }

  async function load() {
    $('mc-src').textContent = '환율을 가져오는 중…';
    try {
      const day = MORE.kstDay();
      const r = await fetch(`/api/more?at=${encodeURIComponent(day)}`);
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(body.error || `환율을 가져오지 못했습니다 (${r.status})`);
      rate = body;
    } catch (e) {
      rate = null;
      $('mc-src').textContent = e.message;
      return;
    }
    /* 어제 넣어 둔 비자 환율은 버린다 — 고시가 바뀌었으면 그 값은 이제 남의 날 값이다. */
    if (saved.visaOn !== rate.on) { saved.visaOn = rate.on; saved.visa = {}; keep(); }
    $('mc-visa').value = (saved.visa && saved.visa[$('mc-cur').value]) || '';
    draw();
  }

  function start() {
    $('mc-cur').innerHTML = CURS.map(c => `<option>${esc(c)}</option>`).join('');
    $('mc-cur').value = CURS.includes(saved.cur) ? saved.cur : 'JPY';
    $('mc-pad').value = saved.pad || '';

    $('mc-form').addEventListener('input', e => {
      if (e.target.id === 'mc-cur') {
        $('mc-amt').value = '';
        $('mc-visa').value = (saved.visa && saved.visa[$('mc-cur').value]) || '';
      }
      if (e.target.id === 'mc-visa') {
        saved.visa = saved.visa || {};
        saved.visa[$('mc-cur').value] = $('mc-visa').value;
        keep();
      }
      draw();
    });
    load();
  }

  start();
})();
