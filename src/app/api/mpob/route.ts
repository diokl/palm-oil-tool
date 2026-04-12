import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbBatchRun } from '@/lib/db';

// GET: fetch MPOB data
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');
    const year = searchParams.get('year');

    if (!category) {
      // Return available categories and years
      const years = await dbAll(
        `SELECT DISTINCT year FROM mpob_data ORDER BY year`
      );
      const categories = await dbAll(
        `SELECT DISTINCT category FROM mpob_data ORDER BY category`
      );
      return NextResponse.json({
        years: years.map((y: any) => y.year),
        categories: categories.map((c: any) => c.category),
      });
    }

    let query = `SELECT * FROM mpob_data WHERE category = $1`;
    const params: any[] = [category];

    if (year) {
      query += ` AND year = $2`;
      params.push(parseInt(year));
    }

    query += ` ORDER BY sort_order, item_name, month`;

    const data = await dbAll(query, params);
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: upsert single cell or bulk data
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Bulk mode: array of records
    if (Array.isArray(body.records)) {
      const ops = body.records.map((r: any) => ({
        sql: `INSERT INTO mpob_data (category, item_name, year, month, value, value_rm, parent_group, sort_order)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (category, item_name, year, month) DO UPDATE SET
                value = EXCLUDED.value,
                value_rm = EXCLUDED.value_rm,
                parent_group = EXCLUDED.parent_group,
                sort_order = EXCLUDED.sort_order,
                updated_at = NOW()`,
        params: [
          r.category, r.item_name, r.year, r.month,
          r.value ?? null, r.value_rm ?? null,
          r.parent_group ?? null, r.sort_order ?? 0
        ],
      }));

      await dbBatchRun(ops);
      return NextResponse.json({ success: true, count: ops.length });
    }

    // Single cell update
    const { category, item_name, year, month, value, value_rm } = body;

    await dbRun(
      `INSERT INTO mpob_data (category, item_name, year, month, value, value_rm)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (category, item_name, year, month) DO UPDATE SET
         value = EXCLUDED.value,
         value_rm = EXCLUDED.value_rm,
         updated_at = NOW()`,
      [category, item_name, year, month, value ?? null, value_rm ?? null]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
