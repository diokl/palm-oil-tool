import { NextRequest, NextResponse } from 'next/server';
import { ANTHROPIC_MODEL, LOW_EFFORT, responseText } from '@/lib/anthropic';
import { kstNow } from '@/lib/kst';

export const maxDuration = 60; // Claude 호출 포함

// 개설의뢰인(Applicant, 50) = 수입자(우리 회사). 초안이므로 화면에서 수정 가능
const APPLICANT = 'SAMYANG FOODS CO., LTD.';
const PRESENTATION_DAYS = 21; // 48 서류제시기간과 같게

interface SCData {
  contract_number?: string;
  contract_date?: string;
  product?: string;
  quantity_mt?: number;
  contract_price?: number;
  shipment_month?: string;
  supplier?: string;
  incoterms?: string;
  payment_terms?: string;
  loading_port?: string;
  discharge_port?: string;
}

interface LCFields {
  '40A': string;
  '20': string;
  '31C': string;
  '31D': string;
  '50': string;
  '59': string;
  '32B': string;
  '39A': string;
  '41D': string;
  '42C': string;
  '43P': string;
  '43T': string;
  '44A': string;
  '44B': string;
  '44C': string;
  '44D': string;
  '45A': string;
  '46A': string;
  '47A': string;
  '71D': string;
  '48': string;
  '49': string;
}

// 44C 최종 선적일 = 선적월의 말일.
// (이전: 1부터 세는 월을 0부터 세는 Date 생성자에 넣고 35일을 더해, 2026-06 선적이 2026-08-29 로 약 두 달 늦게 나옴)
function calculateShipmentDeadline(shipmentMonth: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(shipmentMonth || '');
  if (!m) return '';
  const last = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)); // 다음 달 0일 = 이번 달 말일
  return last.toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Helper to format currency string
function formatCurrency(amount: number | undefined, currency: string = 'USD'): string {
  if (!amount) return '';
  return `${currency} ${amount.toFixed(2)}`;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { purchase_id, ...scData } = body;

    let sc: SCData = scData;

    // If purchase_id provided, would fetch from DB (not implemented here)
    if (purchase_id) {
      // TODO: Fetch from database using purchase_id
      console.log('Note: Fetching purchase by ID not implemented, using provided SC data');
    }

    // Initialize LC fields with defaults
    const today = kstNow().ymd; // 한국 날짜
    // 31D 유효기일 = 최종 선적일 + 서류제시기간 (선적월이 없으면 오늘 + 90일).
    // (이전: 항상 오늘 + 90일 → 먼 선적은 유효기일이 최종 선적일보다 앞설 수 있었음)
    const latestShipment = calculateShipmentDeadline(sc.shipment_month || '');
    const expiryStr = latestShipment ? addDays(latestShipment, PRESENTATION_DAYS) : addDays(today, 90);
    // 32B 금액 = 단가 × 수량 (이전: 단가만 들어가 2,000톤 × 1,100 이 'USD 1100.00')
    const qty = Number(sc.quantity_mt);
    const price = Number(sc.contract_price);
    const lcAmount = qty > 0 && price > 0 ? Math.round(qty * price * 100) / 100 : undefined;

    const lcFields: LCFields = {
      '40A': 'IRREVOCABLE',
      '20': '', // Documentary credit number - blank for user to fill
      '31C': today,
      '31D': expiryStr, // Date and place of expiry
      '50': APPLICANT, // Applicant = 수입자 (이전: 공급사가 들어감)
      '59': sc.supplier || '', // Beneficiary
      '32B': formatCurrency(lcAmount, 'USD'),
      '39A': '+/- 5 PERCENT',
      '41D': 'ANY BANK BY NEGOTIATION',
      '42C': 'SIGHT',
      '43P': 'ALLOWED',
      '43T': 'ALLOWED',
      '44A': sc.loading_port || '',
      '44B': sc.discharge_port || '',
      '44C': latestShipment,
      '44D': sc.shipment_month || '',
      '45A': '', // Will be enhanced by Claude
      '46A': '', // Will be enhanced by Claude
      '47A': '', // Will be enhanced by Claude
      '71D': 'COMMISSION AND ALL OTHER CHARGES ARE BORNE BY THE BENEFICIARY',
      '48': '21 DAYS',
      '49': 'WITHOUT'
    };

    // Use Claude to enhance complex fields
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const response = await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 16000, // thinking 포함 한도
          output_config: LOW_EFFORT,
          messages: [
            {
              role: 'user',
              content: `You are a trade finance expert. Based on this Sales Contract data, generate three SWIFT MT700 (Letter of Credit) fields in JSON format:

Sales Contract:
- Product: ${sc.product || 'Palm Oil'}
- Quantity: ${sc.quantity_mt || 'N/A'} MT
- Price: $${sc.contract_price || 'N/A'} per MT
- Incoterms: ${sc.incoterms || 'CIF'}
- Payment Terms: ${sc.payment_terms || 'LC at Sight'}
- Loading Port: ${sc.loading_port || 'Port Klang'}
- Discharge Port: ${sc.discharge_port || 'Incheon'}
- Shipment Month: ${sc.shipment_month || 'N/A'}

Generate JSON with these three fields:
{
  "45A": "Description of goods (include product type, quality, quantity, unit price, incoterms)",
  "46A": "List of documents required (Bill of Lading, Invoice, Packing List, Certificate of Origin, etc.)",
  "47A": "Additional conditions (e.g. Beneficiary's signature in invoice, inspection certificate, etc.)"
}

Return only valid JSON, no other text.`,
            },
          ],
        });

        try {
          const claudeText = responseText(response);
          const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const enhanced = JSON.parse(jsonMatch[0]);
            if (enhanced['45A']) lcFields['45A'] = enhanced['45A'];
            if (enhanced['46A']) lcFields['46A'] = enhanced['46A'];
            if (enhanced['47A']) lcFields['47A'] = enhanced['47A'];
          }
        } catch (parseError) {
          console.warn('Failed to parse Claude enhancement:', parseError);
        }
      } catch (error) {
        console.warn('Claude API enhancement failed:', error);
      }
    }

    // Set defaults if Claude didn't fill them
    if (!lcFields['45A']) {
      lcFields['45A'] = `${sc.product || 'PALM OIL'} - ${sc.quantity_mt || 'XXX'} MT - USD ${sc.contract_price || 'XXX'}/MT - ${sc.incoterms || 'CIF'}`;
    }
    if (!lcFields['46A']) {
      lcFields['46A'] = 'BILL OF LADING, COMMERCIAL INVOICE, PACKING LIST, CERTIFICATE OF ORIGIN';
    }
    if (!lcFields['47A']) {
      lcFields['47A'] = 'All documents must be signed by beneficiary';
    }

    return NextResponse.json({
      success: true,
      lc_fields: lcFields,
    });
  } catch (error: any) {
    console.error('LC generation error:', error);
    return NextResponse.json({ error: `LC 생성 실패: ${error.message}` }, { status: 500 });
  }
}
