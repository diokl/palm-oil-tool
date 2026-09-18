import { dbAll } from './db';

// ── 리스크 정량화: 미확정 물량 노출 · 가격 VaR · 계획단가 추적 ──
//
// 1) 노출(미확정 물량): 재고관리 테이블의 예상소요 − 이미 계약된 통관(구매이력 자동 반영)으로
//    향후 N개월 재고 흐름을 그대로 따라가며, 기말재고가 0 아래로 내려가는 만큼을 '추가로 사야 하는 물량'으로 본다.
//    (실재고 반영값이 있으면 그 값에서 출발)
// 2) 가격 VaR: FCPO 최근월 일별 수익률의 60일 표준편차 → 리드타임(1·3개월) 동안의 95% 불리한 가격 변동
//    VaR = 1.645 × σ_daily × √영업일 × 현재가.  비용 리스크 = 미확정 물량 × VaR (USD, KRW 환산은 최신 USD/KRW)
// 3) 계획단가: mgd_config 의 plan_price_<PRODUCT> (USD/MT). 올해 선적분 실제 가중평균 + 잔여 물량을 현재가로 샀을 때의
//    연간 예상 평균단가 → 계획 대비 괴리와 예산 영향(USD·KRW).

export type Product = 'RBD' | 'RSPO' | 'MANAGED';
const PRODUCTS: Product[] = ['RBD', 'RSPO', 'MANAGED'];
const PREMIUM: Record<Product, number> = { RBD: 0, RSPO: 25, MANAGED: 65 }; // RBD 시황 대비 제품 프리미엄 (prebuy-effect 와 동일)

export interface MonthFlow { ym: string; usage: number; customs: number; ending: number; shortfall: number }
export interface ProductExposure {
  product: Product;
  horizon_months: number;
  flow: MonthFlow[];
  uncovered_kg: number;             // 재고 ≥ 0 유지에 필요한 추가 물량 (kg)
  first_shortage_ym: string | null;
  months_covered: number | null;    // 현재 재고+계약분으로 버티는 개월 수
  ref_price: number | null;         // 제품 기준 현재가 (RBD 시황 + 프리미엄)
  cost_now_usd: number | null;      // 미확정 물량 × 현재가
  var1m_usd: number | null; var3m_usd: number | null;
  var1m_krw: number | null; var3m_krw: number | null;
  plan: {
    plan_price: number | null;
    ytd_qty_mt: number; ytd_wavg: number | null;
    remaining_kg: number;             // 올해 잔여 소요 중 미계약분
    projected_avg: number | null;     // (YTD 금액 + 잔여×현재가) / 총량
    gap_vs_plan: number | null;       // projected − plan (USD/MT)
    budget_impact_usd: number | null; // gap × 총량
    budget_impact_krw: number | null;
  };
}
export interface RiskResult {
  as_of: string | null;
  fcpo_price: number | null; sigma_daily: number | null; var1m_pct: number | null; var3m_pct: number | null;
  usdkrw: number | null;
  products: ProductExposure[];
  signal: string;
}

