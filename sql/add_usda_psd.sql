-- USDA FAS PSD 국가별 수급 (팜유·대두유). 단위 1000 MT. 월 1회 갱신 (USDA_API_KEY 필요)
CREATE TABLE IF NOT EXISTS usda_psd (
  id           BIGSERIAL PRIMARY KEY,
  commodity    TEXT NOT NULL,        -- 'PALM' | 'SOY_OIL'
  country      TEXT NOT NULL,        -- USDA 국가코드 (CH, IN, ID, MY, E4, US ...)
  market_year  INTEGER NOT NULL,
  attribute    TEXT NOT NULL,        -- beginning_stocks | production | imports | exports | domestic_consumption | ending_stocks | total_supply
  value        DOUBLE PRECISION,
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (commodity, country, market_year, attribute)
);
