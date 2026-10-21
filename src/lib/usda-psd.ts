import { dbAll, dbRun } from './db';
import { kstNow, toIso } from './kst';

// ── USDA FAS PSD (Production, Supply & Distribution) — 국가별 팜유·대두유 수급 ──
//
// API: https://api.fas.usda.gov  (Swagger: apps.fas.usda.gov/opendatawebV2)
//   키: api.data.gov 에서 발급 (opendatawebV2 의 'API Key Signup') → 환경변수 USDA_API_KEY
//   인증 헤더는 api.data.gov 표준 X-Api-Key. 구 호스트(apps.fas.usda.gov/OpenData, 헤더 API_KEY)도 폴백으로 시도.
//   GET /api/psd/commodity/{commodityCode}/country/{countryCode}/year/{marketYear}
//   → [{ commodityCode, countryCode, marketYear, calendarYear, month, attributeId, unitId, value }]
// 상품코드: 4243000 Oil, Palm / 4232000 Oil, Soybean
// 속성(attributeId): 20 Beginning Stocks, 28 Production, 57 Imports, 81 Total Supply, 88 Exports,
//                    125 Domestic Consumption, 176 Ending Stocks (단위 1000 MT)
// 저장: usda_psd(commodity, country, market_year, attribute, value, updated_at)
// 월 1회 갱신(USDA WASDE 발표 후) — MPOB cron 에 편승.

export const USDA_COMMODITIES: Record<string, string> = { PALM: '4243000', SOY_OIL: '4232000' };
export const USDA_COUNTRIES: Record<string, string> = { CH: '중국', IN: '인도', ID: '인도네시아', MY: '말레이시아', E4: 'EU', US: '미국', PK: '파키스탄', BD: '방글라데시' };
export const USDA_ATTRS: Record<number, string> = { 20: 'beginning_stocks', 28: 'production', 57: 'imports', 81: 'total_supply', 88: 'exports', 125: 'domestic_consumption', 176: 'ending_stocks' };

export interface UsdaSyncResult { count: number; years: number[]; errors: string[]; message: string }

export function usdaKeyConfigured(): boolean { return !!process.env.USDA_API_KEY; }

