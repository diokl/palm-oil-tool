import { dbAll } from './db';
import { getUsdMyrRates, rateForDate } from './fx';

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
  palm: number | null;   // 팜유 FCPO 최근월 종가 USD/MT (USD 미입력 시 MYR÷환율로 환산)
  sbo: number | null;    // 대두유 USD/MT
  spread: number | null; // sbo - palm (양수 = 대두유 프리미엄)
}

// 팜유(FCPO 최근월) + 대두유(oil_prices) → 스프레드 시계열.
//
// 견고화 2가지(기존엔 둘 다 없어서 팜유가 비었음):
//  1) as-of 조인: 대두유 날짜와 '정확히 같은 날'이 아니라 '가장 가까운 이전 FCPO 날짜'를 매칭.
//  2) settlement_usd가 없으면(현 데이터는 전부 MYR만 있음) settlement_myr ÷ USD/MYR 환율로 즉석 환산.
export async function getOilSpread(limitDays = 60): Promise<{
  latest: SpreadPoint | null;
  series: SpreadPoint[];
  prev: SpreadPoint | null;
}> {
  // 대두유 입력된 날짜들 (최신 limitDays개)
  const sboRows = await dbAll(
    `SELECT date, price_usd_mt FROM oil_prices WHERE commodity = 'SBO' AND price_usd_mt IS NOT NULL ORDER BY date DESC LIMIT ?`,
    [limitDays],
  ) as { date: string; price_usd_mt: number }[];

  // FCPO 최근월(=날짜별 가장 이른 contract_month) 종가. USD 우선, 없으면 MYR.
  const fcpoRows = await dbAll(
    `SELECT date, contract_month, settlement_usd, settlement_myr FROM fcpo_settlement
     WHERE settlement_usd IS NOT NULL OR settlement_myr IS NOT NULL
     ORDER BY date ASC, contract_month ASC`,
  ) as { date: string; contract_month: string; settlement_usd: number | null; settlement_myr: number | null }[];

  // 날짜별 front month 한 줄만 보관 (contract_month ASC라 첫 행 = 최근월)
  const frontByDate = new Map<string, { usd: number | null; myr: number | null }>();
  for (const r of fcpoRows) {
    if (!frontByDate.has(r.date)) frontByDate.set(r.date, { usd: r.settlement_usd, myr: r.settlement_myr });
  }
  const fcpoDates = [...frontByDate.keys()].sort(); // 오름차순

  // USD/MYR 환율 (Yahoo, 실패 시 폴백). MYR→USD 환산용.
  const rates = await getUsdMyrRates();

  // targetDate 이하에서 가장 가까운 FCPO 날짜의 팜유 USD/MT.
  const palmUsdAsOf = (targetDate: string): number | null => {
    let chosen: string | null = null;
    for (const d of fcpoDates) {
      if (d <= targetDate) chosen = d; else break;
    }
    if (!chosen) return null;
    const f = frontByDate.get(chosen)!;
    if (f.usd != null) return f.usd;
    if (f.myr != null) {
      const rate = rateForDate(rates, chosen);
      return Math.round((f.myr / rate) * 10) / 10;
    }
    return null;
  };

  const series: SpreadPoint[] = [];
  for (const s of sboRows) {
    const palm = palmUsdAsOf(s.date);
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
