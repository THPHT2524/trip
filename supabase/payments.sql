-- payments.sql — 한 장소에 결제 여러 건.
-- ──────────────────────────────────────────────────────────────────────────
-- 왜 필요한가: 한 자리에서 결제가 두 번 이상 일어난다.
--   저녁 자리에서 밥값은 A가 카드로, 술값은 B가 현금으로.
--   기차를 각자 카드로 찍었는데 한 명만 왕복을 끊었다.
-- 지금까지는 줄 하나에 결제 하나뿐이라 이런 자리를 담을 수 없었다.
--
-- ★★결제를 **별도 표로 만들지 않는다.** 같은 items 의 **자식 줄**로 둔다.
--   그러면 지금 있는 것이 전부 그대로 산다 — settle(카드/현금/환전)·qty·split·fx·payer
--   와 정산 엔진(js/money.js), RLS 정책, 오프라인 큐, 저장 로직까지 손댈 것이 없다.
--   자식도 결국 '돈이 오간 줄' 이고, 표를 하나 더 만들면 그 규칙을 두 벌 갖게 된다.
--
-- 장소 줄도 제 금액을 갖는다(결제 한 건인 흔한 경우는 지금과 똑같이 쓴다).
-- 자식이 붙는 건 두 번째 결제부터다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

alter table trip.items
  add column if not exists parent_id uuid references trip.items(id) on delete cascade;

comment on column trip.items.parent_id is
  '같은 장소의 추가 결제. null=장소 줄. 부모가 지워지면 함께 지워진다(cascade)';

-- 부모를 찾아 자식을 모으는 조회가 화면마다 돈다
create index if not exists items_parent_idx on trip.items(parent_id);

-- ★자식의 자식은 막는다. 한 겹이면 화면도 계산도 단순한데, 두 겹을 허용하는 순간
--   '이 결제의 결제' 라는 뜻 없는 것이 생기고 합계가 조용히 두 번 세어질 길이 열린다.
create or replace function trip.items_one_level()
returns trigger language plpgsql
security definer set search_path = trip, public as $$
begin
  if new.parent_id is not null then
    if exists (select 1 from trip.items p
               where p.id = new.parent_id and p.parent_id is not null) then
      raise exception '결제 줄에 또 결제를 붙일 수 없습니다 (한 겹까지).';
    end if;
    -- 부모와 다른 여행에 붙는 것도 막는다 — 붙으면 합계가 남의 여행으로 샌다
    if exists (select 1 from trip.items p
               where p.id = new.parent_id and p.trip_id <> new.trip_id) then
      raise exception '다른 여행의 장소에는 붙일 수 없습니다.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists items_one_level_trg on trip.items;
create trigger items_one_level_trg
  before insert or update of parent_id, trip_id on trip.items
  for each row execute function trip.items_one_level();
