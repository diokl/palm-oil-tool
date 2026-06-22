import { dbAll } from './db';

// 관리팜유 투입 시뮬레이터
// 엑셀 '월별 재고수불(투입)' / '관리팜유 투입 시나리오' 로직 이식.
//
// 모델:
//  - 기존 RPO+RSPO 통합 재고를 영업일 일소요로 소진.
//  - 관리팜유(7,500톤)는 '투입 시작일'부터 통합 수요를 충당.
//  - 투입일이 이를수록 → 기존재고 미소진 잔량↑(판매·재배치 부담), 늦을수록 미소진↓.

// 2026 공휴일 (엑셀 명세)
const HOLIDAYS_2026 = new Set([
  '2026-06-03', // 지방선거
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-08-17', // 대체공휴일
  '2026-09-24', '2026-09-25', '2026-09-28', // 추석연휴
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
]);

// 월별 BOM 소요 (kg) — 엑셀 '월별 재고수불(투입)' BOM 플랜트(원주1100/익산1200/밀양1400) 합산
export const MONTHLY_DEMAND = {
  RPO:  { '2026-06': 2703297.5, '2026-07': 3130781.6, '2026-08': 2772958.3 },
  RSPO: { '2026-06': 659648.9,  '2026-07': 338544.2,  '2026-08': 201103.4 },
};

export const MGD_QTY_KG = 7500000;      // 관리팜유 7,500톤
export const JUN_SALES_RPO = 4000000;   // 6월 RPO 외부판매 4,000톤

function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false; // 주말
  return !HOLIDAYS_2026.has(ymd(d));
}
function addDay(d: Date, n = 1): Date {
  return new Date(d.getTime() + n * 86400000);
}
function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// 월별 영업일수
function businessDaysInMonth(monthK: string): number {
  const [y, m] = monthK.split('-').map(Number);
  let cnt = 0;
  let d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) { if (isBusinessDay(d)) cnt++; d = addDay(d); }
  return cnt;
}

export interface DailyPoint { date: string; rpo: number; rspo: number; combined: number; mgd: number | null; }
export interface SimResult {
  inject_date: string;
  base: { rpo: number; rspo: number; combined: number };
  // 투입일 시점 잔량(미소진)
  at_inject: { rpo: number; rspo: number; combined: number };
  unsold: number;            // 통합 미소진 (판매/재배치 필요)
  mgd_depletion: string | null;   // 관리팜유 소진예상일
  rpo_depletion: string | null;
  rspo_depletion: string | null;
  combined_depletion: string | null;
  daily: DailyPoint[];
}

// 위치별 재고 합산 → 기초재고
export async function getBaseStock(): Promise<{ rpo: number; rspo: number }> {
  const rows = await dbAll(
    `SELECT product, COALESCE(SUM(qty_kg),0) AS total FROM stock_locations GROUP BY product`,
  ) as { product: string; total: number }[];
  let rpo = 0, rspo = 0;
  for (const r of rows) {
    if (r.product === 'RPO') rpo = Number(r.total);
    else if (r.product === 'RSPO') rspo = Number(r.total);
  }
  // stock_locations 비어있으면 엑셀 기본값
  if (rpo === 0 && rspo === 0) { rpo = 9129327; rspo = 1456221; }
  return { rpo, rspo };
}

// 일소요 (해당 날짜의 월 소요 ÷ 그 달 영업일수)
// 9월 이후는 정의된 마지막 월(8월) 소요를 연장 적용 (엑셀 '8월 일평균 기준 추정' 동일)
function dailyDemand(product: 'RPO' | 'RSPO', d: Date): number {
  const mk = monthKey(d);
  const table = MONTHLY_DEMAND[product] as Record<string, number>;
  const monthDemand = table[mk] ?? table['2026-08']; // fallback: 8월 소요 연장
  if (!monthDemand) return 0;
  const bdays = businessDaysInMonth(mk);
  return bdays > 0 ? monthDemand / bdays : 0;
}

