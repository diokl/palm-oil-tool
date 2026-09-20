#!/usr/bin/env node
// 관리팜유 스펙 분리 마이그레이션 (멱등).
//   node scripts/apply-purchase-spec.mjs --dry-run
//   node scripts/apply-purchase-spec.mjs
//
// 1) purchases 에 spec / base_price / prem_3mcpd / prem_ge / prem_rspo 컬럼 추가
// 2) 기존 관리팜유 계약 10건: 품의서(6·7·8·9월 선적 SUPPLIER 표) 기준 Base+프리미엄 분해값 입력,
//    RSPO 포함 스펙은 product 를 MANAGED_RSPO 로 변경
//    RBD/RSPO 행: spec 부여, RSPO 는 prem_rspo 25 (base = 단가 − 25)
// 3) 재고관리 MANAGED(합산) 행을 엑셀 Stock 시트대로 관리팜유(RPO) / 관리팜유(RSPO) 로 분리
// 4) 기말재고 체인 재계산 + 엑셀 대조

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const envName of ['.env.migration.local', '.env.local']) {
  const p = path.join(__dirname, '..', envName);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 없음'); process.exit(1); }
const DRY = process.argv.includes('--dry-run');

// ── 2) 관리팜유 계약 분해값 (품의서 SUPPLIER 표) ──
// [contract_number, spec, product, base, 3mcpd, ge, rspo]
const MANAGED = [
  ['S55273/2606', 'MGD_GE_RSPO', 'MANAGED_RSPO', 1177.5, 10, 30, 25], // 6월 IOI 1차: Base 1,177.5 + 40 + 25 = 1,242.5
  ['40409698',    'MGD_GE_RSPO', 'MANAGED_RSPO', 1176.0, 10, 30, 25], // 6월 Wilmar 1차: 1,176 + 40 + 25 = 1,241
  ['S55634/2606', 'MGD_GE_RSPO', 'MANAGED_RSPO', 1150.0, 10, 30, 25], // 6월 IOI 2차: 1,150 + 40 + 25 = 1,215
  ['40411165',    'MGD_GE_RSPO', 'MANAGED_RSPO', 1155.0, 10, 28, 25], // 6월 Wilmar 2차: 1,155 + 38 + 25 = 1,218
  ['S56005/2607', 'MGD_GE',      'MANAGED',      1135.0, 10, 30, 0],  // 7월 IOI: 1,135 + 10 + 30 = 1,175
  ['40413886',    'MGD_GE',      'MANAGED',      1140.0, 10, 30, 0],  // 7월 Wilmar: 1,140 + 10 + 30 = 1,180
  ['S56225/2608', 'MGD_GE',      'MANAGED',      1125.0, 10, 35, 0],  // 8월 IOI RPO: 1,125 + 10 + 35 = 1,170
  ['S56226/2608', 'MGD_GE_RSPO', 'MANAGED_RSPO', 1125.0, 10, 35, 25], // 8월 IOI RSPO: 1,125 + 10 + 35 + 25 = 1,195
  ['S56804/2609', 'MGD',         'MANAGED',      1170.0, 10, 0, 0],   // 9월 IOI RPO: 1,170 + 10 = 1,180
  ['S56805/2609', 'MGD_RSPO',    'MANAGED_RSPO', 1170.0, 10, 0, 25],  // 9월 IOI RSPO: 1,170 + 10 + 25 = 1,205
];

// ── 3) 재고관리 관리팜유 분리 (엑셀 Stock!R47~R66, kg) ──
// [month, expected_usage, customs_volume, actual_ending_stock, contract_price, contract_date]
const RPO = [
  [1, 0, 0, null, null, null], [2, 0, 0, null, null, null], [3, 0, 0, null, null, null], [4, 0, 0, null, null, null], [5, 0, 0, null, null, null], [6, 0, 0, null, null, null],
  [7, 0, 0, null, null, null],
  [8, 0, 5956250, null, '$1177.50 (wavg)', '2026-06-29'],   // 7월선적 6,000톤 → 8월 실통관 5,956,250
  [9, 0, 1000000, null, '$1170', '2026-07-20'],             // 8월선적 1,000톤(S56225)
  [10, 2674159.75, 1500000, null, '$1180', '2026-09-02'],   // 9월선적 1,500톤(S56804)
  [11, 2185733.011, 3000000, null, null, null],             // 후속 예정 3,000톤 (미계약)
  [12, 2185733.011, 0, null, null, null],
];
const RSPO_M = [
  [1, 0, 0, null, null, null], [2, 0, 0, null, null, null], [3, 0, 0, null, null, null], [4, 0, 0, null, null, null], [5, 0, 0, null, null, null], [6, 0, 0, null, null, null],
  [7, 1226579.469, 7500000, 5678410, '$1226.50 (wavg)', '2026-04-24, 2026-05-28'], // 6월선적 7,500톤
  [8, 2483511.156, 0, 3102200, null, null],
  [9, 2495755.038, 1000000, null, '$1195', '2026-07-20'],   // 8월선적 1,000톤(S56226)
  [10, 520117.607, 500000, null, '$1205', '2026-09-02'],    // 9월선적 500톤(S56805)
  [11, 520117.607, 500000, null, null, null],               // 후속 예정 500톤 (미계약)
  [12, 520117.607, 0, null, null, null],
];
const EXPECTED = {
  MANAGED:      [0, 0, 0, 0, 0, 0, 0, 5956250, 6956250, 5782090.25, 6596357.239, 4410624.227],
  MANAGED_RSPO: [0, 0, 0, 0, 0, 0, 5678410, 3102200, 1606444.962, 1586327.355, 1566209.749, 1046092.142],
};

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
const fmt = (n) => (n == null ? '-' : Number(n).toLocaleString('en-US', { maximumFractionDigits: 1 }));
try {
  console.log('1) 컬럼 추가');
  if (!DRY) {
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS spec TEXT`;
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS base_price DOUBLE PRECISION`;
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS prem_3mcpd DOUBLE PRECISION`;
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS prem_ge DOUBLE PRECISION`;
    await sql`ALTER TABLE purchases ADD COLUMN IF NOT EXISTS prem_rspo DOUBLE PRECISION`;
    // product CHECK 제약에 MANAGED_RSPO 추가 (purchases / inventory)
    await sql`ALTER TABLE purchases DROP CONSTRAINT IF EXISTS purchases_product_check`;
    await sql`ALTER TABLE purchases ADD CONSTRAINT purchases_product_check CHECK (product IN ('RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'))`;
    await sql`ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_product_check`;
    await sql`ALTER TABLE inventory ADD CONSTRAINT inventory_product_check CHECK (product IN ('RBD', 'RSPO', 'MANAGED', 'MANAGED_RSPO'))`;
  }

  console.log('\n2) 구매이력 스펙·프리미엄');
  for (const [cn, spec, product, base, m, g, r] of MANAGED) {
    const rows = await sql`SELECT id, product, unit_price FROM purchases WHERE contract_number = ${cn}`;
    if (rows.length !== 1) { console.log(`   ⚠ ${cn}: ${rows.length}건 — 건너뜀`); continue; }
    const row = rows[0];
    const sum = Math.round((base + m + g + r) * 100) / 100;
    const ok = Math.abs(sum - Number(row.unit_price)) < 0.01;
    console.log(`   id ${row.id} ${cn}: ${row.product}→${product} ${spec} base ${base} + ${m}/${g}/${r} = ${sum} ${ok ? '✓' : `✗ (단가 ${row.unit_price})`}`);
    if (!ok) continue;
    if (!DRY) await sql`UPDATE purchases SET spec = ${spec}, product = ${product}, base_price = ${base}, prem_3mcpd = ${m}, prem_ge = ${g}, prem_rspo = ${r} WHERE id = ${row.id}`;
  }
  const other = DRY ? [] : [
    await sql`UPDATE purchases SET spec = 'RBD', base_price = unit_price, prem_3mcpd = 0, prem_ge = 0, prem_rspo = 0 WHERE product = 'RBD' AND spec IS NULL`,
    await sql`UPDATE purchases SET spec = 'RSPO', base_price = unit_price - 25, prem_3mcpd = 0, prem_ge = 0, prem_rspo = 25 WHERE product = 'RSPO' AND spec IS NULL`,
  ];
  if (!DRY) console.log(`   RBD ${other[0].count}건 / RSPO ${other[1].count}건 spec 부여`);
  if (!DRY) { const left = await sql`SELECT COUNT(*) n FROM purchases WHERE spec IS NULL`; console.log(`   spec 미부여 잔여: ${left[0].n}`); }

  console.log('\n3) 재고관리 관리팜유 RPO / RSPO 분리');
  const upsert = async (product, rows, by) => {
    for (const [month, usage, customs, actual, cprice, cdate] of rows) {
      if (DRY) continue;
      await sql`
        INSERT INTO inventory (product, year, month, expected_usage, customs_volume, sales_volume, actual_ending_stock, contract_price, contract_date, updated_by, updated_at)
        VALUES (${product}, 2026, ${month}, ${usage}, ${customs}, 0, ${actual}, ${cprice}, ${cdate}, ${by}, NOW())
        ON CONFLICT (product, year, month) DO UPDATE SET
          expected_usage = EXCLUDED.expected_usage, customs_volume = EXCLUDED.customs_volume, sales_volume = 0,
          actual_ending_stock = EXCLUDED.actual_ending_stock, contract_price = EXCLUDED.contract_price, contract_date = EXCLUDED.contract_date,
          updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
    }
  };
  await upsert('MANAGED', RPO, 'spec_split_rpo');
  await upsert('MANAGED_RSPO', RSPO_M, 'spec_split_rspo');
  console.log(`   MANAGED(RPO) 12행, MANAGED_RSPO 12행 ${DRY ? '(dry-run)' : 'UPSERT'}`);

  console.log('\n4) 재계산 + 엑셀 대조');
  for (const [product, src] of [['MANAGED', RPO], ['MANAGED_RSPO', RSPO_M]]) {
    let prev = 0, maxDiff = 0;
    const rows = DRY
      ? src.map(([month, usage, customs, actual]) => ({ id: null, month, expected_usage: usage, customs_volume: customs, sales_volume: 0, actual_ending_stock: actual }))
      : await sql`SELECT id, month, expected_usage, customs_volume, sales_volume, actual_ending_stock FROM inventory WHERE product = ${product} AND year = 2026 ORDER BY month`;
    for (const r of rows) {
      const u = Number(r.expected_usage ?? 0), c = Number(r.customs_volume ?? 0), s = Number(r.sales_volume ?? 0);
      const end = r.actual_ending_stock != null ? Number(r.actual_ending_stock) : prev + c - u - s;
      const cov = u > 0 ? Math.round((end / u) * 10) / 10 : 0;
      if (!DRY) await sql`UPDATE inventory SET ending_stock = ${end}, coverage_days = ${cov} WHERE id = ${r.id}`;
      const exp = EXPECTED[product][r.month - 1]; const d = Math.abs(end - exp); maxDiff = Math.max(maxDiff, d);
      console.log(`   ${product.padEnd(13)} ${String(r.month).padStart(2, '0')}: ${fmt(end).padStart(12)} (엑셀 ${fmt(exp).padStart(12)})${r.actual_ending_stock != null ? ' [실재고]' : ''}${d > 1 ? ' ✗' : ''}`);
      prev = end;
    }
    console.log(`   → ${product} 최대 차이 ${fmt(maxDiff)} ${maxDiff > 1 ? '✗' : '✓'}`);
  }
  console.log(DRY ? '\n--- DRY-RUN ---' : '\n완료.');
} catch (e) { console.error('FAILED:', e.message); process.exit(1); } finally { await sql.end({ timeout: 5 }); }
