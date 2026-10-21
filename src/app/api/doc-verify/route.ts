import { NextRequest, NextResponse } from 'next/server';
import { ANTHROPIC_MODEL, LOW_EFFORT, responseText } from '@/lib/anthropic';

export const maxDuration = 60; // Claude 호출 (PDF 직접 판독)

// PDF 는 텍스트를 따로 뽑지 않고 document 블록으로 Claude 에 직접 보낸다 (다른 업로드 라우트와 동일).
// (이전: pdf-parse 1.x 방식 `pdfParse(buffer)` 호출 — 설치된 2.x 는 PDFParse 클래스만 내보내
//  'pdfParse is not a function' 으로 모든 검증이 500. 텍스트층이 없는 스캔본 B/L·인보이스도 빈 텍스트로 판정됐음)
function isPdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 5).toString('latin1') === '%PDF-';
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
  // 실제로 검증이 끝났는지. Claude 호출·JSON 해석이 실패하면 false — 화면이 '통과' 로 보이지 않게
  // (이전: 실패해도 success:true + 불일치 0건이라 초록색 '통과' 카드로 표시)
  verified: boolean;
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
    if (!isPdf(buffer)) {
      return NextResponse.json({ error: 'PDF 파일만 검증할 수 있습니다' }, { status: 400 });
    }

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
      verified: false,
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
          max_tokens: 16000, // thinking 포함 한도
          output_config: LOW_EFFORT,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'document',
                  source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') },
                },
                {
                  type: 'text',
                  text: `You are a trade finance document verification expert. Analyze the attached shipping document and compare it against the LC conditions.

${lcDescription}

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
            },
          ],
        });

        try {
          const claudeText = responseText(response);
          const jsonMatch = claudeText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            verificationData.verified = true;
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
