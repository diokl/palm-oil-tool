#!/usr/bin/env node
// 엑셀 '외자_구매_품의_영향액_Tool_26년_VF_260903_10월선적.xlsx' (9월선적 IOI 계약 반영본) 값을
// 도구 DB에 반영한다. 재실행해도 같은 결과(멱등).
//
//   node scripts/apply-excel-260903.mjs --dry-run   # 변경 내용만 출력
//   node scripts/apply-excel-260903.mjs             # 실제 반영
//
// 반영 내용
//  1) 스키마: inventory.actual_ending_stock (실재고 반영값), purchases.market_price_source 컬럼 추가
//  2) 재고관리 2026 (Stock 시트): 예상소요량 / 통관수량 / 판매량 / 실재고(하드코딩된 월) / 계약단가 텍스트 보정
//     - 관리팜유(RPO)+관리팜유(RSPO) 는 도구의 MANAGED 하나로 합산
//     - 엑셀에서 수식이 아니라 실재고로 덮어쓴 달(삼양베이커수불 재고 적용)은 actual_ending_stock 으로 저장
//  3) 구매이력: 9월선적 IOI 2건 계약번호 (Contract 시트 S56804/2609, S56805/2609)
//  4) FCPO DB: 도구에 없는 거래일만 엑셀 '팜유시장가격DB' 에서 보충 (기존 값은 덮어쓰지 않음)
//  5) 기말재고/재고회전 체인 재계산 (실재고 반영) 후 엑셀 기말재고와 대조

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import XLSX from 'xlsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
for (const envName of ['.env.migration.local', '.env.local']) {
  const envPath = path.join(projectRoot, envName);
  if (!fs.existsSync(envPath)) continue;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 없음 (.env.migration.local)'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');
const EXCEL_PATH = process.argv.find(a => a.endsWith('.xlsx')) ||
  'C:/Users/PC/OneDrive/Desktop/27년 경영계획/외자_구매_품의_영향액_Tool_26년_VF_260903_10월선적.xlsx';

// ── 2) 재고관리 2026 (엑셀 Stock 시트 그대로, 단위 kg) ──
// [product, month, expected_usage, customs_volume, sales_volume, actual_ending_stock, contract_price(텍스트|undefined=유지), contract_date(텍스트|undefined=유지)]
const INV_2026 = [
  // RBD PALM OIL (Stock!R14~R25). 5·6·7월 기말재고는 엑셀 하드코딩(실재고) → actual
  ['RBD', 1,  2406824.228, 5400000, 0, null],
  ['RBD', 2,  2442257.296, 3000000, 0, null],
  ['RBD', 3,  3031251.612, 2000000, 0, null],
  ['RBD', 4,  2759600.979, 2600000, 0, null],
  ['RBD', 5,  2614706.709, 1000000, 0, 7361690],
  ['RBD', 6,  2606317.48,  2800000, 4000000, 3488330, '$1187.50', '2026-03-12'],  // 6월 통관 = 5월선적 2,800MT @1187.5 (기존 '1215/2026-05-28' 오기 정정)
  ['RBD', 7,  1147987.765, null, 0, 2570750],
  ['RBD', 8,  152408.219,  null, 0, null],
  ['RBD', 9,  727740.672,  null, 0, null],
  ['RBD', 10, 787500,      null, 0, null],
  ['RBD', 11, 787500,      null, 0, null],
  ['RBD', 12, 787500,      null, 0, null],

  // RSPO PALM OIL (Stock!R37~R46). 1·4·5·6·7월 실재고, 8월은 엑셀상 소진(0)
  ['RSPO', 1,  635721.552, 200000, 0, 233335],
  ['RSPO', 2,  392195.838, 300000, 0, null],
  ['RSPO', 3,  462099.006, 950000, 0, null],
  ['RSPO', 4,  335594.461, 950000, 0, 1132547],
  ['RSPO', 5,  421692.368, 500000, 0, 1263260],
  ['RSPO', 6,  652585.697, 500000, 0, 1073740],
  ['RSPO', 7,  603294.389, 0,      0, 602320],
  ['RSPO', 8,  657757.542, 0,      0, 0],
  ['RSPO', 9,  0, 0, 0, null],
  ['RSPO', 10, 0, 0, 0, null],
  ['RSPO', 11, 0, 0, 0, null],
  ['RSPO', 12, 0, 0, 0, null],

  // 관리팜유 = 관리팜유(RPO) + 관리팜유(RSPO) 합산 (Stock!R47~R66)
  //   소요: 7월 0+1,226,579 / 8월 0+2,483,511 / 9월 0+2,495,755 / 10월 2,674,160+520,118 / 11·12월 2,185,733+520,118
  //   통관: 7월 7,500,000 / 8월 5,956,250(실통관) / 9월 1,000,000+1,000,000 / 10월 1,500,000+500,000 / 11월 3,000,000(후속 예정)+500,000
  //   실재고: 7월 5,678,410 / 8월 3,102,200+5,956,250
  ['MANAGED', 1, 0, 0, 0, null],
  ['MANAGED', 2, 0, 0, 0, null],
  ['MANAGED', 3, 0, 0, 0, null],
  ['MANAGED', 4, 0, 0, 0, null],
  ['MANAGED', 5, 0, 0, 0, null],
  ['MANAGED', 6, 0, 0, 0, null],
  ['MANAGED', 7,  1226579.469, 7500000, 0, 5678410, '$1226.50 (wavg)', '2026-04-24, 2026-05-28'],
  ['MANAGED', 8,  2483511.156, 5956250, 0, 9058450, '$1177.50 (wavg)', '2026-06-29'],
  ['MANAGED', 9,  2495755.038, 2000000, 0, null,    '$1170/$1195',     '2026-07-20'],
  ['MANAGED', 10, 3194277.357, 2000000, 0, null],   // 계약단가 '$1180/$1205' / 2026-09-02 (기존 유지)
  ['MANAGED', 11, 2705850.618, 3500000, 0, null],
  ['MANAGED', 12, 2705850.618, 0,       0, null],
];

