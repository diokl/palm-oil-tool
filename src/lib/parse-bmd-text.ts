// BMD 일일 시세 텍스트 파서.
//
// 입력 형식 (사용자가 거래일별로 붙여넣음):
//   5/20 (수)  오전: BMD +88 | Jun 1,207.50 / 4,628 / +88 | Jul 1,207.50 / 4,662 / +91 | Aug 1,207.50 / 4,673 / +88
//              오후: BMD -2  | Jun 1,190.00 / 4,515 / -25 | Jul 1,190.00 / 4,555 / -16 | Aug 1,190.00 / 4,583 / -2
//
// 출력 (fcpo_settlement 입력용):
//   { date, contract_month, settlement_usd, settlement_myr, exchange_rate, source, session }
//
// 정책:
//   - 같은 거래일에 오전+오후 모두 있으면 오후가 우선 (마감가)
//   - 오후 없으면 오전 사용 + source='manual_bmd_am'
//   - 연도 미명시 시 옵션 yearHint (기본: 시스템 현재 연도)
//   - 월물 약어(Jan~Dec) → 입력일 이후 가장 가까운 그 월

export type Session = 'am' | 'pm';

export interface BmdRecord {
  date: string;             // YYYY-MM-DD
  contract_month: string;   // YYYY-MM
  settlement_usd: number;
  settlement_myr: number;
  exchange_rate: number;    // myr/usd
  bmd_change_myr: number;   // 그 세션의 해당 월물 MYR 변동량 (informational)
  bmd_change_total: number; // 그 세션의 BMD 전체 변동 (예: +88, -2)
  session: Session;
  source: string;           // 'manual_bmd' (pm) | 'manual_bmd_am'
}

export interface BmdParseError { line: number; reason: string; raw: string; }

export interface BmdParseResult {
  records: BmdRecord[];
  errors: BmdParseError[];
  summary: { days: number; sessions: number };
}

const MONTH_ABBR: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
  Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};

const SESSION_AM_RE = /오전\s*:/;
const SESSION_PM_RE = /오후\s*:/;

