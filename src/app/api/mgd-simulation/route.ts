import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import { simulate, compareScenarios, getBaseStock } from '@/lib/mgd-simulator';

// GET /api/mgd-simulation?inject_date=2026-07-15
//   → 시뮬레이션 + 4안 비교 + 위치별 재고
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const injectDate = searchParams.get('inject_date') || '2026-07-24';
    const [sim, scenarios, locations, base] = await Promise.all([
      simulate(injectDate),
      compareScenarios(),
      dbAll('SELECT id, location, product, qty_kg, as_of_date, sort_order FROM stock_locations ORDER BY sort_order, product'),
      getBaseStock(),
    ]);
    return NextResponse.json({ sim, scenarios, locations, base });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/mgd-simulation  — 위치별 재고 수정
// body: { id, qty_kg }  또는  { location, product, qty_kg }
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.id != null) {
      await dbRun('UPDATE stock_locations SET qty_kg = ?, updated_at = NOW() WHERE id = ?', [Number(body.qty_kg) || 0, body.id]);
    } else if (body.location && body.product) {
      await dbRun(
        `INSERT INTO stock_locations (location, product, qty_kg) VALUES (?, ?, ?)
         ON CONFLICT (location, product) DO UPDATE SET qty_kg = EXCLUDED.qty_kg, updated_at = NOW()`,
        [body.location, body.product, Number(body.qty_kg) || 0],
      );
    } else {
      return NextResponse.json({ error: 'id 또는 (location, product) 필요' }, { status: 400 });
    }
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
