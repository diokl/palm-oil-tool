// USD/MYR 환율 — Yahoo Finance 비공식 차트 API(키 불필요, ToS 무관).
// FCPO settlement(MYR/MT)를 USD/MT로 환산할 때 사용.
//   USD/MT = MYR/MT ÷ (MYR per USD)
// 실패 시 폴백 상수를 써서 절대 throw 하지 않는다(스프레드가 끊기지 않도록).

const YF_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/MYR=X?interval=1d&range=6mo';
const FALLBACK_USDMYR = 4.4; // 최근 USD/MYR 근사치(폴백)
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h

export interface UsdMyrRates {
  byDate: Map<string, number>; // 'YYYY-MM-DD' → MYR per USD
  latest: number;
}

let cache: { at: number; data: UsdMyrRates } | null = null;

export async function getUsdMyrRates(): Promise<UsdMyrRates> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;

  const byDate = new Map<string, number>();
  let latest = FALLBACK_USDMYR;

  try {
    const res = await fetch(YF_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      // Yahoo는 가끔 느리다 — 너무 오래 막히면 폴백.
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const j: any = await res.json();
      const r = j?.chart?.result?.[0];
      const ts: number[] = r?.timestamp || [];
      const close: (number | null)[] = r?.indicators?.quote?.[0]?.close || [];
      for (let i = 0; i < ts.length; i++) {
        const c = close[i];
        if (c != null && c > 0) {
          const d = new Date(ts[i] * 1000).toISOString().slice(0, 10);
          byDate.set(d, c);
        }
      }
      if (r?.meta?.regularMarketPrice > 0) latest = r.meta.regularMarketPrice;
      else if (byDate.size > 0) latest = [...byDate.values()].slice(-1)[0];
    }
  } catch {
    // 네트워크/타임아웃 → 폴백 사용
  }

  const data: UsdMyrRates = { byDate, latest };
  cache = { at: Date.now(), data };
  return data;
}

// 특정 날짜의 환율(없으면 가장 가까운 이전 날짜, 그것도 없으면 latest).
export function rateForDate(rates: UsdMyrRates, date: string): number {
  if (rates.byDate.has(date)) return rates.byDate.get(date)!;
  let best: number | null = null;
  let bestDate = '';
  for (const [d, v] of rates.byDate) {
    if (d <= date && d > bestDate) { bestDate = d; best = v; }
  }
  return best ?? rates.latest ?? FALLBACK_USDMYR;
}
