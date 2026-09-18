import { NextRequest, NextResponse } from 'next/server';
import { runMarketDataSync } from '@/lib/market-data';

// 일별 매크로 자동 수집 (Vercel Cron → GET). vercel.json: 매일 22:30 UTC = 07:30 KST (미국 장 마감 후)
// 인증: Authorization: Bearer ${CRON_SECRET} 또는 ?token=
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if ((request.headers.get('authorization') || '') === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get('token') === secret;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) return NextResponse.json({ error: 'CRON_SECRET 환경변수가 설정되지 않았습니다' }, { status: 500 });
  if (!authorized(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const startedAt = new Date().toISOString();
  try {
    const result = await runMarketDataSync(14);
    console.log(`[cron market-data] ${startedAt} ${result.message}`);
    return NextResponse.json({ success: true, started_at: startedAt, ...result });
  } catch (error: any) {
    console.error(`[cron market-data] ${startedAt} failed: ${error.message}`);
    return NextResponse.json({ success: false, started_at: startedAt, error: error.message }, { status: 500 });
  }
}
