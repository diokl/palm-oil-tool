import { NextRequest, NextResponse } from 'next/server';
import { dbAll, dbRun, dbBatchRun } from '@/lib/db';
import { suggestMarketPrices, type MarketPriceSuggestion } from '@/lib/market-price-match';

// 구매 시황가 자동 매칭
//
// GET  /api/purchases/market-match
//   → 구매이력의 모든 선적월에 대해 FCPO DB 기반 시황가 제안 + 현재 입력 상태
// POST /api/purchases/market-match
//   body: { mode: 'fill' | 'overwrite', months?: string[], include_forward?: boolean }
//   fill      = market_price_usd 가 비어있는 건만 채움
//   overwrite = 수동 입력('manual')을 제외한 모든 건 덮어씀 (force: true 면 수동 입력도 덮어씀)
//   include_forward = 선적월 미도래(선물 전망치)도 반영할지 (기본 false)

export const dynamic = 'force-dynamic';

let columnEnsured = false;
async function ensureSourceColumn() {
  if (columnEnsured) return;
  try { await dbRun(`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS market_price_source TEXT`); } catch { /* noop */ }
  columnEnsured = true;
}

interface MonthState {
  shipment_month: string;
  purchases: number;
  filled: number;
  manual: number;
  current_prices: number[];   // 현재 입력된 시황가(중복 제거)
}

async function loadMonthStates(): Promise<MonthState[]> {
  const rows = await dbAll(
    `SELECT shipment_month, market_price_usd, market_price_source
     FROM purchases
     WHERE shipment_month ~ '^[0-9]{4}-[0-9]{2}$'
     ORDER BY shipment_month`,
  ) as { shipment_month: string; market_price_usd: number | null; market_price_source: string | null }[];

  const map = new Map<string, MonthState>();
  for (const r of rows) {
    const s = map.get(r.shipment_month) ?? { shipment_month: r.shipment_month, purchases: 0, filled: 0, manual: 0, current_prices: [] };
    s.purchases++;
    if (r.market_price_usd != null) {
      s.filled++;
      const v = Number(r.market_price_usd);
      if (!s.current_prices.includes(v)) s.current_prices.push(v);
    }
    if (r.market_price_source === 'manual') s.manual++;
    map.set(r.shipment_month, s);
  }
  return [...map.values()];
}

export async function GET() {
  try {
    await ensureSourceColumn();
    const states = await loadMonthStates();
    const suggestions = await suggestMarketPrices(states.map(s => s.shipment_month));
    const byMonth = new Map(suggestions.map(s => [s.shipment_month, s]));
    const data = states.map(s => ({ ...s, suggestion: byMonth.get(s.shipment_month) ?? null }));
    return NextResponse.json({ data });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await ensureSourceColumn();
    const body = await request.json().catch(() => ({}));
    const mode: 'fill' | 'overwrite' = body.mode === 'overwrite' ? 'overwrite' : 'fill';
    const force = body.force === true;
    const includeForward = body.include_forward === true;
    const onlyMonths: string[] | null = Array.isArray(body.months) && body.months.length ? body.months : null;

    const states = await loadMonthStates();
    const target = onlyMonths ? states.filter(s => onlyMonths.includes(s.shipment_month)) : states;
    const suggestions = await suggestMarketPrices(target.map(s => s.shipment_month));

    const ops: { sql: string; params: any[] }[] = [];
    const applied: { shipment_month: string; market_price: number; basis: MarketPriceSuggestion['basis'] }[] = [];
    const skipped: { shipment_month: string; reason: string }[] = [];

    for (const s of suggestions) {
      if (s.market_price == null || s.basis === 'none') { skipped.push({ shipment_month: s.shipment_month, reason: '시세 없음' }); continue; }
      if (s.basis === 'forward' && !includeForward) { skipped.push({ shipment_month: s.shipment_month, reason: '선적월 미도래(전망치)' }); continue; }
      const source = s.basis === 'forward' ? 'fcpo_forward' : 'fcpo_auto';

      if (mode === 'fill') {
        ops.push({
          sql: `UPDATE purchases SET market_price_usd = ?, market_price_source = ?
                WHERE shipment_month = ? AND market_price_usd IS NULL`,
          params: [s.market_price, source, s.shipment_month],
        });
      } else if (force) {
        ops.push({
          sql: `UPDATE purchases SET market_price_usd = ?, market_price_source = ? WHERE shipment_month = ?`,
          params: [s.market_price, source, s.shipment_month],
        });
      } else {
        ops.push({
          sql: `UPDATE purchases SET market_price_usd = ?, market_price_source = ?
                WHERE shipment_month = ? AND (market_price_source IS DISTINCT FROM 'manual')`,
          params: [s.market_price, source, s.shipment_month],
        });
      }
      applied.push({ shipment_month: s.shipment_month, market_price: s.market_price, basis: s.basis });
    }

    if (ops.length) await dbBatchRun(ops);

    return NextResponse.json({
      success: true,
      mode,
      applied_months: applied.length,
      applied,
      skipped,
      message: `${applied.length}개 선적월 시황가 ${mode === 'fill' ? '채움' : '갱신'} (${skipped.length}개 건너뜀)`,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
