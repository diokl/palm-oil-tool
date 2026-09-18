import { dbAll } from './db';
import type { BoxRangeResult, BoxRangeMode } from './types';

// ── 보조 기술적 지표 (종가 기반) ──
// RSI(14), MACD(12,26,9), 볼린저 %B(20, 2σ), 종가 기준 ATR(14) 비율.
// 팜유는 수급·정책 영향이 커서 보조 확인용으로만 사용 (박스권·수급 판단이 우선).
function ema(values: number[], n: number): number[] {
  const k = 2 / (n + 1);
  const out: number[] = [];
  let prev: number | null = null;
  for (const v of values) { prev = prev == null ? v : v * k + prev * (1 - k); out.push(prev); }
  return out;
}
export function computeIndicators(values: number[]): BoxRangeResult['indicators'] | undefined {
  if (values.length < 30) return undefined;
  // RSI 14 (Wilder)
  let gain = 0, loss = 0;
  for (let i = 1; i <= 14; i++) { const d = values[i] - values[i - 1]; if (d > 0) gain += d; else loss -= d; }
  let ag = gain / 14, al = loss / 14;
  for (let i = 15; i < values.length; i++) { const d = values[i] - values[i - 1]; ag = (ag * 13 + Math.max(d, 0)) / 14; al = (al * 13 + Math.max(-d, 0)) / 14; }
  const rsi = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  // MACD
  const e12 = ema(values, 12), e26 = ema(values, 26);
  const macdLine = e12.map((v, i) => v - e26[i]);
  const signalLine = ema(macdLine.slice(25), 9);
  const macd = macdLine[macdLine.length - 1], signal = signalLine[signalLine.length - 1];
  const hist = macd - signal;
  const prevHist = macdLine[macdLine.length - 2] - signalLine[signalLine.length - 2];
  // Bollinger 20, 2σ
  const w = values.slice(-20); const m = w.reduce((s, v) => s + v, 0) / 20;
  const sd = Math.sqrt(w.reduce((s, v) => s + (v - m) ** 2, 0) / 19);
  const upper = m + 2 * sd, lower = m - 2 * sd;
  const last = values[values.length - 1];
  const pctB = upper === lower ? 0.5 : (last - lower) / (upper - lower);
  // ATR proxy (종가 변화 절대값 14일 평균 / 현재가)
  const diffs: number[] = []; for (let i = values.length - 14; i < values.length; i++) diffs.push(Math.abs(values[i] - values[i - 1]));
  const atr = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const r = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;
  const rsiLabel = rsi >= 70 ? '과매수' : rsi <= 30 ? '과매도' : rsi >= 60 ? '강세권' : rsi <= 40 ? '약세권' : '중립';
  const macdLabel = hist > 0 ? (prevHist <= 0 ? '골든크로스 직후 (상승 전환)' : '상승 모멘텀') : (prevHist >= 0 ? '데드크로스 직후 (하락 전환)' : '하락 모멘텀');
  const bbLabel = pctB >= 1 ? '상단 돌파 (과열)' : pctB <= 0 ? '하단 이탈 (과매도)' : pctB >= 0.8 ? '상단권' : pctB <= 0.2 ? '하단권' : '밴드 중간';
  const buyBias = (rsi <= 40 ? 1 : rsi >= 60 ? -1 : 0) + (hist > 0 ? -0.5 : 0.5) + (pctB <= 0.2 ? 1 : pctB >= 0.8 ? -1 : 0);
  const summary = buyBias >= 1.5 ? '기술적으로 매수 우호 (과매도·하단권)' : buyBias <= -1.5 ? '기술적으로 과열 — 추격 매수 자제' : '기술적 신호 혼재 — 박스권·수급 판단 우선';
  return { rsi14: r(rsi), rsi_label: rsiLabel, macd: r(macd, 2), macd_signal: r(signal, 2), macd_hist: r(hist, 2), macd_label: macdLabel, bb_upper: r(upper), bb_lower: r(lower), bb_pct_b: r(pctB, 2), bb_label: bbLabel, atr14: r(atr), atr14_pct: r((atr / last) * 100, 2), summary };
}

