import { NextRequest, NextResponse } from 'next/server';
import { buildNewsBookmarklet } from '@/lib/news-bookmarklet';

// GET /api/news/bookmarklet → { bookmarklet } — KoreaPDS 뉴스 수집 북마클릿 코드.
// 인제스트 토큰이 들어가므로 로그인(미들웨어) + 쓰기 권한 사용자에게만 준다.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (request.headers.get('x-user-can-write') !== '1') {
    return NextResponse.json({ error: '쓰기 권한이 있는 사용자만 북마클릿을 설치할 수 있습니다' }, { status: 403 });
  }
  const token = process.env.NEWS_INGEST_TOKEN;
  if (!token) {
    return NextResponse.json({ error: 'NEWS_INGEST_TOKEN 이 설정되지 않았습니다' }, { status: 500 });
  }
  // 현재 배포 주소 기준 (운영·프리뷰 모두 자기 인제스트로 보냄)
  const origin = new URL(request.url).origin;
  const ingestUrl = `${origin}/api/news/ingest?token=${encodeURIComponent(token)}`;
  return NextResponse.json({ bookmarklet: buildNewsBookmarklet(ingestUrl) }, { headers: { 'Cache-Control': 'no-store' } });
}
