import { NextRequest, NextResponse } from 'next/server';
import { getMacroSnapshot, runMarketDataSync } from '@/lib/market-data';

// GET  /api/market-data?days=180     → 환율·원유·POGO 스냅샷 + 시계열
// POST /api/market-data {days?: number} → 수동 수집 (기본 14일, 백필은 730)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const days = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('days') || '180', 10) || 180, 30), 1100);
    return NextResponse.json(await getMacroSnapshot(days));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const days = Math.min(Math.max(Number(body?.days) || 14, 1), 1100);
    const result = await runMarketDataSync(days);
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
