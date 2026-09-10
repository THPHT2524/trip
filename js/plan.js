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
  /* ★★날짜 탭을 걷었다(2026-09-05). DAY 띠가 sticky 라 내려가는 내내 '지금 몇째 날'
     을 붙들어 주는데, 탭도 같은 일을 하고 있었다 — 한 화면에서 같은 물음에 두 물건이
     답하고 있었고, 그중 하나는 44px 을 늘 차지했다.
     그리고 하루씩 끊어 보면 **날과 날 사이가 안 보인다.** 이 화면의 서명은 정거장
     사이의 빈 곳(.seg)인데, 마지막 정거장과 다음 날 첫 정거장 사이가 그 값을 가장
     많이 갖는다. 지도는 하루씩 보는 물건이고 일정은 죽 이어 보는 물건이다. */
  let editing = null;   // 수정 중인 항목 id (null = 새로 추가)
  let loaded = false;   // 이 여행의 일정을 한 번이라도 받았나
  let offline = false;  // 마지막 읽기가 로컬 사본이었나
  let crew = [];        // 동행자 — '결제자' 를 사람 이름으로 고르게 한다


  /* ★★**지금 보고 있는 날**을 돌려준다(2026-09-07). DAY 띠가 sticky 라 화면 머리에
     붙어 있는 그것이 곧 '지금 보고 있는 날' 이다 — 날짜 탭을 걷으면서 없어졌다고 적어
     둔 그 값이 사실은 화면에 계속 있었다(fillForm 의 날짜 기본값 주석 참고).
     ★붙어 있는 띠 = 머리말 아래 선(--h-top)을 이미 지난 것 중 **마지막** 것.
       아직 아무 띠도 안 지났으면(맨 위) 빈 값을 준다 — 없는 것을 지어내지 않는다. */
  function dayOnScreen() {
    const bands = document.querySelectorAll('#days .dayband');
    if (!bands.length) return '';
    const lim = (parseFloat(getComputedStyle(document.documentElement)
                 .getPropertyValue('--h-top')) || 64) + 6;
    let pick = '';
    bands.forEach(b => { if (b.getBoundingClientRect().top <= lim) pick = b.dataset.d || pick; });
    return pick;
  }

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

  /* ★목록에 서는 것은 **장소 줄**뿐이다. 결제 줄(parent_id 가 있는 줄)은 부모 밑에 붙는다 —
     따로 세우면 같은 자리가 두 번 나오고 구간 거리가 0m 로 끼어든다. */
  const ofDay = d => rows.filter(r => r.on_date === d && !r.parent_id);
  const kidsOf = id => rows.filter(r => r.parent_id === id);

  /* 결제 방식 셋. 환전을 고르면 '비용' 이 '받은 금액' 이 되고 환율 대신 낸 원화를 받는다 —
     사람은 영수증에 적힌 대로(얼마 주고 얼마 받았는지) 넣고, 환율은 우리가 낸다. */
  let settle = null;
  let parentOf = null;      // '결제 추가' 로 열었을 때 붙일 장소 줄의 id
  /* 원래 있던 안내문. 현금일 때 지갑 상태로 갈아 끼웠다가 되돌리려면 한 벌 갖고 있어야 한다.
     (HTML 에 적힌 것을 그대로 읽는다 — 문구를 두 곳에 두지 않는다) */
  const FX_HINT = $('if-fx-hint').textContent;
  function walletLine() {
    const w = M.cash;
    return (w && w.bal > 0)
      ? `지갑에 ${U.money(w.bal, w.cur)} 있습니다 — 평균 ${w.rate.toFixed(2)}원으로 여기서 빠집니다.`
      : '환전·출금 기록이 없어 환율을 낼 수 없습니다. 먼저 환전을 넣으세요.';
  }
  let hasOwnCost = false;   // 고치는 중인 장소 줄에 금액이 얹혀 있나(옛 방식)
  function drawSettle() {
    document.querySelectorAll('#if-settle button').forEach(b =>
      b.setAttribute('aria-pressed', String((b.dataset.settle || null) === settle)));
    const ex = settle === 'exchange';
    /* ★원화로 냈으면 환율은 물을 것이 없다 — 칸도 안내문도 감춘다.
       안내문이 두 줄이라, 원화 결제에서 시트의 세 줄이 쓸데없이 채워져 있었다. */
    const krwOnly = !ex && $('if-cur').value === U.SETTLE;
    /* ★★현금에는 환율 칸이 없다. 지갑에서 나가는 돈이라 **지갑의 평균 환율**이 곧 그 값이고,
       여기에 따로 적어 두면 값과 잔액이 갈린다 — 실제로 그래서 ¥970 을 쓰고도 남은 돈이
       ¥4,000 이었다(2026-09-02). 칸을 감추는 김에 **적혀 있던 값도 비운다.** */
    const cash = settle === 'cash';
    $('if-cost-lbl').textContent = ex ? '받은 금액' : '단가';
    $('if-qty-wrap').hidden = ex;              // 환전에 '갯수' 는 뜻이 없다
    $('if-apv-wrap').hidden = ex || krwOnly || cash;
    if (cash) $('if-apv').value = '';
    $('if-krw-wrap').hidden = !ex;
    $('if-fx-hint').hidden = ex || krwOnly;    // 승인금액 칸이 숨은 마당에 그 설명만 남으면 안 된다
    /* 칸을 없앤 자리에 **지갑을 보여 준다** — 얼마 남았는지가 곧 '이걸 현금으로 낼 수 있나' 다 */
    $('if-fx-hint').textContent = cash ? walletLine() : FX_HINT;
    /* 결제 줄에는 장소가 없다 — 장소는 부모가 갖는다. 링크·구분·시각을 감춘다. */
    const kid = !!parentOf;
    $('if-place-wrap').hidden = kid;
    $('if-kind-wrap').hidden = kid;
    $('if-when-wrap').hidden = kid;
    $('if-name-lbl').textContent = kid ? '항목' : '장소명';
    $('if-name').placeholder = kid ? '술값' : '오사카성';

    /* ★★환전에는 **적을 이름이 없다**(2026-09-06). 서른여덟 여행의 환전 넉 줄이 다
       '환전' 이었다 — 늘 같은 말을 손으로 적게 하느니 칸을 걷고 저장할 때 넣는다.
       비고 나면 맨 윗줄이 통째로 남으므로, 그 자리를 **제일 먼저 적을 값**에 준다:
       받은 금액과 그 통화다. 둘은 한 짝이라 늘 붙어 다녀야 한다 — 통화를 아랫줄에
       두면 원화로 고정인 지출금액 옆에 서서 그 칸의 통화처럼 읽힌다.
     ⚠ required 도 같이 풀어야 한다. 감춘 칸이 required 로 남아 있으면 브라우저가
       보이지도 않는 칸을 가리키며 submit 을 막는다(그리고 아무 말도 안 보인다). */
    const tr = $('if-title-row'), mr = $('if-money-row');
    $('if-name-wrap').hidden = ex;
    $('if-name').required = !ex;
    if (ex) {
      tr.appendChild($('if-cost-wrap'));
      tr.appendChild($('if-cur-wrap'));
    } else if ($('if-cost-wrap').parentElement !== mr) {
      /* 제자리로 — 차례가 곧 이 줄의 뼈대다(단가·갯수·통화·승인금액·지출금액) */
      ['if-cost-wrap', 'if-qty-wrap', 'if-cur-wrap', 'if-apv-wrap', 'if-krw-wrap']
        .forEach(id => mr.appendChild($(id)));
    }
    /* ★★장소를 넣을 때는 돈을 묻지 않는다 — 결제는 저장한 뒤 따로 붙인다.
       한 자리에서 결제가 둘 이상인 일이 흔한데, 첫 결제만 장소 줄에 얹으면
       같은 것이 두 곳에 살게 된다. 옛 줄(금액이 얹힌 것)은 고칠 수 있어야 하므로 편다. */
    $('if-pay').hidden = !kid && !hasOwnCost;
    showSum();
  }

  /* 단가 × 갯수가 얼마인지 그 자리에서 보여 준다 — 머릿속으로 곱하게 두지 않는다. */
  function showSum() {
    const unit = +$('if-cost').value || 0;
    const qty = Math.max(1, +$('if-qty').value || 1);
    const cur = $('if-cur').value;
    const el = $('if-calc');
    if (!unit) { el.textContent = ''; return; }
    if (settle === 'exchange') {
      const krw = +$('if-krw').value || 0;
      el.textContent = krw ? `환율 ${(krw / unit).toFixed(2)}원 — ${U.money(unit, cur)} 받고 ${U.money(krw, U.SETTLE)} 냄` : '';
      return;
    }
    const tot = unit * qty;
    const head = qty > 1 ? `합계 ${U.money(tot, cur)}` : '';
    /* ★승인금액은 **이미 원화**다 — 환율처럼 곱하지 않는다. 대신 그 금액이 총액에
       견주어 몇 원짜리 환율이었는지를 옆에 적어 준다(저장되는 값이 그 비율이다). */
    const apv = +$('if-apv').value || 0;
    if (apv) {
      el.textContent = head + `${head ? ' · ' : ''}승인 ${U.money(apv, U.SETTLE)}`
        + (tot > 0 ? ` — 환율 ${(apv / tot).toFixed(2)}원` : '');
      return;
    }
    if (cur === U.SETTLE) { el.textContent = head; return; }

    /* ★환율 칸이 비어 있으면 **그날 고시로 미리 셈해 보여 준다.** 저장한 뒤 비용 탭에
       가서야 얼마인지 아는 것은 늦다 — 지금 쓴 돈이 원화로 얼마인지가 이 칸의 용건이다.
       (현금은 지갑 평균으로 빠지므로 여기서 셈하지 않는다 — 위 안내가 지갑을 말한다) */
    const probe = { on_date: $('if-date').value, cost_cur: cur, settle };
    const auto = FXS.rateOf(probe);
    if (auto) {
      const note = FXS.noteOf(probe);
      el.textContent = head + `${head ? ' · ' : ''}${U.money(tot * auto, U.SETTLE)}`
        + ` — ${note && !note.exact ? note.on + ' ' : ''}전신환매도율 ${auto}`;
      return;
    }
    el.textContent = head;
    /* 아직 안 받아 온 날짜·통화면 받아 두고 다시 그린다. 한 번이면 뒤로는 즉시 뜬다. */
    if (settle !== 'cash' && probe.on_date) {
      FXS.ensure([{ cost: tot, fx: null, on_date: probe.on_date, cost_cur: cur, settle }])
        .then(got => { if (got) showSum(); }).catch(() => {});
    }
  }
  ['if-cost', 'if-qty', 'if-apv', 'if-krw', 'if-cur'].forEach(id =>
    $(id).addEventListener('input', showSum));
  $('if-payer').addEventListener('change', drawSettle);
  $('if-cur').addEventListener('change', drawSettle);   // 원화로 냈으면 승인금액도 물을 것이 없다
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

  /* '다음 갈 곳' — 오늘 이후로 아직 안 다녀온 첫 **정거장**. 현지에서 이 앱을 여는 이유다.
     ★★결제 줄을 뺀다(2026-09-10). 결제 줄은 부모의 날짜·시각을 물려받는데 seq 까지
       같은 짝이 실제 데이터에 **서른 중 여섯** 있다 — 세 열쇠가 다 비면 부모와 자식의
       차례가 정해지지 않고, 자식이 앞서면 그 id 가 여기서 뽑힌다. 그런데 결제 줄은
       화면에 .stop 으로 서지 않으므로(kidsOf 가 따로 뽑는다) **어느 줄에도 표가 안
       붙는다** — '다음 갈 곳' 이 통째로 사라진다.
     ⚠ 지금 데이터로 돌려 보면 한 번도 안 걸린다(그 여섯이 하루의 첫 줄인 적이 없다).
       고장이 난 적은 없고, 날 뿐이었다 — 정거장을 묻는 자리이니 정거장만 본다. */
  function nextId() {
    const t = U.todayISO();
    const cand = rows.filter(r => !r.parent_id && !r.done && r.on_date >= t);
    return cand.length ? cand[0].id : null;
  }

  // ── 그리기 ────────────────────────────────────────────────────────────
  function render() {
    days = buildDays();
    drawDays();
  }



  function drawDays() {
    const el = $('days');
    closeMemo();                          // 붙어 있던 단추가 곧 사라진다
    /* 다시 불러오는 데 성공했으면 ＋ 를 되돌린다(showFail 이 감춘다) */
    if (failed) { failed = false; $('fab').hidden = false; }
    /* ⚠ 조건이 `!rows.length && !days.length` 였다 — 날짜를 적어 둔 여행은 이 갈래에
       못 들어와서, 새로 만든 이레짜리 여행이 'Day 1 비어 있는 날' 을 일곱 줄
       늘어놓았다(2026-09-06). **'비어 있는 날' 은 다른 날에 내용이 있을 때만 정보다** —
       전부 비었으면 그건 정보가 아니라 아직 안 쓴 것이고, 그때 필요한 것은
       일곱 번의 '없음' 이 아니라 한 번의 '여기서 시작한다' 다. */
    if (!rows.length) {
      /* ★★일정이 없어도 **레일은 있다**(2026-09-06). 전에는 가운데에 회색 두 줄만
         남고 레일이 통째로 사라졌는데, 그러면 이 화면이 노선도라는 사실도 같이
         사라진다 — 정거장이 없는 노선도는 빈 레일이지 빈 종이가 아니다.
         비어 있는 핀 하나를 레일에 걸어 '여기서 시작한다' 를 자리로 말한다. */
      el.innerHTML = '<div class="planempty">'
        + '<span class="pin" aria-hidden="true"></span>'
        + '<p><strong>아직 정거장이 없습니다</strong>'
        + '<b>＋</b> 로 첫 곳을 놓으면 여기서 노선이 시작합니다.<br>'
        + '구글맵 링크를 붙이면 장소와 좌표가 같이 채워집니다.</p></div>';
      return;
    }
    M = MONEY.total(rows, FXS.rateOf);        // 이번 그리기에서 쓸 셈 한 벌
    const nid = nextId();
    el.innerHTML = (offline ? '<p class="note">연결이 없어 마지막으로 받아 둔 일정을 보여줍니다</p>' : '')
                 + days.map((d, i) => dayHtml(d, i + 1, nid)).join('');
  }

  function dayHtml(d, n, nid) {
    const list = ofDay(d);
    /* ★★하루 합계는 **결제 줄까지** 센다. 목록에는 장소 줄만 세우지만(ofDay), 돈은
       자식에도 붙어 있다 — 장소 줄만 세었더니 항공권 ₩428,000 을 결제 줄로 옮긴 날의
       띠가 ₩595,238 에서 ₩177,238 로 떨어졌다(2026-09-02). 비용 탭은 전체 rows 를
       쓰기 때문에 맞았고, 그래서 두 화면의 숫자가 갈렸다. 결제 줄은 부모의 날짜를
       물려받으므로 on_date 로 고르면 둘 다 들어온다. */
    const money = rows.filter(r => r.on_date === d);
    const { sum, miss } = dayCost(money);
    const cost = money.some(r => r.cost != null)
      /* ★숫자만 붉게 둔다. 이 띠는 sticky 라 하루치 40줄을 넘기는 내내 화면에 남는데,
         문장 전체가 붉으면 스크롤하는 동안 계속 소리친다. 셀 것은 건수다. */
      /* ★가운뎃점으로 가른다. 이 앱은 곁말을 늘 '·' 로 잇는데(3일 · 66곳 · ₩789,480,
         비용 탭의 '20건 합산 · 원화 기준 · 6건 환율 없음') 이 띠만 안 그래서
         '₩223,074 +4건 환율 없음' 이 한 덩이로 읽혔다. */
      ? U.money(sum, U.SETTLE) + (miss ? ` · <span class="warn">+${miss}건</span> 환율 없음` : '')
      : '';

    /* ★날 수도 쪽자에 앉는다 — 홈의 연도 띠(2026 · 4 TIMES 24 DAYS)와 같은 어법이다.
       두 화면이 같은 판때기를 쓰면 한 물건으로 읽힌다(2026-09-04). */
    const band = `<div class="dayband" data-d="${esc(d)}">
        <!-- ★★이 띠는 **레일 밖이다**(2026-09-06). 정거장이 아니라 구역 표시라
             레일을 물려받지 않는다 — 들여쓰기도 없고 선도 지나가지 않는다.
             날이 바뀌는 자리에서 레일이 끊기는 것이 곧 '여기서 하루가 끝났다' 다. -->
        <span class="daytag">Day ${n}</span>
        <span class="date">${esc(U.md(d))} <i class="ko">${esc(U.dowOf(d))}</i></span>
        <span class="sum">${cost}</span>
      </div>`;

    if (!list.length) return band + `<section class="day"><p class="blank">비어 있는 날</p></section>`;

    /* ★★정거장 번호. **지도 탭과 같은 규칙으로** 센다 — 날짜마다 1부터, 좌표가 있는
       줄만(js/map.js 의 withGeo → pinEl(r, i+1)). 지도에서 본 5번이 목록의 어느 줄인지
       찾을 수 있어야 두 화면이 한 여행을 말한다. 전에는 지도만 번호를 달고 목록은
       빈 링이라 대조할 방법이 없었다(2026-09-02).
       ★좌표가 없는 줄은 번호가 없다 — 지도에 안 찍히니 번호를 줄 수도 없고,
         '이 줄은 지도에서 빠진다' 는 사실이 점 크기로 드러난다. */
    let seq = 0;
    const num = new Map();
    list.forEach(r => { if (GEO.ok(r)) num.set(r.id, ++seq); });

    let html = '';
    list.forEach((r, i) => {
      html += stopHtml(r, nid, num.get(r.id));
      const nx = list[i + 1];
      if (nx) html += segHtml(r, nx);
    });
    return band + `<section class="day">${html}</section>`;
  }

  /* ★★결제자는 **한 글자 + 그 사람의 색**이다(2026-09-06). 이름을 다 적으면 길이가
     제각각이라 금액 앞이 들쭉날쭉했고, 한 줄에 배지가 둘(수단·사람)이면 어느 쪽이
     사람인지도 안 보였다. 동그란 색칠판은 사람이라는 것을 모양만으로 말한다.
   ★★색은 **동행자 목록의 순번**으로 준다(2026-09-06). 처음에는 아이디를 해시했는데,
     색이 여덟뿐이라 **두 사람이 같은 칸에 떨어질 수 있었다** — 셋이면 세 번에 한 번은
     겹친다(생일 문제). 순번으로 돌리면 여덟 명까지 무조건 다 다르다.
     여덟 색은 이 앱의 구분 색이 쓰는 색상환 자리에서 골랐다. 채도·밝기는 테마마다
     한 벌뿐이라(--pc-s/--pc-l) 어느 색을 뽑아도 이 화면의 톤을 벗어나지 않는다.
     ⚠ 목록에 없는 사람(초대에서 빠진 옛 결제)은 해시로 떨어뜨린다 — 색이 없느니
       겹칠 위험을 안고라도 주는 편이 낫다.
   ★한 글자만 남으므로 **온전한 이름은 title·aria-label 이 진다.** */
  function payerChip(c) {
    if (!c.payer_id) return '';
    const nm = Crew.nameOf(crew, c.payer_id) || '냄';
    /* 색은 U.hue 가 정한다 — 설정 탭의 동행자 줄이 같은 것을 쓴다(같은 사람 같은 색) */
    return `<span class="badge pw" style="--pc: ${U.hue(crew, c.payer_id)}"
      title="${esc(nm)}" aria-label="${esc(nm)}">${esc(nm.trim().charAt(0).toUpperCase())}</span>`;
  }

  function stopHtml(r, nid, num) {
    const k = U.kvar(r.kind);
    /* ⚠ is-pending 은 **줄에도** 단다(2026-09-10). 전에는 안쪽 단추(.item)에만 있었는데
       '아직 못 보냈다' 를 그리는 자리는 레일 위의 핀이고, 핀은 .stop 의 자식이라
       .item 에서는 닿지 않는다(css 에는 부모를 고르는 수가 없다). */
    const cls = ['stop', r.done ? 'is-done' : '', r.id === nid ? 'is-next' : '',
                 r._pending ? 'is-pending' : '',
                 ].filter(Boolean).join(' ');
    const time = r.at_time ? r.at_time.slice(0, 5) : '';
    /* ★비용이 없으면 **아무 말도 하지 않는다.** 전에는 '비용 미정' 을 적었는데,
       65줄짜리 여행에서 57줄이 그랬다 — 빈 칸의 이름을 57번 읽는 셈이다.
       관광지에 값을 안 적는 것은 실수가 아니라 보통이다. */
    const kids = kidsOf(r.id);
    /* ★결제가 여럿인 자리는 **그 자리의 합**을 적는다. 공항에서 항공권과 환전을 따로
       넣었더니 장소 줄에는 아무 금액도 안 남았다 — ₩462,498 을 쓴 자리가 빈 줄로 보였다.
       (환전은 지출이 아니라 지갑에 넣는 것이라 합계에서 빠진다 — p.spend 가 가른다) */
    /* ★★**줄에는 적은 그대로, 발치 합계는 늘 원화.** 낱낱의 결제 줄은 엔으로 넣었으면
       엔으로 선다 — 그 자리에서 알고 싶은 것은 '얼마 냈나' 이지 '원으로 얼마인가' 가
       아니고, 줄마다 원화를 붙이면 숫자가 두 배가 된다.
     ★★합계의 통화는 **더한 것들이 정한다**(2026-09-06). 그 자리에서 엔으로만 썼으면
       합계도 엔이다 — 낱낱이 다 ¥ 인데 합만 ₩ 로 서면, 위의 수들과 견줄 수가 없어서
       더한 값이 맞는지를 눈으로 못 짚는다. 통화가 섞였을 때만 원화로 모은다:
       그때는 어느 통화로도 못 적으니 정산 통화가 유일한 공통분모다. */
    const cost = (() => {
      if (kids.length) {
        /* ★★지출이 하나뿐이어도 **낸다**(2026-09-06). 한 건일 때 감춰 보기도 했는데
           (같은 금액이 한 자리에 두 번 서니까), 그러면 발치 줄이 자리마다 있었다
           없었다 해서 **눈이 세로로 훑을 기준선을 잃는다.** 스물아홉 줄짜리 날에서는
           그 흔들림이 중복보다 비싸다. 늘 같은 자리에 같은 이름으로 선다.
         ★환전은 여기 안 들어온다 — 지출이 아니라 지갑에 넣는 것이다(p.spend 가 가른다).
           그래서 항공권+환전 자리의 합계는 항공권 하나만 센 값이고, 그것이 맞다. */
        const paid = [r, ...kids].filter(x => { const p = M.per.get(x.id); return p && p.spend; });
        if (!paid.length) return '';
        /* ⚠ 한글은 **고딕으로 싸서** 낸다. 이 칸은 등폭인데 Plex Mono 에는 한글이
           없어서 낱자만 대체 글꼴로 떨어지고 사이의 빈칸은 등폭 그대로였다 —
           600/1000 짜리 넓은 빈칸이 껴서 '합 계' 로 벌어졌다(.badge 와 같은 병). */
        const lbl = '<i class="ko">합계</i> ';
        /* 한 통화로만 썼으면 그 통화로 — 환산이 끼지 않으므로 '+n건' 도 없다 */
        const curs = new Set(paid.map(x => x.cost_cur));
        if (curs.size === 1 && paid.every(x => x.cost != null)) {
          const one = paid.reduce((a, x) => a + (+x.cost || 0), 0);
          return `<span class="money">${lbl}${esc(U.money(one, paid[0].cost_cur))}</span>`;
        }
        /* 섞였다 — 원화로 모은다. 환율이 없어 못 옮긴 줄은 **빼고 세되 몇 건인지
           말한다**: 조용히 빠지면 합계가 틀린 채로 맞아 보인다. */
        let sum = 0, miss = 0;
        paid.forEach(x => { const p = M.per.get(x.id);
          if (p.krw == null) miss += 1; else sum += p.krw; });
        return `<span class="money">${lbl}${esc(U.money(sum, U.SETTLE))}${
          miss ? ` <span class="warn">+${miss}건</span>` : ''}</span>`;
      }
      /* 옛 줄 — 장소에 금액이 얹혀 있는 것(지금 방식으로는 안 생긴다. 서른여덟 여행에
         한 줄도 없다). 딸린 결제 줄이 없어 **여기 말고는 그 돈이 설 자리가 없으므로**
         한 건이어도 낸다 — 위의 '한 건이면 안 낸다' 는 옮겨 적기를 막는 규칙이지
         돈을 감추는 규칙이 아니다. 한 건이니 통화도 적은 그대로다. */
      if (r.cost == null) return '';
      return `<span class="money">${esc(U.money(r.cost, r.cost_cur))}</span>`;
    })();
    const link = GM.placeUrl(r);
    /* 같은 자리의 추가 결제 — 장소 아래 들여 붙는다. 지도에는 안 찍힌다(부모가 그 자리다).
       ★★'＋ 결제 추가' 는 **모든 장소 줄**에 세운다. 34.2px × 65 = 2,222px 로 싸지 않지만,
         이것이 돈을 넣는 주 경로다 — 장소 폼에서 결제를 묻지 않기로 했으므로(v=65)
         돈은 반드시 이 단추나 시트를 거쳐야 들어온다.
         ★한 번 걷었다가 두 번 되돌렸다(v=58→59 전체 제거, v=68→69 하나짜리 복구, v=73 전체 복구).
           처음 값을 매길 때 '한 번도 안 눌린 단추' 라고 셌는데, 그때는 결제를 자식 줄로
           넣는 방식 자체가 없었다 — 안 눌린 것이 당연했다. 없는 기능의 사용량으로
           그 기능의 자리값을 매긴 것이 틀렸다. */
    const payHtml = kids.map(c => {
      const who = payerChip(c);
      /* ★결제 수단은 **셋 다 적는다**(2026-09-06). 전에는 카드일 때만 비워 뒀는데,
         라벨이 이름 앞으로 오면서 그 자리가 비면 줄마다 이름 시작점이 달라진다 —
         기본값이라 안 적던 것이 이제는 기둥을 무너뜨린다. */
      const way = c.settle === 'cash' ? '현금' : c.settle === 'exchange' ? '환전' : '카드';
      /* ★★환전 줄은 **금액 둘**로 적는다(2026-09-06). 이름 자리에 '환전' 이 서 있었는데
         그 말은 바로 왼쪽 배지가 이미 하고 있었다 — 한 줄에서 같은 말을 두 번 했다.
         환전이라는 사건은 '얼마 주고 얼마 받았나' 한 쌍이고, 그 두 수가 설 자리가
         마침 비어 있다: 받은 것이 이름 자리, 낸 원화가 금액 자리.
         ⚠ 낸 원화는 DB 에 없다 — fx 가 '낸 원화 ÷ 받은 금액' 이라 되짚어 낸다
           (시트의 지출금액 칸도 같은 셈으로 값을 되돌린다). */
      const ex = c.settle === 'exchange';
      const gave = (ex && c.cost != null && c.fx != null) ? Math.round(+c.cost * +c.fx) : null;
      /* ★금액이 **맨 뒤**다. 앞에 두면 배지 개수에 따라 숫자가 좌우로 밀려서
         결제 줄이 둘만 돼도 자릿수가 안 맞는다 — 세로로 읽히라고 mono 를 쓰는 판에. */
      /* ★수단이 **맨 앞**이다. 무엇으로 냈는지가 줄의 성질이라 이름보다 먼저 온다 —
         현금 줄은 지갑에서 빠지고 환전 줄은 지출이 아니다. 폭을 고정해 이름들이
         세로로 한 기둥에 선다. 결제자는 뒤에 남는다(그건 줄의 성질이 아니다). */
      return `<button class="payrow" type="button" data-edit="${esc(c.id)}">
        <span class="badge way">${esc(way)}</span>
        <span class="pn${ex ? ' mono' : ''}">${
          ex ? esc(U.money(c.cost, c.cost_cur)) : esc(c.name)}</span>
        ${who}
        <span class="pm">${
          ex ? (gave != null ? esc(U.money(gave, U.SETTLE)) : '')
             : esc(U.money(c.cost, c.cost_cur))}</span>
      </button>`;
    }).join('');
    return `<div class="${cls}" style="--k: var(--${k})">
      <span class="pin">${num || ''}</span>
      <span class="stopcard">
        <!-- ★★머리가 먼저다(2026-09-06). 항공사 여정표의 짜임을 빌려 왔다: **구분이
             머리로 올라가고 시각+이름이 그 밑에 선다.** 훑을 때 눈이 먼저 잡는 것은
             '무엇을 하는 자리인가' 이고 이름은 그 다음이다 — 전에는 이름이 위라
             스물아홉 줄에서 구분이 묻혔다.
             ★★★그리고 이 줄은 **단추 밖이다**(2026-09-06). 수정 시트가 열리는 자리는
               시각+이름 그 한 줄뿐이어야 한다 — 머리줄 오른쪽에는 메모·지도가 앉아
               있어서, 그 줄까지 단추면 그 둘을 노리다 빗나갈 때마다 시트가 열린다.
             ⚠ row1/row2 는 **뜻이 아니라 자리**를 가리키던 이름이라 이제 거꾸로 읽힌다.
               css 의 padding 규칙들이 이 순서를 따라 자리를 바꿨다(.acts 가 절대 위치라
               '위/아래' 를 보고 앉는다). -->
        <span class="row2">
          <span class="kind">${esc(r.kind)}</span>
          ${r.payer_id ? `<span class="badge who">${esc(Crew.nameOf(crew, r.payer_id) || '냄')}</span>` : ''}
        </span>
        <button class="item${r.done ? ' is-done' : ''}${r._pending ? ' is-pending' : ''}" type="button" data-edit="${esc(r.id)}">
          <span class="row1">
            <span class="time${time ? '' : ' none'}">${esc(time || '시각 미정')}</span>
            <span class="name">${esc(r.name)}</span>
          </span>
        </button>
        <!-- ★★단추 셋이 **머리줄 한 자리**에 모인다(2026-09-06). 두 줄로 갈라 두었던
             것은 '메모 취소 지도' 세 낱말이 136px 을 먹어 이름을 잘랐기 때문인데,
             그림으로 바꾸니 셋이 96px 이면 된다 — 이름줄은 통째로 이름 몫이 됐다.
             ★글자가 없으므로 뜻은 aria-label 이 진다. 상자도 안 두른다: 그림은 그
               자체로 누를 것처럼 보이고, 셋 다 상자면 오른쪽이 상자 밭이 된다.
             ★★그림은 **선 그림**이다(2026-09-06). 이모지였을 때는 색 그림 둘이
               color 를 무시하고 글리프 둘만 받아서 한 줄에 무게가 셋이었다 —
               U.icon 주석에 그 이야기가 적혀 있다. -->
        <span class="acts">
          ${r.memo ? `<button class="act" type="button" data-memo="${esc(r.id)}"
             aria-label="메모 보기">${U.icon('memo')}</button>` : ''}
          ${link ? `<a class="act" href="${esc(link)}" target="_blank" rel="noopener"
             aria-label="지도에서 보기">${U.icon('pin')}</a>` : ''}
          <button class="act" type="button" data-done="${esc(r.id)}"
             aria-label="${r.done ? '되돌리기' : '취소'}">${U.icon(r.done ? 'undo' : 'x')}</button>
        </span>
      </span>
      ${payHtml}
      <!-- ★★합계가 **발치로 내려왔다**(2026-09-06). 영수증과 같은 차례다 — 항목을 다
           찍고 마지막에 합을 낸다. 머리에 있을 때는 무엇을 더한 값인지 모르는 채로
           먼저 보였고, 여기서는 바로 위 금액들의 기둥 끝에 앉아 저절로 설명된다. -->
      <div class="payfoot">
        <button class="payadd" type="button" data-pay="${esc(r.id)}">＋ 결제 추가</button>
        ${cost}
      </div>
    </div>`;
  }

  /* 구간 — 이 화면의 서명. 정거장 사이의 **빈 곳이 정보를 갖는다.** */
  function segHtml(a, b) {
    const m = GEO.dist(a, b);
    if (m == null) return '<div class="seg seg-blank"></div>';
    const url = GM.dirUrl(a, b);
    /* 한글은 고딕으로 싼다 — 위 '합계' 와 같은 이유(등폭 빈칸이 낱말을 벌린다) */
    const label = `<i class="ko">직선</i> ${esc(GEO.label(m))}`;
    return `<div class="seg">${
      url ? `<a href="${esc(url)}" target="_blank" rel="noopener"><span class="km">${label}</span></a>`
          : `<span class="km">${label}</span>`}</div>`;
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
    if (r) parentOf = r.parent_id || null;      // 고치기로 열면 그 줄의 소속을 따른다
    hasOwnCost = !!(r && !r.parent_id && r.cost != null);
    $('if-link').value = (r && r.map_url) || '';
    $('if-name').value = (r && r.name) || '';
    /* ★날짜 기본값: 고치는 줄의 날 → **여행 중이면 오늘** → 보고 있는 날 → 시작일.
       '그때그때 추가' 는 대개 오늘 일이다. 전체 보기에서 시작일이 먼저 오면
       3일차 저녁에 넣은 줄이 1일차로 들어간다.
     ★★'고르고 있는 날' 을 되찾았다(2026-09-07). 날짜 탭을 걷으면서 없어졌다고 적어
       뒀었는데, sticky 로 머리에 붙어 있는 DAY 띠가 계속 그 값이었다(dayOnScreen).
       미리 계획할 때 3일차를 보며 ＋ 를 누르면 1일차로 들어가던 것이 이걸로 풀린다.
     ⚠ 순서는 주석이 처음 적어 둔 것과 **거꾸로**다: 여행 중에는 오늘이 이긴다.
       일정 탭은 열면 늘 맨 위(1일차)라, 보고 있는 날을 먼저 두면 3일차 저녁에
       ＋ 를 눌렀는데 1일차로 들어가는 그 사고가 그대로 되살아난다. 보고 있는 날은
       **여행 중이 아닐 때만** 쓴다 — 고장난 경우만 고치고 되는 경우는 안 건드린다. */
    const today = U.todayISO();
    const inTrip = trip && trip.start_on && trip.end_on
                && today >= trip.start_on && today <= trip.end_on;
    $('if-date').value = (r && r.on_date) || (inTrip ? today : dayOnScreen())
                      || (trip && trip.start_on) || today;
    $('if-time').value = (r && r.at_time) ? r.at_time.slice(0, 5) : '';
    $('if-kind').value = (r && r.kind) || '기타';
    settle = (r && r.settle) || null;
    $('if-krw').value = (r && r.settle === 'exchange' && r.cost != null && r.fx != null)
      ? Math.round(+r.cost * +r.fx) : '';
    /* ★DB 에는 **총액**이 있고 화면에는 단가를 보여 준다(qty 로 되나눈다).
       총액을 저장하는 이유: 갯수를 나중에 지워도 쓴 돈이 안 바뀐다. */
    const q = (r && +r.qty > 1) ? +r.qty : 1;
    $('if-qty').value = q > 1 ? q : '';
    $('if-cost').value = (r && r.cost != null) ? (+r.cost / q) : '';
    $('if-cur').value = (r && r.cost_cur) || (trip && trip.base_cur) || 'KRW';
    /* 저장된 것은 비율이지만 보여 주는 것은 금액이다 — 총액을 곱해 되짚는다.
       (환전은 제 칸이 따로 있고, 현금은 지갑 평균이라 둘 다 여기 안 온다) */
    $('if-apv').value = (r && r.settle !== 'exchange' && r.settle !== 'cash'
                         && r.cost != null && r.fx != null)
      ? Math.round(+r.cost * +r.fx) : '';
    $('if-memo').value = (r && r.memo) || '';
    $('if-payer').value = (r && r.payer_id) || '';
    $('if-lat').value = (r && r.lat != null) ? r.lat : '';
    $('if-lng').value = (r && r.lng != null) ? r.lng : '';
    /* ★접어 둔 칸에 값이 들어 있으면 펴 준다 — 안 그러면 고치러 왔다가 못 본다 */
    $('if-more').open = !!(r && r.memo);
    $('if-del').hidden = !r;
    /* ★★이 시트에는 **라틴을 안 단다**(2026-09-06). 설정·새 여행은 여행 한 벌을
       처음에 한 번 적어 두는 서식이라 신고서 어법이 맞는데, 여기는 길에서 한 줄씩
       빠르게 넣는 자리다 — 칸마다 이름표가 두 겹이면 훑는 눈이 그만큼 느려진다.
       서식으로 읽혀야 하는 것과 빨라야 하는 것을 가른다. */
    $('if-sum').textContent = parentOf ? (r ? '결제 고치기' : '결제 추가')
                            : (r ? '일정 고치기' : '일정 추가');
    $('if-err').textContent = '';
    /* ★★맨 **끝**에서 부른다. 중간에 있었더니 두 가지가 어긋났다(2026-09-02):
       현금일 때 비운 환율 칸이 바로 아래에서 다시 채워졌고, '각자 냄' 을 아직 안 읽어
       갯수 라벨이 '인원' 으로 안 바뀌었다. 폼의 모양은 값을 다 넣은 **뒤에** 정한다. */
    drawSettle();
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

  /* 화면의 단가 × 갯수. cost 칸과 fx 칸이 **같은 총액**을 봐야 해서 한 곳에 둔다. */
  const tot = () => (+$('if-cost').value || 0) * Math.max(1, +$('if-qty').value || 1);

  function valueOf() {
    /* 결제 줄은 **부모의 날짜·구분을 물려받는다** — 따로 적게 두면 어긋난 채 저장되고
       그러면 그 결제가 다른 날 합계에 들어간다. */
    const par = parentOf ? rows.find(x => x.id === parentOf) : null;
    return {
      on_date: par ? par.on_date : $('if-date').value,
      at_time: par ? par.at_time : ($('if-time').value || null),
      kind: par ? par.kind : $('if-kind').value,
      /* 환전은 이름 칸이 없다 — 늘 같은 말이라 여기서 넣는다(위 drawSettle 참고) */
      name: settle === 'exchange' ? '환전' : $('if-name').value,
      memo: $('if-memo').value,
      map_url: $('if-link').value,
      lat: $('if-lat').value, lng: $('if-lng').value,
      /* 화면은 단가, DB 는 총액 */
      cost: $('if-cost').value === '' ? '' : String((+$('if-cost').value) * Math.max(1, +$('if-qty').value || 1)),
      qty: Math.max(1, +$('if-qty').value || 1),
      cost_cur: $('if-cur').value,
      /* 환전은 '얼마 주고 얼마 받았나' 로 받아 환율을 우리가 낸다 — 사람이 9.4 를 계산하게 두지 않는다 */
      /* 현금은 환율을 갖지 않는다 — 지갑의 평균으로 센다. 감춘 칸에 값이 남아 있어도 안 보낸다. */
      /* ★★카드는 **승인 원화**를 받아 같은 셈으로 비율을 낸다(2026-09-06). 사람이 아는
         것은 환율이 아니라 결제 알림에 찍힌 그 금액이다 — 환전 칸이 이미 그렇게 하고
         있었고, 같은 길을 쓰니 DB 에 칸을 늘리지 않아도 된다. 반올림하지 않으므로
         고치러 다시 열면 적었던 금액이 그대로 돌아온다.
         ⚠ 실제 청구는 이 값도 아니다 — 카드사는 매입일(보통 1~3일 뒤) 환율로 다시
           잡는다. 그래도 우리가 아는 것 중에는 이게 제일 가깝다. */
      fx: settle === 'cash' ? ''
        : settle === 'exchange'
          ? (+$('if-cost').value > 0 ? String(+$('if-krw').value / +$('if-cost').value) : '')
          : ($('if-apv').value !== '' && tot() > 0
              ? String(+$('if-apv').value / tot()) : ''),
      settle,
      parent_id: parentOf,
      payer_id: $('if-payer').value || null,
      done: editing ? !!(rows.find(r => r.id === editing) || {}).done : false,
      /* 시각이 없는 줄은 그날 맨 뒤에 붙인다. 시각이 있으면 서버 정렬이 시각을 먼저 본다.
         ★★결제 줄은 **부모의 날**로 센다(2026-09-10). `$('if-date')` 를 보고 있었는데
           결제 폼에서는 그 칸이 감춰져 있어(drawSettle) 값이 부모의 날이 아니라 '오늘'
           이거나 '보고 있던 날' 이다 — 엉뚱한 날의 seq 를 세니 부모보다 작은 수가
           나올 수 있었다. 부모의 날에서 세면 자식은 늘 그 날 정거장들 **뒤**에 선다. */
      seq: editing ? (rows.find(r => r.id === editing) || {}).seq || 0
                   : ofDay(par ? par.on_date : $('if-date').value)
                       .reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1,
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

  /* ── 못 불러왔을 때 ──────────────────────────────────────────────────
     ★★**＋ 를 감춘다**(2026-09-10). 못 불러온 여행 위에 떠 있는 ＋ 는 '여기 넣으세요'
       라고 권하는 것인데, 정작 누르면 폼은 열리고 저장은 안 된다(무엇에 붙일지 모른다).
       판이 실패한 상태에서 할 수 있는 일은 **다시 불러오는 것 하나뿐**이라 그것만 둔다.
     ★말은 U.loadFail 이 짓는다 — 같은 말을 두 번 하지 않고, 끊긴 것은 사람 말로 바꾸고,
       나갈 단추를 단다(왜 그렇게 하는지는 util.js 주석에 있다). */
  let failed = false;
  function showFail(e) {
    failed = true;
    $('days').innerHTML = U.loadFail('일정을 못 불러왔습니다', e, Outbox.isOffline(e));
    $('fab').hidden = true;
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
    /* ★환율은 **기다리지 않는다.** 먼저 그리고, 받아 오면 다시 그린다 —
       현지에서 네트워크가 느릴 때 일정이 그것 때문에 늦게 뜨면 안 된다. */
    FXS.ensure(rows).then(got => { if (got) render(); }).catch(() => {});
  }

  // ── 붙이기 ────────────────────────────────────────────────────────────
  $('days').addEventListener('click', async e => {
    /* 못 불러온 판의 '다시 시도' — 여기 말고는 나갈 길이 없다 */
    const retry = e.target.closest('[data-retry]');
    if (retry) {
      retry.disabled = true;
      retry.textContent = '불러오는 중…';
      try { await reload(); loaded = true; }
      catch (err) { showFail(err); }
      return;
    }
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
    const memo = e.target.closest('[data-memo]');
    if (memo) { showMemo(memo, rows.find(x => x.id === memo.dataset.memo)); return; }
    const pay = e.target.closest('[data-pay]');
    if (pay) { parentOf = pay.dataset.pay; editing = null; openSheet(null); return; }
    const edit = e.target.closest('[data-edit]');
    if (edit) openSheet(rows.find(x => x.id === edit.dataset.edit));
  });

  /* ── 메모 쪽지 ──────────────────────────────────────────────────────
     ★뒤를 어둡게 덮는 팝업이 아니다. 한 줄짜리 메모를 보려고 화면이 닫히면
       보던 자리를 잃는다 — 누른 단추 **바로 아래** 붙는 쪽지로 띄운다.
     ★popover="auto" 라 바깥 누름·Esc·포커스 되돌리기는 브라우저가 해 준다.
       (카드 앱의 ⓘ 툴팁과 같은 어법이다 — 두 앱이 같은 몸짓을 쓴다.) */
  const POP = $('memopop');
  let popAt = null;                       // 지금 이 쪽지가 붙어 있는 단추
  function placePop() {
    if (!popAt || !POP.matches(':popover-open')) return;
    const M = 8, GAP = 6;
    POP.style.left = '0px'; POP.style.top = '0px';   // 재기 전에 폭이 확정되게
    const p = POP.getBoundingClientRect(), b = popAt.getBoundingClientRect();
    /* 오른쪽 끝에 붙은 단추라 그냥 left 를 맞추면 화면 밖으로 나간다 — 오른쪽을 맞춘다 */
    const left = Math.min(Math.max(M, b.right - p.width), Math.max(M, innerWidth - p.width - M));
    let top = b.bottom + GAP;
    if (top + p.height > innerHeight - M) top = Math.max(M, b.top - p.height - GAP);
    POP.style.left = left + 'px'; POP.style.top = top + 'px';
  }
  function showMemo(btn, r) {
    if (!r || !r.memo) return;
    /* 같은 단추를 다시 누르면 닫힌다 — 열고 닫는 데 두 손이 필요하지 않게 */
    if (popAt === btn && POP.matches(':popover-open')) { POP.hidePopover(); return; }
    POP.textContent = r.memo;             // ★textContent — 메모는 사람이 적은 글이다
    popAt = btn;
    if (POP.matches(':popover-open')) POP.hidePopover();
    POP.showPopover();
    placePop();
  }
  POP.addEventListener('click', () => POP.hidePopover());   // 눌러서 닫는다
  POP.addEventListener('toggle', e => {
    if (e.newState === 'open') {
      addEventListener('scroll', placePop, { passive: true });
      addEventListener('resize', placePop);
    } else {
      removeEventListener('scroll', placePop);
      removeEventListener('resize', placePop);
      popAt = null;
    }
  });
  /* 목록을 다시 그리면 붙어 있던 단추가 사라진다 — 떠 있는 쪽지도 같이 걷는다 */
  function closeMemo() { if (POP.matches(':popover-open')) POP.hidePopover(); }

  $('if-form').addEventListener('submit', save);
  $('if-del').addEventListener('click', del);
  $('if-link').addEventListener('change', readLink);
  $('if-link').addEventListener('paste', () => setTimeout(readLink, 0));
  $('fab').addEventListener('click', () => { parentOf = null; openSheet(null); });
  $('if-close').addEventListener('click', closeSheet);
  /* 배경을 누르면 닫는다. dialog 자신이 클릭 대상이면 시트 **바깥**을 누른 것이다. */
  $('if-dlg').addEventListener('click', e => { if (e.target === $('if-dlg')) closeSheet(); });

  $('if-kind').innerHTML = U.KINDS.map(k => `<option value="${k}">${k}</option>`).join('');
  U.fillCurs($('if-cur'));      // 목록은 util.js 에 한 벌 — index.html 에 세 벌 적혀 있었다

  return {
    /* ★탭을 옮길 때마다 불린다(지도·비용도 같은 rows 를 쓴다).
       그래서 **같은 여행이면 다시 받지 않는다** — 탭 하나 옮길 때마다 네트워크를 타면
       현지 데이터에서 그대로 비용이 된다. 다시 받는 것은 여행이 바뀌었을 때와 편집한 뒤뿐이다. */
    async open(t) {
      const same = trip && trip.id === t.id;
      trip = t;
      if (same && loaded) { render(); return; }
      rows = []; editing = null; loaded = false;
      fillForm(null);
      /* ★★불러오는 동안에도 **노선도는 노선도다**(2026-09-10). 회색 글자 한 줄만
         띄우고 있었는데, 그러면 `#days::before` 의 레일이 그 문단 높이만큼(110~160px)만
         자라서 왼쪽에 **토막 난 선**이 남는다 — 레일이 아니라 렌더 찌꺼기로 보였다.
         2026-09-06에 홈·일정·비용이 '비어 있는 제 모습' 을 갖게 해 놓고 정작 **제일
         자주 보는 이 화면**만 빠져 있었다(여행을 열 때마다 지나간다).
       ★빈 상태(.planempty)와 **같은 물건**을 쓴다: 레일에 걸린 점선 핀 하나.
         새 어법을 만들지 않는다 — 둘 다 '정거장이 아직 없는 노선도' 다.
       ⚠ 정거장을 **지어내지 않는다.** 몇 곳인지 아는 것은 홈의 shape 이지 여기가 아니고,
         모르는 수만큼 회색 칸을 늘어놓는 것은 이 앱이 미니 레일에서 한 번 걷어낸
         짓이다('로딩 스켈레톤처럼 보였다', 2026-09-01). 핀 하나가 자리를 말한다. */
      $('days').innerHTML = '<div class="planempty is-loading">'
        + '<span class="pin" aria-hidden="true"></span>'
        + '<p role="status">불러오는 중…</p></div>';
      /* 동행자 목록을 미리 받아 '결제자' 를 채운다.
         못 받아도(끊겼거나 혼자거나) 폼은 그대로 쓴다 — '안 적음' 만 남는다.
       ★★'각자 냄' 을 걷었다(2026-09-06). 한 결제를 여럿이 나눠 낸 일을 적는 값이었는데
         서른여덟 여행 181줄에 **한 줄도 없었다** — 실제로는 한 사람이 긁고 나중에
         정산하지, 그 자리에서 갈라 내지 않는다. 고르개에 있던 것만으로 '결제자' 가
         두 가지 물음이 됐다: 사람이냐 방식이냐.
       ⚠ db 의 split 칸과 money.js 의 그 갈래는 남겨 둔다 — 스키마를 바꾸는 일이고,
         셈은 그 칸이 false 면 어차피 사람 한 명으로 떨어진다. */
      try {
        crew = await Crew.of(t.id);
        $('if-payer').innerHTML = '<option value="">안 적음</option>'
          + crew.map(m => `<option value="${esc(m.user_id)}">${esc(String(m.email || '').split('@')[0])}</option>`).join('');
      } catch (e) { crew = []; }
      try { await reload(); loaded = true; failed = false; }
      catch (e) { showFail(e); }
    },
    rows: () => rows,
    /* ★다른 모듈(cost.js 가 환율을 채우는 것처럼)이 DB 를 고쳤을 때 쓴다.
       open() 은 같은 여행이면 다시 안 받으므로, 그 길로 부르면 낡은 rows 를 그대로 다시 그린다.
       한 번 그렇게 당했다(2026-09-01 — 환율은 저장됐는데 화면은 '환율 없음' 그대로). */
    refresh: () => reload(),
  };
})();
