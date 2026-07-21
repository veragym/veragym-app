-- sales_forecasts: 관리자(is_admin)가 모든 트레이너의 예상매출을 수정/추가할 수 있도록 RLS 확장
-- 기존: SELECT/DELETE 정책엔 admin 예외가 있으나 UPDATE/INSERT는 "본인 행"으로만 제한되어
--       관리자가 워크인 등 타 트레이너 내역을 첨삭할 수 없었음.
-- 변경: UPDATE/INSERT 정책에도 admin OR 예외 추가. (예상매출은 실제 결제와 미연동인 자유 입력 데이터)

drop policy if exists sales_forecasts_update on sales_forecasts;
create policy sales_forecasts_update on sales_forecasts
for update using (
  trainer_id = (select trainers.id from trainers where trainers.auth_id = (select auth.uid()) limit 1)
  or exists (select 1 from trainers where trainers.auth_id = (select auth.uid()) and trainers.is_admin = true)
);

drop policy if exists sales_forecasts_insert on sales_forecasts;
create policy sales_forecasts_insert on sales_forecasts
for insert with check (
  trainer_id = (select trainers.id from trainers where trainers.auth_id = (select auth.uid()) limit 1)
  or exists (select 1 from trainers where trainers.auth_id = (select auth.uid()) and trainers.is_admin = true)
);
