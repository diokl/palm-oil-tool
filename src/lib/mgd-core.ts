// 관리팜유 투입 시뮬레이터 — 순수 계산 코어 (DB 의존 없음, 브라우저/서버 공용)
//
// 서버 라우트는 mgd-simulator.ts(DB 래퍼)가 base/demand/adjustments를 1회 로드해
// 이 모듈의 runSim()/recommendManaged()를 여러 번 호출한다. 동일 모듈을 page.tsx(client)에서도
// import 해 투입일/미세조정 변경 시 서버 왕복 없이 즉시 재계산한다.
//
// 모델:
//  - 기존 RPO+RSPO 통합 재고를 영업일 일소요로 소진.
//  - 관리팜유는 '투입 시작일'부터 통합 수요를 충당(기존재고 동결=미소진).
//  - 일별 미세조정: 롯데웰푸드(−, 비차감) / 판매·이송(+, 추가차감)을 일소요에 가감.

// 2026 공휴일 (엑셀 명세)
export const HOLIDAYS_2026 = new Set([
  '2026-06-03', // 지방선거
  '2026-06-06', // 현충일
  '2026-08-15', // 광복절
  '2026-08-17', // 대체공휴일
  '2026-09-24', '2026-09-25', '2026-09-28', // 추석연휴
  '2026-10-03', // 개천절
  '2026-10-09', // 한글날
]);

// 월별 BOM 소요 기본값 (DB demand_config 없을 때 fallback)
export const MONTHLY_DEMAND_DEFAULT = {
  RPO:  { '2026-06': 2703297.5, '2026-07': 3130781.6, '2026-08': 2772958.3 },
  RSPO: { '2026-06': 659648.9,  '2026-07': 338544.2,  '2026-08': 201103.4 },
};

export const MGD_QTY_KG = 7500000;      // 관리팜유 기확보 7,500톤
export const JUN_SALES_RPO = 4000000;   // 6월 RPO 외부판매 4,000톤

export type Product = 'RPO' | 'RSPO';
export interface MonthlyDemand { RPO: Record<string, number>; RSPO: Record<string, number>; }
export interface AdjRow { date: string; product: string; delta_kg: number; }
export interface SimInputs {
  base: { rpo: number; rspo: number };
  demand: MonthlyDemand;
  adjustments: AdjRow[];
}

export interface DailyPoint { date: string; rpo: number; rspo: number; combined: number; mgd: number | null; }
export interface SimResult {
  inject_date: string;
  base: { rpo: number; rspo: number; combined: number };
  at_inject: { rpo: number; rspo: number; combined: number };
  unsold: number;                  // 통합 미소진 (판매/재배치 필요)
  mgd_depletion: string | null;
  rpo_depletion: string | null;
  rspo_depletion: string | null;
  combined_depletion: string | null;
  daily: DailyPoint[];
}

export function ymd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function isBusinessDay(d: Date): boolean {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false; // 주말
  return !HOLIDAYS_2026.has(ymd(d));
}
export function addDay(d: Date, n = 1): Date {
  return new Date(d.getTime() + n * 86400000);
}
export function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
// 월별 영업일수
export function businessDaysInMonth(monthK: string): number {
  const [y, m] = monthK.split('-').map(Number);
  let cnt = 0;
  let d = new Date(Date.UTC(y, m - 1, 1));
  while (d.getUTCMonth() === m - 1) { if (isBusinessDay(d)) cnt++; d = addDay(d); }
  return cnt;
}

// 일소요 (해당 날짜의 월 소요 ÷ 그 달 영업일수)
// 9월 이후는 정의된 마지막 월(8월) 소요를 연장 적용 (엑셀 '8월 일평균 기준 추정' 동일)
export function dailyDemand(table: Record<string, number>, d: Date): number {
  const mk = monthKey(d);
  const monthDemand = table[mk] ?? table['2026-08']; // fallback: 8월 소요 연장
  if (!monthDemand) return 0;
  const bdays = businessDaysInMonth(mk);
  return bdays > 0 ? monthDemand / bdays : 0;
}

// 위치별 재고 행 → 통합 기초재고 {rpo, rspo}. 비어있으면 엑셀 기본값.
export function sumBaseFromLocations(rows: { product: string; qty_kg: number }[]): { rpo: number; rspo: number } {
  let rpo = 0, rspo = 0;
  for (const r of rows || []) {
    if (r.product === 'RPO') rpo += Number(r.qty_kg) || 0;
    else if (r.product === 'RSPO') rspo += Number(r.qty_kg) || 0;
  }
  if (rpo === 0 && rspo === 0) { rpo = 9129327; rspo = 1456221; }
  return { rpo, rspo };
}

