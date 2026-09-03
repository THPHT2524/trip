/* more.js — 신한 더모아. **해외에서 얼마를 긁어야 999원에 맞나.**
   ─────────────────────────────────────────────────────────────────────────
   더모아는 5,000원 이상 결제의 **1,000원 미만 잔돈**을 포인트로 준다(해외는 2배).
   그래서 5,999원에 맞춰 긁는 것이 최적인데, 해외에서는 외화를 얼마 부르면 원화로
   얼마가 찍히는지 알 수가 없다. 그 역산을 하는 곳이다.

   ★★**화면 없이 도는 순수 계산**이다. money.js 와 같은 규칙 — DOM 을 안 만지므로
     tools/test-pure.js 가 브라우저 없이 검증한다. 환율을 어디서 받아 오는지는
     여기의 관심사가 아니다(js/db.js 의 more() 가 api/more.js 를 부른다).

   ── 돈이 흐르는 길 (엔 → 원) ────────────────────────────────────────────
     ① 엔 → 달러   비자가 **승인 시점 환율**로 바꾼다. 소수 둘째 자리 반올림.
     ② 달러에 1.1% 국제브랜드 수수료가 붙고, 센트 단위로 **버림**.
     ③ 달러 → 원   신한 **전신환매도율**을 곱하고 원 단위로 버림.
     ④ 여기에 신한 해외서비스수수료 0.18% 가 원 단위 버림으로 따로 더해진다.
   버림이 세 번 들어가서 근사로는 원 단위가 안 맞는다. 그래서 아래는 전부
   **정수 셈**이다 — 0.1 + 0.2 문제로 999 경계를 넘나들면 계산기가 쓸모없어진다.

   ★★환율 보정(%) 은 '미래 환율을 미리 얹는' 기능이다. 2024-04-29 부로 USD/KRW 는
     **승인 시점이 아니라 전표 매입 시점**(1~5영업일 뒤) 환율로 청구될 수 있다.
     보정 3% 을 주면 전신환매도율을 3% 높게 잡고 그 아래로 떨어지는 금액을 고른다 —
     환율이 그만큼 올라도 5,999원을 안 넘는다. 대신 안 오르면 그만큼 덜 적립된다.
     ★그래서 표의 청구금액은 **최악의 경우**다. 오늘 긁으면 그보다 적게 찍힌다.

   ★비자 환율은 KRW 에는 없다. 국내 결제는 적립이 1배라 셈도 다르다 —
     여기서는 **해외 결제만** 다룬다. */
