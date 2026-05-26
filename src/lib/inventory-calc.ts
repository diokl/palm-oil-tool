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
    const usage = row.expected_usage ?? 0;
    const customs = row.customs_volume ?? 0;
    const endingStock = prevStock + customs - usage;
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

export async function generateAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];

  for (const product of ['RBD', 'RSPO', 'MANAGED'] as const) {
    const rows = await dbAll(
      `SELECT * FROM inventory WHERE product = ? ORDER BY year ASC, month ASC`,
      [product]
    ) as InventoryRow[];

    const depletionRow = rows.find(r => r.ending_stock !== null && r.ending_stock < 0);

    if (!depletionRow) {
      const currentMonth = new Date().getMonth() + 1;
      const currentYear = new Date().getFullYear();
      const currentRow = rows.find(r => r.year === currentYear && r.month === currentMonth);

      if (currentRow && currentRow.coverage_days !== null && currentRow.coverage_days <= 2.5) {
        alerts.push({
          product,
          alert_level: currentRow.coverage_days <= 1.5 ? 'critical' : 'warning',
          depletion_month: null,
          required_volume: null,
          recommended_shipment: null,
          current_price: null,
          box_range_zone: null,
          message: `${product} 재고회전일 ${currentRow.coverage_days}일 -- 추가 구매 검토 필요`,
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
          message: `${product} 재고 충분 -- 모니터링 유지`,
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

  // Save alerts to DB (best-effort)
  try {
    const ops: { sql: string; params: any[] }[] = [
      { sql: `UPDATE alerts SET is_active = 0 WHERE 1=1`, params: [] },
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
