import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '@/lib/anthropic';

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
      model: ANTHROPIC_MODEL,
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
              text: `Extract fields from this palm oil Sales Contract (SC) PDF. Return ONE JSON object.

Fields:
- contract_number: contract / SC reference number (e.g. "S55273/2606", "40409698")
- contract_date: trade/contract date in YYYY-MM-DD (look for "Date of Trade", "DATE")
- product: classify by specifications —
    * "MANAGED" if BOTH 3-MCPD (low, e.g. 2.5 ppm max) AND GE/Glycidyl Esters control are specified (관리팜유 = Low 3-MCPD + Low GE + RSPO)
    * "RSPO" if RSPO / Mass Balance but NO 3-MCPD/GE control
    * "RBD" for plain RBD palm oil
- qty_mt: quantity in metric tons (number only, ignore +/- tolerance)
- unit_price: price in USD per MT (number only)
- shipment_month: in YYYY-MM format (e.g. "JUNE 2026" -> "2026-06")
- supplier: seller company name (e.g. "IOI GLOBAL SERVICES SDN. BHD.", "WILMAR TRADING PTE LTD")
- incoterms: FOB, CIF, CFR, etc.
- payment_terms: payment terms text (short)
- loading_port: port of loading
- specs_note: short note of key specs (e.g. "3-MCPD 2.5ppm, GE 1.0ppm, RSPO MB")

Use null for fields you cannot extract. Return ONLY valid JSON, no markdown.`,
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

    // 구매 row 형태로 정규화 (bulk 미리보기/저장 호환)
    const qty = extracted.qty_mt ?? extracted.quantity_mt ?? null;
    const price = extracted.unit_price ?? extracted.contract_price ?? null;
    const rawProduct = String(extracted.product || '').toUpperCase();
    const product = ['MANAGED', 'RSPO', 'RBD'].includes(rawProduct) ? rawProduct : 'RBD';
    const normalized = {
      product,
      shipment_month: extracted.shipment_month ?? null,
      unit_price: price != null ? Number(price) : null,
      qty_mt: qty != null ? Number(qty) : null,
      amount_usd: (price != null && qty != null) ? Number(price) * Number(qty) : null,
      supplier: extracted.supplier ?? null,
      contract_number: extracted.contract_number ?? null,
      contract_date: extracted.contract_date ?? null,
      incoterms: extracted.incoterms ?? null,
      payment_terms: extracted.payment_terms ?? null,
      notes: extracted.specs_note ? `PDF: ${file.name} | ${extracted.specs_note}` : `PDF: ${file.name}`,
      source_file: file.name,
    };

    return NextResponse.json({
      success: true,
      extracted,
      record: normalized,
      raw_text: `[Claude API로 추출] 파일: ${file.name}`,
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
