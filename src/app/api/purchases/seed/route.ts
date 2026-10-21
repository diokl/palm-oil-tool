import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbBatchRun } from '@/lib/db';
import { syncCustomsVolumeForShipments } from '@/lib/inventory-calc';
import type { Product } from '@/lib/types';
import fs from 'fs';
import path from 'path';

// POST /api/purchases/seed  body: { confirm: 'DELETE_ALL_PURCHASES' }
// 구매이력 전체를 지우고 data/purchases_raw.json(초기 데이터)으로 다시 채운다. 마스터 전용(미들웨어).
//
// 안전장치 (이전에는 버튼 한 번에 확인 없이 실행, 삭제·입력이 따로 커밋, 재고 동기화 없음):
//  - 본문에 확인 문구가 있어야 실행
//  - 삭제와 재입력을 한 트랜잭션으로 → 중간 실패 시 원래 데이터 유지
//  - 끝나면 삭제 전·후 선적월 모두 재고 통관수량을 다시 맞춘다
export const maxDuration = 60;
const CONFIRM = 'DELETE_ALL_PURCHASES';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.confirm !== CONFIRM) {
      return NextResponse.json({ error: `구매이력 전체 초기화는 확인 문구가 필요합니다 (confirm: '${CONFIRM}')` }, { status: 400 });
    }

    const rawData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'purchases_raw.json'), 'utf-8'));
    const marketData = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'data', 'prebuy_market_prices.json'), 'utf-8'));

    // 삭제 전 선적월 — 재고 동기화 대상 (지워지는 달의 통관수량도 0 으로 맞춰야 함)
    const before = await dbAll('SELECT DISTINCT product, shipment_month FROM purchases') as { product: Product; shipment_month: string }[];

    await dbBatchRun([
      { sql: 'DELETE FROM purchases', params: [] },
      { sql: 'DELETE FROM prebuy_market_prices', params: [] },
      {
        sql: `INSERT INTO purchases (order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd)
              SELECT order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd
              FROM jsonb_to_recordset(?::text::jsonb) AS t(order_no text, product text, shipment_month text, supplier text, manufacturer text, product_name text,
                unit_price double precision, qty_mt double precision, amount_usd double precision, incoterms text, payment_terms text, etd text)`,
        params: [JSON.stringify(rawData)],
      },
      {
        sql: `INSERT INTO prebuy_market_prices (shipment_month, market_price, exchange_rate, source)
              SELECT shipment_month, market_price, COALESCE(exchange_rate, 1450), 'seed'
              FROM jsonb_to_recordset(?::text::jsonb) AS t(shipment_month text, market_price double precision, exchange_rate double precision)
              ON CONFLICT (shipment_month) DO UPDATE SET market_price = EXCLUDED.market_price, exchange_rate = EXCLUDED.exchange_rate`,
        params: [JSON.stringify(marketData)],
      },
    ]);

    const after = rawData.map((p: any) => ({ product: p.product as Product, shipment_month: p.shipment_month as string }));
    await syncCustomsVolumeForShipments([...before, ...after]);

    return NextResponse.json({
      success: true,
      message: `Seed 완료: 구매 ${rawData.length}건, 시황가 ${marketData.length}건 (기존 데이터 초기화됨, 재고 통관수량 재계산)`,
      purchases: rawData.length,
      market_prices: marketData.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
