import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbBatchRun } from '@/lib/db';
import { getOilSpread, toUsdMt } from '@/lib/oil-spread';

// GET /api/oil-prices            → 스프레드 시계열 + 입력 목록
// GET /api/oil-prices?spread=1   → 스프레드만 (대시보드용)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const spread = await getOilSpread(90);
    if (searchParams.get('spread') === '1') {
      return NextResponse.json(spread);
    }
    const prices = await dbAll(
      `SELECT id, date, commodity, price_native, unit_native, price_usd_mt, source
       FROM oil_prices ORDER BY date DESC, commodity LIMIT 200`,
    );
    return NextResponse.json({ ...spread, prices });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST /api/oil-prices
// body: { date, commodity, price_native, unit_native }  단건
// body: { mode:'bulk', text }  여러 줄 "2026-06-12 74.28" (대두유 cents/lb 기본)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.mode === 'bulk' && typeof body.text === 'string') {
      const commodity = body.commodity || 'SBO';
      const unit = body.unit_native || 'cents/lb';
      const lines = body.text.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean);
      // 여러 줄 → upsert ops 빌드 후 배치 실행(수백 행도 타임아웃 없이).
      const ops: { sql: string; params: any[] }[] = [];
      for (const line of lines) {
        const m = line.match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[,\s]+([\d.]+)/);
        if (!m) continue;
        const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
        const native = parseFloat(m[4]);
        if (isNaN(native)) continue;
        const usd = Math.round(toUsdMt(native, unit) * 100) / 100;
        ops.push({
          sql: `INSERT INTO oil_prices (date, commodity, price_native, unit_native, price_usd_mt, source)
                VALUES (?, ?, ?, ?, ?, 'manual_bulk')
                ON CONFLICT (date, commodity) DO UPDATE SET
                  price_native = EXCLUDED.price_native, unit_native = EXCLUDED.unit_native,
                  price_usd_mt = EXCLUDED.price_usd_mt, source = EXCLUDED.source`,
          params: [date, commodity, native, unit, usd],
        });
      }
      for (let i = 0; i < ops.length; i += 100) {
        await dbBatchRun(ops.slice(i, i + 100));
      }
      return NextResponse.json({ success: true, applied: ops.length });
    }

    const { date, commodity, price_native, unit_native } = body;
    if (!date || !commodity || price_native == null) {
      return NextResponse.json({ error: 'Required: date, commodity, price_native' }, { status: 400 });
    }
    const unit = unit_native || 'cents/lb';
    const usd = Math.round(toUsdMt(Number(price_native), unit) * 100) / 100;
    await dbRun(
      `INSERT INTO oil_prices (date, commodity, price_native, unit_native, price_usd_mt, source)
       VALUES (?, ?, ?, ?, ?, 'manual')
       ON CONFLICT (date, commodity) DO UPDATE SET
         price_native = EXCLUDED.price_native, unit_native = EXCLUDED.unit_native,
         price_usd_mt = EXCLUDED.price_usd_mt, source = EXCLUDED.source`,
      [date, commodity, Number(price_native), unit, usd],
    );
    return NextResponse.json({ success: true, price_usd_mt: usd });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE /api/oil-prices?id=123
export async function DELETE(request: NextRequest) {
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    await dbRun('DELETE FROM oil_prices WHERE id = ?', [parseInt(id, 10)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
