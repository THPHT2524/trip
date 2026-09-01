-- settle.sql — 결제 방식 한 칸. 현금 지갑을 세기 위한 것이다.
-- ──────────────────────────────────────────────────────────────────────────
-- 왜 필요한가: 정산은 원화로 하는데, 돈이 원화에서 현지통화로 건너오는 길이 둘이다.
--   ① 카드로 긁는다        → 그날 전신환매도율로 청구된다
--   ② 환전하거나 출금한다  → 그 순간 원화가 빠지고 현지통화 현금이 생긴다
--                            그 현금으로 산 것은 **그 환율**로 계산해야 맞다
-- 트래블로그처럼 현지 ATM 에서 그때그때 뽑는 경우도 ②다(원화가 빠지고 엔이 나온다).
--
-- 그래서 줄마다 셋 중 하나다:
--   settle = null        카드 (기본)
--   settle = 'cash'      현금 결제 — 지갑에서 빠진다
--   settle = 'exchange'  환전·출금 — 지갑에 들어온다. **지출이 아니다**(옮긴 것뿐이라 합계에서 뺀다)
--
-- ★환전 줄은 새 칸을 만들지 않고 있는 칸을 쓴다:
--     cost     = 받은 현지통화 금액   (예: 50000 JPY)
--     cost_cur = 현지통화
--     fx       = 실제 환율(1단위당 원) (예: 9.4)  → 낸 원화 = cost * fx = 470,000
--   화면에서는 '받은 금액'과 '낸 원화'를 받아 fx 를 대신 계산해 준다.
--
-- 멱등하다. 여러 번 실행해도 안전하다.

alter table trip.items
  add column if not exists settle text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'trip.items'::regclass and conname = 'items_settle_chk'
  ) then
    alter table trip.items
      add constraint items_settle_chk
      check (settle is null or settle in ('cash', 'exchange'));
  end if;
end $$;

-- 환전 줄은 금액과 환율이 **둘 다** 있어야 뜻이 선다.
-- (하나만 있으면 지갑에 얼마가 들어왔는지·얼마를 냈는지 중 하나를 모른다)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'trip.items'::regclass and conname = 'items_exchange_chk'
  ) then
    alter table trip.items
      add constraint items_exchange_chk
      check (settle <> 'exchange' or (cost is not null and fx is not null));
  end if;
end $$;

comment on column trip.items.settle is
  'null=카드 · cash=현금(지갑에서 차감) · exchange=환전·출금(지갑에 입금, 지출 아님)';

-- ── 단가 × 갯수 ───────────────────────────────────────────────────────────
-- ★cost 는 **총액 그대로** 둔다(단가로 바꾸면 기존 줄과 모든 계산이 한꺼번에 뜻이 바뀐다).
--   qty 는 '몇 개였나' 만 기억한다. 단가는 cost / qty 로 되낸다.
--   qty 가 없으면 1개 — 지금까지 넣은 줄은 손댈 것이 없다.
alter table trip.items
  add column if not exists qty numeric;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'trip.items'::regclass and conname = 'items_qty_chk') then
    alter table trip.items add constraint items_qty_chk check (qty is null or qty > 0);
  end if;
end $$;

comment on column trip.items.qty is '갯수. cost 는 총액이고 단가는 cost/qty 다. null=1개';

-- ── 각자 냄 ───────────────────────────────────────────────────────────────
-- ★교통카드처럼 **각자 자기 걸로 찍는** 경우가 있다. payer_id 는 한 사람만 담으므로
--   그런 줄은 담을 수가 없었다. split=true 면 '누가 냈나' 에서 동행자 수로 나눠 붙인다.
--   (payer_id 와 함께 쓰지 않는다 — 한 사람이 냈든 나눠 냈든 둘 중 하나다)
alter table trip.items
  add column if not exists split boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'trip.items'::regclass and conname = 'items_split_chk') then
    alter table trip.items add constraint items_split_chk check (not split or payer_id is null);
  end if;
end $$;

comment on column trip.items.split is '각자 냄(더치). true 면 payer_id 는 비어 있고 동행자 수로 나눈다';
