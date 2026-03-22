import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'palm-oil-session';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check',
  '/_next',
  '/favicon.ico',
];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

// Lightweight token validation (just check structure + expiry, no crypto in edge runtime)
function isTokenValid(token: string): boolean {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 3) return false;
    const expiry = parseInt(parts[1]);
    return Date.now() < expiry;
  } catch {
    return false;
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

  if (!token || !isTokenValid(token)) {
    // For API routes, return 401
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // For page routes, redirect to login
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    // Match all paths except static files
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
