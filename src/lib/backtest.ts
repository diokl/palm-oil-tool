import { dbAll } from './db';

// ── 구매 전략 백테스트 ──
//
// 선적월 M 의 월물(contract_month = M)을 "계약 가능 기간" = M−3월 1일 ~ M−1월 말 동안 어떤 방식으로 샀을 때
// 평균 단가가 어떻게 되는지 과거 데이터로 비교한다. 결과는 USD/MT (물량 동일 가정).
//
// 전략
//   forward_3m  : M−3월 첫 거래일에 전량 확정 (현재 기본 방식 '3개월 선구매')
//   split_3     : M−3, M−2, M−1 각 월 첫 거래일 1/3씩 분할
//   window_avg  : 계약 가능 기간 매일 균등 분할 (완전 분할, 타이밍 무관)
//   last_day    : M−1월 마지막 거래일에 전량 (최대한 늦춤)
//   box_range   : 계약 가능 기간 중 '적극구매' 구간(20일 이평 − 0.5σ 이하) 첫 진입일에 전량, 미발생 시 마지막 날
//   box_full    : '전량구매' 구간(20일 이평 − σ 이하) 첫 진입일, 미발생 시 마지막 날
//   spot_month  : 선적월 M 동안의 M월물 평균 = 도구의 '구매 당월시황' (선구매 안 했을 때의 벤치마크)
//   best / worst: 기간 내 최저/최고 (사후 완벽 정보)
//   actual      : purchases 테이블 실제 계약 가중평균 (RBD/RSPO/MANAGED 선택)
//
// 평가: 각 전략의 평균 단가, spot_month 대비 절감(USD/MT), 승률(spot 보다 쌌던 달 비율), 기간 내 백분위.

export const STRATEGIES = ['forward_3m', 'split_3', 'window_avg', 'last_day', 'box_range', 'box_full', 'spot_month', 'best', 'worst', 'actual'] as const;
export type Strategy = typeof STRATEGIES[number];
export const STRATEGY_LABEL: Record<Strategy, string> = {
  forward_3m: '3개월 선구매(확정)', split_3: '3분할(월초)', window_avg: '기간 평균(완전분할)', last_day: '최대 지연(M−1 말)',
  box_range: '박스권 적극구매 신호', box_full: '박스권 전량구매 신호', spot_month: '당월 시황(미선구매)', best: '최저(사후)', worst: '최고(사후)', actual: '실제 계약',
};

export interface MonthResult {
  shipment_month: string;
  window_from: string; window_to: string; window_days: number;
  prices: Partial<Record<Strategy, number | null>>;
  box_range_date: string | null; box_full_date: string | null;
  actual_qty: number | null;
  actual_percentile: number | null;   // 실제 계약가의 기간 내 백분위 (0=최저, 100=최고)
}
export interface StrategySummary {
  strategy: Strategy; label: string;
  months: number; avg_price: number | null;
  vs_spot_avg: number | null;      // spot_month − strategy (양수 = 절감)
  win_rate_vs_spot: number | null; // spot 보다 쌌던 비율 %
  avg_percentile: number | null;   // 기간 내 백분위 평균 (낮을수록 좋음)
  stdev: number | null;
}
export interface BacktestResult {
  product: string; from: string; to: string;
  months: MonthResult[];
  summary: StrategySummary[];
  by_year: { year: number; months: number; forward_3m: number | null; window_avg: number | null; box_range: number | null; spot_month: number | null; actual: number | null }[];
  note: string;
}

