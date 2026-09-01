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
  let crew = [];        // 동행자 — '누가 냈나' 를 사람 이름으로 고르게 한다

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

  /* 결제 방식 셋. 환전을 고르면 '비용' 이 '받은 금액' 이 되고 환율 대신 낸 원화를 받는다 —
     사람은 영수증에 적힌 대로(얼마 주고 얼마 받았는지) 넣고, 환율은 우리가 낸다. */
  let settle = null;
  function drawSettle() {
    document.querySelectorAll('#if-settle button').forEach(b =>
      b.setAttribute('aria-pressed', String((b.dataset.settle || null) === settle)));
    const ex = settle === 'exchange';
    $('if-cost-lbl').textContent = ex ? '받은 금액' : '단가';
    $('if-qty-wrap').hidden = ex;              // 환전에 '갯수' 는 뜻이 없다
    $('if-fx-wrap').hidden = ex;
    $('if-krw-wrap').hidden = !ex;
    showSum();
  }

  /* 단가 × 갯수가 얼마인지 그 자리에서 보여 준다 — 머릿속으로 곱하게 두지 않는다. */
  function showSum() {
    const unit = +$('if-cost').value || 0;
    const qty = Math.max(1, +$('if-qty').value || 1);
    const cur = $('if-cur').value;
    const el = $('if-sum');
    if (!unit) { el.textContent = ''; return; }
    if (settle === 'exchange') {
      const krw = +$('if-krw').value || 0;
      el.textContent = krw ? `환율 ${(krw / unit).toFixed(2)}원 — ${U.money(unit, cur)} 받고 ${U.money(krw, U.SETTLE)} 냄` : '';
      return;
    }
    const tot = unit * qty;
    const fx = +$('if-fx').value || 0;
    el.textContent = (qty > 1 ? `합계 ${U.money(tot, cur)}` : '')
      + (fx ? `${qty > 1 ? ' · ' : ''}${U.money(tot * fx, U.SETTLE)}` : '');
  }
  ['if-cost', 'if-qty', 'if-fx', 'if-krw', 'if-cur'].forEach(id =>
    $(id).addEventListener('input', showSum));
  $('if-settle').addEventListener('click', e => {
    const b = e.target.closest('button[data-settle]');
    if (!b) return;
    settle = b.dataset.settle || null;
    if (settle === 'exchange' && !$('if-cur').value) $('if-cur').value = (trip && trip.base_cur) || 'JPY';
    drawSettle();
  });

  /* 그날의 비용 합계. **원화로** 환산된 것만 더한다 —
     환율이 없는 줄을 섞으면 엔과 원을 더하는 셈이 된다. 대신 몇 줄이 빠졌는지 적는다. */
  /* ★현금 지갑은 **여행 전체의 시간 순서**로만 셀 수 있다(앞의 환전이 뒤의 현금을 먹인다).
     그래서 하루치만 떼어 세지 않고, 전체를 한 번 굴린 뒤 그날 줄만 골라 더한다.
     ★한 번만 굴린다. 줄마다 부르면 65줄짜리 여행에서 4,225번 센다 — 그리기 시작할 때
       drawDays() 가 채우고, 아래는 그 결과만 읽는다. */
  let M = { per: new Map() };
  function dayCost(list) {
    const t = M;
    let sum = 0, miss = 0;
    list.forEach(r => {
      const p = t.per.get(r.id);
      if (!p || !p.spend) return;
      if (p.krw == null) miss += 1; else sum += p.krw;
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
    M = MONEY.total(rows);                    // 이번 그리기에서 쓸 셈 한 벌
    const show = pick ? [pick] : days;
    const nid = nextId();
    el.innerHTML = (offline ? '<p class="note">연결이 없어 마지막으로 받아 둔 일정을 보여줍니다</p>' : '')
                 + show.map(d => dayHtml(d, days.indexOf(d) + 1, nid)).join('');
  }

  function dayHtml(d, n, nid) {
    const list = ofDay(d);
    const { sum, miss } = dayCost(list);
    const cost = list.some(r => r.cost != null)
      /* ★숫자만 붉게 둔다. 이 띠는 sticky 라 하루치 40줄을 넘기는 내내 화면에 남는데,
         문장 전체가 붉으면 스크롤하는 동안 계속 소리친다. 셀 것은 건수다. */
      ? U.money(sum, U.SETTLE) + (miss ? ` <span class="warn">+${miss}건</span> 환율 없음` : '')
      : '';

    const band = `<div class="dayband">
        <span class="daytag">Day ${n}</span>
        <span class="date">${esc(U.md(d))} ${esc(U.dowOf(d))}</span>
        <span class="sum">${cost}</span>
      </div>`;

    if (!list.length) return band + `<section class="day"><p class="blank">비어 있는 날</p></section>`;

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
    /* ★비용이 없으면 **아무 말도 하지 않는다.** 전에는 '비용 미정' 을 적었는데,
       65줄짜리 여행에서 57줄이 그랬다 — 빈 칸의 이름을 57번 읽는 셈이다.
       관광지에 값을 안 적는 것은 실수가 아니라 보통이다. */
    const cost = r.cost == null ? ''
      : `<span class="money">${esc(U.money(r.cost, r.cost_cur))}${
          (() => { const p = M.per.get(r.id);
                   return (p && p.krw != null && r.cost_cur !== U.SETTLE)
                     ? ' · ' + esc(U.money(p.krw, U.SETTLE)) : ''; })()}</span>`;
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
          ${r.payer_id ? `<span class="badge">${esc(Crew.nameOf(crew, r.payer_id) || '냄')}</span>` : ''}
          ${r.ref_code ? `<span class="badge">${esc(r.ref_code)}</span>` : ''}
          ${r.memo ? '<span class="badge">메모</span>' : ''}
        </span>
      </button>
      <span class="acts">
        ${link ? `<a class="act" href="${esc(link)}" target="_blank" rel="noopener">지도</a>` : ''}
        <button class="act" type="button" data-done="${esc(r.id)}">${r.done ? '되돌리기' : '못 감'}</button>
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
  /* ── 입력 시트 열고 닫기 ────────────────────────────────────────────
     ★<dialog>.showModal() 을 쓴다. 배경 가림·Esc·포커스 가둠을 브라우저가 해 준다 —
       손으로 만들면 반드시 하나를 빠뜨린다(특히 포커스). */
  function openSheet(r) {
    fillForm(r);
    const d = $('if-dlg');
    if (!d.open) d.showModal();
    /* 열 때마다 맨 위부터 — 앞서 스크롤해 둔 자리가 남아 있으면
       새 줄을 넣으러 왔는데 메모 칸부터 보인다 */
    d.querySelector('.sheetbody').scrollTop = 0;
    if (!r) setTimeout(() => $('if-link').focus({ preventScroll: true }), 0);
  }
  const closeSheet = () => { if ($('if-dlg').open) $('if-dlg').close(); };
  /* 뒤 화면 잠금은 CSS 가 한다 — html:has(dialog[open]). */

  function fillForm(r) {
    editing = r ? r.id : null;
    $('if-id').value = r ? r.id : '';
    $('if-link').value = (r && r.map_url) || '';
    $('if-name').value = (r && r.name) || '';
    /* ★날짜 기본값: 고르고 있는 날 → **오늘(여행 기간 안이면)** → 시작일.
       '그때그때 추가' 는 대개 오늘 일이다. 전체 보기에서 시작일이 먼저 오면
       3일차 저녁에 넣은 줄이 1일차로 들어간다. */
    const today = U.todayISO();
    const inTrip = trip && trip.start_on && trip.end_on
                && today >= trip.start_on && today <= trip.end_on;
    $('if-date').value = (r && r.on_date) || pick || (inTrip ? today : '')
                      || (trip && trip.start_on) || today;
    $('if-time').value = (r && r.at_time) ? r.at_time.slice(0, 5) : '';
    $('if-kind').value = (r && r.kind) || '기타';
    settle = (r && r.settle) || null;
    $('if-krw').value = (r && r.settle === 'exchange' && r.cost != null && r.fx != null)
      ? Math.round(+r.cost * +r.fx) : '';
    drawSettle();
    /* ★DB 에는 **총액**이 있고 화면에는 단가를 보여 준다(qty 로 되나눈다).
       총액을 저장하는 이유: 갯수를 나중에 지워도 쓴 돈이 안 바뀐다. */
    const q = (r && +r.qty > 1) ? +r.qty : 1;
    $('if-qty').value = q > 1 ? q : '';
    $('if-cost').value = (r && r.cost != null) ? (+r.cost / q) : '';
    $('if-cur').value = (r && r.cost_cur) || (trip && trip.base_cur) || 'KRW';
    $('if-fx').value = (r && r.fx != null) ? r.fx : '';
    $('if-ref').value = (r && r.ref_code) || '';
    $('if-book').value = (r && r.book_url) || '';
    $('if-memo').value = (r && r.memo) || '';
    $('if-payer').value = (r && r.split) ? 'split' : ((r && r.payer_id) || '');
    $('if-lat').value = (r && r.lat != null) ? r.lat : '';
    $('if-lng').value = (r && r.lng != null) ? r.lng : '';
    /* ★접어 둔 칸에 값이 들어 있으면 펴 준다 — 안 그러면 고치러 왔다가 못 본다 */
    $('if-more').open = !!(r && (r.ref_code || r.book_url || r.memo));
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
        got = GM.parse(full);
        /* ★펼쳐지지 않고 **그대로** 돌아오는 일이 있다(코드가 죽었거나 구글이 404 를 준다).
           그때 got 은 다시 needsServer 라 아래 채우기가 전부 건너뛰어지는데,
           화면에는 아무 말도 안 나온다 — 사용자에게는 '눌러도 아무 일이 없다' 로 보인다.
           실패로 못박고 원문도 그대로 둔다(펼친 것이 아니므로 덮어쓰지 않는다). */
        if (got && got.needsServer) got = null;
        else $('if-link').value = full;    // 다음엔 서버가 필요 없다
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
      /* 화면은 단가, DB 는 총액 */
      cost: $('if-cost').value === '' ? '' : String((+$('if-cost').value) * Math.max(1, +$('if-qty').value || 1)),
      qty: Math.max(1, +$('if-qty').value || 1),
      cost_cur: $('if-cur').value,
      /* 환전은 '얼마 주고 얼마 받았나' 로 받아 환율을 우리가 낸다 — 사람이 9.4 를 계산하게 두지 않는다 */
      fx: settle === 'exchange'
        ? (+$('if-cost').value > 0 ? String(+$('if-krw').value / +$('if-cost').value) : '')
        : $('if-fx').value,
      settle,
      split: $('if-payer').value === 'split',
      payer_id: $('if-payer').value === 'split' ? null : ($('if-payer').value || null),
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
      closeSheet();
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
      closeSheet();
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
    if (edit) openSheet(rows.find(x => x.id === edit.dataset.edit));
  });

  $('if-form').addEventListener('submit', save);
  $('if-del').addEventListener('click', del);
  $('if-link').addEventListener('change', readLink);
  $('if-link').addEventListener('paste', () => setTimeout(readLink, 0));
  $('fab').addEventListener('click', () => openSheet(null));
  $('if-close').addEventListener('click', closeSheet);
  /* 배경을 누르면 닫는다. dialog 자신이 클릭 대상이면 시트 **바깥**을 누른 것이다. */
  $('if-dlg').addEventListener('click', e => { if (e.target === $('if-dlg')) closeSheet(); });

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
      /* 동행자 목록을 미리 받아 '누가 냈나' 를 채운다.
         못 받아도(끊겼거나 혼자거나) 폼은 그대로 쓴다 — '안 적음' 만 남는다. */
      try {
        crew = await Crew.of(t.id);
        $('if-payer').innerHTML = '<option value="">안 적음</option>'
          + '<option value="split">각자 냄</option>'
          + crew.map(m => `<option value="${esc(m.user_id)}">${esc(String(m.email || '').split('@')[0])}</option>`).join('');
      } catch (e) { crew = []; }
      try { await reload(); loaded = true; }
      catch (e) { $('days').innerHTML = `<p class="empty"><strong>불러오지 못했습니다</strong>${esc(e.message)}</p>`; }
    },
    rows: () => rows,
    /* ★다른 모듈(cost.js 가 환율을 채우는 것처럼)이 DB 를 고쳤을 때 쓴다.
       open() 은 같은 여행이면 다시 안 받으므로, 그 길로 부르면 낡은 rows 를 그대로 다시 그린다.
       한 번 그렇게 당했다(2026-09-01 — 환율은 저장됐는데 화면은 '환율 없음' 그대로). */
    refresh: () => reload(),
  };
})();
