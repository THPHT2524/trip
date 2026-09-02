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

  /* 비용 탭이 '누가 냈나' 를 사람 이름으로 적으려면 이 목록이 필요하다. */
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

    $('crew-list').innerHTML = list.map(m => `
      <li class="crewrow">
        <span class="who2">
          <span class="nm">${esc(String(m.email || '').split('@')[0])}</span>
          <span class="em">${esc(m.email)}</span>
        </span>
        <span class="tagrow">
          ${m.role === 'owner' ? '<span class="badge">만든 사람</span>' : ''}
          ${m.user_id === mine ? '<span class="badge">나</span>' : ''}
          ${owner && m.user_id !== mine
            ? `<button class="act danger" type="button" data-kick="${esc(m.user_id)}">내보내기</button>` : ''}
        </span>
      </li>`).join('');

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
    $('set-danger').hidden = !owner;
    $('set-note').textContent = owner ? '' : '여행을 만든 사람만 고칠 수 있습니다.';
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
    if (!confirm(`'${trip.name}' 여행을 지울까요?\n일정·비용·준비물이 전부 함께 지워지고 되돌릴 수 없습니다.`)) return;
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
