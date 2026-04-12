import { NextResponse } from 'next/server';
import { dbBatchRun, dbGet } from '@/lib/db';
import { buildMpobSeedRecords } from '@/lib/mpob-seed';

export async function POST() {
  try {
    // Check if data already exists (table may not exist yet — that's fine)
    let existingCount = 0;
    try {
      const existing = await dbGet(
        `SELECT COUNT(*) as cnt FROM mpob_data`
      ) as { cnt: number } | undefined;
      existingCount = existing ? Number(existing.cnt) : 0;
    } catch {
      // Table doesn't exist yet — will be created by schema, proceed with seed
      existingCount = 0;
    }

    if (existingCount > 0) {
      return NextResponse.json({
        success: true,
        message: `이미 데이터가 존재합니다 (${existingCount}건). 강제 재삽입하려면 테이블을 비운 후 다시 시도하세요.`,
        count: existingCount,
      });
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

    return NextResponse.json({
      success: true,
      message: `Seed 완료: ${records.length}건 삽입`,
      count: records.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
