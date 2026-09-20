import { NextRequest, NextResponse } from 'next/server';
import { dbRun } from '@/lib/db';
import { getExposureRisk } from '@/lib/exposure-risk';

// GET /api/risk?horizon=6            → 미확정 물량 노출·VaR·계획단가 추적
// PUT /api/risk {product, plan_price} → 계획단가 저장 (mgd_config plan_price_<PRODUCT>)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const h = Math.min(Math.max(parseInt(new URL(request.url).searchParams.get('horizon') || '6', 10) || 6, 1), 12);
    return NextResponse.json(await getExposureRisk(h));
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const product = String(body.product || '');
    if (!['RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'].includes(product)) return NextResponse.json({ error: 'invalid product' }, { status: 400 });
    const price = Number(body.plan_price);
    if (!(price > 0)) return NextResponse.json({ error: 'plan_price must be > 0' }, { status: 400 });
    await dbRun(
      `INSERT INTO mgd_config (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [`plan_price_${product}`, price],
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
