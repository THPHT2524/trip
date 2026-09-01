/* prep.js — 준비물 체크리스트.
   날짜에 매달 수 없는 것들의 집이다 — 비자·유심·콘센트 규격·상비약.
   ★자유 메모가 아니라 표인 이유: 준비물은 본래 '적는 것' 이 아니라 **'지우는 것'** 이다.
     메모 한 덩어리에서는 무엇이 끝났는지가 안 보인다. */
const Prep = (function () {
  const $ = id => document.getElementById(id);
  const esc = U.esc;

  let trip = null, rows = [];

  function draw() {
    const left = rows.filter(r => !r.done).length;
    $('prep-count').textContent = rows.length
      ? (left ? `${left}개 남음 · 전체 ${rows.length}` : `${rows.length}개 전부 챙김`)
      : '';
    $('prep-list').innerHTML = rows.length
      ? rows.map(r => `
        <li class="prow${r.done ? ' is-done' : ''}">
          <button class="pchk" type="button" data-done="${esc(r.id)}"
                  aria-pressed="${String(!!r.done)}" aria-label="${r.done ? '되돌리기' : '챙김 표시'}">
            ${r.done ? '✓' : ''}
          </button>
          <span class="ptext">${esc(r.text)}</span>
          <button class="act" type="button" data-del="${esc(r.id)}">지우기</button>
        </li>`).join('')
      : '<li class="empty"><strong>아직 준비물이 없습니다</strong>비자·유심·콘센트처럼 날짜에 매달 수 없는 것들을 적어 두세요.</li>';
  }

  async function reload() {
    rows = await DB.checklist.list(trip.id);
    draw();
  }

  $('prep-form').addEventListener('submit', async ev => {
    ev.preventDefault();
    const el = $('prep-text');
    const v = el.value.trim();
    if (!v) return;
    $('prep-add').disabled = true;
    $('prep-err').textContent = '';
    try {
      const seq = rows.reduce((m, r) => Math.max(m, r.seq || 0), 0) + 1;
      await DB.checklist.add(trip.id, v, seq);
      el.value = '';
      await reload();
      el.focus();                      // 여러 개를 연달아 적는 화면이다
    } catch (e) {
      $('prep-err').textContent = e.message;
    } finally {
      $('prep-add').disabled = false;
    }
  });

  $('prep-list').addEventListener('click', async e => {
    const chk = e.target.closest('[data-done]');
    if (chk) {
      const r = rows.find(x => x.id === chk.dataset.done);
      try { await DB.checklist.setDone(r.id, !r.done); await reload(); }
      catch (err) { $('prep-err').textContent = err.message; }
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      try { await DB.checklist.remove(del.dataset.del); await reload(); }
      catch (err) { $('prep-err').textContent = err.message; }
    }
  });

  return {
    async open(t) {
      const same = trip && trip.id === t.id;
      trip = t;
      if (!same) { rows = []; draw(); }
      $('prep-err').textContent = '';
      try { await reload(); }
      catch (e) { $('prep-err').textContent = e.message; }
    },
  };
})();
