import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'palm-oil-session';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check',
  '/api/auth/register',
  '/api/news/ingest', // 북마클릿 크로스오리진 인제스트 — 자체 토큰 인증 + CORS
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

// Lightweight token validation for edge runtime
// Token format: base64(userId:role:canWrite:expiry:signature)
function parseToken(token: string): { valid: boolean; userId?: string; role?: string; canWrite?: boolean } {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    // New format: 5 parts (userId:role:canWrite:expiry:signature)
    if (parts.length === 5) {
      const expiry = parseInt(parts[3]);
      if (Date.now() >= expiry) return { valid: false };
      return { valid: true, userId: parts[0], role: parts[1], canWrite: parts[2] === '1' };
    }
    // Legacy format: 3 parts (userId:expiry:signature)
    if (parts.length === 3) {
      const expiry = parseInt(parts[1]);
      if (Date.now() >= expiry) return { valid: false };
      return { valid: true, userId: parts[0], role: 'master', canWrite: true };
    }
    return { valid: false };
  } catch {
    return { valid: false };
  }
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check session cookie
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (!token) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  const parsed = parseToken(token);

  if (!parsed.valid) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Admin API routes require master role
  if (pathname.startsWith('/api/admin/') && parsed.role !== 'master') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Pass user info via headers for API routes
  const response = NextResponse.next();
  response.headers.set('x-user-id', parsed.userId || '');
  response.headers.set('x-user-role', parsed.role || 'user');
  response.headers.set('x-user-can-write', parsed.canWrite ? '1' : '0');

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
