import { dbBatchRun } from './db';
import { scrapeMPOBData, type MpobScrapeResult } from './mpob-scraper';

// MPOB BEPI 스크래핑 → mpob_data UPSERT. 수동 버튼(/api/mpob/sync)과
// 월간 cron(/api/cron/mpob-sync)이 같은 함수를 호출한다.

export interface MpobSyncResult {
  count: number;
  summary: MpobScrapeResult['summary'];
  message: string;
}

export async function runMpobSync(): Promise<MpobSyncResult> {
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

  return {
    count: records.length,
    summary,
    message: `MPOB 자동 동기화 완료: ${records.length}건 (${summary.map((s) => `${s.category} ${s.count}`).join(', ')})`,
  };
}
