-- trip_members — 어느 여행에 누가 속하나. **이 앱이 기존 두 프로젝트와 갈라지는 지점이다.**
--
-- card-dashboard 와 stock 의 RLS 는 예외 없이 `user_id = auth.uid()` 한 줄이었다.
-- 여기서는 '내 것' 이 아니라 '내가 속한 여행의 것' 을 읽어야 한다.
--
-- ★★재귀 함정 — 이 파일의 존재 이유다.
--   trips 의 정책이 trip_members 를 조회하고, trip_members 의 정책이 다시 trips 를 조회하면
--   Postgres 가 정책을 재귀 평가하다 `infinite recursion detected in policy` 로 죽는다.
--   Supabase 에서 가장 흔한 사고다.
--   끊는 방법은 security definer 함수다 — 함수 안의 조회는 RLS 를 지나가므로 재귀가 성립하지 않는다.
--   (stock 의 position_events.sql 에서 이미 쓴 기법이다.)
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create table if not exists trip.trip_members (
  trip_id   uuid        not null references trip.trips(id) on delete cascade,
  user_id   uuid        not null references auth.users(id)   on delete cascade,
  role      text        not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (trip_id, user_id),
  constraint trip_members_role_chk check (role in ('owner', 'member'))
);

create index if not exists trip_members_user_idx on trip.trip_members (user_id);

-- ── 멤버십 판정 ────────────────────────────────────────────────────────
-- 모든 표의 정책이 이 함수 하나만 부른다. 판정 규칙이 한 곳에 있어야 갈라지지 않는다.
create or replace function trip.is_trip_member(t uuid)
returns boolean
language sql
security definer
stable
set search_path = trip, public
as $$
  select exists (
    select 1 from trip.trip_members
    where trip_id = t and user_id = auth.uid()
  );
$$;

-- ── 여행을 만들면 만든 사람이 첫 멤버가 된다 ──────────────────────────
-- 안 하면 방금 만든 여행이 자기 눈에도 안 보인다(정책이 멤버십으로 판정하므로).
create or replace function trip.add_owner_as_member() returns trigger
language plpgsql security definer set search_path = trip, public as $$
begin
  insert into trip.trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner')
  on conflict do nothing;
  return new;
end;
$$;

drop trigger if exists trips_owner_member on trip.trips;
create trigger trips_owner_member after insert on trip.trips
  for each row execute function trip.add_owner_as_member();

-- ── 초대 링크로 들어오기 ───────────────────────────────────────────────
-- 클라이언트가 trip_members 에 직접 쓰는 길은 열지 않는다(남의 여행에 자기를 밀어 넣을 수 있다).
-- 코드를 아는 사람만, 자기 자신만 넣을 수 있게 이 함수 하나로 통과시킨다.
create or replace function trip.join_trip(code text)
returns uuid
language plpgsql
security definer
set search_path = trip, public
as $$
declare
  t uuid;
begin
  if auth.uid() is null then
    raise exception '로그인이 필요합니다.';
  end if;

  select id into t from trip.trips where invite_code = btrim(code);
  if t is null then
    raise exception '그런 초대 코드가 없습니다.';
  end if;

  insert into trip.trip_members (trip_id, user_id, role)
  values (t, auth.uid(), 'member')
  on conflict do nothing;      -- 이미 멤버면 조용히 통과한다(링크를 두 번 눌러도 된다)

  return t;
end;
$$;

revoke all on function trip.join_trip(text) from public;
grant execute on function trip.join_trip(text) to authenticated;

alter table trip.trip_members enable row level security;

-- 읽기: 같은 여행의 멤버끼리는 서로 보인다(누가 함께 가는지 알아야 한다).
--   is_trip_member() 를 쓰므로 재귀하지 않는다.
drop policy if exists trip_members_read on trip.trip_members;
create policy trip_members_read on trip.trip_members
  for select to authenticated
  using (trip.is_trip_member(trip_id));

-- 나가기: 자기 행만 지울 수 있다.
drop policy if exists trip_members_leave on trip.trip_members;
create policy trip_members_leave on trip.trip_members
  for delete to authenticated
  using (user_id = auth.uid());

-- ★insert 정책을 두지 않는다 — 넣는 것은 위의 두 함수(security definer)뿐이다.

-- ── 이제 trips 의 정책을 만들 수 있다 ─────────────────────────────────
/* ★★`owner_id = auth.uid()` 를 **반드시 먼저** 둔다. 멤버십만으로 판정하면 여행을 못 만든다.
   왜냐 (2026-09-01 에 실제로 막혔다):
     `insert ... returning` 은 삽입 정책뿐 아니라 **돌려줄 행에 SELECT 정책까지** 적용한다.
     그런데 멤버 행은 아래 AFTER INSERT 트리거가 만들므로, RETURNING 이 평가되는 시점에는
     아직 멤버가 아니다 → 방금 만든 여행이 만든 사람에게 안 보인다 →
     `new row violates row-level security policy for table "trips"` 로 거부된다.
     ★증상이 고약하다: RETURNING 없이 넣으면 성공하므로 삽입 정책을 아무리 들여다봐도 멀쩡하다.
     supabase-js 의 `.insert(row).select()` 가 바로 그 RETURNING 이다.
   소유자를 직접 통과시키는 것은 의미상으로도 맞다 — 내가 만든 여행은 멤버 표와 무관하게
   보여야 하고, 트리거가 언젠가 실패해도 자기 여행이 사라지지 않는다. */
drop policy if exists trips_member on trip.trips;
create policy trips_member on trip.trips
  for select to authenticated
  using (owner_id = auth.uid() or trip.is_trip_member(id));

-- 만들기: 자기를 소유자로 하는 여행만.
drop policy if exists trips_create on trip.trips;
create policy trips_create on trip.trips
  for insert to authenticated
  with check (owner_id = auth.uid());

-- 고치기·지우기: 소유자만. 동행자가 남의 여행을 지우면 곤란하다.
drop policy if exists trips_own_write on trip.trips;
create policy trips_own_write on trip.trips
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists trips_own_delete on trip.trips;
create policy trips_own_delete on trip.trips
  for delete to authenticated
  using (owner_id = auth.uid());
