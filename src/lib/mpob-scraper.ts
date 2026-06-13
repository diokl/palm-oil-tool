// MPOB BEPI scraper — logs into bepi.mpob.gov.my (Joomla) and parses the
// monthly statistical reports (stock / production / export-by-port /
// export-by-product) into mpob_data records.
//
// The data tables live inside an <iframe src=".../stat/web_report1.php?val=NNNN">
// on each article page. We fetch the article page, extract the iframe `val`,
// then fetch and parse the report HTML.
//
// Credentials come from env: MPOB_USERNAME / MPOB_PASSWORD.

const MPOB_BASE = 'https://bepi.mpob.gov.my';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

export interface MpobScrapedRecord {
  category: string;
  item_name: string;
  year: number;
  month: number; // 1-12
  value: number | null;
  value_rm?: number | null;
  parent_group?: string | null;
  sort_order: number;
}

// Article pages (year-specific). The iframe `val` is extracted live from each
// page so monthly renumbering on MPOB's side does not break the scraper.
const REPORT_PAGES: { category: string; url: string }[] = [
  {
    category: 'stock',
    url: `${MPOB_BASE}/index.php/stock/336-stocks-2026/1234-stock-of-selected-processed-palm-oil-at-refinery-2026`,
  },
  {
    category: 'production',
    url: `${MPOB_BASE}/index.php/production/335-production-2026/1229-production-of-selected-processed-palm-oil-2026`,
  },
  {
    category: 'export_port',
    url: `${MPOB_BASE}/index.php/export/338-export-2026/1240-palm-oil-export-by-major-ports-2026`,
  },
  {
    category: 'export_product',
    url: `${MPOB_BASE}/index.php/export/338-export-2026/1239-monthly-export-of-oil-palm-products-2026`,
  },
];

// ---------- tiny cookie jar ----------
class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    // Node 18+/undici exposes getSetCookie(); fall back to single header.
    const anyHeaders = res.headers as any;
    const setCookies: string[] =
      typeof anyHeaders.getSetCookie === 'function'
        ? anyHeaders.getSetCookie()
        : (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
    for (const sc of setCookies) {
      const pair = sc.split(';')[0];
      const eq = pair.indexOf('=');
      if (eq > 0) {
        const name = pair.slice(0, eq).trim();
        const val = pair.slice(eq + 1).trim();
        if (name) this.jar.set(name, val);
      }
    }
  }
  header(): string {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
  }
}

// ---------- HTML helpers ----------
function tableRows(html: string): string[][] {
  const rows: string[][] = [];
  const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRe.exec(html))) {
    const cellRe = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells: string[] = [];
    let c: RegExpExecArray | null;
    while ((c = cellRe.exec(m[1]))) {
      cells.push(
        c[1]
          .replace(/<[^>]+>/g, ' ')
          .replace(/&nbsp;/g, ' ')
          .replace(/&amp;/g, '&')
          .replace(/\s+/g, ' ')
          .trim()
      );
    }
    if (cells.length) rows.push(cells);
  }
  return rows;
}

function num(s: string | undefined | null): number | null {
  if (s == null) return null;
  const t = String(s).replace(/,/g, '').trim();
  if (t === '' || t === '-') return null;
  const n = parseFloat(t);
  return isNaN(n) ? null : n;
}

