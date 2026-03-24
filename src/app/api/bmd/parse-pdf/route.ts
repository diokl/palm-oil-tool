import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ParsedBMDData {
  report_date: string;
  exchange_rate: number | null;
  rbd_palm_oil: Array<{ month: string; contract_month: string; ask: number }>;
  rbd_palm_olein: Array<{ month: string; contract_month: string; ask: number; bid: number | null; values: number | null }>;
  fcpo_usd: Array<{ month: string; contract_month: string; last_done_trade: number }>;
  cpo_myr: Array<{ month: string; contract_month: string; ask: number; bid: number | null }>;
}

const EXTRACTION_PROMPT = `You are a BMD (Bursa Malaysia Derivatives) market data extractor.
Analyze this PDF and extract the following data in EXACT JSON format.

Extract:
1. report_date: The report date in "YYYY-MM-DD" format
2. exchange_rate: The Ringgit/USD exchange rate (number)
3. rbd_palm_oil: Array of RBD PALM OIL entries. For each month, extract:
   - month: month name as shown (e.g. "Apr", "May", "Jun", "Jul/Aug/Sep")
   - contract_month: in "YYYY-MM" format (use the first month for quarter contracts)
   - ask: the ASK price (number, USD/MT)
4. rbd_palm_olein: Array of RBD PALM OLEIN entries with:
   - month, contract_month, ask, bid (number or null), values (number or null)
5. fcpo_usd: Array of Bursa Malaysia FCPO USD entries with:
   - month, contract_month, last_done_trade (number)
6. cpo_myr: Array of Malaysian Crude Palm Oil in Ringgit entries with:
   - month, contract_month, ask, bid (number or null)

Rules:
- Prices are typically between 500-3000 USD/MT or MYR/MT
- For quarter contracts like "Jul/Aug/Sep", use the first month for contract_month
- For months Jan-Mar, they likely belong to the NEXT year
- If a value is "N/A", "-", or missing, use null
- Return ONLY valid JSON, no markdown, no explanation

Return exactly this JSON structure:
{
  "report_date": "YYYY-MM-DD",
  "exchange_rate": number,
  "rbd_palm_oil": [...],
  "rbd_palm_olein": [...],
  "fcpo_usd": [...],
  "cpo_myr": [...]
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
