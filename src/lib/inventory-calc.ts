import { dbAll, dbGet, dbRun, dbBatchRun } from './db';
import type { InventoryRow, Alert, Product } from './types';

// ── purchases → inventory.customs_volume 자동 동기화 ──
//
// 선적월(shipment_month) + 1M = 통관월(customs month) 규칙으로 inventory.customs_volume에
// SUM(purchases.qty_mt)를 반영. recalcInventory()를 후행 호출해 ending_stock/coverage_days도 갱신.
// purchases POST/PUT/DELETE/bulk 직후 호출되어 단일 진실 공급원(purchases)이 유지되도록 함.

function shipmentToCustomsMonth(shipmentMonth: string): { year: number; month: number } | null {
  const m = shipmentMonth.match(/^(\d{4})-(\d{2})$/);
  if (!m) return null;
  const sy = parseInt(m[1], 10);
  const sm = parseInt(m[2], 10);
  let cy = sy;
  let cm = sm + 1;
  if (cm > 12) { cm = 1; cy += 1; }
  return { year: cy, month: cm };
}

// 단일 (product, customs_month) inventory row를 purchases SUM으로 갱신 + 연도 재계산.
export async function syncCustomsVolumeFromPurchases(
  product: Product,
  shipmentMonth: string,
): Promise<void> {
  const customs = shipmentToCustomsMonth(shipmentMonth);
  if (!customs) return;

  const row = await dbGet(
    `SELECT COALESCE(SUM(qty_mt), 0) AS total_qty
     FROM purchases
     WHERE product = ? AND shipment_month = ?`,
    [product, shipmentMonth],
  ) as { total_qty: number };
  // 단위 변환: purchases.qty_mt 는 MT 단위, inventory.customs_volume 은 kg 단위 (× 1000)
  const totalKg = (Number(row?.total_qty) || 0) * 1000;

  // inventory 행이 없으면 새로 생성 (예상소요량 등은 NULL로). 있으면 customs_volume만 덮어씀.
  await dbRun(
    `INSERT INTO inventory (product, year, month, customs_volume, updated_by, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON CONFLICT (product, year, month) DO UPDATE SET
       customs_volume = EXCLUDED.customs_volume,
       updated_at     = NOW(),
       updated_by     = EXCLUDED.updated_by`,
    [product, customs.year, customs.month, totalKg, 'purchase_autosync'],
  );

  await recalcInventory(product, customs.year);
  // 12월 통관이면 다음 해 기초재고가 바뀌므로 다음 해도 재계산
  if (customs.month === 12) {
    const dec = await dbGet(
      `SELECT ending_stock FROM inventory WHERE product = ? AND year = ? AND month = 12`,
      [product, customs.year],
    ) as { ending_stock: number } | undefined;
    await recalcInventory(product, customs.year + 1, Number(dec?.ending_stock ?? 0));
  }
}

