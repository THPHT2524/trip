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
  let tripId = null;       // 지금 열어 둔 여행
  let tab = 'plan';

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
    $('trip-name').textContent = t ? t.name : '여행';
    $('trip-span').textContent = t ? fmtSpan(t.start_on, t.end_on) : '';
    document.querySelectorAll('#tabs button').forEach(b =>
      b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
    document.querySelectorAll('.pane').forEach(p =>
      p.hidden = p.dataset.tab !== tab);

    /* 일정은 이 여행의 본체다 — 어느 탭으로 들어와도 먼저 받아 둔다.
       (지도·비용도 결국 같은 rows 를 쓴다. 탭마다 따로 받으면 세 번 받는다.)
       ★지도는 그 rows 를 넘겨받기만 한다 — 자기 것을 또 받지 않는다. */
    if (t) Plan.open(t).then(() => { if (tab === 'map') Maps.open(t, Plan.rows()); });
  }

  function renderTrips() {
    const el = $('trips');
    if (!trips.length) {
      el.innerHTML = '<p class="empty"><strong>아직 여행이 없습니다</strong>'
                   + '새 여행을 만들거나, 받은 초대 링크를 여세요.</p>';
      return;
    }
    const group = { now: [], soon: [], past: [] };
    trips.forEach(t => group[phase(t)].push(t));
    const label = { now: '지금', soon: '예정', past: '지난 여행' };

    el.innerHTML = ['now', 'soon', 'past'].filter(k => group[k].length).map(k =>
      `<h2 class="grouphd">${label[k]}</h2>` + group[k].map(t => `
        <button class="trip${k === 'now' ? ' is-now' : ''}" type="button" data-id="${esc(t.id)}">
          <span class="nm">${esc(t.name)}${k === 'now' ? '<span class="now">지금</span>' : ''}</span>
          <span class="meta">${esc(fmtSpan(t.start_on, t.end_on))} · ${esc(t.base_cur)}</span>
        </button>`).join('')
    ).join('');
  }

  // ── 여행 불러오기 ─────────────────────────────────────────────────────
  async function load(openBest) {
    try {
      trips = await DB.trips.list();
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
      $('new-wrap').open = false;
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

  function refresh() {
    if (DB.mode() !== 'cloud') { showGate(); return; }
    $('gate').hidden = true;
    $('app').hidden = false;
    $('who').textContent = DB.email();
    load(true);
  }

  // ── 붙이기 ────────────────────────────────────────────────────────────
  $('signin').addEventListener('click', () => DB.signIn());
  $('signout').addEventListener('click', async () => { await DB.signOut(); trips = []; showGate(); });
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

  addEventListener('popstate', () => { const u = readUrl(); go(u.tripId, u.tab, false); });
  DB.onError(showGate);
  DB.onAuth(refresh);

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
    refresh();
  })();
})();