function ymAdd(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
function endOfMonth(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  return `${ym}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}`;
}
const avg = (xs: number[]) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const r1 = (x: number | null) => x == null ? null : Math.round(x * 10) / 10;
function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = avg(xs)!; return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
function percentile(values: number[], x: number): number | null {
  if (values.length < 3) return null;
  const below = values.filter(v => v < x).length, eq = values.filter(v => v === x).length;
  return Math.round(((below + eq * 0.5) / values.length) * 100);
}

// 박스권 신호: 해당 월물 일별 종가 series 에서 20일 이평·표준편차 기준 첫 진입일
function firstSignal(series: { date: string; p: number }[], k: number): { date: string; p: number } | null {
  for (let i = 19; i < series.length; i++) {
    const w = series.slice(i - 19, i + 1).map(s => s.p);
    const ma = avg(w)!; const sd = stdev(w) ?? 0;
    if (series[i].p <= ma - sd * k) return series[i];
  }
  return null;
}

export async function runBacktest(opts: { product?: string; from?: string; to?: string } = {}): Promise<BacktestResult> {
  const product = opts.product ?? 'RBD';
  const rows = await dbAll(
    `SELECT date::text AS date, contract_month, settlement_usd FROM fcpo_settlement
     WHERE settlement_usd > 100 ORDER BY contract_month, date`,
  ) as { date: string; contract_month: string; settlement_usd: number }[];
  const byMonth = new Map<string, { date: string; p: number }[]>();
  for (const r of rows) {
    const l = byMonth.get(r.contract_month) ?? []; l.push({ date: String(r.date).slice(0, 10), p: Number(r.settlement_usd) }); byMonth.set(r.contract_month, l);
  }
  const allMonths = [...byMonth.keys()].sort();
  const today = new Date().toISOString().slice(0, 7);
  const from = opts.from ?? (allMonths.find(m => m >= '2021-01') ?? allMonths[0]);
  const to = opts.to ?? ymAdd(today, -1); // 선적월이 끝난 달까지
  const targetMonths = allMonths.filter(m => m >= from && m <= to);

  // 실제 계약 (가중평균)
  const actualRows = await dbAll(
    `SELECT shipment_month, SUM(qty_mt) AS qty, SUM(qty_mt * unit_price) / NULLIF(SUM(qty_mt), 0) AS wavg
     FROM purchases WHERE product = ? AND shipment_month ~ '^[0-9]{4}-[0-9]{2}$' GROUP BY shipment_month`,
    [product],
  ) as { shipment_month: string; qty: number; wavg: number }[];
  const actual = new Map(actualRows.map(r => [r.shipment_month, { qty: Number(r.qty), wavg: Number(r.wavg) }]));

  const months: MonthResult[] = [];
  for (const M of targetMonths) {
    const series = byMonth.get(M)!;
    const wFrom = `${ymAdd(M, -3)}-01`, wTo = endOfMonth(ymAdd(M, -1));
    const win = series.filter(s => s.date >= wFrom && s.date <= wTo);
    if (win.length < 15) continue; // 계약 가능 기간 데이터 부족
    const firstOf = (ym: string) => win.find(s => s.date.startsWith(ym)) ?? null;
    const f3 = firstOf(ymAdd(M, -3)), f2 = firstOf(ymAdd(M, -2)), f1 = firstOf(ymAdd(M, -1));
    const splitPts = [f3, f2, f1].filter((x): x is { date: string; p: number } => !!x).map(x => x.p);
    const inMonth = series.filter(s => s.date.startsWith(M)).map(s => s.p);
    const sigA = firstSignal(win, 0.5), sigF = firstSignal(win, 1.0);
    const last = win[win.length - 1];
    const winPrices = win.map(s => s.p);
    const act = actual.get(M) ?? null;
    const prices: MonthResult['prices'] = {
      forward_3m: f3?.p ?? win[0].p,
      split_3: splitPts.length ? r1(avg(splitPts)) : null,
      window_avg: r1(avg(winPrices)),
      last_day: last.p,
      box_range: (sigA ?? last).p,
      box_full: (sigF ?? last).p,
      spot_month: inMonth.length ? r1(avg(inMonth)) : null,
      best: Math.min(...winPrices),
      worst: Math.max(...winPrices),
      actual: act ? r1(act.wavg) : null,
    };
    months.push({
      shipment_month: M, window_from: win[0].date, window_to: last.date, window_days: win.length,
      prices, box_range_date: sigA?.date ?? null, box_full_date: sigF?.date ?? null,
      actual_qty: act?.qty ?? null,
      actual_percentile: act ? percentile(winPrices, act.wavg) : null,
    });
  }

  const summary: StrategySummary[] = STRATEGIES.map(st => {
    const pairs = months.filter(m => m.prices[st] != null && m.prices.spot_month != null);
    const ps = pairs.map(m => m.prices[st] as number);
    const diffs = pairs.map(m => (m.prices.spot_month as number) - (m.prices[st] as number));
    const pcts = months.filter(m => m.prices[st] != null).map(m => {
      const series = byMonth.get(m.shipment_month)!.filter(s => s.date >= m.window_from && s.date <= m.window_to).map(s => s.p);
      return percentile(series, m.prices[st] as number);
    }).filter((v): v is number => v != null);
    return {
      strategy: st, label: STRATEGY_LABEL[st], months: ps.length,
      avg_price: r1(avg(ps)), vs_spot_avg: r1(avg(diffs)),
      win_rate_vs_spot: diffs.length ? Math.round((diffs.filter(d => d > 0).length / diffs.length) * 100) : null,
      avg_percentile: pcts.length ? Math.round(avg(pcts)!) : null,
      stdev: r1(stdev(ps)),
    };
  });

  const years = [...new Set(months.map(m => Number(m.shipment_month.slice(0, 4))))];
  const by_year = years.map(y => {
    const ms = months.filter(m => m.shipment_month.startsWith(String(y)));
    const a = (st: Strategy) => r1(avg(ms.map(m => m.prices[st]).filter((v): v is number => v != null)));
    return { year: y, months: ms.length, forward_3m: a('forward_3m'), window_avg: a('window_avg'), box_range: a('box_range'), spot_month: a('spot_month'), actual: a('actual') };
  });

  return {
    product, from, to, months, summary, by_year,
    note: '계약 가능 기간 = 선적월 3개월 전 1일 ~ 1개월 전 말. 박스권 신호는 해당 월물 자체의 20일 이평·표준편차 기준(도구 박스권 V3 근사). 물량 동일 가정, USD/MT.',
  };
}