// 한 줄의 'M/D (요일)' 또는 'YYYY-MM-DD' 추출.
// 'M/D' 인 경우 yearHint 사용. 'YYYY-MM-DD' 인 경우 그대로.
function parseDate(text: string, yearHint: number): string | null {
  // ISO 형식 우선
  const iso = text.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${iso[2].padStart(2, '0')}-${iso[3].padStart(2, '0')}`;
  }
  // M/D 형식
  const md = text.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (md) {
    return `${yearHint}-${md[1].padStart(2, '0')}-${md[2].padStart(2, '0')}`;
  }
  return null;
}

// "Jun" + 입력일(2026-05-20) → '2026-06' (5월 입력 시 6월은 같은 해).
//                              '2027-02' (5월 입력 시 Feb은 내년 2월).
function resolveContractMonth(abbr: string, inputDate: string): string | null {
  const m = MONTH_ABBR[abbr];
  if (!m) return null;
  const [yy, mm] = inputDate.split('-').map(Number);
  const cy = m >= mm ? yy : yy + 1;
  return `${cy}-${String(m).padStart(2, '0')}`;
}

// 세션 chunk 안에서 각 월물 entry 파싱:
//   "Jun 1,207.50 / 4,628 / +88"
const ENTRY_RE = /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+([\d,.]+)\s*\/\s*([\d,.]+)\s*\/\s*([+-]?\d+(?:\.\d+)?)/g;
const BMD_TOTAL_RE = /BMD\s*([+-]?\d+(?:\.\d+)?)/;

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}

// 메인 파서. 여러 줄/여러 거래일/오전·오후 혼합 텍스트 받음.
export function parseBmdText(text: string, opts: { yearHint?: number } = {}): BmdParseResult {
  const yearHint = opts.yearHint ?? new Date().getFullYear();
  const errors: BmdParseError[] = [];

  // 줄 단위 처리하되, '5/20' 또는 'YYYY-MM-DD'로 시작하는 새 거래일 시작 시 day buffer flush.
  // 한 거래일 안에서는 '오전:' / '오후:' 키워드로 세션 분할.
  type Day = { date: string; lineNo: number; am?: string; pm?: string };
  const days: Day[] = [];
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  let current: Day | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // 새 거래일 헤더?
    const date = parseDate(line, yearHint);
    if (date && /^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\s*\/\s*\d{1,2})/.test(line)) {
      // flush 이전 day
      if (current) days.push(current);
      current = { date, lineNo: i + 1 };
      // 같은 줄에 세션 데이터까지 있을 수 있음 (사용자 입력처럼 한 줄에 다 들어옴) → 같은 줄도 합쳐서 처리
      // 그래서 current의 am/pm을 line 전체로 채워둠
      current.am = line;
      current.pm = line;
      continue;
    }
    if (!current) {
      errors.push({ line: i + 1, reason: '날짜 없이 시작', raw: line });
      continue;
    }
    // 이전 거래일에 추가 줄 누적
    current.am = (current.am ?? '') + ' ' + line;
    current.pm = (current.pm ?? '') + ' ' + line;
  }
  if (current) days.push(current);

  const records: BmdRecord[] = [];
  let sessionCount = 0;
  for (const day of days) {
    const haystack = (day.am ?? '') + ' ' + (day.pm ?? '');
    // 오전/오후 chunk 분리: '오전:'과 '오후:' 위치 찾고 그 사이를 chunk로 떼냄.
    const amIdx = haystack.search(SESSION_AM_RE);
    const pmIdx = haystack.search(SESSION_PM_RE);
    const chunks: { session: Session; text: string }[] = [];
    if (amIdx >= 0) {
      const end = pmIdx > amIdx ? pmIdx : haystack.length;
      chunks.push({ session: 'am', text: haystack.slice(amIdx, end) });
    }
    if (pmIdx >= 0) {
      chunks.push({ session: 'pm', text: haystack.slice(pmIdx) });
    }
    if (chunks.length === 0) {
      errors.push({ line: day.lineNo, reason: '오전/오후 키워드 없음', raw: haystack.slice(0, 80) });
      continue;
    }

    // 우선순위: PM 우선 (마감가). PM 없으면 AM.
    const order: Session[] = ['pm', 'am'];
    const monthToChosen: Record<string, { session: Session; usd: number; myr: number; change: number }> = {};
    for (const sess of order) {
      const chunk = chunks.find(c => c.session === sess);
      if (!chunk) continue;
      sessionCount++;
      const totalMatch = chunk.text.match(BMD_TOTAL_RE);
      const total = totalMatch ? Number(totalMatch[1]) : 0;

      let m;
      ENTRY_RE.lastIndex = 0;
      while ((m = ENTRY_RE.exec(chunk.text)) !== null) {
        const abbr = m[1];
        const usd = num(m[2]);
        const myr = num(m[3]);
        const change = Number(m[4]);
        const cm = resolveContractMonth(abbr, day.date);
        if (!cm) {
          errors.push({ line: day.lineNo, reason: `월물 약어 인식 실패: ${abbr}`, raw: m[0] });
          continue;
        }
        // PM 이미 있으면 AM은 skip (PM 우선)
        if (sess === 'am' && monthToChosen[cm]) continue;
        monthToChosen[cm] = { session: sess, usd, myr, change };
        (monthToChosen[cm] as any).bmd_total = total;
      }
    }

    for (const [cm, v] of Object.entries(monthToChosen)) {
      records.push({
        date: day.date,
        contract_month: cm,
        settlement_usd: v.usd,
        settlement_myr: v.myr,
        exchange_rate: Math.round((v.myr / v.usd) * 10000) / 10000,
        bmd_change_myr: v.change,
        bmd_change_total: (v as any).bmd_total ?? 0,
        session: v.session,
        source: v.session === 'pm' ? 'manual_bmd' : 'manual_bmd_am',
      });
    }
  }

  return {
    records,
    errors,
    summary: { days: days.length, sessions: sessionCount },
  };
}
