-- realtime.sql — 동행자가 고친 것이 **그 자리에서** 보이게 한다. 2026-09-17에 만들었다.
-- ──────────────────────────────────────────────────────────────────────────
-- 이 앱은 '동행자와 같은 표를 본다' 를 전제로 만들었는데, 정작 상대가 고친 것은
-- **새로고침하기 전까지 안 보였다.** plan.js 는 같은 여행이면 다시 안 받으므로
-- (탭을 옮길 때마다 네트워크를 타지 않으려는 옳은 결정이다) 다시 받을 계기가
-- '여행 바꾸기' 와 '내가 편집' 둘뿐이었다 — 둘이 같은 식당에 앉아 각자 넣으면
-- 서로가 안 보인다.
--
-- Postgres 의 변경을 구독한다. supabase-js 는 이미 실려 있으므로 더 싣는 것이 없다.
--
-- ★★**RLS 가 그대로 걸린다.** 구독도 로그인한 사람의 토큰으로 이뤄지므로, 남의 여행의
--   변경은 애초에 오지 않는다 — 표를 여는 것이 아니라 '내가 이미 읽을 수 있는 것'에
--   대해 알림을 받는 것뿐이다.
-- ★items 만 연다. 여행 이름·기간이 바뀌는 일은 드물고, 그건 설정 탭을 여는 사람만
--   보면 된다. 열어 두는 표가 적을수록 새는 곳도 적다.
--
-- 멱등하다. 이미 들어 있으면 아무 일도 안 한다.

do $$
begin
  if not exists (
    select 1 from pg_publication_rel pr
      join pg_publication p on p.oid = pr.prpubid
      join pg_class c on c.oid = pr.prrelid
      join pg_namespace n on n.oid = c.relnamespace
     where p.pubname = 'supabase_realtime'
       and n.nspname = 'trip' and c.relname = 'items'
  ) then
    alter publication supabase_realtime add table trip.items;
  end if;
end $$;

-- 확인: 한 줄이 나와야 한다
--   select schemaname, tablename from pg_publication_tables
--   where pubname = 'supabase_realtime' and schemaname = 'trip';