// demand_config 행 → {RPO, RSPO} 월별 맵. 비어있으면 기본값.
export function buildDemandMap(rows: { product: string; month: string; monthly_kg: number }[]): MonthlyDemand {
  if (!rows || rows.length === 0) return JSON.parse(JSON.stringify(MONTHLY_DEMAND_DEFAULT));
  const out: MonthlyDemand = { RPO: {}, RSPO: {} };
  for (const r of rows) {
    if (r.product === 'RPO') out.RPO[r.month] = Number(r.monthly_kg);
    else if (r.product === 'RSPO') out.RSPO[r.month] = Number(r.monthly_kg);
  }
  return out;
}

// adjustments 배열 → Map<`${date}|${product}`, Σdelta_kg>
export function buildAdjMap(rows: AdjRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows || []) {
    const k = `${r.date}|${r.product}`;
    map.set(k, (map.get(k) || 0) + Number(r.delta_kg || 0));
  }
  return map;
}

// 순수 시뮬레이션 — DB 호출 없음. injectDate에 managed qty(기본 7,500톤) 투입.
export function runSim(injectDateStr: string, inputs: SimInputs, mgdQtyKg: number = MGD_QTY_KG): SimResult {
  const { base, demand } = inputs;
  const adjustments = buildAdjMap(inputs.adjustments);
  const START = new Date(Date.UTC(2026, 5, 1)); // 6/1
  const END = new Date(Date.UTC(2026, 11, 31)); // 12/31

  let rpo = base.rpo, rspo = base.rspo;
  let mgd: number | null = null;
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
      mgd = mgdQtyKg;
      mgdStarted = true;
      injectCaptured = true;
    }

    if (biz) {
      // 일소요 = 월소요/영업일 + 일별 조정(정제사 이송/롯데웰푸드 등). 음수면 소진 감소.
      const adjRpo = adjustments.get(`${dstr}|RPO`) || 0;
      const adjRspo = adjustments.get(`${dstr}|RSPO`) || 0;
      const dRpo = Math.max(0, dailyDemand(demand.RPO, d) + adjRpo);
      const dRspo = Math.max(0, dailyDemand(demand.RSPO, d) + adjRspo);
      if (mgdStarted && mgd != null && mgd > 0) {
        // 관리팜유 투입 후: 통합 수요를 관리팜유로 충당 (기존재고 동결=미소진)
        mgd = Math.max(0, mgd - (dRpo + dRspo));
      } else {
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

// 4개 시나리오
export const SCENARIOS = [
  { id: 1, label: '1안 (7/15 투입)', date: '2026-07-15' },
  { id: 2, label: '2안 (7/24 투입)', date: '2026-07-24' },
  { id: 3, label: '3안 (소진후 7/30)', date: '2026-07-30' },
  { id: 4, label: '4안 (7/1 병행)', date: '2026-07-01' },
];

export interface ScenarioResult {
  id: number; label: string; date: string;
  unsold: number;
  at_inject: { rpo: number; rspo: number; combined: number };
  mgd_depletion: string | null;
}

// 동일 입력으로 4개 시나리오를 한 번에 계산 (DB 재조회 없음)
export function compareScenariosCore(inputs: SimInputs, mgdQtyKg: number = MGD_QTY_KG): ScenarioResult[] {
  return SCENARIOS.map((s) => {
    const sim = runSim(s.date, inputs, mgdQtyKg);
    return { id: s.id, label: s.label, date: s.date, unsold: sim.unsold, at_inject: sim.at_inject, mgd_depletion: sim.mgd_depletion };
  });
}

// ============ 7월/8월 선적 매입 추천 ============
// 상시 3개월 선행소요 유지 목표. 관리팜유 도착: 7월선적→8월, 8월선적→9월 (leadMonths).
// 8월초·9월초 시점에 통합 가용재고가 향후 3개월 소요 이상이 되도록 선적별 필요량을 순차 산출.

export interface RecoConfig {
  julyCapKg: number;     // 7월선적 선적스페이스 한도 (기본 6,000톤)
  committedKg: number;   // 기확보 관리팜유 (기본 7,500톤)
  coverageMonths: number; // 목표 선행소요 개월수 (기본 3)
  leadMonths: number;     // 선적→가용 리드타임 개월 (기본 1)
}
export const RECO_DEFAULT: RecoConfig = { julyCapKg: 6000000, committedKg: MGD_QTY_KG, coverageMonths: 3, leadMonths: 1 };

export interface RecoCheckpoint {
  month: string;          // 가용(입고) 월초 'YYYY-MM'
  shipment: string;       // '7월선적' | '8월선적'
  shipMonth: string;      // 선적 월 'YYYY-MM'
  coverageNeed: number;   // 향후 N개월 소요 합 (kg)
  availBefore: number;    // 이 선적분 도착 직전 가용재고 (kg)
  need: number;           // 목표 충족에 필요한 추가량 (kg, 음수 없음)
  buy: number;            // 실제 추천 매입(선적스페이스 한도 반영, kg)
  capped: boolean;        // 한도에 걸려 부족분 발생 여부
}
export interface RecoMonth { month: string; availStart: number; coverageNeed: number; coverageMonths: number; }
export interface RecoResult {
  config: RecoConfig;
  baseCombined: number;
  checkpoints: RecoCheckpoint[];
  totalNeed: number;      // 추천 총 매입 (july+aug, kg)
  committedKg: number;
  diffVsCommitted: number; // committed - totalNeed (음수=부족)
  byMonth: RecoMonth[];    // 6~12월 커버리지 추이
}

function addMonth(mk: string, n: number): string {
  const [y, m] = mk.split('-').map(Number);
  const total = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}
// 월 통합 소요 (RPO+RSPO). 정의된 마지막 월(8월) 이후는 8월값 연장.
function monthCombinedDemand(demand: MonthlyDemand, mk: string): number {
  const rpo = demand.RPO[mk] ?? demand.RPO['2026-08'] ?? 0;
  const rspo = demand.RSPO[mk] ?? demand.RSPO['2026-08'] ?? 0;
  return rpo + rspo;
}

export function recommendManaged(inputs: SimInputs, cfg: RecoConfig = RECO_DEFAULT): RecoResult {
  const { base, demand } = inputs;
  const baseCombined = base.rpo + base.rspo;
  const cov = Math.max(1, cfg.coverageMonths);

  // 월별 조정 합산 (date prefix 'YYYY-MM')
  const monthAdj = new Map<string, number>();
  for (const a of inputs.adjustments || []) {
    const mk = String(a.date).slice(0, 7);
    monthAdj.set(mk, (monthAdj.get(mk) || 0) + Number(a.delta_kg || 0));
  }

  // 월 소진 (조정 반영, 6월 외부판매 포함)
  const deplete = (mk: string): number => {
    let d = monthCombinedDemand(demand, mk) + (monthAdj.get(mk) || 0);
    if (mk === '2026-06') d += JUN_SALES_RPO;
    return Math.max(0, d);
  };
  // 향후 cov개월 소요 합
  const coverageNeed = (mk: string): number => {
    let s = 0;
    for (let k = 0; k < cov; k++) s += monthCombinedDemand(demand, addMonth(mk, k));
    return s;
  };
  // 관리팜유 없을 때 월초 가용 (= base - 직전월까지 누적소진)
  const cumDepBefore = (mk: string): number => {
    let s = 0;
    let m = '2026-06';
    while (m < mk) { s += deplete(m); m = addMonth(m, 1); }
    return s;
  };
  const a0 = (mk: string): number => baseCombined - cumDepBefore(mk);

  const julyAvail = addMonth('2026-07', cfg.leadMonths); // 7월선적 가용월 (기본 8월)
  const augAvail = addMonth('2026-08', cfg.leadMonths);  // 8월선적 가용월 (기본 9월)

  // 8월초: 7월선적분만 도움. 9월초: 7+8월선적분.
  const needJulyMonth = Math.max(0, coverageNeed(julyAvail) - a0(julyAvail));
  const july = Math.min(cfg.julyCapKg, needJulyMonth);
  const needAugMonth = Math.max(0, coverageNeed(augAvail) - (a0(augAvail) + july));
  const aug = needAugMonth;
  const totalNeed = july + aug;

  const checkpoints: RecoCheckpoint[] = [
    {
      month: julyAvail, shipment: '7월선적', shipMonth: '2026-07',
      coverageNeed: Math.round(coverageNeed(julyAvail)), availBefore: Math.round(a0(julyAvail)),
      need: Math.round(needJulyMonth), buy: Math.round(july), capped: needJulyMonth > cfg.julyCapKg + 0.5,
    },
    {
      month: augAvail, shipment: '8월선적', shipMonth: '2026-08',
      coverageNeed: Math.round(coverageNeed(augAvail)), availBefore: Math.round(a0(augAvail) + july),
      need: Math.round(needAugMonth), buy: Math.round(aug), capped: false,
    },
  ];

  // 6~12월 커버리지 추이 (최종 july/aug 반영)
  const byMonth: RecoMonth[] = [];
  for (let i = 0; i < 7; i++) {
    const mk = addMonth('2026-06', i);
    const arrived = (mk >= julyAvail ? july : 0) + (mk >= augAvail ? aug : 0);
    const availStart = baseCombined + arrived - cumDepBefore(mk);
    const need = coverageNeed(mk);
    byMonth.push({
      month: mk,
      availStart: Math.round(availStart),
      coverageNeed: Math.round(need),
      coverageMonths: need > 0 ? Math.max(0, availStart) / (need / cov) : 0,
    });
  }

  return {
    config: cfg,
    baseCombined: Math.round(baseCombined),
    checkpoints,
    totalNeed: Math.round(totalNeed),
    committedKg: cfg.committedKg,
    diffVsCommitted: Math.round(cfg.committedKg - totalNeed),
    byMonth,
  };
}