// ---------- login ----------
async function login(jar: CookieJar): Promise<void> {
  const username = process.env.MPOB_USERNAME;
  const password = process.env.MPOB_PASSWORD;
  if (!username || !password) {
    throw new Error('MPOB_USERNAME / MPOB_PASSWORD 환경변수가 설정되지 않았습니다.');
  }

  // 1) GET login page → session cookie + CSRF token + return value
  const loginPageRes = await fetch(`${MPOB_BASE}/index.php`, {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  jar.absorb(loginPageRes);
  const html = await loginPageRes.text();

  const tokenMatch = html.match(/name="([a-f0-9]{32})"\s+value="1"/i);
  if (!tokenMatch) throw new Error('MPOB 로그인 토큰을 찾을 수 없습니다 (사이트 구조 변경 가능성).');
  const token = tokenMatch[1];
  const returnMatch = html.match(/name="return"\s+value="([^"]+)"/i);
  const returnVal = returnMatch ? returnMatch[1] : 'aW5kZXgucGhw';

  // 2) POST credentials
  const body = new URLSearchParams();
  body.set('username', username);
  body.set('password', password);
  body.set('option', 'com_users');
  body.set('task', 'user.login');
  body.set('return', returnVal);
  body.set(token, '1');

  const loginRes = await fetch(`${MPOB_BASE}/index.php`, {
    method: 'POST',
    headers: {
      'User-Agent': UA,
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.header(),
      Referer: `${MPOB_BASE}/index.php`,
    },
    body: body.toString(),
    redirect: 'manual',
  });
  jar.absorb(loginRes);

  // 3) Follow the post-login redirect once to land authenticated and capture
  //    any rotated cookie.
  const loc = loginRes.headers.get('location');
  if (loc) {
    const followRes = await fetch(loc.startsWith('http') ? loc : `${MPOB_BASE}${loc}`, {
      headers: { 'User-Agent': UA, Cookie: jar.header() },
      redirect: 'manual',
    });
    jar.absorb(followRes);
    const followHtml = await followRes.text();
    if (/Username and password do not match|로그인|not match/i.test(followHtml) && !/Log\s*out|logout/i.test(followHtml)) {
      throw new Error('MPOB 로그인 실패: 아이디/비밀번호를 확인하세요.');
    }
  }
}

async function getText(jar: CookieJar, url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Cookie: jar.header() },
    redirect: 'follow',
  });
  jar.absorb(res);
  return res.text();
}

function extractReportVal(pageHtml: string): string | null {
  const m = pageHtml.match(/web_report1\.php\?val=(\d+)/i);
  return m ? m[1] : null;
}

// ---------- per-category parsers ----------
const SP_PRODUCTS: { name: string; sort: number }[] = [
  { name: 'C.P.STEARIN', sort: 1 },
  { name: 'C.P.OLEIN', sort: 2 },
  { name: 'RBD PALM OIL', sort: 3 },
  { name: 'RBD PALM OLEIN', sort: 4 },
  { name: 'RBD PALM STEARIN', sort: 5 },
  { name: 'PFAD', sort: 6 },
  { name: 'COOKING OIL', sort: 7 },
];

// Stock / Production: two tables (Jan-Jun, Jul-Dec), each row is
// [name, 2025, 2026, 2025, 2026, ...] for 6 months + 2 average cells.
function parseStockProduction(html: string, category: string): MpobScrapedRecord[] {
  const rows = tableRows(html);
  const sortOf = new Map(SP_PRODUCTS.map((p) => [p.name, p.sort]));
  const seen = new Map<string, number>();
  const recs: MpobScrapedRecord[] = [];
  for (const r of rows) {
    const name = r[0];
    if (!sortOf.has(name)) continue;
    const block = seen.get(name) ?? 0; // 0 => Jan-Jun, 1 => Jul-Dec
    seen.set(name, block + 1);
    const startMonth = block === 0 ? 1 : 7;
    for (let i = 0; i < 6; i++) {
      const month = startMonth + i;
      const v25 = num(r[1 + i * 2]);
      const v26 = num(r[1 + i * 2 + 1]);
      if (v25 != null) recs.push({ category, item_name: name, year: 2025, month, value: v25, sort_order: sortOf.get(name)! });
      if (v26 != null) recs.push({ category, item_name: name, year: 2026, month, value: v26, sort_order: sortOf.get(name)! });
    }
  }
  return recs;
}

// Export by Port: single table, columns JAN..DEC for the report year.
// The two "OTHERS" rows are disambiguated by position into (PEN) / (SS).
const EXPORT_PORT_ORDER: { name: string; group: string | null; sort: number }[] = [
  { name: 'BUTTERWORTH', group: 'PEN. MALAYSIA', sort: 1 },
  { name: 'PORT KLANG', group: 'PEN. MALAYSIA', sort: 2 },
  { name: 'PASIR GUDANG', group: 'PEN. MALAYSIA', sort: 3 },
  { name: 'OTHERS (PEN)', group: 'PEN. MALAYSIA', sort: 4 },
  { name: 'PEN. MALAYSIA', group: null, sort: 5 },
  { name: 'LAHAD DATU', group: 'SABAH/SARAWAK', sort: 6 },
  { name: 'SANDAKAN', group: 'SABAH/SARAWAK', sort: 7 },
  { name: 'OTHERS (SS)', group: 'SABAH/SARAWAK', sort: 8 },
  { name: 'SABAH/SARAWAK', group: null, sort: 9 },
  { name: 'MALAYSIA', group: null, sort: 10 },
];

