import { NextResponse } from 'next/server';
import { dbBatchRun } from '@/lib/db';
import { scrapeMPOBData } from '@/lib/mpob-scraper';

// Scraping involves a login + 4 page fetches + 4 report fetches, which can
// exceed the default serverless timeout. Allow up to 60s and never cache.
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const { records, summary } = await scrapeMPOBData();

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

    // Batch in chunks, run chunks in parallel (Vercel 60s 제한 대비 시간 절약).
    const chunks: typeof ops[] = [];
    for (let i = 0; i < ops.length; i += 100) chunks.push(ops.slice(i, i + 100));
    await Promise.all(chunks.map((c) => dbBatchRun(c)));

    return NextResponse.json({
      success: true,
      count: records.length,
      summary,
      message: `MPOB 자동 동기화 완료: ${records.length}건 (${summary.map((s) => `${s.category} ${s.count}`).join(', ')})`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
