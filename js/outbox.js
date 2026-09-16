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
  /* ★★사본이 **쌓이기만 했다**(2026-09-17에 고쳤다). 여는 여행마다 한 벌씩 남고 지우는
     코드가 없어서 서른여덟 여행이면 1MB 가까이 된다. 한도(보통 5MB)에 닿으면 setItem 이
     던지는데 그것을 catch 가 조용히 삼키므로 **그때부터 사본이 갱신을 멈춘다** —
     끊긴 곳에서 믿고 있는 것이 그 사본인데, 낡았다는 말도 없이 낡는다.
   ★최근 KEEP 개만 남긴다. 지난 여행의 사본을 들고 있을 이유가 없다 — 오프라인으로
     여는 것은 지금 가 있는 여행이다.
   ★언제 쓴 것인지를 같이 적는다(at). 그게 있어야 무엇이 오래된 것인지 알 수 있다.
     옛 형식(배열 그대로)도 읽는다 — 이미 깔린 브라우저에 그 꼴로 남아 있다. */
  const KEEP = 12;

  function cacheKeys() {
    const out = [];
    try {
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i);
        if (k && k.startsWith('trip_cache_items_')) out.push(k);
      }
    } catch (e) {}
    return out;
  }

  /* 오래된 것부터 버린다. 남길 수를 받는다 — 한도에 걸렸을 때는 더 세게 부른다.
     ★★**방금 적은 것(mine)은 세지도 버리지도 않는다.** at 이 밀리초라 한 틱에 여러 벌을
       쓰면 값이 전부 같아지고, 그러면 '오래된 순' 이 사실은 아무 순서도 아니게 되어
       **방금 적은 그것이 버려질 수 있다**(테스트가 잡았다). 지킬 것을 수로 고르지 말고
       이름으로 뺀다 — 셈이 흔들려도 이 한 줄은 안 흔들린다. */
  function prune(keep, mine) {
    const aged = cacheKeys().filter(k => k !== mine).map(k => {
      let at = 0;
      try { const v = JSON.parse(localStorage.getItem(k) || 'null'); at = (v && v.at) || 0; } catch (e) {}
      return { k, at };
    }).sort((x, y) => y.at - x.at);
    /* mine 이 이미 한 자리를 차지하고 있으면 남길 자리가 그만큼 줄어든다 */
    aged.slice(Math.max(0, keep - (mine && localStorage.getItem(mine) != null ? 1 : 0)))
        .forEach(x => { try { localStorage.removeItem(x.k); } catch (e) {} });
  }

  function cacheSet(tripId, rows) {
    const body = JSON.stringify({ at: Date.now(), rows });
    try { localStorage.setItem(CKEY(tripId), body); }
    catch (e) {
      /* 한도다 — 오래된 것을 거의 다 버리고 한 번만 다시 해 본다. */
      prune(1, CKEY(tripId));
      try { localStorage.setItem(CKEY(tripId), body); } catch (e2) { return false; }
    }
    /* ★셀 때만 훑는다. 여기는 저장할 때마다 지나가는 자리라, 열세 벌을 매번 펴 보면
       그것대로 낭비다 — 열쇠 수는 파싱 없이 셀 수 있다. */
    if (cacheKeys().length > KEEP) prune(KEEP, CKEY(tripId));
    return true;
  }
  function cacheGet(tripId) {
    try {
      const v = JSON.parse(localStorage.getItem(CKEY(tripId)) || 'null');
      if (Array.isArray(v)) return v;                       // 옛 형식
      return (v && Array.isArray(v.rows)) ? v.rows : null;
    } catch (e) { return null; }
  }
  /* 여행을 지우면 사본도 지운다 — 다시 볼 일이 없는데 자리를 잡고 있다. */
  function cacheDrop(tripId) {
    try { localStorage.removeItem(CKEY(tripId)); } catch (e) {}
  }

  /* ── 홈의 사본 ────────────────────────────────────────────────────────
     ★★여행 목록에는 사본이 **없었다**(2026-09-17에 넣었다). 일정은 위 사본이 받쳐
       주는데 정작 그 일정으로 가는 길인 목록이 없어서, 끊긴 곳에서 앱을 열면 목록을
       못 받고 거기서 끝났다 — README 가 '일정 보기 · 된다' 라고 적어 둔 그 칸이
       실은 **주소창에 /t/<id> 가 남아 있을 때만** 됐다.
   ★둘을 한 덩이로 둔다(목록 + 모양). 홈은 둘이 다 있어야 그려지고, 받는 것도
     app.js 가 한 번에 받는다. */
  const HKEY = 'trip_cache_home';
  function homeSet(trips, shape) {
    try {
      const old = homeGet() || {};
      localStorage.setItem(HKEY, JSON.stringify({
        at: Date.now(),
        trips: trips || old.trips || [],
        /* ★모양만 못 받는 일이 있다(db.js 의 shape 는 실패를 null 로 준다) — 그때
           갖고 있던 것을 지우지 않는다. 화면이 하는 판단과 같은 판단이다. */
        shape: shape || old.shape || [],
      }));
    } catch (e) { /* 한도·시크릿 모드 */ }
  }
  function homeGet() {
    try {
      const v = JSON.parse(localStorage.getItem(HKEY) || 'null');
      return (v && Array.isArray(v.trips)) ? v : null;
    } catch (e) { return null; }
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
       ⚠ 규칙은 db.js 의 order 와 **같아야 한다**: 날짜 → 차례(seq) → 시각.
         2026-09-17에 시각과 seq 의 앞뒤가 바뀌었다 — 한쪽만 고치면 끊긴 동안 넣은 줄이
         연결되는 순간 자리를 옮긴다(같은 목록이 두 규칙으로 두 번 서는 셈이다). */
    const hm = r => (r.at_time ? String(r.at_time).slice(0, 5) : '99:99');
    return out.sort((a, b) =>
      (a.on_date < b.on_date ? -1 : a.on_date > b.on_date ? 1 :
       (+a.seq || 0) - (+b.seq || 0) ||
       (hm(a) < hm(b) ? -1 : hm(a) > hm(b) ? 1 : 0)));
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
        else if (op.kind === 'update') await DB.items.patch(op.id, op.row);
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

  /* ★★**무엇이 안 갔는지** 말할 수 있게 한 줄 요약을 준다(2026-09-10). 띠가 '못 보낸
     변경 2건' 만 적고 있었는데, 그 띠가 뜨는 순간이 하필 '방금 적은 그게 갔나' 가
     제일 궁금한 순간이다 — 개수는 그 물음에 답하지 않는다.
   ★맨 **뒤엣것**을 든다. 방금 한 일이 큐의 끝이고, 사람이 확인하고 싶은 것도 그것이다.
   ★지우기는 이름이 없다(id 만 큐에 넣는다) — 그때는 '지운 것' 이라고만 한다.
     없는 이름을 지어내지 않는다. */
  function summary() {
    const last = q[q.length - 1];
    if (!last) return { n: 0, what: '' };
    /* ★이름을 op 에서 먼저 찾는다. row 가 이제 **바뀐 칸만** 들고 있어서, 금액만
       고친 줄에는 이름이 없다 — 그래도 띠는 그 줄을 이름으로 불러야 한다(부르는 쪽이
       op.name 으로 함께 넘긴다). */
    const nm = String(last.name || (last.row && last.row.name) || '').trim();
    const what = last.kind === 'delete' ? '지운 것' : (nm || '이름 없는 줄');
    return { n: q.length, what };
  }

  return {
    isOffline, cacheSet, cacheGet, cacheDrop, homeSet, homeGet,
    queue, apply, flush, tmpId, summary,
    count: () => q.length,
    onChange: fn => subs.push(fn),
  };
})();

/* tools/test-pure.js 용. 이 파일은 DOM 을 안 만지므로 화면 없이 확인할 수 있고,
   **데이터를 잃을 수 있는 유일한 모듈**이라 확인해 두는 값이 크다. */
if (typeof module !== 'undefined') module.exports = Outbox;
