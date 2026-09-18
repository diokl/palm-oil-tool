import { NextRequest, NextResponse } from 'next/server';
import { getTermStructure } from '@/lib/term-structure';

// GET /api/term-structure?date=YYYY-MM-DD&days=180 → 월물 곡선 + 스프레드 추이 + 해석
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') || undefined;
    const days = Math.min(Math.max(parseInt(searchParams.get('days') || '180', 10) || 180, 30), 730);
    const result = await getTermStructure(date, days);
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