export async function runUsdaSync(opts: { years?: number[]; commodities?: string[]; countries?: string[] } = {}): Promise<UsdaSyncResult> {
  const key = process.env.USDA_API_KEY;
  if (!key) throw new Error('USDA_API_KEY 환경변수가 설정되지 않았습니다 (apps.fas.usda.gov/OpenData 에서 무료 발급)');
  const nowY = kstNow().year;
  const years = opts.years ?? [nowY - 3, nowY - 2, nowY - 1, nowY, nowY + 1];
  const commodities = opts.commodities ?? Object.keys(USDA_COMMODITIES);
  const countries = opts.countries ?? Object.keys(USDA_COUNTRIES);
  const errors: string[] = [];
  // (commodity, country, year, attribute) 기준 중복 제거 — 같은 키가 두 번이면 일괄 upsert 가 실패하므로 마지막 값만
  const out = new Map<string, { commodity: string; country: string; market_year: number; attribute: string; value: number }>();

  // 요청 목록을 만들어 8개씩 병렬로, 요청마다 15초 제한.
  // (이전: 80개 요청을 하나씩 순서대로 + 행마다 DB 왕복 저장 → MPOB 뒤에 붙은 크론에서 60초 안에 끝나지 못해 저장 0건)
  const jobs = commodities.flatMap(c => countries.flatMap(cc => years.map(y => ({ c, cc, y }))));
  const fetchOne = async ({ c, cc, y }: { c: string; cc: string; y: number }) => {
    try {
      const path = `/api/psd/commodity/${USDA_COMMODITIES[c]}/country/${cc}/year/${y}`;
      let res = await fetch(`https://api.fas.usda.gov${path}`, { headers: { 'X-Api-Key': key, API_KEY: key, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 401 || res.status === 403) {
        // 구 호스트 폴백
        res = await fetch(`https://apps.fas.usda.gov/OpenData${path}`, { headers: { API_KEY: key, Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
      }
      if (res.status === 404) return;
      if (!res.ok) throw new Error(`${res.status}`);
      const rows = await res.json() as { attributeId: number; value: number; marketYear: number }[];
      for (const r of rows) {
        const attr = USDA_ATTRS[r.attributeId];
        const value = Number(r.value);
        if (!attr || !Number.isFinite(value)) continue;
        const market_year = Number(r.marketYear) || y;
        out.set(`${c}|${cc}|${market_year}|${attr}`, { commodity: c, country: cc, market_year, attribute: attr, value });
      }
    } catch (e: any) {
      errors.push(`${c}/${cc}/${y}: ${e.name === 'TimeoutError' ? '시간 초과' : e.message}`);
    }
  };
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(fetchOne));

  const rows = [...out.values()];
  if (rows.length) {
    // 쿼리 1번 일괄 upsert (lib/mpob-sync 와 같은 방식, 파라미터는 ?::text::jsonb)
    await dbRun(
      `INSERT INTO usda_psd (commodity, country, market_year, attribute, value, updated_at)
       SELECT commodity, country, market_year, attribute, value, NOW()
       FROM jsonb_to_recordset(?::text::jsonb) AS t(commodity text, country text, market_year int, attribute text, value double precision)
       ON CONFLICT (commodity, country, market_year, attribute) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [JSON.stringify(rows)],
    );
  }
  return { count: rows.length, years, errors, message: `USDA PSD 동기화: ${rows.length}건 (${errors.length ? `오류 ${errors.length}` : '오류 없음'})` };
}

export interface UsdaRow { country: string; country_label: string; market_year: number; beginning_stocks: number | null; production: number | null; imports: number | null; exports: number | null; domestic_consumption: number | null; ending_stocks: number | null; stock_to_use: number | null; imports_yoy: number | null; consumption_yoy: number | null }
export interface UsdaTable { commodity: string; years: number[]; rows: UsdaRow[]; last_synced_at: string | null; key_configured: boolean }

export async function getUsdaTable(commodity = 'PALM'): Promise<UsdaTable> {
  const rows = await dbAll(
    `SELECT country, market_year, attribute, value, updated_at FROM usda_psd WHERE commodity = ? ORDER BY country, market_year`,
    [commodity],
  ) as { country: string; market_year: number; attribute: string; value: number; updated_at: string }[];
  const map = new Map<string, Record<string, number>>();
  let last: string | null = null;
  for (const r of rows) {
    const k = `${r.country}|${r.market_year}`;
    const o = map.get(k) ?? {}; o[r.attribute] = Number(r.value); map.set(k, o);
    // updated_at 은 Date 객체로 온다 — String(Date) 는 'Wed Oct 21 …' 이라 문자열 비교가 요일 순이 되므로 ISO 로 비교
    const u = toIso(r.updated_at);
    if (u && (!last || u > last)) last = u;
  }
  const years = [...new Set(rows.map(r => r.market_year))].sort();
  const out: UsdaRow[] = [];
  for (const [k, o] of map) {
    const [country, ys] = k.split('|'); const y = Number(ys);
    const prev = map.get(`${country}|${y - 1}`);
    const use = (o.domestic_consumption ?? 0) + (o.exports ?? 0);
    const yoy = (a?: number, b?: number) => a != null && b ? Math.round(((a - b) / b) * 1000) / 10 : null;
    out.push({
      country, country_label: USDA_COUNTRIES[country] ?? country, market_year: y,
      beginning_stocks: o.beginning_stocks ?? null, production: o.production ?? null, imports: o.imports ?? null, exports: o.exports ?? null,
      domestic_consumption: o.domestic_consumption ?? null, ending_stocks: o.ending_stocks ?? null,
      stock_to_use: o.ending_stocks != null && use > 0 ? Math.round((o.ending_stocks / use) * 1000) / 10 : null,
      imports_yoy: yoy(o.imports, prev?.imports), consumption_yoy: yoy(o.domestic_consumption, prev?.domestic_consumption),
    });
  }
  out.sort((a, b) => a.country.localeCompare(b.country) || a.market_year - b.market_year);
  return { commodity, years, rows: out, last_synced_at: last, key_configured: usdaKeyConfigured() };
}
