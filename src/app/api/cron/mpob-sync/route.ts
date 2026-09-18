import { NextRequest, NextResponse } from 'next/server';
import { runMpobSync } from '@/lib/mpob-sync';
import { runUsdaSync, usdaKeyConfigured } from '@/lib/usda-psd';

// 월간 MPOB 자동 동기화 (Vercel Cron → GET).
//
// - 스케줄: vercel.json 의 crons 참조 (MPOB 월간 통계는 매월 10일 전후 발표 → 12일·22일 두 번 시도)
// - 인증: Vercel 이 `Authorization: Bearer ${CRON_SECRET}` 헤더를 붙여 호출한다.
//   수동 테스트는 `?token=<CRON_SECRET>` 로도 가능.
// - 미들웨어 PUBLIC_PATHS 에 /api/cron/ 이 등록되어 세션 쿠키 없이 통과하므로
//   반드시 여기서 secret 을 검증한다.

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') || '';
  if (header === `Bearer ${secret}`) return true;
  const token = new URL(request.url).searchParams.get('token');
  return token === secret;
}

export async function GET(request: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET 환경변수가 설정되지 않았습니다' }, { status: 500 });
  }
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const startedAt = new Date().toISOString();
  try {
    const result = await runMpobSync();
    console.log(`[cron mpob-sync] ${startedAt} ok: ${result.message}`);
    // USDA PSD 도 같은 월간 주기로 (키가 있을 때만, 실패해도 MPOB 결과는 유지)
    let usda: any = null;
    if (usdaKeyConfigured()) {
      try { usda = await runUsdaSync(); console.log(`[cron mpob-sync] usda: ${usda.message}`); }
      catch (e: any) { usda = { error: e.message }; console.warn(`[cron mpob-sync] usda failed: ${e.message}`); }
    }
    return NextResponse.json({ success: true, started_at: startedAt, ...result, usda });
  } catch (error: any) {
    console.error(`[cron mpob-sync] ${startedAt} failed: ${error.message}`);
    return NextResponse.json({ success: false, started_at: startedAt, error: error.message }, { status: 500 });
  }
}
