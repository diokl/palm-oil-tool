import { dbAll } from './db';

// ── 월물 곡선 (Term Structure) 분석 ──
//
// fcpo_settlement 의 날짜×월물 시세로 기준일의 곡선(근월→원월)을 만들고
//   - 구조: backwardation(근월 > 원월) / contango(근월 < 원월) / flat / mixed
//   - 근월 대비 스프레드(USD, %), 월당 캐리(USD/MT/월)
//   - 스프레드(M1−M3)의 과거 추이와 백분위
//   - 1주 전·1개월 전 곡선과 비교
// 를 계산한다. 선적월 선택("지금 근월을 살지, 원월을 계약할지")의 근거.
//
// 주의: BMD RBD PALM OIL 호가는 M1~M3 + 분기(Q1~Q3)를 월로 펼친 것이라 4개월 이후는 분기 단위로 같은 값이 반복된다.

export interface CurvePoint {
  contract_month: string;
  price: number;
  months_ahead: number;          // 근월 기준 몇 개월 뒤
  spread_vs_front: number;       // price − M1
  pct_vs_front: number;          // (price/M1 − 1)×100
  carry_per_month: number | null; // spread / months_ahead
}
export interface HistoryPoint {
  date: string;
  m1: number | null; m2: number | null; m3: number | null; far: number | null;
  spread_m1_m3: number | null;   // M3 − M1 (음수 = 백워데이션)
  spread_m1_far: number | null;
}
export type Structure = 'backwardation' | 'contango' | 'flat' | 'mixed';

export interface TermStructureResult {
  as_of: string | null;
  front_month: string | null;
  curve: CurvePoint[];
  structure: Structure | null;
  spread_m1_m3: number | null;
  spread_m1_far: number | null;
  spread_m1_m3_percentile: number | null;  // 과거 대비 (0=가장 백워데이션, 100=가장 콘탱고)
  cheapest: CurvePoint | null;
  compare: { week_ago: { as_of: string; curve: CurvePoint[] } | null; month_ago: { as_of: string; curve: CurvePoint[] } | null };
  history: HistoryPoint[];
  advice: string;
}

interface Row { date: string; contract_month: string; usd: number }

function monthsBetween(a: string, b: string): number {
  const [ay, am] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number);
  return (by - ay) * 12 + (bm - am);
}
function addDays(d: string, n: number): string {
  return new Date(new Date(d + 'T00:00:00Z').getTime() + n * 86400000).toISOString().slice(0, 10);
}

function buildCurve(rows: Row[], date: string): CurvePoint[] {
  const ym = date.slice(0, 7);
  const pts = rows.filter(r => r.contract_month >= ym).sort((a, b) => a.contract_month.localeCompare(b.contract_month));
  if (pts.length === 0) return [];
  const front = pts[0];
  return pts.map(p => {
    const ma = monthsBetween(front.contract_month, p.contract_month);
    const spread = Math.round((p.usd - front.usd) * 100) / 100;
    return {
      contract_month: p.contract_month,
      price: p.usd,
      months_ahead: ma,
      spread_vs_front: spread,
      pct_vs_front: Math.round((p.usd / front.usd - 1) * 1000) / 10,
      carry_per_month: ma > 0 ? Math.round((spread / ma) * 100) / 100 : null,
    };
  });
}

function classify(curve: CurvePoint[], tol = 2.5): Structure | null {
  if (curve.length < 2) return null;
  const last = curve[curve.length - 1];
  const diffs: number[] = [];
  for (let i = 1; i < curve.length; i++) diffs.push(curve[i].price - curve[i - 1].price);
  const ups = diffs.filter(d => d > tol).length, downs = diffs.filter(d => d < -tol).length;
  if (ups > 0 && downs > 0) return 'mixed';
  if (last.spread_vs_front < -tol) return 'backwardation';
  if (last.spread_vs_front > tol) return 'contango';
  return 'flat';
}

function percentile(values: number[], x: number): number | null {
  if (values.length < 5) return null;
  const below = values.filter(v => v < x).length, eq = values.filter(v => v === x).length;
  return Math.round(((below + eq * 0.5) / values.length) * 100);
}

