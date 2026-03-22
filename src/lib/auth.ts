import crypto from 'crypto';

const SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret-change-me';
const ADMIN_ID = process.env.ADMIN_ID || 'admin';
const ADMIN_PW = process.env.ADMIN_PW || 'admin123';

// Token format: base64(userId:expiry:signature)
export function createSessionToken(userId: string, expiresInHours: number = 24 * 7): string {
  const expiry = Date.now() + expiresInHours * 60 * 60 * 1000;
  const payload = `${userId}:${expiry}`;
  const signature = crypto
    .createHmac('sha256', SECRET)
    .update(payload)
    .digest('hex');
  return Buffer.from(`${payload}:${signature}`).toString('base64');
}

export function verifySessionToken(token: string): { valid: boolean; userId?: string } {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return { valid: false };

    const [userId, expiryStr, signature] = parts;
    const expiry = parseInt(expiryStr);

    // Check expiry
    if (Date.now() > expiry) return { valid: false };

    // Verify signature
    const payload = `${userId}:${expiryStr}`;
    const expectedSig = crypto
      .createHmac('sha256', SECRET)
      .update(payload)
      .digest('hex');

    if (signature !== expectedSig) return { valid: false };

    return { valid: true, userId };
  } catch {
    return { valid: false };
  }
}

export function validateCredentials(id: string, password: string): boolean {
  return id === ADMIN_ID && password === ADMIN_PW;
}

export const SESSION_COOKIE_NAME = 'palm-oil-session';
