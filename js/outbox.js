/* outbox.js — 끊긴 곳에서도 적을 수 있게 한다.
   ─────────────────────────────────────────────────────────────────────────
   현지에서 데이터가 끊기는 것을 전제로 만든 앱이다. 선은 이렇게 긋는다:
     · **읽기** — 마지막으로 받은 것을 로컬에 두고, 못 받으면 그것을 보여준다.
     · **쓰기** — 못 보내면 버리지 않고 쌓아 두었다가 연결되면 순서대로 보낸다.
     · 쌓여 있는 동안에도 **화면에는 반영해서 보여준다**(안 그러면 적었는데 사라진 것처럼 보인다).

   ★충돌 규칙: '나중에 도착한 쓰기가 이긴다'. 지운 것은 되살리지 않는다.
     동행자와 같은 표를 보므로 둘이 같은 줄을 고칠 수 있다 — v1 은 여기까지만 정한다.
   ★큐는 이 브라우저에만 있다. 다른 기기에서 올려 주지 않는다(그럴 수 있으려면 서버가 있어야 한다).
   ★같은 줄을 여러 번 고쳐도 큐는 늘어난다. 보낼 때 순서대로 흘리므로 결과는 마지막 값이다. */
const Outbox = (function () {

  const QKEY = 'trip_outbox_v1';
  const CKEY = t => `trip_cache_items_${t}`;
  let q = read();
  const subs = [];

  function read() {
    try { const v = JSON.parse(localStorage.getItem(QKEY) || '[]'); return Array.isArray(v) ? v : []; }
    catch (e) { return []; }
  }
  function write() {
    try { localStorage.setItem(QKEY, JSON.stringify(q)); } catch (e) { /* 용량·시크릿 모드 */ }
    subs.forEach(f => { try { f(q.length); } catch (e) {} });
  }

  /* 네트워크 때문에 실패했는가. 서버가 400/403 으로 거절한 것은 **다시 보내도 소용없다** —
     그런 것까지 큐에 쌓으면 영원히 재시도하며 오류만 반복한다. */
  function isOffline(err) {
    if (!navigator.onLine) return true;
    const m = String((err && err.message) || err || '');
    return /Failed to fetch|NetworkError|network|Load failed|타임아웃|시간 초과/i.test(m);
  }

  // ── 로컬 사본 ─────────────────────────────────────────────────────────
  function cacheSet(tripId, rows) {
    try { localStorage.setItem(CKEY(tripId), JSON.stringify(rows)); } catch (e) {}
  }
  function cacheGet(tripId) {
    try { const v = JSON.parse(localStorage.getItem(CKEY(tripId)) || 'null'); return Array.isArray(v) ? v : null; }
    catch (e) { return null; }
  }

  // ── 큐 ────────────────────────────────────────────────────────────────
  /* 임시 id. 아직 서버에 없는 줄도 화면에서는 눌러 고칠 수 있어야 한다. */
  const tmpId = () => 'tmp-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  /* ★아직 못 보낸 줄을 또 고치는 경우를 여기서 접는다.
     tmp- 로 시작하는 id 는 서버에 없는 것이라, 그 앞으로 update/delete 를 보내면
     '없는 행을 고쳐라' 가 되어 flush 가 조용히 실패한다.
     대신 **쌓여 있던 create 를 고치거나 통째로 없앤다** — 결과는 같고 왕복이 하나 준다. */
  function queue(op) {
    if (op.id && String(op.id).startsWith('tmp-')) {
      const at = q.findIndex(x => x.kind === 'create' && x.tempId === op.id);
      if (at >= 0) {
        if (op.kind === 'delete') q.splice(at, 1);
        else q[at] = { ...q[at], row: { ...q[at].row, ...op.row } };
        write();
        return op;
      }
    }
    q.push(op); write(); return op;
  }

  /* 쌓인 것을 서버에서 받은 목록 위에 얹는다 — 보낸 것처럼 보이게 하되 표시를 남긴다. */
  function apply(tripId, rows) {
    let out = rows.slice();
    q.filter(op => op.tripId === tripId).forEach(op => {
      if (op.kind === 'create') {
        out.push({ ...op.row, id: op.tempId, trip_id: tripId, _pending: true });
      } else if (op.kind === 'update') {
        out = out.map(r => (r.id === op.id ? { ...r, ...op.row, _pending: true } : r));
      } else if (op.kind === 'delete') {
        out = out.filter(r => r.id !== op.id);
      }
    });
    /* 서버가 하던 정렬을 여기서 되풀이한다 — 새로 얹은 줄이 제자리에 들어가야 한다.
       규칙은 db.js 의 order 와 같다: 날짜 → 시각(없으면 뒤) → 순번. */
    return out.sort((a, b) =>
      (a.on_date < b.on_date ? -1 : a.on_date > b.on_date ? 1 :
       (a.at_time || '99:99') < (b.at_time || '99:99') ? -1 :
       (a.at_time || '99:99') > (b.at_time || '99:99') ? 1 :
       (a.seq || 0) - (b.seq || 0)));
  }

  /* 쌓인 것을 순서대로 보낸다. 하나라도 네트워크로 실패하면 **거기서 멈춘다** —
     뒤엣것을 먼저 보내면 순서가 뒤집혀 '고친 뒤 만든' 꼴이 된다.
     서버가 거절한 것(권한·검증)은 다시 보내도 같으므로 큐에서 빼고 알린다. */
  /* ★한 번에 하나만 돈다. 방어가 없으면 둘이 겹쳐 **같은 줄을 두 번 만든다** —
     둘 다 q[0] 을 보고 둘 다 보낸 뒤에야 shift 하기 때문이다.
     2026-09-01 에 실제로 겪었다: online 이벤트를 outbox.js 와 app.js 가 각각 듣고 있었다. */
  let flushing = null;
  async function flush() {
    if (flushing) return flushing;
    flushing = run().finally(() => { flushing = null; });
    return flushing;
  }
  async function run() {
    if (!q.length || !navigator.onLine) return { sent: 0, failed: 0, dropped: [] };
    let sent = 0; const dropped = [];
    while (q.length) {
      const op = q[0];
      try {
        if (op.kind === 'create') await DB.items.create(op.tripId, op.row);
        else if (op.kind === 'update') await DB.items.update(op.id, op.row);
        else if (op.kind === 'delete') await DB.items.remove(op.id);
        q.shift(); sent += 1; write();
      } catch (e) {
        if (isOffline(e)) { write(); return { sent, failed: q.length, dropped }; }
        q.shift(); write();                 // 서버가 거절한 것 — 다시 보내도 같다
        dropped.push({ op, why: e.message });
      }
    }
    return { sent, failed: 0, dropped };
  }

  addEventListener('online', () => { subs.forEach(f => { try { f(q.length, true); } catch (e) {} }); });

  return {
    isOffline, cacheSet, cacheGet, queue, apply, flush, tmpId,
    count: () => q.length,
    onChange: fn => subs.push(fn),
  };
})();
