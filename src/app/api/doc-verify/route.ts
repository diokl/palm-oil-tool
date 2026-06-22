import { NextRequest, NextResponse } from 'next/server';
import { ANTHROPIC_MODEL } from '@/lib/anthropic';

async function parsePdf(buffer: Buffer): Promise<string> {
  const mod = await import('pdf-parse');
  const pdfParse = (mod as any).default || mod;
  const data = await pdfParse(buffer);
  return data.text;
}

interface LCData {
  '45A'?: string;
  '46A'?: string;
  '47A'?: string;
  [key: string]: string | undefined;
}

interface Discrepancy {
  field: string;
  lc_value: string;
  doc_value: string;
  severity: 'error' | 'warning' | 'info';
}

interface VerificationResult {
  document_type: string;
  extracted_fields: Record<string, any>;
  discrepancies: Discrepancy[];
  summary: string;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const lcDataStr = formData.get('lc_data') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Extract text from PDF
    const documentText = await parsePdf(buffer);

    // Parse LC data
    let lcData: LCData = {};
    if (lcDataStr) {
      try {
        lcData = JSON.parse(lcDataStr);
      } catch (e) {
        console.warn('Failed to parse LC data:', e);
      }
    }

    // Use Claude to verify document
    let verificationData: VerificationResult = {
      document_type: 'Unknown',
      extracted_fields: {},
      discrepancies: [],
      summary: '',
    };

    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const Anthropic = (await import('@anthropic-ai/sdk')).default;
        const client = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
        });

        const lcDescription = lcData
          ? `LC Requirements:
- Description of Goods (45A): ${lcData['45A'] || 'Not specified'}
- Required Documents (46A): ${lcData['46A'] || 'Not specified'}
- Additional Conditions (47A): ${lcData['47A'] || 'Not specified'}`
          : 'No LC data provided for comparison';

        const response = await client.messages.create({
          model: ANTHROPIC_MODEL,
          max_tokens: 2000,
          messages: [
            {
              role: 'user',
              content: `You are a trade finance document verification expert. Analyze this shipping document and compare it against the LC conditions.

${lcDescription}

Document text:
${documentText.substring(0, 3000)}

Provide your response as JSON with this structure:
{
  "document_type": "Bill of Lading|Invoice|Packing List|Certificate of Origin|Other",
  "extracted_fields": {
    "shipper": "...",
    "consignee": "...",
    "product_description": "...",
    "quantity": "...",
    "unit": "...",
    "shipping_marks": "...",
    "bill_of_lading_number": "...",
    "invoice_number": "...",
    "invoice_date": "...",
    "origin_country": "..."
  },
  "discrepancies": [
    {
      "field": "field name",
      "lc_requirement": "what LC requires",
      "document_value": "what document shows",
      "severity": "error|warning|info",
      "reason": "explanation"
    }
  ],
  "summary": "Brief overall assessment - any critical discrepancies?"
}

Return only valid JSON, no other text.`,
            },
          ],
        });

        try {
          const claudeText = response.content[0].type === 'text' ? response.content[0].text : '';
          const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            verificationData.document_type = parsed.document_type || 'Unknown';
            verificationData.extracted_fields = parsed.extracted_fields || {};
            verificationData.summary = parsed.summary || '';

            // Transform discrepancies to match expected format
            if (Array.isArray(parsed.discrepancies)) {
              verificationData.discrepancies = parsed.discrepancies.map((d: any) => ({
                field: d.field || 'Unknown',
                lc_value: d.lc_requirement || d.lc_value || '',
                doc_value: d.document_value || '',
                severity: d.severity || 'warning',
              }));
            }
          }
        } catch (parseError) {
          console.warn('Failed to parse Claude response:', parseError);
          verificationData.summary = 'Document analysis completed but with parsing limitations';
        }
      } catch (error) {
        console.warn('Claude API verification failed:', error);
        verificationData.summary = 'Document received but verification API unavailable';
      }
    } else {
      verificationData.summary = 'ANTHROPIC_API_KEY not configured';
    }

    return NextResponse.json({
      success: true,
      verification: verificationData,
    });
  } catch (error: any) {
    console.error('Document verification error:', error);
    return NextResponse.json({ error: `서류 검증 실패: ${error.message}` }, { status: 500 });
  }
}
