-- ============================================================
-- market_data — 매크로/에너지/환율 일별 시계열 (자동 수집)
--   series: 'USDMYR' | 'USDKRW' | 'USDCNY' (환율, 1 USD 당) | 'BRENT' (USD/bbl) | 'HEATING_OIL' (USD/gal)
--   대두유(SBO)는 기존 oil_prices 테이블에 source='yahoo_auto' 로 저장
-- Supabase SQL Editor 또는 scripts/apply-market-data-schema.mjs 로 실행
-- ============================================================
CREATE TABLE IF NOT EXISTS market_data (
  id          BIGSERIAL PRIMARY KEY,
  series      TEXT NOT NULL,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD
  value       DOUBLE PRECISION NOT NULL,
  source      TEXT DEFAULT 'auto',
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (series, date)
);
CREATE INDEX IF NOT EXISTS idx_market_data_series_date ON market_data(series, date DESC);
