import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbLastId } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';

// AI로 뉴스 sentiment/impact 판단
async function analyzeNewsWithAI(content: string): Promise<{ sentiment: string; impact: string }> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { sentiment: '보합', impact: 'Medium' };

  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
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

export async function GET(request: NextRequest) {
  try {
    try { await seedInitialData(); } catch (e: any) { console.warn('Seed skipped:', e.message); }
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '30');

    const data = await dbAll('SELECT * FROM news ORDER BY date DESC, id DESC LIMIT ?', [limit]);

    // Sentiment summary
    const recent = await dbAll(
      `SELECT sentiment, COUNT(*) as cnt FROM news WHERE date >= date('now', '-7 days') GROUP BY sentiment`
    ) as { sentiment: string; cnt: number }[];

    return NextResponse.json({ data, sentiment_summary: recent });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { date, content, sentiment, impact, created_by, auto_analyze } = body;

    // 대량 업로드 모드
    if (body.bulk_items && Array.isArray(body.bulk_items)) {
      const results = [];
      for (const item of body.bulk_items) {
        const aiResult = await analyzeNewsWithAI(item.content);
        await dbRun(
          `INSERT INTO news (date, content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?)`,
          [item.date, item.content, aiResult.sentiment, aiResult.impact, 'bulk_upload']
        );
        const id = await dbLastId();
        results.push({ id, content: item.content, ...aiResult });
      }
      return NextResponse.json({ success: true, count: results.length, results });
    }

    // 단건 입력 — AI 자동 판단 모드
    let finalSentiment = sentiment;
    let finalImpact = impact;

    if (auto_analyze || (!sentiment && !impact)) {
      const aiResult = await analyzeNewsWithAI(content);
      finalSentiment = aiResult.sentiment;
      finalImpact = aiResult.impact;
    }

    await dbRun(
      `INSERT INTO news (date, content, sentiment, impact, created_by) VALUES (?, ?, ?, ?, ?)`,
      [date, content, finalSentiment || '보합', finalImpact || 'Medium', created_by || 'user']
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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const idsParam = searchParams.get('ids'); // 대량 삭제: comma-separated ids

    if (idsParam) {
      // 대량 삭제
      const ids = idsParam.split(',').map(s => parseInt(s.trim())).filter(n => !isNaN(n));
      if (ids.length === 0) {
        return NextResponse.json({ error: 'valid ids are required' }, { status: 400 });
      }
      const placeholders = ids.map(() => '?').join(',');
      await dbRun(`DELETE FROM news WHERE id IN (${placeholders})`, ids);
      return NextResponse.json({ success: true, deleted: ids.length });
    }

    if (!id) {
      return NextResponse.json({ error: 'id or ids is required' }, { status: 400 });
    }
    await dbRun('DELETE FROM news WHERE id = ?', [parseInt(id)]);
    return NextResponse.json({ success: true, deleted: 1 });
  } catch (error: any) {
    console.error('News DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
