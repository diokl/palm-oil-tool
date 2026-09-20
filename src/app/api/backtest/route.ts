import { NextRequest, NextResponse } from 'next/server';
import { runBacktest } from '@/lib/backtest';

// GET /api/backtest?product=RBD&from=2021-01&to=2026-08 → 구매 전략 백테스트
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const sp = new URL(request.url).searchParams;
    const product = ['RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'].includes(sp.get('product') || '') ? sp.get('product')! : 'RBD';
    const from = /^\d{4}-\d{2}$/.test(sp.get('from') || '') ? sp.get('from')! : undefined;
    const to = /^\d{4}-\d{2}$/.test(sp.get('to') || '') ? sp.get('to')! : undefined;
    return NextResponse.json(await runBacktest({ product, from, to }));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
