/* util.js — 화면 여러 곳이 같이 쓰는 것들. 여기에는 DOM 도 네트워크도 없다.
   ★esc 를 파일마다 복사하지 않으려고 만들었다. 이스케이프가 두 벌이 되면 한쪽만 고쳐지고,
     그 한쪽으로 들어온 이름 하나가 화면을 깨뜨린다. 규칙은 한 곳에만 있어야 한다. */
const U = (function () {

  /* 화면에 넣는 모든 문자열은 여기를 지난다.
     ★홑따옴표까지 바꾼다. 홑따옴표로 감싼 속성이 하나라도 있으면 이름에 ' 가 든 것만으로
       속성이 조기 종료되어 카드가 깨지고 속성 주입이 열린다.
       실제로 오는 이름이다 — 구글맵에서 McDonald's 가 그대로 온다. */
  const esc = s => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  const DOW = ['일', '월', '화', '수', '목', '금', '토'];

  /* 오늘(현지 시각 기준 YYYY-MM-DD).
     ★UTC 로 자르면 한국에서 오전 9시 전에 어제가 된다. 시간대 보정을 먼저 한다. */
  function todayISO() {
    const d = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
    return d.toISOString().slice(0, 10);
  }

  /* 'YYYY-MM-DD' 하루 더하기. Date 로 왕복하지 않는다 — 서머타임 있는 곳에서 하루가 밀린다. */
  function addDays(iso, n) {
    const d = new Date(iso + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  const dowOf = iso => DOW[new Date(iso + 'T00:00:00Z').getUTCDay()];
  const md = iso => iso ? iso.slice(5).replace('-', '.') : '';

  /* 여행 기간 한 줄. 날짜가 없는 여행도 있다(아직 안 정한 것이지 잘못된 것이 아니다). */
  function span(a, b) {
    if (!a && !b) return '날짜 미정';
    if (a && b) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
      return `${a.slice(2).replace(/-/g, '.')} – ${md(b)} · ${days}일`;
    }
    return (a || b).slice(2).replace(/-/g, '.');
  }

  /* ── 나라 ────────────────────────────────────────────────────────────────
     ★사람이 여행마다 **직접 고른다.** 전에는 현지통화에서 유추했는데 유로는 나라가
       열이 넘고 달러는 미국 밖에서도 쓴다 — 어림으로 국기를 붙일 일이 아니다.
     ★한국 사람이 갈 만한 곳으로 추렸다. 없는 나라가 생기면 여기 한 줄 늘리면 된다
       (250개를 다 세우면 고르는 일이 일이 된다 — 쓰는 사람이 한 명인 앱이다).
     ★★윈도우는 국기 이모지를 안 그리고 'JP' 두 글자로 떨어뜨린다. 그래서 화면에서는
       **크게 바탕에 깔아** 모노그램으로 읽히게 한다(css 의 .bgflag·.pflags 참고). */
  const COUNTRY = [
    ['KR', '한국', '🇰🇷'], ['JP', '일본', '🇯🇵'], ['TW', '대만', '🇹🇼'],
    ['HK', '홍콩', '🇭🇰'], ['MO', '마카오', '🇲🇴'], ['CN', '중국', '🇨🇳'],
    ['TH', '태국', '🇹🇭'], ['VN', '베트남', '🇻🇳'], ['SG', '싱가포르', '🇸🇬'],
    ['MY', '말레이시아', '🇲🇾'], ['ID', '인도네시아', '🇮🇩'], ['PH', '필리핀', '🇵🇭'],
    ['US', '미국', '🇺🇸'], ['CA', '캐나다', '🇨🇦'], ['AU', '호주', '🇦🇺'],
    ['NZ', '뉴질랜드', '🇳🇿'], ['GB', '영국', '🇬🇧'], ['FR', '프랑스', '🇫🇷'],
    ['DE', '독일', '🇩🇪'], ['IT', '이탈리아', '🇮🇹'], ['ES', '스페인', '🇪🇸'],
    ['CH', '스위스', '🇨🇭'], ['NL', '네덜란드', '🇳🇱'], ['CZ', '체코', '🇨🇿'],
    ['AT', '오스트리아', '🇦🇹'], ['PT', '포르투갈', '🇵🇹'], ['TR', '튀르키예', '🇹🇷'],
    ['AE', '아랍에미리트', '🇦🇪'], ['IN', '인도', '🇮🇳'], ['MN', '몽골', '🇲🇳'],
  ];
  const FLAG = Object.fromEntries(COUNTRY.map(([c, , f]) => [c, f]));
  const CNAME = Object.fromEntries(COUNTRY.map(([c, n]) => [c, n]));
  const flag = code => FLAG[code] || '';
  const countryName = code => CNAME[code] || '';

  /* 통화를 고르면 나라도 대개 정해진다 — 새 여행 폼에서 **미리 골라 준다**(바꿀 수 있다).
     통화 하나가 여러 나라인 것(EUR·USD)은 비워 둔다. 지어내지 않는다. */
  const CUR_COUNTRY = { KRW: 'KR', JPY: 'JP', TWD: 'TW', THB: 'TH', VND: 'VN' };
  const guessCountry = cur => CUR_COUNTRY[cur] || '';

  /* 사람이 쉼표로 적은 도시를 낱개로. 앞뒤 공백과 빈 칸을 걷는다. */
  const cityList = (t) => String(t || '').split(/[,·]/).map(x => x.trim()).filter(Boolean);

  /* 나라 고르는 칸을 채운다. 두 폼(새 여행·여행 설정)이 같은 목록을 써야 하므로
     한 곳에서 만든다. '안 적음' 을 맨 위에 둔다 — 나라를 모를 수도 있다. */
  function fillCountry(sel) {
    if (!sel) return;
    sel.innerHTML = '<option value="">안 적음</option>'
      + COUNTRY.map(([c, n, f]) => `<option value="${c}">${f} ${n}</option>`).join('');
  }

  /* 통화 기호. 없는 통화는 코드를 그대로 앞에 붙인다(추측하지 않는다). */
  const SIGN = { KRW: '₩', JPY: '¥', USD: '$', EUR: '€', TWD: 'NT$', THB: '฿', VND: '₫', CNY: '¥' };
  /* ★센트가 있는 돈은 **센트까지** 적는다. 전부 반올림했더니 $116.37 이 $116 으로 보였고,
     영수증과 대조할 수가 없었다(2026-09-02). 원·엔·동은 소수점을 쓰지 않는 돈이라 0 이다.
     여기 없는 통화는 2 로 본다 — 세계의 통화 대부분이 센트를 갖는다. */
  const CENTS = { KRW: 0, JPY: 0, VND: 0, TWD: 0 };
  function money(v, cur) {
    if (v == null || !Number.isFinite(+v)) return '';
    const d = CENTS[cur] != null ? CENTS[cur] : 2;
    const s = SIGN[cur];
    /* 센트가 0 이면 굳이 '.00' 을 달지 않는다 — $12 와 $12.50 이 한 줄에 서도 읽힌다 */
    const n = (+v).toLocaleString('ko-KR', { minimumFractionDigits: 0, maximumFractionDigits: d });
    return s ? s + n : `${n} ${cur || ''}`.trim();
  }

  /* ★★정산 통화는 **원화 하나**다. 여행의 base_cur 는 '합계를 낼 통화' 가 아니라
     **그 나라 돈**(현지통화)이고, 새 줄을 넣을 때 통화 칸의 기본값으로만 쓴다.
     돈은 결국 원화로 갚고 나누므로 합계·정산은 전부 여기로 모은다.
     (2026-09-02에 뜻을 그렇게 정했다 — 그전에는 base_cur 가 합계 통화였다) */
  const SETTLE = 'KRW';

  return { esc, DOW, todayISO, addDays, dowOf, md, span, money,
           COUNTRY, flag, countryName, guessCountry, cityList, fillCountry, SETTLE };
})();

if (typeof module !== 'undefined') module.exports = U;   // tools/test-pure.js 용
