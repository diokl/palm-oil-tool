import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';

interface ParsedBMDRow {
  month: string;
  contract_month: string;
  ask: number;
  ric?: string;
}

interface ParsedBMDData {
  report_date: string;
  exchange_rate: number | null;
  rbd_palm_oil: ParsedBMDRow[];
  warnings?: string[];
}

const EXTRACTION_PROMPT = `You are a BMD (Bursa Malaysia Derivatives) market data extractor.
Analyze this PDF and extract ONLY the "RBD PALM OIL" physical section (NOT "RBD PALM OLEIN",
NOT "RBD PALM STEARIN", NOT "RBD PALM KERNEL OIL", NOT "FCPO", NOT "CPO in Ringgit").

The target section is the standalone header literally spelled "RBD PALM OIL" that lists
ASK prices with RIC codes in the form <PO-MYRBD-M1> ... <PO-MYRBD-Q3>. Use the RIC codes
as the primary signal to locate the correct section — if a row's RIC does not start with
"PO-MYRBD-", ignore it.

CRITICAL: The RBD PALM OIL table has EXACTLY 6 rows with these RIC codes in order:
  1. PO-MYRBD-M1  (first near month, e.g. "April")
  2. PO-MYRBD-M2  (second near month, e.g. "May")
  3. PO-MYRBD-M3  (third near month, e.g. "June")
  4. PO-MYRBD-Q1  (first forward quarter, label "Jul/Aug/Sep")
  5. PO-MYRBD-Q2  (second forward quarter, label "Oct/Nov/Dec")
  6. PO-MYRBD-Q3  (third forward quarter, label "Jan/Feb/Mar")

The RBD PALM OIL table frequently spans a page break — the "RBD PALM OIL" header and the
FIRST row (M1) often appear at the bottom of one page while the remaining rows continue on
the next page. You MUST scan BOTH pages and return ALL 6 rows. Before finalizing your JSON,
verify your rbd_palm_oil array contains exactly 6 entries with RIC codes M1, M2, M3, Q1, Q2, Q3.
If the first row (M1) is only visible at the very bottom of a page, do not skip it.

Extract in EXACT JSON format:
1. report_date: The report date in "YYYY-MM-DD" format
2. exchange_rate: The Malaysian Ringgit/USD exchange rate (number, or null if missing)
3. rbd_palm_oil: Array of 6 entries from the RBD PALM OIL section. For each row return:
   - month: month label as shown (e.g. "April", "May", "June", "Jul/Aug/Sep", "Oct/Nov/Dec", "Jan/Feb/Mar")
   - contract_month: "YYYY-MM" using the FIRST month of the label (server will expand quarters later)
   - ask: the ASK price (number, USD/MT)
   - ric: the RIC code exactly as shown without angle brackets (e.g. "PO-MYRBD-M1")

Rules:
- Prices are typically between 500-3000 USD/MT
- For quarter contracts like "Jul/Aug/Sep", contract_month uses the first month (e.g. "2026-07")
- For Jan/Feb/Mar rows, they belong to the NEXT year relative to the report date
- If ASK is truly "N/A", "-", or blank, skip that row entirely (but this is rare — usually all 6 have ASK)
- Do NOT include any other palm oil products, even if they contain "PALM" or "OIL" in the name
- Return ONLY valid JSON, no markdown, no explanation

Return exactly this JSON structure:
{
  "report_date": "YYYY-MM-DD",
  "exchange_rate": number,
  "rbd_palm_oil": [...]
}`;

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// 복합월 row(Q1~Q3)를 개별 월로 펼친다.
// 라벨의 "/" 개수+1로 실제 개월 수를 판단 → "May/Jun"=2개월, "Jul/Aug/Sep"=3개월
// 단독월(M1~M3)과 contract_month가 겹치면 중복 제거한다.
function expandQuarterRows(rows: ParsedBMDRow[]): ParsedBMDRow[] {
  // 1단계: 단독월 contract_month 모아두기 (중복 제거용)
  const singleMonthKeys = new Set<string>();
  for (const row of rows) {
    const isMulti = (row.ric && /-Q[1-3]$/.test(row.ric)) || /\//.test(row.month);
    if (!isMulti) {
      singleMonthKeys.add(row.contract_month);
    }
  }

  // 2단계: expand
  const expanded: ParsedBMDRow[] = [];
  for (const row of rows) {
    const isMulti = (row.ric && /-Q[1-3]$/.test(row.ric)) || /\//.test(row.month);
    if (!isMulti) {
      expanded.push({ month: row.month, contract_month: row.contract_month, ask: row.ask, ric: row.ric });
      continue;
    }
    const m = row.contract_month.match(/^(\d{4})-(\d{2})$/);
    if (!m) {
      expanded.push(row);
      continue;
    }
    // "/" 개수 + 1 = 실제 개월 수. "May/Jun"→2, "Jul/Aug/Sep"→3, "Jan/Feb/Mar"→3
    const slashCount = (row.month.match(/\//g) || []).length;
    const monthCount = slashCount + 1;

    let year = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    for (let i = 0; i < monthCount; i++) {
      const cm = `${year}-${String(month).padStart(2, '0')}`;
      // 단독월에서 이미 존재하면 스킵 (중복 방지)
      if (!singleMonthKeys.has(cm)) {
        expanded.push({
          month: MONTH_NAMES[month - 1],
          contract_month: cm,
          ask: row.ask,
          ric: row.ric,
        });
      }
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
  }
  return expanded;
}

const EXPECTED_RICS = [
  'PO-MYRBD-M1', 'PO-MYRBD-M2', 'PO-MYRBD-M3',
  'PO-MYRBD-Q1', 'PO-MYRBD-Q2', 'PO-MYRBD-Q3',
];

function validateRics(rows: ParsedBMDRow[]): string[] {
  const warnings: string[] = [];
  const foundRics = new Set(
    rows.map((r) => (r.ric || '').replace(/[<>]/g, '').trim()).filter(Boolean)
  );
  const missing = EXPECTED_RICS.filter((r) => !foundRics.has(r));
  if (missing.length > 0) {
    warnings.push(`RBD PALM OIL 섹션에서 다음 RIC를 찾지 못했습니다: ${missing.join(', ')}`);
  }
  return warnings;
}

// M1 복구 전용 프롬프트: 페이지 1 하단에서 M1 row만 찾는다
const M1_RECOVERY_PROMPT = `Look at the BOTTOM of page 1 of this PDF. There is an "RBD PALM OIL" section
that starts near the bottom of page 1. The FIRST data row right under the "RBD PALM OIL" header and
the "ASK / RIC" column header is the M1 row with RIC code <PO-MYRBD-M1>.

Return ONLY a JSON object with these fields for that single M1 row:
- month: the month label (e.g. "March", "April")
- contract_month: "YYYY-MM" format
- ask: the ASK price (number)
- ric: "PO-MYRBD-M1"

Example: {"month":"March","contract_month":"2026-03","ask":1090.00,"ric":"PO-MYRBD-M1"}

Return ONLY valid JSON, no markdown, no explanation.`;

// Claude API 호출 공통 함수
async function callClaude(
  anthropic: Anthropic,
  base64Data: string,
  prompt: string,
): Promise<string> {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64Data },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map((block) => block.text)
    .join('');
}

// Claude 응답 텍스트에서 JSON 추출
function extractJson(responseText: string): string {
  const jsonMatch = responseText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) return jsonMatch[1].trim();
  const objMatch = responseText.match(/\{[\s\S]*\}/);
  if (objMatch) return objMatch[0];
  return responseText;
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

    const arrayBuffer = await file.arrayBuffer();
    const base64Data = Buffer.from(arrayBuffer).toString('base64');
    const anthropic = new Anthropic({ apiKey });

    // 1차 추출
    const responseText = await callClaude(anthropic, base64Data, EXTRACTION_PROMPT);
    const parsed: ParsedBMDData = JSON.parse(extractJson(responseText));
    let rawRows = Array.isArray(parsed.rbd_palm_oil) ? parsed.rbd_palm_oil : [];

    // M1 누락 감지 → 자동 재시도
    const foundRics = new Set(rawRows.map((r) => (r.ric || '').replace(/[<>]/g, '').trim()));
    if (!foundRics.has('PO-MYRBD-M1') && rawRows.length > 0) {
      console.log('[BMD parser] M1 missing — attempting recovery...');
      try {
        const m1Text = await callClaude(anthropic, base64Data, M1_RECOVERY_PROMPT);
        const m1Row: ParsedBMDRow = JSON.parse(extractJson(m1Text));
        if (m1Row && m1Row.ask && m1Row.contract_month) {
          // M1을 맨 앞에 삽입
          m1Row.ric = m1Row.ric || 'PO-MYRBD-M1';
          rawRows = [m1Row, ...rawRows];
          console.log('[BMD parser] M1 recovered:', m1Row.contract_month, m1Row.ask);
        }
      } catch (e) {
        console.warn('[BMD parser] M1 recovery failed:', (e as Error).message);
      }
    }

    const warnings = validateRics(rawRows);
    const expanded = expandQuarterRows(rawRows);

    return NextResponse.json({
      success: true,
      report_date: parsed.report_date,
      exchange_rate: parsed.exchange_rate,
      rbd_palm_oil: expanded,
      warnings: warnings.length > 0 ? warnings : undefined,
      raw_text: `[Claude API로 추출] 파일: ${file.name}, 모델: claude-sonnet-4-20250514`,
    });
  } catch (error: any) {
    console.error('BMD PDF parse error:', error);

    let errorMsg = error.message || 'Unknown error';
    if (errorMsg.includes('authentication') || errorMsg.includes('api_key')) {
      errorMsg = 'Anthropic API 키가 유효하지 않습니다';
    } else if (errorMsg.includes('rate_limit')) {
      errorMsg = 'API 호출 한도 초과. 잠시 후 다시 시도해주세요';
    }

    return NextResponse.json({ error: `PDF 파싱 실패: ${errorMsg}` }, { status: 500 });
  }
}
