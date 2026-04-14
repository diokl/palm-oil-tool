import crypto from 'crypto';
import { dbGet, dbRun } from './db';

const SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret-change-me';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PW = process.env.ADMIN_PW || 'admin123';

export const SESSION_COOKIE_NAME = 'palm-oil-session';
export const DEFAULT_RESET_PASSWORD = 'samyang789987!!!';

// ── Password hashing (PBKDF2, no external deps) ──
function hashPassword(password: string, salt: string): string {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
}

function generateSalt(): string {
  return crypto.randomBytes(32).toString('hex');
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const computed = hashPassword(password, salt);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hash));
}

// ── Token: base64(userId:role:canWrite:expiry:signature) ──
export function createSessionToken(
  userId: string,
  role: string = 'user',
  canWrite: boolean = false,
  expiresInHours: number = 24 * 7
): string {
  const expiry = Date.now() + expiresInHours * 60 * 60 * 1000;
  const payload = `${userId}:${role}:${canWrite ? '1' : '0'}:${expiry}`;
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

export interface TokenPayload {
  valid: boolean;
  userId?: string;
  role?: string;
  canWrite?: boolean;
}

export function verifySessionToken(token: string): TokenPayload {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 5) return { valid: false };

    const [userId, role, canWriteStr, expiryStr, signature] = parts;
    const expiry = parseInt(expiryStr);

    if (Date.now() > expiry) return { valid: false };

    const payload = `${userId}:${role}:${canWriteStr}:${expiryStr}`;
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSig) return { valid: false };

    return { valid: true, userId, role, canWrite: canWriteStr === '1' };
  } catch {
    return { valid: false };
  }
}

// ── DB-based credential validation ──
// Master account: check env vars first, auto-create/update DB record
// Regular users: check DB
export type ValidationResult =
  | { valid: true; role: string; canWrite: boolean; termsAgreed: boolean }
  | { valid: false; reason: 'invalid' | 'pending_approval' };

export async function validateCredentials(
  id: string,
  password: string
): Promise<ValidationResult> {
  // Master account via env vars (always auto-approved)
  if (id === ADMIN_ID && password === ADMIN_PW) {
    const existing = await dbGet('SELECT * FROM users WHERE username = ?', [ADMIN_ID]);
    if (!existing) {
      const salt = generateSalt();
      const hash = hashPassword(ADMIN_PW, salt);
      try {
        await dbRun(
          `INSERT INTO users (username, password_hash, salt, role, can_write, approved, terms_agreed, terms_agreed_at)
           VALUES (?, ?, ?, 'master', TRUE, TRUE, TRUE, NOW())`,
          [ADMIN_ID, hash, salt]
        );
      } catch (e: any) {
        console.warn('Master user auto-create skipped:', e.message);
      }
    } else if (!existing.approved) {
      // Ensure master is always approved (in case of old DB)
      await dbRun('UPDATE users SET approved = TRUE WHERE username = ?', [ADMIN_ID]);
    }
    return { valid: true, role: 'master', canWrite: true, termsAgreed: true };
  }

  // DB-based check for regular users
  const user = await dbGet('SELECT * FROM users WHERE username = ?', [id]);
  if (!user) return { valid: false, reason: 'invalid' };

  const isValidPassword = verifyPassword(password, user.password_hash, user.salt);
  if (!isValidPassword) return { valid: false, reason: 'invalid' };

  // Check approval status (masters are always approved)
  if (!user.approved && user.role !== 'master') {
    return { valid: false, reason: 'pending_approval' };
  }

  return {
    valid: true,
    role: user.role,
    canWrite: user.can_write,
    termsAgreed: user.terms_agreed,
  };
}

// ── User registration ──
export async function registerUser(
  username: string,
  password: string
): Promise<{ success: boolean; error?: string }> {
  // Check reserved username
  if (username === ADMIN_ID) {
    return { success: false, error: '사용할 수 없는 아이디입니다' };
  }

  // Check if exists
  const existing = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
  if (existing) {
    return { success: false, error: '이미 존재하는 아이디입니다' };
  }

  const salt = generateSalt();
  const hash = hashPassword(password, salt);

  await dbRun(
    `INSERT INTO users (username, password_hash, salt, role, can_write, terms_agreed)
     VALUES (?, ?, ?, 'user', FALSE, FALSE)`,
    [username, hash, salt]
  );

  return { success: true };
}

// ── Reset password ──
export async function resetUserPassword(userId: number, newPassword?: string): Promise<void> {
  const pw = newPassword || DEFAULT_RESET_PASSWORD;
  const salt = generateSalt();
  const hash = hashPassword(pw, salt);
  await dbRun('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?', [hash, salt, userId]);
}

// ── Agree to terms ──
export async function agreeToTerms(username: string): Promise<void> {
  await dbRun(
    'UPDATE users SET terms_agreed = TRUE, terms_agreed_at = NOW() WHERE username = ?',
    [username]
  );
}
