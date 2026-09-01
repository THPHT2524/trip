/* db.js — Supabase 인증 + trip 스키마 CRUD.

   모드 둘 (DB.mode())
     'cloud' — 설정 있음 + 로그인됨. 이때만 화면이 열린다.
     'anon'  — 미로그인, 또는 설정이 없거나 file:// 라 OAuth 가 불가능한 자리.
   ★card-dashboard 처럼 '로컬 전용 모드' 를 두지 않는다. 이 앱은 로그인 없이 할 수 있는 일이 없다 —
     일정도 링크 프록시도 세션을 요구한다. 모드를 셋으로 나누면 아무것도 못 하는 모드가 하나 더 생길 뿐이다.

   ★★스키마를 반드시 지정한다. 이 프로젝트의 public 에는 card-dashboard 의 records 가 산다.
     db.schema 를 안 주면 거기를 뒤지다 우리 표를 못 찾는다(404). */
const DB = (function () {

  const CONFIGURED =
       typeof SUPABASE_URL === 'string' && /^https:\/\/.+\.supabase\.co\/?$/.test(SUPABASE_URL)
    && typeof SUPABASE_ANON_KEY === 'string' && SUPABASE_ANON_KEY.length > 20
    && location.protocol !== 'file:';       // file:// 은 OAuth 리다이렉트가 불가능하다

  let sb = null, user = null;
  const authCbs = [], errCbs = [];

  if (CONFIGURED && typeof supabase !== 'undefined') {
    sb = supabase.createClient(SUPABASE_URL.replace(/\/$/, ''), SUPABASE_ANON_KEY, {
      db: { schema: 'trip' },
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    });
  }

  const mode = () => (sb && user) ? 'cloud' : 'anon';
  const email = () => (user && user.email) || '';
  const uid = () => (user && user.id) || '';
  const onAuth = fn => authCbs.push(fn);
  const onError = fn => errCbs.push(fn);
  const fireAuth = () => authCbs.forEach(f => { try { f(); } catch (e) {} });
  const fireError = m => errCbs.forEach(f => { try { f(m); } catch (e) {} });

  // ── 인증 ────────────────────────────────────────────────────────────
  async function initAuth() {
    if (!sb) return;
    try {
      const { data } = await sb.auth.getSession();
      user = (data && data.session && data.session.user) || null;
    } catch (e) { user = null; }
    sb.auth.onAuthStateChange((_ev, session) => {
      const next = (session && session.user) || null;
      const changed = (next && next.id) !== (user && user.id);
      user = next;
      if (changed) fireAuth();
    });
  }

  async function signIn() {
    if (!sb) {
      fireError(location.protocol === 'file:'
        ? '파일로 열면 로그인을 할 수 없습니다. 배포된 주소로 들어오세요.'
        : '접속 정보가 없어 로그인할 수 없습니다.');
      return;
    }
    /* ★돌아오는 자리는 **늘 루트**다. 탭이 경로(/t/<id>)라도 마찬가지다 —
       Supabase 의 Redirect URLs 에 등록된 값이 루트뿐이고, 등록 안 된 주소로 돌아오려 하면
       OAuth 가 깨진다(stock 에서 겪었다). 가려던 곳은 세션에 맡기고 app.js 의 boot 이 되돌린다. */
    try { sessionStorage.setItem('back1', location.pathname); } catch (e) { /* 막히면 루트로 */ }
    const { error } = await sb.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: location.origin + '/' },
    });
    if (error) fireError('로그인하지 못했습니다: ' + error.message);
  }

  async function signOut() { if (sb) await sb.auth.signOut(); }

  /* 현재 세션의 액세스 토큰. api/gmaps·api/fx 프록시가 로그인 여부를 확인하는 데 쓴다. */
  async function accessToken() {
    if (!sb) return '';
    try {
      const { data } = await sb.auth.getSession();
      return (data && data.session && data.session.access_token) || '';
    } catch (e) { return ''; }
  }

  /* 오류를 사람 말로 바꾸되 **원문을 지우지 않는다.**
     ★한 번 지웠다가 디버깅이 막혔다(2026-09-01): '권한이 없습니다' 만 보이니 무엇이 막혔는지
       알 수 없었다. 무슨 일이 일어났는지는 원문에만 있고, 무엇을 해야 하는지는 힌트에만 있다.
       stock 의 db.js 가 그렇게 한다 — 원문 + 덧붙인 설명. */
  function say(prefix, error) {
    const m = (error && error.message) || '알 수 없는 오류';
    const code = (error && error.code) ? ` [${error.code}]` : '';
    const det = (error && error.details) ? ` (${error.details})` : '';
    let hint = '';
    if (/row-level security/i.test(m)) {
      hint = ' — RLS 정책에 막혔습니다. 이 표에 해당 동작의 정책이 있는지 확인하세요.';
    } else if (/permission denied/i.test(m)) {
      hint = ' — 표 권한이 없습니다. supabase/grants.sql 을 다시 돌리세요.';
    } else if (/schema|PGRST106/i.test(m)) {
      hint = ' — trip 스키마가 Data API 에 노출되지 않았습니다.';
    } else if (/PGRST116/i.test(code + m)) {
      hint = ' — 만들어졌지만 되읽지 못했습니다(select 정책 확인).';
    }
    return `${prefix}: ${m}${code}${det}${hint}`;
  }

  // ── 여행 ────────────────────────────────────────────────────────────
  /* RLS 가 '내가 속한 여행' 만 준다. 클라이언트는 필터를 걸지 않는다 —
     걸면 정책과 두 곳에서 같은 판정을 하게 되고, 언젠가 둘이 갈린다. */
  const trips = {
    list: async () => {
      if (mode() !== 'cloud') return [];
      const { data, error } = await sb.from('trips')
        .select('id,name,start_on,end_on,base_cur,invite_code,owner_id')
        .order('start_on', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });
      if (error) throw new Error(say('여행을 불러오지 못했습니다', error));
      return data || [];
    },

    create: async ({ name, start_on, end_on, base_cur }) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const row = {
        name: String(name || '').trim(),
        start_on: start_on || null,
        end_on: end_on || null,
        base_cur: base_cur || 'KRW',
      };
      if (!row.name) throw new Error('여행 이름을 입력하세요.');
      if (row.start_on && row.end_on && row.start_on > row.end_on) {
        throw new Error('끝나는 날이 시작하는 날보다 앞설 수 없습니다.');
      }
      /* owner_id 는 컬럼 기본값(auth.uid())이 채운다. 보내 봐야 정책의 with check 에 걸린다.
         ★.select() 를 붙여야 만들어진 행이 돌아온다 — 바로 그 여행으로 들어가려면 id 가 필요하다. */
      const { data, error } = await sb.from('trips').insert(row).select().single();
      if (error) throw new Error(say('여행을 만들지 못했습니다', error));
      return data;
    },

    update: async (id, patch) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const { error } = await sb.from('trips').update(patch).eq('id', id);
      if (error) throw new Error(say('여행을 수정하지 못했습니다', error));
    },

    /* 여행 목록 화면이 카드마다 '그 여행의 모양' 을 그리려면 일정이 필요하다.
       ★여행마다 따로 부르지 않는다 — RLS 가 이미 '내가 속한 여행' 으로 좁혀 주므로
         한 번에 다 받아 와서 클라이언트가 나눈다. 여행이 열 개여도 왕복은 하나다.
       ★필요한 칸만 고른다. 목록 화면에 메모·링크·예약번호는 쓰이지 않는다. */
    shape: async () => {
      if (mode() !== 'cloud') return [];
      const { data, error } = await sb.from('items')
        .select('trip_id,on_date,kind,cost,cost_cur,fx')
        .order('on_date', { ascending: true });
      if (error) return [];          // 못 받아도 목록은 보여준다 — 미니 레일만 빠진다
      return data || [];
    },

    /* 지우는 것은 소유자만 — 정책이 판정한다. 동행자가 누르면 0행이 지워지고 조용히 끝나므로
       화면이 그 사실을 알 수 있게 지워진 행을 돌려받는다. */
    remove: async (id) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const { data, error } = await sb.from('trips').delete().eq('id', id).select('id');
      if (error) throw new Error(say('여행을 지우지 못했습니다', error));
      if (!data || !data.length) throw new Error('여행을 만든 사람만 지울 수 있습니다.');
    },
  };

  // ── 일정 ────────────────────────────────────────────────────────────
  /* 화면이 늘 이 순서로 읽는다: 날짜 → 시각(없으면 뒤) → 순번.
     ★정렬을 서버에 맡긴다. 클라이언트에서 또 정렬하면 두 규칙이 생기고 언젠가 갈린다. */
  const COLS = 'id,trip_id,author_id,on_date,at_time,seq,kind,name,memo,done,' +
               'map_url,lat,lng,cost,cost_cur,fx,payer_id,ref_code,book_url';

  const num = v => (v === '' || v == null) ? null : (Number.isFinite(+v) ? +v : null);

  const items = {
    list: async (tripId) => {
      if (mode() !== 'cloud') return [];
      const { data, error } = await sb.from('items')
        .select(COLS)
        .eq('trip_id', tripId)
        .order('on_date', { ascending: true })
        .order('at_time', { ascending: true, nullsFirst: false })
        .order('seq', { ascending: true });
      if (error) throw new Error(say('일정을 불러오지 못했습니다', error));
      return data || [];
    },

    /* 넣는 값을 한 곳에서 다듬는다. 화면이 준 것을 그대로 보내면 빈 문자열이 숫자 칸에 들어간다. */
    shape: (v) => ({
      on_date: v.on_date,
      at_time: v.at_time || null,
      seq: Number.isFinite(+v.seq) ? +v.seq : 0,
      kind: v.kind || '기타',
      name: String(v.name || '').trim(),
      memo: (v.memo || '').trim() || null,
      done: !!v.done,
      map_url: (v.map_url || '').trim() || null,
      lat: num(v.lat), lng: num(v.lng),
      cost: num(v.cost),
      cost_cur: num(v.cost) == null ? null : (v.cost_cur || 'KRW'),
      fx: num(v.fx),
      payer_id: v.payer_id || null,
      ref_code: (v.ref_code || '').trim() || null,
      book_url: (v.book_url || '').trim() || null,
    }),

    create: async (tripId, v) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const row = items.shape(v);
      if (!row.name) throw new Error('장소명을 입력하세요.');
      if (!row.on_date) throw new Error('날짜를 고르세요.');
      /* ★.select() 를 붙이지 않는다. RETURNING 은 SELECT 정책까지 보는데, 여기서는
         이미 멤버라 통과하긴 한다 — 다만 돌려받을 이유가 없다(목록을 다시 받는다).
         trips 에서 이 성질 때문에 한 번 막혔다(members.sql 주석 참고). */
      const { error } = await sb.from('items').insert({ ...row, trip_id: tripId });
      if (error) throw new Error(say('일정을 추가하지 못했습니다', error));
    },

    update: async (id, v) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const row = items.shape(v);
      if (!row.name) throw new Error('장소명을 입력하세요.');
      const { error } = await sb.from('items').update(row).eq('id', id);
      if (error) throw new Error(say('일정을 수정하지 못했습니다', error));
    },

    /* '못 감' 만 토글한다 — 한 칸이라 폼을 열 필요가 없다.
       ★컬럼 이름은 done 이지만 뜻은 **못 갔다** 다. 계획한 곳 중 실제로는 빠진 곳을 표시한다
         (2026-09-01에 뜻을 그렇게 정했다 — 갔다 온 것을 지우는 쓰임이 아니었다). */
    setDone: async (id, done) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const { error } = await sb.from('items').update({ done: !!done }).eq('id', id);
      if (error) throw new Error(say('표시를 바꾸지 못했습니다', error));
    },

    remove: async (id) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const { error } = await sb.from('items').delete().eq('id', id);
      if (error) throw new Error(say('일정을 지우지 못했습니다', error));
    },
  };

  /* 단축 링크 펼치기 — api/gmaps.js 가 리다이렉트를 따라간다.
     전체 URL 은 여기 오지 않는다(js/gmaps.js 가 브라우저에서 바로 파싱한다). */
  async function expandMapUrl(shortUrl) {
    const tok = await accessToken();
    if (!tok) throw new Error('로그인이 필요합니다.');
    const r = await fetch('/api/gmaps?u=' + encodeURIComponent(shortUrl), {
      headers: { Authorization: 'Bearer ' + tok },
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `링크를 펼치지 못했습니다 (${r.status})`);
    return body.url;
  }

  // ── 준비물 ──────────────────────────────────────────────────────────
  /* 준비물은 '적는 것' 이 아니라 **'지우는 것'** 이다 — 그래서 자유 메모가 아니라 표다. */
  const checklist = {
    list: async (tripId) => {
      if (mode() !== 'cloud') return [];
      const { data, error } = await sb.from('checklist')
        .select('id,text,done,seq').eq('trip_id', tripId)
        .order('seq', { ascending: true });
      if (error) throw new Error(say('준비물을 불러오지 못했습니다', error));
      return data || [];
    },
    add: async (tripId, text, seq) => {
      const t = String(text || '').trim();
      if (!t) throw new Error('내용을 적으세요.');
      const { error } = await sb.from('checklist').insert({ trip_id: tripId, text: t, seq: seq || 0 });
      if (error) throw new Error(say('준비물을 추가하지 못했습니다', error));
    },
    setDone: async (id, done) => {
      const { error } = await sb.from('checklist').update({ done: !!done }).eq('id', id);
      if (error) throw new Error(say('표시를 바꾸지 못했습니다', error));
    },
    remove: async (id) => {
      const { error } = await sb.from('checklist').delete().eq('id', id);
      if (error) throw new Error(say('준비물을 지우지 못했습니다', error));
    },
  };

  // ── 동행자 ──────────────────────────────────────────────────────────
  /* trip_members 를 직접 읽으면 uuid 뿐이라 화면에 쓸 이름이 없다.
     auth.users 는 클라이언트가 못 읽는다(읽히면 이 프로젝트의 남의 계정까지 노출된다 —
     card-dashboard 와 같은 프로젝트다). security definer 함수가 딱 필요한 만큼만 연다. */
  async function crew(tripId) {
    if (mode() !== 'cloud') return [];
    const { data, error } = await sb.rpc('trip_crew', { t: tripId });
    if (error) throw new Error(say('동행자를 불러오지 못했습니다', error));
    return data || [];
  }

  async function removeMember(tripId, userId) {
    const { error } = await sb.rpc('remove_member', { t: tripId, who: userId });
    if (error) throw new Error(say('내보내지 못했습니다', error));
  }

  // ── 환율 ────────────────────────────────────────────────────────────
  /* 같은 (날짜·통화쌍) 은 값이 바뀌지 않는다 — 한 번 받으면 이 세션 동안 다시 묻지 않는다.
     비용을 열 줄 적으면 열 번 부를 이유가 없다. */
  const fxMemo = new Map();
  async function fx(date, from, to, kind) {
    if (!date || !from || !to) return null;
    if (from === to) return { rate: 1, on: date, exact: true };
    const key = `${date}|${from}|${to}`;
    if (fxMemo.has(key)) return fxMemo.get(key);
    const tok = await accessToken();
    if (!tok) throw new Error('로그인이 필요합니다.');
    const r = await fetch(`/api/fx?date=${encodeURIComponent(date)}&from=${from}&to=${to}&kind=${kind || 'tts'}`,
                          { headers: { Authorization: 'Bearer ' + tok } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(body.error || `환율을 가져오지 못했습니다 (${r.status})`);
    fxMemo.set(key, body);
    return body;
  }

  /* 초대 코드로 들어가기. 표에 직접 쓰지 않고 RPC 하나로만 통과한다 —
     클라이언트에 trip_members insert 를 열어 주면 남의 여행에 자기를 밀어 넣을 수 있다. */
  async function join(code) {
    if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
    const c = String(code || '').trim();
    if (!c) throw new Error('초대 코드를 입력하세요.');
    const { data, error } = await sb.rpc('join_trip', { code: c });
    if (error) throw new Error(say('참여하지 못했습니다', error));
    return data;                       // 참여한 여행의 id
  }

  return { CONFIGURED, mode, email, uid, accessToken,
           onAuth, onError, initAuth, signIn, signOut,
           trips, items, checklist, crew, removeMember, fx, join, expandMapUrl };
})();
