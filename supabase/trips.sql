-- ★★이 앱의 표는 public 이 아니라 **trip 스키마**에 있다.
--   Supabase 무료 플랜은 프로젝트를 둘까지만 준다(card-dashboard · stock 이 이미 쓴다).
--   그래서 card-dashboard 의 프로젝트에 얹되, public 은 그쪽 것으로 두고 우리는 우리 방을 쓴다.
--   프리픽스(trip_items)가 아니라 스키마인 이유: Postgres 가 이런 상황을 위해 주는 도구다.
--
--   ★대시보드에서 할 일: Project Settings → API → **Exposed schemas 에 `trip` 을 추가**한다.
--     안 하면 PostgREST 가 이 표들을 보지 못해 클라이언트가 404 를 받는다.
--   ★클라이언트도 알아야 한다: createClient(..., { db: { schema: 'trip' } })

create schema if not exists trip;

grant usage on schema trip to anon, authenticated;
-- 표 권한은 로그인한 사람에게만. 실제 방어선은 아래의 RLS 다.
alter default privileges in schema trip grant all on tables to authenticated;
alter default privileges in schema trip grant all on functions to authenticated;

-- trips — 여행 하나. 이 앱의 그릇이다.
--
-- 담는 것은 이름·기간·현지통화·초대코드 넷과 소유자뿐이다.
-- 합계·일수·진행 여부는 담지 않는다 — 전부 items 와 날짜에서 계산해 낸다(저장하면 곧 어긋난다).
--
-- ★현지통화(base_cur)가 이 표에 있는 이유: 비용 칸의 기본값이 그 나라 돈이어야 하고,
--   합계를 낼 때 무엇으로 환산할지는 여행마다 다르다(일본 여행이라고 엔으로 보고 싶은 건 아니다).
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create table if not exists trip.trips (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name        text        not null,
  start_on    date,                                  -- 미정일 수 있다(“가을에 대만” 단계)
  end_on      date,
  base_cur    text        not null default 'KRW',    -- ★현지통화(그 나라 돈). 정산은 늘 원화다
  invite_code text        not null default encode(gen_random_bytes(6), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trips_name_chk  check (btrim(name) <> ''),
  constraint trips_span_chk  check (start_on is null or end_on is null or start_on <= end_on),
  unique (invite_code)
);

-- updated_at 자동 갱신.
-- ★public.touch_updated_at() 을 쓰지 않는다 — 그건 card-dashboard 의 records 가 쓰는 함수다.
--   create or replace 로 건드리면 남의 표의 동작까지 바꿀 수 있다(stock 의 snapshots.sql 이 같은 이유로
--   공용 함수에 트리거를 안 달았다). 우리 스키마 안에 우리 것을 둔다.
create or replace function trip.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trips_touch on trip.trips;
create trigger trips_touch before update on trip.trips
  for each row execute function trip.touch_updated_at();

alter table trip.trips enable row level security;

/* ★정책은 members.sql 이 만든다. is_trip_member() 가 있어야 쓸 수 있는데
   그 함수가 trip_members 표를 보기 때문이다. 실행 순서: trips → members → items → checklist.
   이 파일만 돌린 상태에서는 RLS 가 켜져 있고 정책이 없어 아무도 못 읽는다(안전한 쪽으로 막힌다). */
