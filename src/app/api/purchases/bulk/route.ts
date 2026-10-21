import { NextRequest, NextResponse } from 'next/server';
import { dbRun } from '@/lib/db';
import { syncCustomsVolumeForShipments } from '@/lib/inventory-calc';
import type { Product } from '@/lib/types';

/**
 * Parse tab-separated purchase data pasted from Excel.
 *
 * Expected columns (tab-separated):
 * ORDER NO. | 구매오더번호 | 회계전표 | 공급처 | 공급처코드 | 제조사 | 품명 | 통화 |
 * UNIT PRICE(MT) | Q'TY(MT) | INVOICE VALUE | PACK SIZE | INCOTERMS | PAYMENT TERMS |
 * LC NO. | LC개설일 | LC만료일 | 물대지급일 | ORDER NO.(참조번호) | LAYCAN DATE | ETD
 */

function parseNumber(val: string): number {
  if (!val || val.trim() === '') return 0;
  // Remove commas and trim
  return parseFloat(val.replace(/,/g, '').trim()) || 0;
}

function deriveProduct(productName: string): 'RBD' | 'RSPO' {
  const lower = (productName || '').toLowerCase();
  if (lower.includes('rspo') || lower.includes('rpo')) return 'RSPO';
  return 'RBD';
}

function deriveShipmentMonth(etdStr: string, orderNo: string): string {
  // Try parsing ETD date first (format: YY/M/D or YY/MM/DD)
  if (etdStr && etdStr.trim()) {
    const cleaned = etdStr.trim();
    const parts = cleaned.split('/');
    if (parts.length === 3) {
      let year = parseInt(parts[0]);
      const month = parseInt(parts[1]);
      if (year < 100) year += 2000;
      if (month >= 1 && month <= 12) {
        return `${year}-${String(month).padStart(2, '0')}`;
      }
    }
  }

  // Fallback: derive from order_no pattern like PALM2401 or RPALM2601
  if (orderNo) {
    const match = orderNo.match(/R?PALM(\d{2})(\d{2})/);
    if (match) {
      const year = 2000 + parseInt(match[1]);
      const monthNum = parseInt(match[2]);
      if (monthNum >= 1 && monthNum <= 12) {
        return `${year}-${String(monthNum).padStart(2, '0')}`;
      }
    }
  }

  return '';
}

function parseTsvRows(text: string): any[] {
  const lines = text.trim().split('\n');
  const records: any[] = [];

  for (const line of lines) {
    const cols = line.split('\t');
    // Skip header rows or empty lines
    if (cols.length < 10) continue;
    const orderNo = (cols[0] || '').trim();
    if (!orderNo || orderNo.toUpperCase().includes('ORDER')) continue;

    const supplier = (cols[3] || '').trim();
    const manufacturer = (cols[5] || '').trim();
    const productName = (cols[6] || '').trim();
    const unitPrice = parseNumber(cols[8] || '');
    const qtyMt = parseNumber(cols[9] || '');
    const amountUsd = parseNumber(cols[10] || '');
    const incoterms = (cols[12] || '').trim();
    const paymentTerms = (cols[13] || '').trim();
    const lcNo = (cols[14] || '').trim();
    const etdRaw = (cols[20] || cols[cols.length - 1] || '').trim();

    if (unitPrice === 0 && qtyMt === 0) continue; // skip blank rows

    const product = deriveProduct(productName);
    const shipmentMonth = deriveShipmentMonth(etdRaw, orderNo);

    records.push({
      order_no: orderNo || null,
      product,
      shipment_month: shipmentMonth,
      supplier: supplier || null,
      manufacturer: manufacturer || null,
      product_name: productName || null,
      unit_price: unitPrice,
      qty_mt: qtyMt,
      amount_usd: amountUsd || unitPrice * qtyMt,
      incoterms: incoterms || null,
      payment_terms: paymentTerms || null,
      etd: etdRaw || null,
      contract_number: lcNo || null,
    });
  }

  return records;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { text, mode } = body;

    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'text 필드가 필요합니다 (탭 구분 텍스트)' },
        { status: 400 }
      );
    }

    const records = parseTsvRows(text);

    if (records.length === 0) {
      return NextResponse.json(
        { error: '파싱된 데이터가 없습니다. 탭 구분 텍스트를 확인하세요.' },
        { status: 400 }
      );
    }

    // 선적월(ETD·Order No 에서 추출)을 못 읽었거나 단가·수량이 0 이하인 행은 저장하지 않는다.
    // (이전: 선적월 '' 로 저장돼 재고 동기화에서 빠지고 자동 채우기에 NaN 제안이 생김)
    const invalid = records.filter((r) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(r.shipment_month) || !(r.unit_price > 0) || !(r.qty_mt > 0));
    const invalidLabel = invalid.slice(0, 5).map((r) => r.order_no || '(order no 없음)').join(', ');

    // If mode === 'preview', just return parsed data without inserting
    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        preview: true,
        data: records,
        count: records.length,
        invalid_count: invalid.length,
        ...(invalid.length ? { warning: `선적월·단가·수량을 읽지 못한 행 ${invalid.length}건: ${invalidLabel}` } : {}),
      });
    }
    if (invalid.length) {
      return NextResponse.json(
        { error: `선적월(ETD/Order No)이나 단가·수량을 읽지 못한 행이 ${invalid.length}건 있습니다: ${invalidLabel}. 해당 행을 고친 뒤 다시 붙여넣으세요.` },
        { status: 400 },
      );
    }

    // 전체를 쿼리 1번에 저장 — 일부만 들어가는 일이 없다.
    // (이전: 20행씩 따로 커밋 → 45번째 행에서 실패하면 1~40행만 저장되고, 다시 붙여넣으면 중복)
    await dbRun(
      `INSERT INTO purchases (order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd, contract_number)
       SELECT order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd, contract_number
       FROM jsonb_to_recordset(?::text::jsonb) AS t(order_no text, product text, shipment_month text, supplier text, manufacturer text, product_name text,
         unit_price double precision, qty_mt double precision, amount_usd double precision, incoterms text, payment_terms text, etd text, contract_number text)`,
      [JSON.stringify(records)],
    );
    const insertedCount = records.length;

    // 영향받은 (product, shipment_month) 일괄 수집 후 한 번에 inventory.customs_volume 동기화
    const affected = records
      .filter(r => r.product && r.shipment_month)
      .map(r => ({ product: r.product as Product, shipment_month: r.shipment_month as string }));
    await syncCustomsVolumeForShipments(affected);

    return NextResponse.json({
      success: true,
      message: `${insertedCount}건 업로드 완료`,
      count: insertedCount,
      data: records,
      synced_inventory: affected.length,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
