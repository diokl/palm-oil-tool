import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import { simulate, compareScenarios, getBaseStock } from '@/lib/mgd-simulator';

// GET /api/mgd-simulation?inject_date=2026-07-15
//   → 시뮬레이션 + 4안 비교 + 위치별 재고
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const injectDate = searchParams.get('inject_date') || '2026-07-24';
    const [sim, scenarios, locations, base, demand, adjustments] = await Promise.all([
      simulate(injectDate),
      compareScenarios(),
      dbAll('SELECT id, location, product, qty_kg, as_of_date, sort_order FROM stock_locations ORDER BY sort_order, product'),
      getBaseStock(),
      dbAll('SELECT id, product, month, monthly_kg FROM demand_config ORDER BY month, product').catch(() => []),
      dbAll('SELECT id, date, product, delta_kg, label, note FROM daily_adjustments ORDER BY date DESC, id DESC').catch(() => []),
    ]);
    return NextResponse.json({ sim, scenarios, locations, base, demand, adjustments });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT /api/mgd-simulation
//  - { kind:'location', id, qty_kg }              위치별 재고 수정
//  - { kind:'demand', product, month, monthly_kg } 월별 소요 수정
//  - (호환) { id, qty_kg }                         위치 재고 수정
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    if (body.kind === 'demand') {
      await dbRun(
        `INSERT INTO demand_config (product, month, monthly_kg) VALUES (?, ?, ?)
         ON CONFLICT (product, month) DO UPDATE SET monthly_kg = EXCLUDED.monthly_kg, updated_at = NOW()`,
        [body.product, body.month, Number(body.monthly_kg) || 0],
      );
      return NextResponse.json({ success: true });
    }
    // 위치별 재고 (기본)
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

// POST /api/mgd-simulation — 일별 조정 추가
// body: { date, product, delta_kg, label, note }
export async function POST(request: NextRequest) {
  try {
    const b = await request.json();
    if (!b.date || !b.product || b.delta_kg == null) {
      return NextResponse.json({ error: 'date, product, delta_kg 필요' }, { status: 400 });
    }
    await dbRun(
      `INSERT INTO daily_adjustments (date, product, delta_kg, label, note) VALUES (?, ?, ?, ?, ?)`,
      [b.date, b.product, Number(b.delta_kg), b.label || '기타', b.note || null],
    );
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/mgd-simulation?adj_id=123 — 일별 조정 삭제
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('adj_id');
    if (!id) return NextResponse.json({ error: 'adj_id 필요' }, { status: 400 });
    await dbRun('DELETE FROM daily_adjustments WHERE id = ?', [parseInt(id, 10)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
