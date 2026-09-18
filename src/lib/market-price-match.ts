import { dbAll } from './db';

// ── 구매 시황가 자동 매칭 ──
//
// 선구매 효과 = (시황가 − 계약가) × 물량. '시황가'는 선적월이 도래했을 때의 시장가(RBD 기준).
// 엑셀 '시황 그래프' 시트의 "구매 당월시황" 행은 25년 하반기 기준으로
//   선적월 M 동안 거래된 M월물 종가(USD/MT)의 단순 평균
// 과 정확히 일치한다 (예: 25-07 1,008 / 25-08 1,060.5 / 25-09 1,086.875 / 25-10 1,087.955 / 25-11 1,026).
// 이 규칙을 fcpo_settlement 기준으로 재현한다.
//
// basis:
//   month_avg    — 선적월이 끝났고 그 달의 M월물 종가가 있음 (확정)
//   partial_avg  — 선적월 진행 중, 현재까지 거래일 평균 (잠정)
//   forward      — 선적월 미도래, 가장 최근 달의 M월물(선물) 종가 평균 (참고용 전망치)
//   none         — 해당 월물 시세 없음

export type MatchBasis = 'month_avg' | 'partial_avg' | 'forward' | 'none';

export interface MarketPriceSuggestion {
  shipment_month: string;      // YYYY-MM
  market_price: number | null; // USD/MT (RBD 기준)
  basis: MatchBasis;
  days: number;                // 평균에 사용된 거래일 수
  first_date: string | null;
  last_date: string | null;
  min: number | null;
  max: number | null;
  window_month: string | null; // 평균 산출에 사용된 달 (forward 면 최근 달)
}

interface Row { date: string; contract_month: string; usd: number }

function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${ym}-${String(last).padStart(2, '0')}`;
}

function avg(xs: number[]): number {
  return Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 1000) / 1000;
}

// fcpo_settlement 에서 요청 월물들의 전체 시세 로드 (USD 우선, 없으면 MYR÷환율 보조 환산)
async function loadQuotes(months: string[]): Promise<Map<string, Row[]>> {
  if (months.length === 0) return new Map();
  const placeholders = months.map(() => '?').join(', ');
  const rows = await dbAll(
    `SELECT date::text AS date, contract_month, settlement_usd, settlement_myr, exchange_rate
     FROM fcpo_settlement
     WHERE contract_month IN (${placeholders})
       AND (settlement_usd IS NOT NULL OR (settlement_myr IS NOT NULL AND exchange_rate IS NOT NULL))
     ORDER BY contract_month, date`,
    months,
  ) as { date: string; contract_month: string; settlement_usd: number | null; settlement_myr: number | null; exchange_rate: number | null }[];

  const byMonth = new Map<string, Row[]>();
  for (const r of rows) {
    const usd = r.settlement_usd != null
      ? Number(r.settlement_usd)
      : (r.settlement_myr != null && r.exchange_rate ? Number(r.settlement_myr) / Number(r.exchange_rate) : null);
    if (usd == null || !(usd > 100)) continue; // 명백한 오입력(예: 182.5) 제외
    const list = byMonth.get(r.contract_month) ?? [];
    list.push({ date: String(r.date).slice(0, 10), contract_month: r.contract_month, usd: usd as number });
    byMonth.set(r.contract_month, list);
  }
  return byMonth;
}

export function todayYm(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export async function suggestMarketPrices(months: string[], now = new Date()): Promise<MarketPriceSuggestion[]> {
  const uniq = [...new Set(months.filter(m => /^\d{4}-\d{2}$/.test(m)))].sort();
  const quotes = await loadQuotes(uniq);
  const curYm = todayYm(now);

  return uniq.map((m): MarketPriceSuggestion => {
    const all = quotes.get(m) ?? [];
    const empty: MarketPriceSuggestion = { shipment_month: m, market_price: null, basis: 'none', days: 0, first_date: null, last_date: null, min: null, max: null, window_month: null };
    if (all.length === 0) return empty;

    const inMonth = all.filter(r => r.date >= `${m}-01` && r.date <= endOfMonth(m));
    let window = inMonth;
    let basis: MatchBasis;
    let windowMonth = m;

    if (inMonth.length > 0) {
      basis = m < curYm ? 'month_avg' : 'partial_avg';
    } else {
      // 선적월 미도래 → 가장 최근 달의 해당 월물 종가 평균 (선물 전망치)
      const latestYm = all[all.length - 1].date.slice(0, 7);
      window = all.filter(r => r.date.startsWith(latestYm));
      basis = 'forward';
      windowMonth = latestYm;
    }
    if (window.length === 0) return empty;

    const vals = window.map(r => r.usd);
    return {
      shipment_month: m,
      market_price: avg(vals),
      basis,
      days: window.length,
      first_date: window[0].date,
      last_date: window[window.length - 1].date,
      min: Math.min(...vals),
      max: Math.max(...vals),
      window_month: windowMonth,
    };
  });
}
