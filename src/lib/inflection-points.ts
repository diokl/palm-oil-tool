import { dbAll, dbGet, dbRun } from './db';
import type { InflectionPoint, InflectionSentiment } from './types';

// 전일대비 등락률에 따른 시황 자동분류.
// 엑셀 RAW!AU111 수식 (4 단계):
//   ≥  +1.0%        → '강세'
//   -1.0% ~ +1.0%   → '보합'
//   -1.0% ~ -2.5%   → '약세'
//   ≤  -2.5%        → '급락'
export function classifySentiment(changePct: number | null | undefined): InflectionSentiment | null {
  if (changePct == null || Number.isNaN(changePct)) return null;
  if (changePct >= 1.0) return '강세';
  if (changePct <= -2.5) return '급락';
  if (changePct <= -1.0) return '약세';
  return '보합';
}

// 해당 (date, contract_month)의 전일 종가를 fcpo_settlement에서 조회.
// '전일'은 동일 contract_month의 date < target 조건 중 가장 최근 거래일.
export async function getPreviousPrice(
  date: string,
  contractMonth: string,
): Promise<{ date: string; settlement_usd: number; settlement_myr: number | null } | null> {
  const row = await dbGet(
    `SELECT date, settlement_usd, settlement_myr
     FROM fcpo_settlement
     WHERE contract_month = ?
       AND date < ?
       AND settlement_usd IS NOT NULL
     ORDER BY date DESC
     LIMIT 1`,
    [contractMonth, date],
  ) as { date: string; settlement_usd: number; settlement_myr: number | null } | undefined;
  return row ?? null;
}

// 해당일의 종가도 자동 조회 (price_usd가 명시되지 않은 경우 사용).
export async function getPriceOnDate(
  date: string,
  contractMonth: string,
): Promise<{ settlement_usd: number; settlement_myr: number | null } | null> {
  const row = await dbGet(
    `SELECT settlement_usd, settlement_myr
     FROM fcpo_settlement
     WHERE date = ? AND contract_month = ?
     LIMIT 1`,
    [date, contractMonth],
  ) as { settlement_usd: number; settlement_myr: number | null } | undefined;
  return row ?? null;
}

export interface InflectionAutoFields {
  prev_price_usd: number | null;
  change_pct: number | null;
  sentiment: InflectionSentiment | null;
  bmd_change: string | null; // MYR 차이 (예: '+85')
}

// price_usd와 (date, contract_month)만 주면 prev/change/sentiment/bmd를 자동 산출.
// price_usd가 null이면 settlement에서 자동 조회 시도.
export async function deriveInflectionFields(args: {
  date: string;
  contract_month: string;
  price_usd?: number | null;
}): Promise<{ price_usd: number | null; auto: InflectionAutoFields }> {
  let price = args.price_usd ?? null;
  let priceMyr: number | null = null;

  if (price == null) {
    const today = await getPriceOnDate(args.date, args.contract_month);
    if (today) {
      price = today.settlement_usd;
      priceMyr = today.settlement_myr;
    }
  } else {
    // price는 주어졌어도 BMD 변동 계산을 위해 MYR도 조회 시도
    const today = await getPriceOnDate(args.date, args.contract_month);
    priceMyr = today?.settlement_myr ?? null;
  }

  const prev = await getPreviousPrice(args.date, args.contract_month);

  let change_pct: number | null = null;
  let bmd_change: string | null = null;
  if (price != null && prev) {
    change_pct = ((price - prev.settlement_usd) / prev.settlement_usd) * 100;
    if (priceMyr != null && prev.settlement_myr != null) {
      const myrDiff = priceMyr - prev.settlement_myr;
      const sign = myrDiff >= 0 ? '+' : '';
      bmd_change = `${sign}${Math.round(myrDiff)}`;
    }
  }

  return {
    price_usd: price,
    auto: {
      prev_price_usd: prev?.settlement_usd ?? null,
      change_pct,
      sentiment: classifySentiment(change_pct),
      bmd_change,
    },
  };
}

// 변곡점 등록/갱신.
// sentiment를 사용자가 명시했으면 그대로 저장(is_manual_sentiment=1), 아니면 자동 산출.
export async function upsertInflectionPoint(input: InflectionPoint): Promise<void> {
  const { price_usd: derivedPrice, auto } = await deriveInflectionFields({
    date: input.date,
    contract_month: input.contract_month,
    price_usd: input.price_usd,
  });
  const finalPrice = input.price_usd ?? derivedPrice;
  if (finalPrice == null) {
    throw new Error(`price_usd 미지정 + ${input.date} (${input.contract_month}) 자동 조회 실패`);
  }
  const isManual = input.sentiment != null ? 1 : 0;
  const finalSentiment = input.sentiment ?? auto.sentiment;

  await dbRun(
    `INSERT INTO inflection_points
       (date, contract_month, price_usd, prev_price_usd, change_pct, bmd_change,
        news_summary, sentiment, note, is_manual_sentiment, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (date, contract_month) DO UPDATE SET
       price_usd            = EXCLUDED.price_usd,
       prev_price_usd       = EXCLUDED.prev_price_usd,
       change_pct           = EXCLUDED.change_pct,
       bmd_change           = COALESCE(EXCLUDED.bmd_change, inflection_points.bmd_change),
       news_summary         = COALESCE(EXCLUDED.news_summary, inflection_points.news_summary),
       sentiment            = EXCLUDED.sentiment,
       note                 = COALESCE(EXCLUDED.note, inflection_points.note),
       is_manual_sentiment  = EXCLUDED.is_manual_sentiment`,
    [
      input.date,
      input.contract_month,
      finalPrice,
      input.prev_price_usd ?? auto.prev_price_usd,
      input.change_pct ?? auto.change_pct,
      input.bmd_change ?? auto.bmd_change,
      input.news_summary ?? null,
      finalSentiment,
      input.note ?? null,
      isManual,
      input.created_by ?? 'user',
    ],
  );
}

// 자동 분류된 변곡점 sentiment를 재계산해서 갱신.
// 가격 데이터가 늦게 들어와 자동 분류가 비어있는 행이 있을 때 호출.
export async function refreshSentimentForMonth(contractMonth: string): Promise<number> {
  const rows = await dbAll(
    `SELECT id, date, price_usd
     FROM inflection_points
     WHERE contract_month = ? AND is_manual_sentiment = 0
     ORDER BY date ASC`,
    [contractMonth],
  ) as { id: number; date: string; price_usd: number }[];

  let updated = 0;
  for (const r of rows) {
    const { auto } = await deriveInflectionFields({
      date: r.date,
      contract_month: contractMonth,
      price_usd: r.price_usd,
    });
    await dbRun(
      `UPDATE inflection_points
         SET prev_price_usd = ?, change_pct = ?, sentiment = ?,
             bmd_change = COALESCE(bmd_change, ?)
         WHERE id = ?`,
      [auto.prev_price_usd, auto.change_pct, auto.sentiment, auto.bmd_change, r.id],
    );
    updated++;
  }
  return updated;
}

export async function listInflectionPoints(
  contractMonth?: string,
  limit = 100,
): Promise<InflectionPoint[]> {
  const params: any[] = [];
  let where = '';
  if (contractMonth) {
    where = 'WHERE contract_month = ?';
    params.push(contractMonth);
  }
  params.push(limit);
  return await dbAll(
    `SELECT * FROM inflection_points ${where} ORDER BY date DESC LIMIT ?`,
    params,
  ) as InflectionPoint[];
}
