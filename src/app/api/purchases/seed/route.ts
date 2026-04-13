import { NextResponse } from 'next/server';
import { dbAll, dbRun, dbBatchRun } from '@/lib/db';
import fs from 'fs';
import path from 'path';

export async function POST() {
  try {
    // Clear existing data and re-seed
    await dbRun('DELETE FROM purchases');
    await dbRun('DELETE FROM prebuy_market_prices');

    // Load RAW purchase data
    const rawPath = path.join(process.cwd(), 'data', 'purchases_raw.json');
    const rawData = JSON.parse(fs.readFileSync(rawPath, 'utf-8'));

    // Insert in batches of 20
    for (let i = 0; i < rawData.length; i += 20) {
      const batch = rawData.slice(i, Math.min(i + 20, rawData.length));
      await dbBatchRun(
        batch.map((p: any) => ({
          sql: `INSERT INTO purchases (order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            p.order_no, p.product, p.shipment_month, p.supplier, p.manufacturer,
            p.product_name, p.unit_price, p.qty_mt, p.amount_usd, p.incoterms,
            p.payment_terms, p.etd,
          ],
        }))
      );
    }

    // Load and insert market prices
    const marketPath = path.join(process.cwd(), 'data', 'prebuy_market_prices.json');
    const marketData = JSON.parse(fs.readFileSync(marketPath, 'utf-8'));

    await dbBatchRun(
      marketData.map((m: any) => ({
        sql: `INSERT INTO prebuy_market_prices (shipment_month, market_price, exchange_rate, source)
              VALUES (?, ?, ?, 'seed')
              ON CONFLICT (shipment_month) DO UPDATE SET
                market_price = EXCLUDED.market_price,
                exchange_rate = EXCLUDED.exchange_rate`,
        params: [m.shipment_month, m.market_price, m.exchange_rate || 1450],
      }))
    );

    return NextResponse.json({
      success: true,
      message: `Seed 완료: 구매 ${rawData.length}건, 시황가 ${marketData.length}건 (기존 데이터 초기화됨)`,
      purchases: rawData.length,
      market_prices: marketData.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
