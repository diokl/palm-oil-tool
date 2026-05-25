import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbGet, dbBatchRun } from '@/lib/db';
import { calculatePrebuyEffect, getPremium, DEFAULT_EXCHANGE_RATE } from '@/lib/prebuy-effect';
import { syncCustomsVolumeForShipments, syncCustomsVolumeFromPurchases } from '@/lib/inventory-calc';
import type { Product } from '@/lib/types';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const view = searchParams.get('view') || 'raw';

    if (view === 'prebuy') {
      return handlePrebuySummary();
    } else {
      return handleRawView();
    }
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

async function handleRawView() {
  const purchases = await dbAll(
    'SELECT * FROM purchases ORDER BY shipment_month DESC, order_no ASC'
  );

  const totalRecords = purchases.length;
  const totalQtyMt = purchases.reduce((sum: number, p: any) => sum + (p.qty_mt || 0), 0);
  const totalAmountUsd = purchases.reduce((sum: number, p: any) => sum + (p.amount_usd || 0), 0);

  const supplierSummary: Record<string, any> = {};
  purchases.forEach((purchase: any) => {
    const supplier = purchase.supplier || 'Unknown';
    if (!supplierSummary[supplier]) {
      supplierSummary[supplier] = { supplier, record_count: 0, total_qty_mt: 0, total_amount_usd: 0 };
    }
    supplierSummary[supplier].record_count += 1;
    supplierSummary[supplier].total_qty_mt += purchase.qty_mt || 0;
    supplierSummary[supplier].total_amount_usd += purchase.amount_usd || 0;
  });

  return NextResponse.json({
    data: purchases,
    summary: { total_records: totalRecords, total_qty_mt: totalQtyMt, total_amount_usd: totalAmountUsd },
    supplier_summary: Object.values(supplierSummary),
  });
}

// ── Per-purchase prebuy effect calculation ──
// market_price_usd 는 'RBD 기준 시황가'로 정의. 제품별 프리미엄은 자동 가산:
//   정상가 = market_price_usd + PRODUCT_PREMIUM_USD[product]   (RBD:0 / RSPO:25 / MANAGED:65)
//   effect_usd = (정상가 - unit_price) × qty_mt   → 양수 = 절감(성공)
// 본 엔드포인트는 기존 UI 호환을 위해 양수=절감 부호(savings 규약)를 사용한다.

interface PurchaseDetail {
  id: number;
  order_no: string | null;
  product: string;
  shipment_month: string;
  supplier: string | null;
  manufacturer: string | null;
  product_name: string | null;
  unit_price: number;
  qty_mt: number;
  amount_usd: number;
  market_price_usd: number | null;
  premium_usd: number;
  normalized_market_price: number | null;
  exchange_rate: number;
  effect_usd: number;
  effect_krw: number;
}

interface MonthRow {
  shipment_month: string;
  purchases: PurchaseDetail[];
  // RBD totals
  rbd_qty: number; rbd_amount: number; rbd_effect_usd: number; rbd_effect_krw: number;
  // RSPO totals
  rspo_qty: number; rspo_amount: number; rspo_effect_usd: number; rspo_effect_krw: number;
  // MANAGED totals
  managed_qty: number; managed_amount: number; managed_effect_usd: number; managed_effect_krw: number;
  // Combined
  total_qty: number; total_amount: number;
  wavg_price: number; avg_market_price: number;
  effect_usd: number; effect_krw: number;
  cumulative_effect_krw: number;
  evaluation: string;
}