const MORE = (function () {
  /* ★★수수료를 소수로 두면 안 된다. `1.011 * 1000` 은 float 에서 1010.9999… 라
     센트 한 자리가 통째로 밀리고, 서른 줄 중 두 줄이 조용히 틀렸다(2026-09-03).
     **분자·분모를 정수로 못 박고** 나눗셈은 마지막에 한 번만 한다. */
  const VISA_N = 1011, VISA_D = 1000;   // 비자 국제브랜드 수수료 1.1%
  const SH_N = 18, SH_D = 10000;        // 신한 해외서비스수수료 0.18%
  const MIN = 5000;          // 이 금액 이상이라야 적립된다
  const MULT = 2;            // 해외 결제는 잔돈의 2배

  /* 센트가 없는 통화. 여기 빠뜨리면 '4,299.37엔 긁으세요' 같은 소리를 하게 된다.
     ★★util.js 의 CENTS 와 **반드시 같아야 한다.** 저쪽이 화면에 찍는 자릿수라,
       어긋나면 'NT$132.45 긁으세요' 라고 셈해 놓고 화면에는 NT$132 로 찍힌다 —
       계산기가 제 답과 다른 금액을 보여주게 된다. tools/test-pure.js 가 지킨다. */
  const ZERO = { KRW: 1, JPY: 1, VND: 1, TWD: 1, IDR: 1 };
  const digits = cur => (ZERO[cur] ? 0 : 2);

  /* 외화 → 달러 센트. 비자는 소수 둘째 자리에서 **반올림**한다. */
  const cents = (foreign, visaRate) => Math.round(foreign * visaRate * 100);

  /* 달러 센트 → 원화 청구금액. ②③④ 를 한 번에 한다.
     ★환율도 정수(천분의 일 단위)로 바꿔 곱한다 — 보정을 먹인 환율은 1423.975… 처럼
       끝이 지저분해서, 그대로 곱하면 버림 자리가 흔들린다. 곱은 최대 1e11 언저리라
       배정도 정수 범위(2^53) 안에서 정확하다. */
  function billOf(c, ttk) {
    if (!(c > 0) || !(ttk > 0)) return null;
    const withFee = Math.floor(c * VISA_N / VISA_D);            // 1.1% 붙이고 센트 버림
    const charge = Math.floor(withFee * ttk / 100000);          // 센트 → 원, 버림
    const svc = Math.floor(SH_N * ttk * c / (SH_D * 1e5));      // 0.18%, 원 단위 버림
    return charge + svc;
  }

  /* 환율을 정수 천분위로. 여기 한 곳에서만 실수 → 정수로 넘어간다. */
  const ttkOf = tt => (tt > 0 ? Math.round(tt * 1000) : 0);

  /* 이 외화 금액을 긁으면 어떻게 되나. 셋 중 하나라도 없으면 null — 지어내지 않는다. */
  function bill(foreign, visaRate, tt, midRate) {
    if (!(foreign > 0) || !(visaRate > 0) || !(tt > 0)) return null;
    const c = cents(foreign, visaRate);
    const krw = billOf(c, ttkOf(tt));
    if (krw == null) return null;
    const point = krw >= MIN ? (krw % 1000) * MULT : 0;
    const real = krw - point;
    /* 이득률의 기준은 **매매기준율**이다 — '해외 수수료가 아예 없는 카드로 긁었다면'
       과 견준다. 그래서 마이너스가 나올 수 있다(잔돈이 적으면 수수료가 더 크다).
       ★여기 쓰는 달러는 센트로 반올림하기 **전** 값이다. */
    const par = midRate > 0 ? midRate * foreign * visaRate : null;
    return {
      usd: c / 100, krw, point, real,
      gain: par ? (par - real) / par * 100 : null,
    };
  }

  /* 목표 청구금액(5,999원 따위) 이하로 **가장 크게** 긁을 수 있는 외화 금액.
     ★청구금액은 외화가 커지면 절대 줄지 않는다(버림뿐이라 계단 모양이다).
       그래서 이분 탐색이 성립한다 — themore 처럼 한 칸씩 훑지 않아도 된다. */
  function solve(target, visaRate, tt, cur, pad) {
    if (!(target > 0) || !(visaRate > 0) || !(tt > 0)) return null;
    const rate = tt * (1 + (+pad || 0) / 100);
    const ttk = ttkOf(rate);
    const d = digits(cur);
    const unit = Math.pow(10, -d);
    const krwOf = m => billOf(cents(m * unit, visaRate), ttk);

    /* 대충 어디쯤인지 짚고 그 위로 여유를 둔다. 수수료를 다 빼도 이보다는 작다. */
    let hi = Math.ceil(target / rate / visaRate / unit) + 2;
    if (!isFinite(hi) || hi <= 0) return null;
    if (krwOf(hi) <= target) return null;              // 짚은 자리가 너무 낮으면 포기
    let lo = 0;
    while (lo + 1 < hi) {                              // krwOf(lo) <= target < krwOf(hi)
      const mid = Math.floor((lo + hi) / 2);
      if (krwOf(mid) <= target) lo = mid; else hi = mid;
    }
    if (lo <= 0) return null;
    /* ★`lo * unit` 을 그대로 내보내면 안 된다 — 928 × 0.01 은 9.279999999999999 다.
       화면에는 9.28 로 찍히지만 값은 다르고, 그 값으로 다시 셈하면 어긋난다. */
    return { foreign: +(lo * unit).toFixed(d), digits: d, rate };
  }

  /* 표에 세울 목표들. 5,999원부터 만 원 단위로 서른 줄 — themore 와 같은 범위다.
     ★한 끼 밥값부터 호텔 하루치까지가 이 안에 들어온다. */
  const targets = () => Array.from({ length: 30 }, (_, i) => (i + 5) * 1000 + 999);

  /* api/more 에 물어볼 날짜. 신한 1회차는 **하루에 한 번**뿐이라 날짜가 곧 키다.
     ★한국시간으로 잘라야 한다. 폰이 현지 시각(방콕·하와이)에 맞춰져 있어도
       기준은 서울의 아침 고시다. */
  function kstDay(t) {
    const k = new Date((t == null ? Date.now() : +t) + 9 * 3600e3);
    const p = n => String(n).padStart(2, '0');
    return `${k.getUTCFullYear()}-${p(k.getUTCMonth() + 1)}-${p(k.getUTCDate())}`;
  }

  /* ★★비자 환율을 신한 **대미환산율**로 갈음할 때 얹는 여유(%).
     둘은 같은 아침 값인데도 어긋난다 — 2026-09-03 실측으로 엔 -0.343% ·
     바트 -0.354% · 파운드 -0.351%, 홍콩달러와 위안은 0.03% 안쪽이었다.
     ★방향이 나쁘다. 신한 쪽이 **낮게** 나오므로 그대로 쓰면 청구액을 실제보다 적게
       보고, 999 를 넘겨 버린다(6,020원에 찍히면 980포인트가 날아간다).
       그래서 환율을 그만큼 **높게** 잡아 항상 아래로 떨어지게 한다.
     ★대가는 작다: 5,999 대신 5,960쯤에 맞으니 2,000 중 60포인트쯤 손해다(3%).
     ★하루치 관측뿐이라 넉넉히 잡았다. 비자 환율을 직접 넣으면 이 여유는 쓰지 않는다. */
  const SAFETY = 0.5;
  const hedge = v => (v > 0 ? v * (1 + SAFETY / 100) : v);

  /* 지금(한국시간)을 datetime-local 이 먹는 모양으로. 화면의 '거래 일시' 기본값이다. */
  function kstNow(t) {
    const k = new Date((t == null ? Date.now() : +t) + 9 * 3600e3);
    const p = n => String(n).padStart(2, '0');
    return `${kstDay(t)}T${p(k.getUTCHours())}:${p(k.getUTCMinutes())}`;
  }

  /* ★★그 시각에 **적용되는 고시**가 며칟날 것인가.
     신한 1회차는 아침 8시 20분쯤 나온다. 그러니 한국시간 9시 전에 긁은 건은 그날 고시가
     아직 없어서 **전날** 것이 적용된다 — themore 도 같은 선을 긋는다.
     ★하와이·미국에서는 한국시간 새벽에도 가게가 열려 있어서 실제로 걸리는 경우다. */
  function fxDay(text) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(String(text || ''));
    if (!m) return null;
    if (+m[4] >= 9) return `${m[1]}-${m[2]}-${m[3]}`;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]) - 864e5).toISOString().slice(0, 10);
  }

  return { bill, solve, targets, digits, kstDay, kstNow, fxDay, hedge, SAFETY, MIN };
})();

if (typeof module !== 'undefined') module.exports = MORE;   // tools/test-pure.js 용
