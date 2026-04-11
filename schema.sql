-- Palm Oil Tool — Supabase (PostgreSQL) schema
-- Run this once in Supabase SQL Editor after creating the project.
-- Matches the original SQLite schema (Turso) with Postgres equivalents:
--   AUTOINCREMENT          -> BIGSERIAL
--   REAL                   -> DOUBLE PRECISION
--   TEXT DEFAULT datetime  -> TIMESTAMPTZ DEFAULT NOW()
--   INTEGER (boolean flag) -> SMALLINT (kept as 0/1 for drop-in compatibility)
-- Column order and nullability mirror the original tables so that the
-- application code runs unchanged.

CREATE TABLE IF NOT EXISTS fcpo_settlement (
  id              BIGSERIAL PRIMARY KEY,
  date            TEXT NOT NULL,
  contract_month  TEXT NOT NULL,
  settlement_myr  DOUBLE PRECISION,
  settlement_usd  DOUBLE PRECISION,
  exchange_rate   DOUBLE PRECISION,
  source          TEXT DEFAULT 'manual',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (date, contract_month)
);

CREATE TABLE IF NOT EXISTS inventory (
  id              BIGSERIAL PRIMARY KEY,
  product         TEXT NOT NULL CHECK (product IN ('RBD', 'RSPO')),
  year            INTEGER NOT NULL,
  month           INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  expected_usage  DOUBLE PRECISION,
  customs_volume  DOUBLE PRECISION,
  ending_stock    DOUBLE PRECISION,
  coverage_days   DOUBLE PRECISION,
  contract_price  TEXT,
  contract_date   TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_by      TEXT,
  UNIQUE (product, year, month)
);

CREATE TABLE IF NOT EXISTS purchases (
  id                BIGSERIAL PRIMARY KEY,
  shipment_month    TEXT NOT NULL,
  contract_date     TEXT,
  contract_price    DOUBLE PRECISION,
  quantity_mt       DOUBLE PRECISION,
  supplier          TEXT,
  market_price      DOUBLE PRECISION,
  price_diff        DOUBLE PRECISION,
  prebuy_effect_krw DOUBLE PRECISION,
  evaluation        TEXT CHECK (evaluation IN ('성공', '실패') OR evaluation IS NULL),
  product           TEXT DEFAULT 'RBD',
  notes             TEXT,
  -- Extended columns (previously added via runtime ALTER TABLE)
  incoterms         TEXT,
  payment_terms     TEXT,
  loading_port      TEXT,
  discharge_port    TEXT,
  contract_number   TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS news (
  id            BIGSERIAL PRIMARY KEY,
  date          TEXT NOT NULL,
  content       TEXT NOT NULL,
  full_content  TEXT,
  sentiment     TEXT CHECK (sentiment IN ('강세', '약세', '보합') OR sentiment IS NULL),
  impact        TEXT CHECK (impact IN ('High', 'Medium', 'Low') OR impact IS NULL),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  created_by    TEXT
);

CREATE TABLE IF NOT EXISTS analyses (
  id             BIGSERIAL PRIMARY KEY,
  analysis_type  TEXT DEFAULT 'market',
  input_data     TEXT,
  result         TEXT,
  model          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id                    BIGSERIAL PRIMARY KEY,
  product               TEXT NOT NULL,
  alert_level           TEXT NOT NULL CHECK (alert_level IN ('critical', 'warning', 'normal')),
  depletion_month       TEXT,
  required_volume       DOUBLE PRECISION,
  recommended_shipment  TEXT,
  current_price         DOUBLE PRECISION,
  box_range_zone        TEXT,
  message               TEXT,
  action_taken          TEXT,
  is_active             SMALLINT DEFAULT 1,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS edit_log (
  id          BIGSERIAL PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   INTEGER,
  field_name  TEXT,
  old_value   TEXT,
  new_value   TEXT,
  edited_by   TEXT,
  edited_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes (same names and definitions as the original SQLite schema)
CREATE INDEX IF NOT EXISTS idx_fcpo_date         ON fcpo_settlement(date);
CREATE INDEX IF NOT EXISTS idx_fcpo_month        ON fcpo_settlement(contract_month);
CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product, year, month);
CREATE INDEX IF NOT EXISTS idx_news_date         ON news(date DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_active     ON alerts(is_active, created_at DESC);
