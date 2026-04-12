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

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, field, value, edited_by } = body;

    const allowedFields = ['expected_usage', 'customs_volume', 'contract_price', 'contract_date'];
    if (!allowedFields.includes(field)) {
      return NextResponse.json({ error: `Field '${field}' is not editable` }, { status: 400 });
    }

    // Get current value for audit log
    const current = await dbGet(`SELECT * FROM inventory WHERE id = ?`, [id]) as any;
    if (!current) return NextResponse.json({ error: 'Record not found' }, { status: 404 });

    const oldValue = current[field];
    const user = edited_by || 'user';

    // Update field + log in one batch
    await dbBatchRun([
      { sql: `UPDATE inventory SET ${field} = ?, updated_at = NOW(), updated_by = ? WHERE id = ?`, params: [value, user, id] },
      { sql: `INSERT INTO edit_log (table_name, record_id, field_name, old_value, new_value, edited_by) VALUES ('inventory', ?, ?, ?, ?, ?)`, params: [id, field, String(oldValue), String(value), user] },
    ]);

    // Recalculate inventory (batch writes inside)
    await recalcInventory(current.product, current.year);
    await recalcInventory(current.product, current.year + 1);

    // Return updated data
    const updated = await dbAll(
      `SELECT * FROM inventory WHERE product = ? AND year = ? ORDER BY month`,
      [current.product, current.year]
    );

    return NextResponse.json({ data: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
