import { dbAll } from './db';

// ── 말레이시아 팜유 수급 밸런스 (MPOB 헤드라인 지표 → 재고/수출 비율 → 가격과 연결) ──
//
// 원천 (mpob_data):
//   closing_stock / TOTAL PALM OIL  : 월말 팜유 총재고 (CPO + 가공유), 톤
//   cpo_production / MALAYSIA       : CPO 생산량, 톤
//   export_product / PALM OIL       : 팜유 수출량, 톤
// 가격: fcpo_settlement 최근월물 종가(USD/MT)의 월평균
//
// 지표:
//   stock_export_ratio = 기말재고 ÷ 당월 수출  (수출 몇 개월치 재고인가 — 시장에서 가장 흔히 쓰는 '재고 커버리지')
//   implied_domestic   = 기초재고 + 생산 − 수출 − 기말재고  (수입을 무시한 추정 내수. 수입이 빠져 과소·음수 가능 → 참고용)
//   stock_use_ratio    = 기말재고 ÷ (수출 + max(추정내수, 0))
//   회귀: 가격 ~ a + b × stock_export_ratio (전 기간) → 수급 기준 적정가와 현재가의 괴리

export interface SdPoint {
  ym: string;             // YYYY-MM
  year: number;
  month: number;
  production: number | null;
  export: number | null;
  closing_stock: number | null;
  opening_stock: number | null;
  implied_domestic: number | null;
  stock_export_ratio: number | null;
  stock_use_ratio: number | null;
  price_usd: number | null;       // 최근월물 월평균 USD/MT
  production_yoy: number | null;  // %
  export_yoy: number | null;
  stock_yoy: number | null;
}

export interface SdRegression {
  n: number;
  slope: number;      // USD per 1.0 ratio
  intercept: number;
  r: number;          // 상관계수
  fair_price: number | null;     // 최신 비율 기준 적정가
  deviation_pct: number | null;  // (현재가 − 적정가) / 적정가
}

export interface SdSummary {
  latest: SdPoint | null;
  stock_percentile: number | null;      // 최신 재고의 전 기간 백분위 (0~100, 높을수록 재고 많음)
  ratio_percentile: number | null;      // 최신 재고/수출 비율의 백분위
  ratio_avg: number | null;             // 전 기간 평균 비율
  regression: SdRegression | null;
  months: number;                        // 3개 지표가 모두 있는 월 수
  signal: string;                        // 룰 기반 한 줄 해석
}

export interface SupplyDemandResult { series: SdPoint[]; summary: SdSummary }

const pct = (cur: number | null, prev: number | null | undefined): number | null =>
  cur != null && prev != null && prev !== 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null;

function percentile(values: number[], x: number): number | null {
  if (values.length < 3) return null;
  const below = values.filter(v => v < x).length;
  const equal = values.filter(v => v === x).length;
  return Math.round(((below + equal * 0.5) / values.length) * 100);
}

// 최근월물(nearest contract) 월평균 USD/MT
async function loadMonthlyPrice(fromYm: string): Promise<Map<string, number>> {
  const rows = await dbAll(
    `SELECT date::text AS date, MIN(contract_month) AS cm
     FROM fcpo_settlement
     WHERE settlement_usd IS NOT NULL AND settlement_usd > 100
       AND date >= ? AND contract_month >= SUBSTRING(date::text, 1, 7)
     GROUP BY date`,
    [`${fromYm}-01`],
  ) as { date: string; cm: string }[];
  if (rows.length === 0) return new Map();
  const prices = await dbAll(
    `SELECT date::text AS date, contract_month, settlement_usd FROM fcpo_settlement
     WHERE settlement_usd IS NOT NULL AND settlement_usd > 100 AND date >= ?`,
    [`${fromYm}-01`],
  ) as { date: string; contract_month: string; settlement_usd: number }[];
  const want = new Map(rows.map(r => [String(r.date).slice(0, 10), r.cm]));
  const acc = new Map<string, { s: number; n: number }>();
  for (const p of prices) {
    const d = String(p.date).slice(0, 10);
    if (want.get(d) !== p.contract_month) continue;
    const ym = d.slice(0, 7);
    const a = acc.get(ym) ?? { s: 0, n: 0 };
    a.s += Number(p.settlement_usd); a.n++;
    acc.set(ym, a);
  }
  return new Map([...acc].map(([ym, a]) => [ym, Math.round((a.s / a.n) * 10) / 10]));
}

