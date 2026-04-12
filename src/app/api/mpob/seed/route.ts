import { NextResponse } from 'next/server';
import { dbBatchRun, dbGet } from '@/lib/db';
import { buildMpobSeedRecords } from '@/lib/mpob-seed';

export async function POST() {
  try {
    // Check if data already exists
    const existing = await dbGet(
      `SELECT COUNT(*) as cnt FROM mpob_data`
    ) as { cnt: number } | undefined;

    if (existing && Number(existing.cnt) > 0) {
      return NextResponse.json({ message: 'Seed skipped — data already exists', count: Number(existing.cnt) });
    }

    const records = buildMpobSeedRecords();

    const ops = records.map((r) => ({
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
        r.parent_group ?? null, r.sort_order,
      ],
    }));

    // Batch in chunks of 100 to avoid transaction size issues
    for (let i = 0; i < ops.length; i += 100) {
      await dbBatchRun(ops.slice(i, i + 100));
    }

    return NextResponse.json({ success: true, count: records.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
