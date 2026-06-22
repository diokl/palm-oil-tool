-- 월별 소요량 (편집 가능) — 정제사(삼양사/삼양제분)向 원유 소요 등
CREATE TABLE IF NOT EXISTS demand_config (
  id          BIGSERIAL PRIMARY KEY,
  product     TEXT NOT NULL,            -- RPO/RSPO
  month       TEXT NOT NULL,            -- YYYY-MM
  monthly_kg  DOUBLE PRECISION DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (product, month)
);
-- 일별 미세조정 — 특정일 소진 가감 (정제사 이송 / 롯데웰푸드 판매 / 기타)
CREATE TABLE IF NOT EXISTS daily_adjustments (
  id          BIGSERIAL PRIMARY KEY,
  date        TEXT NOT NULL,            -- YYYY-MM-DD
  product     TEXT NOT NULL,            -- RPO/RSPO
  delta_kg    DOUBLE PRECISION,         -- +추가소진(이송/판매) / -소진감소(롯데 제품구매로 자체소비↓)
  label       TEXT,                     -- 정제사이송/롯데웰푸드/판매/기타
  note        TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demand_cfg ON demand_config(product, month);
CREATE INDEX IF NOT EXISTS idx_daily_adj ON daily_adjustments(date, product);
