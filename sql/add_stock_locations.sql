-- 위치(창고)별 재고 — 탱크터미널/외부보관/공장 분산 재고 관리
-- 총 가용재고 = Σ 모든 위치
CREATE TABLE IF NOT EXISTS stock_locations (
  id          BIGSERIAL PRIMARY KEY,
  location    TEXT NOT NULL,                 -- 탱크터미널/삼양제분/삼양사/원주/익산/밀양
  product     TEXT NOT NULL,                 -- 'RPO'(정제팜유) | 'RSPO'
  qty_kg      DOUBLE PRECISION DEFAULT 0,
  as_of_date  TEXT,
  sort_order  INTEGER DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (location, product)
);
CREATE INDEX IF NOT EXISTS idx_stock_loc ON stock_locations(product, sort_order);