function parseExportPort(html: string, year: number): MpobScrapedRecord[] {
  const rows = tableRows(html);
  const rowRe = /^(BUTTERWORTH|PORT KLANG|PASIR GUDANG|OTHERS|PEN\. MALAYSIA|LAHAD DATU|SANDAKAN|SABAH\/SARAWAK|MALAYSIA)$/i;
  const dataRows = rows.filter((r) => rowRe.test(r[0] || ''));
  const recs: MpobScrapedRecord[] = [];
  dataRows.forEach((r, idx) => {
    const def = EXPORT_PORT_ORDER[idx];
    if (!def) return;
    for (let m = 1; m <= 12; m++) {
      const v = num(r[m]);
      if (v != null) {
        recs.push({ category: 'export_port', item_name: def.name, year, month: m, value: v, parent_group: def.group, sort_order: def.sort });
      }
    }
  });
  return recs;
}

// Export by Product: single table; each product is a "Tonnes" row immediately
// followed by an "RM Mil" row. Columns are JAN..DEC for the report year.
const EXPORT_PRODUCT_ITEMS = [
  'CPO', 'PPO', 'PALM OIL', 'CPKO', 'PPKO', 'PALM KERNEL OIL',
  'PALM KERNEL CAKE', 'OLEOCHEMICALS', 'FINISHED PRODUCTS', 'BIODIESEL', 'OTHERS', 'TOTAL',
];

function parseExportProduct(html: string, year: number): MpobScrapedRecord[] {
  const rows = tableRows(html);
  const sortOf = new Map(EXPORT_PRODUCT_ITEMS.map((n, i) => [n, i + 1]));
  const recs: MpobScrapedRecord[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const name = r[0];
    if (!sortOf.has(name)) continue;
    if (!/tonnes/i.test(r[1] || '')) continue; // first cell after name is UNIT
    const rmRow = rows[i + 1] || [];
    const isRm = /rm\s*mil/i.test(rmRow[0] || '');
    for (let m = 1; m <= 12; m++) {
      const tonnes = num(r[1 + m]); // r[2] = JAN tonnes
      const rm = isRm ? num(rmRow[m]) : null; // rmRow[1] = JAN rm
      if (tonnes != null) {
        recs.push({ category: 'export_product', item_name: name, year, month: m, value: tonnes, value_rm: rm, sort_order: sortOf.get(name)! });
      }
    }
  }
  return recs;
}

// ---------- public API ----------
export interface MpobScrapeResult {
  records: MpobScrapedRecord[];
  summary: { category: string; val: string | null; count: number; error?: string }[];
}

export async function scrapeMPOBData(): Promise<MpobScrapeResult> {
  const jar = new CookieJar();
  await login(jar);

  const records: MpobScrapedRecord[] = [];
  const summary: MpobScrapeResult['summary'] = [];

  for (const page of REPORT_PAGES) {
    try {
      const pageHtml = await getText(jar, page.url);
      const val = extractReportVal(pageHtml);
      if (!val) {
        summary.push({ category: page.category, val: null, count: 0, error: 'iframe report val을 찾지 못함' });
        continue;
      }
      const reportHtml = await getText(jar, `${MPOB_BASE}/stat/web_report1.php?val=${val}`);
      const year = parseInt(val.slice(0, 4), 10) || new Date().getFullYear();

      let recs: MpobScrapedRecord[] = [];
      if (page.category === 'stock' || page.category === 'production') {
        recs = parseStockProduction(reportHtml, page.category);
      } else if (page.category === 'export_port') {
        recs = parseExportPort(reportHtml, year);
      } else if (page.category === 'export_product') {
        recs = parseExportProduct(reportHtml, year);
      }

      records.push(...recs);
      summary.push({ category: page.category, val, count: recs.length });
    } catch (err: any) {
      summary.push({ category: page.category, val: null, count: 0, error: err.message });
    }
  }

  if (records.length === 0) {
    throw new Error('MPOB에서 수집된 데이터가 없습니다. 로그인 또는 사이트 구조를 확인하세요.');
  }

  return { records, summary };
}
