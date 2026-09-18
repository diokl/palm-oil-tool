import { NextRequest, NextResponse } from 'next/server';
import { runMpobSync } from '@/lib/mpob-sync';

// Scraping involves a login + page fetches + report fetches, which can
// exceed the default serverless timeout. Allow up to 60s and never cache.
// body: { history?: boolean, from_year?: number }  — history=true 면 섹션의 모든 연도 백필
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runMpobSync({
      history: body?.history === true,
      fromYear: typeof body?.from_year === 'number' ? body.from_year : undefined,
    });
    return NextResponse.json({ success: true, ...result });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
