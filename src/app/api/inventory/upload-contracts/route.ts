import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun } from '@/lib/db';
import Anthropic from '@anthropic-ai/sdk';

/**
 * POST /api/inventory/upload-contracts
 *
 * 계약 PDF를 Claude API로 파싱하여 재고관리 테이블에 가중평균 단가/계약일 자동 매칭
 *
 * Body: multipart/form-data
 *   - file: PDF file
 *   - product: 'RBD Palm Oil' | 'RBD Palm Oil RSPO MB'
 *   - year: number (e.g. 2025)
 */
export async function POST(request: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다' }, { status: 500 });
    }

    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const product = formData.get('product') as string || 'RBD';  // DB product code: 'RBD' or 'RSPO'
    const productPdf = formData.get('product_pdf') as string || '';
    const year = parseInt(formData.get('year') as string) || 2025;

    if (!file) {
      return NextResponse.json({ error: 'PDF 파일이 필요합니다' }, { status: 400 });
    }

    // Read file as base64
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64Data = buffer.toString('base64');

    // Determine which sheet to extract based on product
    const sheetHint = product === 'RSPO' || productPdf.includes('RSPO')
      ? 'RBD Palm Oil RSPO MB (또는 RSPO Mass Balance)'
      : 'RBD Palm Oil (Conventional, RSPO가 아닌 일반)';

    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
          },
          {
            type: 'text',
            text: `이 PDF는 삼양식품의 RBD Palm Oil 구매 계약 현황입니다.

**"${sheetHint}"** 시트/섹션에서 계약 데이터를 추출해주세요.

각 계약 행에서 다음 필드를 추출:
1. shipment_month: 선적월 (예: "Jan 2025", "Apr 2025", "Jul 2025 (하반)", "Dec 2025 (16-31)" 등 원본 그대로)
2. month_number: 선적월의 숫자 (1~12). "Jan"=1, "Feb"=2, ... "Dec"=12
3. contract_date: 계약일자 (YYYY-MM-DD 형식)
4. quantity_mt: 수량 (MT, 숫자만)
5. unit_price: 단가 (USD/MT, 숫자만)
6. supplier: 공급사명
7. contract_number: 계약번호

**반드시 유효한 JSON 배열만 반환하세요. 설명 텍스트나 코드블록 없이 순수 JSON만:**
[
  {
    "shipment_month": "Jan 2025",
    "month_number": 1,
    "contract_date": "2024-10-25",
    "quantity_mt": 2000,
    "unit_price": 1095,
    "supplier": "KLK",
    "contract_number": "HS/241025-3"
  }
]`
          },
        ],
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Parse JSON from response
    let contracts: any[];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      contracts = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
    } catch {
      return NextResponse.json({ error: 'PDF 파싱 실패: Claude 응답에서 유효한 JSON을 추출할 수 없습니다', raw: text.substring(0, 500) }, { status: 500 });
    }

    if (contracts.length === 0) {
      return NextResponse.json({ error: '계약 데이터를 찾을 수 없습니다' }, { status: 400 });
    }

    // Group contracts by month_number → calculate weighted average price & contract dates
    const monthMap: Record<number, {
      totalValue: number;
      totalQty: number;
      dates: string[];
      details: string[];
    }> = {};

    for (const c of contracts) {
      const mn = c.month_number;
      if (!mn || mn < 1 || mn > 12) continue;

      if (!monthMap[mn]) {
        monthMap[mn] = { totalValue: 0, totalQty: 0, dates: [], details: [] };
      }

      const qty = Number(c.quantity_mt) || 0;
      const price = Number(c.unit_price) || 0;

      monthMap[mn].totalValue += qty * price;
      monthMap[mn].totalQty += qty;
      if (c.contract_date) monthMap[mn].dates.push(c.contract_date);
      monthMap[mn].details.push(`${c.supplier} $${price} x ${qty}MT (${c.contract_date})`);
    }

    // Update inventory rows
    const updates: Array<{ month: number; contract_price: number; contract_date: string }> = [];

    for (const [monthStr, data] of Object.entries(monthMap)) {
      const month = parseInt(monthStr);
      const wavgPrice = data.totalQty > 0 ? Math.round((data.totalValue / data.totalQty) * 100) / 100 : 0;
      const contractDates = [...new Set(data.dates)].sort().join(', ');

      // Find inventory row for this product/year/month
      const row = await dbAll(
        'SELECT id FROM inventory WHERE product = ? AND year = ? AND month = ?',
        [product, year, month]
      ) as any[];

      if (row.length > 0) {
        await dbRun(
          'UPDATE inventory SET contract_price = ?, contract_date = ?, updated_by = ? WHERE id = ?',
          [wavgPrice, contractDates, 'contract_pdf', row[0].id]
        );

        updates.push({ month, contract_price: wavgPrice, contract_date: contractDates });
      }
    }

    // Return full updated inventory
    const updatedData = await dbAll(
      'SELECT * FROM inventory WHERE product = ? AND year = ? ORDER BY month',
      [product, year]
    );

    return NextResponse.json({
      success: true,
      parsed_contracts: contracts.length,
      updated_months: updates.length,
      updates,
      data: updatedData,
    });
  } catch (error: any) {
    console.error('Contract PDF upload error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
