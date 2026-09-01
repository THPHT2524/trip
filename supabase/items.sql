-- items — 일정 한 줄. 이 앱의 본체다.
--
-- ★계획과 기록이 **같은 표**에 있다. 떠나기 두 달 전에 숙소를 적어 넣고, 현지에서 한 줄 추가하고,
--   돌아와서 비용을 채운다 — 셋이 같은 줄에서 일어난다. 그래서 거의 모든 칸이 nullable 이다.
--   '아직 안 정했다' 가 정상 상태이기 때문이다.
--
-- ★비용을 별도 표로 빼지 않는다. 여행 지출은 대부분 '어디서 쓴 것' 이라 일정에 붙어 있고
--   (트리플 가계부도 그렇다), 표를 나누면 같은 것을 두 번 적게 된다.
--
-- ★좌표와 장소명은 저장한다. '낡을 값은 저장하지 않는다' 의 의도된 예외다 —
--   매번 구글에 다시 물으면 호출이 붙고 오프라인에서 타임라인이 빈칸이 된다.
--   대신 영업시간·평점처럼 실제로 낡는 값은 담지 않는다(그건 map_url 을 열면 있다).
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create table if not exists trip.items (
  id         uuid        primary key default gen_random_uuid(),
  trip_id    uuid        not null references trip.trips(id) on delete cascade,
  author_id  uuid        not null default auth.uid() references auth.users(id) on delete set null,

  -- ── 언제 ────────────────────────────────────────────────
  on_date    date        not null,        -- 며칠
  at_time    time,                        -- 몇 시. null 이 흔하다("3일차 점심"까지만 정한다)
  seq        integer     not null default 0,   -- 시각이 없는 것들의 그날 안 순서

  -- ── 무엇 ────────────────────────────────────────────────
  kind       text        not null default '기타',
  name       text        not null,
  memo       text,
  done       boolean     not null default false,   -- ★뜻은 '못 갔다'. 계획엔 있었지만 빠진 곳

  -- ── 어디 (구글맵 링크에서 뽑는다) ────────────────────────
  map_url    text,                        -- 붙여넣은 원문 그대로 남긴다
  lat        numeric,                     -- 링크의 !3d
  lng        numeric,                     -- 링크의 !4d

  -- ── 얼마 ────────────────────────────────────────────────
  cost       numeric,                     -- null = 아직 안 정했다
  cost_cur   text,                        -- 'KRW' | 'JPY' | …
  fx         numeric,                     -- ★원화 환산율(1 단위당 원). 그 날짜 종가를 채우고 사람이 고친다
  payer_id   uuid        references auth.users(id) on delete set null,   -- 누가 냈나

  -- ── 예약 ────────────────────────────────────────────────
  ref_code   text,                        -- 예약번호·확인코드 — 현지에서 실제로 꺼내 보는 값
  book_url   text,                        -- 예약 사이트 링크 (map_url 과 성격이 다르다)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint items_name_chk check (btrim(name) <> ''),
  constraint items_kind_chk check (kind in ('숙소','식사','관광','이동','쇼핑','기타')),
  -- 좌표는 둘 다 있거나 둘 다 없다. 하나만 있으면 지도에 못 찍는데 있는 척하게 된다.
  constraint items_geo_chk  check ((lat is null) = (lng is null)),
  constraint items_lat_chk  check (lat is null or (lat between -90 and 90)),
  constraint items_lng_chk  check (lng is null or (lng between -180 and 180)),
  -- 비용이 있으면 통화가 있어야 한다. 없으면 합계에서 그 줄이 조용히 빠진다.
  constraint items_cost_chk check (cost is null or cost_cur is not null)
);

-- 화면이 늘 이 순서로 읽는다: 이 여행의, 날짜 순, 그날 안에서는 시각→순번.
create index if not exists items_trip_idx on trip.items (trip_id, on_date, at_time nulls last, seq);

drop trigger if exists items_touch on trip.items;
create trigger items_touch before update on trip.items
  for each row execute function trip.touch_updated_at();

alter table trip.items enable row level security;

-- 멤버면 읽고 쓴다. 동행자가 같이 일정을 짜는 것이 이 앱의 전제다.
--   with check 까지 걸어야 남의 여행으로 행을 옮겨 넣는 것을 막는다.
drop policy if exists items_member on trip.items;
create policy items_member on trip.items
  for all to authenticated
  using (trip.is_trip_member(trip_id))
  with check (trip.is_trip_member(trip_id));
