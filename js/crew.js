/* crew.js — 동행자와 여행 설정.
   ─────────────────────────────────────────────────────────────────────────
   ★이름을 어디서 가져오나: trip_members 에는 uuid 뿐이고 auth.users 는 클라이언트가 못 읽는다.
     (읽히면 card-dashboard 와 공유하는 이 프로젝트의 **남의 계정까지** 노출된다.)
     그래서 security definer 함수 `trip.trip_crew(t)` 가 그 여행의 멤버만, 이메일과 역할만 준다.
   ★목록은 여기서 한 번 받아 두고 비용 탭도 같은 것을 쓴다 — 탭마다 부르면 두 번 부른다. */
const Crew = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  let trip = null, list = [];
  const memo = new Map();          // tripId → 멤버 목록

  /* 비용 탭이 '결제자' 를 사람 이름으로 적으려면 이 목록이 필요하다. */
  async function of(tripId, force) {
    if (!force && memo.has(tripId)) return memo.get(tripId);
    const rows = await DB.crew(tripId);
    memo.set(tripId, rows);
    return rows;
  }
  const nameOf = (rows, id) => {
    const m = (rows || []).find(x => x.user_id === id);
    if (!m) return '';
    return String(m.email || '').split('@')[0] || m.email || '';
  };

  const inviteUrl = t => `${location.origin}/?join=${encodeURIComponent(t.invite_code)}`;

  function draw() {
    const mine = DB.uid();
    const owner = trip.owner_id === mine;

    /* ★동그라미 색은 U.hue 가 정한다 — 일정 탭의 결제자 동그라미와 **같은 색**이다.
       같은 사람이 어느 화면에서나 같은 색이어야 한다. */
    $('crew-list').innerHTML = list.map(m => {
      const nm = String(m.email || '').split('@')[0];
      return `
      <li class="crewrow">
        <span class="av" style="--pc: ${U.hue(list, m.user_id)}"
          aria-hidden="true">${esc(nm.trim().charAt(0).toUpperCase())}</span>
        <span class="who2">
          <span class="nm">${esc(nm)}</span>
          <span class="em">${esc(m.email)}</span>
        </span>
        <span class="tagrow">
          ${m.role === 'owner' ? '<span class="badge">만든 사람</span>' : ''}
          ${m.user_id === mine ? '<span class="badge">나</span>' : ''}
          ${owner && m.user_id !== mine
            ? `<button class="act danger" type="button" data-kick="${esc(m.user_id)}"
                 aria-label="${esc(String(m.email || '').split('@')[0])} 내보내기">${U.icon('out')}</button>` : ''}
        </span>
      </li>`;
    }).join('');

    /* ★칸에는 **코드**를 보여준다. 링크는 375px 칸에서 잘려 못 읽는데,
       정작 사람이 읽고 불러 줄 수 있는 것은 코드다. 복사 단추가 링크를 가져간다. */
    $('crew-link').value = trip.invite_code || '';
    $('crew-count').textContent = `${list.length}명`;

    // 설정 — 소유자만 고칠 수 있다
    $('set-name').value = trip.name || '';
    $('set-from').value = trip.start_on || '';
    $('set-to').value = trip.end_on || '';
    $('set-cur').value = trip.base_cur || 'KRW';
    SETPICK.set(trip.country || '');
    $('set-cities').value = trip.cities || '';
    hintName();
    ['set-name', 'set-from', 'set-to', 'set-cur', 'set-cities', 'set-save']
      .forEach(id => { $(id).disabled = !owner; });
    SETPICK.disable(!owner);
    $('set-del').hidden = !owner;
    $('set-note').textContent = owner ? '' : '여행을 만든 사람만 고칠 수 있습니다.';

    /* 서식 번호 자리 — 나라와 떠난 해. 안내판이 날짜 옆에 다는 항공사 코드와 같은 것이다. */
    const cc = U.codeList(trip.country || '');
    const yr = (trip.start_on || trip.end_on || '').slice(0, 4);
    $('set-cc').innerHTML = (cc.length ? `<b>${esc(cc[0])}</b>` : '') + (yr ? ` ${esc(yr)}` : '');

    /* ★도장은 **다녀온 여행에만** 찍힌다 — 그래서 장식이 아니라 한 가지 사실이다.
       끝난 날이 오늘보다 앞설 때만. 끝을 안 적은 여행은 끝났는지 알 수 없다. */
    const over = trip.end_on && trip.end_on < U.todayISO();
    $('set-stamp').hidden = !over;
    if (over) $('set-stamp').innerHTML = stamp();
  }

  /* ── 여권 도장 ──────────────────────────────────────────────────────────
     ★★기울인 네모였다(2026-09-07에 다시 그렸다). 그건 도장이 아니라 이름표였다 —
       진짜 여권 도장의 문법은 셋이다: **이중 원테**, **테를 따라 휘어 도는 글자**,
       그리고 가운데 날짜. 셋 중 둘이 없으면 아무리 기울여도 도장으로 안 읽힌다.
     ★휘는 글자는 textPath 로만 된다. 그래서 여기만 svg 다 — 이 앱에서 곡선을
       그리는 유일한 자리이고, 도장이 원래 곡선으로 찍힌다.
     ★적히는 것은 다 사실이다: 위는 **다녀온 나라**, 가운데는 **머문 날**,
       아래는 **며칠**. 나라를 안 적었으면 위 칸은 비운다(지어내지 않는다).
     ⚠ 한글에 자간을 주면 낱자가 흩어지는데, 곡선 위에서는 그것이 **글자 사이를
       벌리는 유일한 방법**이기도 하다 — 라틴에만 준다. 곡선을 도는 한글은
       글자마다 각도가 달라져서 자간 없이도 벌어져 보인다. */
  /* ── 여권 도장 ──────────────────────────────────────────────────────────
     ★★기울인 네모 → 이중 원테와 휘어 도는 글자 → **다시 네모**(2026-09-07).
       원테 쪽이 도장답긴 했는데 이 종이에는 과했다: 곡선이 하나뿐이라 격자 위에서
       혼자 튀었고, 휜 글자를 읽느라 정작 날짜가 늦게 읽혔다.
       실제 도장 중에도 **둥근 네모에 나라·비행기·날짜만** 있는 것이 많고, 그쪽이
       이 판의 어법(직각·활자)과 싸우지 않는다.
     ★나라를 **라틴 대문자**로 적는다. 도장은 원래 그 나라 말과 영어로 찍히고,
       무엇보다 대문자에는 자간을 줄 수 있다 — 도장의 넓은 자간이 도장다움의 절반인데
       한글에 그걸 주면 낱자가 흩어진다(이 앱이 여러 번 밟은 함정).
     ★★날짜는 **들어간 날**이다(start_on). 도장은 입국심사대에서 찍히는 물건이라
       돌아온 날을 적으면 그건 도장이 아니라 요약이 된다 — 그래서 아래도 ARRIVED 다.
     ⚠ 뜨는 때는 그대로 '다녀온 여행' 이다. 여권에 남는 도장이 다 지나간 여행의
       것이라는 점에서 어긋나지 않는다.
     ★적히는 것은 다 사실이다: 나라 · 들어간 날. 나라를 안 적었으면 그 줄은
       아예 없다(지어내지 않는다). */
  function stamp() {
    const cc = U.codeList(trip.country || '');
    const land = cc.length ? U.countryNameEn(cc[0]) : '';
    const day = String(trip.start_on || trip.end_on || '')
      .replace(/-/g, '.').slice(2);                                      // 26.08.29
    return `<span>`
      + (land ? `<b>${esc(land)}</b>` : '')
      + `<i aria-hidden="true">✈</i>`
      + (day ? `<em>${esc(day)}</em>` : '')
      + `<u>ARRIVED</u>`
      + `</span>`;
  }


  /* ★이름 칸을 비워 두면 무엇이 들어갈지를 **흐린 글씨로 미리 보여 준다.**
     '안 적어도 됩니다' 라고 안내문을 다는 것보다, 들어갈 값 자체를 보여 주는 편이
     짧고 확실하다 — 도시를 고치면 이 미리보기도 따라 바뀐다. */
  function hintName() {
    const d = U.tripName('', $('set-cities').value);
    $('set-name').placeholder = d || '여행 이름';
  }

  async function copyLink() {
    const v = inviteUrl(trip);          // 칸에는 코드가 있지만 복사하는 것은 링크다
    try {
      await navigator.clipboard.writeText(v);
      $('crew-msg').textContent = '초대 링크를 복사했습니다.';
    } catch (e) {
      /* 클립보드는 권한·컨텍스트에 따라 막힌다. 그때는 고를 수 있게만 해 준다 —
         '복사 실패' 만 띄우면 사용자가 할 수 있는 일이 없다. */
      $('crew-msg').textContent = '복사가 막혔습니다 — 코드를 직접 불러 주세요: ' + (trip.invite_code || '');
    }
  }

  async function save(ev) {
    ev.preventDefault();
    $('set-save').disabled = true;
    $('set-err').textContent = '';
    try {
      const patch = {
        /* 안 적으면 도시를 잇는다 — U.tripName 의 주석에 왜인지 적어 두었다 */
        name: U.tripName($('set-name').value, $('set-cities').value),
        start_on: $('set-from').value || null,
        end_on: $('set-to').value || null,
        base_cur: $('set-cur').value,
        /* 두 글자 대문자만 — 표의 제약과 같은 규칙이다(supabase/place.sql) */
        country: SETPICK.get() || null,
        cities: $('set-cities').value.trim() || null,
      };
      if (!patch.name) throw new Error('여행 이름을 입력하세요.');
      if (patch.start_on && patch.end_on && patch.start_on > patch.end_on) {
        throw new Error('끝나는 날이 시작하는 날보다 앞설 수 없습니다.');
      }
      await DB.trips.update(trip.id, patch);
      Object.assign(trip, patch);
      $('crew-msg').textContent = '저장했습니다.';
      document.dispatchEvent(new CustomEvent('trip:changed'));
    } catch (e) {
      $('set-err').textContent = e.message;
    } finally {
      $('set-save').disabled = false;
    }
  }

  /* 그림은 U.ICON 이 갖는다 — 일정 줄의 그것들과 같은 자리에 모아 둔다 */
  $('set-cities').addEventListener('input', hintName);
  $('crew-copy').innerHTML = U.icon('copy');
  $('crew-copy').addEventListener('click', copyLink);
  $('crew-form').addEventListener('submit', save);

  $('crew-list').addEventListener('click', async e => {
    const b = e.target.closest('[data-kick]');
    if (!b) return;
    const m = list.find(x => x.user_id === b.dataset.kick);
    if (!confirm(`${m ? m.email : '이 사람'} 을 이 여행에서 내보낼까요?`)) return;
    try {
      await DB.removeMember(trip.id, b.dataset.kick);
      list = await of(trip.id, true);
      draw();
      $('crew-msg').textContent = '내보냈습니다.';
    } catch (err) { $('set-err').textContent = err.message; }
  });

  $('set-del').addEventListener('click', async () => {
    /* ★★경고문을 **단추 밑에서 걷어 확인 창으로 옮겼다**(2026-09-06). 늘 떠 있을
       때는 아무도 안 지우는 동안에도 '되돌릴 수 없습니다' 가 판 발치에 상주했는데,
       그 말이 필요한 순간은 누른 뒤 한 번뿐이다. 여기서는 안 읽고 지나갈 수 없다. */
    if (!confirm(`'${trip.name}' 여행을 지울까요?\n\n여행을 지우면 일정과 비용이 전부 함께 지워지고 되돌릴 수 없습니다.`)) return;
    try {
      await DB.trips.remove(trip.id);
      document.dispatchEvent(new CustomEvent('trip:deleted'));
    } catch (e) { $('set-err').textContent = e.message; }
  });

  return {
    of, nameOf,
    async open(t) {
      trip = t;
      $('crew-msg').textContent = '';
      $('set-err').textContent = '';
      try {
        list = await of(t.id);
        draw();
      } catch (e) {
        $('crew-list').innerHTML = `<li class="empty">${esc(e.message)}</li>`;
      }
    },
  };
})();
