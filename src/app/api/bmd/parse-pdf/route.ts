import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ParsedBMDData {
  report_date: string;
  exchange_rate: number | null;
  rbd_palm_oil: Array<{ month: string; contract_month: string; ask: number }>;
}

const EXTRACTION_PROMPT = `You are a BMD (Bursa Malaysia Derivatives) market data extractor.
Analyze this PDF and extract ONLY the "RBD PALM OIL" physical section (NOT "RBD PALM OLEIN",
NOT "RBD PALM STEARIN", NOT "RBD PALM KERNEL OIL", NOT "FCPO", NOT "CPO in Ringgit").

The target section is the standalone header literally spelled "RBD PALM OIL" that lists
ASK prices with RIC codes in the form <PO-MYRBD-M1> ... <PO-MYRBD-Q3>. Use the RIC codes
as the primary signal to locate the correct section — if a row's RIC does not start with
"PO-MYRBD-", ignore it.

Extract in EXACT JSON format:
1. report_date: The report date in "YYYY-MM-DD" format
2. exchange_rate: The Malaysian Ringgit/USD exchange rate (number, or null if missing)
3. rbd_palm_oil: Array of entries from the RBD PALM OIL section only. For each row:
   - month: month label as shown (e.g. "April", "May", "Jun", "Jul/Aug/Sep")
   - contract_month: in "YYYY-MM" format (use the FIRST month for quarter contracts)
   - ask: the ASK price (number, USD/MT)

Rules:
- Prices are typically between 500-3000 USD/MT
- For quarter contracts like "Jul/Aug/Sep", use the first month for contract_month
- For months Jan-Mar, they belong to the NEXT year relative to the report date
- If ASK is "N/A", "-", or missing, skip that row entirely
- Do NOT include any other palm oil products, even if they contain "PALM" or "OIL" in the name
- Return ONLY valid JSON, no markdown, no explanation

Return exactly this JSON structure:
{
  "report_date": "YYYY-MM-DD",
  "exchange_rate": number,
  "rbd_palm_oil": [...]
}`;

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

    // Claude API로 PDF 내용 추출
    const anthropic = new Anthropic({ apiKey });

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
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
              text: EXTRACTION_PROMPT,
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

    // JSON 파싱 (코드블록 안에 있을 수 있으므로 추출)
    let jsonStr = responseText;
    const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    } else {
      // Try to find JSON object directly
      const objMatch = responseText.match(/\{[\s\S]*\}/);
      if (objMatch) {
        jsonStr = objMatch[0];
      }
    }

    const parsed: ParsedBMDData = JSON.parse(jsonStr);

    return NextResponse.json({
      success: true,
      ...parsed,
      raw_text: `[Claude API로 추출] 파일: ${file.name}, 모델: claude-sonnet-4-20250514`,
    });
  } catch (error: any) {
    console.error('BMD PDF parse error:', error);

    // 더 구체적인 에러 메시지
    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
      errorMsg = 'Anthropic API 키가 유효하지 않습니다';
    } else if (errorMsg.includes('rate_limit')) {
      errorMsg = 'API 호출 한도 초과. 잠시 후 다시 시도해주세요';
    }

    return NextResponse.json({ error: `PDF 파싱 실패: ${errorMsg}` }, { status: 500 });
  }
}
