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

  const rows = [...dedup.values()].map((r) => ({
    category: r.category, item_name: r.item_name, year: r.year, month: r.month,
    value: r.value ?? null, value_rm: r.value_rm ?? null,
    parent_group: r.parent_group ?? null, sort_order: r.sort_order,
  }));

  // 행을 JSON 한 덩어리로 넘겨 쿼리 1번에 upsert.
  // 행마다 INSERT 하면 함수(미국)↔DB(도쿄) 왕복 ~0.3s × 수백 건이 쌓여 60초 초과(504) —
  // 2026-10-21 실측: 100행 트랜잭션 1개에 30초, 4커넥션으로 700행 저장 중 타임아웃.
  // 파라미터는 반드시 ?::text::jsonb — ?::jsonb 로 쓰면 postgres.js 가 서버가 알려준 jsonb 타입에 맞춰
  // 문자열을 한 번 더 JSON.stringify 해 jsonb 문자열 스칼라가 됨 ("cannot call jsonb_to_recordset on a non-array").
  const ops: { sql: string; params: any[] }[] = [];
  for (let i = 0; i < rows.length; i += 1000) {
    ops.push({
      sql: `INSERT INTO mpob_data (category, item_name, year, month, value, value_rm, parent_group, sort_order)
            SELECT category, item_name, year, month, value, value_rm, parent_group, sort_order
            FROM jsonb_to_recordset(?::text::jsonb) AS t(category text, item_name text, year int, month int,
                                                  value numeric, value_rm numeric, parent_group text, sort_order int)
            ON CONFLICT (category, item_name, year, month) DO UPDATE SET
              value = EXCLUDED.value,
              value_rm = EXCLUDED.value_rm,
              parent_group = EXCLUDED.parent_group,
              sort_order = EXCLUDED.sort_order,
              updated_at = NOW()`,
      params: [JSON.stringify(rows.slice(i, i + 1000))],
    });
  }
  if (ops.length) await dbBatchRun(ops);

  // 일부 보고서만 실패(시간 초과 등)한 경우 성공분은 저장하고 실패 사유를 함께 알린다.
  const failReasons = [...new Set(summary.map((s) => s.error).filter(Boolean))];
  return {
    count: rows.length,
    summary,
    message: `MPOB ${opts.history ? '과거 백필' : '자동 동기화'} 완료: ${rows.length}건 (${summary.map((s) => `${s.category} ${s.error ? '실패' : s.count}`).join(', ')})`
      + (failReasons.length ? `\n실패 사유: ${failReasons.join(' / ')}` : ''),
  };
}
