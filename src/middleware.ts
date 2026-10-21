import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE_NAME = 'palm-oil-session';
// lib/auth.ts 와 같은 비밀키·기본값 (Vercel 에는 SESSION_SECRET 설정됨)
const SECRET = process.env.SESSION_SECRET || 'fallback-dev-secret-change-me';

// Paths that don't require authentication
const PUBLIC_PATHS = [
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check',
  '/api/auth/register',
  '/api/news/ingest', // 북마클릿 크로스오리진 인제스트 — 자체 토큰 인증 + CORS
  '/api/cron/',       // Vercel Cron 호출 — 라우트 내부에서 CRON_SECRET 검증
  '/_next',
  '/favicon.ico',
];

// 쓰기 권한 없이도 허용하는 POST — DB 를 바꾸지 않는 조회·파싱·생성 (분석 로그 INSERT 만 하는 analyze 포함)
const READ_ONLY_POSTS = [
  '/api/analyze',
  '/api/bmd/parse-pdf',
  '/api/doc-verify',
  '/api/lc/generate',
  '/api/lc/export-xml',
  '/api/purchases/upload',
];

// 마스터만: 관리자 API, 데이터 전체 초기화(seed) 라우트
const MASTER_ONLY = ['/api/admin/', '/api/purchases/seed', '/api/mpob/seed', '/api/init'];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(p => pathname.startsWith(p));
}

// ── 세션 토큰 검증 (lib/auth.ts verifySessionToken 과 동일 규칙, Web Crypto 사용) ──
// Token: base64(userId:role:canWrite:expiry:hmacSha256Hex(userId:role:canWrite:expiry))
// (이전: 서명을 확인하지 않아 base64 로 만든 위조 쿠키로 마스터 권한 획득 가능, 만료값이 숫자가 아니면 영구 유효,
//  3필드 레거시 형식은 무조건 master 로 통과 — 모두 제거)
let keyPromise: Promise<CryptoKey> | null = null;
function hmacKey(): Promise<CryptoKey> {
  keyPromise ??= crypto.subtle.importKey(
    'raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return keyPromise;
}

async function hmacHex(payload: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function verifyToken(token: string): Promise<{ valid: boolean; userId?: string; role?: string; canWrite?: boolean }> {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf-8');
    const parts = decoded.split(':');
    if (parts.length !== 5) return { valid: false };
    const [userId, role, canWriteStr, expiryStr, signature] = parts;
    const expiry = Number(expiryStr);
    if (!Number.isFinite(expiry) || Date.now() >= expiry) return { valid: false };
    const expected = await hmacHex(`${userId}:${role}:${canWriteStr}:${expiryStr}`);
    if (!safeEqual(signature, expected)) return { valid: false };
    return { valid: true, userId, role, canWrite: canWriteStr === '1' };
  } catch {
    return { valid: false };
  }
}

function unauthorized(request: NextRequest, pathname: string) {
  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('from', pathname);
  return NextResponse.redirect(loginUrl);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public paths
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return unauthorized(request, pathname);

  const parsed = await verifyToken(token);
  if (!parsed.valid) return unauthorized(request, pathname);

  if (pathname.startsWith('/api/')) {
    // 마스터 전용 경로
    if (MASTER_ONLY.some(p => pathname.startsWith(p)) && parsed.role !== 'master') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    // 쓰기 권한: 변경 요청은 canWrite 사용자만 (조회성 POST 는 예외)
    const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutating && !parsed.canWrite && !READ_ONLY_POSTS.includes(pathname)) {
      return NextResponse.json({ error: '쓰기 권한이 없습니다. 관리자에게 권한을 요청하세요.' }, { status: 403 });
    }
  }

  // 검증된 사용자 정보를 라우트로 전달 (요청 헤더 — 클라이언트가 보낸 같은 이름의 헤더는 덮어씀)
  const headers = new Headers(request.headers);
  headers.set('x-user-id', parsed.userId || '');
  headers.set('x-user-role', parsed.role || 'user');
  headers.set('x-user-can-write', parsed.canWrite ? '1' : '0');
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
