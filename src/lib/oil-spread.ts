import { dbAll } from './db';

// 단위 환산: 1 cent/lb = $22.0462/MT (1 MT = 2204.6226 lb)
export const CENTS_LB_TO_USD_MT = 22.046226;

export function toUsdMt(priceNative: number, unit: string): number {
  return unit === 'cents/lb' ? priceNative * CENTS_LB_TO_USD_MT : priceNative;
}

// 식물유 라벨
export const OIL_LABELS: Record<string, string> = {
  SBO: '대두유 (CBOT)',
  SUN: '해바라기유',
  RAPE: '유채유',
  CPO: '팜유 현물',
};

export interface SpreadPoint {
  date: string;
  palm: number | null;   // 팜유 nearby 월물 종가 USD/MT
  sbo: number | null;    // 대두유 USD/MT
  spread: number | null; // sbo - palm (양수 = 대두유 프리미엄)
}

// 팜유(fcpo nearby 월물) + 대두유(oil_prices) → 스프레드 시계열
export async function getOilSpread(limitDays = 60): Promise<{
  latest: SpreadPoint | null;
  series: SpreadPoint[];
  prev: SpreadPoint | null;
}> {
  // 대두유 입력된 날짜들
  const sboRows = await dbAll(
    `SELECT date, price_usd_mt FROM oil_prices WHERE commodity = 'SBO' AND price_usd_mt IS NOT NULL ORDER BY date DESC LIMIT ?`,
    [limitDays],
  ) as { date: string; price_usd_mt: number }[];

  const series: SpreadPoint[] = [];
  for (const s of sboRows) {
    // 같은 날 팜유 nearby 월물 종가
    const palmRow = await dbAll(
      `SELECT settlement_usd FROM fcpo_settlement
       WHERE date = ? AND settlement_usd IS NOT NULL
       ORDER BY contract_month ASC LIMIT 1`,
      [s.date],
    ) as { settlement_usd: number }[];
    const palm = palmRow[0]?.settlement_usd ?? null;
    const sbo = s.price_usd_mt;
    series.push({
      date: s.date,
      palm,
      sbo,
      spread: palm != null && sbo != null ? Math.round((sbo - palm) * 10) / 10 : null,
    });
  }
  series.reverse(); // 오래된→최신

  const latest = series.length > 0 ? series[series.length - 1] : null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  return { latest, series, prev };
}
