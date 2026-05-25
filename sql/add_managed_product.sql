-- ============================================================
-- inventory.product CHECK 제약 확장: 'MANAGED' (3-MCPD+GE+RSPO 관리팜유) 추가
-- Supabase SQL Editor에서 실행
--
-- 배경: 26년 7월부터 통관 시작하는 관리팜유(3-MCPD+GE+RSPO)는
--       기존 RBD/RSPO와 별도 SCM 트랙으로 관리해야 함.
--       엑셀 RAW!CB382:CN390 영역의 데이터를 DB에 입력하기 위한 준비.
-- ============================================================

-- 1) inventory.product CHECK 제약 교체
--    기존: CHECK (product IN ('RBD', 'RSPO'))
--    신규: CHECK (product IN ('RBD', 'RSPO', 'MANAGED'))
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_check;
ALTER TABLE inventory ADD CONSTRAINT inventory_product_check
  CHECK (product IN ('RBD', 'RSPO', 'MANAGED'));

-- 2) purchases.product CHECK 제약도 동일하게 확장
--    관리팜유 구매가 발생하면 purchases 테이블에도 'MANAGED'로 기록되어야 하므로.
ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_product_check;
ALTER TABLE purchases ADD CONSTRAINT purchases_product_check
  CHECK (product IN ('RBD', 'RSPO', 'MANAGED'));

-- 3) 26년 1~12월 MANAGED inventory 행 초기 생성 (예상소요량/통관수량은 NULL로 비워두고 UI에서 입력)
INSERT INTO inventory (product, year, month, updated_by)
SELECT 'MANAGED', 2026, m, 'migration_managed'
FROM generate_series(1, 12) AS m
ON CONFLICT (product, year, month) DO NOTHING;

-- ============================================================
-- 적용 후 확인 쿼리
--   SELECT product, year, month, expected_usage, customs_volume, ending_stock
--   FROM inventory WHERE product = 'MANAGED' ORDER BY year, month;
-- ============================================================
