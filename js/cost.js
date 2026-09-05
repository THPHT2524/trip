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


  let trip = null, rows = [], crew = [];
  /* ★★영수증의 몸통은 **항목 목록**이다 — 가게 영수증이 그렇다. 날짜로만 나누고
     보기 전환은 두지 않는다: 묶어 본 것은 합계 밑의 한 줄 띠 셋이 한 번에 말한다. */

  /* ★셈은 js/money.js 한 곳에서만 한다. 홈·일정·여기가 같은 함수를 쓴다 —
     각자 세면 언젠가 갈린다(실제로 갈렸었다). 여기서는 결과만 읽는다. */
  let M = { per: new Map(), cash: { bal: 0, rate: null, cur: null } };
  function inBase(r) {
    const p = M.per.get(r.id);
    return (p && p.spend) ? p.krw : null;
  }
  /* 환전은 **지출이 아니다** — '무엇에·누가' 표에도, 건수에도 들어가지 않는다 */
  const has = r => r.cost != null && r.settle !== 'exchange';

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

  const bar = (v, max, k) =>
    `<span class="cbar"><i style="width:${max > 0 ? Math.round(v / max * 100) : 0}%${
      k ? `;--k: var(--${k})` : ''}"></i></span>`;

  /* ★★영수증의 줄. **점선이 이름과 금액을 잇는다** — 목록이 길어질수록 그 선이 값을 한다.
     수는 오른쪽에서 자릿수를 맞춰 세로로 읽히고(tabular-nums), 막대는 그 밑에 깔려
     비율을 말한다. 정확한 수는 정렬이, 비율은 막대가 맡는다 — 둘이 안 싸운다. */
  /* ★묶음 줄의 금액에는 **기호를 안 찍는다.** 여기 오는 수는 전부 원화로 환산된
     것이고, 통화는 맨 아래 TOTAL 이 한 번 말한다 — 영수증도 한 종이에 기호를
     스무 번 찍지 않는다(항목 목록은 다르다: 거기는 엔·달러가 섞여 있어 기호가 정보다). */
  function line(name, sub, sum, max, kv, miss, bars) {
    return `<li${kv ? ` style="--k: var(--${kv})"` : ''}>
      <span class="rl">
        ${kv ? '<span class="rk"></span>' : ''}
        <span class="rn">${esc(name)}</span>
        ${sub ? `<em>${esc(sub)}</em>` : ''}
        <span class="rd"></span>
        <span class="rv">${sum ? esc(plain(sum, U.SETTLE)) : '—'}</span>
      </span>
      ${bars || bar(sum, max, kv)}
      ${miss ? `<span class="cn">${miss}건 환율 없음</span>` : ''}
    </li>`;
  }

  /* 단가는 **기호 없이** 숫자만. 통화는 오른쪽 금액이 한 번 말한다 —
     영수증도 한 줄에 기호를 두 번 찍지 않는다. */
  const plain = (v, cur) => (v == null || !Number.isFinite(+v)) ? ''
    : (+v).toLocaleString('ko-KR', { maximumFractionDigits: (cur === 'KRW' || cur === 'JPY') ? 0 : 2 });

  /* 항목 — 결제 줄 하나가 한 줄. 어디서 쓴 것인지(부모 장소)가 이름이고,
     무엇에 쓴 것인지(줄 이름)가 곁말이다. 영수증에서 품명과 규격의 사이다. */
  function items() {
    const paid = rows.filter(has);
    if (!paid.length) return '';
    const par = new Map(rows.map(r => [r.id, r]));

    /* ★★장소 한 줄, 그 밑에 산 것들이 들여선다 — 영수증의 짜임 그대로다.
       우리 데이터가 이미 그 모양이다(장소 한 줄에 결제 여럿이 parent_id 로 붙는다).
       ★'└' 같은 가지 글자는 안 그린다(2026-09-05). 들여쓴 것만으로 딸린 줄인 줄 알고,
         글자를 하나 더 얹으면 금액 기둥 앞이 시끄러워진다. */
    const groups = new Map();
    paid.slice()
      .sort((a, b) => String(a.on_date).localeCompare(String(b.on_date))
                   || String(a.at_time || '').localeCompare(String(b.at_time || '')))
      .forEach(r => {
        const p = r.parent_id ? par.get(r.parent_id) : null;
        const key = p ? p.id : r.id;
        if (!groups.has(key)) groups.set(key, { head: p || r, kids: [] });
        groups.get(key).kids.push(r);
      });

    const one = (r, branch) => {
      const q = Math.max(1, +r.qty || 1);
      const v = inBase(r);
      return `<span class="rq${branch ? ' br' : ''}">
        ${branch ? `<span class="rb">${esc(r.name)}</span>` : ''}
        <span class="ru">${esc(U.money(r.cost / q, r.cost_cur))}</span>
        <span class="rx">× ${q}</span>
        <span class="rd"></span>
        <span class="rv${v == null ? ' na' : ''}">${esc(U.money(r.cost, r.cost_cur))}</span>
      </span>`;
    };

    /* ★날짜로 나눈다. 영수증에 'ITEMS' 라고 적힌 것을 본 적이 없다 — 그 자리에는
       **언제 산 것인지**가 온다. 하루짜리 여행이면 나눌 것이 없으니 안 긋는다. */
    const byDay = new Map();
    [...groups.values()].forEach(g => {
      const d = g.head.on_date;
      if (!byDay.has(d)) byDay.set(d, []);
      byDay.get(d).push(g);
    });
    const many = byDay.size > 1;

    return [...byDay.entries()].map(([d, gs]) => {
      const li = gs.map(g => {
        /* 딸린 결제가 하나뿐이고 이름이 부모의 구분과 같으면 들여쓰지 않는다 —
           '식사' 밑에 '식사' 는 같은 말을 두 번 하는 것이다. */
        const solo = g.kids.length === 1
          && (g.kids[0].id === g.head.id || g.kids[0].name === g.head.kind);
        return `<li style="--k: var(--${U.kvar(g.head.kind)})">
          <span class="rl"><span class="rk"></span><span class="rn">${esc(g.head.name)}</span></span>
          ${g.kids.map(r => one(r, !solo)).join('')}
        </li>`;
      }).join('');
      return `<section class="cblock">
        ${many ? `<h3 class="chd rday">${esc(U.md(d))} ${esc(U.dowOf(d))}</h3>` : ''}
        <ul class="clist tight">${li}</ul></section>`;
    }).join('');
  }

  /* ★★환전은 **지출이 아니다** — 돈이 줄지 않고 모양만 바뀐다. 그래서 합계에도
     '무엇에·누가' 에도 안 들어간다. 그런데 여행에서 제일 자주 되짚는 수 중 하나가
     '언제 얼마 바꿨더라' 라서, 영수증 아래에 **따로 한 칸**을 낸다(2026-09-05).
     지출 목록과 섞지 않고, 제 소계를 제가 낸다. */
  function exchanges() {
    const ex = rows.filter(r => r.settle === 'exchange' && r.cost != null)
      .sort((a, b) => String(a.on_date).localeCompare(String(b.on_date))
                   || String(a.at_time || '').localeCompare(String(b.at_time || '')));
    if (!ex.length) return '';
    let got = 0, krw = 0, cur = null;
    const li = ex.map(r => {
      const v = (r.fx != null) ? r.cost * r.fx : null;
      got += r.cost; if (v != null) krw += v; cur = r.cost_cur || cur;
      /* ★한 줄이다. 여기엔 '이름' 이 없어서(장소가 아니라 날짜가 주어다) 두 층으로
         나눌 것이 없다 — 나눠 봤더니 줄 사이가 헐렁하기만 했다(2026-09-05). */
      return `<li>
        <span class="rq ex">
          <span class="ed">${esc(U.md(r.on_date))}</span>
          ${r.at_time ? `<span class="et">${esc(String(r.at_time).slice(0, 5))}</span>` : ''}
          <span class="ru">${esc(U.money(r.cost, r.cost_cur))}</span>
          <span class="rx">${r.fx != null ? (+r.fx).toFixed(2) + '원' : '환율 없음'}</span>
          <span class="rd"></span>
          <span class="rv${v == null ? ' na' : ''}">${v == null ? '—' : esc(U.money(v, U.SETTLE))}</span>
        </span>
      </li>`;
    }).join('');
    return `<section class="cblock exblock"><h3 class="chd">Exchange</h3>
      <ul class="clist tight">${li}</ul>
      <div class="exsum">
        <span class="l">${esc(U.money(got, cur))}</span>
        <span class="rd"></span>
        <span class="v">${esc(U.money(krw, U.SETTLE))}</span>
      </div></section>`;
  }

  function table(title, entries, colorOf) {
    if (!entries.length) return '';
    const max = Math.max(...entries.map(e => e[1].sum));
    return `<section class="cblock">
      <h3 class="chd">${esc(title)}</h3>
      <ul class="clist">${entries.map(([k, v]) =>
        line(k, v.n ? v.n + '건' : '', v.sum, max, colorOf ? colorOf(k) : null, v.miss)).join('')}</ul>
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
    const days = dayList();
    if (days.length < 2) return '';        // 하루뿐이면 견줄 것이 없다
    const per = days.map(d => {
      const list = rows.filter(r => r.on_date === d && has(r));
      let sum = 0, n = 0; const byK = {};
      list.forEach(r => {
        const v = inBase(r); n += 1; if (v == null) return;
        sum += v; byK[r.kind] = (byK[r.kind] || 0) + v;
      });
      return { d, sum, n, byK };
    });
    const max = Math.max(...per.map(x => x.sum));
    if (!max) return '';

    return `<section class="cblock">
      <h3 class="chd">By day</h3>
      <ul class="clist">${per.map((x, i) => {
        /* ★막대는 **쌓아서** 그린다. 세로 기둥이던 시절부터 지켜 온 것이다 —
           그날 얼마 썼는지(길이)와 무엇에 썼는지(색)를 한 그림이 같이 말한다.
           가로로 눕히면서 그 성질을 잃으면 줄만 늘고 정보는 준다. */
        const seg = U.KINDS.filter(k => x.byK[k]).map(k =>
          `<i style="width:${(x.byK[k] / max * 100).toFixed(1)}%;--k: var(--${U.kvar(k)})"></i>`
        ).join('');
        /* 곁말은 그 날의 날짜다 — 'D1' 만으로는 며칟날인지 모른다(일정 탭의 띠는
           'DAY 1 08.29 토' 라고 말한다). 같은 물음에 같은 답을 준다. */
        return line(`D${i + 1}`, U.md(x.d), x.sum, max, null, 0,
          `<span class="cbar stack">${seg}</span>`);
      }).join('')}</ul>
    </section>`;
  }

  /* 여행 기간이 있으면 빈 날도 센다 — 안 쓴 날도 '하루에 얼마씩' 의 일부다.
     ★이름이 U.tripDays 와 같았다. 그쪽은 **일수(숫자)** 를 주고 이쪽은 **날짜 목록**이라,
       한 글자도 안 겹치는 두 가지가 같은 이름을 쓰고 있었다(2026-09-03).
     ★app.js 의 dayList 와는 사촌이지만 규칙이 다르다 — 저쪽은 21일에서 자르고 기간
       밖 날짜를 버린다(카드의 미니 레일이 그보다 길어질 수 없다). 여기는 31일까지
       세고 기간 밖에 적힌 날도 도로 넣는다 — 합계에서 돈이 사라지면 안 되기 때문이다.
       규칙이 다르니 합치지 않는다. 한 함수에 깃발을 달면 둘 다 읽기 어려워진다. */
  function dayList() {
    const has2 = [...new Set(rows.map(r => r.on_date))].sort();
    if (!trip.start_on || !trip.end_on) return has2;
    const out = [];
    for (let d = trip.start_on; d <= trip.end_on && out.length < 31; d = U.addDays(d, 1)) out.push(d);
    has2.forEach(d => { if (!out.includes(d)) out.push(d); });
    return out.sort();
  }

  /* ★★합계 밑의 **한 줄 띠 셋**. 영수증 아래에 붙는 요약이다 — 같은 돈을 세 각도로
     한 번씩만 보여 준다. 목록 세 벌을 세우면 같은 수를 세 번 세어 놓고 어느 것이
     답인지 안 말해 주는데, 띠 한 줄이면 '비율' 만 말하고 정확한 수는 위 항목이 말한다.
   ★조각 안에 이름을 적는다 — 좁으면(12% 미만) 뺀다. 밖에 범례를 세우면 줄이 는다. */
  function strip(label, parts) {
    const sum = parts.reduce((a, p) => a + p.v, 0);
    if (!sum) return '';
    return `<div class="rstrip"><span class="sl">${esc(label)}</span>
      <span class="sb">${parts.filter(p => p.v > 0).map(p => {
        const pct = p.v / sum * 100;
        return `<i style="width:${pct.toFixed(2)}%;--k:${p.k}"
          >${pct >= 12 ? `<b>${esc(p.n)}</b>` : ''}</i>`;
      }).join('')}</span></div>`;
  }
  /* 날·사람에는 정해진 색이 없다 — 코발트 한 색을 옅기로 층을 낸다.
     kind 색을 빌려 쓰면 'BY DAY' 와 'BY KIND' 가 같은 그림으로 보인다. */
  const tone = i => `color-mix(in srgb, var(--route) ${Math.max(26, 100 - i * 26)}%, var(--sunk))`;

  /* ★★바코드를 **이 여행의 수**로 그린다(2026-09-05). 아무 수나 박아 두면 그건 그림
     이지만, 출발·도착 날짜에서 뽑으면 종이마다 다른 무늬가 나온다 — 영수증마다
     바코드가 다른 것과 같은 이치다. 읽으라고 있는 것이 아니라 '이 종이의 것' 이라는
     표시다. 막대 굵기도 그 수에서 나온다. */
  function barcode() {
    const d = (t) => String(t || '').replace(/-/g, '').slice(2);
    const code = (d(trip && trip.start_on) + d(trip && trip.end_on)) || '000000000000';
    const bars = [...code].map(n => {
      const w = 1 + (+n % 4);            // 1~4px — 굵기가 그 자리 숫자다
      const g = 1 + ((+n + 2) % 3);      // 사이 틈도 마찬가지
      return `<i style="width:${w}px"></i><u style="width:${g}px"></u>`;
    }).join('');
    $('cost-bc').innerHTML = `<i style="width:2px"></i><u style="width:2px"></u>${bars}`
                           + '<i style="width:2px"></i>';
    $('cost-bn').textContent = `*${code}*`;
  }

  function draw() {
    M = MONEY.total(rows, FXS.rateOf);                     // 현금 지갑까지 한 번에 — 아래는 결과만 읽는다
    const paid = rows.filter(has);
    const total = paid.reduce((s, r) => s + (inBase(r) || 0), 0);
    const miss = paid.filter(r => inBase(r) == null);

    /* ★'3건 · ¥2,400' 처럼 적으면 셋을 더해 2,400 인 줄 읽힌다. 실제로는 하나가 빠졌다.
       센 것과 빠진 것을 갈라 적는다. */
    /* ★합계는 영수증의 맨 아래다 — 위에 놓았던 큰 수를 내렸다. 영수증은 항목을 다
       찍고 마지막에 합을 낸다. 그 순서가 곧 '이 수가 어디서 왔는지' 를 말한다. */
    /* ★곁말에서 'n건 합산 · 원화 기준' 을 뺐다(2026-09-06). 건수는 바로 위 머리에
       ITEMS 로 이미 서 있고, ₩ 기호가 원화라는 것을 말한다 — 같은 말을 세 번 했다.
       못 센 줄만 남긴다. 그건 어디에도 안 적혀 있고, 합계가 틀렸다는 뜻이다. */
    $('cost-total').innerHTML = paid.length
      ? `<span class="tl">TOTAL</span>
         <span class="big">${esc(U.money(total, U.SETTLE))}</span>`
         + (miss.length ? `<span class="sub"><span class="warn">${miss.length}건 환율 없음</span></span>` : '')
      : '<span class="sub">아직 비용을 적은 일정이 없습니다</span>';

    const byKind = U.KINDS.map(k => [k, group(r => r.kind).get(k)])
      .filter(e => e[1]).sort((a, b) => b[1].sum - a[1].sum);
    /* ★'각자 냄' 은 한 사람에게 몰지 않는다 — 교통카드처럼 각자 자기 걸로 찍은 줄이라
       동행자 수로 나눠 각자에게 붙인다. 동행자를 모르면(혼자거나 못 받았으면) 나눌 곳이
       없으므로 '각자 냄' 이라는 한 칸으로 남긴다 — 없는 사람에게 배분하지 않는다. */
    const pm = new Map();
    const put = (k, krw, miss) => {
      const c = pm.get(k) || { sum: 0, n: 0, miss: 0 };
      if (miss) c.miss += 1; else c.sum += krw;
      c.n += 1; pm.set(k, c);
    };
    const crewIds = crew.map(m => m.user_id);
    rows.filter(has).forEach(r => {
      const v = inBase(r);
      MONEY.shares(r, v, crewIds).forEach(s => {
        const label = s.id ? (Crew.nameOf(crew, s.id) || '알 수 없음')
                    : (s.group ? `각자 냄 ${s.group}명` : '안 적음');
        put(label, s.krw, v == null);
      });
    });
    const byPayer = [...pm.entries()].sort((a, b) => b[1].sum - a[1].sum);

    $('cost-blocks').innerHTML = items();
    $('cost-ex').innerHTML = exchanges();
    barcode();

    /* 요약 띠 — 날·구분·사람. '사람' 은 혼자 다녀서 한 칸뿐이면 아무 말도 안 하므로 뺀다. */
    const dayParts = dayList().map((d, i) => ({
      n: `D${i + 1}`, k: tone(i),
      v: rows.filter(r => r.on_date === d && has(r)).reduce((a, r) => a + (inBase(r) || 0), 0),
    }));
    const hasPayer = byPayer.length > 1 || (byPayer[0] && byPayer[0][0] !== '안 적음');
    $('cost-strips').innerHTML =
        strip('BY DAY', dayParts)
      + strip('BY KIND', byKind.map(([k, v]) => ({ n: k, k: `var(--${U.kvar(k)})`, v: v.sum })))
      + (hasPayer ? strip('BY PERSON',
          byPayer.map(([k, v], i) => ({ n: k, k: tone(i), v: v.sum }))) : '');

    /* 영수증 머리 — 가게 이름 자리에 **무슨 영수증인지**. 여행 이름은 바로 위
       머리말에 이미 크게 서 있다(2026-09-06) — 두 줄 사이에서 같은 말이 겹쳤다. */
    $('cost-head').innerHTML = paid.length
      ? `<span class="rnm">EXPENSES</span>
         <span class="rsb">${esc(U.range(trip.start_on, trip.end_on))} · ${paid.length} ITEMS</span>`
      : '';

    /* 환율이 없어 합계에서 빠진 줄 — 감추지 않는다. 그 자리에서 채울 수 있게 한다. */
    /* 지갑에 남은 현금 — 환전을 적기 시작하면 제일 먼저 궁금해지는 숫자다 */
    const c = M.cash;
    /* ★영수증 안에서는 라벨이 먼저다 — TOTAL 과 같은 어법(작은 대문자 mono).
       '남은 현금' 을 뒤에 달면 값·라벨·곁말 셋이 한 줄에 안 들어가 접힌다. */
    $('cost-wallet').innerHTML = (c && c.bal > 0.5) ? `
      <div class="wallet">
        <span class="wl">CASH LEFT</span>
        <span class="wv">${esc(U.money(c.bal, c.cur))}</span>
        <span class="wr">평균 ${(c.rate || 0).toFixed(2)}원 · 원가 ${esc(U.money(c.paid, U.SETTLE))}</span>
      </div>` : '';

    $('cost-miss').innerHTML = miss.length ? `
      <section class="cblock warnblock">
        <h3 class="chd">환율이 없어 합계에서 빠진 ${miss.length}건</h3>
        <ul class="clist">${miss.map(r => `
          <li>
            <span class="ck">${esc(r.name)}</span>
            <span class="cv">${esc(U.money(r.cost, r.cost_cur))}</span>
            <button class="act" type="button" data-fx="${esc(r.id)}">환율 채우기</button>
          </li>`).join('')}</ul>
        <p class="hint">그 날짜의 <b>전신환매도율</b>을 가져옵니다. 실제 청구는 카드사 매입일 고시로 잡혀 조금 다를 수 있습니다 — 값은 고칠 수 있습니다.</p>
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
      /* ★환율 종류는 매매기준율이 아니라 **전신환매도율(TTS)** 이다 — 카드로 긁으면
         그 언저리로 청구된다(엔 기준 약 1% 차이: 858.18 vs 866.59).
       ★날짜는 **긁은 날**을 쓴다. 실제 청구는 카드사 매입일(3~5영업일 뒤) 고시로
         잡히지만 며칠 뒤인지는 알 수 없고, 최근 결제면 그 날짜 고시가 아직 없다.
         알 수 없는 날짜를 지어내느니 아는 날짜를 쓴다 — 어차피 fx 칸을 고치면 그게 이긴다. */
      const got = await DB.fx(r.on_date, r.cost_cur, U.SETTLE, 'tts');
      await DB.items.update(id, { ...DB.items.shape(r), fx: got.rate });
      $('cost-msg').textContent = got.exact
        ? `${r.cost_cur} → ${U.SETTLE} ${got.rate} — ${got.on} 전신환매도율`
        : `${r.cost_cur} → ${U.SETTLE} ${got.rate} — ${r.on_date} 고시가 없어 ${got.on} 값을 썼습니다`;
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
