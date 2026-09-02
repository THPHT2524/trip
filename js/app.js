/* app.js — 부팅과 화면 전환. 이 앱의 유일한 진입점이다.
   ─────────────────────────────────────────────────────────────────────────
   화면은 두 단계다. 앞선 두 프로젝트(card-dashboard·stock)는 한 단계짜리 탭 넷이었지만,
   여기는 **여행을 고른 뒤에야** 나머지가 뜻을 갖는다.

     /            여행 목록
     /t/<id>      일정   ← 여행 안의 첫 화면
     /t/<id>/map · /cost · /prep · /crew

   ★그래도 진행 중이거나 곧 시작할 여행이 있으면 **목록을 건너뛰고 바로 연다.**
     현지에서 앱을 여는 이유가 그 여행이지 목록이 아니다.

   ★경로 라우팅이다(해시가 아니다). OAuth 가 돌아오는 `?code=` 자리와 겹치지 않는다.
     vercel.json 의 `/t/(.*)` → `/index.html` 리라이트가 새로고침을 견디게 해 준다. */
(function () {
  const $ = id => document.getElementById(id);
  const TABS = ['plan', 'map', 'cost', 'prep', 'crew'];
  const SEG = { plan: '', map: 'map', cost: 'cost', prep: 'prep', crew: 'crew' };

  let trips = [];          // 마지막으로 받은 여행 목록
  let shape = [];          // 카드에 그릴 '여행의 모양' (일정의 날짜·구분·비용만)
  let tripId = null;       // 지금 열어 둔 여행
  let tab = 'plan';

  const KVAR = { 숙소: 'k-stay', 식사: 'k-eat', 관광: 'k-see', 이동: 'k-move', 쇼핑: 'k-buy', 기타: 'k-etc' };
  const DAYMS = 86400000;

  /* 문자열 이스케이프와 날짜·금액 서식은 util.js(U)에 있다 — plan.js 도 같은 것을 쓴다.
     이스케이프 규칙이 두 벌이 되면 한쪽만 고쳐지고, 그 한쪽으로 들어온 이름이 화면을 깨뜨린다. */
  const esc = U.esc;
  const fmtSpan = U.span;

  /* 진행 중 · 예정 · 지난 것. 날짜가 없는 여행은 '예정' 쪽에 둔다(아직 안 정한 것이지 지난 것이 아니다). */
  function phase(t) {
    const now = U.todayISO();
    if (t.start_on && t.end_on) {
      if (t.start_on <= now && now <= t.end_on) return 'now';
      return t.end_on < now ? 'past' : 'soon';
    }
    if (t.end_on) return t.end_on < now ? 'past' : 'soon';
    return 'soon';
  }

  // ── 라우팅 ────────────────────────────────────────────────────────────
  function readUrl() {
    const p = location.pathname.replace(/^\/+|\/+$/g, '').split('/');
    if (p[0] !== 't' || !p[1]) return { tripId: null, tab: 'plan' };
    const seg = p[2] || '';
    const found = TABS.find(k => SEG[k] === seg);
    return { tripId: p[1], tab: found || 'plan' };
  }

  function go(nextTripId, nextTab, push) {
    tripId = nextTripId || null;
    tab = nextTab || 'plan';
    if (push) {
      const want = tripId ? ('/t/' + tripId + (SEG[tab] ? '/' + SEG[tab] : '')) : '/';
      if (location.pathname !== want) history.pushState(null, '', want);
      window.scrollTo(0, 0);     // 판을 갈아 끼우는 방식이라 스크롤이 문서에 남는다
    }
    render();
  }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function render() {
    const inTrip = !!tripId;
    $('view-trips').hidden = inTrip;
    $('view-trip').hidden = !inTrip;
    $('tabs').hidden = !inTrip;
    document.body.dataset.view = inTrip ? 'trip' : 'trips';

    if (!inTrip) { renderTrips(); return; }

    const t = trips.find(x => x.id === tripId);
    /* ★머리말에는 국기를 안 단다. 작게 달면 윈도우에서 'JP' 두 글자로 떨어져
       글꼴이 깨진 것처럼 보인다 — 그래서 카드에서는 **크게 바탕에** 깔았다.
       그리고 여행 안에 들어와 있는 사람은 이미 어느 여행인지 안다(홈의 여권과
       카드 바탕이 그 일을 한다). 64px 머리말에 세 번째 표식을 넣지 않는다. */
    $('trip-name').textContent = t ? t.name : '여행';
    $('trip-span').textContent = t ? fmtSpan(t.start_on, t.end_on) : '';
    document.querySelectorAll('#tabs button').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.pane').forEach(p =>
      p.hidden = p.dataset.tab !== tab);

    /* 일정은 이 여행의 본체다 — 어느 탭으로 들어와도 먼저 받아 둔다.
       지도·비용은 **그 rows 를 넘겨받기만 한다** — 자기 것을 또 받지 않는다.
       (탭마다 따로 받으면 현지에서 탭 옮길 때마다 네트워크를 탄다.) */
    if (!t) return;
    Plan.open(t).then(() => {
      if (tab === 'map') Maps.open(t, Plan.rows());
      if (tab === 'cost') Cost.open(t, Plan.rows());
    });
    if (tab === 'prep') Prep.open(t);
    if (tab === 'crew') Crew.open(t);
  }

  function renderTrips() {
    const el = $('trips');
    if (!trips.length) {
      el.innerHTML = '<p class="empty"><strong>아직 여행이 없습니다</strong>'
                   + '새 여행을 만들거나, 받은 초대 링크를 여세요.</p>';
      return;
    }
    $('passport').innerHTML = passportHtml();

    const group = { now: [], soon: [], past: [] };
    trips.forEach(t => group[phase(t)].push(t));
    const label = { now: '지금', soon: '예정', past: '지난 여행' };

    el.innerHTML = ['now', 'soon', 'past'].filter(k => group[k].length).map(k =>
      `<h2 class="grouphd">${label[k]}</h2>` + group[k].map(t => card(t, k)).join('')
    ).join('');
  }

  /* ── 여권 ────────────────────────────────────────────────────────────────
     **지나온 것의 총량.** 목록 위에 한 줄로 선다.
     ★여기 세는 것은 전부 이미 갖고 있는 사실이다 — 지어내지 않는다:
       나라는 여행의 현지통화에서, 지역은 좌표를 15km 로 묶어서(GEO.areas),
       곳은 장소 줄 수, 일은 여행 기간의 합.
     ★여행이 하나도 없으면 아무 말도 안 한다. 0개국 0곳은 알려 줄 것이 없다. */
  /* 여권 아래 기계판독구역(MRZ). 진짜 여권처럼 44칸 두 줄에 `<` 로 채운다.
     ★장식이 아니라 **같은 사실을 다른 문법으로 한 번 더** 적은 것이다 — 위 격자가
       사람용이면 이건 도장 자국이다. 지어낸 값은 한 칸도 없다. */
  const MRZ = 44;
  const pad = (t) => (t + '<'.repeat(MRZ)).slice(0, MRZ);
  const mrzSafe = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]+/g, '<');
  function mrzLines(n) {
    const who = mrzSafe((DB.email() || '').split('@')[0]) || 'TRAVELLER';
    const money = n.spent ? U.SETTLE + Math.round(n.spent) : '';
    return [
      pad('P<KOR<' + who),
      pad([n.countries + 'C', n.areas + 'A', n.spots + 'P', n.days + 'D', money]
            .filter(Boolean).join('<')),
    ];
  }

  function passportHtml() {
    if (!trips.length) return '';
    const flags = [...new Set(trips.map(t => U.flag(t.base_cur)).filter(Boolean))];
    const n = { countries: flags.length, areas: 0, spots: 0, days: 0, spent: 0 };
    trips.forEach(t => {
      const mine = shape.filter(r => r.trip_id === t.id);
      const stops = mine.filter(r => !r.parent_id);
      n.areas += GEO.areas(stops);
      n.spots += stops.length;
      n.spent += MONEY.total(mine, FXS.rateOf).sum;
      if (t.start_on && t.end_on) {
        n.days += Math.round((Date.parse(t.end_on) - Date.parse(t.start_on)) / DAYMS) + 1;
      }
    });
    /* 값이 0 인 칸은 세우지 않는다 — 빈 칸의 이름을 읽히게 두지 않는다 */
    const cells = [
      ['나라', n.countries], ['지역', n.areas], ['장소', n.spots], ['일', n.days],
    ].filter(([, v]) => v);
    if (n.spent) cells.push(['쓴 돈', U.money(n.spent, U.SETTLE)]);
    if (!cells.length) return '';

    return `<section class="pass">
      ${flags.length ? `<div class="pflags" aria-hidden="true">${flags.join('')}</div>` : ''}
      <dl class="pgrid">${cells.map(([k, v]) =>
        `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
      <p class="pmrz" aria-hidden="true">${mrzLines(n).map(esc).join('<br>')}</p>
    </section>`;
  }

  /* ── 여행 카드 ──────────────────────────────────────────────────────────
     **여행 하나가 경로 하나라면, 카드는 그 경로의 축소판이어야 한다.**
     날짜 칸이 늘어서고 그 안에 장소구분 색 점이 찍힌다 — 며칠짜리인지, 어느 날이 비었는지,
     무슨 여행인지(식사 위주냐 관광 위주냐)가 카드만 보고 읽힌다.
     ★장식이 아니라 정보다. 일정 탭의 레일과 같은 색·같은 어법을 쓴다. */
  function card(t, phase) {
    const mine = shape.filter(r => r.trip_id === t.id);
    /* 미니 레일과 '일정 N' 은 **장소 줄만** 센다. 결제 줄(parent_id)은 부모 날짜를
       물려받으므로 같이 세면 점이 두 번 찍히고 개수가 부푼다 — 일정 탭과 같은 규칙이다.
       (합계는 mine 전체로 낸다 — 결제 줄에도 돈이 붙어 있다) */
    const stops = mine.filter(r => !r.parent_id);
    const days = dayList(t, stops);
    /* ★칸이 좁아지면 점을 줄인다. 21일 여행이면 칸이 13px 인데 점 넷은 26px 라 넘친다 —
       그때는 '무엇이 있나' 대신 '있나 없나' 까지만 말한다. 넘쳐서 깨지느니 덜 말한다. */
    const maxDots = days.length > 12 ? 1 : days.length > 7 ? 2 : 4;
    const rail = days.length ? `<span class="mrail">${days.map(d => {
      const on = stops.filter(r => r.on_date === d);
      return on.length
        ? `<span class="md">${on.slice(0, maxDots).map(r =>
            `<i style="--k: var(--${KVAR[r.kind] || 'k-etc'})"></i>`).join('')}</span>`
        : '<span class="md is-empty"></span>';
    }).join('')}</span>` : '';

    /* 떠날 때까지 며칠 — 예정된 여행에서 제일 먼저 보고 싶은 숫자다.
       진행 중이면 '며칠차', 지난 여행은 굳이 세지 않는다(끝난 것에 날짜를 세지 않는다). */
    let mark = '';
    if (phase === 'soon' && t.start_on) {
      const n = Math.ceil((Date.parse(t.start_on) - Date.parse(U.todayISO())) / DAYMS);
      mark = n > 0 ? `D-${n}` : 'D-DAY';
    } else if (phase === 'now' && t.start_on) {
      mark = `${Math.floor((Date.parse(U.todayISO()) - Date.parse(t.start_on)) / DAYMS) + 1}일차`;
    }

    /* 합계는 js/money.js 한 곳에서 낸다 — 비용 탭·일정 탭과 같은 함수다.
       (전에는 여기서 따로 셌고, 현금 지갑이 생기면서 곧 갈릴 자리였다) */
    const sum = MONEY.total(mine, FXS.rateOf).sum;

    const bits = [fmtSpan(t.start_on, t.end_on)];
    if (stops.length) bits.push(`일정 ${stops.length}`);
    bits.push(sum ? U.money(sum, U.SETTLE) : (t.base_cur || U.SETTLE));

    return `<button class="trip${phase === 'now' ? ' is-now' : ''}" type="button" data-id="${esc(t.id)}">
      ${U.flag(t.base_cur) ? `<span class="bgflag" aria-hidden="true">${U.flag(t.base_cur)}</span>` : ''}
      <span class="top2">
        <span class="nm">${esc(t.name)}</span>
        ${mark ? `<span class="dday${phase === 'now' ? ' hot' : ''}">${esc(mark)}</span>` : ''}
      </span>
      ${rail}
      <span class="meta">${esc(bits.join(' · '))}</span>
    </button>`;
  }

  /* 카드에 세울 날짜. 기간이 있으면 **빈 날도 센다** — 비었다는 것도 여행의 모양이다.
     기간이 없으면 일정이 적힌 날만(없는 날을 지어낼 근거가 없다). 너무 길면 접는다. */
  function dayList(t, mine) {
    const has = [...new Set(mine.map(r => r.on_date))].sort();
    if (!t.start_on || !t.end_on) return has.slice(0, 21);
    const out = [];
    for (let d = t.start_on; d <= t.end_on && out.length < 21; d = U.addDays(d, 1)) out.push(d);
    return out;
  }

  // ── 여행 불러오기 ─────────────────────────────────────────────────────
  async function load(openBest) {
    try {
      /* 둘을 나란히 부른다 — 카드가 '여행의 모양' 을 그리려면 둘 다 있어야 하고,
         차례로 부르면 첫 화면이 두 번 왕복만큼 늦어진다. */
      const [list, sh] = await Promise.all([DB.trips.list(), DB.trips.shape()]);
      trips = list;
      /* ★못 받았으면(null) **갖고 있던 것을 지우지 않는다.** 빈 배열로 덮으면 카드가
         '일정 N'과 합계를 잃고 통화 코드만 남는데, 화면은 아무 말도 안 하므로
         돈을 안 쓴 여행처럼 보인다. 목록 자체는 list 로 이미 그릴 수 있다. */
      if (sh) shape = sh;
    } catch (e) {
      trips = [];
      $('trips').innerHTML = `<p class="empty"><strong>불러오지 못했습니다</strong>${esc(e.message)}</p>`;
      return;
    }
    /* 주소에 여행이 적혀 있으면 그것이 이긴다. 아무것도 안 적혀 있을 때만
       진행 중인 여행으로 바로 들어간다 — 목록을 보러 온 사람을 끌고 가지 않는다. */
    if (openBest && !tripId) {
      const now = trips.find(t => phase(t) === 'now');
      if (now) { go(now.id, 'plan', true); return; }
    }
    render();
    /* 환율은 기다리지 않는다 — 먼저 그리고, 받아 오면 카드의 합계만 다시 낸다 */
    FXS.ensure(shape).then(got => { if (got) render(); }).catch(() => {});
  }

  // ── 폼 ────────────────────────────────────────────────────────────────
  function busy(on, msg) {
    $('new-save').disabled = on;
    $('new-err').textContent = msg || '';
  }

  async function createTrip(ev) {
    ev.preventDefault();
    busy(true, '');
    try {
      const t = await DB.trips.create({
        name: $('new-name').value,
        start_on: $('new-from').value || null,
        end_on: $('new-to').value || null,
        base_cur: $('new-cur').value,
      });
      $('new').reset();
      $('new-dlg').close();
      /* ★만든 사람은 트리거가 첫 멤버로 넣는다. 그게 없으면 방금 만든 여행이
         정책에 걸려 자기 눈에도 안 보인다 — 목록을 다시 받아 그 사실을 확인한다. */
      trips = await DB.trips.list();
      if (!trips.some(x => x.id === t.id)) {
        busy(false, '여행은 만들어졌는데 목록에 없습니다 — members.sql 의 트리거를 확인하세요.');
        render();
        return;
      }
      busy(false, '');
      go(t.id, 'plan', true);
    } catch (e) {
      busy(false, e.message);
    }
  }

  async function joinTrip(ev) {
    ev.preventDefault();
    $('join-btn').disabled = true;
    $('join-err').textContent = '';
    try {
      const id = await DB.join($('join-code').value);
      $('join').reset();
      $('join-dlg').close();
      trips = await DB.trips.list();
      go(id, 'plan', true);
    } catch (e) {
      $('join-err').textContent = e.message;
    } finally {
      $('join-btn').disabled = false;
    }
  }

  // ── 게이트 ────────────────────────────────────────────────────────────
  function showGate(msg) {
    $('gate').hidden = false;
    $('app').hidden = true;
    $('tabs').hidden = true;
    $('gate-err').textContent = msg || '';
  }

  async function refresh() {
    if (DB.mode() !== 'cloud') { showGate(); return; }
    $('gate').hidden = true;
    $('app').hidden = false;
    $('who').textContent = DB.email();

    // 로그인 전에 초대 링크를 열었다면 지금 쓴다
    let pending = null;
    try { pending = sessionStorage.getItem('join1'); } catch (e) {}
    if (pending) {
      try { sessionStorage.removeItem('join1'); } catch (e) {}
      try {
        const id = await DB.join(pending);
        trips = await DB.trips.list();
        go(id, 'plan', true);
        return;
      } catch (e) { /* 코드가 죽었으면 그냥 목록을 보여준다 */ }
    }
    load(true);
  }

  // ── 붙이기 ────────────────────────────────────────────────────────────
  $('signin').addEventListener('click', () => DB.signIn());
  $('signout').addEventListener('click', async () => { await DB.signOut(); trips = []; showGate(); });
  /* 떠다니는 두 단추 ↔ 가운데 팝업. 폼은 팝업 안에 하나씩만 있고 여기서 문을 연다.
     닫기는 ✕·백드롭·Esc 셋 — 뒤 화면 잠금은 CSS(html:has(dialog[open]))가 맡는다. */
  const openDlg = (id, focusId) => {
    const d = $(id);
    d.showModal();
    d.querySelector('.sheetbody').scrollTop = 0;
    if (focusId) setTimeout(() => $(focusId).focus({ preventScroll: true }), 0);
  };
  $('new-open').addEventListener('click', () => { $('new-err').textContent = ''; openDlg('new-dlg', 'new-name'); });
  $('join-open').addEventListener('click', () => { $('join-err').textContent = ''; openDlg('join-dlg', 'join-code'); });
  document.querySelectorAll('dialog.dlg').forEach(d => {
    d.querySelector('[data-close]').addEventListener('click', () => d.close());
    d.addEventListener('click', e => { if (e.target === d) d.close(); });   // 배경 누름
  });

  $('new').addEventListener('submit', createTrip);
  $('join').addEventListener('submit', joinTrip);
  $('back').addEventListener('click', () => go(null, 'plan', true));

  $('trips').addEventListener('click', e => {
    const b = e.target.closest('.trip');
    if (b) go(b.dataset.id, 'plan', true);
  });
  $('tabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b) go(tripId, b.dataset.tab, true);
  });

  /* 지도의 마커를 누르면 그 일정 줄로 데려간다 — 지도에서 '이게 뭐였지' 가 생기면
     결국 일정 탭으로 돌아가 눈으로 찾게 된다. */
  Maps.onPick(id => {
    go(tripId, 'plan', true);
    setTimeout(() => {
      const el = document.querySelector(`[data-edit="${id}"]`);
      if (el) { el.scrollIntoView({ block: 'center' }); el.focus({ preventScroll: true }); }
    }, 80);
  });

  /* ── 아웃박스 ────────────────────────────────────────────────────────
     못 보낸 것이 있으면 **화면 어디에 있든** 보인다. 조용히 쌓이면 '적었는데 안 올라갔다' 를
     한참 뒤에야 알게 된다. 눌러서 지금 보낼 수도 있다. */
  function drawObox(n, justOnline) {
    const el = $('obox');
    el.hidden = !n;
    if (!n) return;
    el.innerHTML = `<span>못 보낸 변경 ${n}건</span>`
      + `<button class="act" type="button" id="obox-send">${navigator.onLine ? '지금 보내기' : '연결되면 보냅니다'}</button>`;
    if (justOnline) sendOutbox();
  }
  async function sendOutbox() {
    if (!navigator.onLine || !Outbox.count()) return;
    const r = await Outbox.flush();
    if (r.dropped.length) {
      alert(['서버가 거절해서 버린 변경이 있습니다:', ...r.dropped.map(d => d.why)].join('\n'));
    }
    if (r.sent && tripId) { const t = trips.find(x => x.id === tripId); if (t) Plan.open(t); }
  }
  Outbox.onChange(drawObox);
  drawObox(Outbox.count());
  $('obox').addEventListener('click', e => { if (e.target.id === 'obox-send') sendOutbox(); });
  /* ★online 을 여기서 또 듣지 않는다. outbox.js 가 이미 듣고 onChange 로 알려 준다 —
     둘 다 들으면 flush 가 두 번 돌아 같은 줄이 두 개 생긴다(2026-09-01 에 겪었다). */

  /* 다른 모듈이 데이터를 바꿨다고 알려 오면 다시 그린다 —
     모듈끼리 서로를 부르지 않게 이벤트 한 겹을 둔다. */
  document.addEventListener('items:changed', () => {
    const t = trips.find(x => x.id === tripId);
    if (!t) return;
    // ★open() 이 아니라 refresh() 다 — open 은 같은 여행이면 다시 받지 않는다
    Plan.refresh().then(() => {
      if (tab === 'cost') Cost.open(t, Plan.rows(), true);
      if (tab === 'map') Maps.open(t, Plan.rows());
    });
  });
  document.addEventListener('trip:changed', async () => { trips = await DB.trips.list(); render(); });
  document.addEventListener('trip:deleted', async () => {
    trips = await DB.trips.list();
    go(null, 'plan', true);
  });

  addEventListener('popstate', () => { const u = readUrl(); go(u.tripId, u.tab, false); });
  DB.onError(showGate);
  DB.onAuth(refresh);

  /* 서비스워커 — 껍데기를 미리 받아 둬서 끊긴 곳에서도 앱이 열린다.
     ★첫 페인트를 막지 않도록 load 뒤에 등록한다. 실패해도 앱은 그대로 돈다. */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  }

  (async function boot() {
    await DB.initAuth();
    /* OAuth 로 돌아오면 주소에 code·state 가 붙어 있다. 세션을 잡은 뒤 지운다.
       돌아오는 자리는 늘 루트이므로(db.js 의 signIn 참고) 가려던 경로는 여기서 되돌린다. */
    if (location.search.includes('code=') || location.hash.includes('access_token')) {
      let to = '/';
      try {
        const b = sessionStorage.getItem('back1');
        if (b) { to = b; sessionStorage.removeItem('back1'); }
      } catch (e) { /* 시크릿 모드 등에서 막히면 루트로 */ }
      history.replaceState(null, '', to);
    }
    const u = readUrl();
    tripId = u.tripId; tab = u.tab;

    /* 초대 링크 — /?join=<코드>. 로그인 뒤에 처리해야 하므로 여기서 본다.
       ★코드는 주소에서 **바로 지운다.** 남겨 두면 새로고침할 때마다 다시 참여를 시도하고,
         공유·즐겨찾기로도 새어 나간다. */
    const code = new URLSearchParams(location.search).get('join');
    if (code) {
      history.replaceState(null, '', '/');
      if (DB.mode() === 'cloud') {
        try {
          const id = await DB.join(code);
          trips = await DB.trips.list();
          go(id, 'plan', true);
          return;
        } catch (e) { showGate(e.message); return; }
      }
      /* 아직 로그인 전이면 코드를 들고 있다가 로그인 뒤에 쓴다 */
      try { sessionStorage.setItem('join1', code); } catch (e) {}
    }
    refresh();
  })();
})();
