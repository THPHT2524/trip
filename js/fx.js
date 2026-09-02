/* fx.js — 날짜별 환율을 받아 두고 셈에 먹인다.
   ──────────────────────────────────────────────────────────────────────────
   ★★줄의 `fx` 칸은 **덮어쓰기**다. 비워 두면 그날 고시로 자동 계산한다 —
     사람이 줄마다 '환율 채우기' 를 눌러 채워 넣게 두지 않는다. 그러려고 api/fx 가 있다.
     (그래서 자동으로 얻은 값은 **줄에 저장하지 않는다.** 저장하면 그때부터 덮어쓰기가
      되어 버려서, 나중에 고시가 정정돼도 옛 값이 남는다.)

   ★어느 환율인가 — 지출은 전신환매도율(TTS, 카드가 그 언저리로 잡힌다),
     환전·출금은 현찰 살 때(cash, 창구에서 실제로 내는 값). api/fx 의 kind 와 같다.

   ★지난 날짜의 고시는 바뀌지 않으므로 한 번 받으면 localStorage 에 남긴다.
   ★못 받은 것도 적어 둔다 — 네이버가 죽었을 때 화면을 열 때마다 수십 번 두드리지
     않게 잠깐(10분) 쉬었다 다시 본다. */
const FXS = (function () {
  const KEY = 'trip.fx.v1';
  const RETRY = 10 * 60 * 1000;

  let map = {};
  try { map = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { map = {}; }

  const kindOf = r => (r.settle === 'exchange' ? 'cash' : 'tts');
  const keyOf = (d, c, k) => `${d}|${c}|${k}`;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {} };

  /* 이 줄에 쓸 자동 환율. 없으면 null — 지어내지 않는다. */
  function rateOf(r) {
    if (!r || !r.on_date || !r.cost_cur || r.cost_cur === U.SETTLE) return null;
    const v = map[keyOf(r.on_date, r.cost_cur, kindOf(r))];
    return (v && typeof v.rate === 'number') ? v.rate : null;
  }

  /* 그 줄에 쓴 고시가 어느 날 것인지 — 주말이면 직전 거래일 값이 온다. */
  function noteOf(r) {
    if (!r) return null;
    const v = map[keyOf(r.on_date, r.cost_cur, kindOf(r))];
    return (v && typeof v.rate === 'number') ? v : null;
  }

  /* 아직 없는 (날짜·통화·종류) 만 받아 온다. 하나라도 새로 받았으면 true. */
  async function ensure(rows) {
    const need = new Map();
    (rows || []).forEach(r => {
      if (r.cost == null || r.fx != null) return;      // 사람이 적어 둔 것이 이긴다
      if (!r.on_date || !r.cost_cur || r.cost_cur === U.SETTLE) return;
      const k = keyOf(r.on_date, r.cost_cur, kindOf(r));
      const hit = map[k];
      if (hit && (typeof hit.rate === 'number' || Date.now() - hit.at < RETRY)) return;
      need.set(k, { date: r.on_date, cur: r.cost_cur, kind: kindOf(r) });
    });
    if (!need.size) return false;

    let got = 0;
    /* 하나씩 부른다 — 프록시 뒤가 네이버라 한꺼번에 몰면 막힌다.
       여행 하나의 (날짜×통화) 가짓수는 많아야 열 몇이고, 한 번 받으면 다시 안 묻는다. */
    for (const [k, q] of need) {
      try {
        const b = await DB.fx(q.date, q.cur, U.SETTLE, q.kind);
        const rate = +b.rate;
        if (!isFinite(rate) || rate <= 0) throw new Error('rate');
        map[k] = { rate, on: b.on, exact: !!b.exact, at: Date.now() };
        got += 1;
      } catch (e) {
        map[k] = { rate: null, at: Date.now() };       // 실패도 적어 둔다(잠깐 쉬려고)
      }
    }
    save();
    return got > 0;
  }

  return { rateOf, noteOf, ensure };
})();
