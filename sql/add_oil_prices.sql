-- ============================================================
-- oil_prices — 식물유 가격 비교 / 팜유-대두유 스프레드용
-- Supabase SQL Editor에서 실행
--
-- 팜유(CPO)는 fcpo_settlement에서 가져오고, 여기엔 대두유 등 경쟁 식물유를 저장.
-- price_native = 입력 원값 (대두유 CBOT는 cents/lb), price_usd_mt = USD/MT 정규화.
-- ============================================================

CREATE TABLE IF NOT EXISTS oil_prices (
  id            BIGSERIAL PRIMARY KEY,
  date          TEXT NOT NULL,                 -- YYYY-MM-DD
  commodity     TEXT NOT NULL,                 -- 'SBO'(대두유) / 'SUN'(해바라기) / 'RAPE'(유채) / 'CPO'(팜유 현물)
  price_native  DOUBLE PRECISION,              -- 입력 원값
  unit_native   TEXT DEFAULT 'cents/lb',       -- 'cents/lb' | 'USD/MT'
  price_usd_mt  DOUBLE PRECISION,              -- USD/MT 정규화 (스프레드·비교용)
  source        TEXT DEFAULT 'manual',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date, commodity)
);

CREATE INDEX IF NOT EXISTS idx_oil_prices_date ON oil_prices(date DESC);
CREATE INDEX IF NOT EXISTS idx_oil_prices_commodity ON oil_prices(commodity, date DESC);
