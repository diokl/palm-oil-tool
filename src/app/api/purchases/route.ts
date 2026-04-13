import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbGet, dbBatchRun } from '@/lib/db';

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
  // Get all purchases ordered by shipment_month DESC, then order_no
  const purchases = await dbAll(
    'SELECT * FROM purchases ORDER BY shipment_month DESC, order_no ASC'
  );

  // Calculate summary
  const totalRecords = purchases.length;
  const totalQtyMt = purchases.reduce((sum: number, p: any) => sum + (p.qty_mt || 0), 0);
  const totalAmountUsd = purchases.reduce((sum: number, p: any) => sum + (p.amount_usd || 0), 0);

  // Group by supplier
  const supplierSummary: Record<string, any> = {};
  purchases.forEach((purchase: any) => {
    const supplier = purchase.supplier || 'Unknown';
    if (!supplierSummary[supplier]) {
      supplierSummary[supplier] = {
        supplier,
        record_count: 0,
        total_qty_mt: 0,
        total_amount_usd: 0,
      };
    }
    supplierSummary[supplier].record_count += 1;
    supplierSummary[supplier].total_qty_mt += purchase.qty_mt || 0;
    supplierSummary[supplier].total_amount_usd += purchase.amount_usd || 0;
  });

  return NextResponse.json({
    data: purchases,
    summary: {
      total_records: totalRecords,
      total_qty_mt: totalQtyMt,
      total_amount_usd: totalAmountUsd,
    },
    supplier_summary: Object.values(supplierSummary),
  });
}

function calcProductRows(
  purchases: any[],
  priceMap: Map<string, any>,
  productFilter: string | null // null = all
) {
  // Group by shipment_month
  const grouped = new Map<string, any[]>();
  purchases.forEach((p: any) => {
    if (productFilter && p.product !== productFilter) return;
    if (!grouped.has(p.shipment_month)) grouped.set(p.shipment_month, []);
    grouped.get(p.shipment_month)!.push(p);
  });

  const rows: any[] = [];
  let cumEffect = 0;
  let totalEffect = 0;

  for (const [month, monthPurchases] of grouped.entries()) {
    const mp = priceMap.get(month);
    const marketPrice = mp?.market_price || 0;
    const exchangeRate = mp?.exchange_rate || 1450;

    const qty = monthPurchases.reduce((s: number, p: any) => s + (p.qty_mt || 0), 0);
    const amount = monthPurchases.reduce((s: number, p: any) => s + (p.amount_usd || 0), 0);
    const wavg = qty > 0 ? amount / qty : 0;
    const diffUsd = amount - marketPrice * qty;
    const effectKrw = diffUsd * exchangeRate;

    cumEffect += effectKrw;
    totalEffect += effectKrw;

    rows.push({
      shipment_month: month,
      qty, amount, wavg_price: wavg,
      market_price: marketPrice,
      price_diff: wavg - marketPrice,
      effect_usd: diffUsd,
      effect_krw: effectKrw,
      exchange_rate: exchangeRate,
      cumulative_effect_krw: cumEffect,
      evaluation: effectKrw < 0 ? '성공' : '실패',
    });
  }

  return { rows, total_effect_krw: totalEffect };
}

