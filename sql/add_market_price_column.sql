-- ============================================================
-- purchases 테이블에 건별 시황가 + 건별 환율 컬럼 추가
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1) 건별 시황가 컬럼 추가
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS market_price_usd DOUBLE PRECISION;

-- 2) 건별 환율 컬럼 추가 (기본값 1450)
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS exchange_rate DOUBLE PRECISION DEFAULT 1450;

-- 3) 기존 prebuy_market_prices에서 건별로 옮겨오기 (마이그레이션)
--    각 구매건에 해당 선적월의 시황가를 복사
UPDATE purchases p
SET market_price_usd = mp.market_price
FROM prebuy_market_prices mp
WHERE p.shipment_month = mp.shipment_month
  AND p.market_price_usd IS NULL;

-- 참고: prebuy_market_prices 테이블은 남겨두되,
-- 향후 건별 시황가로 완전 전환되면 삭제 가능
