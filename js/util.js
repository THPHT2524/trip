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

  /* 장소구분 여섯과 그 색 이름 — **노선도의 범례**다.
     ★네 파일(app·plan·map·cost)에 같은 표가 그대로 복사돼 있었다(2026-09-03).
       구분을 하나 더하거나 색 이름을 바꾸면 네 곳을 고쳐야 하고, 세 곳만 고치면
       한 화면에서만 색이 어긋난다 — esc 를 여기로 모은 것과 똑같은 이유로 모은다.
     ★색값 자체는 css 에 있다(--k-stay 등). 여기 있는 것은 **이름표**뿐이다. */
  const KINDS = ['숙소', '식사', '관광', '이동', '쇼핑', '기타'];
  const KVAR = { 숙소: 'k-stay', 식사: 'k-eat', 관광: 'k-see', 이동: 'k-move', 쇼핑: 'k-buy', 기타: 'k-etc' };
  const kvar = kind => KVAR[kind] || 'k-etc';

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
  /* bare=true 면 **연도를 뺀다.** 목록이 해마다 나뉘어 있으면 머리띠가 이미 연도를
     말하므로, 카드마다 '26.' 을 되풀이하는 것은 같은 말을 스물네 번 하는 것이다. */
  /* 시작 쪽 표기. bare 면 연도를 뺀다 — span 과 range 가 같은 규칙을 써야 한다
     (전에는 같은 한 줄이 두 함수에 따로 있었다). */
  const head = (t, bare) => (bare ? md(t) : t.slice(2).replace(/-/g, '.'));
  function span(a, b, bare) {
    if (!a && !b) return '날짜 미정';
    if (a && b) {
      const days = Math.round((Date.parse(b) - Date.parse(a)) / 86400000) + 1;
      return `${head(a, bare)} – ${md(b)} · ${days}일`;
    }
    return head(a || b, bare);
  }
  /* 기간만. '· N일' 은 붙이지 않는다 — 카드에서 날짜와 일수가 다른 자리에 선다. */
  function range(a, b, bare) {
    if (!a && !b) return '날짜 미정';
    return (a && b) ? `${head(a, bare)} – ${md(b)}` : head(a || b, bare);
  }
  /* 여행이 며칠짜리인가. 날짜가 반쪽이면 셀 수 없다. */
  function tripDays(t) {
    if (!t || !t.start_on || !t.end_on) return 0;
    return Math.round((Date.parse(t.end_on) - Date.parse(t.start_on)) / 86400000) + 1;
  }

  /* ── 나라 ────────────────────────────────────────────────────────────────
     ★사람이 여행마다 **직접 고른다.** 전에는 현지통화에서 유추했는데 유로는 나라가
       열이 넘고 달러는 미국 밖에서도 쓴다 — 어림으로 국기를 붙일 일이 아니다.
     ★★윈도우는 국기 이모지를 안 그리고 'JP' 두 글자로 떨어뜨린다. 그래서 화면에서는
       **크게 바탕에 깔아** 모노그램으로 읽히게 한다(css 의 .bgflag·.pflags 참고).

   ★★★서른셋만 세워 두고 '250개를 다 세우면 고르는 일이 일이 된다' 고 적어 두었는데,
     **그건 굴리는 고르개였을 때 이야기였다**(2026-09-07). 적는 칸으로 바꾼 순간
     목록이 길어도 드는 값이 없어졌다 — '스리' 두 자면 스리랑카가 나온다. 그런데
     목록에 없어서 **뱃지가 아예 안 떴다.**
   ★그렇다고 이백몇십 줄을 손으로 적지 않는다. 브라우저가 이미 갖고 있다:
     Intl.DisplayNames 가 ISO 코드를 한국어 이름으로 옮겨 준다. AA~ZZ 를 물어
     제 이름이 돌아오는 것만 남기면 그게 곧 목록이다(279개 나온다).
   ★국기도 안 적는다. 코드 두 글자를 지역표시기호로 옮기면 그대로 국기다 —
     손으로 적어 둔 서른셋과 **전부 일치**하는 것을 확인하고 뺐다(오타가 날 자리를
     없앤다).
   ⚠ 아래 서른셋은 남긴다. 두 가지 일을 한다: **자주 가는 순서로 목록 앞에 서고**
     (나머지는 가나다순), ICU 이름이 길거나 낯선 넷을 덮는다 — 대한민국→한국,
     오스트레일리아→호주, '홍콩(중국 특별행정구)'→홍콩, 마카오도 같다.
   ⚠ ICU 가 없는 기계에서는 이 서른셋만 남는다. 있던 것이 없어지지는 않는다. */
  /* 코드 두 글자 → 국기. 지역표시기호(U+1F1E6~) 두 자를 잇는 것이 국기 이모지다.
     ⚠ 이것은 **목록을 세울 때 쓰는 날것**이다. 두 글자면 무엇이든 그려 내므로
       'ZZ' 도 🇿🇿 가 된다 — 밖으로 내보내는 flag() 는 아는 코드만 그린다.
       (모르는 국기를 지어내지 않는다. 테스트 둘이 그것을 지킨다.) */
  const flagOf = code => (/^[A-Z]{2}$/.test(code)
    ? String.fromCodePoint(...[...code].map(c => 0x1F1E6 + c.charCodeAt(0) - 65)) : '');
  /* 나라가 아닌 것 — ICU 는 이런 것도 지역으로 센다. 여행할 수 있는 곳만 남긴다.
     ★ZZ 는 '알려지지 않은 지역' 이다. 이름이 코드와 다르니 목록에 끼어들었고,
       그러자 flag('ZZ') 가 🇿🇿 를 만들어 냈다 — 테스트 둘이 그것을 잡았다.
     ★CS·YU·ZR·AN 은 없어진 나라의 옛 코드다. ICU 는 지금 이름으로 옮겨 주는데
       (CS·YU→세르비아, ZR→콩고, AN→퀴라소) 그러면 같은 이름이 목록에 둘씩 선다. */
  const NOT_A_PLACE = new Set([
    'EU', 'UN', 'EZ', 'QO', 'XA', 'XB', 'ZZ',
    /* ISO 3166-3 — 없어진 나라의 옛 코드. ICU 가 지금 이름으로 옮겨 주는 바람에
       '베트남'·'독일'·'러시아' 같은 이름이 목록에 둘씩 섰다(열두 짝을 세어 확인).
       UK 는 ISO 가 아니라 예약 코드다 — 영국은 GB 다. */
    'AN', 'BU', 'CS', 'CT', 'DD', 'DY', 'FQ', 'FX', 'HV', 'JT', 'MI', 'NH',
    'NQ', 'NT', 'PC', 'PU', 'PZ', 'RH', 'SU', 'TP', 'UK', 'VD', 'WK', 'YD',
    'YU', 'ZR',
  ]);
  const ALIAS = {};          // ICU 이름 → 코드. 위 NEAR 가 덮어쓴 넷을 위해 둔다
  const NEAR = [
    ['KR', '한국', '🇰🇷'], ['JP', '일본', '🇯🇵'], ['TW', '대만', '🇹🇼'],
    ['HK', '홍콩', '🇭🇰'], ['MO', '마카오', '🇲🇴'], ['CN', '중국', '🇨🇳'],
    ['TH', '태국', '🇹🇭'], ['VN', '베트남', '🇻🇳'], ['SG', '싱가포르', '🇸🇬'],
    ['MY', '말레이시아', '🇲🇾'], ['ID', '인도네시아', '🇮🇩'], ['PH', '필리핀', '🇵🇭'],
    ['US', '미국', '🇺🇸'], ['GU', '괌', '🇬🇺'], ['CA', '캐나다', '🇨🇦'], ['AU', '호주', '🇦🇺'],
    ['NZ', '뉴질랜드', '🇳🇿'], ['GB', '영국', '🇬🇧'], ['FR', '프랑스', '🇫🇷'],
    ['DE', '독일', '🇩🇪'], ['IT', '이탈리아', '🇮🇹'], ['ES', '스페인', '🇪🇸'],
    ['CH', '스위스', '🇨🇭'], ['NL', '네덜란드', '🇳🇱'], ['CZ', '체코', '🇨🇿'],
    ['AT', '오스트리아', '🇦🇹'], ['PT', '포르투갈', '🇵🇹'], ['TR', '튀르키예', '🇹🇷'],
    ['AE', '아랍에미리트', '🇦🇪'], ['MV', '몰디브', '🇲🇻'], ['QA', '카타르', '🇶🇦'],
    ['IN', '인도', '🇮🇳'], ['MN', '몽골', '🇲🇳'],
  ];
  const COUNTRY = (() => {
    const near = NEAR.map(([c, n]) => [c, n, flagOf(c)]);
    let dn = null;
    try { dn = new Intl.DisplayNames(['ko'], { type: 'region' }); } catch (e) { return near; }
    const have = new Set(NEAR.map(([c]) => c));
    const rest = [];
    const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    for (const a of A) for (const b of A) {
      const c = a + b;
      if (have.has(c) || NOT_A_PLACE.has(c)) continue;
      let n = '';
      try { n = dn.of(c); } catch (e) { continue; }
      if (!n || n === c) continue;          // ICU 가 모르는 코드는 코드를 그대로 돌려준다
      rest.push([c, n, flagOf(c)]);
    }
    rest.sort((x, y) => x[1].localeCompare(y[1], 'ko'));
    /* ★덮어쓴 넷의 **ICU 이름도 받아 준다**(2026-09-07). 목록에는 '한국' 이 서지만
       칸에 '대한민국' 을 친 사람이 아무 일도 안 일어나는 것을 보면 안 된다 —
       사전에 있는 말이면 다 알아들어야 한다. 오스트레일리아·홍콩·마카오도 같다. */
    NEAR.forEach(([c, n]) => { const i = dn.of(c); if (i && i !== c && i !== n) ALIAS[i] = c; });
    return near.concat(rest);
  })();
  const CNAME = Object.fromEntries(COUNTRY.map(([c, n]) => [c, n]));
  const countryName = code => CNAME[code] || '';
  /* 라틴 이름 — 여권 도장에 쓴다. 도장은 원래 그 나라 말과 영어로 찍히고,
     대문자에 자간을 줄 수 있다(한글은 자간을 주면 낱자가 흩어진다). */
  const countryNameEn = (() => {
    let dn = null;
    try { dn = new Intl.DisplayNames(['en'], { type: 'region' }); } catch (e) { /* 없으면 코드 */ }
    return code => {
      if (!CNAME[code]) return '';
      let n = code;
      try { n = dn ? dn.of(code) : code; } catch (e) { n = code; }
      return (n || code).toUpperCase();
    };
  })();
  /* 아는 나라만 국기를 준다 — 모르는 코드는 빈 문자열이다(지어내지 않는다) */
  const flag = code => (CNAME[code] ? flagOf(code) : '');
  /* 여행 하나가 두 나라를 걸치는 일이 있다(방콕+프놈펜, 싱가포르+말레이시아).
     그래서 나라는 **쉼표로 이은 목록**이다 — 'TH,KH'. 표의 제약과 같은 모양(place.sql).
     ★★모르는 코드를 **버리지 않는다.** 전에는 FLAG 에 없으면 걸러 냈는데, 그 목록이
       고르개의 값을 되읽는 데도 쓰여서 — 아직 새 util.js 를 안 받은 브라우저로 여행
       설정을 열었다 저장하면 그 나라가 **말없이 지워졌다.** 실제로 'MV,AE' 가 'AE' 가
       됐다(2026-09-02). 모양만 본다(표의 제약과 같은 규칙). 국기는 flags() 가 가린다. */
  const codeList = t => String(t || '').split(',').map(x => x.trim().toUpperCase())
                          .filter(c => /^[A-Z]{2}$/.test(c))
                          .filter((c, i, a) => a.indexOf(c) === i);
  /* 그릴 수 있는 국기만. 모르는 나라는 국기가 없을 뿐 값은 남아 있다. */
  const flags = t => codeList(t).map(c => flag(c)).filter(Boolean);

  /* 통화를 고르면 나라도 대개 정해진다 — 새 여행 폼에서 **미리 골라 준다**(바꿀 수 있다).
     통화 하나가 여러 나라인 것(EUR·USD)은 비워 둔다. 지어내지 않는다. */
  const CUR_COUNTRY = {
    KRW: 'KR', JPY: 'JP', TWD: 'TW', THB: 'TH', VND: 'VN',
    CNY: 'CN', HKD: 'HK', SGD: 'SG', MOP: 'MO', IDR: 'ID', MYR: 'MY', PHP: 'PH',
    AED: 'AE', MVR: 'MV', GBP: 'GB', AUD: 'AU', CAD: 'CA',
  };
  const guessCountry = cur => CUR_COUNTRY[cur] || '';

  /* 사람이 쉼표로 적은 도시를 낱개로. 앞뒤 공백과 빈 칸을 걷는다. */
  const cityList = (t) => String(t || '').split(/[,·]/).map(x => x.trim()).filter(Boolean);

  /* ── 나라 고르개 ─────────────────────────────────────────────────────────
     고르면 아래에 조각으로 쌓이고, 조각을 누르면 빠진다. 여러 나라를 담기 위해서다.
     ★<select multiple> 을 쓰지 않는다 — 폰에서 여러 개를 고르는 일이 고역이다.
       한 번에 하나씩 고르고 고른 것이 눈에 남는 편이 손이 적다.
     ★두 폼(새 여행·여행 설정)이 같은 목록·같은 몸짓을 써야 하므로 한 곳에서 만든다. */
  /* ★★고르개(select)에서 **적는 칸**으로 바꿨다(2026-09-06). 나라는 서른셋인데,
     서른세 줄을 폰에서 굴려 찾는 것보다 '일' 두 자를 치는 편이 늘 빠르다.
   ★★그리고 **바로 아래 도시 칸이 이미 이 방식**이다(list=citylist). 붙어 있는 두
     칸이 하나는 굴리고 하나는 적는 것이면 손이 두 가지를 기억해야 한다.
   ★목록은 사라지지 않는다 — datalist 라 칸을 누르면 서른셋이 다 뜬다. 굴러서
     찾던 사람은 그대로 굴러서 찾고, 아는 사람은 두 자만 친다.
   ★코드로도 받는다(jp → 일본). 서식의 나라 칸은 원래 코드를 적는 자리다.
   ⚠ 붙는 것은 change 에서만 한다. input(글자마다)으로 하면 '인도' 를 다 친 순간
     인도가 붙어 버려서 '인도네시아' 를 칠 수가 없다 — 서른셋 중 겹치는 짝이 그
     하나다(2026-09-06에 세어 확인). */
  const CLIST = 'countrylist';
  function countryPicker(inp, chips) {
    if (!inp || !chips) return { get: () => '', set: () => {}, disable: () => {} };
    let picked = [];
    /* 목록은 문서에 한 벌만 — 두 폼(새 여행·설정)이 나눠 쓴다 */
    if (!document.getElementById(CLIST)) {
      const dl = document.createElement('datalist');
      dl.id = CLIST;
      dl.innerHTML = COUNTRY.map(([, n]) => `<option value="${esc(n)}"></option>`).join('');
      document.body.appendChild(dl);
    }
    inp.setAttribute('list', CLIST);
    const byName = new Map(COUNTRY.map(([c, n]) => [n, c]));
    const draw = () => {
      chips.innerHTML = picked.map(c =>
        `<button type="button" class="pick" data-drop="${c}">` +
        (flag(c) ? `<span class="pf">${flag(c)}</span>` : '') +
        `${esc(CNAME[c] || c)}<span class="px">✕</span></button>`).join('');
      chips.hidden = !picked.length;
    };
    inp.addEventListener('change', () => {
      const v = inp.value.trim();
      if (!v) return;
      const c = byName.get(v) || ALIAS[v] || (CNAME[v.toUpperCase()] ? v.toUpperCase() : '');
      if (!c) return;                       // 아직 다 안 적었거나 없는 이름 — 적은 것을 지우지 않는다
      inp.value = '';
      if (!picked.includes(c)) { picked.push(c); draw(); }
    });
    chips.addEventListener('click', e => {
      const b = e.target.closest('[data-drop]');
      if (!b) return;
      picked = picked.filter(c => c !== b.dataset.drop);
      draw();
    });
    return {
      get: () => picked.join(','),
      set: (csv) => { picked = codeList(csv); draw(); },
      disable: (off) => { inp.disabled = off; chips.querySelectorAll('button').forEach(b => { b.disabled = off; }); },
    };
  }

  /* 통화 기호. 없는 통화는 코드를 그대로 앞에 붙인다(추측하지 않는다). */
  const SIGN = {
    KRW: '₩', JPY: '¥', USD: '$', EUR: '€', TWD: 'NT$', THB: '฿', VND: '₫',
    CNY: '¥', HKD: 'HK$', SGD: 'S$', MOP: 'MOP$', IDR: 'Rp', MYR: 'RM', PHP: '₱',
    AED: 'AED ', MVR: 'MVR ', GBP: '£', AUD: 'A$', CAD: 'C$',
  };
  /* ★센트가 있는 돈은 **센트까지** 적는다. 전부 반올림했더니 $116.37 이 $116 으로 보였고,
     영수증과 대조할 수가 없었다(2026-09-02). 원·엔·동은 소수점을 쓰지 않는 돈이라 0 이다.
     여기 없는 통화는 2 로 본다 — 세계의 통화 대부분이 센트를 갖는다. */
  const CENTS = { KRW: 0, JPY: 0, VND: 0, TWD: 0, IDR: 0 };
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

  /* ── 그림 단추의 그림 ────────────────────────────────────────────────
     ★★이모지였다(📝 📍 ✖️ ↩️ 🧭 🗓️). 두 가지가 걸렸다(2026-09-06).
       하나, 이 앱은 **채도 높은 색을 장소구분 여섯에만** 쓰기로 해 놓았는데
       이모지가 노랑·빨강·갈색을 규칙 밖에서 들여왔다. 둘, 색 그림(📝·📍)은
       color 를 무시하고 글리프로 떨어지는 것(✖️·↩️)은 받아서, 한 줄에 무게가
       셋이었다 — 밝은 판에서 특히 어긋났다.
     ★선 그림 하나로 통일한다. currentColor 를 타므로 --icon 한 토큰이 여섯을
       다 잡고, 두 판에서 같은 무게로 앉는다.
     ★16 칸에 1.6 선. 24px 판 안에 15px 로 앉으면 선이 1.5px 로 떨어져
       이 앱의 실선(1px)보다 딱 한 뼘 굵다 — 글이 아니라 **누르는 것**으로 읽힌다. */
  const ICON = {
    memo: '<path d="M3.5 5h9M3.5 8h9M3.5 11h5"/>',
    pin:  '<path d="M8 14c3.2-3.7 4.8-6.4 4.8-8A4.8 4.8 0 0 0 3.2 6c0 1.6 1.6 4.3 4.8 8Z"/>'
        + '<circle cx="8" cy="6.1" r="1.6"/>',
    x:    '<path d="M4.6 4.6 11.4 11.4M11.4 4.6 4.6 11.4"/>',
    undo: '<path d="M5.6 2.6 2.4 5.8l3.2 3.2"/>'
        + '<path d="M2.4 5.8h6.4a3.9 3.9 0 0 1 0 7.8H5.6"/>',
    nav:  '<path d="M13.7 2.3 2.5 6.9l5 1.6 1.6 5z"/>',
    cal:  '<rect x="2.8" y="4.3" width="10.4" height="9.2" rx="1.6"/>'
        + '<path d="M2.8 7.3h10.4M5.6 2.7v2.4M10.4 2.7v2.4"/>',
    /* ── 아래 탭 넷 ────────────────────────────────────────────────────
       ★★라틴 이름표(ITINERARY·MAP·RECEIPT·TRIP)를 걷고 그림으로 바꿨다(2026-09-06).
         글자로 두면 이름을 **지어내야** 하는데, 지도는 티켓 꼴이면서 화면은 지도이고
         설정은 신고서라 어느 낱말도 딱 맞지 않았다 — 넷 다 어정쩡한 이름이 됐다.
       ★그림은 **그 화면이 무슨 종이인지**를 그린다. 이름을 안 지어도 되고,
         마침 이 앱의 네 컨셉이 다 모양이 뚜렷한 물건이라 그릴 것이 있다.
       ⚠ 넷이 20px 에서 서로 구별돼야 한다. 상자 둘(영수증·신고서)은 **비율로** 가른다 —
         영수증은 세로로 길고 밑이 뜯겨 있고, 신고서는 가로로 눕고 반듯하다. */
    'tab-plan': '<path d="M8 1.8v.9M8 6.9v2.2M8 13.3v.9"/>'      // 레일 — 정거장 사이만 잇는다
              + '<circle cx="8" cy="4.7" r="2"/><circle cx="8" cy="11.3" r="2"/>',
    'tab-map':  '<path d="M2.2 4.4 6 2.9l4 1.6 3.8-1.5v8.6l-3.8 1.5-4-1.6-3.8 1.5z"/>'
              + '<path d="M6 2.9v8.6M10 4.5v8.6"/>',               // 접힌 지도 — 세 폭
    'tab-cost': '<path d="M3.6 2.4h8.8v11.6l-2.2-1.3-2.2 1.3-2.2-1.3-2.2 1.3z"/>'
              + '<path d="M6.1 5.8h3.8M6.1 8.4h3.8"/>',            // 영수증 — 밑이 뜯긴 종이
    'tab-info': '<rect x="1.9" y="3.4" width="12.2" height="9.2" rx="1.5"/>'
              + '<path d="M4.5 6.7h3M4.5 9.6h6"/>',                // 신고서 — 칸 둘이 적힌 서식
    /* 신고서 판의 둘. 종이 두 장이 겹친 것은 '베낀다', 문에서 나가는 화살표는 '내보낸다' */
    copy: '<rect x="5.6" y="5.6" width="8" height="8" rx="1.6"/>'
        + '<path d="M10.6 5.6V4.2A1.6 1.6 0 0 0 9 2.6H4.2A1.6 1.6 0 0 0 2.6 4.2V9a1.6 1.6 0 0 0 1.6 1.6h1.4"/>',
    out:  '<path d="M9.4 2.6H4.2A1.6 1.6 0 0 0 2.6 4.2v7.6a1.6 1.6 0 0 0 1.6 1.6h5.2"/>'
        + '<path d="M10.9 5.4 13.5 8l-2.6 2.6M13.5 8H6.4"/>'
  };
  function icon(name) {
    return `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" stroke-width="1.6"
      stroke-linecap="round" stroke-linejoin="round">${ICON[name] || ''}</svg>`;
  }

  /* ── 사람의 색 ────────────────────────────────────────────────────────
     ★★일정 탭의 결제자 동그라미가 쓰던 것을 여기로 옮겼다(2026-09-06) —
       설정 탭의 동행자 줄도 같은 색을 써야 **같은 사람이 어느 화면에서나
       같은 색**이 된다. 두 곳에 같은 배열을 적어 두면 언젠가 갈린다.
     ★색상만 사람마다 다르고 채도·밝기는 판마다 한 벌뿐이다(--pc-s/--pc-l) —
       어느 색을 뽑아도 이 화면의 톤을 벗어나지 않는다.
     ★순번으로 돌린다: 여덟 명까지 무조건 다 다르다. 해시로 떨어뜨리면
       셋만 되어도 세 번에 한 번 겹쳤다(생일 문제).
     ⚠ 목록에 없는 사람(초대에서 빠진 옛 결제)만 해시로 간다 — 색이 없느니
       겹칠 위험을 안고라도 주는 편이 낫다. */
  /* ── 도장 잉크 ────────────────────────────────────────────────────────
     ★★여권 도장은 나라마다·공항마다 잉크가 다르다 — 파랑이 제일 흔하고 초록·보라·
       붉은 것도 흔하다. 한 색으로만 찍으면 여권이 아니라 서식 인쇄로 보인다.
     ★**여행마다 고정**이다. 그릴 때마다 굴리면 새로고침할 때 색이 바뀌는데, 그건
       랜덤이 아니라 고장으로 읽힌다. 여행 아이디에서 뽑으므로 같은 여행은 늘 같은 색이다.
     ★색상만 다르고 채도·밝기는 사람 동그라미와 **같은 토큰**(--pc-s/--pc-l)을 쓴다 —
       판마다 한 벌뿐이라 어느 색을 뽑아도 이 앱의 톤을 안 벗어난다. */
  const IHUE = [214, 154, 282, 352, 190, 28];
  function ink(seed) {
    const t = String(seed || '');
    let n = 0;
    for (let i = 0; i < t.length; i += 1) n = (n * 31 + t.charCodeAt(i)) >>> 0;
    return IHUE[n % IHUE.length];
  }

  const PHUE = [210, 14, 152, 253, 42, 328, 188, 96];
  function hue(crew, userId) {
    const id = String(userId || '');
    let n = (crew || []).findIndex(m => m.user_id === userId);
    if (n < 0) { n = 0; for (let i = 0; i < id.length; i += 1) n = (n * 31 + id.charCodeAt(i)) >>> 0; }
    return PHUE[n % PHUE.length];
  }

  /* ── 여행 이름 ────────────────────────────────────────────────────────
     ★★안 적으면 **도시를 잇는다**(2026-09-06). 서른여덟 여행 중 **서른넷**이
       손으로 적은 이름과 도시 나열이 글자 하나까지 같았다(세어 확인) — 같은 것을
       두 칸에 두 번 적고 있었던 셈이다.
     ★그래도 칸은 없애지 않는다. 다른 넷이 '하와이(호놀룰루)' · '미국 서부(로스앤젤레스·
       라스베이거스·샌프란시스코)' 처럼 **부르는 이름이 따로 있는** 경우다 —
       비워 둘 수 있게만 하고, 적으면 적은 것이 이긴다. */
  const tripName = (name, cities) => String(name || '').trim() || cityList(cities).join('·');

  /* ── 공항 이름 ─────────────────────────────────────────────────────────
     ★★**번역을 앱 안에 둔다**(2026-09-07). 항공편 조회(api/flight.js)가 주는 공항
       이름은 영어다 — 피드는 번역을 안 한다. 그런데 이 앱의 공항 줄은 서른한 개가
       전부 한글이고, 여권 지도가 점을 찍는 규칙도 **이름이 '공항' 으로 끝나는 것**이라
       영어가 들어오면 그 줄이 조용히 지도에서 빠진다.
     ★표기는 **쓰던 그대로** 심는다. '간사이 국제공항' 은 띄고 '나리타국제공항' 은
       붙어 있는데, 그건 흔들린 것이 아니라 그때그때 그렇게 적으신 것이다 —
       여기서 가지런히 고치면 지난 서른한 줄과 새 줄이 서로 다른 이름이 된다.
     ★없는 공항은 **영어 그대로 둔다.** 지어내지 않는다 — 화면에서 한 번 고치면
       되고, 지금도 그렇게 적고 계신다. 자주 가게 되면 여기 한 줄 넣으면 된다. */
  const AIRPORT = {
    /* 한국 */
    ICN: '인천국제공항', GMP: '김포국제공항', CJU: '제주국제공항',
    PUS: '김해국제공항', TAE: '대구국제공항', CJJ: '청주국제공항', KPO: '포항경주공항',
    /* 일본 */
    NRT: '나리타국제공항', HND: '하네다공항', KIX: '간사이 국제공항', ITM: '오사카 이타미공항',
    CTS: '신치토세공항', FUK: '후쿠오카공항', OKA: '나하공항', NGO: '주부 센트레아국제공항',
    /* 중화권 */
    PEK: '베이징 서우두국제공항', PKX: '베이징 다싱국제공항', PVG: '상하이 푸둥국제공항',
    SHA: '상하이 훙차오국제공항', HRB: '하얼빈 타이핑 국제공항', CAN: '광저우 바이윈국제공항',
    HKG: '홍콩국제공항', MFM: '마카오국제공항', TPE: '타오위안국제공항', TSA: '타이베이 쑹산공항',
    /* 동남아 */
    BKK: '수완나품공항', DMK: '돈므앙국제공항', CNX: '치앙마이국제공항', HKT: '푸껫국제공항',
    SIN: '싱가포르 창이공항', KUL: '쿠알라룸푸르국제공항', CGK: '수카르노하타국제공항',
    DPS: '응우라라이국제공항', MNL: '니노이아키노국제공항', CEB: '막탄 세부국제공항',
    SGN: '떤선녓국제공항', HAN: '노이바이국제공항', DAD: '다낭국제공항',
    /* 태평양 */
    GUM: '괌국제공항', SPN: '사이판국제공항', HNL: '호놀룰루국제공항',
    /* 중동·인도양 */
    DXB: '두바이국제공항', AUH: '아부다비국제공항', DOH: '도하 하마드국제공항',
    MLE: '벨라나국제공항', IST: '이스탄불공항',
    /* 유럽 */
    LHR: '히스로공항', CDG: '샤를드골공항', FRA: '프랑크푸르트공항', AMS: '스히폴공항',
    BCN: '바르셀로나 엘프라트공항', MAD: '마드리드 바라하스공항', LIS: '리스본공항',
    OPO: '포르투공항', FCO: '피우미치노공항', MXP: '말펜사공항', ZRH: '취리히공항',
    VIE: '빈국제공항', PRG: '프라하공항',
    /* 미주·오세아니아 */
    LAX: '로스앤젤레스국제공항', SFO: '샌프란시스코국제공항', LAS: '해리 리드 국제공항',
    SEA: '시애틀 터코마국제공항', JFK: '존에프케네디국제공항', EWR: '뉴어크국제공항',
    ORD: '오헤어국제공항', YVR: '밴쿠버국제공항', SYD: '시드니국제공항', AKL: '오클랜드공항',
  };
  /* 나라 → 현지통화. **새 여행 폼의 고르개에 있는 열여섯 개만** 담는다 —
     여기 없는 나라(카타르 QAR 처럼 경유만 하는 곳)는 고르개를 안 건드린다.
     지어내서 넣으면 사람이 안 보고 지나가고, 그러면 모든 금액이 틀린다. */
  const CUR_OF = {
    KR: 'KRW', JP: 'JPY', US: 'USD', GU: 'USD', MP: 'USD',
    CN: 'CNY', TW: 'TWD', HK: 'HKD', MO: 'MOP',
    TH: 'THB', VN: 'VND', SG: 'SGD', MY: 'MYR', ID: 'IDR', PH: 'PHP',
    AE: 'AED', MV: 'MVR',
    ES: 'EUR', PT: 'EUR', FR: 'EUR', DE: 'EUR', IT: 'EUR', NL: 'EUR',
    AT: 'EUR', BE: 'EUR', IE: 'EUR', FI: 'EUR', GR: 'EUR',
  };
  const curOf = cc => CUR_OF[String(cc || '').toUpperCase()] || '';

  /* 코드로 한글 이름을 찾는다. 없으면 피드가 준 영어를 그대로 돌려준다. */
  const airportName = (iata, fallback) => AIRPORT[String(iata || '').toUpperCase()] || fallback || '';

  return { esc, todayISO, addDays, dowOf, md, span, range, money, KINDS, kvar,
           COUNTRY, flag, flags, codeList, countryName, guessCountry, tripDays,
           cityList, countryPicker, SETTLE, icon, hue, tripName, countryNameEn, ink,
           AIRPORT, airportName, curOf };
})();

if (typeof module !== 'undefined') module.exports = U;   // tools/test-pure.js 용
