import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

// Extract SC fields from PDF text using pattern matching
function extractSCFields(text: string): Record<string, any> {
  const result: Record<string, any> = {};

  // Normalize whitespace
  const t = text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ');

  // Contract number
  const contractNoMatch = t.match(/(?:Contract\s*(?:No|Number|#|Ref)|SC\s*(?:No|Number|#)|Reference)\s*[:\-]?\s*([A-Z0-9\-\/]+)/i);
  if (contractNoMatch) result.contract_number = contractNoMatch[1].trim();

  // Date (contract date)
  const dateMatch = t.match(/(?:Date|Contract\s*Date)\s*[:\-]?\s*(\d{1,2}[\s\/\-\.]+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\/\-\.]+\d{2,4})/i)
    || t.match(/(?:Date|Contract\s*Date)\s*[:\-]?\s*(\d{4}[\-\/]\d{2}[\-\/]\d{2})/i)
    || t.match(/(?:Date|Contract\s*Date)\s*[:\-]?\s*(\d{1,2}[\-\/]\d{1,2}[\-\/]\d{2,4})/i);
  if (dateMatch) {
    const raw = dateMatch[1].trim();
    result.contract_date = normalizeDate(raw);
  }

  // Product (RBD Palm Olein, RSPO, etc)
  if (/RSPO/i.test(t)) {
    result.product = 'RSPO';
  } else if (/RBD\s*Palm\s*(?:Olein|Oil)/i.test(t) || /RBD/i.test(t)) {
    result.product = 'RBD';
  }

  // Quantity (MT / metric tons)
  const qtyMatch = t.match(/(?:Quantity|Qty|Volume)\s*[:\-]?\s*([\d,\.]+)\s*(?:MT|M\/T|Metric\s*Ton)/i)
    || t.match(/([\d,\.]+)\s*(?:\+\/?[\-]?\s*\d+%?\s*)?(?:MT|M\/T|Metric\s*Ton)/i);
  if (qtyMatch) result.quantity_mt = parseFloat(qtyMatch[1].replace(/,/g, ''));

  // Price (USD per MT)
  const priceMatch = t.match(/(?:Price|Unit\s*Price|Contract\s*Price)\s*[:\-]?\s*(?:USD|US\$|\$)\s*([\d,\.]+)\s*(?:\/?\s*(?:MT|M\/T|PMT))?/i)
    || t.match(/(?:USD|US\$|\$)\s*([\d,\.]+)\s*(?:\/?\s*(?:MT|M\/T|PMT))/i);
  if (priceMatch) result.contract_price = parseFloat(priceMatch[1].replace(/,/g, ''));

  // Shipment month/period
  const shipMatch = t.match(/(?:Shipment|Ship(?:ping)?|Delivery)\s*(?:Period|Month|Date)?\s*[:\-]?\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[\s\/\-]*\d{2,4})/i)
    || t.match(/(?:Shipment|Ship(?:ping)?|Delivery)\s*(?:Period|Month|Date)?\s*[:\-]?\s*(\d{4}[\-\/]\d{2})/i);
  if (shipMatch) {
    const raw = shipMatch[1].trim();
    result.shipment_month = normalizeMonth(raw);
  }

  // Supplier / Seller
  const sellerMatch = t.match(/(?:Seller|Supplier|Vendor)\s*[:\-]?\s*([A-Z][A-Za-z\s&\.\,]+?)(?:\n|Tel|Fax|Address|Buyer)/i);
  if (sellerMatch) result.supplier = sellerMatch[1].trim().substring(0, 100);

  // Incoterms (CIF, FOB, CFR, etc)
  const incoMatch = t.match(/\b(CIF|FOB|CFR|C&F|CNF|DAP|DDP|FCA|CPT|CIP|FAS|EXW)\b/i);
  if (incoMatch) result.incoterms = incoMatch[1].toUpperCase();

  // Payment terms
  const payMatch = t.match(/(?:Payment|Payment\s*Terms?)\s*[:\-]?\s*(.+?)(?:\n|$)/i);
  if (payMatch) result.payment_terms = payMatch[1].trim().substring(0, 200);

  // Loading port
  const loadMatch = t.match(/(?:Loading\s*Port|Port\s*of\s*Loading|Origin\s*Port)\s*[:\-]?\s*(.+?)(?:\n|$)/i);
  if (loadMatch) result.loading_port = loadMatch[1].trim().substring(0, 100);

  // Discharge port
  const dischMatch = t.match(/(?:Discharge\s*Port|Port\s*of\s*(?:Discharge|Destination)|Destination\s*Port)\s*[:\-]?\s*(.+?)(?:\n|$)/i);
  if (dischMatch) result.discharge_port = dischMatch[1].trim().substring(0, 100);

  return result;
}

function normalizeDate(raw: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const m1 = raw.match(/(\d{1,2})[\s\/\-\.]+([A-Za-z]+)[\s\/\-\.]+(\d{2,4})/);
  if (m1) {
    const mon = months[m1[2].toLowerCase().substring(0, 3)];
    const year = m1[3].length === 2 ? '20' + m1[3] : m1[3];
    return `${year}-${mon}-${m1[1].padStart(2, '0')}`;
  }

  const m2 = raw.match(/(\d{4})[\-\/](\d{2})[\-\/](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  return raw;
}

function normalizeMonth(raw: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const m1 = raw.match(/([A-Za-z]+)[\s\/\-]*(\d{2,4})/);
  if (m1) {
    const mon = months[m1[1].toLowerCase().substring(0, 3)];
    const year = m1[2].length === 2 ? '20' + m1[2] : m1[2];
    return mon ? `${year}-${mon}` : raw;
  }

  const m2 = raw.match(/(\d{4})[\-\/](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}`;

  return raw;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'PDF 파일만 업로드 가능합니다' }, { status: 400 });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'ANTHROPIC_API_KEY가 설정되지 않았습니다' }, { status: 500 });
    }

    // PDF를 base64로 변환
    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');

    // Claude API로 PDF 텍스트 추출 + SC 필드 파싱
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: base64Data,
              },
            },
            {
              type: 'text',
              text: `Extract the following fields from this SC (Sales Contract) PDF document. Return a JSON object with these fields:
- contract_number: Contract reference number
- contract_date: in YYYY-MM-DD format
- product: "RBD" or "RSPO" (based on product description)
- quantity_mt: quantity in metric tons (number only)
- contract_price: price in USD per MT (number only)
- shipment_month: in YYYY-MM format
- supplier: seller/supplier company name
- incoterms: CIF, FOB, CFR, etc.
- payment_terms: payment terms text
- loading_port: port of loading
- discharge_port: port of discharge

Use null for any fields you cannot extract. Return ONLY valid JSON, no markdown, no explanation.`,
            },
          ],
        },
      ],
    });

    // Claude 응답에서 JSON 추출
    const responseText = message.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('');

    let extracted: Record<string, any> = {};
    try {
      let jsonStr = responseText;
      const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        jsonStr = jsonMatch[1].trim();
      } else {
        const objMatch = responseText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          jsonStr = objMatch[0];
        }
      }
      extracted = JSON.parse(jsonStr);
    } catch (parseErr) {
      console.warn('Failed to parse Claude JSON response, using empty result');
    }

    return NextResponse.json({
      success: true,
      extracted,
      raw_text: `[Claude API로 추출] 파일: ${file.name}, 모델: claude-sonnet-4-20250514`,
    });
  } catch (error: any) {
    console.error('PDF parse error:', error);

    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
      errorMsg = 'Anthropic API 키가 유효하지 않습니다';
    } else if (errorMsg.includes('rate_limit')) {
      errorMsg = 'API 호출 한도 초과. 잠시 후 다시 시도해주세요';
    }

    return NextResponse.json({ error: `PDF 파싱 실패: ${errorMsg}` }, { status: 500 });
  }
}
