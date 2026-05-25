import { NextRequest, NextResponse } from 'next/server';
import { dbBatchRun } from '@/lib/db';
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

    // If mode === 'preview', just return parsed data without inserting
    if (mode === 'preview') {
      return NextResponse.json({
        success: true,
        preview: true,
        data: records,
        count: records.length,
      });
    }

    // Insert in batches of 20
    let insertedCount = 0;
    for (let i = 0; i < records.length; i += 20) {
      const batch = records.slice(i, Math.min(i + 20, records.length));
      await dbBatchRun(
        batch.map((p) => ({
          sql: `INSERT INTO purchases (order_no, product, shipment_month, supplier, manufacturer, product_name, unit_price, qty_mt, amount_usd, incoterms, payment_terms, etd, contract_number)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            p.order_no, p.product, p.shipment_month, p.supplier, p.manufacturer,
            p.product_name, p.unit_price, p.qty_mt, p.amount_usd, p.incoterms,
            p.payment_terms, p.etd, p.contract_number,
          ],
        }))
      );
      insertedCount += batch.length;
    }

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
