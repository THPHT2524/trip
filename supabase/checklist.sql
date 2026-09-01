-- checklist — 준비물. 날짜에 매달 수 없는 것들의 집이다.
--
-- 왜 자유 메모가 아니라 표인가: 준비물은 본래 '적는 것' 이 아니라 **'지우는 것'** 이다.
-- 비자·유심·콘센트 규격·상비약은 체크가 되어야 뜻이 있고, 메모 한 덩어리에서는 그게 안 된다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

create table if not exists trip.checklist (
  id      uuid    primary key default gen_random_uuid(),
  trip_id uuid    not null references trip.trips(id) on delete cascade,
  text    text    not null,
  done    boolean not null default false,
  seq     integer not null default 0,
  constraint checklist_text_chk check (btrim(text) <> '')
);

create index if not exists checklist_trip_idx on trip.checklist (trip_id, seq);

alter table trip.checklist enable row level security;

drop policy if exists checklist_member on trip.checklist;
create policy checklist_member on trip.checklist
  for all to authenticated
  using (trip.is_trip_member(trip_id))
  with check (trip.is_trip_member(trip_id));
