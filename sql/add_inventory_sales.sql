-- ============================================================
-- inventory.sales_volume — 외부 판매량 (재고 출고)
-- Supabase SQL Editor에서 실행
--
-- 배경: 잔여재고를 외부에 판매(소진)하는 경우가 있음 (예: 26.6월 RBD 4,000톤 외부판매).
--       기존 재고식 (기말 = 이전월기말 + 통관 - 소요) 에 판매 출고를 더한다:
--       기말재고 = 이전월기말 + 통관수량 - 예상소요량 - 판매량
-- ============================================================

ALTER TABLE inventory ADD COLUMN IF NOT EXISTS sales_volume DOUBLE PRECISION DEFAULT 0;
