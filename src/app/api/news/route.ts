import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbLastId } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '@/lib/anthropic';

// Ensure full_content column exists (migration-safe).
// No-op under PostgreSQL/Supabase: schema is managed out-of-band via schema.sql.
async function ensureFullContentColumn() {
  return;
}

// AI로 뉴스 sentiment/impact 판단 (단건)
async function analyzeNewsWithAI(content: string): Promise<{ sentiment: string; impact: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { sentiment: '보합', impact: 'Medium' };

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `당신은 팜유 시장 전문 분석가입니다. 다음 뉴스의 팜유 가격에 대한 시황 전망과 영향도를 판단해주세요.

뉴스: "${content}"

반드시 아래 JSON만 반환하세요 (다른 텍스트 없이):
{"sentiment": "강세 또는 약세 또는 보합", "impact": "High 또는 Medium 또는 Low"}

판단 기준:
- sentiment: 팜유 가격 상승 요인이면 "강세", 하락 요인이면 "약세", 중립적이면 "보합"
- impact: 가격에 직접적/큰 영향이면 "High", 간접적/보통이면 "Medium", 미미하면 "Low"`
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const validSentiments = ['강세', '약세', '보합'];
      const validImpacts = ['High', 'Medium', 'Low'];
      return {
        sentiment: validSentiments.includes(parsed.sentiment) ? parsed.sentiment : '보합',
        impact: validImpacts.includes(parsed.impact) ? parsed.impact : 'Medium',
      };
    }
  } catch (err) {
    console.warn('AI news analysis failed:', err);
  }
  return { sentiment: '보합', impact: 'Medium' };
}

// 잘린 JSON 배열 복구 시도
function tryRepairTruncatedJson(jsonStr: string): any[] | null {
  try {
    return JSON.parse(jsonStr);
  } catch {
    // 잘린 JSON 복구 시도: 마지막 완전한 객체까지만 파싱
    let repaired = jsonStr.trim();

    // 마지막 완전한 '}' 찾기
    const lastCompleteObj = repaired.lastIndexOf('}');
    if (lastCompleteObj === -1) return null;

    repaired = repaired.substring(0, lastCompleteObj + 1);

    // 배열 닫기
    if (!repaired.endsWith(']')) {
      // 마지막 객체 뒤에 쉼표가 있으면 제거
      repaired = repaired.replace(/,\s*$/, '');
      repaired += ']';
    }

    // 배열 시작이 없으면 추가
    if (!repaired.trimStart().startsWith('[')) {
      repaired = '[' + repaired;
    }

    try {
      const result = JSON.parse(repaired);
      if (Array.isArray(result) && result.length > 0) {
        console.warn(`JSON 복구 성공: 잘린 응답에서 ${result.length}개 기사 추출`);
        return result;
      }
    } catch {
      // 복구 실패
    }
    return null;
  }
}

