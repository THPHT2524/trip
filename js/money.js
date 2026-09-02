/* money.js — 이 줄이 원화로 얼마인가. **화면 없이 도는 순수 계산**이다.
   ─────────────────────────────────────────────────────────────────────────
   왜 따로 뺐나: 같은 셈을 세 화면이 쓴다(홈 카드 합계 · 일정의 Day 합계 · 비용 탭).
   각자 세면 언젠가 갈린다 — 실제로 갈렸었다. 여기 한 벌만 둔다.
   DOM 을 안 만지므로 tools/test-pure.js 가 브라우저 없이 검증한다.

   ★★정산 통화는 **원화 하나**다. 여행의 base_cur 는 '합계를 낼 통화' 가 아니라
     그 나라 돈(현지통화)이고, 새 줄의 통화 기본값으로만 쓴다.

   ── 돈이 원화에서 현지통화로 건너오는 길은 둘이다 ──────────────────────
     ① 카드      긁은 날의 **전신환매도율**로 청구된다 (fx 를 그 값으로 채워 둔다)
     ② 환전·출금 그 순간 원화가 빠지고 현지통화 현금이 생긴다.
                 트래블로그로 현지 ATM 에서 뽑는 것도 여기다.
                 **환전은 지출이 아니다** — 돈을 쓴 게 아니라 바꿨을 뿐이라 합계에서 뺀다.
                 그 현금으로 산 것이 그때 비로소 지출이 된다.

   ── 현금의 환율은 '보유 현금의 평균' 이다 ──────────────────────────────
     여러 번 나눠 뽑으면 환율이 저마다 다르다. 마지막 환율을 쓰면 먼저 뽑은 돈까지
     그 환율로 계산돼 틀어진다. 그래서 **가중평균**을 굴린다(재고의 평균단가와 같다):
       환전   잔액 += 받은 금액,  원가 += 낸 원화
       현금결제 환율 = 원가 / 잔액,  잔액 -= 쓴 금액,  원가 -= 그만큼
     지갑이 모자라면(안 적은 환전이 있다는 뜻) 그 줄은 **모른다고 남긴다** —
     없는 환율을 지어내지 않는다. */
const MONEY = (function () {
  const SETTLE = 'KRW';

  const n = v => (v == null || v === '' || !Number.isFinite(+v)) ? null : +v;

  /* 줄들을 **주어진 순서대로** 훑는다. DB 가 날짜 → 시각 → 순번으로 정렬해 준다 —
     현금 지갑은 시간 순서가 곧 뜻이라 여기서 다시 정렬하지 않는다(두 규칙이 생긴다). */
  function walk(rows) {
    let bal = 0;        // 지갑에 남은 현지통화
    let paid = 0;       // 그 잔액을 만드는 데 든 원화
    let cur = null;     // 지갑의 통화
    const per = new Map();

    (rows || []).forEach(r => {
      const amt = n(r.cost);
      if (amt == null) return;                       // 값을 안 적은 줄은 셈에 없다
      const fx = n(r.fx);

      /* 환전·출금 — 지갑에 들어온다. 지출로는 세지 않는다. */
      if (r.settle === 'exchange') {
        if (fx == null) { per.set(r.id, { krw: null, spend: false, why: 'no-fx' }); return; }
        bal += amt; paid += amt * fx; cur = r.cost_cur || cur;
        per.set(r.id, { krw: amt * fx, spend: false, why: 'exchange' });
        return;
      }

      /* 원화로 낸 줄은 환율이 필요 없다. */
      if (r.cost_cur === SETTLE) { per.set(r.id, { krw: amt, spend: true, why: 'krw' }); return; }

      /* ★★현금 — **주머니에서 나간다.** 환율을 적었든 안 적었든 돈은 줄어든다.
         전에는 위의 'fx 가 이긴다' 에 먼저 걸려서, 환율이 채워진 현금 줄이 지갑을
         건드리지 않고 지나갔다 — ¥4,000 환전하고 ¥970 을 현금으로 썼는데 남은 돈이
         ¥4,000 그대로였다(2026-09-02). 환율은 '이 지출을 얼마로 칠까' 를 정하는 것이지
         '돈이 나갔나' 를 정하는 것이 아니다.
         ★빠지는 **원가**는 늘 지갑의 평균 환율로 뗀다 — 그래야 남은 돈의 평균이 안 흔들린다.
           사람이 환율을 적었으면 그 값으로 '치되', 지갑은 제 원가대로 준다. */
      if (r.settle === 'cash' && bal > 0 && (cur == null || r.cost_cur === cur) && amt <= bal + 1e-9) {
        const rate = paid / bal;
        const basis = amt * rate;
        bal -= amt; paid -= basis;
        per.set(r.id, fx != null
          ? { krw: amt * fx, spend: true, why: 'fx', rate }
          : { krw: basis, spend: true, why: 'wallet', rate });
        return;
      }

      /* 사람이 적어 둔 환율이 언제나 이긴다(지갑이 못 대는 현금·카드·계좌이체 전부). */
      if (fx != null) { per.set(r.id, { krw: amt * fx, spend: true, why: 'fx' }); return; }

      per.set(r.id, { krw: null, spend: true, why: 'no-fx' });
    });

    return {
      per,
      /* 지금 지갑에 남은 현금과 그 원가. rate 는 남은 돈의 평균 환율이다. */
      cash: { bal, paid, cur, rate: bal > 0 ? paid / bal : null },
    };
  }

  /* 합계 한 벌. spend 인 줄만 더하고, 환율을 못 낸 줄은 세어서 따로 알린다. */
  function total(rows) {
    const w = walk(rows);
    let sum = 0, miss = 0, cnt = 0;
    (rows || []).forEach(r => {
      const p = w.per.get(r.id);
      if (!p || !p.spend) return;
      cnt += 1;
      if (p.krw == null) miss += 1; else sum += p.krw;
    });
    return { sum, miss, cnt, per: w.per, cash: w.cash };
  }

  /* 이 줄의 돈을 **누구에게** 붙일 것인가.
     ★각자 냄(split)이면 '몇 명이 각자 냈나' 가 곧 갯수(qty)다 — 기차를 각자 카드로
       찍으면 단가 하나에 인원만큼 결제가 일어난 것이다.
     ★인원이 동행자 수와 같으면 동행자에게 단가만큼 하나씩 붙인다.
       다르면(셋 중 둘만 탔다면) **누구였는지 알 수 없다** — 한 칸으로 남긴다.
       모르는 것을 아는 척하며 없는 사람에게 배분하지 않는다. */
  function shares(r, krw, crewIds) {
    if (!r || !r.split) return [{ id: (r && r.payer_id) || null, krw }];
    const head = Math.max(1, +r.qty || 1);      // ★위의 헬퍼 n 을 가리지 않게 이름을 따로 쓴다
    const ids = crewIds || [];
    if (head > 1 && ids.length === head) {
      return ids.map(id => ({ id, krw: krw == null ? null : krw / head }));
    }
    return [{ id: null, group: head, krw }];
  }

  return { SETTLE, walk, total, shares };
})();

if (typeof module !== 'undefined') module.exports = MONEY;   // tools/test-pure.js 용