// 엑셀 Stock 시트 기말재고 (검증용)
const EXPECTED_END = {
  RBD:     [10001954.458, 10559697.162, 9528445.55, 9368844.571, 7361690, 3488330, 2570750, 2418341.781, 1690601.109, 903101.109, 115601.109, -671898.891],
  RSPO:    [233335, 141139.162, 629040.156, 1132547, 1263260, 1073740, 602320, 0, 0, 0, 0, 0],
  MANAGED: [0, 0, 0, 0, 0, 0, 5678410, 9058450, 8562694.962, 7368417.605, 8162566.987, 5456716.369],
};

// ── 3) 구매이력 계약번호 (Contract 시트) ──
const PURCHASE_CONTRACTS = [
  { shipment_month: '2026-09', product: 'MANAGED', qty_mt: 1500, unit_price: 1180, contract_number: 'S56804/2609' },
  { shipment_month: '2026-09', product: 'MANAGED', qty_mt: 500,  unit_price: 1205, contract_number: 'S56805/2609' },
];

// ── 4) 엑셀 FCPO DB 읽기 ──
function readExcelFcpo() {
  if (!fs.existsSync(EXCEL_PATH)) { console.warn(`엑셀 없음 → FCPO 보충 생략: ${EXCEL_PATH}`); return []; }
  const wb = XLSX.readFile(EXCEL_PATH);
  const ws = wb.Sheets['팜유시장가격DB(REFINITIV-마감기준)'];
  if (!ws) { console.warn('팜유시장가격DB 시트 없음 → FCPO 보충 생략'); return []; }
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  const ser = (n) => new Date(Date.UTC(1899, 11, 30) + n * 86400000).toISOString().slice(0, 10);
  const hdr = rows[2];
  const cols = [];
  for (let c = 4; c < hdr.length; c++) if (typeof hdr[c] === 'number') cols.push({ c, cm: ser(hdr[c]).slice(0, 7) });
  const out = [];
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r];
    if (typeof row[0] !== 'number') continue;
    const date = ser(row[0]);
    if (date < '2026-01-01') continue; // 2026 이후만 (그 이전은 이미 excel_import 로 적재됨)
    const dow = new Date(date + 'T00:00:00Z').getUTCDay();
    if (dow === 0 || dow === 6) continue; // 주말 행은 오입력
    for (const { c, cm } of cols) {
      const v = row[c];
      if (typeof v !== 'number' || v < 100) continue; // 182.5 같은 오타 제외
      out.push({ date, contract_month: cm, usd: v });
    }
  }
  return out;
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 }));

