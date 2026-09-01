# Supabase + Vercel 설치 런북

일정은 Supabase 에 있고, 저장소에는 코드만 있다. 구글 로그인한 사람에게 **자기가 속한 여행만**
보여준다(RLS). 장소 정보는 저장하지 않고 붙여넣은 구글맵 링크에서 그때그때 뽑는다.

```
브라우저 ─┬─ /api/gmaps ──> maps.app.goo.gl   단축 링크 펼치기 (저장 안 함)
          ├─ /api/fx    ──> m.stock.naver.com 날짜별 환율 (저장 안 함)
          ├─ 타일       ──> tile.openstreetmap.org  지도 밑그림
          └─ Supabase   ──> trip 스키마        여행·일정·동행자·준비물
```

---

## 0. ★이 앱은 프로젝트를 새로 만들지 않는다

Supabase 무료 플랜은 **프로젝트를 둘까지만** 준다. card-dashboard 와 stock 이 이미 그 둘을 쓴다.

그래서 **card-dashboard 의 프로젝트에 얹되, `trip` 스키마를 따로 판다.**

- **왜 stock 이 아니라 card 인가** — stock 프로젝트에는 서버리스 프록시(`api/naver.js`·`api/etf.js`)가
  붙어 있다. 가입을 열면 아무나 로그인해 Vercel 실행량을 태울 수 있어서 닫아 둔 것이다.
  card 는 순수 정적이라 가입을 열어도 **RLS 가 데이터를 막고 비용 영향은 무료 티어 쿼터뿐**이다.
- **왜 프리픽스(`trip_items`)가 아니라 스키마인가** — Postgres 가 이런 상황을 위해 주는 도구가
  스키마다. `public` 은 card-dashboard 것으로 그대로 두고 우리는 우리 방을 쓴다.
- **왜 card·stock 을 여기로 옮기지 않는가** — `auth.users` 는 프로젝트마다 별개라 같은 구글
  계정이어도 **UUID 가 다르다.** 기존 데이터의 `user_id` 는 옛 프로젝트의 UUID 를 가리키므로
  그대로 옮기면 RLS 가 본인 데이터를 전부 숨긴다. 살아 있는 데이터를 백업 없이 옮길 이유가 없다.

> ⚠️ 이 앱을 붙이면 **card-dashboard 프로젝트의 신규 가입이 열린다**(동행자가 로그인해야 하므로).
> 남이 가입해서 카드 대시보드에 자기 기록을 넣을 수 있다 — 내 기록은 RLS 가 막는다.
> 되돌리려면 이 앱의 공유를 포기하거나 Pro 로 올려 프로젝트를 따로 판다.

---

## 1. 표 만들기

card-dashboard 프로젝트의 **SQL Editor** 에서 **반드시 이 순서로** 실행한다 (넷 다 멱등).

| 순서 | 파일 | 이유 |
|---|---|---|
| 1 | `supabase/trips.sql` | 스키마·권한·그릇. 이 시점엔 정책이 없어 아무도 못 읽는다(정상) |
| 2 | `supabase/members.sql` | `trip.is_trip_member()` 를 만들고 **trips 의 정책도 여기서 만든다** |
| 3 | `supabase/items.sql` | 일정 |
| 4 | `supabase/checklist.sql` | 준비물 |
| 5 | `supabase/grants.sql` | Data API 권한. **표를 더할 때마다 다시 돌린다** |

★순서를 지켜야 한다. `items.sql` 은 `trip.is_trip_member()` 를 부르는데 그 함수는 2번이 만든다.

### 그다음 대시보드에서 두 가지

1. **Exposed schemas 에 `trip` 추가** — 안 하면 PostgREST 가 이 표들을 보지 못하고
   `PGRST106 Invalid schema: trip` 을 낸다. **제일 흔한 첫 실패다.**
   UI 개편으로 위치가 둘 중 하나다:
   - Project Settings → **Data API** → Exposed schemas
   - Integrations → Data API → Settings → Exposed schemas

   `Extra search path` 에도 `trip` 을 넣어 두면 RPC 가 깔끔하게 잡힌다.
2. **Authentication → Sign In / Providers → 신규 가입 허용**
   동행자가 들어오려면 필요하다(위 경고 참고).

---

## 2. 클라이언트

`js/supabase-config.js` 에 접속 정보를 넣는다. card-dashboard 와 **같은 프로젝트의 같은 값**이다.

```js
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

★`js/db.js` 는 클라이언트를 만들 때 **스키마를 지정해야 한다.** 안 하면 `public` 을 보고
card-dashboard 의 `records` 옆에서 우리 표를 못 찾는다.

```js
supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  db: { schema: 'trip' },
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' }
});
```

### 구글 로그인

card-dashboard 프로젝트에 이미 설정돼 있다. 여기서 할 일은 **Redirect URLs 에 이 앱의 주소를
추가**하는 것뿐이다.

- **Authentication → URL Configuration → Redirect URLs** 에 배포 주소의 **루트**를 넣는다
- ★탭이 경로(`/t/<id>` 등)라도 **로그인은 늘 루트로 돌아온다.** 가려던 곳은 세션에 맡긴다
  (stock 에서 같은 실수를 했다 — 경로에서 로그인하면 등록 안 된 주소로 돌아와 OAuth 가 깨진다)

---

## 3. Vercel

1. GitHub 저장소를 Vercel 에 연결한다. 빌드 스텝은 없다(정적).
2. 서버리스 함수 둘(`api/gmaps.js`·`api/fx.js`)은 자동으로 잡힌다.
3. `vercel.json` 에 `/t/(.*)` → `/index.html` 리라이트가 있어야 경로 탭이 새로고침을 견딘다.

환경변수는 필수가 아니다. `api/*.js` 가 `SUPABASE_URL`·`SUPABASE_ANON_KEY` 를 읽되,
없으면 코드에 박힌 공개 값으로 떨어진다(anon 키는 브라우저에 노출되도록 설계된 키다).

---

## 4. 확인

- [ ] Exposed schemas 에 `trip` 이 있다 (없으면 전부 404 다)
- [ ] 로그인이 되고, 로그아웃하면 게이트만 보인다
- [ ] 여행을 만들면 **바로 내 목록에 보인다** (트리거가 나를 멤버로 넣었다는 뜻)
- [ ] 다른 계정으로 초대 링크를 열면 그 여행만 보이고 **내 다른 여행은 안 보인다**
- [ ] card-dashboard 앱이 **여전히 멀쩡하다** — `public.records` 는 건드리지 않았다
- [ ] 로그아웃 상태에서 `/api/gmaps?u=...` 를 부르면 401 이 온다