export async function getTermStructure(asOf?: string, historyDays = 180): Promise<TermStructureResult> {
  // 기준일 = 월물이 3개 이상 있는 가장 최근 거래일 (텍스트 수동입력은 2개 월물만 들어오는 날이 있어 곡선이 안 만들어짐)
  const latestRow = await dbAll(
    `SELECT date::text AS d FROM fcpo_settlement
     WHERE settlement_usd > 100 ${asOf ? 'AND date <= ?' : ''}
     GROUP BY date HAVING COUNT(DISTINCT contract_month) >= 3
     ORDER BY date DESC LIMIT 1`,
    asOf ? [asOf] : [],
  ) as { d: string | null }[];
  const as_of = latestRow[0]?.d ? String(latestRow[0].d).slice(0, 10) : null;
  const empty: TermStructureResult = { as_of: null, front_month: null, curve: [], structure: null, spread_m1_m3: null, spread_m1_far: null, spread_m1_m3_percentile: null, cheapest: null, compare: { week_ago: null, month_ago: null }, history: [], advice: 'FCPO 시세 데이터가 없습니다.' };
  if (!as_of) return empty;

  const from = addDays(as_of, -historyDays);
  const raw = await dbAll(
    `SELECT date::text AS date, contract_month, settlement_usd FROM fcpo_settlement
     WHERE settlement_usd > 100 AND date >= ? AND date <= ? ORDER BY date, contract_month`,
    [from, as_of],
  ) as { date: string; contract_month: string; settlement_usd: number }[];
  const byDate = new Map<string, Row[]>();
  for (const r of raw) {
    const d = String(r.date).slice(0, 10);
    const list = byDate.get(d) ?? [];
    list.push({ date: d, contract_month: r.contract_month, usd: Number(r.settlement_usd) });
    byDate.set(d, list);
  }
  const dates = [...byDate.keys()].sort();

  // 과거 추이
  const history: HistoryPoint[] = dates.map(d => {
    const c = buildCurve(byDate.get(d)!, d);
    const m1 = c[0]?.price ?? null, m2 = c[1]?.price ?? null, m3 = c[2]?.price ?? null, far = c.length ? c[c.length - 1].price : null;
    return {
      date: d, m1, m2, m3, far,
      spread_m1_m3: m1 != null && m3 != null ? Math.round((m3 - m1) * 100) / 100 : null,
      spread_m1_far: m1 != null && far != null ? Math.round((far - m1) * 100) / 100 : null,
    };
  });

  const curve = buildCurve(byDate.get(as_of) ?? [], as_of);
  if (curve.length === 0) return { ...empty, as_of };
  const structure = classify(curve);
  const m1 = curve[0], m3 = curve[2] ?? null, far = curve[curve.length - 1];
  const spread13 = m3 ? Math.round((m3.price - m1.price) * 100) / 100 : null;
  const spreadFar = Math.round((far.price - m1.price) * 100) / 100;
  const hist13 = history.map(h => h.spread_m1_m3).filter((v): v is number => v != null);
  const pct13 = spread13 != null ? percentile(hist13, spread13) : null;
  const cheapest = curve.reduce((a, b) => (b.price < a.price ? b : a), curve[0]);

  const nearest = (target: string) => { const ds = dates.filter(d => d <= target); return ds.length ? ds[ds.length - 1] : null; };
  const wk = nearest(addDays(as_of, -7)), mo = nearest(addDays(as_of, -30));
  const compare = {
    week_ago: wk && wk !== as_of ? { as_of: wk, curve: buildCurve(byDate.get(wk)!, wk) } : null,
    month_ago: mo && mo !== as_of ? { as_of: mo, curve: buildCurve(byDate.get(mo)!, mo) } : null,
  };

  // 해석
  const parts: string[] = [];
  const carry3 = m3?.carry_per_month ?? far.carry_per_month ?? null;
  if (structure === 'backwardation') {
    parts.push(`백워데이션: 근월(${m1.contract_month}) $${m1.price} > 원월(${far.contract_month}) $${far.price} (${spreadFar}). 시장이 지금 물량을 타이트하게 봄`);
    parts.push(`선적을 뒤로 미룰수록 단가가 낮음 (M3 기준 월당 ${carry3 != null ? carry3 : '-'}$/MT). 재고 커버가 허용되면 원월 계약이 유리, 대신 근월 급등 리스크는 재고로 방어`);
  } else if (structure === 'contango') {
    parts.push(`콘탱고: 원월(${far.contract_month}) $${far.price} > 근월(${m1.contract_month}) $${m1.price} (+${spreadFar}). 시장이 지금 물량을 여유 있게 봄`);
    parts.push(`원월을 선계약하면 월당 ${carry3 != null ? carry3 : '-'}$/MT 프리미엄을 미리 내는 셈. 근월 위주 구매 + 원월은 가격 조정 시 분할이 유리`);
  } else if (structure === 'flat') {
    parts.push(`플랫: 근월과 원월 차이 ${spreadFar}$/MT 이내. 선적월 선택보다 절대가격 수준(박스권)이 판단 기준`);
  } else if (structure === 'mixed') {
    parts.push(`혼합: 근월 구간과 원월 구간의 방향이 다름 (M1 $${m1.price} / M3 $${m3?.price ?? '-'} / 원월 $${far.price}). 가장 싼 월물은 ${cheapest.contract_month} $${cheapest.price}`);
  }
  if (pct13 != null) parts.push(`M1−M3 스프레드 ${spread13}$ 는 최근 ${historyDays}일 중 백분위 ${pct13}% (${pct13 <= 20 ? '백워데이션 심화 구간' : pct13 >= 80 ? '콘탱고 심화 구간' : '보통'})`);
  if (compare.month_ago && compare.month_ago.curve.length) {
    const prevFar = compare.month_ago.curve[compare.month_ago.curve.length - 1];
    const prevM1 = compare.month_ago.curve[0];
    const prevSpread = Math.round((prevFar.price - prevM1.price) * 100) / 100;
    const dir = spreadFar - prevSpread;
    if (Math.abs(dir) >= 5) parts.push(`1개월 전 대비 근월−원월 스프레드 ${dir > 0 ? '확대' : '축소'} (${prevSpread} → ${spreadFar})`);
  }

  return {
    as_of, front_month: m1.contract_month, curve, structure,
    spread_m1_m3: spread13, spread_m1_far: spreadFar, spread_m1_m3_percentile: pct13,
    cheapest, compare, history,
    advice: parts.join('. ') + '.',
  };
}
