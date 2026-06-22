import { NextRequest, NextResponse } from 'next/server';
import { ANTHROPIC_MODEL } from '@/lib/anthropic';

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

// Helper to calculate shipment deadline (usually 30-45 days after shipment month start)
function calculateShipmentDeadline(shipmentMonth: string): string {
  if (!shipmentMonth) return '';
  try {
    const [year, month] = shipmentMonth.split('-');
    const date = new Date(parseInt(year), parseInt(month), 25); // Mid-month
    date.setDate(date.getDate() + 35);
    return date.toISOString().split('T')[0];
  } catch {
    return '';
  }
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
    const today = new Date().toISOString().split('T')[0];
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + 90); // 90 days validity
    const expiryStr = expiryDate.toISOString().split('T')[0];

    const lcFields: LCFields = {
      '40A': 'IRREVOCABLE',
      '20': '', // Documentary credit number - blank for user to fill
      '31C': today,
      '31D': expiryStr, // Date and place of expiry
      '50': sc.supplier || '삼양식품', // Applicant
      '59': sc.supplier || '', // Beneficiary
      '32B': formatCurrency(sc.contract_price, 'USD'),
      '39A': '+/- 5 PERCENT',
      '41D': 'ANY BANK BY NEGOTIATION',
      '42C': 'SIGHT',
      '43P': 'ALLOWED',
      '43T': 'ALLOWED',
      '44A': sc.loading_port || '',
      '44B': sc.discharge_port || '',
      '44C': calculateShipmentDeadline(sc.shipment_month || ''),
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
          max_tokens: 1500,
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
          const claudeText = response.content[0].type === 'text' ? response.content[0].text : '';
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
