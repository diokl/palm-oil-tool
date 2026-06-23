-- 관리팜유 매입 추천 계획 파라미터 (key/value)
-- Supabase SQL Editor에서 1회 실행.
--   july_cap_kg     : 7월선적 선적스페이스 한도 (kg, 기본 6,000,000 = 6,000톤)
--   committed_kg    : 기확보 관리팜유 (kg, 기본 7,500,000 = 7,500톤)
--   coverage_months : 목표 선행소요 개월수 (기본 3)
--   lead_months     : 선적→가용 리드타임 개월 (기본 1, 7월선적→8월 가용)
CREATE TABLE IF NOT EXISTS mgd_config (
  key         TEXT PRIMARY KEY,
  value       DOUBLE PRECISION NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO mgd_config (key, value) VALUES
  ('july_cap_kg', 6000000),
  ('committed_kg', 7500000),
  ('coverage_months', 3),
  ('lead_months', 1)
ON CONFLICT (key) DO NOTHING;
