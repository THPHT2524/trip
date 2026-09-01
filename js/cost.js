/* cost.js — 비용. 일정에 붙어 있는 금액을 모아서 센다.
   ─────────────────────────────────────────────────────────────────────────
   ★별도 표가 없다. 여행 지출은 대부분 '어디서 쓴 것' 이라 일정 한 줄에 담았고
     (트리플 가계부도 결국 일정에 붙어 있다), 여기서는 그 줄들을 모아 보여주기만 한다.

   ★★**원화로 환산된 것만** 더한다. 환율이 없는 줄을 섞으면 **엔과 원을 더하는 셈**이 된다.
     빠진 줄은 감추지 않고 따로 세워 두고, 그 자리에서 환율을 채울 수 있게 한다
     (그 날짜의 종가를 api/fx 가 가져온다 — 사람이 고칠 수 있다).

   ★정산은 하지 않는다. '누가 얼마 냈나' 까지다 — 누가 누구에게 얼마를 줘야 하는지는
     분담 규칙이 금방 불어나서 그것만으로 앱 하나 크기가 된다(README 의 '안 하기로 한 것'). */
const Cost = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  const KINDS = ['숙소', '식사', '관광', '이동', '쇼핑', '기타'];
  const KVAR = { 숙소: 'k-stay', 식사: 'k-eat', 관광: 'k-see', 이동: 'k-move', 쇼핑: 'k-buy', 기타: 'k-etc' };

  let trip = null, rows = [], crew = [];

  /* 이 줄이 **원화로** 얼마인가. 낼 수 없으면 null 이고, null 은 합계에 안 들어간다. */
  function inBase(r) {
    if (r.cost == null) return null;
    if (r.cost_cur === U.SETTLE) return +r.cost;
    if (r.fx) return +r.cost * +r.fx;
    return null;
  }
  const has = r => r.cost != null;

  function group(keyOf) {
    const m = new Map();
    rows.filter(has).forEach(r => {
      const k = keyOf(r);
      const v = inBase(r);
      const cur = m.get(k) || { sum: 0, n: 0, miss: 0 };
      if (v == null) cur.miss += 1; else cur.sum += v;
      cur.n += 1;
      m.set(k, cur);
    });
    return m;
  }

  const bar = (v, max) =>
    `<span class="cbar"><i style="width:${max > 0 ? Math.round(v / max * 100) : 0}%"></i></span>`;

  function table(title, entries, colorOf) {
    if (!entries.length) return '';
    const max = Math.max(...entries.map(e => e[1].sum));
    return `<section class="cblock">
      <h3 class="chd">${esc(title)}</h3>
      <ul class="clist">${entries.map(([k, v]) => `
        <li${colorOf ? ` style="--k: var(--${colorOf(k)})"` : ''}>
          <span class="ck">${esc(k)}<em>${v.n}</em></span>
          ${bar(v.sum, max)}
          <span class="cv">${esc(U.money(v.sum, U.SETTLE))}</span>
          ${v.miss ? `<span class="cn">${v.miss}건 환율 없음</span>` : ''}
        </li>`).join('')}</ul>
    </section>`;
  }

  /* ── 하루에 얼마씩 ──────────────────────────────────────────────────────
     ★가로축이 **여행 카드의 미니 레일·일정 탭의 Day 탭과 같은 것**이다. 같은 날이 같은
       자리에 선다 — 화면을 옮겨 다녀도 '3일차' 가 늘 같은 칸이다.
     ★기둥 높이는 그날 쓴 돈, 색은 무엇에 썼는지. 둘을 한 그림에 담으므로
       '날짜별' 과 '구분별' 목록을 따로 세울 필요가 없다(전에는 둘 다 있었고,
       하루짜리 여행에서는 날짜별 막대가 자기 자신과 100% 비교라 아무 말도 안 했다).
     ★빈 날은 바닥에 가는 선만 남긴다 — 미니 레일과 같은 어법이다. */
  function dayBars() {
    const days = tripDays();
    if (days.length < 2) return '';        // 하루뿐이면 견줄 것이 없다
    const per = days.map(d => {
      const list = rows.filter(r => r.on_date === d && has(r));
      let sum = 0; const byK = {};
      list.forEach(r => {
        const v = inBase(r); if (v == null) return;
        sum += v; byK[r.kind] = (byK[r.kind] || 0) + v;
      });
      return { d, sum, byK };
    });
    const max = Math.max(...per.map(x => x.sum));
    if (!max) return '';
    const wide = days.length <= 6;         // 좁으면 금액을 적지 않는다 — 겹치느니 뺀다

    return `<section class="cblock">
      <h3 class="chd">하루에 얼마씩</h3>
      <div class="daybars">${per.map((x, i) => `
        <div class="dbar">
          <span class="col">${x.sum ? KINDS.filter(k => x.byK[k]).map(k =>
            `<i style="--k: var(--${KVAR[k]}); height:${(x.byK[k] / max * 100).toFixed(1)}%"></i>`
          ).join('') : '<em></em>'}</span>
          <span class="lb">D${i + 1}</span>
          ${wide ? `<span class="amt">${x.sum ? esc(U.money(x.sum, U.SETTLE)) : ''}</span>` : ''}
        </div>`).join('')}</div>
    </section>`;
  }

  /* 여행 기간이 있으면 빈 날도 센다 — 안 쓴 날도 '하루에 얼마씩' 의 일부다 */
  function tripDays() {
    const has2 = [...new Set(rows.map(r => r.on_date))].sort();
    if (!trip.start_on || !trip.end_on) return has2;
    const out = [];
    for (let d = trip.start_on; d <= trip.end_on && out.length < 31; d = U.addDays(d, 1)) out.push(d);
    has2.forEach(d => { if (!out.includes(d)) out.push(d); });
    return out.sort();
  }

  function draw() {
    const paid = rows.filter(has);
    const total = paid.reduce((s, r) => s + (inBase(r) || 0), 0);
    const miss = paid.filter(r => inBase(r) == null);

    /* ★'3건 · ¥2,400' 처럼 적으면 셋을 더해 2,400 인 줄 읽힌다. 실제로는 하나가 빠졌다.
       센 것과 빠진 것을 갈라 적는다. */
    $('cost-total').innerHTML = paid.length
      ? `<span class="big">${esc(U.money(total, U.SETTLE))}</span>
         <span class="sub">${paid.length - miss.length}건 합산 · 원화 기준`
         + (miss.length ? ` · <span class="warn">${miss.length}건 환율 없음</span>` : '')
         + '</span>'
      : '<span class="sub">아직 비용을 적은 일정이 없습니다</span>';

    const byKind = KINDS.map(k => [k, group(r => r.kind).get(k)])
      .filter(e => e[1]).sort((a, b) => b[1].sum - a[1].sum);
    const byPayer = [...group(r => r.payer_id || '').entries()]
      .map(([id, v]) => [id ? (Crew.nameOf(crew, id) || '알 수 없음') : '안 적음', v])
      .sort((a, b) => b[1].sum - a[1].sum);

    $('cost-blocks').innerHTML =
        dayBars()
      + table('무엇에', byKind, k => KVAR[k] || 'k-etc')
      + (byPayer.length > 1 || (byPayer[0] && byPayer[0][0] !== '안 적음')
          ? table('누가 냈나', byPayer) : '');

    /* 환율이 없어 합계에서 빠진 줄 — 감추지 않는다. 그 자리에서 채울 수 있게 한다. */
    $('cost-miss').innerHTML = miss.length ? `
      <section class="cblock warnblock">
        <h3 class="chd">환율이 없어 합계에서 빠진 ${miss.length}건</h3>
        <ul class="clist">${miss.map(r => `
          <li>
            <span class="ck">${esc(r.name)}</span>
            <span class="cv">${esc(U.money(r.cost, r.cost_cur))}</span>
            <button class="act" type="button" data-fx="${esc(r.id)}">환율 채우기</button>
          </li>`).join('')}</ul>
        <p class="hint">그 날짜의 <b>전신환매도율</b>을 가져와 원화로 환산합니다. 값은 고칠 수 있습니다.</p>
        ${miss.length > 1 ? '<button class="btn sm" type="button" data-fxall>모두 채우기</button>' : ''}
      </section>` : '';
  }

  /* 한 줄의 환율을 그 날짜 종가로 채운다.
     ★주말·공휴일에는 고시가 없다 — 그때는 직전 거래일 값을 쓰고 그렇게 적는다. */
  async function fillFx(id, quiet) {
    const r = rows.find(x => x.id === id);
    if (!r) return;
    const btn = document.querySelector(`[data-fx="${id}"]`);
    if (btn) { btn.disabled = true; btn.textContent = '가져오는 중…'; }
    try {
      /* ★전신환매도율(TTS)로 채운다 — 카드로 긁으면 매매기준율이 아니라 이 언저리로 청구된다.
         매매기준율로 계산하면 실제보다 싸게 나온다(엔 기준 약 1%). */
      const got = await DB.fx(r.on_date, r.cost_cur, U.SETTLE, 'tts');
      await DB.items.update(id, { ...DB.items.shape(r), fx: got.rate });
      $('cost-msg').textContent = got.exact
        ? `${r.cost_cur} → ${U.SETTLE} ${got.rate} (${got.on} 종가)`
        : `${r.cost_cur} → ${U.SETTLE} ${got.rate} — ${r.on_date} 고시가 없어 ${got.on} 종가를 썼습니다`;
      r.fx = got.rate;                       // 모두 채우기가 다음 줄로 넘어가기 전에 반영
      if (!quiet) document.dispatchEvent(new CustomEvent('items:changed'));
    } catch (e) {
      $('cost-msg').textContent = e.message;
      if (btn) { btn.disabled = false; btn.textContent = '환율 채우기'; }
    }
  }

  /* ★여러 줄을 한 번에. 정산 통화를 원화로 바꾸면서 현지통화로 적어 둔 줄이 한꺼번에
     환율을 필요로 하게 됐다 — 하나씩 누르게 두면 그건 우리가 만든 일거리다.
     한 줄씩 순서대로 부른다(동시에 던지면 환율 프록시의 분당 상한에 걸린다). */
  async function fillAll() {
    const btn = document.querySelector('[data-fxall]');
    if (btn) { btn.disabled = true; btn.textContent = '가져오는 중…'; }
    const ids = rows.filter(r => r.cost != null && r.cost_cur !== U.SETTLE && !r.fx).map(r => r.id);
    for (const id of ids) { await fillFx(id, true); }
    document.dispatchEvent(new CustomEvent('items:changed'));
  }

  $('cost-miss').addEventListener('click', e => {
    if (e.target.closest('[data-fxall]')) { fillAll(); return; }
    const b = e.target.closest('[data-fx]');
    if (b) fillFx(b.dataset.fx);
  });

  return {
    /* keepMsg — 환율을 막 채우고 다시 그리는 길에서는 방금 띄운 안내를 지우지 않는다
       (지우면 '무슨 환율이 적용됐는지' 를 볼 새가 없다). */
    async open(t, list, keepMsg) {
      trip = t;
      rows = list || [];
      if (!keepMsg) $('cost-msg').textContent = '';
      try { crew = await Crew.of(t.id); } catch (e) { crew = []; }
      draw();
    },
  };
})();
