import { NextRequest, NextResponse } from 'next/server';
import { seedInitialData } from '@/lib/seed-data';
import { calculateBoxRange } from '@/lib/box-range';
import type { BoxRangeMode } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    const { searchParams } = new URL(request.url);
    const contractMonth = searchParams.get('contract_month') || '2026-04';
    const currentPrice = searchParams.get('current_price');
    const asOfDate = searchParams.get('as_of_date') || undefined;
    const modeParam = searchParams.get('mode');
    const mode: BoxRangeMode = modeParam === '전쟁이슈' ? '전쟁이슈' : '일반';

    const result = await calculateBoxRange(
      contractMonth,
      currentPrice ? parseFloat(currentPrice) : undefined,
      asOfDate,
      mode,
    );

    if (!result) {
      return NextResponse.json({ error: 'Insufficient data (need at least 10 price points)' }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
