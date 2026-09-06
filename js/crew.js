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
            ? `<button class="act danger" type="button" data-kick="${esc(m.user_id)}">내보내기</button>` : ''}
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
    if (over) {
      const n = U.tripDays(trip);
      $('set-stamp').innerHTML = `<span><b>다녀옴</b>`
        + `<em>${esc(U.md(trip.end_on))}${n ? ` · ${n} DAYS` : ''}</em></span>`;
    }
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
        name: $('set-name').value.trim(),
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
