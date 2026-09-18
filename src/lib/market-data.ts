import { dbAll, dbBatchRun } from './db';
import { toUsdMt } from './oil-spread';

// ── 매크로·에너지·환율 자동 수집 ──
//
// 소스 (무료, 키 불필요):
//   환율   frankfurter.dev (ECB 고시, 일별 이력) → USDMYR / USDKRW / USDCNY, 실패 시 open.er-api.com 최신값
//   원유   Yahoo Finance chart API  BZ=F (Brent, USD/bbl) / HO=F (Heating Oil, USD/gal — 경유·가스오일 대용)
//   대두유 Yahoo Finance chart API  ZL=F (CBOT Soybean Oil, cents/lb) → 기존 oil_prices(SBO) 에 저장 (수동값 우선)
//
// 저장: market_data(series, date, value). 매일 cron(/api/cron/market-data) + 수동(/api/market-data POST).
// 파생: POGO 스프레드 = 팜유(USD/MT) − 원유/경유(USD/MT 환산). 바이오디젤 수요 전환의 핵심 지표.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36';

export const SERIES_META: Record<string, { label: string; unit: string; digits: number }> = {
  USDMYR: { label: 'USD/MYR', unit: 'MYR', digits: 4 },
  USDKRW: { label: 'USD/KRW', unit: 'KRW', digits: 1 },
  USDCNY: { label: 'USD/CNY', unit: 'CNY', digits: 4 },
  BRENT:  { label: 'Brent 원유', unit: 'USD/bbl', digits: 2 },
  HEATING_OIL: { label: 'Heating Oil (경유 대용)', unit: 'USD/gal', digits: 3 },
  DCE_PALM: { label: '대련 팜올레인 (주력)', unit: 'CNY/t', digits: 0 },
  DCE_SBO:  { label: '대련 대두유 (주력)', unit: 'CNY/t', digits: 0 },
};

// 단위 환산 (POGO 용)
export const BBL_PER_MT_CRUDE = 7.33;      // 원유 1 MT ≈ 7.33 bbl
export const GAL_PER_MT_DIESEL = 315;      // 경유 1 MT ≈ 315 gal (7.5 bbl × 42)

export interface SyncItem { series: string; count: number; source: string; error?: string; latest?: string }
export interface MarketSyncResult { items: SyncItem[]; message: string }

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

async function upsertSeries(series: string, points: { date: string; value: number }[], source: string): Promise<number> {
  if (points.length === 0) return 0;
  const ops = points.map(p => ({
    sql: `INSERT INTO market_data (series, date, value, source, updated_at) VALUES (?, ?, ?, ?, NOW())
          ON CONFLICT (series, date) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source, updated_at = NOW()`,
    params: [series, p.date, p.value, source],
  }));
  await dbBatchRun(ops);
  return points.length;
}

// ── 환율 ──
async function collectFx(days: number): Promise<SyncItem[]> {
  const symbols = ['MYR', 'KRW', 'CNY'];
  try {
    const from = isoDaysAgo(days);
    const to = new Date().toISOString().slice(0, 10);
    const res = await fetch(`https://api.frankfurter.dev/v1/${from}..${to}?base=USD&symbols=${symbols.join(',')}`, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`frankfurter ${res.status}`);
    const j = await res.json() as { rates: Record<string, Record<string, number>> };
    const out: SyncItem[] = [];
    for (const s of symbols) {
      const pts = Object.entries(j.rates || {}).filter(([, r]) => r[s] != null).map(([d, r]) => ({ date: d, value: r[s] }));
      const n = await upsertSeries(`USD${s}`, pts, 'frankfurter');
      out.push({ series: `USD${s}`, count: n, source: 'frankfurter', latest: pts.length ? pts[pts.length - 1].date : undefined });
    }
    return out;
  } catch (e: any) {
    // 폴백: 최신값만
    try {
      const res = await fetch('https://open.er-api.com/v6/latest/USD', { headers: { 'User-Agent': UA } });
      const j = await res.json() as { rates: Record<string, number>; time_last_update_unix: number };
      const date = new Date((j.time_last_update_unix || Date.now() / 1000) * 1000).toISOString().slice(0, 10);
      const out: SyncItem[] = [];
      for (const s of symbols) {
        if (j.rates?.[s] == null) continue;
        await upsertSeries(`USD${s}`, [{ date, value: j.rates[s] }], 'er-api');
        out.push({ series: `USD${s}`, count: 1, source: 'er-api', latest: date });
      }
      return out;
    } catch (e2: any) {
      return symbols.map(s => ({ series: `USD${s}`, count: 0, source: 'none', error: `${e.message}; ${e2.message}` }));
    }
  }
}

