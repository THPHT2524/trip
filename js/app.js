/* app.js — 부팅과 화면 전환. 이 앱의 유일한 진입점이다.
   ─────────────────────────────────────────────────────────────────────────
   화면은 두 단계다. 앞선 두 프로젝트(card-dashboard·stock)는 한 단계짜리 탭 넷이었지만,
   여기는 **여행을 고른 뒤에야** 나머지가 뜻을 갖는다.

     /            여행 목록
     /t/<id>      일정   ← 여행 안의 첫 화면
     /t/<id>/map · /cost · /info

   ★그래도 진행 중이거나 곧 시작할 여행이 있으면 **목록을 건너뛰고 바로 연다.**
     현지에서 앱을 여는 이유가 그 여행이지 목록이 아니다.

   ★경로 라우팅이다(해시가 아니다). OAuth 가 돌아오는 `?code=` 자리와 겹치지 않는다.
     vercel.json 의 `/t/(.*)` → `/index.html` 리라이트가 새로고침을 견디게 해 준다. */
(function () {
  const $ = id => document.getElementById(id);
  const TABS = ['plan', 'map', 'cost', 'info'];
  const SEG = { plan: '', map: 'map', cost: 'cost', info: 'info' };

  let trips = [];          // 마지막으로 받은 여행 목록
  let shape = [];          // 카드에 그릴 '여행의 모양' (일정의 날짜·구분·비용만)
  let tripId = null;       // 지금 열어 둔 여행
  let tab = 'plan';

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
  /* ★★sticky 층의 높이를 **잰다.** 손으로 적은 64px 이 실제와 어긋난 것이 이번이
     두 번째다(2026-09-01 날짜 탭이 잘렸고, 2026-09-03 연도 머리띠 아래로 스크롤이
     비쳤다). 머리말 높이는 글꼴이 정하고 글꼴은 기기가 정한다 — 우리가 미리 알 수
     없는 값을 CSS 에 적어 두고 있었다. 실제로 지금도 **화면마다 다르다**:
     홈 64.19px · 여행 65px(뒤로 단추의 최소 높이 44px 때문). 상수는 하나였다.
   ★**내림한다.** 붙는 자리가 머리말 바닥보다 낮으면 그 틈으로 스크롤이 비쳐 보이고,
     높으면 머리말이 덮는다(z-index 가 더 크다). 어긋날 거면 덮는 쪽으로 어긋나야 한다.
   ★CSS 의 64px·44px 은 그대로 둔다 — 첫 페인트에는 잴 것이 아직 없다. */
  const shellSet = (name, el) => {
    if (!el) return;
    const h = Math.floor(el.getBoundingClientRect().height);
    if (h > 0) document.documentElement.style.setProperty(name, h + 'px');
  };
  function measureShell() {
    shellSet('--h-top', document.querySelector('.wrap:not([hidden]) .top'));
    shellSet('--h-tabs', document.querySelector('.daytabs:not([hidden])'));
  }
  /* 글꼴이 늦게 와도(font-display: swap) 높이가 바뀐다 — 그때 다시 잰다. */
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measureShell);
  addEventListener('resize', measureShell);

  function render() {
    const inTrip = !!tripId;
    $('view-trips').hidden = inTrip;
    $('view-trip').hidden = !inTrip;
    $('tabs').hidden = !inTrip;
    document.body.dataset.view = inTrip ? 'trip' : 'trips';

    if (!inTrip) { renderTrips(); measureShell(); return; }

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
    if (tab === 'info') Crew.open(t);
    measureShell();
  }

  function renderTrips() {
    const el = $('trips');
    if (!trips.length) {
      el.innerHTML = '<p class="empty"><strong>아직 여행이 없습니다</strong>'
                   + '새 여행을 만들거나, 받은 초대 링크를 여세요.</p>';
      return;
    }
    $('passport').innerHTML = passportHtml();
    fitFlags();
    /* 전에 적은 도시를 제안한다 — 같은 도시를 다른 철자로 적어 두 곳으로 세지 않게 */
    const seen = new Set();
    trips.forEach(t => U.cityList(t.cities).forEach(c => seen.add(c)));
    $('citylist').innerHTML = [...seen].sort()
      .map(c => `<option value="${esc(c)}"></option>`).join('');

    const group = { now: [], soon: [], past: [] };
    trips.forEach(t => group[phase(t)].push(t));

    /* ★★지난 여행을 **해마다** 나눈다. 스물넷이 한 덩어리로 3,000px 서 있으면
       '작년에 어디 갔더라' 를 찾을 방법이 없다 — 연도가 이 목록의 자연스러운 눈금이다.
       ★나뉘고 나면 카드에서 연도를 뺄 수 있다(머리띠가 이미 말한다) — 같은 말을
         스물네 번 되풀이하지 않는다.
       ★지금·예정은 안 나눈다. 앞으로의 것은 몇 개 안 되고, 나누면 오히려 흩어진다. */
    let html = '';
    if (group.now.length) html += section('지금', group.now, 'now', false);
    if (group.soon.length) html += section('예정', group.soon, 'soon', false);
    const byYear = new Map();
    group.past.forEach(t => {
      const y = (t.end_on || t.start_on || '').slice(0, 4) || '언젠가';
      if (!byYear.has(y)) byYear.set(y, []);
      byYear.get(y).push(t);
    });
    [...byYear.keys()].sort().reverse().forEach(y => {
      html += section(y, byYear.get(y), 'past', y !== '언젠가');
    });
    /* ★판은 **하나**다. 해마다 상자를 따로 두면 안내판 여러 개가 쌓인 것처럼 보인다 —
       연도 띠는 그 한 판 안의 구역 머리다.
     ★칸 이름도 맨 위에 한 번만. 연도 띠가 sticky 라 그 밑에 또 두면 스크롤할 때마다
       되풀이된다. 영문만 쓴다 — 아래 값만 보면 무슨 칸인지 알고, 한글을 얹으면 두 줄이 된다.
     ⚠ .tboard 에 overflow:hidden 을 걸지 말 것. 스크롤 상자가 되어 연도 띠의
       position:sticky 가 화면이 아니라 이 상자에 붙는다(= 안 붙는다). */
    /* ★★판이 제가 무슨 판인지 **선언한다**(2026-09-04). 칸 이름만 있으면 표로 시작하는데,
       안내판은 늘 머리에 이름과 시계를 단다. 위 여권 카드가 TRIPLOG · PASSPORT 라
       둘이 **여권과 출발 안내판 한 쌍**이 된다.
     ★오른쪽 끝은 시계 자리인데, 이 판에는 **몇 번 다녀왔는지**를 놓는다. 시계는 폰이
       이미 위에 달고 있고, 이 목록에서 궁금한 것은 시각이 아니라 여행 수다.
     ★그 수도 쪽자에 앉는다 — 판 위에서 숫자는 다 그렇게 선다. */
    el.innerHTML = '<div class="tboard">'
                 + '<div class="tbtop"><span class="pl" aria-hidden="true">✈</span>'
                 + '<b>TRIPLIST</b><em>DEPARTURES</em>'
                 + `<span class="cnt">${cells(trips.length)}<em>times</em></span></div>`
                 /* ★days·places 는 **숫자 바로 옆**에 붙인다(2026-09-04). 머리줄로 올렸더니
                    스물두 칸 건너에 있어서 무슨 수인지 눈으로 이어야 했다 — 붙어 있어야 읽힌다.
                    머리줄에는 왼쪽 묶음의 이름만 남긴다. */
                 + '<div class="tbhd" aria-hidden="true">'
                 + '<span>Date</span><span>To</span><span class="r">Trip</span></div>'
                 + html + '</div>';
    flipOnce(el);
  }

  /* ★★쪽자가 넘어가듯 줄이 위에서부터 뒤집히며 선다.
     ★**한 세션에 한 번만.** 홈은 하루에 몇 번씩 여는 화면이라 매번 돌면 금세 질린다 —
       앱 안에서 여행에 들어갔다 돌아올 때는 안 돈다.
     ★보이는 열넷에만 박자를 준다. 그 아래는 어차피 화면 밖이라 기다릴 이유가 없다.
     ★끝나면 클래스를 뗀다 — perspective 를 남겨 두지 않는다.
     ★움직임을 줄여 달라는 설정이면 css 의 전역 규칙이 통째로 끈다. */
  function flipOnce(el) {
    try { if (sessionStorage.getItem('flip1')) return; sessionStorage.setItem('flip1', '1'); }
    catch (e) { /* 시크릿 모드 등에서 막히면 그냥 한 번 돈다 */ }
    const board = el.querySelector('.tboard');
    if (!board) return;
    [...el.querySelectorAll('.trip')].slice(0, 14)
      .forEach((r, i) => r.style.setProperty('--i', i));
    board.classList.add('flip');
    setTimeout(() => board.classList.remove('flip'), 1200);
  }

  /* 머리띠 하나와 그 아래 카드들. 머리띠는 **그 묶음이 얼마였는지**까지 말한다 —
     연도만 적으면 눈금일 뿐이지만, 옆에 '7 times 41 days' 가 붙으면 그 해의 크기가 읽힌다. */
  /* ★한 해를 **한 상자**로 묶는다. 머리띠가 sticky 인데 상자가 없으면 형제끼리
     같은 자리(top: --h-top)에 겹쳐 붙는다 — 2026 과 2025 가 한 줄에 포개졌다
     (2026-09-03). 상자가 있으면 제 구간이 지나갈 때 다음 해가 밀어낸다. */
  function section(title, list, ph, bare) {
    const days = list.reduce((a, t) => a + U.tripDays(t), 0);
    /* ★그 해가 얼마였는지도 **쪽자로 센다**(2026-09-04). '여행 4 · 24일' 은 글이었고,
       판 위에서 혼자 글이면 거기만 딴 물건으로 보인다. 수는 칸에, 이름은 옆에 작게 —
       판 머리의 '38 times' 와 같은 어법이다. 자리는 둘 다 두 자리.
     ⚠ 한 해에 100일 넘게 다니면 두 칸에 안 들어간다 — 판은 늘어나지 않으므로 잘린다. */
    const gn = row([['r', list.length, '']], 2) + '<em>times</em>'
             + (days ? row([['r', days, '']], 2) + '<em>days</em>' : '');
    return `<section class="ygroup">`
         + `<h2 class="grouphd${bare ? ' year' : ''}">`
         + `<span class="gt">${bare ? cells(title) : esc(title)}</span>`
         + `<span class="gn">${gn}</span></h2>`
         + list.map(t => card(t, ph)).join('')
         + `</section>`;
  }

  /* 여권의 머리 — 이름 한 줄, 종류 한 줄, 그리고 오른쪽에 지나온 것의 띠.
     ★진짜 여권의 인적사항면이 그렇게 생겼다: 발급기관 이름과 문서 종류가 위에,
       사진(또는 표식)이 옆에. 아래 격자·MRZ 와 합쳐 한 장이 된다.
   ★★오른쪽의 앱 표식(세로 레일에 점 둘)을 **가로로 눕히고 일정으로 채웠다**
     (2026-09-04). 표식은 앱 아이콘을 되풀이할 뿐 아무것도 말하지 않았는데, 그 자리는
     여권에서 유일하게 비어 있던 자리였다. 이제 **다녀온 것이 무엇으로 이뤄졌는지**를
     말한다 — 카드의 미니 레일과 같은 어법이라 배울 것이 없다.
   ★점은 **구분마다 하나씩, 여섯 개 전부**다. 수만큼 길이를 주는 막대로 먼저 그려
     봤는데(2026-09-04), 그건 이 카드가 이미 하는 일이 아니다 — 무엇을 얼마나 했는지는
     비용 탭의 '무엇에' 가 센다. 여기 있어야 하는 것은 **이 앱이 색으로 무엇을 말하는지**,
     곧 범례다. 그래서 없었던 구분도 뺀 자리 없이 선다.
   ★레일은 양끝으로 삐져나온다 — 여행이 이 카드에서 끝나지 않는다는 뜻이고,
     카드의 미니 레일도 그렇게 생겼다. */
  function pheadHtml() {
    const dots = U.KINDS.map(k =>
      `<i style="--k:var(--${U.kvar(k)})"></i>`).join('');
    const label = U.KINDS.join(', ');
    return `<div class="phead">
    <div class="pname">
      <b>TRIPLOG</b>
      <span class="ptype" aria-hidden="true"><svg viewBox="0 0 14 12" class="pico">
        <rect x=".8" y=".8" width="12.4" height="10.4" rx="2.2"/>
        <circle cx="4.9" cy="6" r="1.7" class="f"/>
        <path d="M8.6 4.5h2.6M8.6 7.5h2.6"/></svg> <i>·</i> PASSPORT</span>
    </div>
    <div class="prail" role="img" aria-label="일정 구분 ${esc(label)}">${dots}</div>
  </div>`;
  }

  /* ── 여권 위의 세계지도 ──────────────────────────────────────────────────
     **다녀온 공항을 점으로 찍는다.** 여권 격자가 '얼마나' 를 말한다면 지도는 '어디를'
     말한다 — 같은 사실을 두 번 적는 것이 아니라 서로 다른 것을 센다.
     ★항로 선은 안 긋는다. 일정에 적는 해외 공항은 **도착·출발 두 점**뿐이라 인천 쪽이
       없다. 있는 점끼리 이으면 타지도 않은 노선이 그려진다 — 모르는 것을 그리지 않는다.
     ★공항은 **이름으로** 가려낸다(끝이 '공항'). '간사이공항점' 같은 가게가 딸려 오므로
       포함이 아니라 **끝나는지**를 본다(2026-09-03에 식당 셋이 딸려 왔다).
     ★같은 공항을 여러 번 갔어도 점은 하나다. 몇 번 갔는지는 여권 격자와 카드가 말한다. */
  /* 집. 모든 여행이 여기서 시작하고 여기로 돌아온다.
     ★**일정 줄로 넣지 않는다.** 넣으면 지도 탭이 그날 화면을 인천까지 잡느라 확 넓어지고,
       안 지나간 줄이 하나 늘고, 여권의 '장소' 수도 같이 오른다 — 그림 때문에 기록을
       바꾸는 것은 거꾸로다. 여기서는 **화면에만 쓰는 상수**로 둔다.
     ★인천이 아니라 '서울' 이다. 제주는 김포에서 갔고 둘은 지도에서 1픽셀 안쪽이다. */
  const HOME = { lat: 37.50, lng: 126.60 };
  /* 연속한 두 공항이 이만큼 안에 붙어 있으면 **비행기로 건넜다**고 본다.
     ★날짜 순서만으로 이으면 안 탄 노선이 생긴다: 포르투→리스본은 143시간(육로),
       LA→라스베가스는 151시간(차)이다. 실제 항공편은 바르셀로나→포르투 1.0시간,
       라스베가스→샌프란시스코 1.7시간, 리스본→도하 8.9시간, 두바이→말레 9.8시간 —
       열두 시간이면 둘이 깨끗하게 갈린다(2026-09-03에 전 여행을 훑어 확인). */
  const FLIGHT_H = 12;

  /* 그을 항로. 여행마다 **서울→첫 공항**, 여행 안의 실제 항공편, **마지막 공항→서울**. */
  function legsOf(air) {
    const byTrip = new Map();
    air.forEach(r => {
      if (!byTrip.has(r.trip_id)) byTrip.set(r.trip_id, []);
      byTrip.get(r.trip_id).push(r);
    });
    const key = p => p.x.toFixed(1) + ',' + p.y.toFixed(1);
    /* ★선은 **중복을 걷고**(서울–제주가 열세 번이다), 세는 것은 **안 걷는다**
       — 그림은 길을 보여 주고 숫자는 횟수를 말한다. 둘은 다른 물음이다. */
    const out = new Map();
    let flown = 0;
    const add = (a, b) => {
      const pa = WORLD.at(a.lat, a.lng), pb = WORLD.at(b.lat, b.lng);
      if (!pa || !pb || key(pa) === key(pb)) return;
      flown += 1;
      const k = [key(pa), key(pb)].sort().join('|');
      if (!out.has(k)) out.set(k, [a, b]);
    };
    const stamp = r => Date.parse(r.on_date + 'T' + (r.at_time || '00:00:00') + 'Z');
    byTrip.forEach(rows => {
      rows.sort((x, y) => stamp(x) - stamp(y));
      add(HOME, rows[0]);
      add(rows[rows.length - 1], HOME);
      for (let i = 1; i < rows.length; i += 1) {
        if (stamp(rows[i]) - stamp(rows[i - 1]) <= FLIGHT_H * 36e5) add(rows[i - 1], rows[i]);
      }
    });
    return { lines: [...out.values()], flown };
  }

  function worldHtml(air, legs) {
    /* 같은 공항을 **몇 번** 지났는지까지 센다 — 점 크기가 그 수다. */
    const seen = new Map();
    air.forEach(r => {
      if (!/공항$/.test(String(r.name || ''))) return;
      const p = WORLD.at(r.lat, r.lng);      // 좌표가 없거나 이상하면 null 을 준다
      if (!p) return;
      const k = p.x.toFixed(1) + ',' + p.y.toFixed(1);
      const hit = seen.get(k);
      if (hit) hit.n += 1; else seen.set(k, { x: p.x, y: p.y, n: 1 });
    });
    if (seen.size < 2) return '';            // 점 하나짜리 지도는 지도가 아니다

    /* 항로를 **점 아래에** 깐다 — 위에 그으면 선이 점을 가로지른다. */
    const arcs = legs.lines.map(([a, b]) => WORLD.arc(a, b)).filter(Boolean)
      .map(d => `<path d="${d}"/>`).join('');

    /* ★★점을 다 같은 크기로 찍었더니 밋밋했다. 실제로는 제주 26번·홍콩 6번·포르투 1번
       으로 **크게 다른데** 그걸 안 보여 주고 있었다. 넓이가 아니라 **지름을 제곱근**으로
       키운다 — 넓이로 키우면 제주 하나가 동해를 덮는다.
       ★위계가 생기면서 화면도 산다: 자주 지난 문이 크고, 한 번뿐인 곳은 작다. */
    /* ★선을 그은 뒤로 점을 줄였다. 항로가 서울 한 점에 모이는데 점이 크면 선의
       끝이 점 안으로 파묻혀 어디서 어디로 가는지가 안 읽힌다 — 점은 자리를,
       선은 흐름을 맡는다. */
    const rOf = n => 3.5 + Math.min(4, Math.sqrt(n - 1) * 1.7);
    const pts = [...seen.values()];
    const c = (p, r) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r.toFixed(1)}"/>`;
    /* 후광을 **먼저** 다 깔고 점을 얹는다 — 섞어 그리면 옆 점의 후광이 앞 점을 덮는다.
       ★★반짝임은 **박자도 저마다 다르게**. 시작점만 흩고 주기를 5초로 통일했더니
         스물여섯이 같은 속도로 흐르는 물결이 되어 **반짝이는 것으로 안 보였다**
         (2026-09-04). 별은 저마다 제 속도로 깜빡인다 — 주기를 2.6~5.8초로 흩는다.
       ★자리에서 뽑는다. 그래서 다시 그려도 같은 박자고, 새로 고칠 때마다 튀지 않는다.
         좌표를 섞은 값이라 규칙이 눈에 안 잡힌다(순번으로 뽑으면 줄줄이 늘어선다).
       ★움직임을 줄여 달라는 설정이면 css 의 전역 규칙이 통째로 끈다. */
    const glow = pts.map((p) => {
      const seed = p.x * 7.13 + p.y * 3.71;
      const dur = 5.6 + (seed % 5.4);          // 5.6~11초 — 2.6~5.8초는 너무 빨랐다
      const delay = seed % dur;
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(rOf(p.n) * 2).toFixed(1)}"`
        + ` style="animation-duration:${dur.toFixed(2)}s;animation-delay:-${delay.toFixed(2)}s"/>`;
    }).join('');
    const dots = pts.map(p => c(p, rOf(p.n))).join('');
    /* 집은 **속이 빈 점**. 다녀온 곳이 아니라 떠나온 곳이라 다르게 그린다. */
    const home = WORLD.at(HOME.lat, HOME.lng);
    return `<svg class="wmap" viewBox="${WORLD.vb}" role="img"`
         + ` aria-label="다녀온 공항 ${seen.size}곳"><path class="wland" d="${WORLD.d}"/>`
         + `<g class="wleg">${arcs}</g>`
         + `<g class="wglow">${glow}</g><g class="wdot">${dots}</g>`
         + `<circle class="whome" cx="${home.x.toFixed(1)}" cy="${home.y.toFixed(1)}" r="4.5"/></svg>`;
  }

  /* ── 여권 ────────────────────────────────────────────────────────────────
     **지나온 것의 총량.** 목록 위에 한 줄로 선다.
     ★여기 세는 것은 전부 이미 갖고 있는 사실이다 — 지어내지 않는다:
       나라와 도시는 **여행에 적어 둔 대로**, 장소는 좌표로 중복을 걷은 수,
       일은 여행 기간의 합, 쓴 돈은 원화로 모은 합.
     ★여행이 하나도 없으면 아무 말도 안 한다. 0개국 0곳은 알려 줄 것이 없다. */
  /* 여권 아래 기계판독구역(MRZ). 진짜 여권처럼 44칸 두 줄에 `<` 로 채운다.
     ★장식이 아니라 **같은 사실을 다른 문법으로 한 번 더** 적은 것이다 — 위 격자가
       사람용이면 이건 도장 자국이다. 지어낸 값은 한 칸도 없다. */
  const MRZ = 44;
  const pad = (t) => (t + '<'.repeat(MRZ)).slice(0, MRZ);
  const mrzSafe = (t) => String(t || '').toUpperCase().replace(/[^A-Z0-9]+/g, '<');
  /* ★격자 라벨과 **같은 열쇠**를 쓴다 — 라벨을 바꾸면 여기도 바꿔야 도장이 찍힌다. */
  const MRZ_CODE = { COUNTRIES: 'C', CITIES: 'T', FLIGHTS: 'F', DAYS: 'D' };
  /* ★위 격자에 **선 칸만** 적는다. 전에는 0 도 그대로 찍어서, 셈을 못 받아 온 날
     '1C<0A<0P<3D' 라고 도장이 찍혔다 — 없는 것을 0 이라고 말한 셈이다(2026-09-02 폰). */
  function mrzLines(cells) {
    const who = mrzSafe((DB.email() || '').split('@')[0]) || 'TRAVELLER';
    return [pad('P<KOR<' + who),
            pad(cells.filter(([k]) => MRZ_CODE[k]).map(([k, v]) => v + MRZ_CODE[k]).join('<'))];
  }

  /* 국기 줄을 **판에 맞춘다.** 몇 장인지에 따라 겹치는 폭도 줄 수도 달라지므로 그려진 뒤에 잰다.
     ★반 넘게 가리지 않는다 — 그 이상 겹치면 국기가 색 띠가 되어 무엇인지 알 수 없다.
       그래도 안 들어가면 줄을 하나 더 준다(세 줄까지). 거기서도 넘치면 끝을 흐린다. */
  /* ★국기 이모지가 **그림으로 그려지는가.** 윈도우는 안 그리고 'JP' 두 글자로 떨어뜨린다.
     ★폭으로는 못 가른다 — 대체 글자가 본문보다 **작게** 그려져서, 진짜 국기보다
       좁게 나오는 일이 있다(2026-09-02 측정: 국기 19.8 vs 'JP' 24.2 — 판정이 뒤집혔다).
     ★**색으로 가른다.** 검은색으로 찍어 보고 색이 남아 있으면 그림이고, 회색조뿐이면
       글자다. 일장기는 빨간 동그라미가 있어 이 판별에 쓸 수 있다. */
  let drawsFlags = null;
  function canDrawFlags() {
    if (drawsFlags !== null) return drawsFlags;
    drawsFlags = false;
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
        const r = d[i], g = d[i + 1], b = d[i + 2];
        if (Math.max(r, g, b) - Math.min(r, g, b) > 30) { drawsFlags = true; break; }
      }
    } catch (e) { /* 캔버스를 못 쓰면 안전한 쪽(글자)으로 */ }
    return drawsFlags;
  }

  /* 한 줄을 재서 겹침을 정한다. **겹치고도 남은 넘침(px)** 을 돌려준다 —
     부르는 쪽이 그 값으로 줄을 하나 더 쓸지 정한다. */
  function fitRow(box) {
    const n = box.children.length;
    /* ★글자로 떨어지는 곳에서는 **겹치지 않는다.** 국기를 반씩 겹치면 부채처럼 보이지만
       'JP' 를 반씩 겹치면 글자 뭉치가 된다 — 같은 규칙이 두 곳에서 반대로 작동한다. */
    box.classList.toggle('ascii', !canDrawFlags());
    box.style.setProperty('--lap', '0px');      // 재기 전에 겹침을 푼다
    if (n < 2) return 0;
    /* ★한 장 폭 × 장수로 셈하면 안 된다 — 국기마다 폭이 다르다(윈도우에서 두 글자로
       떨어질 때는 더 다르다: JP 19.8 · MO 24…). 실제로 넘친 만큼을 scrollWidth 로 잰다. */
    const cs = getComputedStyle(box);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const content = box.scrollWidth - padX;
    const over = content - (box.clientWidth - padX);
    if (drawsFlags) {
      /* ★★겹침을 '얼마나 가리나' 가 아니라 **'얼마나 보이나'** 로 센다.
         겹침이 두 군데서 왔기 때문이다: `--lap` 말고도 `.pflags b` 의 음수 여백이
         이모지 제 여백을 걷는다며 양옆을 당기고 있다. 둘을 따로 두니 5분의 1로
         적어 놓고 화면에서는 5분의 2가 겹쳤다(2026-09-03 아이폰).
         ★★그리고 **국기 한 장의 진짜 폭을 잰다.** 애플 이모지 폭을 1.16em 으로
           어림해서 셈했더니 화면과 안 맞았다 — 이모지 폭은 글꼴마다 다르고 우리가
           그것을 알 방법이 없다. 그러니 b 의 여백을 잠깐 걷고(.bare) 한 번 재서
           **맨 글리프 폭**을 얻는다. 재는 값이 둘이라 레이아웃을 두 번 훑지만
           국기 열댓 장짜리 줄이라 부담이 없고, 대신 어림한 상수가 하나도 안 남는다.
         ★넘쳐도 더 겹치지 않는다. 대신 fitFlags 가 줄을 하나 더 쓴다 —
           뭉개진 한 줄보다 두 줄이 낫다. */
      const SHOW = 0.75;                          // 한 장이 4분의 3은 보인다
      box.classList.add('bare');
      const bare = box.scrollWidth - padX;        // 국기끼리 안 당겼을 때
      box.classList.remove('bare');
      box.style.setProperty('--lap',
        Math.max(0, (content - bare * SHOW) / n).toFixed(2) + 'px');
    }
    return box.scrollWidth - box.clientWidth;   // 겹치고도 남은 것
  }

  /* ★★줄 수는 **재서 정한다.** 여행이 서른여덟이 되자 국기가 43장이 됐고, 한 줄로는
     겹침이 상한(반)에 걸려 오른쪽이 잘려 나갔다(2026-09-03). 겹치고도 넘치면 줄을
     하나 더 준다 — 국기를 버리는 것보다 줄을 늘리는 편이 낫다.
     ★넘칠 때만 늘린다. 국기 셋을 두 줄로 가르면 여백만 늘고 읽히는 것은 없다.
     ★세 줄에서 멈춘다. 그보다 길어지면 국기 띠가 여권을 잡아먹는다 — 그때는 끝을
       흐려서 '잘린 것' 이 아니라 '더 있다' 로 읽히게 둔다. */
  function fitFlags() {
    const wrap = $('passport').querySelector('.pflagwrap');
    if (!wrap) return;
    /* 다시 잴 때는 낱장을 모두 걷어 낸다 — 나눠 둔 채로는 '한 줄에 들어가나' 를
       물을 수 없다(창을 넓히면 다시 한 줄로 돌아와야 한다). */
    const all = [];
    [...wrap.children].forEach(r => { all.push(...r.children); r.remove(); });
    if (!all.length) return;
    for (let k = 1; k <= 3; k++) {
      wrap.textContent = '';
      const per = Math.ceil(all.length / k);
      const rows = [];
      for (let i = 0; i < all.length; i += per) {
        const row = document.createElement('div');
        row.className = 'pflags';
        all.slice(i, i + per).forEach(el => row.append(el));
        wrap.append(row);
        rows.push(row);
      }
      const left = rows.map(fitRow);
      if (k === 3 || left.every(o => o <= 1)) {
        rows.forEach((r, i) => r.classList.toggle('cut', left[i] > 1));
        return;
      }
    }
  }
  addEventListener('resize', fitFlags);

  function passportHtml() {
    if (!trips.length) return '';
    /* ★국기는 **나라마다 하나씩**, 최근에 간 순으로 세운다.
       ★전에는 여행마다 한 장씩 쌓아 '몇 번 갔는지' 를 보여 줬는데, 여행 38개면 43장이
         되어 부채가 두 줄로 넘치고 같은 국기가 열세 번 나왔다 — 되풀이는 그림이 아니라
         소음이었다(2026-09-03). '몇 번' 은 해마다의 머리띠와 여행 카드가 이미 말한다.
       ★trips 가 이미 최신순(start_on desc)이라 앞에서부터 겹치는 것만 걷으면
         **가장 최근에 간 나라가 앞**에 선다 — 순서가 곧 최근성이다.
       ★겹치는 폭도, 한 줄로 둘지 두 줄로 나눌지도 그려진 뒤에 재서 정한다(fitFlags).
         그래서 여기서는 한 줄로만 내보낸다. */
    const flags = [...new Set(trips.flatMap(t => U.flags(t.country)))];
    /* '나라 N' 은 가짓수다 — 이건 겹치는 것을 걷는다 */
    const countries = new Set(trips.flatMap(t => U.codeList(t.country)).filter(c => U.flag(c)));
    /* 도시는 **적힌 대로** 센다. 여러 여행에서 같은 도시를 적었으면 한 번만 센다. */
    const cities = new Set();
    trips.forEach(t => U.cityList(t.cities).forEach(c => cities.add(c)));
    const n = { countries: countries.size, cities: cities.size, days: 0 };
    trips.forEach(t => {
      if (t.start_on && t.end_on) {
        n.days += Math.round((Date.parse(t.end_on) - Date.parse(t.start_on)) / DAYMS) + 1;
      }
    });
    /* ★★'장소' 를 빼고 '비행' 을 넣었다. 장소는 좌표로 겹치는 것을 걷어 센 수였는데,
       바로 위 지도가 말하는 것과 아무 상관이 없었다. 비행은 **지도에 그린 그 선들**을
       센 것이다 — 그림과 숫자가 같은 것을 말한다.
       ★여행마다 서울 오가는 두 번 + 여행 안에서 갈아탄 것. 우리 기록으로 셀 수 있는
         구간이라, 경유가 있었으면 그건 한 번으로 센다. */
    const air = shape.filter(r => /공항$/.test(String(r.name || '')) && WORLD.at(r.lat, r.lng));
    const legs = legsOf(air);
    n.flights = legs.flown;
    /* 값이 0 인 칸은 세우지 않는다 — 빈 칸의 이름을 읽히게 두지 않는다 */
    /* ★나라와 도시는 **적힌 대로**다. 전에는 통화에서 유추하고 좌표를 15km 로 묶어
       어림했는데, 간사이공항이 오사카·교토와 나란히 '한 지역' 으로 섰다 — 공항은
       지나온 문이지 다녀온 곳이 아니다. 공항만 붙이고 교토는 가르는 반경은 35~42km
       사이 7km 창뿐이고 그건 간사이에만 맞는 값이었다(인천 50km · 나리타 60km).
       **여권에 설명이 필요한 칸을 두지 않는다** — 사람이 한 번 적는 편이 낫다. */
    /* 라벨은 영문이다 — 진짜 여권이 그렇다(한국 여권도 모든 칸이 국·영문 병기다).
       아래 MRZ 도 로마자라 둘이 한 덩어리로 읽힌다. */
    const cells = [
      ['COUNTRIES', n.countries], ['CITIES', n.cities], ['FLIGHTS', n.flights], ['DAYS', n.days],
    ].filter(([, v]) => v);
    if (!cells.length) return '';

    return `<section class="pass">
      ${worldHtml(air, legs)}
      ${flags.length ? `<div class="pflagwrap" aria-hidden="true"><div class="pflags">${
        flags.map(f => `<span><b>${f}</b></span>`).join('')}</div></div>` : ''}
      ${pheadHtml()}
      <dl class="pgrid">${cells.map(([k, v]) =>
        `<div><dt>${esc(k)}</dt><dd>${esc(String(v))}</dd></div>`).join('')}</dl>
      <p class="pmrz" aria-hidden="true">${mrzLines(cells).map(esc).join('<br>')}</p>
    </section>`;
  }

  /* 카드 바탕에 깔리는 국기.
     ★★**크기는 건드리지 않는다.** 장수만큼 폭이 늘어 세 장이 카드의 71% 를 덮길래
       한때 92 → 58 → 44px 로 줄였는데, 그러자 여러 나라 카드만 혼자 힘이 없어졌다 —
       서른여덟 장 중 서른다섯이 92px 모노그램인데 셋만 작아서 더 어색했다.
       폭은 **겹쳐서** 줄인다. 크기를 지키면 카드들이 같은 무게로 선다.
     ★글자로 떨어지는 곳(윈도우)에서는 **첫 나라만** 깐다. 'ESPTQA' 는 모노그램이
       아니라 벽이고, 그걸 겹치면 글자 뭉치가 된다 — 여권 국기 줄에서 내린 것과
       같은 판단이다(겹쳐서 읽히는 것은 그림일 때뿐이다). */
  /* ★★**글자 하나에 칸 하나.** 이게 쪽자판이다 — 배경에 격자를 깔아 두는 것으로는
     안 된다(그건 글자 뒤 벽지지 칸이 아니다. 2026-09-04에 그렇게 만들었다가 되돌렸다).
     한글은 음절이 정사각형이라 라틴 숫자와 같은 칸에 그대로 앉는다. */
  /* ★★칸 수를 **미리 잡는다.** 글자가 없는 자리에도 빈 칸이 남는다 — 진짜 판이
     그렇게 생겼고(빈 칸이 격자로 보이는 것), 그래야 줄마다 칸이 같은 자리에 선다.
     넘치면 거기서 끝난다: 판은 늘어나지 않는다. */
  const cells = (str, n) => {
    const ch = [...String(str)];
    const len = n || ch.length;
    let out = '';
    for (let i = 0; i < len; i++) out += `<i>${i < ch.length ? esc(ch[i]) : ''}</i>`;
    return out;
  };
  /* ★★한 줄을 **끝에서 끝까지** 칸으로 채운다(2026-09-04). 묶음마다 칸을 세고 사이를
     벌려 놨더니 격자가 도막도막 끊겼는데, 진짜 판은 판 끝에서 끝까지 한 격자다 —
     글자가 없는 자리에도 칸이 있고, 그 빈 칸들이 판을 판으로 보이게 한다.
   ★칸 수는 스물둘. 폭은 flex 가 나눠 가지므로 화면이 넓어져도 딱 맞아떨어진다.
     날짜 11(08.29-08.31) · 나라 3(ES,PT,QA 가 최대) · 며칠 3 · 몇 곳 3, 사이 둘은 빈칸. */
  /* 날짜 11(08.29-08.31) + 나라 3 = 열넷이 왼쪽 묶음. 이름줄은 스물다섯으로 끝까지 간다. */
  const DATE_COLS = 11, FLAG_COLS = 3, CC_COLS = 3, NAME_COLS = 14;

  /* 스물두 칸을 만들고 자리를 정해 글자를 꽂는다. 안 꽂힌 칸은 빈 채로 남는다.
     자리가 음수면 오른쪽 끝에서 센다. */
  function row(parts, n) {
    const cols = n || COLS;
    const slot = new Array(cols).fill(null);
    parts.forEach(function (part) {
      var at = part[0], str = part[1], cls = part[2] || '';
      /* 배열로 주면 한 원소가 한 칸이다 — 'JP' 두 글자를 한 칸에 넣을 때 쓴다. */
      var ch = Array.isArray(str) ? str : Array.from(str == null ? '' : String(str));
      /* 자리가 'r' 이면 오른쪽 끝에 붙인다 — 수는 자릿수가 맞아야 읽힌다(6 과 10 의 일의 자리가
         같은 줄에 서야 한다). 음수면 끝에서 센다. */
      var from = at === 'r' ? Math.max(0, cols - ch.length) : (at < 0 ? cols + at : at);
      ch.forEach(function (c, i) { if (from + i < cols) slot[from + i] = [c, cls]; });
    });
    return slot.map(function (v) {
      return v ? '<i class="' + v[1] + '">' + esc(v[0]) + '</i>' : '<i></i>';
    }).join('');
  }

  /* 안내판의 **항공사 로고 자리**가 국기 자리다. 나라를 여럿 걸친 여행이면 여러 장을
     겹쳐 세운다(실제로 넷 있다 — ES,PT,QA 처럼).
     ★윈도우는 국기를 안 그리고 'JP' 두 글자로 떨어뜨린다. 그때는 코드 칩으로 낸다 —
       안내판에서는 그 두 글자가 오히려 편명처럼 읽혀서 제 일을 한다. */
  /* 나라 — 판에서는 국기도 쪽자 한 장이다. 못 그리는 기계에서는 두 글자 코드가
     한 칸에 들어간다(칸이 좁으므로 css 가 글자를 줄인다). */
  function flagChars(country) {
    const codes = U.codeList(country).filter(c => U.flag(c));
    const draw = canDrawFlags();
    /* ★한 나라가 **한 칸**이다. 예전엔 이어 붙인 문자열을 넘겼는데, 국기를 못 그리는
       기계에서는 'KR' 이 K·R 두 칸으로 쪼개졌다(2026-09-04). 배열로 넘겨 칸을 못 박는다. */
    return codes.slice(0, 3).map(c => (draw ? U.flag(c) : c));
  }

  /* 국가코드 뱃지 — 국기와 **따로** 선다. 국기는 이름 앞에서 그림으로 알려 주고,
     이 두 글자는 날짜 옆에서 편명처럼 읽힌다. 안내판의 항공사 코드 자리다.
     한 나라가 한 칸이므로 배열로 넘긴다(위와 같은 이유). */
  function codeChars(country) {
    return U.codeList(country).slice(0, 3);
  }


  /* ── 여행 목록 = 출발 안내판 ────────────────────────────────────────────
     **목적지와 날짜가 줄줄이 선 목록**이라 애초에 공항 출발 안내판과 같은 물건이다.
     칸이 고정되면 눈이 세로로 훑는다 — 카드마다 이름·날짜·레일이 제 자리를 잡고 있을
     때는 '작년 몇 월에 어디' 를 찾으려면 카드를 하나씩 읽어야 했다.
     Date · Trip · Days 셋. 돌아온 날짜는 안 적는다 — 출발일과 기간이 있으면 그 날이
     나오고, 같은 사실을 두 칸에 적지 않는다.
   ★★국기를 **여행 이름과 한 칸에** 넣는다. 제 칸을 주면 나라가 하나뿐인 여행에서
     국기 뒤가 40px 넘게 비는데, 그건 여백이 아니라 빈칸이다 — 이름 바로 앞에 붙이면
     '어디로' 와 '무슨 여행' 이 한 덩이로 읽히기도 한다(2026-09-04).
   ★금액은 뺐다. 목록에서 고르는 데 쓰는 값이 아니다 — 비용 탭이 그 일을 한다.
   ★'몇 곳' 은 **레일 옆**에 둔다. 레일이 곧 그 곳들을 찍은 그림이라 수와 그림이
     나란히 서고, 위 줄은 날짜·이름·기간 셋으로 조용해진다(2026-09-04).
   ★★미니 레일을 뺐다(2026-09-04). 카드가 90px 이던 시절 빈자리를 채우던 것인데,
     줄이 41px 이 되면서 들어갈 자리가 없다. 그 일은 이제 '기간' 과 '기록' 이 맡는다.
   ★바탕의 큰 국기도 뺐다. 국기가 제 칸을 얻었으니 바탕에 또 깔면 같은 말을 두 번 한다. */
  function card(t, phase) {
    const mine = shape.filter(r => r.trip_id === t.id);
    /* 장소 줄만 센다 — 결제 줄(parent_id)은 부모 날짜를 물려받아 두 번 세어진다.
       (합계는 mine 전체로 낸다 — 결제 줄에도 돈이 붙어 있다) */
    const stops = mine.filter(r => !r.parent_id);
    const nDays = U.tripDays(t);

    /* ★★미니 레일을 되살렸다(2026-09-04). 안내판으로 바꾸면서 뺐다가, 줄 **밑에
       한 줄로 길게** 까니 자리를 다투지 않고 들어간다 — 항공편 스트립처럼 읽힌다.
       칸 셋 아래를 통째로 가로지르므로 카드 시절보다 오히려 길다. */
    const days = dayList(t, stops);
    /* 칸이 좁아지면 점을 줄인다. 21일 여행이면 칸이 13px 인데 점 넷은 26px 라 넘친다 —
       그때는 '무엇이 있나' 대신 '있나 없나' 까지만 말한다. */
    const maxDots = days.length > 12 ? 1 : days.length > 7 ? 2 : 4;
    /* 일정이 하나도 없으면 레일을 세우지 않는다 — 빈 칸만 늘어선 회색 선이 스무 줄
       서면 고장 난 것처럼 보인다. 레일이 뜬다는 것 자체가 '계획이 있다' 는 뜻이 된다. */
    const rail = (days.length && stops.length) ? `<span class="mrail">${days.map(d => {
      const on = stops.filter(r => r.on_date === d);
      return on.length
        ? `<span class="md">${on.slice(0, maxDots).map(r =>
            `<i style="--k: var(--${U.kvar(r.kind)})"></i>`).join('')}</span>`
        : '<span class="md is-empty"></span>';
    }).join('')}</span>` : '';

    /* ★상태 칸을 따로 세웠다가 뺐다(2026-09-04). 지난 여행에는 쓸 말이 없어서 서른여덟
       중 서른다섯이 빈칸이었다 — 한 번도 안 차는 칸은 판이 아니라 구멍이다.
       떠날 때까지 며칠·며칠차만 **날짜 밑에** 되돌린다. */
    let st = '', stOn = '';
    if (phase === 'soon' && t.start_on) {
      const n = Math.ceil((Date.parse(t.start_on) - Date.parse(U.todayISO())) / DAYMS);
      st = n > 0 ? `D-${n}` : 'D-DAY';
    } else if (phase === 'now' && t.start_on) {
      st = `${Math.floor((Date.parse(U.todayISO()) - Date.parse(t.start_on)) / DAYMS) + 1}일차`;
      stOn = ' on';
    }

    return `<button class="trip${phase === 'now' ? ' is-now' : ''}" type="button" data-id="${esc(t.id)}">
      <span class="ttop">
        <span class="tg">${row([[0, t.start_on
          ? U.md(t.start_on) + (t.end_on ? '-' + U.md(t.end_on) : '') : '', 'dt']], DATE_COLS)}</span>
        <span class="tg tcc">${row([[0, codeChars(t.country), 'cc']], CC_COLS)}</span>
        ${st ? `<em class="tsx${stOn}">${esc(st)}</em>` : ''}
        <span class="tnum">${row([['r', nDays || '', 'dy']], 2)}<em>days</em></span>
        <span class="tnum">${row([['r', stops.length || '', 'st']], 3)}<em>places</em></span>
      </span>
      <span class="tnm">${(() => {
        /* ★국기를 **이름 앞**에 붙인다(2026-09-04). 윗줄 날짜 뒤에 뒀더니 '언제' 와
           '어디' 가 한 줄에서 붙어 버렸는데, 이름 앞에 오면 국기가 이름의 표지가 된다. */
        const fl = flagChars(t.country);
        const cls = 'fl' + (canDrawFlags() ? '' : ' ab');
        /* 국기판과 이름판을 따로 건다 — 사이의 틈이 둘을 갈라 준다.
           국기판이 늘 세 칸이라 이름줄은 나라가 몇이든 같은 데서 시작하고 끝난다. */
        return '<span class="tg tfl">' + row([[0, fl, cls]], FLAG_COLS) + '</span>'
             + '<span class="tg">' + row([[0, t.name, 'nm']], NAME_COLS) + '</span>';
      })()}</span>
      ${rail}
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
  /* ★★못 받은 셈을 **다시 묻는다.** 지우지 않는 것만으로는 모자랐다 — 첫 화면에서
     흘려지면 지킬 것도 없어서 여권과 카드의 숫자가 통째로 빠진 채 굳는다.
     LTE 에서 두 요청을 나란히 보내면 하나가 흘려지는 일이 있다(2026-09-02 폰에서
     '나라 1 · 일 3' 만 뜨고 지역·장소·쓴 돈이 없었다). 조용히 비워 두느니 다시 묻는다.
     ★두 번까지만. 계속 안 되면 네트워크가 없는 것이고, 그때는 목록만으로도 앱은 쓸 수 있다. */
  let shapeTries = 0;
  function retryShape() {
    if (shapeTries >= 2) return;
    shapeTries += 1;
    setTimeout(async () => {
      const again = await DB.trips.shape().catch(() => null);
      if (again && again.length) {
        shape = again; shapeTries = 0; render();
      } else if (!again) {
        retryShape();
      }
    }, 900 * shapeTries);
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
      if (sh) shape = sh; else retryShape();
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
    /* ★환율을 여기서 미리 받지 않는다. 목록에서 금액을 빼고 나니(2026-09-04) 이 화면에
       돈을 쓰는 데가 없어서, 홈을 열 때마다 아무도 안 읽는 왕복을 하고 있었다.
       비용·일정 탭은 저마다 FXS.ensure 를 부른다 — 필요한 데서 받으면 된다. */
    render();
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
        country: newPick.get(),
        cities: $('new-cities').value,
      });
      $('new').reset();
      newPick.set('');
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
  /* ★★로그인 화면이 **이 앱에 대해 아무것도 말하지 않았다** — 검은 바탕에 글자 세 줄이
     전부였다(2026-09-04). 정작 이 앱의 서명인 세계지도는 여권 카드 안에 있어서
     로그인해야만 보였다. 그 대륙을 첫 화면에 아주 옅게 깐다.
   ★새로 그리는 것이 없다. WORLD.d 는 이미 받아 둔 그 패스고 색도 여권과 같은 --wland 다 —
     같은 그림을 두 번 쓰는 것이지 장식을 하나 더 만드는 것이 아니다.
   ★점도 항로도 안 찍는다. 로그인 전에는 이 사람이 어디를 다녀왔는지 모른다 —
     모르는 것을 그리지 않는다. 움직이지도 않는다: 첫 화면에서 움직이는 것은 소음이다. */
  let gateDrawn = false;
  function drawGateWorld() {
    if (gateDrawn || typeof WORLD === 'undefined') return;
    gateDrawn = true;
    $('gate-world').innerHTML =
      `<svg viewBox="${WORLD.vb}" preserveAspectRatio="xMidYMid meet" aria-hidden="true">`
      + `<path class="gland" d="${WORLD.d}"/></svg>`;
  }

  function showGate(msg) {
    drawGateWorld();
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
  /* 나라 고르개 둘. crew.js 가 여행 설정 쪽을 쓰므로 전역에 얹어 준다. */
  const newPick = U.countryPicker($('new-country'), $('new-flags'));
  window.SETPICK = U.countryPicker($('set-country'), $('set-flags'));
  /* 통화를 고르면 나라도 대개 정해진다 — 아직 아무것도 안 골랐을 때만 미리 골라 준다.
     사람이 이미 고른 것을 통화 때문에 바꾸지 않는다. */
  $('new-cur').addEventListener('change', () => {
    if (newPick.get()) return;
    const c = U.guessCountry($('new-cur').value);
    if (c) newPick.set(c);
  });
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
    /* ★★띠가 뜨면 떠다니는 ＋ 를 그만큼 올린다. css 에 규칙은 있었는데 **아무도 이
       클래스를 켜지 않아서** 못 보낸 것이 있을 때 ＋ 가 띠 위에 얹혔다(2026-09-03).
       하필 끊긴 곳에서만 겹치는 자리라 여기서 걸리지 않았다. */
    document.body.classList.toggle('has-obox', !!n);
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
      /* ★앱이 아는 길은 '/' 와 '/t/…' 뿐이다. /themore 처럼 **다른 페이지**에서
         로그인을 눌렀으면 주소만 바꿔선 안 된다 — 지금 떠 있는 것은 index.html 이라
         여행 목록이 /themore 주소로 그려진다. 그럴 때는 진짜로 그리로 보낸다. */
      if (to !== '/' && !/^\/t\//.test(to)) { location.replace(to); return; }
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