// Claude API로 대량 텍스트를 기사 단위로 파싱 + 시황/영향도 분석
async function parseBulkNewsWithAI(rawText: string): Promise<Array<{
  date: string;
  title: string;
  full_content: string;
  sentiment: string;
  impact: string;
}>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY가 설정되지 않았습니다');

  const client = new Anthropic({ apiKey });

  const response = await client.messages.create({
    model: ANTHROPIC_MODEL,
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: `당신은 팜유/유지류 시황 뉴스 전문 파서입니다.

아래 텍스트에서 개별 뉴스 기사를 분리하고 각각에 대해 분석해주세요.

**텍스트:**
${rawText}

**각 기사별로 추출할 항목:**
1. date: 기사의 실제 날짜 (YYYY-MM-DD 형식). 본문에서 날짜를 찾아주세요 (예: "2026.03.31", "[03/31]", "3월 30일" 등). 올해는 2026년입니다.
2. title: 기사 제목 또는 핵심 요약 (1줄, 50자 이내)
3. full_content: 해당 기사의 전체 내용 (원문 그대로, 줄바꿈 포함. JSON 문자열 내에서 줄바꿈은 반드시 \\n으로 이스케이프)
4. sentiment: 팜유 가격 전망 - "강세"(상승 요인), "약세"(하락 요인), "보합"(중립)
5. impact: 영향도 - "High"(직접적/큰 영향), "Medium"(간접적/보통), "Low"(미미)

**sentiment 판단 기준:**
- B50 도입, 수출 증가, 생산량 감소, 유가 상승, 재고 감소 → 강세
- 수출세 인하, 생산량 증가, 재고 증가, 수요 감소 → 약세
- 혼재된 요인, 정책 변경 관망 → 보합

**중요: 반드시 유효한 JSON 배열만 반환하세요. 코드블록(\`\`\`)이나 설명 텍스트 없이 JSON만 출력하세요.**
**중요: full_content 내의 줄바꿈은 \\n으로, 따옴표는 \\"으로 이스케이프하세요.**
[
  {
    "date": "2026-03-31",
    "title": "인도네시아 B50 재도입 기대감에 팜유 상승",
    "full_content": "전체 기사 내용...",
    "sentiment": "강세",
    "impact": "High"
  }
]`
    }],
  });

  const text = response.content[0].type === 'text' ? response.content[0].text : '';
  const stopReason = response.stop_reason;

  // 응답이 max_tokens로 잘렸는지 확인
  if (stopReason === 'max_tokens') {
    console.warn('Claude 응답이 max_tokens 제한으로 잘렸습니다. 잘린 JSON 복구를 시도합니다.');
  }

  // JSON 추출
  let jsonStr = text;
  const codeMatch = text.match(/\`\`\`(?:json)?\s*([\s\S]*?)\`\`\`/);
  if (codeMatch) {
    jsonStr = codeMatch[1].trim();
  } else {
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (arrMatch) {
      jsonStr = arrMatch[0];
    }
  }

  // JSON 파싱 (복구 로직 포함)
  let parsed = tryRepairTruncatedJson(jsonStr);
  if (!parsed || parsed.length === 0) {
    // 원본 텍스트에서 재시도
    const arrMatch = text.match(/\[[\s\S]*/);
    if (arrMatch) {
      parsed = tryRepairTruncatedJson(arrMatch[0]);
    }
  }

  if (!parsed || parsed.length === 0) {
    throw new Error('뉴스 파싱 실패: Claude 응답에서 유효한 JSON을 추출할 수 없습니다. 텍스트를 나누어 업로드해보세요.');
  }

  // Validate and clean
  const validSentiments = ['강세', '약세', '보합'];
  const validImpacts = ['High', 'Medium', 'Low'];

  return parsed.map((item: any) => ({
    date: item.date || new Date().toISOString().slice(0, 10),
    title: item.title || item.full_content?.substring(0, 50) || '',
    full_content: item.full_content || '',
    sentiment: validSentiments.includes(item.sentiment) ? item.sentiment : '보합',
    impact: validImpacts.includes(item.impact) ? item.impact : 'Medium',
  }));
}

export async function GET(request: NextRequest) {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    try { await ensureFullContentColumn(); } catch (e: any) { console.warn('Migration skipped:', e.message); }

    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30');

    const data = await dbAll('SELECT * FROM news ORDER BY date DESC, id DESC LIMIT ?', [limit]);

    // Sentiment summary
    const recent = await dbAll(
      `SELECT sentiment, COUNT(*) as cnt FROM news WHERE date::date >= (CURRENT_DATE - INTERVAL '7 days') GROUP BY sentiment`
    ) as { sentiment: string; cnt: number }[];

    return NextResponse.json({ data, sentiment_summary: recent });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    try { await ensureFullContentColumn(); } catch (e: any) { console.warn('Migration skipped:', e.message); }

    const body = await request.json();

    // 대량 업로드 모드 — Claude API로 기사 파싱
    if (body.bulk_text && typeof body.bulk_text === 'string') {
      const articles = await parseBulkNewsWithAI(body.bulk_text);
      const results = [];

      for (const article of articles) {
        await dbRun(
          `INSERT INTO news (date, content, full_content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [article.date, article.title, article.full_content, article.sentiment, article.impact, 'bulk_upload']
        );
        const id = await dbLastId();
        results.push({ id, date: article.date, content: article.title, sentiment: article.sentiment, impact: article.impact });
      }

      return NextResponse.json({ success: true, count: results.length, results });
    }

    // 레거시 대량 업로드 (이전 형식 호환)
    if (body.bulk_items && Array.isArray(body.bulk_items)) {
      const results = [];
      for (const item of body.bulk_items) {
        const aiResult = await analyzeNewsWithAI(item.content);
        await dbRun(
          `INSERT INTO news (date, content, full_content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
          [item.date, item.content, item.full_content || null, aiResult.sentiment, aiResult.impact, 'bulk_upload']
        );
        const id = await dbLastId();
        results.push({ id, content: item.content, ...aiResult });
      }
      return NextResponse.json({ success: true, count: results.length, results });
    }

    // 단건 입력
    const { date, content, full_content, sentiment, impact, created_by, auto_analyze } = body;

    let finalSentiment = sentiment;
    let finalImpact = impact;

    if (auto_analyze || (!sentiment && !impact)) {
      const aiResult = await analyzeNewsWithAI(full_content || content);
      finalSentiment = aiResult.sentiment;
      finalImpact = aiResult.impact;
    }

    await dbRun(
      `INSERT INTO news (date, content, full_content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
      [date, content, full_content || null, finalSentiment || '보합', finalImpact || 'Medium', created_by || 'user']
    );

    const id = await dbLastId();
    return NextResponse.json({
      success: true,
      id,
      ai_analyzed: auto_analyze || (!sentiment && !impact),
      sentiment: finalSentiment,
      impact: finalImpact,
    });
  } catch (error: any) {
    console.error('News POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const ids = searchParams.get('ids');

    if (id === 'all') {
      // 전체 삭제
      await dbRun('DELETE FROM news');
      return NextResponse.json({ success: true, message: 'All news deleted' });
    }

    if (ids) {
      // 다건 삭제: ids=1,2,3
      const idList = ids.split(',').map(i => parseInt(i.trim())).filter(i => !isNaN(i));
      if (idList.length === 0) {
        return NextResponse.json({ error: 'No valid ids provided' }, { status: 400 });
      }
      const placeholders = idList.map(() => '?').join(',');
      await dbRun(`DELETE FROM news WHERE id IN (${placeholders})`, idList);
      return NextResponse.json({ success: true, deleted: idList.length });
    }

    if (!id) {
      return NextResponse.json({ error: 'id, ids, or id=all is required' }, { status: 400 });
    }

    await dbRun('DELETE FROM news WHERE id = ?', [parseInt(id)]);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
