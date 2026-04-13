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

async function handlePrebuySummary() {
  // Get all purchases
  const purchases = await dbAll('SELECT * FROM purchases ORDER BY shipment_month ASC');

  // Get all market prices
  const marketPrices = await dbAll('SELECT * FROM prebuy_market_prices');
  const priceMap = new Map(
    marketPrices.map((mp: any) => [mp.shipment_month, mp])
  );

  // Group purchases by shipment_month
  const groupedByMonth = new Map<string, any[]>();
  purchases.forEach((p: any) => {
    const month = p.shipment_month;
    if (!groupedByMonth.has(month)) {
      groupedByMonth.set(month, []);
    }
    groupedByMonth.get(month)!.push(p);
  });

  // Calculate prebuy evaluation per month
  const prebuySummary: any[] = [];
  let cumulativeEffect = 0;
  let totalEffect = 0;

  for (const [shipmentMonth, monthPurchases] of groupedByMonth.entries()) {
    const marketData = priceMap.get(shipmentMonth);
    const marketPrice = marketData?.market_price || 0;
    const exchangeRate = marketData?.exchange_rate || 1450;

    // Separate RBD and RSPO
    const rbdPurchases = monthPurchases.filter((p: any) => p.product === 'RBD');
    const rspoPurchases = monthPurchases.filter((p: any) => p.product === 'RSPO');

    // Calculate totals for RBD
    const rbdQty = rbdPurchases.reduce((sum: number, p: any) => sum + (p.qty_mt || 0), 0);
    const rbdAmount = rbdPurchases.reduce(
      (sum: number, p: any) => sum + (p.amount_usd || 0),
      0
    );

    // Calculate totals for RSPO
    const rspoQty = rspoPurchases.reduce((sum: number, p: any) => sum + (p.qty_mt || 0), 0);
    const rspoAmount = rspoPurchases.reduce(
      (sum: number, p: any) => sum + (p.amount_usd || 0),
      0
    );

    // Aggregate totals
    const totalQty = rbdQty + rspoQty;
    const totalAmount = rbdAmount + rspoAmount;

    // Weighted average contract price
    const wavgPrice = totalQty > 0 ? totalAmount / totalQty : 0;

    // Effect calculation: (total_contract_amount - market_price * total_qty) * exchange_rate
    const contractVsMarketUsd = totalAmount - marketPrice * totalQty;
    const effect = contractVsMarketUsd * (exchangeRate / 1); // In KRW

    cumulativeEffect += effect;
    totalEffect += effect;

    // Price difference
    const priceDiff = wavgPrice - marketPrice;

    // Evaluation
    const evaluation = effect < 0 ? '성공' : '실패';

    prebuySummary.push({
      shipment_month: shipmentMonth,
      rbd_qty: rbdQty,
      rbd_amount: rbdAmount,
      rspo_qty: rspoQty,
      rspo_amount: rspoAmount,
      total_qty: totalQty,
      total_amount: totalAmount,
      market_price: marketPrice,
      wavg_price: wavgPrice,
      price_diff: priceDiff,
      effect_usd: contractVsMarketUsd,
      effect_krw: effect,
      exchange_rate: exchangeRate,
      cumulative_effect_krw: cumulativeEffect,
      evaluation,
    });
  }

  return NextResponse.json({
    data: prebuySummary,
    summary: {
      total_effect_krw: totalEffect,
    },
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
