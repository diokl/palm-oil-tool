-- MPOB Data Table
CREATE TABLE IF NOT EXISTS mpob_data (
  id SERIAL PRIMARY KEY,
  category TEXT NOT NULL,          -- 'stock' | 'production' | 'export_port' | 'export_product'
  item_name TEXT NOT NULL,         -- e.g. 'RBD PALM OIL', 'PORT KLANG', 'CPO'
  year INTEGER NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  value NUMERIC,                   -- tonnes (all categories)
  value_rm NUMERIC,                -- RM Mil (export_product only, NULL for others)
  parent_group TEXT,               -- port grouping: 'PEN. MALAYSIA', 'SABAH/SARAWAK', 'MALAYSIA'
  sort_order INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(category, item_name, year, month)
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_mpob_category_year ON mpob_data(category, year);
CREATE INDEX IF NOT EXISTS idx_mpob_lookup ON mpob_data(category, item_name, year);
