-- ============================================================
-- 구매 이력 V2 스키마 (기존 purchases 테이블 대체)
-- Supabase SQL Editor에서 실행
-- ============================================================

-- 1) 기존 purchases 테이블 백업 후 삭제
DROP TABLE IF EXISTS purchases_old;
ALTER TABLE IF EXISTS purchases RENAME TO purchases_old;

-- 2) 신규 purchases 테이블 (구매현황 RAW 기반)
CREATE TABLE purchases (
  id                BIGSERIAL PRIMARY KEY,
  order_no          TEXT,
  product           TEXT NOT NULL CHECK (product IN ('RBD', 'RSPO')),
  shipment_month    TEXT NOT NULL,          -- YYYY-MM
  supplier          TEXT,
  manufacturer      TEXT,
  product_name      TEXT,
  unit_price        DOUBLE PRECISION,       -- USD/MT
  qty_mt            DOUBLE PRECISION,       -- MT
  amount_usd        DOUBLE PRECISION,       -- USD
  incoterms         TEXT,
  payment_terms     TEXT,
  etd               TEXT,                   -- YYYY-MM-DD
  contract_number   TEXT,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 3) 선구매 시황가 테이블 (선적월별 정상구매가격 + 환율)
CREATE TABLE IF NOT EXISTS prebuy_market_prices (
  id                BIGSERIAL PRIMARY KEY,
  shipment_month    TEXT NOT NULL UNIQUE,    -- YYYY-MM
  market_price      DOUBLE PRECISION,       -- USD/MT (선적월 도래 시 시황가)
  exchange_rate     DOUBLE PRECISION DEFAULT 1450,  -- KRW/USD
  source            TEXT DEFAULT 'manual',  -- 'manual' | 'fcpo_auto'
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_purchases_shipment ON purchases(shipment_month);
CREATE INDEX IF NOT EXISTS idx_purchases_product ON purchases(product);
