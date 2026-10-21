// 2025-01~06 ERP 실재고(엑셀 R342/R367 하드코딩)를 inventory.actual_ending_stock 으로 옮기고
// 2025 이후 재고를 recalcInventory 와 같은 규칙으로 다시 계산한다.
//
// 배경: fix-inv-hardcode-endings.mjs 가 이 값을 계산 결과 칸(ending_stock)에만 써서,
// 2025 를 재계산하면(셀 수정·구매 동기화) 덮어써지고 기초재고도 0 으로 계산됐다.
// actual_ending_stock 에 두면 재계산해도 그 달은 실재고로 고정된다 (2026 은 apply-excel-260903 이 이미 이렇게 저장).
//
// 사용: node scripts/anchor-2025-actual-stock.mjs           (dry-run — 읽기만, 바뀔 값 출력)
//       node scripts/anchor-2025-actual-stock.mjs --apply   (한 트랜잭션으로 반영)
// DATABASE_URL 은 환경변수 또는 ../.env.migration.local 에서 읽는다.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.migration.local');
if (!process.env.DATABASE_URL && fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim(); if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('='); if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    if (!(k in process.env)) process.env[k] = t.slice(eq + 1).trim();
  }
}
if (!process.env.DATABASE_URL) { console.error('DATABASE_URL 없음'); process.exit(1); }
const APPLY = process.argv.includes('--apply');

// src/lib/inventory-calc.ts 의 INVENTORY_START_YEAR / START_YEAR_OPENING_STOCK_KG 와 같아야 한다
const START_YEAR = 2025;
const OPENING = { RBD: 2418776, RSPO: 1382975 };

// 엑셀 하드코딩 실재고 (kg) — fix-inv-hardcode-endings.mjs 와 동일 값
const ACTUAL_2025 = {
  RBD:  { 1: 2348469, 2: 2115787, 3: 2859145, 4: 4307404, 5: 5477620, 6: 7689105 },
  RSPO: { 1: 1079382, 2: 1246362, 3: 1337380, 4: 1056110, 5: 924260,  6: 1066520 },
};

const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (v) => (v == null ? '-' : Math.round(v).toLocaleString());
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });

try {
  const rows = await sql`
    SELECT id, product, year, month, expected_usage, customs_volume, sales_volume, actual_ending_stock, ending_stock, coverage_days
    FROM inventory WHERE year >= ${START_YEAR - 1} ORDER BY product, year, month`;
  const pre = rows.filter((r) => r.year < START_YEAR);
  if (pre.length) {
    console.log(`참고: ${START_YEAR - 1}년 재고 행 ${pre.length}개 있음 (이제 계산에 쓰이지 않음 — 그대로 둠)`);
  }

  const anchorUpdates = [];   // { id, product, month, value }
  const stockUpdates = [];    // { id, ending, coverage }
  const products = [...new Set(rows.filter((r) => r.year >= START_YEAR).map((r) => r.product))];

  for (const product of products) {
    console.log(`\n== ${product} ==`);
    const anchors = ACTUAL_2025[product] || {};
    let prevStock = OPENING[product] ?? 0;
    const years = [...new Set(rows.filter((r) => r.product === product && r.year >= START_YEAR).map((r) => r.year))].sort();
    for (const year of years) {
      const yr = rows.filter((r) => r.product === product && r.year === year);
      for (const r of yr) {
        let actual = num(r.actual_ending_stock);
        const hard = year === START_YEAR ? anchors[r.month] : undefined;
        let note = '';
        if (hard != null) {
          if (actual == null) {
            actual = hard;
            anchorUpdates.push({ id: r.id, product, month: r.month, value: hard });
            note = ' [실재고 신규 저장]';
          } else if (Math.abs(actual - hard) > 0.5) {
            note = ` [기존 실재고 ${fmt(actual)} 유지 — 엑셀값 ${fmt(hard)} 과 다름]`;
          }
        }
        const usage = num(r.expected_usage) ?? 0;
        const ending = actual != null ? actual : prevStock + (num(r.customs_volume) ?? 0) - usage - (num(r.sales_volume) ?? 0);
        const coverage = usage > 0 ? Math.round((ending / usage) * 10) / 10 : 0;
        const cur = num(r.ending_stock);
        const changed = cur == null || Math.abs(cur - ending) > 0.5 || Math.abs((num(r.coverage_days) ?? 0) - coverage) > 0.05;
        if (changed) stockUpdates.push({ id: r.id, ending, coverage });
        const delta = cur == null ? '' : `  Δ ${fmt(ending - cur)}`;
        console.log(`  ${year}-${String(r.month).padStart(2, '0')}  현재 ${fmt(cur).padStart(12)}  →  ${fmt(ending).padStart(12)}${changed ? delta : '  (동일)'}${note}`);
        prevStock = ending;
      }
    }
  }

  console.log(`\n실재고 신규 저장 ${anchorUpdates.length}건, 기말재고 변경 ${stockUpdates.length}건`);
  if (!APPLY) {
    console.log('dry-run — DB 는 바꾸지 않았습니다. 반영하려면 --apply');
  } else {
    await sql.begin(async (tx) => {
      for (const a of anchorUpdates) {
        await tx`UPDATE inventory SET actual_ending_stock = ${a.value}, updated_by = 'anchor-2025-actual', updated_at = NOW() WHERE id = ${a.id}`;
      }
      for (const u of stockUpdates) {
        await tx`UPDATE inventory SET ending_stock = ${u.ending}, coverage_days = ${u.coverage}, updated_at = NOW() WHERE id = ${u.id}`;
      }
    });
    console.log('반영 완료 (한 트랜잭션)');
  }
} finally {
  await sql.end();
}
