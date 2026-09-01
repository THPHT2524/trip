# Supabase + Vercel 설치 런북

일정은 Supabase 에 있고, 저장소에는 코드만 있다. 구글 로그인한 사람에게 **자기가 속한 여행만**
보여준다(RLS). 장소 정보는 저장하지 않고 붙여넣은 구글맵 링크에서 그때그때 뽑는다.

```
브라우저 ─┬─ /api/gmaps ──> maps.app.goo.gl   단축 링크 펼치기 (저장 안 함)
          ├─ /api/fx    ──> m.stock.naver.com 날짜별 환율 (저장 안 함)
          ├─ 타일       ──> tile.openstreetmap.org  지도 밑그림
          └─ Supabase                        여행·일정·동행자·준비물
```

---

## 1. Supabase 프로젝트

1. https://supabase.com → **New project** — Region **Northeast Asia (Seoul)**, DB 비밀번호 지정
2. **SQL Editor** 에서 **반드시 이 순서로** 실행 (넷 다 멱등)

   | 순서 | 파일 | 이유 |
   |---|---|---|
   | 1 | `supabase/trips.sql` | 그릇. 이 시점엔 정책이 없어 아무도 못 읽는다(정상) |
   | 2 | `supabase/members.sql` | `is_trip_member()` 를 만들고 **trips 의 정책도 여기서 만든다** |
   | 3 | `supabase/items.sql` | 일정 |
   | 4 | `supabase/checklist.sql` | 준비물 |

   ★순서를 지켜야 한다. `items.sql` 은 `is_trip_member()` 를 부르는데 그 함수는 2번이 만든다.

3. **Authentication → Sign In / Providers** 에서 **Google** 을 켠다
   - Google Cloud 콘솔에서 OAuth 클라이언트를 만들고 클라이언트 ID·시크릿을 넣는다
   - 승인된 리디렉션 URI 에 Supabase 가 알려주는 콜백 주소를 넣는다
4. **Authentication → URL Configuration → Redirect URLs** 에 배포 주소의 **루트**를 넣는다
   - ★탭이 경로(`/t/<id>` 등)라도 **로그인은 늘 루트로 돌아온다**. 가려던 곳은 세션에 맡긴다
     (stock 에서 같은 실수를 했다 — 경로에서 로그인하면 등록 안 된 주소로 돌아와 OAuth 가 깨진다)
5. **Project Settings → API** 의 두 값을 `js/supabase-config.js` 에 넣는다

```js
const SUPABASE_URL = 'https://xxxx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_...';
```

### ⚠ 이 프로젝트는 신규 가입을 **열어 둔다**

동행자가 로그인해야 하므로 `disable_signup` 을 켜지 않는다. card-dashboard·stock 과 반대다.
**그래서 RLS 가 유일한 방어선이라는 말이 여기서는 훨씬 무겁다** — 표를 추가할 때마다
`using` 과 `with check` 를 둘 다 걸었는지 확인할 것.

---

## 2. Vercel

1. GitHub 저장소를 Vercel 에 연결한다. 빌드 스텝은 없다(정적).
2. `vercel.json` 의 CSP 에서 **배포 도메인이 바뀌면 고칠 것은 없다** — 전부 `'self'` 기준이다.
3. 서버리스 함수 둘(`api/gmaps.js`·`api/fx.js`)은 자동으로 잡힌다.

환경변수는 필수가 아니다. `api/*.js` 가 `SUPABASE_URL`·`SUPABASE_ANON_KEY` 를 읽되,
없으면 코드에 박힌 공개 값으로 떨어진다(anon 키는 브라우저에 노출되도록 설계된 키다).

---

## 3. 확인

- [ ] 로그인이 되고, 로그아웃하면 게이트만 보인다
- [ ] 여행을 만들면 **바로 내 목록에 보인다**(트리거가 나를 멤버로 넣었다는 뜻)
- [ ] 다른 계정으로 초대 링크를 열면 그 여행만 보이고 **내 다른 여행은 안 보인다**
- [ ] 로그아웃 상태에서 `/api/gmaps?u=...` 를 부르면 401 이 온다
