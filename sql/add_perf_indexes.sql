-- 조회 성능 인덱스 (대시보드·박스권·월물곡선·수급 분석이 fcpo_settlement 를 월물/날짜로 반복 조회)
CREATE INDEX IF NOT EXISTS idx_fcpo_contract_date ON fcpo_settlement(contract_month, date);
CREATE INDEX IF NOT EXISTS idx_fcpo_date ON fcpo_settlement(date DESC);
CREATE INDEX IF NOT EXISTS idx_mpob_cat_item ON mpob_data(category, item_name, year, month);
CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active);
CREATE INDEX IF NOT EXISTS idx_news_date ON news(date DESC);
ANALYZE fcpo_settlement; ANALYZE inventory; ANALYZE purchases; ANALYZE market_data;
