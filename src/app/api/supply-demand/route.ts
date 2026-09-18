import { NextResponse } from 'next/server';
import { getSupplyDemand } from '@/lib/supply-demand';

// GET /api/supply-demand → 말레이시아 팜유 수급 밸런스 시계열 + 요약 (재고/수출 비율, 회귀 적정가)
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await getSupplyDemand();
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
