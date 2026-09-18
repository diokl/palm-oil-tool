import { NextRequest, NextResponse } from 'next/server';
import { getUsdaTable, runUsdaSync } from '@/lib/usda-psd';

// GET  /api/usda?commodity=PALM|SOY_OIL → 국가별 수급표 (USDA PSD)
// POST /api/usda                        → 동기화 (USDA_API_KEY 필요)
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const c = new URL(request.url).searchParams.get('commodity') === 'SOY_OIL' ? 'SOY_OIL' : 'PALM';
    return NextResponse.json(await getUsdaTable(c));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const r = await runUsdaSync();
    return NextResponse.json({ success: true, ...r });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