// 여러 (product, shipment_month)에 대해 중복 제거 후 일괄 동기화.
export async function syncCustomsVolumeForShipments(
  affected: Array<{ product: Product; shipment_month: string }>,
): Promise<void> {
  const seen = new Set<string>();
  for (const a of affected) {
    if (!a.product || !a.shipment_month) continue;
    const key = `${a.product}|${a.shipment_month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await syncCustomsVolumeFromPurchases(a.product, a.shipment_month);
  }
}

export async function recalcInventory(
  product: Product,
  year: number,
  prevYearEndingStock?: number,
  /** If rows are already fetched, pass them to skip a SELECT round trip */
  prefetchedRows?: InventoryRow[],
): Promise<InventoryRow[]> {
  const rows = prefetchedRows ?? await dbAll(
    `SELECT * FROM inventory WHERE product = ? AND year = ? ORDER BY month ASC`,
    [product, year]
  ) as InventoryRow[];

  if (rows.length === 0) return rows;

  if (prevYearEndingStock === undefined) {
    const prev = await dbGet(
      `SELECT ending_stock FROM inventory WHERE product = ? AND year = ? AND month = 12`,
      [product, year - 1]
    ) as { ending_stock: number } | undefined;
    prevYearEndingStock = prev?.ending_stock ?? 0;
  }

  // Calculate all values in memory first
  let prevStock = prevYearEndingStock;
  const updates: { id: number; endingStock: number; coverageDays: number }[] = [];

  for (const row of rows) {
    const usage = Number(row.expected_usage ?? 0);
    const customs = Number(row.customs_volume ?? 0);
    const sales = Number(row.sales_volume ?? 0);  // 외부 판매 출고
    // 실재고(actual_ending_stock)가 입력된 달은 계산값 대신 실재고를 기말재고로 채택하고
    // 다음 달부터 그 값을 기준으로 이어서 계산한다 (엑셀 '삼양베이커수불 재고 적용' 하드코딩과 동일).
    const actual = row.actual_ending_stock;
    const endingStock = actual != null && actual !== undefined && !Number.isNaN(Number(actual))
      ? Number(actual)
      : prevStock + customs - usage - sales;
    const coverageDays = usage > 0 ? Math.round((endingStock / usage) * 10) / 10 : 0;
    updates.push({ id: row.id!, endingStock, coverageDays });
    prevStock = endingStock;
  }

  // Write all updates in a single batch transaction
  await dbBatchRun(
    updates.map(u => ({
      sql: `UPDATE inventory SET ending_stock = ?, coverage_days = ?, updated_at = NOW() WHERE id = ?`,
      params: [u.endingStock, u.coverageDays, u.id],
    }))
  );

  // Return updated rows (apply calculated values in memory — skip extra SELECT)
  return rows.map((row, i) => ({
    ...row,
    ending_stock: updates[i].endingStock,
    coverage_days: updates[i].coverageDays,
  }));
}

// persist=false 면 DB 기록 없이 계산만 (대시보드 30초 폴링용).
// 기록은 /api/alerts 에서만, 그리고 활성 알람 내용이 바뀐 경우에만 한다.
// (이전: 모든 호출마다 'UPDATE alerts SET is_active=0 WHERE 1=1' + INSERT → 동시 요청이 행 잠금 대기로 줄을 서서
//  DB 커넥션이 전부 묶이는 장애가 있었음)
// ── 선행 커버(개월) ──
// 기준월 기말재고가 '그 다음 달부터'의 예상소요를 몇 개월 감당하는지 (분수 포함). 통관 예정량은 넣지 않는다 — 지금 재고만의 소진 기간.
// 재고회전(기말재고 ÷ 당월 소요, 엑셀 재고회전일)은 소요가 달라지는 구간에서 실제 소진 기간과 어긋난다:
//  · 관리팜유 RPO 10월 투입 개시 → 9월 소요 0 → 회전 0
//  · 관리팜유 RSPO 10월부터 RPO/RSPO 구분 투입 → 소요 월 2,496톤 → 520톤, 9월 소요 기준 회전 0.6 이지만 실제는 3개월+
// 그래서 대시보드 카드와 구매 알람은 이 값을 기준으로 한다. 소요 0인 달은 건너뛴다. rows 는 year, month 오름차순이어야 한다.
export interface ForwardCoverage {
  months: number;              // 소수 1자리
  capped: boolean;             // 데이터 범위 끝까지 재고가 남음 → 실제 커버는 더 김 (하한값)
  usage_start: string | null;  // 다음 소요 발생 월 'YYYY-MM' (없으면 null)
  next_usage: number | null;   // 그 달의 예상소요(kg)
  evaluable: boolean;          // 향후 소요 데이터가 있어 계산 가능한지
}
export function forwardCoverage(
  rows: { year: number; month: number; expected_usage: number | null }[],
  base: { year: number; month: number; ending_stock: number | null },
): ForwardCoverage {
  const baseIdx = base.year * 12 + base.month;
  let stock = Number(base.ending_stock ?? 0);
  let months = 0;
  let usageStart: string | null = null;
  let nextUsage: number | null = null;
  let exhausted = false;
  for (const r of rows) {
    if (r.year * 12 + r.month <= baseIdx) continue;
    const u = Number(r.expected_usage ?? 0);
    if (u <= 0) continue;
    if (!usageStart) { usageStart = `${r.year}-${String(r.month).padStart(2, '0')}`; nextUsage = u; }
    if (stock >= u) { months += 1; stock -= u; }
    else { months += stock / u; exhausted = true; break; }
  }
  return { months: Math.round(months * 10) / 10, capped: !exhausted, usage_start: usageStart, next_usage: nextUsage, evaluable: usageStart !== null };
}

export async function generateAlerts(persist = false): Promise<Alert[]> {
  const alerts: Alert[] = [];

  for (const product of ['RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'] as const) {
    const rows = await dbAll(
      `SELECT * FROM inventory WHERE product = ? ORDER BY year ASC, month ASC`,
      [product]
    ) as InventoryRow[];

    const depletionRow = rows.find(r => r.ending_stock !== null && r.ending_stock < 0);

    if (!depletionRow) {
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const currentRow = rows.find(r => r.year === currentYear && r.month === currentMonth);

      // 운영 시작 전 (expected_usage 가 0 또는 NULL — 예: MANAGED 26-01~06) 은 알림 스킵.
      // 향후 사용 예정 product 의 row 가 미리 생성되어 있을 뿐 실제 운영은 안 시작했으므로
      // 재고회전일 0 을 '구매 검토 필요' 로 오인해 경고를 띄우는 것을 방지.
      const usage = currentRow?.expected_usage ?? 0;
      // 판단 기준: 선행 커버(현 재고 ÷ 향후 월소요). 관리팜유 RSPO 처럼 10월부터 RPO/RSPO 구분 투입으로 소요가 급감하는 구간에서
      // '기말재고 ÷ 당월 소요'(재고회전, 9월 기준 0.6)가 실제 소진 기간(3개월+)과 어긋나 잘못된 긴급 알림을 내는 것을 막는다.
      // 데이터 범위 끝까지 재고가 남는(capped) 값은 하한값이므로 2.5 를 넘길 때만 채택하고, 아니면 재고회전으로 폴백.
      const fwd = currentRow ? forwardCoverage(rows, currentRow) : null;
      let months: number | null = null;
      let basis = '';
      if (fwd && fwd.evaluable && (!fwd.capped || fwd.months > 2.5)) { months = fwd.months; basis = '선행 커버'; }
      else if (currentRow && usage > 0 && currentRow.coverage_days !== null) { months = currentRow.coverage_days; basis = '재고회전'; }
      if (currentRow && months !== null && months <= 2.5) {
        alerts.push({
          product,
          alert_level: months <= 1.5 ? 'critical' : 'warning',
          depletion_month: null,
          required_volume: null,
          recommended_shipment: null,
          current_price: null,
          box_range_zone: null,
          message: `${product} 재고 ${basis} ${months}개월${basis === '선행 커버' ? ' (향후 월소요 기준)' : ''} -- 추가 구매 검토 필요`,
          action_taken: null,
          is_active: true,
        });
      } else if (currentRow && months === null) {
        // 당월·향후 예상소요 모두 0: 운영 시작 전(MANAGED 상반기) 또는 관리팜유 전환으로 소요 종료(RSPO 하반기) — 정보성 알림
        alerts.push({
          product,
          alert_level: 'normal',
          depletion_month: null,
          required_volume: null,
          recommended_shipment: null,
          current_price: null,
          box_range_zone: null,
          message: `${product} ${currentYear}-${String(currentMonth).padStart(2,'0')} 예상소요 없음 (운영 전 또는 관리팜유 전환) -- 알림 대상 아님`,
          action_taken: null,
          is_active: true,
        });
      } else {
        alerts.push({
          product,
          alert_level: 'normal',
          depletion_month: null,
          required_volume: null,
          recommended_shipment: null,
          current_price: null,
          box_range_zone: null,
          message: `${product} 재고 충분${basis === '선행 커버' && fwd ? ` (선행 커버 ${fwd.months}${fwd.capped ? '+' : ''}개월)` : ''} -- 모니터링 유지`,
          action_taken: null,
          is_active: true,
        });
      }
      continue;
    }

    const depMonth = depletionRow.month;
    const depYear = depletionRow.year;
    let shipMonth = depMonth - 3;
    let shipYear = depYear;
    if (shipMonth <= 0) { shipMonth += 12; shipYear -= 1; }

    alerts.push({
      product,
      alert_level: 'critical',
      depletion_month: `${depYear}-${String(depMonth).padStart(2, '0')}`,
      required_volume: depletionRow.expected_usage,
      recommended_shipment: `${shipYear}-${String(shipMonth).padStart(2, '0')}`,
      current_price: null,
      box_range_zone: null,
      message: `${product} ${depYear}년 ${depMonth}월 재고 소진 예상 (기말재고 ${Math.round(depletionRow.ending_stock!).toLocaleString()} kg)`,
      action_taken: null,
      is_active: true,
    });
  }

  if (!persist) return alerts;

  // Save alerts to DB (best-effort) — 활성 알람 집합이 바뀐 경우에만 기록
  try {
    const current = await dbAll(`SELECT product, alert_level, message FROM alerts WHERE is_active = 1 ORDER BY product`) as { product: string; alert_level: string; message: string }[];
    const key = (a: { product: string; alert_level: string; message: string | null }) => `${a.product}|${a.alert_level}|${a.message ?? ''}`;
    const same = current.length === alerts.length && current.map(key).sort().join('\n') === alerts.map(key).sort().join('\n');
    if (same) return alerts;
    const ops: { sql: string; params: any[] }[] = [
      { sql: `UPDATE alerts SET is_active = 0 WHERE is_active = 1`, params: [] },
    ];
    for (const a of alerts) {
      ops.push({
        sql: `INSERT INTO alerts (product, alert_level, depletion_month, required_volume, recommended_shipment, current_price, box_range_zone, message, action_taken, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [a.product, a.alert_level, a.depletion_month, a.required_volume, a.recommended_shipment, a.current_price, a.box_range_zone, a.message, a.action_taken, 1],
      });
    }
    await dbBatchRun(ops);
  } catch (e) {
    console.warn('Alert DB write skipped:', (e as Error).message);
  }

  return alerts;
}
