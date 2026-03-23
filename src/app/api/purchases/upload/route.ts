import { NextRequest, NextResponse } from 'next/server';

// Dynamic import for pdf-parse to avoid SSR issues
async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = await import('pdf-parse');
  const pdfParse = (mod as any).default || mod;
  const data = await pdfParse(buffer);
  return data.text;
}

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
  // Try to parse various date formats to YYYY-MM-DD
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // "26 Feb 2026" or "26-Feb-2026"
  const m1 = raw.match(/(\d{1,2})[\s\/\-\.]+([A-Za-z]+)[\s\/\-\.]+(\d{2,4})/);
  if (m1) {
    const mon = months[m1[2].toLowerCase().substring(0, 3)];
    const year = m1[3].length === 2 ? '20' + m1[3] : m1[3];
    return `${year}-${mon}-${m1[1].padStart(2, '0')}`;
  }

  // "2026-02-26"
  const m2 = raw.match(/(\d{4})[\-\/](\d{2})[\-\/](\d{2})/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;

  return raw;
}

function normalizeMonth(raw: string): string {
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  // "Feb 2026" or "February 2026"
  const m1 = raw.match(/([A-Za-z]+)[\s\/\-]*(\d{2,4})/);
  if (m1) {
    const mon = months[m1[1].toLowerCase().substring(0, 3)];
    const year = m1[2].length === 2 ? '20' + m1[2] : m1[2];
    return mon ? `${year}-${mon}` : raw;
  }

  // "2026-02" or "2026/02"
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

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text from PDF
    const text = await parsePdf(buffer);

    // Parse SC fields using regex
    const fields = extractSCFields(text);

    // Try Claude API to fill in missing fields
    let claudeEnhanced = { ...fields };
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const missingFields = [];
        const requiredFields = [
          'contract_number', 'contract_date', 'product', 'quantity_mt',
          'contract_price', 'shipment_month', 'supplier', 'incoterms',
          'payment_terms', 'loading_port', 'discharge_port'
        ];

        for (const field of requiredFields) {
          if (!fields[field]) {
            missingFields.push(field);
          }
        }

        if (missingFields.length > 0) {
          const response = await client.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: 1000,
            messages: [
              {
                role: 'user',
                content: `Extract the following fields from this SC (Sales Contract) document text. Return a JSON object with only these fields: contract_number, contract_date, product, quantity_mt, contract_price, shipment_month, supplier, incoterms, payment_terms, loading_port, discharge_port.

Use null for any fields you cannot extract. For dates, use YYYY-MM-DD format. For month/year dates, use YYYY-MM format. For prices, use numbers only (no currency). For quantities, use numbers only (no units).

Document text:
${text.substring(0, 3000)}

Return only valid JSON, no other text.`,
              },
            ],
          });

          try {
            const claudeText = response.content[0].type === 'text' ? response.content[0].text : '';
            // Try to extract JSON from the response
            const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const claudeData = JSON.parse(jsonMatch[0]);
              // Merge: regex fields take precedence, Claude fills gaps
              for (const key in claudeData) {
                if (!fields[key] && claudeData[key]) {
                  claudeEnhanced[key] = claudeData[key];
                }
              }
            }
          } catch (parseError) {
            console.warn('Failed to parse Claude response:', parseError);
          }
        }
      } catch (error) {
        console.warn('Claude API enhancement failed:', error);
        // Continue with regex-only results
      }
    }

    return NextResponse.json({
      success: true,
      extracted: claudeEnhanced,
      raw_text: text.substring(0, 2000), // For debugging, send first 2000 chars
    });
  } catch (error: any) {
    console.error('PDF parse error:', error);
    return NextResponse.json({ error: `PDF 파싱 실패: ${error.message}` }, { status: 500 });
  }
}
