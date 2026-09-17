-- home.sql — 홈이 '여행의 모양' 을 **여행당 한 줄로** 받는다. 2026-09-17에 만들었다.
-- ──────────────────────────────────────────────────────────────────────────
-- 홈 카드가 그리는 것은 셋뿐이다: 몇 곳인가 · 그날그날 무슨 구분이 있었나(미니 레일) ·
-- 다녀온 공항은 어디인가(여권 위의 세계지도). 그런데 지금까지는 그걸 그리려고
-- **내가 속한 모든 여행의 모든 줄**을 통째로 받아 왔다.
--
-- ★지금 데이터로는 181줄이라 아프지 않다(2026-09-17 실측: 여행 40개 중 39개가 5줄
--   이하고, 오사카 하나가 96줄이다). 아픈 것은 **자라는 방향**이다:
--     · 오사카처럼 적은 여행이 열 개만 더 생기면 1,000줄을 넘는다
--     · Supabase 의 Max rows 기본값이 1000 이라, 넘으면 오류가 아니라 **조용히 잘린다**
--       — 그때 증상은 '오래된 여행 카드부터 곳 수와 레일이 사라진다' 이고, 화면은
--       아무 말도 안 한다(2026-09-02의 id 누락 사고와 똑같이 생겼다)
--   여행당 한 줄이면 이 함수는 여행 수만큼만 자란다. 마흔 줄이 천 줄이 되려면
--   여행을 천 번 가야 한다.
--
-- ★★**security invoker 다**(기본값). 그래서 RLS 가 그대로 걸린다 — 이 함수는
--   '내가 이미 읽을 수 있는 것' 을 줄여서 줄 뿐이고, 새로 여는 것이 하나도 없다.
--   definer 로 두면 판정이 정책 밖으로 나가고, 그 순간 이 파일이 두 번째 방어선이 된다.
--
-- ★구분은 **앞 넷만** 보낸다. 미니 레일이 한 칸에 찍는 점이 많아야 넷이다(칸이 좁으면
--   둘·하나로 준다) — 스물아홉 개를 보내 봐야 스물다섯 개는 버려진다.
-- ★공항 줄만은 낱낱이 보낸다. 세계지도가 점을 찍고 항로를 그으려면 좌표와 시각이
--   줄마다 있어야 한다 — 이건 접을 수가 없다. 지금 서른한 줄이다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create or replace function trip.home_shape()
returns jsonb
language sql
stable
set search_path = trip, public
as $$
with d as (
  -- 그날의 구분들. 결제 줄은 빼고 센다 — 부모의 날짜를 물려받아 두 번 세어진다
  select trip_id, on_date,
         (array_agg(kind order by seq, at_time))[1:4] as kinds,
         count(*)::int as n
    from trip.items
   where parent_id is null
   group by trip_id, on_date
),
t as (
  select trip_id,
         sum(n)::int as stops,
         jsonb_agg(jsonb_build_array(on_date, to_jsonb(kinds)) order by on_date) as days
    from d
   group by trip_id
)
select jsonb_build_object(
  'trips', coalesce((
    select jsonb_agg(jsonb_build_object(
             'trip_id', trip_id, 'stops', stops, 'days', days))
      from t), '[]'::jsonb),
  -- 공항은 이름 끝으로 가려낸다. '간사이공항점' 같은 가게가 딸려 오지 않게
  -- 포함이 아니라 **끝나는지**를 본다(js/app.js 의 worldHtml 과 같은 규칙이다)
  'air', coalesce((
    select jsonb_agg(jsonb_build_object(
             'trip_id', trip_id, 'on_date', on_date, 'at_time', at_time,
             'name', name, 'lat', lat, 'lng', lng)
             order by trip_id, on_date, at_time)
      from trip.items
     where name like '%공항' and lat is not null and lng is not null), '[]'::jsonb)
);
$$;

revoke all     on function trip.home_shape() from public;
grant  execute on function trip.home_shape() to authenticated;

-- PostgREST 에게 스키마를 다시 읽으라고 알린다
notify pgrst, 'reload schema';

-- 확인: 여행 수만큼 줄이 나오고, air 는 공항 줄 수만큼이다
--   select jsonb_array_length(trip.home_shape()->'trips') as trips,
--          jsonb_array_length(trip.home_shape()->'air')   as air;
