-- place.sql — 여행에 **나라와 도시**를 적는다.
-- ──────────────────────────────────────────────────────────────────────────
-- 왜 필요한가: 여권(홈 화면)이 '몇 개국 몇 개 도시' 를 말하려면 나라와 도시를 알아야 하는데
--   지금까지는 둘 다 **어림**이었다.
--     나라 — 현지통화에서 유추했다. 유로는 나라가 열이 넘고, 달러는 미국 밖에서도 쓴다.
--     도시 — 좌표를 15km 로 묶어 셌다. 그랬더니 간사이공항이 오사카·교토와 나란히
--            '한 지역' 으로 섰다. 공항만 붙이고 교토는 가르는 반경은 35~42km 사이
--            7km 창뿐이고, 그건 간사이에만 맞는 값이다(인천 50km · 나리타 60km).
--
-- ★★그래서 **사람이 한 번 적는다.** 여행 하나에 두 칸이고 만들 때 같이 적는다 —
--   정교한 어림보다 적힌 사실이 낫다. 여권에 설명이 필요한 칸을 두지 않는다.
--
-- country: ISO 3166-1 alpha-2 (JP·TW·TH…). 국기와 '몇 개국' 이 여기서 나온다.
-- cities:  사람이 적은 대로. 여럿이면 쉼표로 나눈다 — '오사카, 교토'.
--          표를 따로 만들지 않는다. 도시는 세는 것 말고 할 일이 없고,
--          이름을 정규화할 근거(도시 목록)도 우리에게 없다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

alter table trip.trips
  add column if not exists country text,
  add column if not exists cities  text;

comment on column trip.trips.country is
  'ISO 3166-1 alpha-2 국가코드. 국기와 여권의 ''몇 개국''이 여기서 나온다. 없으면 국기 없음';
comment on column trip.trips.cities is
  '다녀온 도시. 쉼표로 나눠 적는다(''오사카, 교토''). 여권의 ''몇 개 도시''가 여기서 나온다';

-- 두 글자 대문자만 받는다 — 소문자·전체 이름이 섞이면 국기를 못 찾는다
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'trips_country_chk') then
    alter table trip.trips
      add constraint trips_country_chk check (country is null or country ~ '^[A-Z]{2}$');
  end if;
end $$;
