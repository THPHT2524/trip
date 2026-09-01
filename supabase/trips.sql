-- trips — 여행 하나. 이 앱의 그릇이다.
--
-- 담는 것은 이름·기간·기준통화·초대코드 넷과 소유자뿐이다.
-- 합계·일수·진행 여부는 담지 않는다 — 전부 items 와 날짜에서 계산해 낸다(저장하면 곧 어긋난다).
--
-- ★기준통화(base_cur)가 이 표에 있는 이유: 비용은 items 에 현지 통화로 들어오고,
--   합계를 낼 때 무엇으로 환산할지는 여행마다 다르다(일본 여행이라고 엔으로 보고 싶은 건 아니다).
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create table if not exists public.trips (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name        text        not null,
  start_on    date,                                  -- 미정일 수 있다(“가을에 대만” 단계)
  end_on      date,
  base_cur    text        not null default 'KRW',    -- 합계를 환산할 통화
  invite_code text        not null default encode(gen_random_bytes(6), 'hex'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint trips_name_chk  check (btrim(name) <> ''),
  constraint trips_span_chk  check (start_on is null or end_on is null or start_on <= end_on),
  unique (invite_code)
);

-- updated_at 자동 갱신 — card-dashboard·stock 과 같은 공용 함수다.
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trips_touch on public.trips;
create trigger trips_touch before update on public.trips
  for each row execute function public.touch_updated_at();

alter table public.trips enable row level security;

/* ★정책은 members.sql 이 만든다. is_trip_member() 가 있어야 쓸 수 있는데
   그 함수가 trip_members 표를 보기 때문이다. 실행 순서: trips → members → items → checklist.
   이 파일만 돌린 상태에서는 RLS 가 켜져 있고 정책이 없어 아무도 못 읽는다(안전한 쪽으로 막힌다). */
