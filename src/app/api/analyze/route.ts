import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbGet, dbRun } from '@/lib/db';
import { calculateBoxRange } from '@/lib/box-range';
import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from '@/lib/anthropic';

export const dynamic = 'force-dynamic';

// 분석 대상 월물: FCPO DB 최신 거래일에 시세가 있는 월물 중 현재월 이후 가장 가까운 3개.
// (이전에는 '2026-04/05/06' 고정이라 시간이 지나면 만기 월물을 분석하는 문제가 있었음)
async function resolveTargetMonths(now = new Date()): Promise<{ latestDate: string | null; months: string[] }> {
  const latest = await dbGet(`SELECT date::text AS date FROM fcpo_settlement ORDER BY date DESC LIMIT 1`) as { date: string } | undefined;
  if (!latest) return { latestDate: null, months: [] };
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rows = await dbAll(
    `SELECT DISTINCT contract_month FROM fcpo_settlement
     WHERE date = ? AND contract_month >= ? AND settlement_usd IS NOT NULL
     ORDER BY contract_month LIMIT 3`,
    [latest.date, curYm],
  ) as { contract_month: string }[];
  let months = rows.map(r => r.contract_month);
  if (months.length === 0) {
    // 최신 거래일에 현재월 이후 월물이 없으면 그 날의 최근월물 3개라도 사용
    const fallback = await dbAll(
      `SELECT DISTINCT contract_month FROM fcpo_settlement WHERE date = ? ORDER BY contract_month DESC LIMIT 3`,
      [latest.date],
    ) as { contract_month: string }[];
    months = fallback.map(r => r.contract_month).sort();
  }
  return { latestDate: String(latest.date).slice(0, 10), months };
}

export async function POST(request: NextRequest) {
  try {
    const now = new Date();
    const currentYear = now.getFullYear();
    const { latestDate, months } = await resolveTargetMonths(now);
    if (months.length === 0) {
      return NextResponse.json({ error: 'FCPO 시세 데이터가 없어 분석할 수 없습니다.' }, { status: 400 });
    }
    const primaryMonth = months[0];

    // Gather context
    const recentNews = await dbAll(
      `SELECT date, content, sentiment, impact FROM news ORDER BY date DESC LIMIT 10`
    );

    const placeholders = months.map(() => '?').join(', ');
    const recentPrices = await dbAll(
      `SELECT date, contract_month, settlement_usd FROM fcpo_settlement
       WHERE contract_month IN (${placeholders})
       ORDER BY date DESC, contract_month LIMIT 30`,
      months,
    );

    const inventory = await dbAll(
      `SELECT product, year, month, ending_stock, coverage_days
       FROM inventory WHERE year = ? ORDER BY product, month`,
      [currentYear],
    );

    const boxRange = await calculateBoxRange(primaryMonth);

    const alerts = await dbAll(
      `SELECT * FROM alerts WHERE is_active = 1 ORDER BY alert_level`
    );

    const strategyTemplate = months
      .map((m, i) => i === 0
        ? `    {"month": "${m}", "action": "전량구매/적극매수/모니터링/대기 중 하나", "target_price": 목표단가숫자, "volume_mt": 권장물량숫자, "reason": "이유 1문장"}`
        : `    {"month": "${m}", "action": "...", "target_price": 숫자, "volume_mt": 숫자, "reason": "..."}`)
      .join(',\n');

    const prompt = `당신은 삼양식품 원재료구매팀의 팜유 구매 전문 분석가입니다. 아래 데이터를 종합하여 현재 시장 상황과 구매 전략을 분석해주세요.
기준일: ${latestDate} (FCPO 최신 거래일) / 분석 대상 월물: ${months.join(', ')}

## 최근 시황 뉴스
${JSON.stringify(recentNews, null, 2)}

## 최근 FCPO 가격 (USD/MT)
${JSON.stringify(recentPrices.slice(0, 15), null, 2)}

## 재고 현황 (${currentYear}년)
${JSON.stringify(inventory, null, 2)}

## 박스권 분석 (${primaryMonth}월물)
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
  "monthly_strategy": [
${strategyTemplate}
  ],
  "risk_factors": ["리스크 요인 1", "리스크 요인 2"],
  "action_items": ["조치사항 1", "조치사항 2"],
  "outlook": "단기/중기 전망 (1-2문장)"
}

monthly_strategy의 각 월에 대해:
- action: 현재 시장 상황과 재고를 고려한 구매 전략
- target_price: 해당 월물의 매수 목표가 (USD/MT)
- volume_mt: 권장 구매 물량 (재고 소진 예상일 등 고려)
- reason: 그 전략을 추천하는 구체적 근거`;

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      // Return mock analysis if no API key
      const cur = boxRange?.current_price ?? 0;
      const mockResult = {
        market_summary: `(API 키 미설정 — 예시 분석) ${latestDate} 기준 ${primaryMonth}월물 ${cur ? `$${cur}` : ''} 수준입니다. 실제 분석을 위해 ANTHROPIC_API_KEY 를 설정하세요.`,
        buy_recommendation: `현재 박스권 구간: ${boxRange?.current_zone ?? '데이터 부족'}.`,
        monthly_strategy: months.map((m, i) => ({
          month: m,
          action: i === 0 ? '모니터링' : '대기',
          target_price: cur ? Math.round(cur * 0.98) : 0,
          volume_mt: 0,
          reason: '예시 데이터',
        })),
        risk_factors: ['API 키 미설정 상태의 예시 결과입니다'],
        action_items: ['ANTHROPIC_API_KEY 환경변수 설정'],
        outlook: '-',
        analysis_months: months,
        as_of: latestDate,
      };

      await dbRun(
        `INSERT INTO analyses (analysis_type, input_data, result, model) VALUES ('market', ?, ?, 'mock')`,
        [JSON.stringify({ news_count: recentNews.length, months }), JSON.stringify(mockResult)]
      );

      return NextResponse.json(mockResult);
    }

    const client = new Anthropic({ apiKey });
    const message = await client.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = message.content[0].type === 'text' ? message.content[0].text : '';
    // Extract JSON from response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const result = jsonMatch ? JSON.parse(jsonMatch[0]) : { market_summary: text };
    result.analysis_months = months;
    result.as_of = latestDate;

    await dbRun(
      `INSERT INTO analyses (analysis_type, input_data, result, model) VALUES ('market', ?, ?, ?)`,
      [JSON.stringify({ news_count: recentNews.length, months }), JSON.stringify(result), ANTHROPIC_MODEL]
    );

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
