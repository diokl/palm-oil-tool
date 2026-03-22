import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbGet, dbRun } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { recalcInventory } from '@/lib/inventory-calc';

export async function GET(request: NextRequest) {
  try {
    await seedInitialData();
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

    // Update the field
    await dbRun(`UPDATE inventory SET ${field} = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
      [value, edited_by || 'user', id]);

    // Log the edit
    await dbRun(
      `INSERT INTO edit_log (table_name, record_id, field_name, old_value, new_value, edited_by)
       VALUES ('inventory', ?, ?, ?, ?, ?)`,
      [id, field, String(oldValue), String(value), edited_by || 'user']
    );

    // Recalculate inventory for this product/year
    await recalcInventory(current.product, current.year);
    // Also recalculate next year if exists
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