export async function calculateBoxRange(
  contractMonth: string,
  currentPrice?: number,
  asOfDate?: string,
  mode: BoxRangeMode = '일반',
  /** 이미 조회한 (date ASC) 시세를 넘기면 DB 조회 생략 — 대시보드가 여러 월물을 쿼리 1개로 처리할 때 사용 */
  prefetched?: { date: string; settlement_usd: number }[],
): Promise<BoxRangeResult | null> {
  // Get all prices for this contract month, ordered by date
  const query = asOfDate
    ? `SELECT date, settlement_usd FROM fcpo_settlement
       WHERE contract_month = ? AND settlement_usd IS NOT NULL AND date <= ?
       ORDER BY date ASC`
    : `SELECT date, settlement_usd FROM fcpo_settlement
       WHERE contract_month = ? AND settlement_usd IS NOT NULL
       ORDER BY date ASC`;
  const params = asOfDate ? [contractMonth, asOfDate] : [contractMonth];
  const prices = prefetched
    ? prefetched.filter(p => !asOfDate || p.date <= asOfDate).map(p => ({ date: p.date, settlement_usd: Number(p.settlement_usd) }))
    : await dbAll(query, params) as { date: string; settlement_usd: number }[];

  if (prices.length < 10) return null;

  const allValues = prices.map(p => p.settlement_usd);
  const latest = currentPrice ?? allValues[allValues.length - 1];
  const latestDate = prices[prices.length - 1].date;

  // Calculate for 10, 20, 60 day periods
  const periods = [10, 20, 60].map(days => {
    const slice = allValues.slice(-Math.min(days, allValues.length));
    const high = Math.max(...slice);
    const low = Math.min(...slice);
    const avg = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((sum, v) => sum + (v - avg) ** 2, 0) / (slice.length - 1);
    const stdev = Math.sqrt(variance);
    const range = high - low;
    const volatility = (range / avg) * 100;
    return { days, high, low, average: Math.round(avg * 100) / 100, stdev: Math.round(stdev * 100) / 100, range, volatility_pct: Math.round(volatility * 100) / 100 };
  });

  const p20 = periods.find(p => p.days === 20)!;
  const p10 = periods.find(p => p.days === 10)!;
  const p60 = periods.find(p => p.days === 60)!;

  // Risk premium (전쟁이슈 모드일 때만 적용)
  // Excel V3 B26: =IF(B25="전쟁이슈",ROUND(IF(E17<5,0,IF(E17<10,E16*0.1,IF(E17<15,E16*0.25,E16*0.5))),0),0)
  // E17 = 20일 변동률(%), E16 = 20일 변동폭(USD)
  let risk_premium = 0;
  if (mode === '전쟁이슈') {
    const vol = p20.volatility_pct;
    const range = p20.range;
    if (vol < 5) risk_premium = 0;
    else if (vol < 10) risk_premium = Math.round(range * 0.1);
    else if (vol < 15) risk_premium = Math.round(range * 0.25);
    else risk_premium = Math.round(range * 0.5);
  }

  // Box range boundaries
  // 일반 모드 (Excel V3 일반): MA20 ± STDEV 기반
  // 전쟁이슈 모드 (Excel V3 전쟁이슈): 현재가 ± σ×배수 + 프리미엄
  let full_buy_upper: number, active_buy_upper: number, monitoring_upper: number, min_buy_upper: number;
  if (mode === '전쟁이슈') {
    full_buy_upper   = Math.round(latest - p20.stdev * 3   + risk_premium);
    active_buy_upper = Math.round(latest - p20.stdev * 1.5 + risk_premium);
    monitoring_upper = Math.round(latest + p20.stdev * 1.5 + risk_premium);
    min_buy_upper    = Math.round(latest + p20.stdev * 3   + risk_premium);
  } else {
    full_buy_upper   = Math.round(p20.average - p20.stdev);
    active_buy_upper = Math.round(p20.average - p20.stdev * 0.5);
    monitoring_upper = Math.round(p20.average + p20.stdev * 0.5);
    min_buy_upper    = p20.high;
  }

  // Determine current zone
  let current_zone: BoxRangeResult['current_zone'];
  let zone_range: string;
  if (latest <= full_buy_upper) {
    current_zone = '전량구매';
    zone_range = `${p20.low.toLocaleString()} ~ ${full_buy_upper.toLocaleString()}`;
  } else if (latest <= active_buy_upper) {
    current_zone = '적극구매';
    zone_range = `${full_buy_upper + 1} ~ ${active_buy_upper.toLocaleString()}`;
  } else if (latest <= monitoring_upper) {
    current_zone = '모니터링';
    zone_range = `${active_buy_upper + 1} ~ ${monitoring_upper.toLocaleString()}`;
  } else if (latest <= min_buy_upper) {
    current_zone = '최소구매';
    zone_range = `${monitoring_upper + 1} ~ ${min_buy_upper.toLocaleString()}`;
  } else {
    current_zone = '구매대기';
    zone_range = `${min_buy_upper.toLocaleString()} 초과`;
  }

  // Moving averages
  const ma10 = p10.average;
  const ma20 = p20.average;
  const ma60 = p60.average;

  const makeSignal = (ma: number) => latest < ma ? '▼ 이평선 하회 (매수신호)' : '▲ 이평선 상회';

  // Trend signals
  const golden_cross_10_20 = ma10 > ma20;
  const golden_cross_20_60 = ma20 > ma60;
  const dead_cross_10_20 = ma10 < ma20;
  const dead_cross_20_60 = ma20 < ma60;

  let short_term = latest < ma10 ? '▼ 단기 하락' : '▲ 단기 상승';
  let mid_term = latest < ma20 ? '▼ 중기 하락' : '▲ 중기 상승';
  let long_term = latest < ma60 ? '▼ 장기 하락' : '▲ 장기 상승';

  // Volatility classification (20-day)
  const vol = p20.volatility_pct;
  let classification: string, market_status: string, strategy: string;
  if (vol < 2) { classification = '매우 낮음'; market_status = '극도로 안정'; strategy = '정상 구매'; }
  else if (vol < 3) { classification = '낮음'; market_status = '안정기'; strategy = '정상 구매'; }
  else if (vol < 5) { classification = '보통'; market_status = '일반적'; strategy = '분할 매수'; }
  else if (vol < 7) { classification = '높음'; market_status = '주의 필요'; strategy = '분할 매수'; }
  else if (vol < 10) { classification = '매우 높음'; market_status = '급변기'; strategy = '소량 분할'; }
  else { classification = '극단적'; market_status = '위기 상황'; strategy = '구매 보류'; }

  // Confidence
  const allBelow = latest < ma10 && latest < ma20 && latest < ma60;
  const inBuyZone = current_zone === '전량구매' || current_zone === '적극구매';
  let confidence: string;
  if (allBelow && inBuyZone) confidence = '●●●● 높음';
  else if (inBuyZone) confidence = '●●●○ 중상';
  else if (current_zone === '모니터링') confidence = '●●○○ 보통';
  else confidence = '●○○○ 낮음';

  // Recommendation text
  const recMap: Record<string, string> = {
    '전량구매': '물량 100% 확보 추천',
    '적극구매': '물량 70~80% 확보 추천',
    '모니터링': '물량 30~50% 분할매수',
    '최소구매': '필수물량만 구매 or 대기',
    '구매대기': '구매 보류, 가격 하락 대기',
  };

  return {
    contract_month: contractMonth,
    current_price: latest,
    as_of_date: latestDate,
    mode,
    risk_premium,
    periods,
    zones: { full_buy_upper, active_buy_upper, monitoring_upper, min_buy_upper },
    current_zone,
    zone_range,
    recommendation: recMap[current_zone],
    ma_positions: {
      ma10, ma20, ma60,
      vs_ma10: Math.round((latest - ma10) * 100) / 100,
      vs_ma20: Math.round((latest - ma20) * 100) / 100,
      vs_ma60: Math.round((latest - ma60) * 100) / 100,
      ma10_signal: makeSignal(ma10),
      ma20_signal: makeSignal(ma20),
      ma60_signal: makeSignal(ma60),
    },
    trends: { short_term, mid_term, long_term, golden_cross_10_20, golden_cross_20_60, dead_cross_10_20, dead_cross_20_60 },
    volatility: { pct_20d: vol, classification, market_status, strategy },
    confidence,
    indicators: computeIndicators(allValues),
  };
}
