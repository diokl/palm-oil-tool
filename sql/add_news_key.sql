-- 핵심 이슈 핀 — 대시보드 상단에 강조 표시할 중요 뉴스
ALTER TABLE news ADD COLUMN IF NOT EXISTS is_key SMALLINT DEFAULT 0;