async function handlePrebuySummary() {
  const purchases = await dbAll('SELECT * FROM purchases ORDER BY shipment_month ASC, product ASC, id ASC');

  // Group by shipment_month
  const grouped = new Map<string, any[]>();
  purchases.forEach((p: any) => {
    if (!grouped.has(p.shipment_month)) grouped.set(p.shipment_month, []);
    grouped.get(p.shipment_month)!.push(p);
  });

  const months: MonthRow[] = [];
  let cumAll = 0;

  // Also build per-product rows
  const rbdMonths: any[] = [];
  const rspoMonths: any[] = [];
  const managedMonths: any[] = [];
  let rbdCum = 0, rspoCum = 0, managedCum = 0;
  let rbdTotal = 0, rspoTotal = 0, managedTotal = 0;

  for (const [month, monthPurchases] of grouped.entries()) {
    // Build per-purchase details (each purchase has its own exchange_rate).
    // 효과 계산은 prebuy-effect.ts 모듈에 위임 — RSPO/MANAGED는 프리미엄 자동 가산.
    const details: PurchaseDetail[] = monthPurchases.map((p: any) => {
      const mp = p.market_price_usd != null ? Number(p.market_price_usd) : null;
      const er = p.exchange_rate != null ? Number(p.exchange_rate) : DEFAULT_EXCHANGE_RATE;
      const product = (p.product as Product);
      const premium = getPremium(product);

      let effectUsd = 0;
      let effectKrw = 0;
      let normalizedMarket: number | null = null;
      if (mp != null) {
        const r = calculatePrebuyEffect({
          product,
          contract_price: p.unit_price ?? 0,
          market_price_rbd: mp,
          qty_mt: p.qty_mt || 0,
          exchange_rate: er,
        });
        // savings 부호 (양수=절감) — 기존 UI 호환
        effectUsd = r.savings_usd;
        effectKrw = r.savings_krw;
        normalizedMarket = r.normalized_market_price;
      }

      return {
        id: p.id, order_no: p.order_no, product: p.product,
        shipment_month: p.shipment_month, supplier: p.supplier,
        manufacturer: p.manufacturer, product_name: p.product_name,
        unit_price: p.unit_price, qty_mt: p.qty_mt, amount_usd: p.amount_usd,
        market_price_usd: mp,
        premium_usd: premium,
        normalized_market_price: normalizedMarket,
        exchange_rate: er,
        effect_usd: effectUsd,
        effect_krw: effectKrw,
      };
    });

    // Product split (RBD / RSPO / MANAGED)
    const rbdP = details.filter(d => d.product === 'RBD');
    const rspoP = details.filter(d => d.product === 'RSPO');
    const managedP = details.filter(d => d.product === 'MANAGED');

    const sumGroup = (arr: PurchaseDetail[]) => ({
      qty: arr.reduce((s, d) => s + (d.qty_mt || 0), 0),
      amount: arr.reduce((s, d) => s + (d.amount_usd || 0), 0),
      effectUsd: arr.reduce((s, d) => s + d.effect_usd, 0),
      effectKrw: arr.reduce((s, d) => s + d.effect_krw, 0),
    });

    const rbdS = sumGroup(rbdP);
    const rspoS = sumGroup(rspoP);
    const managedS = sumGroup(managedP);
    const totalQty = rbdS.qty + rspoS.qty + managedS.qty;
    const totalAmount = rbdS.amount + rspoS.amount + managedS.amount;
    const totalEffectUsd = rbdS.effectUsd + rspoS.effectUsd + managedS.effectUsd;
    const wavg = totalQty > 0 ? totalAmount / totalQty : 0;

    // Average market price across purchases that have one set
    const withMp = details.filter(d => d.market_price_usd != null);
    const avgMp = withMp.length > 0
      ? withMp.reduce((s, d) => s + d.market_price_usd! * d.qty_mt, 0) / withMp.reduce((s, d) => s + d.qty_mt, 0)
      : 0;

    const totalEffectKrw = rbdS.effectKrw + rspoS.effectKrw + managedS.effectKrw;
    cumAll += totalEffectKrw;

    months.push({
      shipment_month: month,
      purchases: details,
      rbd_qty: rbdS.qty, rbd_amount: rbdS.amount,
      rbd_effect_usd: rbdS.effectUsd, rbd_effect_krw: rbdS.effectKrw,
      rspo_qty: rspoS.qty, rspo_amount: rspoS.amount,
      rspo_effect_usd: rspoS.effectUsd, rspo_effect_krw: rspoS.effectKrw,
      managed_qty: managedS.qty, managed_amount: managedS.amount,
      managed_effect_usd: managedS.effectUsd, managed_effect_krw: managedS.effectKrw,
      total_qty: totalQty, total_amount: totalAmount,
      wavg_price: wavg, avg_market_price: avgMp,
      effect_usd: totalEffectUsd, effect_krw: totalEffectKrw,
      cumulative_effect_krw: cumAll,
      evaluation: totalEffectUsd > 0 ? '성공' : '실패',
    });

    // Per-product monthly row
    if (rbdS.qty > 0) {
      const rbdWavg = rbdS.qty > 0 ? rbdS.amount / rbdS.qty : 0;
      const rbdMp = rbdP.filter(d => d.market_price_usd != null);
      const rbdAvgMp = rbdMp.length > 0 ? rbdMp.reduce((s, d) => s + d.market_price_usd! * d.qty_mt, 0) / rbdMp.reduce((s, d) => s + d.qty_mt, 0) : 0;
      rbdCum += rbdS.effectKrw;
      rbdTotal += rbdS.effectKrw;
      rbdMonths.push({
        shipment_month: month, qty: rbdS.qty, amount: rbdS.amount,
        wavg_price: rbdWavg, market_price: rbdAvgMp,
        price_diff: rbdWavg - rbdAvgMp,
        effect_usd: rbdS.effectUsd, effect_krw: rbdS.effectKrw,
        cumulative_effect_krw: rbdCum,
        evaluation: rbdS.effectUsd > 0 ? '성공' : '실패',
        purchases: rbdP,
      });
    }
    if (rspoS.qty > 0) {
      const rspoWavg = rspoS.qty > 0 ? rspoS.amount / rspoS.qty : 0;
      const rspoMp = rspoP.filter(d => d.market_price_usd != null);
      const rspoAvgMp = rspoMp.length > 0 ? rspoMp.reduce((s, d) => s + d.market_price_usd! * d.qty_mt, 0) / rspoMp.reduce((s, d) => s + d.qty_mt, 0) : 0;
      rspoCum += rspoS.effectKrw;
      rspoTotal += rspoS.effectKrw;
      rspoMonths.push({
        shipment_month: month, qty: rspoS.qty, amount: rspoS.amount,
        wavg_price: rspoWavg, market_price: rspoAvgMp,
        price_diff: rspoWavg - rspoAvgMp,
        effect_usd: rspoS.effectUsd, effect_krw: rspoS.effectKrw,
        cumulative_effect_krw: rspoCum,
        evaluation: rspoS.effectUsd > 0 ? '성공' : '실패',
        purchases: rspoP,
      });
    }
    if (managedS.qty > 0) {
      const managedWavg = managedS.qty > 0 ? managedS.amount / managedS.qty : 0;
      const managedMp = managedP.filter(d => d.market_price_usd != null);
      const managedAvgMp = managedMp.length > 0 ? managedMp.reduce((s, d) => s + d.market_price_usd! * d.qty_mt, 0) / managedMp.reduce((s, d) => s + d.qty_mt, 0) : 0;
      managedCum += managedS.effectKrw;
      managedTotal += managedS.effectKrw;
      managedMonths.push({
        shipment_month: month, qty: managedS.qty, amount: managedS.amount,
        wavg_price: managedWavg, market_price: managedAvgMp,
        price_diff: managedWavg - managedAvgMp,
        effect_usd: managedS.effectUsd, effect_krw: managedS.effectKrw,
        cumulative_effect_krw: managedCum,
        evaluation: managedS.effectUsd > 0 ? '성공' : '실패',
        purchases: managedP,
      });
    }
  }

  return NextResponse.json({
    data: months,
    rbd:     { rows: rbdMonths,     total_effect_krw: rbdTotal },
    rspo:    { rows: rspoMonths,    total_effect_krw: rspoTotal },
    managed: { rows: managedMonths, total_effect_krw: managedTotal },
    summary: { total_effect_krw: cumAll },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      order_no, product, shipment_month, supplier, manufacturer,
      product_name, unit_price, qty_mt, amount_usd, incoterms,
      payment_terms, etd, contract_number, notes, market_price_usd,
    } = body;

    if (!product || !shipment_month || !unit_price || !qty_mt) {
      return NextResponse.json(
        { error: 'Required fields: product, shipment_month, unit_price, qty_mt' },
        { status: 400 }
      );
    }

    const finalAmountUsd = amount_usd ?? unit_price * qty_mt;

    await dbRun(
      `INSERT INTO purchases (
        order_no, product, shipment_month, supplier, manufacturer,
        product_name, unit_price, qty_mt, amount_usd, incoterms,
        payment_terms, etd, contract_number, notes, market_price_usd, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        order_no || null, product, shipment_month, supplier || null,
        manufacturer || null, product_name || null, unit_price, qty_mt,
        finalAmountUsd, incoterms || null, payment_terms || null,
        etd || null, contract_number || null, notes || null,
        market_price_usd ?? null,
      ]
    );

    // inventory.customs_volume 자동 동기화 (선적월+1M = 통관월)
    await syncCustomsVolumeFromPurchases(product as Product, shipment_month);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle per-purchase market price update
    if (body.action === 'update_purchase_market_price') {
      const { id, market_price_usd } = body;
      if (!id || market_price_usd === undefined) {
        return NextResponse.json({ error: 'Required: id, market_price_usd' }, { status: 400 });
      }
      await dbRun('UPDATE purchases SET market_price_usd = ? WHERE id = ?', [market_price_usd, id]);
      return NextResponse.json({ success: true });
    }

    // Handle per-purchase exchange rate update
    if (body.action === 'update_purchase_exchange_rate') {
      const { id, exchange_rate } = body;
      if (!id || exchange_rate === undefined) {
        return NextResponse.json({ error: 'Required: id, exchange_rate' }, { status: 400 });
      }
      await dbRun('UPDATE purchases SET exchange_rate = ? WHERE id = ?', [exchange_rate, id]);
      return NextResponse.json({ success: true });
    }

    // Handle bulk market price update for a month (set same price for all purchases in that month+product)
    if (body.action === 'update_month_market_price') {
      const { shipment_month, product, market_price_usd } = body;
      if (!shipment_month || market_price_usd === undefined) {
        return NextResponse.json({ error: 'Required: shipment_month, market_price_usd' }, { status: 400 });
      }
      if (product) {
        await dbRun(
          'UPDATE purchases SET market_price_usd = ? WHERE shipment_month = ? AND product = ?',
          [market_price_usd, shipment_month, product]
        );
      } else {
        await dbRun(
          'UPDATE purchases SET market_price_usd = ? WHERE shipment_month = ?',
          [market_price_usd, shipment_month]
        );
      }
      return NextResponse.json({ success: true });
    }

    // Legacy: update_market_price for prebuy_market_prices table (backward compat)
    if (body.action === 'update_market_price') {
      const { shipment_month, market_price, exchange_rate } = body;
      if (!shipment_month || market_price === undefined) {
        return NextResponse.json({ error: 'Required fields: shipment_month, market_price' }, { status: 400 });
      }
      const finalExchangeRate = exchange_rate ?? 1450;
      await dbRun(
        `INSERT INTO prebuy_market_prices (shipment_month, market_price, exchange_rate, updated_at)
         VALUES (?, ?, ?, NOW())
         ON CONFLICT (shipment_month) DO UPDATE SET
           market_price = EXCLUDED.market_price,
           exchange_rate = EXCLUDED.exchange_rate,
           updated_at = NOW()`,
        [shipment_month, market_price, finalExchangeRate]
      );
      return NextResponse.json({ success: true });
    }

    // Handle purchase update
    const { id, ...fields } = body;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    const updateKeys = Object.keys(fields);
    if (updateKeys.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    // 변경 전 (product, shipment_month) 캡처 — qty_mt/shipment_month/product가 바뀌면
    // 변경 전후 두 곳 모두 inventory.customs_volume 재계산 필요.
    const touchesInventory = updateKeys.some(k => k === 'qty_mt' || k === 'shipment_month' || k === 'product');
    const before = touchesInventory
      ? await dbGet('SELECT product, shipment_month FROM purchases WHERE id = ?', [id]) as { product: Product; shipment_month: string } | undefined
      : undefined;

    const setClauses = updateKeys.map((k) => `${k} = ?`).join(', ');
    const values = updateKeys.map((k) => fields[k]);

    await dbRun(`UPDATE purchases SET ${setClauses} WHERE id = ?`, [...values, id]);

    if (touchesInventory) {
      const after = await dbGet('SELECT product, shipment_month FROM purchases WHERE id = ?', [id]) as { product: Product; shipment_month: string } | undefined;
      const affected: Array<{ product: Product; shipment_month: string }> = [];
      if (before) affected.push(before);
      if (after && (!before || before.product !== after.product || before.shipment_month !== after.shipment_month)) {
        affected.push(after);
      }
      await syncCustomsVolumeForShipments(affected);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }

    // 삭제 전 (product, shipment_month) 캡처 → 삭제 후 동기화
    const before = await dbGet(
      'SELECT product, shipment_month FROM purchases WHERE id = ?',
      [parseInt(id)],
    ) as { product: Product; shipment_month: string } | undefined;

    await dbRun('DELETE FROM purchases WHERE id = ?', [parseInt(id)]);

    if (before) {
      await syncCustomsVolumeFromPurchases(before.product, before.shipment_month);
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
