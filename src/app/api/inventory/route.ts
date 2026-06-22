import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbGet, dbRun, dbBatchRun } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { recalcInventory } from '@/lib/inventory-calc';

export async function GET(request: NextRequest) {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    const { searchParams } = new URL(request.url);
    const product = searchParams.get('product');
    const year = searchParams.get('year');
    const action = searchParams.get('action');

    // Auto-fill suggestions from purchases: 계약월(shipment_month) +1M = 통관월
    if (action === 'autofill') {
      return handleAutofill(product, year ? parseInt(year) : null);
    }

    let query = 'SELECT * FROM inventory';
    const conditions: string[] = [];
    const params: any[] = [];

    if (product) { conditions.push('product = ?'); params.push(product); }
    if (year) { conditions.push('year = ?'); params.push(parseInt(year)); }

    if (conditions.length > 0) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY product, year, month';

    const data = await dbAll(query, params);
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// 구매이력 기반 자동 채우기 데이터 계산
// 선적월(shipment_month) + 1M = 통관월(customs month)
async function handleAutofill(product: string | null, year: number | null) {
  try {
    // Get all purchases
    const purchases = await dbAll('SELECT * FROM purchases ORDER BY shipment_month, product');

    // Group by product and customs_month (shipment_month + 1)
    const autofillMap: Record<string, { customs_volume: number; total_amount: number; total_qty: number; prices: string[] }> = {};

    for (const p of purchases as any[]) {
      if (product && p.product !== product) continue;

      // Calculate customs month = shipment_month + 1
      const [sy, sm] = (p.shipment_month as string).split('-').map(Number);
      let customsYear = sy;
      let customsMonth = sm + 1;
      if (customsMonth > 12) {
        customsMonth = 1;
        customsYear += 1;
      }

      if (year && customsYear !== year) continue;

      const key = `${p.product}-${customsYear}-${customsMonth}`;
      if (!autofillMap[key]) {
        autofillMap[key] = { customs_volume: 0, total_amount: 0, total_qty: 0, prices: [] };
      }
      autofillMap[key].customs_volume += p.qty_mt || 0;
      autofillMap[key].total_amount += p.amount_usd || 0;
      autofillMap[key].total_qty += p.qty_mt || 0;
      if (p.unit_price) {
        autofillMap[key].prices.push(`$${Number(p.unit_price).toFixed(1)}`);
      }
    }

    // Build result
    const suggestions: Array<{
      product: string;
      year: number;
      month: number;
      customs_volume: number;
      wavg_price: number;
      contract_price_text: string;
      shipment_month: string;
    }> = [];

    for (const [key, val] of Object.entries(autofillMap)) {
      const [prod, yr, mn] = key.split('-');
      const wavg = val.total_qty > 0 ? val.total_amount / val.total_qty : 0;
      // Shipment month = customs month - 1
      let shipYear = parseInt(yr);
      let shipMonth = parseInt(mn) - 1;
      if (shipMonth < 1) { shipMonth = 12; shipYear -= 1; }

      // Deduplicate prices
      const uniquePrices = [...new Set(val.prices)];

      suggestions.push({
        product: prod,
        year: parseInt(yr),
        month: parseInt(mn),
        customs_volume: Math.round(val.customs_volume * 10) / 10,
        wavg_price: Math.round(wavg * 10) / 10,
        contract_price_text: uniquePrices.join(', '),
        shipment_month: `${shipYear}-${String(shipMonth).padStart(2, '0')}`,
      });
    }

    suggestions.sort((a, b) => a.year - b.year || a.month - b.month);

    return NextResponse.json({ suggestions });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, field, value, edited_by } = body;

    const allowedFields = ['expected_usage', 'customs_volume', 'sales_volume', 'contract_price', 'contract_date'];
    if (!allowedFields.includes(field)) {
      return NextResponse.json({ error: `Field '${field}' is not editable` }, { status: 400 });
    }

    // Get current value for audit log
    const current = await dbGet(`SELECT * FROM inventory WHERE id = ?`, [id]) as any;
    if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const oldValue = current[field];
    const user = edited_by || 'user';

    // Update field + log in one batch (1 round trip)
    await dbBatchRun([
      { sql: `UPDATE inventory SET ${field} = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`, params: [value, user, id] },
      { sql: `INSERT INTO edit_log (table_name, record_id, field_name, old_value, new_value, edited_by) VALUES ('inventory', ?, ?, ?, ?, ?)`, params: [id, field, String(oldValue), String(value), user] },
    ]);

    // Recalculate inventory — returns updated rows directly (no extra SELECT needed)
    const updatedRows = await recalcInventory(current.product, current.year);

    // Only recalc next year if editing December (month 12) — saves ~3 round trips
    if (current.month === 12) {
      const dec = updatedRows.find((r: any) => r.month === 12);
      const decEndingStock = dec?.ending_stock ?? 0;
      // Fire-and-forget: next year recalc doesn't affect current year response
      recalcInventory(current.product, current.year + 1, decEndingStock).catch(() => {});
    }

    return NextResponse.json({ data: updatedRows });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
