#!/usr/bin/env node
// inventory.contract_price / contract_date 를 purchases 기반으로 일괄 갱신.
//
// 매핑 규칙 (도구의 autosync 와 동일):
//   inventory(product, year, month) = purchases(product, shipment_month = year-(month-1))
//
// 생성 텍스트:
//   contract_price: '$1078.0/$1100.0' (차수별 단가를 /로 join)
//   contract_date:  '2025-02-14, 2025-02-20' (계약일 dedup join, purchases.notes 에서 파싱)
//
// 정책:
//   - purchases 가 1건이라도 있는 (product, customs_month) 만 갱신 (이미 입력된 값 덮어쓰기)
//   - purchases 없는 row 는 그대로 둠 (엑셀 시드 값 보존)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.migration.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim(); if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('='); if (eq < 0) continue;
  if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}
const DRY = process.argv.includes('--dry-run');

function fmtPrice(p) {
  // 1017.27272727 같은 wavg → '$1017.27' / 1105 → '$1105'
  const n = Number(p);
  if (!Number.isFinite(n)) return '';
  return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

function shipmentMonthOf(year, month) {
  let sy = year, sm = month - 1;
  if (sm < 1) { sm = 12; sy -= 1; }
  return `${sy}-${String(sm).padStart(2, '0')}`;
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
try {
  const inv = await sql`
    SELECT id, product, year, month, contract_price, contract_date
    FROM inventory
    WHERE year >= 2024
    ORDER BY product, year, month
  `;
  console.log(`inventory rows: ${inv.length}`);

  const updates = [];
  for (const r of inv) {
    const sm = shipmentMonthOf(r.year, r.month);
    const purchases = await sql`
      SELECT unit_price, qty_mt, notes, etd
      FROM purchases
      WHERE product = ${r.product} AND shipment_month = ${sm}
      ORDER BY notes
    `;
    if (purchases.length === 0) continue;

    // contract_price 텍스트
    const priceParts = purchases.map(p => fmtPrice(p.unit_price));
    // 모든 가격이 같으면 단일 표시, 다르면 '/' join
    const uniquePrices = [...new Set(priceParts)];
    const priceText = uniquePrices.length === 1 ? uniquePrices[0] : priceParts.join('/');

    // contract_date — purchases.notes 에서 '계약일: YYYY-MM-DD' 패턴 추출
    const dates = new Set();
    for (const p of purchases) {
      const m = String(p.notes ?? '').match(/계약일:\s*(\d{4}-\d{2}-\d{2})/);
      if (m) dates.add(m[1]);
    }
    const dateText = [...dates].sort().join(', ');

    if (priceText !== (r.contract_price ?? '') || dateText !== (r.contract_date ?? '')) {
      updates.push({ id: r.id, product: r.product, year: r.year, month: r.month, priceText, dateText, old_price: r.contract_price, old_date: r.contract_date, n: purchases.length });
    }
  }

  console.log(`\n${updates.length}건 갱신 예정:\n`);
  for (const u of updates) {
    console.log(`  ${u.product} ${u.year}-${String(u.month).padStart(2,'0')} (${u.n}건 purchase):`);
    console.log(`    price:  '${u.old_price ?? '-'}' → '${u.priceText}'`);
    console.log(`    date:   '${u.old_date ?? '-'}' → '${u.dateText}'`);
  }

  if (DRY) {
    console.log('\n--- DRY-RUN end ---');
    process.exit(0);
  }

  if (updates.length > 0) {
    await sql.begin(async (tx) => {
      for (const u of updates) {
        await tx`
          UPDATE inventory
          SET contract_price = ${u.priceText},
              contract_date  = ${u.dateText || null},
              updated_by = 'sync_from_purchases',
              updated_at = NOW()
          WHERE id = ${u.id}
        `;
      }
    });
    console.log(`\n✓ ${updates.length} rows updated`);
  } else {
    console.log('\n변경 없음 — 모든 row가 purchases와 일치');
  }
} finally {
  await sql.end({ timeout: 5 });
}
