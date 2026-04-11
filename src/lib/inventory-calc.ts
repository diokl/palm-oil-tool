import { dbAll, dbGet, dbRun } from './db';
import type { InventoryRow, Alert } from './types';

export async function recalcInventory(product: 'RBD' | 'RSPO', year: number, prevYearEndingStock?: number) {
  const rows = await dbAll(
    `SELECT * FROM inventory WHERE product = ? AND year = ? ORDER BY month ASC`,
    [product, year]
  ) as InventoryRow[];

  if (rows.length === 0) return;

  if (prevYearEndingStock === undefined) {
    const prev = await dbGet(
      `SELECT ending_stock FROM inventory WHERE product = ? AND year = ? AND month = 12`,
      [product, year - 1]
    ) as { ending_stock: number } | undefined;
    prevYearEndingStock = prev?.ending_stock ?? 0;
  }

  let prevStock = prevYearEndingStock;

  for (const row of rows) {
    const usage = row.expected_usage ?? 0;
    const customs = row.customs_volume ?? 0;
    const endingStock = prevStock + customs - usage;
    const coverageDays = usage > 0 ? Math.round((endingStock / usage) * 10) / 10 : 0;

    await dbRun(
      `UPDATE inventory SET ending_stock = ?, coverage_days = ?, updated_at = NOW() WHERE id = ?`,
      [endingStock, coverageDays, row.id]
    );
    prevStock = endingStock;
  }
}

export async function generateAlerts(): Promise<Alert[]> {
  const alerts: Alert[] = [];

  for (const product of ['RBD', 'RSPO'] as const) {
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

  // Save alerts to DB (best-effort, don't fail if writes are blocked)
  try {
    await dbRun(`UPDATE alerts SET is_active = 0`);
    for (const a of alerts) {
      await dbRun(
        `INSERT INTO alerts (product, alert_level, depletion_month, required_volume, recommended_shipment, current_price, box_range_zone, message, action_taken, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [a.product, a.alert_level, a.depletion_month, a.required_volume, a.recommended_shipment, a.current_price, a.box_range_zone, a.message, a.action_taken, 1]
      );
    }
  } catch (e) {
    console.warn('Alert DB write skipped (read-only mode):', (e as Error).message);
  }

  return alerts;
}