export async function simulate(injectDateStr: string): Promise<SimResult> {
  const base = await getBaseStock();
  const START = new Date(Date.UTC(2026, 5, 1)); // 6/1
  const END = new Date(Date.UTC(2026, 9, 31));  // 10/31
  const inject = new Date(injectDateStr + 'T00:00:00Z');

  let rpo = base.rpo, rspo = base.rspo;
  let mgd: number | null = null; // 투입 전 null
  let mgdStarted = false;
  const daily: DailyPoint[] = [];
  let rpoDep: string | null = null, rspoDep: string | null = null, combDep: string | null = null, mgdDep: string | null = null;
  let atInject = { rpo: base.rpo, rspo: base.rspo, combined: base.rpo + base.rspo };
  let injectCaptured = false;

  for (let d = new Date(START); d <= END; d = addDay(d)) {
    const dstr = ymd(d);
    const biz = isBusinessDay(d);

    // 6월 RPO 판매(4,000톤)는 6/15 1회 차감 (외부판매 시점 가정)
    if (dstr === '2026-06-15') rpo = Math.max(0, rpo - JUN_SALES_RPO);

    // 투입 시작일에 잔량 스냅샷 + 관리팜유 활성화
    if (!injectCaptured && dstr >= injectDateStr) {
      atInject = { rpo: Math.max(0, rpo), rspo: Math.max(0, rspo), combined: Math.max(0, rpo) + Math.max(0, rspo) };
      mgd = MGD_QTY_KG;
      mgdStarted = true;
      injectCaptured = true;
    }

    if (biz) {
      const dRpo = dailyDemand('RPO', d);
      const dRspo = dailyDemand('RSPO', d);
      if (mgdStarted && mgd != null && mgd > 0) {
        // 관리팜유 투입 후: 통합 수요를 관리팜유로 충당 (기존재고는 동결=미소진)
        mgd = Math.max(0, mgd - (dRpo + dRspo));
      } else {
        // 투입 전: 기존 RPO/RSPO 소진
        rpo = Math.max(0, rpo - dRpo);
        rspo = Math.max(0, rspo - dRspo);
      }
    }

    if (rpoDep == null && rpo <= 0) rpoDep = dstr;
    if (rspoDep == null && rspo <= 0) rspoDep = dstr;
    if (combDep == null && (rpo + rspo) <= 0) combDep = dstr;
    if (mgdStarted && mgdDep == null && mgd != null && mgd <= 0) mgdDep = dstr;

    daily.push({ date: dstr, rpo: Math.round(rpo), rspo: Math.round(rspo), combined: Math.round(rpo + rspo), mgd: mgd != null ? Math.round(mgd) : null });
  }

  return {
    inject_date: injectDateStr,
    base: { rpo: base.rpo, rspo: base.rspo, combined: base.rpo + base.rspo },
    at_inject: atInject,
    unsold: Math.round(atInject.combined),
    mgd_depletion: mgdDep,
    rpo_depletion: rpoDep,
    rspo_depletion: rspoDep,
    combined_depletion: combDep,
    daily,
  };
}

// 4개 시나리오 비교
export const SCENARIOS = [
  { id: 1, label: '1안 (7/15 투입)', date: '2026-07-15' },
  { id: 2, label: '2안 (7/24 투입)', date: '2026-07-24' },
  { id: 3, label: '3안 (소진후 7/30)', date: '2026-07-30' },
  { id: 4, label: '4안 (7/1 병행)', date: '2026-07-01' },
];

export async function compareScenarios() {
  const results = [];
  for (const s of SCENARIOS) {
    const sim = await simulate(s.date);
    results.push({ ...s, unsold: sim.unsold, at_inject: sim.at_inject, mgd_depletion: sim.mgd_depletion });
  }
  return results;
}
