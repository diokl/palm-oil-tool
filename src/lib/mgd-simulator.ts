import { dbAll } from './db';
import {
  runSim, compareScenariosCore, sumBaseFromLocations, buildDemandMap,
  type SimInputs, type SimResult, type MonthlyDemand, type AdjRow,
} from './mgd-core';

// 관리팜유 투입 시뮬레이터 — DB 로더 + 코어 위임 래퍼.
// 순수 계산은 mgd-core.ts(브라우저/서버 공용). 여기서는 base/demand/adjustments를
// "한 번" 로드해 runSim()/compareScenariosCore()에 전달한다 (시나리오마다 재조회 X).

// 하위호환: 기존 import (constants/types) 재노출
export {
  MGD_QTY_KG, JUN_SALES_RPO, MONTHLY_DEMAND_DEFAULT, SCENARIOS,
  type SimResult, type DailyPoint, type SimInputs,
} from './mgd-core';

// 위치별 재고 합산 → 기초재고
export async function getBaseStock(): Promise<{ rpo: number; rspo: number }> {
  const rows = await dbAll(
    `SELECT product, qty_kg FROM stock_locations`,
  ).catch(() => []) as { product: string; qty_kg: number }[];
  return sumBaseFromLocations(rows);
}

// DB에서 월별 소요 로드 (없으면 기본값)
export async function loadMonthlyDemand(): Promise<MonthlyDemand> {
  const rows = await dbAll(
    `SELECT product, month, monthly_kg FROM demand_config`,
  ).catch(() => []) as { product: string; month: string; monthly_kg: number }[];
  return buildDemandMap(rows);
}

// 일별 조정 로드 (코어용 배열)
export async function loadDailyAdjustments(): Promise<AdjRow[]> {
  const rows = await dbAll(
    `SELECT date, product, delta_kg FROM daily_adjustments`,
  ).catch(() => []) as AdjRow[];
  return rows;
}

// base/demand/adjustments 1회 로드
export async function loadSimInputs(): Promise<SimInputs> {
  const [base, demand, adjustments] = await Promise.all([
    getBaseStock(), loadMonthlyDemand(), loadDailyAdjustments(),
  ]);
  return { base, demand, adjustments };
}

// 단건 시뮬 — 미리 로드한 inputs가 있으면 재사용
export async function simulate(injectDateStr: string, inputs?: SimInputs): Promise<SimResult> {
  const ins = inputs ?? await loadSimInputs();
  return runSim(injectDateStr, ins);
}

// 4안 비교 — 미리 로드한 inputs가 있으면 재사용 (DB 재조회 없음)
export async function compareScenarios(inputs?: SimInputs) {
  const ins = inputs ?? await loadSimInputs();
  return compareScenariosCore(ins);
}
