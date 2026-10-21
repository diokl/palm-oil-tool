import { dbBatchRun } from './db';
import { scrapeMPOBData, type MpobScrapeResult, type ScrapeOptions } from './mpob-scraper';

// MPOB BEPI 스크래핑 → mpob_data UPSERT. 수동 버튼(/api/mpob/sync)과
// 월간 cron(/api/cron/mpob-sync)이 같은 함수를 호출한다.
// history 옵션이면 섹션에 있는 모든 연도 보고서를 수집(과거 백필).

export interface MpobSyncResult {
  count: number;
  summary: MpobScrapeResult['summary'];
  message: string;
}

export async function runMpobSync(opts: ScrapeOptions = {}): Promise<MpobSyncResult> {
  const { records, summary } = await scrapeMPOBData(opts);

  // 같은 (category,item,year,month) 가 여러 페이지에서 오면(연도별 페이지가 2개년 포함) 마지막 값 채택
  const dedup = new Map<string, typeof records[number]>();
  for (const r of records) dedup.set(`${r.category}|${r.item_name}|${r.year}|${r.month}`, r);

  const ops = [...dedup.values()].map((r) => ({
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

  // 일부 보고서만 실패(시간 초과 등)한 경우 성공분은 저장하고 실패 사유를 함께 알린다.
  const failReasons = [...new Set(summary.map((s) => s.error).filter(Boolean))];
  return {
    count: ops.length,
    summary,
    message: `MPOB ${opts.history ? '과거 백필' : '자동 동기화'} 완료: ${ops.length}건 (${summary.map((s) => `${s.category} ${s.error ? '실패' : s.count}`).join(', ')})`
      + (failReasons.length ? `\n실패 사유: ${failReasons.join(' / ')}` : ''),
  };
}
