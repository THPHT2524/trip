-- grants — Data API 가 trip 스키마를 볼 수 있게 하는 권한. **마지막에 돌린다.**
--
-- 왜 따로 있나: trips.sql 의 `alter default privileges` 는 그 뒤에 만들어지는 표에만 걸린다.
-- 순서가 틀렸거나 표를 나중에 더하면 조용히 빠진다 — 그때 증상은 "표는 있는데 404" 라
-- 원인을 찾기 어렵다. 그래서 **이미 있는 것 전부에 다시 걸어 주는** 파일을 둔다.
--
-- ★2026-04-28 Supabase 변경: 새 표가 Data API 에 **자동으로 노출되지 않는다.**
--   신규 프로젝트는 2026-05-30 부터 기본값이고 **기존 프로젝트도 2026-10-30 에 강제 적용**된다.
--   그때가 되면 명시적 grant 가 없는 표는 API 에서 사라진다 — 미리 박아 둔다.
--
-- ★anon 에는 표 권한을 주지 않는다. 이 앱의 정책은 전부 `to authenticated` 이고,
--   로그인 없이 할 수 있는 일이 없다. 스키마 usage 만 열어 둔다(API 가 응답은 해야 한다).
--
-- 표를 새로 만들 때마다 이 파일을 다시 돌린다. 멱등하다.

grant usage on schema trip to anon, authenticated, service_role;

grant all on all tables    in schema trip to authenticated, service_role;
grant all on all routines  in schema trip to authenticated, service_role;
grant all on all sequences in schema trip to authenticated, service_role;

-- 앞으로 만들 것들에도 미리 걸어 둔다
alter default privileges for role postgres in schema trip
  grant all on tables    to authenticated, service_role;
alter default privileges for role postgres in schema trip
  grant all on routines  to authenticated, service_role;
alter default privileges for role postgres in schema trip
  grant all on sequences to authenticated, service_role;

-- PostgREST 에게 스키마를 다시 읽으라고 알린다(대시보드에서 바꾸면 자동으로 되지만,
-- SQL 만 돌렸을 때는 이 한 줄이 기다리는 시간을 줄인다).
notify pgrst, 'reload schema';