// ── Yahoo Finance chart ──
async function yahooDaily(symbol: string, days: number): Promise<{ date: string; value: number }[]> {
  const range = days <= 31 ? '1mo' : days <= 93 ? '3mo' : days <= 186 ? '6mo' : days <= 366 ? '1y' : days <= 731 ? '2y' : '5y';
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=1d`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`yahoo ${symbol} ${res.status}`);
  const j = await res.json() as any;
  const r = j?.chart?.result?.[0];
  if (!r) throw new Error(`yahoo ${symbol}: ${j?.chart?.error?.description || 'no result'}`);
  const ts: number[] = r.timestamp || [];
  const close: (number | null)[] = r.indicators?.quote?.[0]?.close || [];
  const out: { date: string; value: number }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < ts.length; i++) {
    const v = close[i];
    if (v == null || !isFinite(v)) continue;
    const date = new Date(ts[i] * 1000).toISOString().slice(0, 10);
    if (seen.has(date)) continue;
    seen.add(date);
    out.push({ date, value: Math.round(v * 10000) / 10000 });
  }
  return out;
}

async function collectYahooSeries(symbol: string, series: string, days: number): Promise<SyncItem> {
  try {
    const pts = await yahooDaily(symbol, days);
    const n = await upsertSeries(series, pts, 'yahoo');
    return { series, count: n, source: 'yahoo', latest: pts.length ? pts[pts.length - 1].date : undefined };
  } catch (e: any) {
    return { series, count: 0, source: 'yahoo', error: e.message };
  }
}

// 대두유 → oil_prices (SBO). 수동/KoreaPDS 입력값은 덮어쓰지 않음 (yahoo_auto 만 갱신)
async function collectSoybeanOil(days: number): Promise<SyncItem> {
  try {
    const pts = await yahooDaily('ZL=F', days);
    if (pts.length === 0) return { series: 'SBO', count: 0, source: 'yahoo' };
    const ops = pts.map(p => ({
      sql: `INSERT INTO oil_prices (date, commodity, price_native, unit_native, price_usd_mt, source)
            VALUES (?, 'SBO', ?, 'cents/lb', ?, 'yahoo_auto')
            ON CONFLICT (date, commodity) DO UPDATE SET
              price_native = EXCLUDED.price_native, unit_native = EXCLUDED.unit_native, price_usd_mt = EXCLUDED.price_usd_mt
            WHERE oil_prices.source = 'yahoo_auto'`,
      params: [p.date, p.value, Math.round(toUsdMt(p.value, 'cents/lb') * 100) / 100],
    }));
    await dbBatchRun(ops);
    return { series: 'SBO', count: pts.length, source: 'yahoo', latest: pts[pts.length - 1].date };
  } catch (e: any) {
    return { series: 'SBO', count: 0, source: 'yahoo', error: e.message };
  }
}

// ── 대련상품거래소(DCE) 선물 — Sina Finance 일봉 (P0 = 팜올레인 주력연속, Y0 = 대두유 주력연속, CNY/t) ──
// DCE 공식 사이트는 봇 차단이라 Sina 의 공개 K라인 API 사용. 전체 이력이 오므로 days 만큼만 저장.
async function collectSina(symbol: string, series: string, days: number): Promise<SyncItem> {
  try {
    const res = await fetch(`https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20_x=/InnerFuturesNewService.getDailyKLine?symbol=${symbol}`, { headers: { 'User-Agent': UA, Referer: 'https://finance.sina.com.cn' } });
    if (!res.ok) throw new Error(`sina ${symbol} ${res.status}`);
    const txt = await res.text();
    const m = txt.match(/\(\s*(\[[\s\S]*\])\s*\)/);
    if (!m) throw new Error(`sina ${symbol}: parse`);
    const arr = JSON.parse(m[1]) as { d: string; c: string }[];
    const from = isoDaysAgo(days);
    const pts = arr.filter(r => r.d >= from && Number(r.c) > 0).map(r => ({ date: r.d, value: Number(r.c) }));
    const n = await upsertSeries(series, pts, 'sina');
    return { series, count: n, source: 'sina', latest: pts.length ? pts[pts.length - 1].date : undefined };
  } catch (e: any) {
    return { series, count: 0, source: 'sina', error: e.message };
  }
}

export async function runMarketDataSync(days = 14): Promise<MarketSyncResult> {
  const [fx, brent, ho, sbo, dceP, dceY] = await Promise.all([
    collectFx(days),
    collectYahooSeries('BZ=F', 'BRENT', days),
    collectYahooSeries('HO=F', 'HEATING_OIL', days),
    collectSoybeanOil(days),
    collectSina('P0', 'DCE_PALM', days),
    collectSina('Y0', 'DCE_SBO', days),
  ]);
  const items = [...fx, brent, ho, sbo, dceP, dceY];
  const ok = items.filter(i => !i.error);
  const bad = items.filter(i => i.error);
  return {
    items,
    message: `매크로 수집 완료: ${ok.map(i => `${i.series} ${i.count}`).join(', ')}${bad.length ? ` / 실패: ${bad.map(i => `${i.series}(${i.error})`).join(', ')}` : ''}`,
  };
}

// ── 조회 ──
export interface SeriesLatest { series: string; label: string; unit: string; date: string | null; value: number | null; prev: number | null; change_pct: number | null }
export interface MacroSnapshot {
  latest: SeriesLatest[];
  palm: { date: string | null; usd_mt: number | null };
  pogo: { brent_usd_mt: number | null; ho_usd_mt: number | null; vs_brent: number | null; vs_ho: number | null };
  // 중국(대련) — CNY/t 를 USD/MT 로 환산(USD/CNY). 대련 가격은 증치세(9%) 포함 국내가라 FCPO 대비 스프레드가 수입 채산성의 대용
  dce: { date: string | null; palm_cny: number | null; palm_usd: number | null; sbo_cny: number | null; sbo_usd: number | null; palm_vs_fcpo: number | null; sbo_minus_palm_cny: number | null; usdcny: number | null };
  series: { date: string; palm: number | null; brent_mt: number | null; ho_mt: number | null; pogo_brent: number | null; usdkrw: number | null; usdmyr: number | null; dce_palm_usd: number | null; dce_sbo_usd: number | null }[];
  last_synced_at: string | null;
}

export async function getMacroSnapshot(days = 180): Promise<MacroSnapshot> {
  const from = isoDaysAgo(days);
  const rows = await dbAll(
    `SELECT series, date, value FROM market_data WHERE date >= ? ORDER BY series, date`,
    [from],
  ) as { series: string; date: string; value: number }[];
  const bySeries = new Map<string, { date: string; value: number }[]>();
  for (const r of rows) {
    const l = bySeries.get(r.series) ?? []; l.push({ date: r.date, value: Number(r.value) }); bySeries.set(r.series, l);
  }
  const latest: SeriesLatest[] = Object.entries(SERIES_META).map(([s, meta]) => {
    const l = bySeries.get(s) ?? [];
    const cur = l[l.length - 1] ?? null, prev = l[l.length - 2] ?? null;
    return {
      series: s, label: meta.label, unit: meta.unit,
      date: cur?.date ?? null, value: cur?.value ?? null, prev: prev?.value ?? null,
      change_pct: cur && prev && prev.value ? Math.round(((cur.value - prev.value) / prev.value) * 1000) / 10 : null,
    };
  });

  // 팜유 최근월 USD/MT (as-of)
  const palmRows = await dbAll(
    `SELECT date::text AS date, MIN(contract_month) AS cm FROM fcpo_settlement
     WHERE settlement_usd > 100 AND date >= ? AND contract_month >= SUBSTRING(date::text, 1, 7) GROUP BY date ORDER BY date`,
    [from],
  ) as { date: string; cm: string }[];
  const palmPrice = new Map<string, number>();
  if (palmRows.length) {
    const pr = await dbAll(
      `SELECT date::text AS date, contract_month, settlement_usd FROM fcpo_settlement WHERE settlement_usd > 100 AND date >= ?`,
      [from],
    ) as { date: string; contract_month: string; settlement_usd: number }[];
    const want = new Map(palmRows.map(r => [String(r.date).slice(0, 10), r.cm]));
    for (const p of pr) { const d = String(p.date).slice(0, 10); if (want.get(d) === p.contract_month) palmPrice.set(d, Number(p.settlement_usd)); }
  }
  const palmDates = [...palmPrice.keys()].sort();
  const asOf = (map: Map<string, number>, keys: string[], d: string): number | null => { let c: string | null = null; for (const k of keys) { if (k <= d) c = k; else break; } return c ? map.get(c)! : null; };

  const brentMap = new Map((bySeries.get('BRENT') ?? []).map(p => [p.date, p.value]));
  const hoMap = new Map((bySeries.get('HEATING_OIL') ?? []).map(p => [p.date, p.value]));
  const krwMap = new Map((bySeries.get('USDKRW') ?? []).map(p => [p.date, p.value]));
  const myrMap = new Map((bySeries.get('USDMYR') ?? []).map(p => [p.date, p.value]));
  const brentDates = [...brentMap.keys()].sort(), hoDates = [...hoMap.keys()].sort(), krwDates = [...krwMap.keys()].sort(), myrDates = [...myrMap.keys()].sort();
  const cnyMap = new Map((bySeries.get('USDCNY') ?? []).map(p => [p.date, p.value]));
  const dcePMap = new Map((bySeries.get('DCE_PALM') ?? []).map(p => [p.date, p.value]));
  const dceYMap = new Map((bySeries.get('DCE_SBO') ?? []).map(p => [p.date, p.value]));
  const cnyDates = [...cnyMap.keys()].sort(), dcePDates = [...dcePMap.keys()].sort(), dceYDates = [...dceYMap.keys()].sort();
  const toUsd = (cny: number | null, d: string) => { const fx = asOf(cnyMap, cnyDates, d); return cny != null && fx ? Math.round((cny / fx) * 10) / 10 : null; };

  const allDates = [...new Set([...palmDates, ...brentDates, ...dcePDates])].sort();
  const series = allDates.map(d => {
    const palm = palmPrice.get(d) ?? null;
    const b = brentMap.get(d) ?? null;
    const h = asOf(hoMap, hoDates, d);
    const brentMt = b != null ? Math.round(b * BBL_PER_MT_CRUDE * 10) / 10 : null;
    const hoMt = h != null ? Math.round(h * GAL_PER_MT_DIESEL * 10) / 10 : null;
    const palmAsOf = palm ?? asOf(palmPrice, palmDates, d);
    return {
      date: d, palm, brent_mt: brentMt, ho_mt: hoMt,
      pogo_brent: palmAsOf != null && brentMt != null ? Math.round((palmAsOf - brentMt) * 10) / 10 : null,
      usdkrw: asOf(krwMap, krwDates, d), usdmyr: asOf(myrMap, myrDates, d),
      dce_palm_usd: toUsd(dcePMap.get(d) ?? null, d), dce_sbo_usd: toUsd(dceYMap.get(d) ?? null, d),
    };
  });

  const palmLatestDate = palmDates.length ? palmDates[palmDates.length - 1] : null;
  const palmLatest = palmLatestDate ? palmPrice.get(palmLatestDate)! : null;
  const bLatest = latest.find(l => l.series === 'BRENT')?.value ?? null;
  const hLatest = latest.find(l => l.series === 'HEATING_OIL')?.value ?? null;
  const brentMt = bLatest != null ? Math.round(bLatest * BBL_PER_MT_CRUDE * 10) / 10 : null;
  const hoMt = hLatest != null ? Math.round(hLatest * GAL_PER_MT_DIESEL * 10) / 10 : null;

  const syncRow = await dbAll(`SELECT MAX(updated_at) AS t FROM market_data`) as { t: string | null }[];

  const dceDate = dcePDates.length ? dcePDates[dcePDates.length - 1] : null;
  const dcePalmCny = dceDate ? dcePMap.get(dceDate)! : null;
  const dceSboCny = dceDate ? (dceYMap.get(dceDate) ?? asOf(dceYMap, dceYDates, dceDate)) : null;
  const dcePalmUsd = dceDate ? toUsd(dcePalmCny, dceDate) : null;
  const dceSboUsd = dceDate ? toUsd(dceSboCny, dceDate) : null;
  const palmForDce = dceDate ? asOf(palmPrice, palmDates, dceDate) : null;

  return {
    dce: {
      date: dceDate, palm_cny: dcePalmCny, palm_usd: dcePalmUsd, sbo_cny: dceSboCny, sbo_usd: dceSboUsd,
      palm_vs_fcpo: dcePalmUsd != null && palmForDce != null ? Math.round((dcePalmUsd - palmForDce) * 10) / 10 : null,
      sbo_minus_palm_cny: dceSboCny != null && dcePalmCny != null ? Math.round(dceSboCny - dcePalmCny) : null,
      usdcny: dceDate ? asOf(cnyMap, cnyDates, dceDate) : null,
    },
    latest,
    palm: { date: palmLatestDate, usd_mt: palmLatest },
    pogo: {
      brent_usd_mt: brentMt, ho_usd_mt: hoMt,
      vs_brent: palmLatest != null && brentMt != null ? Math.round((palmLatest - brentMt) * 10) / 10 : null,
      vs_ho: palmLatest != null && hoMt != null ? Math.round((palmLatest - hoMt) * 10) / 10 : null,
    },
    series,
    last_synced_at: syncRow[0]?.t ? String(syncRow[0].t) : null,
  };
}
