-- ============================================================
-- 사용자 관리 테이블 (인증 + 역할 + 이용약관 동의)
-- Supabase SQL Editor에서 실행
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  salt          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('master', 'user')),
  can_write     BOOLEAN NOT NULL DEFAULT FALSE,
  terms_agreed  BOOLEAN NOT NULL DEFAULT FALSE,
  terms_agreed_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Seed master account: samyang / (same as ADMIN_PW env var)
-- Password will be set on first login via the app.
-- We insert a placeholder that the app will update.
-- The app checks env ADMIN_ID/ADMIN_PW for the master account on login.

CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
