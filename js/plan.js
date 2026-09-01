/* plan.js — 일정 화면. 이 앱의 본체다.
   ─────────────────────────────────────────────────────────────────────────
   **일정표는 세로로 세운 노선도다.** 정거장(장소)과 구간(이동)이 번갈아 나오고,
   구간에는 거리가 적힌다. 그 거리는 좌표로 그 자리에서 계산한다(GEO.dist) —
   호출도 키도 없다. 누르면 구글맵 길찾기로 나간다(GM.dirUrl).

   ★계획과 기록이 한 화면에 있다. 미래 날짜에 미리 적어 두고, 현지에서 고치고,
     돌아와서 비용을 채운다. 그래서 거의 모든 칸이 비어 있어도 된다.

   화면 상태는 셋뿐이다: 어느 여행 · 고른 날 · 편집 중인 항목. 나머지는 다시 그린다. */
const Plan = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  let trip = null;      // 지금 여행
  let rows = [];        // 이 여행의 일정 전부
  let days = [];        // 화면에 세울 날짜들
  let pick = null;      // 고른 날 (null = 전체)
  let editing = null;   // 수정 중인 항목 id (null = 새로 추가)
  let loaded = false;   // 이 여행의 일정을 한 번이라도 받았나
  let offline = false;  // 마지막 읽기가 로컬 사본이었나

  const KINDS = ['숙소', '식사', '관광', '이동', '쇼핑', '기타'];
  const KVAR = { 숙소: 'k-stay', 식사: 'k-eat', 관광: 'k-see', 이동: 'k-move', 쇼핑: 'k-buy', 기타: 'k-etc' };

  /* 세울 날짜를 정한다.
     ★여행 기간이 있으면 **비어 있는 날도 세운다** — 3일차가 비었다는 사실 자체가 정보다.
       (기간이 없으면 일정이 적힌 날만 세운다. 없는 날을 지어낼 근거가 없다.) */
  function buildDays() {
    const has = [...new Set(rows.map(r => r.on_date))].sort();
    if (trip && trip.start_on && trip.end_on) {
      const out = [];
      for (let d = trip.start_on; d <= trip.end_on; d = U.addDays(d, 1)) out.push(d);
      // 기간 밖에 적힌 일정도 버리지 않는다(날짜를 나중에 늘릴 수 있다)
      has.forEach(d => { if (!out.includes(d)) out.push(d); });
      return out.sort();
    }
    return has;
  }

  const ofDay = d => rows.filter(r => r.on_date === d);

  /* 그날의 비용 합계. 기준통화로 환산된 것만 더한다 —
     환율이 없는 줄을 섞으면 엔과 원을 더하는 셈이 된다. 대신 몇 줄이 빠졌는지 적는다. */
  function dayCost(list) {
    let sum = 0, miss = 0;
    list.forEach(r => {
      if (r.cost == null) return;
      if (r.cost_cur === (trip && trip.base_cur)) { sum += +r.cost; return; }
      if (r.fx) { sum += +r.cost * +r.fx; return; }
      miss += 1;
    });
    return { sum, miss };
  }

  /* '다음 갈 곳' — 오늘 이후로 아직 안 다녀온 첫 줄. 현지에서 이 앱을 여는 이유다. */
  function nextId() {
    const t = U.todayISO();
    const cand = rows.filter(r => !r.done && r.on_date >= t);
    return cand.length ? cand[0].id : null;
  }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function render() {
    days = buildDays();
    if (pick && !days.includes(pick)) pick = null;
    drawDayTabs();
    drawDays();
  }

  function drawDayTabs() {
    const el = $('daytabs');
    if (!days.length) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = days.map((d, i) =>
      `<button type="button" role="tab" data-day="${esc(d)}" aria-selected="${String(pick === d)}">D${i + 1}</button>`
    ).join('') +
      `<button type="button" role="tab" data-day="" aria-selected="${String(pick === null)}">전체</button>`;
  }

  function drawDays() {
    const el = $('days');
    if (!rows.length && !days.length) {
      el.innerHTML = '<p class="empty"><strong>아직 일정이 없습니다</strong>'
                   + '아래에서 첫 줄을 넣으세요. 구글맵 링크를 붙이면 장소가 채워집니다.</p>';
      return;
    }
    const show = pick ? [pick] : days;
    const nid = nextId();
    el.innerHTML = (offline ? '<p class="note">연결이 없어 마지막으로 받아 둔 일정을 보여줍니다</p>' : '')
                 + show.map(d => dayHtml(d, days.indexOf(d) + 1, nid)).join('');
  }

  function dayHtml(d, n, nid) {
    const list = ofDay(d);
    const { sum, miss } = dayCost(list);
    const cost = list.some(r => r.cost != null)
      ? U.money(sum, trip.base_cur) + (miss ? ` <span class="warn">+${miss}건 환율 없음</span>` : '')
      : '';

    const band = `<div class="dayband">
        <span class="daytag">Day ${n}</span>
        <span class="date">${esc(U.md(d))} ${esc(U.dowOf(d))}</span>
        <span class="sum">${cost}</span>
      </div>`;

    if (!list.length) {
      return band + `<section class="day"><p class="blank">비어 있는 날</p></section>`;
    }

    let html = '';
    list.forEach((r, i) => {
      html += stopHtml(r, nid);
      const nx = list[i + 1];
      if (nx) html += segHtml(r, nx);
    });
    return band + `<section class="day">${html}</section>`;
  }

  function stopHtml(r, nid) {
    const k = KVAR[r.kind] || 'k-etc';
    const cls = ['stop', r.done ? 'is-done' : '', r.id === nid ? 'is-next' : ''].filter(Boolean).join(' ');
    const time = r.at_time ? r.at_time.slice(0, 5) : '';
    const cost = r.cost == null ? '<span class="money none">비용 미정</span>'
      : `<span class="money">${esc(U.money(r.cost, r.cost_cur))}${
          r.fx && r.cost_cur !== trip.base_cur
            ? ' · ' + esc(U.money(+r.cost * +r.fx, trip.base_cur)) : ''}</span>`;
    const link = GM.placeUrl(r);
    return `<div class="${cls}" style="--k: var(--${k})">
      <span class="pin"></span>
      <button class="item${r.done ? ' is-done' : ''}${r._pending ? ' is-pending' : ''}" type="button" data-edit="${esc(r.id)}">
        <span class="row1">
          <span class="time${time ? '' : ' none'}">${esc(time || '시각 미정')}</span>
          <span class="name">${esc(r.name)}</span>
        </span>
        <span class="row2">
          <span class="kind">${esc(r.kind)}</span>
          ${cost}
          ${r.ref_code ? `<span class="badge">${esc(r.ref_code)}</span>` : ''}
          ${r.memo ? '<span class="badge">메모</span>' : ''}
        </span>
      </button>
      <span class="acts">
        ${link ? `<a class="act" href="${esc(link)}" target="_blank" rel="noopener">지도</a>` : ''}
        <button class="act" type="button" data-done="${esc(r.id)}">${r.done ? '되돌리기' : '다녀옴'}</button>
      </span>
    </div>`;
  }

  /* 구간 — 이 화면의 서명. 정거장 사이의 **빈 곳이 정보를 갖는다.** */
  function segHtml(a, b) {
    const m = GEO.dist(a, b);
    if (m == null) return '<div class="seg seg-blank"></div>';
    const url = GM.dirUrl(a, b);
    const label = `직선 ${GEO.label(m)}`;
    return `<div class="seg">${
      url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><span class="km">${esc(label)}</span></a>`
          : `<span class="km">${esc(label)}</span>`}</div>`;
  }

  // ── 폼 ────────────────────────────────────────────────────────────────
  function fillForm(r) {
    editing = r ? r.id : null;
    $('if-id').value = r ? r.id : '';
    $('if-link').value = (r && r.map_url) || '';
    $('if-name').value = (r && r.name) || '';
    $('if-date').value = (r && r.on_date) || pick || (trip && trip.start_on) || U.todayISO();
    $('if-time').value = (r && r.at_time) ? r.at_time.slice(0, 5) : '';
    $('if-kind').value = (r && r.kind) || '기타';
    $('if-cost').value = (r && r.cost != null) ? r.cost : '';
    $('if-cur').value = (r && r.cost_cur) || (trip && trip.base_cur) || 'KRW';
    $('if-fx').value = (r && r.fx != null) ? r.fx : '';
    $('if-ref').value = (r && r.ref_code) || '';
    $('if-book').value = (r && r.book_url) || '';
    $('if-memo').value = (r && r.memo) || '';
    $('if-lat').value = (r && r.lat != null) ? r.lat : '';
    $('if-lng').value = (r && r.lng != null) ? r.lng : '';
    $('if-del').hidden = !r;
    $('if-sum').textContent = r ? '일정 고치기' : '일정 추가';
    $('if-err').textContent = '';
    markGeo();
  }

  /* 좌표가 있는지를 폼이 말해 준다 — 없으면 지도에도 안 나오고 거리도 안 나온다.
     조용히 빠지면 왜 선이 안 이어지는지 알 수 없다. */
  function markGeo() {
    const has = $('if-lat').value !== '' && $('if-lng').value !== '';
    $('if-geo').textContent = has
      ? `좌표 있음 (${(+$('if-lat').value).toFixed(4)}, ${(+$('if-lng').value).toFixed(4)})`
      : '좌표 없음 — 지도와 거리 표시에서 빠집니다';
    $('if-geo').className = 'hint' + (has ? ' ok' : '');
  }

  /* 붙여넣은 링크를 읽는다. 전체 URL 은 브라우저에서 끝나고, 단축 링크만 서버가 펼친다. */
  async function readLink() {
    const raw = $('if-link').value.trim();
    if (!raw) return;
    $('if-err').textContent = '';
    $('if-geo').textContent = '링크를 읽는 중…';
    try {
      let got = GM.parse(raw);
      if (got && got.needsServer) {
        const full = await DB.expandMapUrl(raw);
        $('if-link').value = full;         // 원문을 펼친 것으로 바꿔 둔다(다음엔 서버가 필요 없다)
        got = GM.parse(full);
      }
      if (!got) {
        $('if-err').textContent = '구글맵 링크로 읽지 못했습니다. 장소명을 직접 적으세요.';
        markGeo();
        return;
      }
      if (got.name && !$('if-name').value.trim()) $('if-name').value = got.name;
      if (got.lat != null) { $('if-lat').value = got.lat; $('if-lng').value = got.lng; }
      markGeo();
      if (got.approx) {
        $('if-geo').textContent += ' · 지도 중심 좌표라 정확하지 않을 수 있습니다';
      }
    } catch (e) {
      $('if-err').textContent = e.message;
      markGeo();
    }
  }

  function valueOf() {
    return {
      on_date: $('if-date').value,
      at_time: $('if-time').value || null,
      kind: $('if-kind').value,
      name: $('if-name').value,
      memo: $('if-memo').value,
      map_url: $('if-link').value,
      lat: $('if-lat').value, lng: $('if-lng').value,
      cost: $('if-cost').value, cost_cur: $('if-cur').value, fx: $('if-fx').value,
      ref_code: $('if-ref').value, book_url: $('if-book').value,
      done: editing ? !!(rows.find(r => r.id === editing) || {}).done : false,
      /* 시각이 없는 줄은 그날 맨 뒤에 붙인다. 시각이 있으면 서버 정렬이 시각을 먼저 본다. */
      seq: editing ? (rows.find(r => r.id === editing) || {}).seq || 0
                   : ofDay($('if-date').value).reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1,
    };
  }

  async function save(ev) {
    ev.preventDefault();
    $('if-save').disabled = true;
    $('if-err').textContent = '';
    try {
      const v = valueOf();
      try {
        if (editing) await DB.items.update(editing, v);
        else await DB.items.create(trip.id, v);
      } catch (e) {
        /* 서버가 거절한 것(검증·권한)은 그대로 보여 준다 — 다시 보내도 같다.
           끊겨서 못 보낸 것만 쌓아 둔다. */
        if (!Outbox.isOffline(e)) throw e;
        Outbox.queue(editing
          ? { kind: 'update', id: editing, tripId: trip.id, row: DB.items.shape(v) }
          : { kind: 'create', tempId: Outbox.tmpId(), tripId: trip.id, row: DB.items.shape(v) });
      }
      await reload();
      fillForm(null);
      $('if-wrap').open = false;
    } catch (e) {
      $('if-err').textContent = e.message;
    } finally {
      $('if-save').disabled = false;
    }
  }

  async function del() {
    if (!editing) return;
    const r = rows.find(x => x.id === editing);
    if (!confirm(`'${r ? r.name : '이 일정'}' 을 지울까요?`)) return;
    $('if-del').disabled = true;
    try {
      try { await DB.items.remove(editing); }
      catch (e) {
        if (!Outbox.isOffline(e)) throw e;
        Outbox.queue({ kind: 'delete', id: editing, tripId: trip.id });
      }
      await reload();
      fillForm(null);
      $('if-wrap').open = false;
    } catch (e) {
      $('if-err').textContent = e.message;
    } finally {
      $('if-del').disabled = false;
    }
  }

  /* 서버에서 받고, 못 받으면 **마지막으로 받아 둔 것**을 쓴다.
     그 위에 아직 못 보낸 것을 얹는다 — 적었는데 사라진 것처럼 보이면 안 된다. */
  async function reload() {
    let base;
    try {
      base = await DB.items.list(trip.id);
      Outbox.cacheSet(trip.id, base);
      offline = false;
    } catch (e) {
      const cached = Outbox.cacheGet(trip.id);
      if (cached && Outbox.isOffline(e)) { base = cached; offline = true; }
      else throw e;
    }
    rows = Outbox.apply(trip.id, base);
    render();
  }

  // ── 붙이기 ────────────────────────────────────────────────────────────
  $('daytabs').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    pick = b.dataset.day || null;
    drawDayTabs(); drawDays();
  });

  $('days').addEventListener('click', async e => {
    const done = e.target.closest('[data-done]');
    if (done) {
      const r = rows.find(x => x.id === done.dataset.done);
      try { await DB.items.setDone(r.id, !r.done); }
      catch (err) {
        if (!Outbox.isOffline(err)) { alert(err.message); return; }
        Outbox.queue({ kind: 'update', id: r.id, tripId: trip.id,
                       row: { ...DB.items.shape(r), done: !r.done } });
      }
      await reload();
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const r = rows.find(x => x.id === edit.dataset.edit);
      fillForm(r);
      $('if-wrap').open = true;                      // 수정을 누르면 코드가 대신 펴 준다
      $('if-wrap').scrollIntoView({ block: 'nearest' });
    }
  });

  $('if-form').addEventListener('submit', save);
  $('if-del').addEventListener('click', del);
  $('if-link').addEventListener('change', readLink);
  $('if-link').addEventListener('paste', () => setTimeout(readLink, 0));
  $('if-wrap').addEventListener('toggle', () => { if ($('if-wrap').open && !editing) fillForm(null); });

  $('if-kind').innerHTML = KINDS.map(k => `<option value="${k}">${k}</option>`).join('');

  return {
    /* ★탭을 옮길 때마다 불린다(지도·비용도 같은 rows 를 쓴다).
       그래서 **같은 여행이면 다시 받지 않는다** — 탭 하나 옮길 때마다 네트워크를 타면
       현지 데이터에서 그대로 비용이 된다. 다시 받는 것은 여행이 바뀌었을 때와 편집한 뒤뿐이다. */
    async open(t) {
      const same = trip && trip.id === t.id;
      trip = t;
      if (same && loaded) { render(); return; }
      rows = []; pick = null; editing = null; loaded = false;
      fillForm(null);
      $('days').innerHTML = '<p class="empty">불러오는 중…</p>';
      try { await reload(); loaded = true; }
      catch (e) { $('days').innerHTML = `<p class="empty"><strong>불러오지 못했습니다</strong>${esc(e.message)}</p>`; }
    },
    rows: () => rows,
  };
})();