const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, '0')}`;

export async function getExposureRisk(horizon = 6): Promise<RiskResult> {
  const now = new Date();
  const curY = now.getFullYear(), curM = now.getMonth() + 1;

  // ── 가격·변동성 ──
  const px = await dbAll(
    `SELECT date::text AS date, MIN(contract_month) AS cm FROM fcpo_settlement
     WHERE settlement_usd > 100 AND contract_month >= SUBSTRING(date::text,1,7)
     GROUP BY date ORDER BY date DESC LIMIT 90`,
  ) as { date: string; cm: string }[];
  let series: { date: string; p: number }[] = [];
  if (px.length) {
    const dates = px.map(r => String(r.date).slice(0, 10));
    const rows = await dbAll(
      `SELECT date::text AS date, contract_month, settlement_usd FROM fcpo_settlement WHERE settlement_usd > 100 AND date >= ?`,
      [dates[dates.length - 1]],
    ) as { date: string; contract_month: string; settlement_usd: number }[];
    const want = new Map(px.map(r => [String(r.date).slice(0, 10), r.cm]));
    series = rows.filter(r => want.get(String(r.date).slice(0, 10)) === r.contract_month)
      .map(r => ({ date: String(r.date).slice(0, 10), p: Number(r.settlement_usd) })).sort((a, b) => a.date.localeCompare(b.date));
  }
  const as_of = series.length ? series[series.length - 1].date : null;
  const fcpo = series.length ? series[series.length - 1].p : null;
  const rets: number[] = [];
  for (let i = Math.max(1, series.length - 60); i < series.length; i++) {
    // 월물 롤오버 점프 제외 (±8% 초과)
    const r = Math.log(series[i].p / series[i - 1].p);
    if (Math.abs(r) < 0.08) rets.push(r);
  }
  const sigma = rets.length >= 20 ? Math.sqrt(rets.reduce((s, r) => s + r * r, 0) / rets.length) : null; // 평균 0 가정
  const var1m_pct = sigma != null ? 1.645 * sigma * Math.sqrt(21) * 100 : null;
  const var3m_pct = sigma != null ? 1.645 * sigma * Math.sqrt(63) * 100 : null;

  const krwRow = await dbAll(`SELECT value FROM market_data WHERE series = 'USDKRW' ORDER BY date DESC LIMIT 1`) as { value: number }[];
  const usdkrw = krwRow[0]?.value != null ? Number(krwRow[0].value) : 1450;

  // ── 계획단가 ──
  const cfg = await dbAll(`SELECT key, value FROM mgd_config WHERE key LIKE 'plan_price_%'`) as { key: string; value: number }[];
  const planPrice = new Map(cfg.map(c => [c.key.replace('plan_price_', ''), Number(c.value)]));

  // ── 재고 흐름 ──
  const inv = await dbAll(
    `SELECT product, year, month, expected_usage, customs_volume, sales_volume, ending_stock, actual_ending_stock
     FROM inventory WHERE (year = ? OR year = ?) ORDER BY product, year, month`,
    [curY, curY + 1],
  ) as { product: Product; year: number; month: number; expected_usage: number | null; customs_volume: number | null; sales_volume: number | null; ending_stock: number | null; actual_ending_stock: number | null }[];

  const purch = await dbAll(
    `SELECT product, shipment_month, SUM(qty_mt) AS qty, SUM(qty_mt * unit_price) AS amt FROM purchases
     WHERE shipment_month >= ? AND shipment_month <= ? GROUP BY product, shipment_month`,
    [ymOf(curY, 1), ymOf(curY, 12)],
  ) as { product: Product; shipment_month: string; qty: number; amt: number }[];

  const products: ProductExposure[] = PRODUCTS.map(product => {
    const rows = inv.filter(r => r.product === product);
    const byYm = new Map(rows.map(r => [ymOf(r.year, r.month), r]));
    // 출발점: 전월 기말재고 (실재고 있으면 그 값)
    const prevYm = curM === 1 ? ymOf(curY - 1, 12) : ymOf(curY, curM - 1);
    const prevRow = byYm.get(prevYm);
    let stock = prevRow ? Number(prevRow.actual_ending_stock ?? prevRow.ending_stock ?? 0) : 0;
    if (!prevRow) {
      // 1월이면 전년 12월 행이 조회 범위 밖 → 이번 달 행의 기말재고에서 역산
      const cur = byYm.get(ymOf(curY, curM));
      if (cur) stock = Number(cur.ending_stock ?? 0) - Number(cur.customs_volume ?? 0) + Number(cur.expected_usage ?? 0) + Number(cur.sales_volume ?? 0);
    }
    const flow: MonthFlow[] = [];
    let cumShort = 0, firstShort: string | null = null, monthsCovered: number | null = null;
    for (let i = 0; i < horizon; i++) {
      const t = (curY * 12 + curM - 1) + i;
      const ym = ymOf(Math.floor(t / 12), (t % 12) + 1);
      const r = byYm.get(ym);
      const usage = Number(r?.expected_usage ?? 0), customs = Number(r?.customs_volume ?? 0), sales = Number(r?.sales_volume ?? 0);
      const actual = r?.actual_ending_stock;
      const ending = actual != null ? Number(actual) : stock + customs - usage - sales;
      const shortfall = ending < 0 ? -ending - cumShort : 0; // 이번 달에 새로 필요한 만큼 (누적 부족 증가분)
      if (shortfall > 0) { cumShort += shortfall; if (!firstShort) firstShort = ym; }
      if (monthsCovered == null && ending < 0) monthsCovered = i;
      flow.push({ ym, usage, customs, ending, shortfall: Math.max(0, shortfall) });
      stock = Math.max(ending, 0) + (ending < 0 ? 0 : 0); // 부족분은 구매로 메운다고 가정 → 다음 달은 0에서 시작
      if (ending < 0) stock = 0;
    }
    const uncovered_kg = Math.round(cumShort);
    const uncoveredMt = uncovered_kg / 1000;
    const ref = fcpo != null ? fcpo + PREMIUM[product] : null;
    const cost_now = ref != null ? Math.round(uncoveredMt * ref) : null;
    const var1 = ref != null && var1m_pct != null ? Math.round(uncoveredMt * ref * var1m_pct / 100) : null;
    const var3 = ref != null && var3m_pct != null ? Math.round(uncoveredMt * ref * var3m_pct / 100) : null;

    // 계획단가 추적 (올해 선적분)
    const yp = purch.filter(p => p.product === product);
    const ytdQty = yp.reduce((s, p) => s + Number(p.qty), 0);
    const ytdAmt = yp.reduce((s, p) => s + Number(p.amt), 0);
    const ytdWavg = ytdQty > 0 ? ytdAmt / ytdQty : null;
    // 잔여 = 올해 남은 달(이번 달 포함) 소요 − 그 달들의 계약 통관 (음수면 0)
    let remaining = 0;
    for (let m = curM; m <= 12; m++) {
      const r = byYm.get(ymOf(curY, m));
      remaining += Math.max(0, Number(r?.expected_usage ?? 0) - Number(r?.customs_volume ?? 0));
    }
    const remainingMt = remaining / 1000;
    const plan = planPrice.get(product) ?? null;
    const totalMt = ytdQty + remainingMt;
    const projected = totalMt > 0 && ref != null ? (ytdAmt + remainingMt * ref) / totalMt : ytdWavg;
    const gap = plan != null && projected != null ? projected - plan : null;
    return {
      product, horizon_months: horizon, flow, uncovered_kg,
      first_shortage_ym: firstShort, months_covered: monthsCovered,
      ref_price: ref, cost_now_usd: cost_now,
      var1m_usd: var1, var3m_usd: var3,
      var1m_krw: var1 != null ? Math.round(var1 * usdkrw) : null, var3m_krw: var3 != null ? Math.round(var3 * usdkrw) : null,
      plan: {
        plan_price: plan, ytd_qty_mt: Math.round(ytdQty * 10) / 10, ytd_wavg: ytdWavg != null ? Math.round(ytdWavg * 100) / 100 : null,
        remaining_kg: Math.round(remaining), projected_avg: projected != null ? Math.round(projected * 100) / 100 : null,
        gap_vs_plan: gap != null ? Math.round(gap * 100) / 100 : null,
        budget_impact_usd: gap != null ? Math.round(gap * totalMt) : null,
        budget_impact_krw: gap != null ? Math.round(gap * totalMt * usdkrw) : null,
      },
    };
  });

  const parts: string[] = [];
  for (const p of products) {
    if (p.uncovered_kg > 0) parts.push(`${p.product}: ${p.first_shortage_ym}부터 부족, 미확정 ${Math.round(p.uncovered_kg / 1000).toLocaleString()}톤 (현재가 $${p.cost_now_usd?.toLocaleString()}, 3개월 VaR95 $${p.var3m_usd?.toLocaleString()})`);
  }
  if (parts.length === 0) parts.push(`향후 ${horizon}개월 모든 제품 재고·계약분으로 커버됨`);
  if (var3m_pct != null) parts.push(`FCPO 3개월 95% 불리 변동 ±${var3m_pct.toFixed(1)}% (일 σ ${(sigma! * 100).toFixed(2)}%)`);

  return { as_of, fcpo_price: fcpo, sigma_daily: sigma != null ? Math.round(sigma * 10000) / 10000 : null, var1m_pct: var1m_pct != null ? Math.round(var1m_pct * 10) / 10 : null, var3m_pct: var3m_pct != null ? Math.round(var3m_pct * 10) / 10 : null, usdkrw, products, signal: parts.join('. ') + '.' };
}
