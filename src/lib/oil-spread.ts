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
  palm: number | null;        // 팜유 FCPO 최근월 USD/MT — 그 날짜에 값이 있을 때만
  sbo: number | null;         // 대두유 USD/MT — 그 날짜에 값이 있을 때만
  spread: number | null;      // 대두유 − 팜유(as-of). sbo 있는 날만 계산
}

// 연도 필터: 2025·2026만 본다 (일단은).
const YEAR_FROM = '2025-01-01';
const YEAR_TO = '2027-01-01'; // exclusive

// 팜유(FCPO 최근월) + 대두유(oil_prices) → 스프레드.
//
// 설계(사용자 요구 반영):
//  - 팜유 USD는 MYPO 데이터에서 직접 온다(settlement_usd = RBD PALM OIL ASK). 별도 달러 환산/외부환율 불필요.
//    settlement_usd 없는 과거 행만 그 행 자체의 환율로 보조 환산(settlement_myr ÷ exchange_rate).
//  - 차트는 팜유·대두유를 '통합 날짜축'에 각각 표시 — 날짜가 안 맞아도 각 점은 보인다.
//  - 스프레드 숫자는 as-of 매칭(대두유 날짜 이하 가장 가까운 팜유)으로 계산.
//  - 2025·2026만.
export async function getOilSpread(_limitDays = 60): Promise<{
  latest: SpreadPoint | null;
  series: SpreadPoint[];
  prev: SpreadPoint | null;
}> {
  // 대두유 (2025·2026)
  const sboRows = await dbAll(
    `SELECT date, price_usd_mt FROM oil_prices
     WHERE commodity = 'SBO' AND price_usd_mt IS NOT NULL
       AND date >= ? AND date < ?
     ORDER BY date ASC`,
    [YEAR_FROM, YEAR_TO],
  ) as { date: string; price_usd_mt: number }[];
  const sboByDate = new Map<string, number>(sboRows.map((r) => [r.date, Number(r.price_usd_mt)]));

  // FCPO 최근월(=날짜별 최소 contract_month) USD (2025·2026)
  const fcpoRows = await dbAll(
    `SELECT date, contract_month, settlement_usd, settlement_myr, exchange_rate FROM fcpo_settlement
     WHERE date >= ? AND date < ?
       AND (settlement_usd IS NOT NULL OR (settlement_myr IS NOT NULL AND exchange_rate IS NOT NULL))
     ORDER BY date ASC, contract_month ASC`,
    [YEAR_FROM, YEAR_TO],
  ) as { date: string; contract_month: string; settlement_usd: number | null; settlement_myr: number | null; exchange_rate: number | null }[];

  const palmByDate = new Map<string, number>();
  for (const r of fcpoRows) {
    if (palmByDate.has(r.date)) continue; // contract_month ASC → 첫 행이 최근월
    const usd = r.settlement_usd != null
      ? Number(r.settlement_usd)
      : (r.settlement_myr != null && r.exchange_rate ? Math.round((Number(r.settlement_myr) / Number(r.exchange_rate)) * 10) / 10 : null);
    if (usd != null) palmByDate.set(r.date, usd);
  }
  const palmDates = [...palmByDate.keys()].sort();

  // targetDate 이하 가장 가까운 팜유 (as-of)
  const palmAsOf = (targetDate: string): number | null => {
    let chosen: string | null = null;
    for (const d of palmDates) { if (d <= targetDate) chosen = d; else break; }
    return chosen ? palmByDate.get(chosen)! : null;
  };

  // 통합 날짜축 (팜유 ∪ 대두유), 오래된→최신
  const allDates = [...new Set([...palmByDate.keys(), ...sboByDate.keys()])].sort();
  const series: SpreadPoint[] = allDates.map((date) => {
    const palm = palmByDate.get(date) ?? null;
    const sbo = sboByDate.get(date) ?? null;
    // 스프레드: 대두유가 있는 날만, 팜유는 as-of로
    const palmForSpread = sbo != null ? (palm ?? palmAsOf(date)) : null;
    const spread = palmForSpread != null && sbo != null ? Math.round((sbo - palmForSpread) * 10) / 10 : null;
    return { date, palm, sbo, spread };
  });

  // 헤드라인(카드)용 latest = 대두유가 있는 가장 최근 날짜 + as-of 팜유
  const sboDates = [...sboByDate.keys()].sort();
  const makePoint = (d: string): SpreadPoint => {
    const sbo = sboByDate.get(d)!;
    const palm = palmAsOf(d);
    return { date: d, palm, sbo, spread: palm != null ? Math.round((sbo - palm) * 10) / 10 : null };
  };
  const latest = sboDates.length > 0 ? makePoint(sboDates[sboDates.length - 1]) : null;
  const prev = sboDates.length > 1 ? makePoint(sboDates[sboDates.length - 2]) : null;

  return { latest, series, prev };
}
