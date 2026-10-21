import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbGet, dbRun } from '@/lib/db';
import { calculateBoxRange } from '@/lib/box-range';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { ANTHROPIC_MODEL, LOW_EFFORT } from '@/lib/anthropic';
import { kstNow } from '@/lib/kst';

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // 모델 응답 10~15초(Sonnet 5.5, effort low) — 여유를 두고 60초

// 분석 결과 스키마 — 구조화 출력(output_config.format)으로 강제. UI 가 action 문자열로 색을 입히므로 enum.
const AnalysisSchema = z.object({
  market_summary: z.string().describe('현재 시장 상황 요약 (2-3문장)'),
  buy_recommendation: z.string().describe('구매 관점 의견 (2-3문장)'),
  monthly_strategy: z.array(z.object({
    month: z.string().describe('월물 YYYY-MM'),
    action: z.enum(['전량구매', '적극매수', '모니터링', '대기']).describe('현재 시장 상황과 재고를 고려한 구매 전략'),
    target_price: z.number().describe('해당 월물의 매수 목표가 (USD/MT)'),
    volume_mt: z.number().describe('권장 구매 물량 (톤) — 재고 소진 예상일 등 고려'),
    reason: z.string().describe('그 전략을 추천하는 구체적 근거 (1-2문장)'),
  })),
  risk_factors: z.array(z.string()).describe('리스크 요인 2-4개'),
  action_items: z.array(z.string()).describe('조치사항 2-4개'),
  outlook: z.string().describe('단기/중기 전망 (1-2문장)'),
});

// 분석 대상 월물: FCPO DB 최신 거래일에 시세가 있는 월물 중 현재월 이후 가장 가까운 3개.
// (이전에는 '2026-04/05/06' 고정이라 시간이 지나면 만기 월물을 분석하는 문제가 있었음)
async function resolveTargetMonths(now = new Date()): Promise<{ latestDate: string | null; months: string[] }> {
  const latest = await dbGet(`SELECT date::text AS date FROM fcpo_settlement ORDER BY date DESC LIMIT 1`) as { date: string } | undefined;
  if (!latest) return { latestDate: null, months: [] };
  const curYm = kstNow(now).ym; // 한국 시간 기준
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
    const currentYear = kstNow(now).year;
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

분석 결과는 지정된 JSON 스키마로 반환됩니다. monthly_strategy 는 ${months.join(', ')} 월물 각각 1건을 이 순서로 넣고,
action 은 전량구매 / 적극매수 / 모니터링 / 대기 중 하나, target_price 는 USD/MT 숫자, volume_mt 는 톤 숫자로 적어주세요.
risk_factors 와 action_items 는 2~4개씩, 모든 문장은 한국어로 작성합니다.`;

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

    // 구조화 출력으로 스키마에 맞는 JSON 만 받고 SDK 가 파싱(parsed_output)한다.
    // (이전: max_tokens 1024 + 정규식 JSON 추출 → 한글 응답이 1,024 토큰에서 잘려
    //  "Expected ',' or ']' after array element in JSON" 파싱 오류가 났음)
    // effort low: 같은 스키마로 실측 Sonnet 5.5 10~14초 (이전 Sonnet 4.6: low 22초, medium 52초).
    // 타임아웃 55초: Vercel maxDuration 60초 안에 오류를 돌려주기 위함.
    const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
    const message = await client.messages.parse({
      model: ANTHROPIC_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { ...LOW_EFFORT, format: zodOutputFormat(AnalysisSchema) },
      messages: [{ role: 'user', content: prompt }],
    });
    if (message.stop_reason === 'max_tokens') {
      return NextResponse.json({ error: '분석 응답이 길이 제한에서 잘렸습니다. 다시 실행해 주세요.' }, { status: 502 });
    }
    if (message.stop_reason === 'refusal') {
      return NextResponse.json({ error: '모델이 이 요청에 대한 응답을 거부했습니다.' }, { status: 502 });
    }
    const parsed = message.parsed_output;
    if (!parsed) {
      const text = message.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? '';
      return NextResponse.json({ error: `분석 응답을 해석하지 못했습니다: ${text.slice(0, 200)}` }, { status: 502 });
    }
    const result = { ...parsed, analysis_months: months, as_of: latestDate };

    await dbRun(
      `INSERT INTO analyses (analysis_type, input_data, result, model) VALUES ('market', ?, ?, ?)`,
      [JSON.stringify({ news_count: recentNews.length, months }), JSON.stringify(result), ANTHROPIC_MODEL]
    );

    return NextResponse.json(result);
  } catch (error: unknown) {
    // SDK 오류는 종류별 사용자용 메시지 (가장 구체적인 것부터; Timeout 은 APIError 의 하위이므로 먼저)
    if (error instanceof Anthropic.AuthenticationError) return NextResponse.json({ error: 'ANTHROPIC_API_KEY 가 유효하지 않습니다.' }, { status: 500 });
    if (error instanceof Anthropic.RateLimitError) return NextResponse.json({ error: 'API 요청 한도를 넘었습니다. 잠시 후 다시 실행해 주세요.' }, { status: 429 });
    if (error instanceof Anthropic.APIConnectionTimeoutError) return NextResponse.json({ error: '모델 응답 시간이 초과됐습니다. 다시 실행해 주세요.' }, { status: 504 });
    if (error instanceof Anthropic.APIError) return NextResponse.json({ error: `Anthropic API 오류 ${error.status ?? ''}: ${error.message}` }, { status: 502 });
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