async function handlePrebuySummary() {
  const purchases = await dbAll('SELECT * FROM purchases ORDER BY shipment_month ASC');
  const marketPrices = await dbAll('SELECT * FROM prebuy_market_prices');
  const priceMap = new Map(marketPrices.map((mp: any) => [mp.shipment_month, mp]));

  // Per-product breakdowns
  const rbd = calcProductRows(purchases, priceMap, 'RBD');
  const rspo = calcProductRows(purchases, priceMap, 'RSPO');

  // Combined (all products)
  const grouped = new Map<string, any[]>();
  purchases.forEach((p: any) => {
    if (!grouped.has(p.shipment_month)) grouped.set(p.shipment_month, []);
    grouped.get(p.shipment_month)!.push(p);
  });

  const combined: any[] = [];
  let cumAll = 0;
  let totalAll = 0;
  for (const [month, monthPurchases] of grouped.entries()) {
    const mp = priceMap.get(month);
    const marketPrice = mp?.market_price || 0;
    const exchangeRate = mp?.exchange_rate || 1450;

    const rbdP = monthPurchases.filter((p: any) => p.product === 'RBD');
    const rspoP = monthPurchases.filter((p: any) => p.product === 'RSPO');

    const rbdQty = rbdP.reduce((s: number, p: any) => s + (p.qty_mt || 0), 0);
    const rbdAmount = rbdP.reduce((s: number, p: any) => s + (p.amount_usd || 0), 0);
    const rspoQty = rspoP.reduce((s: number, p: any) => s + (p.qty_mt || 0), 0);
    const rspoAmount = rspoP.reduce((s: number, p: any) => s + (p.amount_usd || 0), 0);

    const totalQty = rbdQty + rspoQty;
    const totalAmount = rbdAmount + rspoAmount;
    const wavg = totalQty > 0 ? totalAmount / totalQty : 0;
    const diffUsd = totalAmount - marketPrice * totalQty;
    const effectKrw = diffUsd * exchangeRate;

    cumAll += effectKrw;
    totalAll += effectKrw;

    combined.push({
      shipment_month: month,
      rbd_qty: rbdQty, rbd_amount: rbdAmount,
      rspo_qty: rspoQty, rspo_amount: rspoAmount,
      total_qty: totalQty, total_amount: totalAmount,
      wavg_price: wavg, market_price: marketPrice,
      price_diff: wavg - marketPrice,
      effect_usd: diffUsd, effect_krw: effectKrw,
      exchange_rate: exchangeRate,
      cumulative_effect_krw: cumAll,
      evaluation: effectKrw < 0 ? '성공' : '실패',
    });
  }

  return NextResponse.json({
    data: combined,
    rbd: { rows: rbd.rows, total_effect_krw: rbd.total_effect_krw },
    rspo: { rows: rspo.rows, total_effect_krw: rspo.total_effect_krw },
    summary: { total_effect_krw: totalAll },
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      order_no,
      product,
      shipment_month,
      supplier,
      manufacturer,
      product_name,
      unit_price,
      qty_mt,
      amount_usd,
      incoterms,
      payment_terms,
      etd,
      contract_number,
      notes,
    } = body;

    // Validate required fields
    if (!product || !shipment_month || !unit_price || !qty_mt) {
      return NextResponse.json(
        { error: 'Required fields: product, shipment_month, unit_price, qty_mt' },
        { status: 400 }
      );
    }

    // Auto-calculate amount_usd if not provided
    const finalAmountUsd = amount_usd ?? unit_price * qty_mt;

    await dbRun(
      `INSERT INTO purchases (
        order_no, product, shipment_month, supplier, manufacturer,
        product_name, unit_price, qty_mt, amount_usd, incoterms,
        payment_terms, etd, contract_number, notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        order_no || null,
        product,
        shipment_month,
        supplier || null,
        manufacturer || null,
        product_name || null,
        unit_price,
        qty_mt,
        finalAmountUsd,
        incoterms || null,
        payment_terms || null,
        etd || null,
        contract_number || null,
        notes || null,
      ]
    );

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    // Handle market price update
    if (body.action === 'update_market_price') {
      const { shipment_month, market_price, exchange_rate } = body;

      if (!shipment_month || market_price === undefined) {
        return NextResponse.json(
          { error: 'Required fields: shipment_month, market_price' },
          { status: 400 }
        );
      }

      const finalExchangeRate = exchange_rate ?? 1450;

      // Upsert into prebuy_market_prices
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

    // Build update query
    const updateKeys = Object.keys(fields);
    if (updateKeys.length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const setClauses = updateKeys.map((k) => `${k} = ?`).join(', ');
    const values = updateKeys.map((k) => fields[k]);

    await dbRun(`UPDATE purchases SET ${setClauses} WHERE id = ?`, [...values, id]);

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

    await dbRun('DELETE FROM purchases WHERE id = ?', [parseInt(id)]);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