try {
  // ── 1) 스키마 ──
  console.log('1) 스키마 컬럼 확인/추가');
  if (!DRY) {
    await sql`ALTER TABLE inventory ADD COLUMN IF NOT EXISTS actual_ending_stock DOUBLE PRECISION`;
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS market_price_source TEXT`;
    // 기존 입력값은 'legacy' 로 표시 (자동매칭 '전체 갱신' 시 덮어쓰기 대상, 'manual' 은 보존)
    await sql`UPDATE purchases SET market_price_source = 'legacy' WHERE market_price_usd IS NOT NULL AND market_price_source IS NULL`;
  }

  // ── 2) 재고관리 ──
  console.log('\n2) 재고관리 2026 UPSERT');
  const current = await sql`SELECT * FROM inventory WHERE year = 2026`;
  const curMap = new Map(current.map(r => [`${r.product}|${r.month}`, r]));
  let changes = 0;
  for (const [product, month, usage, customs, sales, actual, cprice, cdate] of INV_2026) {
    const cur = curMap.get(`${product}|${month}`);
    const diff = [];
    const num = (x) => (x == null ? null : Number(x));
    if (!cur) diff.push('신규');
    else {
      if (num(cur.expected_usage) !== usage) diff.push(`소요 ${fmt(cur.expected_usage)}→${fmt(usage)}`);
      if (num(cur.customs_volume) !== customs) diff.push(`통관 ${fmt(cur.customs_volume)}→${fmt(customs)}`);
      if ((num(cur.sales_volume) ?? 0) !== sales) diff.push(`판매 ${fmt(cur.sales_volume)}→${fmt(sales)}`);
      if (num(cur.actual_ending_stock ?? null) !== actual) diff.push(`실재고 ${fmt(cur.actual_ending_stock)}→${fmt(actual)}`);
      if (cprice !== undefined && cur.contract_price !== cprice) diff.push(`단가 '${cur.contract_price}'→'${cprice}'`);
      if (cdate !== undefined && cur.contract_date !== cdate) diff.push(`계약일 '${cur.contract_date}'→'${cdate}'`);
    }
    if (diff.length) { changes++; console.log(`   ${product} 2026-${String(month).padStart(2, '0')}: ${diff.join(', ')}`); }
    if (DRY) continue;
    await sql`
      INSERT INTO inventory (product, year, month, expected_usage, customs_volume, sales_volume, actual_ending_stock, contract_price, contract_date, updated_by, updated_at)
      VALUES (${product}, 2026, ${month}, ${usage}, ${customs}, ${sales}, ${actual},
              ${cprice !== undefined ? cprice : (cur?.contract_price ?? null)}, ${cdate !== undefined ? cdate : (cur?.contract_date ?? null)},
              'excel_260903', NOW())
      ON CONFLICT (product, year, month) DO UPDATE SET
        expected_usage = EXCLUDED.expected_usage,
        customs_volume = EXCLUDED.customs_volume,
        sales_volume = EXCLUDED.sales_volume,
        actual_ending_stock = EXCLUDED.actual_ending_stock,
        contract_price = EXCLUDED.contract_price,
        contract_date = EXCLUDED.contract_date,
        updated_by = EXCLUDED.updated_by,
        updated_at = NOW()`;
  }
  console.log(`   변경 ${changes}행`);

  // ── 3) 구매이력 계약번호 ──
  console.log('\n3) 구매이력 계약번호');
  for (const c of PURCHASE_CONTRACTS) {
    const rows = await sql`SELECT id, contract_number FROM purchases WHERE shipment_month = ${c.shipment_month} AND product = ${c.product} AND qty_mt = ${c.qty_mt} AND unit_price = ${c.unit_price} ORDER BY id`;
    if (rows.length === 0) { console.log(`   ⚠ 없음: ${c.shipment_month} ${c.product} ${c.qty_mt}MT @${c.unit_price}`); continue; }
    const r = rows[0];
    if (r.contract_number === c.contract_number) { console.log(`   = id ${r.id} ${c.contract_number} (동일)`); continue; }
    console.log(`   id ${r.id}: '${r.contract_number ?? ''}' → '${c.contract_number}'`);
    if (!DRY) await sql`UPDATE purchases SET contract_number = ${c.contract_number} WHERE id = ${r.id}`;
  }

  // ── 4) FCPO 보충 ──
  console.log('\n4) FCPO DB 보충 (도구에 없는 거래일/셀만)');
  const xl = readExcelFcpo();
  if (xl.length) {
    const existing = await sql`SELECT date::text AS date, contract_month FROM fcpo_settlement WHERE date >= '2026-01-01'`;
    const have = new Set(existing.map(r => `${r.date}|${r.contract_month}`));
    const missing = xl.filter(x => !have.has(`${x.date}|${x.contract_month}`));
    const dates = [...new Set(missing.map(m => m.date))].sort();
    console.log(`   엑셀 2026 셀 ${xl.length}개 중 누락 ${missing.length}개 (거래일: ${dates.join(', ') || '없음'})`);
    if (!DRY && missing.length) {
      await sql.begin(async (tx) => {
        for (const m of missing) {
          await tx`INSERT INTO fcpo_settlement (date, contract_month, settlement_usd, source)
                   VALUES (${m.date}, ${m.contract_month}, ${m.usd}, 'excel_refinitiv')
                   ON CONFLICT (date, contract_month) DO NOTHING`;
        }
      });
    }
  }

  // ── 5) 재계산 + 검증 ──
  console.log('\n5) 기말재고 재계산 (실재고 반영) + 엑셀 대조');
  for (const product of ['RBD', 'RSPO', 'MANAGED']) {
    const prev = await sql`SELECT ending_stock FROM inventory WHERE product = ${product} AND year = 2025 AND month = 12`;
    let prevStock = Number(prev[0]?.ending_stock ?? 0);
    const rows = DRY
      ? INV_2026.filter(r => r[0] === product).map(([, month, usage, customs, sales, actual]) => ({ month, expected_usage: usage, customs_volume: customs, sales_volume: sales, actual_ending_stock: actual }))
      : await sql`SELECT id, month, expected_usage, customs_volume, sales_volume, actual_ending_stock FROM inventory WHERE product = ${product} AND year = 2026 ORDER BY month`;
    let maxDiff = 0;
    for (const r of rows) {
      const u = Number(r.expected_usage ?? 0), c = Number(r.customs_volume ?? 0), s = Number(r.sales_volume ?? 0);
      const end = r.actual_ending_stock != null ? Number(r.actual_ending_stock) : prevStock + c - u - s;
      const cov = u > 0 ? Math.round((end / u) * 10) / 10 : 0;
      if (!DRY) await sql`UPDATE inventory SET ending_stock = ${end}, coverage_days = ${cov} WHERE id = ${r.id}`;
      const exp = EXPECTED_END[product][r.month - 1];
      const d = Math.abs(end - exp);
      maxDiff = Math.max(maxDiff, d);
      const flag = d > 1 ? ' ✗' : '';
      console.log(`   ${product} ${String(r.month).padStart(2, '0')}: ${fmt(end).padStart(12)}  (엑셀 ${fmt(exp).padStart(12)})${r.actual_ending_stock != null ? ' [실재고]' : ''}${flag}`);
      prevStock = end;
    }
    console.log(`   → ${product} 최대 차이 ${fmt(maxDiff)} kg ${maxDiff > 1 ? '✗ 불일치' : '✓'}`);
  }
  console.log(DRY ? '\n--- DRY-RUN: DB 변경 없음 ---' : '\n완료.');
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
