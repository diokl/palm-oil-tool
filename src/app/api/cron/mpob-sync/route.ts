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
  // MPOB 와 USDA PSD(같은 월간 주기, 키가 있을 때만)를 동시에 실행 — 서로의 실패·소요시간에 영향받지 않게.
  // (이전: MPOB 가 끝난 뒤 USDA 를 순서대로 → MPOB 가 실패하면 USDA 미실행, 성공해도 60초 안에 못 끝나 저장 0건)
  const [mpobRes, usdaRes] = await Promise.allSettled([
    runMpobSync(),
    usdaKeyConfigured() ? runUsdaSync() : Promise.resolve(null),
  ]);
  const usda = usdaRes.status === 'fulfilled' ? usdaRes.value : { error: (usdaRes.reason as Error)?.message };
  if (usda) console.log(`[cron mpob-sync] usda: ${'message' in usda ? usda.message : `failed: ${usda.error}`}`);
  if (mpobRes.status === 'rejected') {
    const msg = (mpobRes.reason as Error)?.message;
    console.error(`[cron mpob-sync] ${startedAt} failed: ${msg}`);
    return NextResponse.json({ success: false, started_at: startedAt, error: msg, usda }, { status: 500 });
  }
  console.log(`[cron mpob-sync] ${startedAt} ok: ${mpobRes.value.message}`);
  return NextResponse.json({ success: true, started_at: startedAt, ...mpobRes.value, usda });
}
