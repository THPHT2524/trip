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

  /* RLS 에 막힌 것인지 알려 준다. 원문만으로는 무엇을 해야 할지 알 수 없다. */
  function say(prefix, error) {
    const m = (error && error.message) || '알 수 없는 오류';
    if (/permission denied|row-level security/i.test(m)) {
      return `${prefix}: 이 여행에 접근할 권한이 없습니다. 초대를 받았는지 확인하세요.`;
    }
    if (/schema|PGRST106/i.test(m)) {
      return `${prefix}: 서버 설정이 아직 끝나지 않았습니다(trip 스키마가 노출되지 않음).`;
    }
    return `${prefix}: ${m}`;
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

    /* 지우는 것은 소유자만 — 정책이 판정한다. 동행자가 누르면 0행이 지워지고 조용히 끝나므로
       화면이 그 사실을 알 수 있게 지워진 행을 돌려받는다. */
    remove: async (id) => {
      if (mode() !== 'cloud') throw new Error('로그인이 필요합니다.');
      const { data, error } = await sb.from('trips').delete().eq('id', id).select('id');
      if (error) throw new Error(say('여행을 지우지 못했습니다', error));
      if (!data || !data.length) throw new Error('여행을 만든 사람만 지울 수 있습니다.');
    },
  };

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
           trips, join };
})();
