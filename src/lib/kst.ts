// 한국 시간(Asia/Seoul, UTC+9, 서머타임 없음) 기준 날짜.
// 서버(Vercel)는 UTC 라 new Date().getMonth() 를 쓰면 매월 1일 00:00~08:59 KST 에 '지난달' 로 계산된다
// (재고 카드가 지난달 행을 고르고, 분석·노출 계산이 만료 월물부터 시작하는 문제).
export interface KstDate { year: number; month: number; day: number; ym: string; ymd: string }

export function kstNow(d: Date = new Date()): KstDate {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  const year = k.getUTCFullYear();
  const month = k.getUTCMonth() + 1;
  const day = k.getUTCDate();
  const ym = `${year}-${String(month).padStart(2, '0')}`;
  return { year, month, day, ym, ymd: `${ym}-${String(day).padStart(2, '0')}` };
}

/** 'YYYY-MM-DD' 형식이고 실제로 있는 날짜인지 */
export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** 타임스탬프(Date 객체 또는 문자열)를 한국 날짜 'YYYY-MM-DD' 로. 해석할 수 없으면 앞 10자 */
export function kstYmd(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : kstNow(d).ymd;
}

/** Postgres 가 Date 객체로 돌려준 값/문자열을 ISO 문자열로 (String(Date) 는 'Wed Oct 21 2026 …' 이 됨) */
export function toIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  return String(v);
}