export async function getSupplyDemand(): Promise<SupplyDemandResult> {
  const rows = await dbAll(
    `SELECT category, item_name, year, month, value FROM mpob_data
     WHERE (category = 'closing_stock' AND item_name = 'TOTAL PALM OIL')
        OR (category = 'cpo_production' AND item_name = 'MALAYSIA')
        OR (category = 'export_product' AND item_name = 'PALM OIL')
     ORDER BY year, month`,
  ) as { category: string; item_name: string; year: number; month: number; value: number | null }[];

  const byYm = new Map<string, { production: number | null; export: number | null; closing_stock: number | null }>();
  for (const r of rows) {
    const ym = `${r.year}-${String(r.month).padStart(2, '0')}`;
    const e = byYm.get(ym) ?? { production: null, export: null, closing_stock: null };
    const v = r.value != null ? Number(r.value) : null;
    if (r.category === 'closing_stock') e.closing_stock = v;
    else if (r.category === 'cpo_production') e.production = v;
    else e.export = v;
    byYm.set(ym, e);
  }
  const yms = [...byYm.keys()].sort();
  if (yms.length === 0) {
    return { series: [], summary: { latest: null, stock_percentile: null, ratio_percentile: null, ratio_avg: null, regression: null, months: 0, signal: 'MPOB 헤드라인 데이터 없음 — MPOB 탭에서 동기화(과거 백필)를 실행하세요.' } };
  }

  const price = await loadMonthlyPrice(yms[0]);

  const series: SdPoint[] = yms.map((ym) => {
    const [y, m] = ym.split('-').map(Number);
    const cur = byYm.get(ym)!;
    const prevYm = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
    const yoyYm = `${y - 1}-${String(m).padStart(2, '0')}`;
    const prev = byYm.get(prevYm);
    const yoy = byYm.get(yoyYm);
    const opening = prev?.closing_stock ?? null;
    const implied = opening != null && cur.production != null && cur.export != null && cur.closing_stock != null
      ? Math.round(opening + cur.production - cur.export - cur.closing_stock) : null;
    const ser = cur.closing_stock != null && cur.export ? Math.round((cur.closing_stock / cur.export) * 100) / 100 : null;
    const use = cur.export != null ? cur.export + Math.max(implied ?? 0, 0) : null;
    const sur = cur.closing_stock != null && use ? Math.round((cur.closing_stock / use) * 100) / 100 : null;
    return {
      ym, year: y, month: m,
      production: cur.production, export: cur.export, closing_stock: cur.closing_stock,
      opening_stock: opening, implied_domestic: implied,
      stock_export_ratio: ser, stock_use_ratio: sur,
      price_usd: price.get(ym) ?? null,
      production_yoy: pct(cur.production, yoy?.production),
      export_yoy: pct(cur.export, yoy?.export),
      stock_yoy: pct(cur.closing_stock, yoy?.closing_stock),
    };
  });

  // 최신 = 재고·수출이 모두 있는 마지막 월
  const complete = series.filter(p => p.closing_stock != null && p.export != null);
  const latest = complete.length ? complete[complete.length - 1] : (series[series.length - 1] ?? null);

  const stocks = series.map(p => p.closing_stock).filter((v): v is number => v != null);
  const ratios = series.map(p => p.stock_export_ratio).filter((v): v is number => v != null);
  const ratioAvg = ratios.length ? Math.round((ratios.reduce((s, v) => s + v, 0) / ratios.length) * 100) / 100 : null;

  // 회귀: 가격 ~ 재고/수출 비율
  let regression: SdRegression | null = null;
  const pts = series.filter(p => p.stock_export_ratio != null && p.price_usd != null) as (SdPoint & { stock_export_ratio: number; price_usd: number })[];
  if (pts.length >= 12) {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p.stock_export_ratio, 0) / n;
    const my = pts.reduce((s, p) => s + p.price_usd, 0) / n;
    let sxy = 0, sxx = 0, syy = 0;
    for (const p of pts) { const dx = p.stock_export_ratio - mx, dy = p.price_usd - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
    if (sxx > 0 && syy > 0) {
      const slope = sxy / sxx;
      const intercept = my - slope * mx;
      const r = sxy / Math.sqrt(sxx * syy);
      const fair = latest?.stock_export_ratio != null ? Math.round(intercept + slope * latest.stock_export_ratio) : null;
      const dev = fair && latest?.price_usd != null ? Math.round(((latest.price_usd - fair) / fair) * 1000) / 10 : null;
      regression = { n, slope: Math.round(slope * 10) / 10, intercept: Math.round(intercept), r: Math.round(r * 100) / 100, fair_price: fair, deviation_pct: dev };
    }
  }

  const stockPct = latest?.closing_stock != null ? percentile(stocks, latest.closing_stock) : null;
  const ratioPct = latest?.stock_export_ratio != null ? percentile(ratios, latest.stock_export_ratio) : null;

  // 룰 기반 해석
  const parts: string[] = [];
  if (latest?.stock_export_ratio != null && ratioAvg != null) {
    const rel = (latest.stock_export_ratio - ratioAvg) / ratioAvg;
    if (rel >= 0.2) parts.push(`재고/수출 ${latest.stock_export_ratio.toFixed(2)}개월 — 평균(${ratioAvg.toFixed(2)}) 대비 ${Math.round(rel * 100)}% 높음 → 공급 여유, 가격 하방 압력`);
    else if (rel <= -0.2) parts.push(`재고/수출 ${latest.stock_export_ratio.toFixed(2)}개월 — 평균(${ratioAvg.toFixed(2)}) 대비 ${Math.round(-rel * 100)}% 낮음 → 타이트, 가격 상방 압력`);
    else parts.push(`재고/수출 ${latest.stock_export_ratio.toFixed(2)}개월 — 평균(${ratioAvg.toFixed(2)}) 수준, 수급 균형`);
  }
  if (stockPct != null) parts.push(`총재고 백분위 ${stockPct}% (${stockPct >= 80 ? '역사적 고점권' : stockPct <= 20 ? '역사적 저점권' : '중간권'})`);
  if (regression?.fair_price && regression.deviation_pct != null) {
    const d = regression.deviation_pct;
    parts.push(`수급 적정가 $${regression.fair_price} 대비 현재 ${d > 0 ? '+' : ''}${d}% (${Math.abs(d) >= 8 ? (d > 0 ? '수급 대비 고평가 — 조정 리스크' : '수급 대비 저평가 — 매수 우호') : '적정 범위'}, r=${regression.r})`);
  }

  return {
    series,
    summary: {
      latest, stock_percentile: stockPct, ratio_percentile: ratioPct, ratio_avg: ratioAvg, regression,
      months: complete.length,
      signal: parts.length ? parts.join('. ') + '.' : '데이터 누적 중.',
    },
  };
}
