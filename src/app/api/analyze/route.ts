import { NextRequest, NextResponse } from 'next/server';
import { dbAll } from '@/lib/db';
import { seedInitialData } from '@/lib/seed-data';
import { calculateBoxRange } from '@/lib/box-range';
import Anthropic from '@anthropic-ai/sdk';

export async function POST(request: NextRequest) {
  try {
    await seedInitialData();

    // Gather context
    const recentNews = await dbAll(
      `SELECT date, content, sentiment, impact FROM news ORDER BY date DESC LIMIT 10`
    );

    const recentPrices = await dbAll(
      `SELECT date, contract_month, settlement_usd FROM fcpo_settlement
       WHERE contract_month IN ('2026-04', '2026-05', '2026-06')
       ORDER BY date DESC LIMIT 30`
    );

    const inventory = await dbAll(
      `SELECT product, year, month, ending_stock, coverage_days
       FROM inventory WHERE year = 2026 ORDER BY product, month`
    );

    const boxRange = await calculateBoxRange('2026-04');

    const alerts = await dbAll(
      `SELECT * FROM alerts WHERE is_active = 1 ORDER BY alert_level`
    );

    const prompt = `당신은 삼양식품 원재료구매팀의 팜유 구매 전문 분석가입니다. 아래 데이터를 종합하여 현재 시장 상황과 구매 전략을 분석해주세요.

## 최근 시황 뉴스
${JSON.stringify(recentNews, null, 2)}

## 최근 FCPO 가격 (USD/MT)
${JSON.stringify(recentPrices.slice(0, 15), null, 2)}

## 재고 현황 (2026년)
${JSON.stringify(inventory, null, 2)}

## 박스권 분석 (2026-04월물)
${boxRange ? JSON.stringify({
  current_price: boxRange.current_price,
  zone: boxRange.current_zone,
  zones: boxRange.zones,
  trends: boxRange.trends,
  volatility: boxRange.volatility,
  confidence: boxRange.confidence,
}, null, 2) : '데이터 부족'}

## 활성 알람
${JSON.stringify(alerts, null, 2)}

다음 형식으로 분석 결과를 JSON으로 반환해주세요:
{
  "market_summary": "현재 시장 상황 요약 (2-3문장)",
  "buy_recommendation": "구매 관점 의견 (2-3문장)",
  "risk_factors": ["리스크 요인 1", "리스크 요인 2"],
  "action_items": ["조치사항 1", "조치사항 2"],
  "outlook": "단기/중기 전망 (1-2문장)"
}`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Return mock analysis if no API key
      const mockResult = {
        market_summary: "현재 팜유 시장은 단기 약세 국면입니다. 말레이시아 재고 부담과 인도 수입관세 이슈가 하방 압력을 가하고 있으나, 인도네시아 B50 시행 기대가 하단을 지지하고 있습니다.",
        buy_recommendation: "현재가가 박스권 전량구매 구간에 위치하고 있어 매수 적기로 판단됩니다. RBD 8월 재고 소진이 예상되므로 5월 선적물 확보가 시급합니다.",
        risk_factors: ["인도 수입관세 인상 시 수요 감소 가능", "말레이시아 재고 추가 증가 시 하방 압력"],
        action_items: ["5월 선적물 RBD 2,600톤 전량구매 검토", "RSPO 4월 선적물 400톤 추가 확보"],
        outlook: "단기 약세 지속 전망이나 B50 시행(6월)을 앞두고 중기적으로 반등 가능성 있음."
      };

      const { dbRun } = await import('@/lib/db');
      await dbRun(
        `INSERT INTO analyses (analysis_type, input_data, result, model) VALUES ('market', ?, ?, 'mock')`,
        [JSON.stringify({ news_count: recentNews.length }), JSON.stringify(mockResult)]
      );

      return NextResponse.json(mockResult);
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { market_summary: text };

    const { dbRun } = await import('@/lib/db');
    await dbRun(
      `INSERT INTO analyses (analysis_type, input_data, result, model) VALUES ('market', ?, ?, ?)`,
      [JSON.stringify({ news_count: recentNews.length }), JSON.stringify(result), 'claude-sonnet-4-20250514']
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
