-- ============================================================
-- inflection_points 테이블 신설 — 가격 변곡점 추적
-- Supabase SQL Editor에서 실행
--
-- 배경: 엑셀 RAW!AQ109:AV125 영역에 수집되던 변곡점 데이터를 DB화.
--       각 선적월의 박스권 분석/요약 보고서에서 자동 참조됨.
--
-- 데이터 구조 (엑셀 컬럼 매핑):
--   AQ(날짜)    -> date
--   AR(가격)    -> price_usd
--   AS(BMD±)    -> bmd_change  (자동: prev_price_myr 차이 / 수동 override 가능)
--   AT(주요뉴스) -> news_summary
--   AU(시황)    -> sentiment  (자동: 전일대비 등락률 IF 분류 / 수동 override 가능)
--   AV(비고)    -> note
-- ============================================================

CREATE TABLE IF NOT EXISTS inflection_points (
  id              BIGSERIAL PRIMARY KEY,
  date            TEXT NOT NULL,              -- YYYY-MM-DD
  contract_month  TEXT NOT NULL,              -- YYYY-MM (해당 선적월)
  price_usd       DOUBLE PRECISION NOT NULL,  -- 해당일 종가 USD/MT
  prev_price_usd  DOUBLE PRECISION,           -- 전일 종가 (자동 조회)
  change_pct      DOUBLE PRECISION,           -- (price - prev) / prev * 100 (%)
  bmd_change      TEXT,                       -- 예: '+85/+82' (오전/오후) 또는 자동 산출 MYR 차이
  news_summary    TEXT,                       -- 주요 뉴스 / 이슈
  sentiment       TEXT CHECK (sentiment IN ('강세', '보합', '약세', '급락') OR sentiment IS NULL),
  note            TEXT,                       -- 비고 (예: '▲▲ 미-중 무역합의')
  is_manual_sentiment SMALLINT DEFAULT 0,     -- 1: 사용자가 수동 override, 0: 자동 산출
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  created_by      TEXT,
  UNIQUE (date, contract_month)
);

CREATE INDEX IF NOT EXISTS idx_inflection_date ON inflection_points(date DESC);
CREATE INDEX IF NOT EXISTS idx_inflection_month ON inflection_points(contract_month);
CREATE INDEX IF NOT EXISTS idx_inflection_sentiment ON inflection_points(sentiment);

-- ============================================================
-- 적용 후 확인 쿼리
--   SELECT date, contract_month, price_usd, change_pct, sentiment, note
--   FROM inflection_points ORDER BY date DESC LIMIT 20;
-- ============================================================
