-- crew — 같은 여행의 멤버가 서로를 볼 수 있게 한다. 2026-09-01에 만들었다.
--
-- 왜 필요한가: trip_members 에는 `user_id`(uuid) 뿐이다. 화면에는 사람 이름이 있어야 하는데
-- `auth.users` 는 클라이언트가 읽을 수 없다(읽을 수 있으면 이 프로젝트의 **모든** 사용자가
-- 노출된다 — card-dashboard 와 같은 프로젝트를 쓰므로 남까지 딸려 나온다).
--
-- 그래서 security definer 함수로 **딱 필요한 만큼만** 연다:
--   · 부르는 사람이 그 여행의 멤버일 때만 (함수 안에서 trip.is_trip_member 로 확인한다)
--   · 그 여행의 멤버만 (다른 여행·다른 사용자는 나오지 않는다)
--   · 이메일과 역할만 (비밀번호 해시·마지막 로그인 같은 것은 애초에 고르지 않는다)
--
-- ★같은 여행에 든 사람끼리 이메일이 보인다. 초대해서 함께 짜는 앱이니 그게 맞다 —
--   다만 '초대 = 내 이메일을 상대에게 보여주는 일' 이라는 뜻이므로 화면에 그렇게 적는다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create or replace function trip.trip_crew(t uuid)
returns table (user_id uuid, email text, role text, joined_at timestamptz)
language sql
security definer
stable
set search_path = trip, public
as $$
  select m.user_id, u.email::text, m.role, m.joined_at
  from trip.trip_members m
  join auth.users u on u.id = m.user_id
  where m.trip_id = t
    and trip.is_trip_member(t)      -- ★부르는 사람이 멤버가 아니면 한 줄도 안 나온다
  order by m.joined_at;
$$;

revoke all     on function trip.trip_crew(uuid) from public;
grant  execute on function trip.trip_crew(uuid) to authenticated;

-- ── 소유자는 동행자를 내보낼 수 있다 ─────────────────────────────────
-- trip_members 의 delete 정책은 '자기 행만' 이다(스스로 나가기). 소유자가 남을 빼려면
-- 그 정책으로는 안 되는데, 정책을 넓히면 동행자끼리 서로를 뺄 수 있게 된다.
-- 그래서 함수 하나로만 연다.
create or replace function trip.remove_member(t uuid, who uuid)
returns void
language plpgsql
security definer
set search_path = trip, public
as $$
begin
  if not exists (select 1 from trip.trips where id = t and owner_id = auth.uid()) then
    raise exception '여행을 만든 사람만 동행자를 내보낼 수 있습니다.';
  end if;
  if who = auth.uid() then
    raise exception '소유자는 자기 자신을 뺄 수 없습니다. 여행을 지우세요.';
  end if;
  delete from trip.trip_members where trip_id = t and user_id = who;
end;
$$;

revoke all     on function trip.remove_member(uuid, uuid) from public;
grant  execute on function trip.remove_member(uuid, uuid) to authenticated;
