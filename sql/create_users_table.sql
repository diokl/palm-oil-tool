-- ============================================================
-- 사용자 관리 테이블 (인증 + 역할 + 이용약관 동의 + 관리자 승인)
-- Supabase SQL Editor에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id              BIGSERIAL PRIMARY KEY,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  salt            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('master', 'user')),
  can_write       BOOLEAN NOT NULL DEFAULT FALSE,
  approved        BOOLEAN NOT NULL DEFAULT FALSE,
  terms_agreed    BOOLEAN NOT NULL DEFAULT FALSE,
  terms_agreed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 이미 테이블이 있는 경우 컬럼 추가
ALTER TABLE users ADD COLUMN IF NOT EXISTS approved BOOLEAN NOT NULL DEFAULT FALSE;

-- 마스터 계정은 자동 승인
UPDATE users SET approved = TRUE WHERE role = 'master';

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_approved ON users(approved);
