import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbGet, dbLastId } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';

// Ensure extended columns exist (migration-safe)
async function ensureExtendedColumns() {
  const tableInfo = await dbAll("PRAGMA table_info(purchases)");
  if (tableInfo.length > 0) {
    const columns = tableInfo.map((row: any) => row.name);
    const newCols: [string, string][] = [
      ['incoterms', 'TEXT'],
      ['payment_terms', 'TEXT'],
      ['loading_port', 'TEXT'],
      ['discharge_port', 'TEXT'],
      ['contract_number', 'TEXT'],
    ];
    for (const [col, type] of newCols) {
      if (!columns.includes(col)) {
        try {
          await dbRun(`ALTER TABLE purchases ADD COLUMN ${col} ${type}`);
        } catch { /* column may already exist */ }
      }
    }
  }
}

export async function GET() {
  try {
    await seedInitialData();
    await ensureExtendedColumns();

    const data = await dbAll('SELECT * FROM purchases ORDER BY contract_date DESC');

    const total = data.length;
    const successful = (data as any[]).filter(p => p.evaluation === '성공').length;
    const totalEffect = (data as any[]).reduce((sum, p) => sum + (p.prebuy_effect_krw || 0), 0);
    const avgDiff = total > 0 ? (data as any[]).reduce((sum, p) => sum + (p.price_diff || 0), 0) / total : 0;

    return NextResponse.json({
      data,
      summary: {
        total,
        successful,
        success_rate: total > 0 ? (successful / total * 100).toFixed(1) + '%' : '0%',
        total_effect: totalEffect,
        avg_diff: Math.round(avgDiff * 10) / 10,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureExtendedColumns();
    const body = await request.json();
    const {
      shipment_month, contract_date, contract_price, quantity_mt, supplier,
      market_price, product, notes, incoterms, payment_terms,
      loading_port, discharge_port, contract_number,
    } = body;

    // Auto-match market price from FCPO data if not provided
    let finalMarketPrice = market_price;
    if (!finalMarketPrice && contract_date && shipment_month) {
      const fcpo = await dbGet(
        `SELECT settlement_usd FROM fcpo_settlement
         WHERE contract_month = ? AND date <= ?
         ORDER BY date DESC LIMIT 1`,
        [shipment_month, contract_date]
      );
      if (fcpo) finalMarketPrice = fcpo.settlement_usd;
    }

    const price_diff = finalMarketPrice && contract_price ? finalMarketPrice - contract_price : null;
    const prebuy_effect = price_diff !== null && quantity_mt ? price_diff * quantity_mt * -1000 : null;
    const evaluation = price_diff !== null ? (price_diff >= 0 ? '실패' : '성공') : null;

    await dbRun(
      `INSERT INTO purchases (
        shipment_month, contract_date, contract_price, quantity_mt, supplier,
        market_price, price_diff, prebuy_effect_krw, evaluation, product, notes,
        incoterms, payment_terms, loading_port, discharge_port, contract_number
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        shipment_month, contract_date, contract_price, quantity_mt, supplier,
        finalMarketPrice, price_diff, prebuy_effect, evaluation, product || 'RBD', notes,
        incoterms || null, payment_terms || null, loading_port || null,
        discharge_port || null, contract_number || null,
      ]
    );

    const id = await dbLastId();
    return NextResponse.json({ success: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    await ensureExtendedColumns();
    const body = await request.json();
    const { id, ...fields } = body;

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    // Recalculate derived fields if price or quantity changed
    let updateFields = { ...fields };
    if ('contract_price' in fields || 'market_price' in fields || 'quantity_mt' in fields) {
      const existing = await dbGet('SELECT * FROM purchases WHERE id = ?', [id]);
      if (existing) {
        const cp = fields.contract_price ?? existing.contract_price;
        const mp = fields.market_price ?? existing.market_price;
        const qty = fields.quantity_mt ?? existing.quantity_mt;
        const diff = mp && cp ? mp - cp : null;
        const effect = diff !== null && qty ? diff * qty * -1000 : null;
        const evalResult = diff !== null ? (diff >= 0 ? '실패' : '성공') : null;
        updateFields.price_diff = diff;
        updateFields.prebuy_effect_krw = effect;
        updateFields.evaluation = evalResult;
      }
    }

    const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updateFields);

    await dbRun(`UPDATE purchases SET ${setClauses} WHERE id = ?`, [...values, id]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    await dbRun('DELETE FROM purchases WHERE id = ?', [parseInt(id)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
