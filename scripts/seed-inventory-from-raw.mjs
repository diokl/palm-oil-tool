#!/usr/bin/env node
// 엑셀 RAW!CB339~CN390 5개 SCM 테이블을 inventory에 일괄 UPSERT.
//
// 단위: 엑셀 그대로 kg (예: 2,070,178)
// 처리:
//   1. expected_usage / contract_price / contract_date / customs_volume (엑셀 그대로) UPSERT
//   2. 24-12, 25-12 기말재고는 RBD 2,418,776 / RSPO 1,382,975 가정 (seed-data.ts 동일)
//   3. recalcInventory로 ending_stock/coverage_days 자동 산출

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

// ── 엑셀 RAW SCM 5 테이블 ──
// 각 row: [product, year, month, expected_usage, customs_volume, contract_price_text, contract_date_text]
// null = 입력 없음 (NULL 유지)
const SCM = [
  // RBD 25년 (R339~R345)
  ['RBD', 2025, 1,  2070178.164, 1999871, '$1105.0', '2024-10-25'],
  ['RBD', 2025, 2,  2425440.619, 1999828, '$1095.0', '2024-10-25'],
  ['RBD', 2025, 3,  2462501.631, 3000000, '$1122.5', '2024-11-26'],
  ['RBD', 2025, 4,  2455569.599, 4000000, '$1110.0', '2024-12-26'],
  ['RBD', 2025, 5,  2563824.896, 4000000, '$1078.0/$1100.0', '2025-02-14, 2025-02-20'],
  ['RBD', 2025, 6,  2538951.838, 4500000, '$1035.0', '2025-03-25'],
  ['RBD', 2025, 7,  2834779.415, 4000000, '$960.0', '2025-05-14'],
  ['RBD', 2025, 8,  2605170.841, 2500000, '$965.0/$1002.5', '2025-06-26, 2025-07-15'],
  ['RBD', 2025, 9,  2833727.302, 4000000, '$1027.5/$1032.5', '2025-08-06, 2025-08-08'],
  ['RBD', 2025, 10, 2575498.660, null,    null, null],
  ['RBD', 2025, 11, 2553837.310, 5000000, '$1080.0/$1065.0', '2025-09-17, 2025-09-25'],
  ['RBD', 2025, 12, 2777312.786, null,    null, null],

  // RBD 26년 (R355~R361)
  ['RBD', 2026, 1,  2406824.228, 5400000, '$1013.33 (wavg)', '2025-11-18, 2025-11-21'],
  ['RBD', 2026, 2,  2442257.296, 3000000, '$1015.0', '2025-11-21'],
  ['RBD', 2026, 3,  3031251.612, 2000000, '$997.5',  '2025-12-19, 2026-01-19'],
  ['RBD', 2026, 4,  2759600.979, 2600000, '$998.75', '2025-12-19, 2026-01-19'],
  ['RBD', 2026, 5,  2821578.420, 1000000, '$1187.5', '2026-03-12'],
  ['RBD', 2026, 6,  2721713.919, 2800000, '$1187.5', '2026-03-12'],
  ['RBD', 2026, 7,  2821578.420, null,    null, '2026-04-24 (예정)'],
  ['RBD', 2026, 8,  2821578.420, null, null, null],
  ['RBD', 2026, 9,  2821578.420, null, null, null],
  ['RBD', 2026, 10, 2821578.420, null, null, null],
  ['RBD', 2026, 11, 2821578.420, null, null, null],
  ['RBD', 2026, 12, 2821578.420, null, null, null],

  // RSPO 25년 (R364~R370)
  ['RSPO', 2025, 1,  303592.513, null,   '$1130.0', '2024-10-25'],
  ['RSPO', 2025, 2,  277529.600, 400000, '$1120.0', '2024-10-25'],
  ['RSPO', 2025, 3,  253129.353, 400000, '$1142.5', '2024-11-26'],
  ['RSPO', 2025, 4,  308866.737, null,   null, null],
  ['RSPO', 2025, 5,  251762.000, 200000, '$1125.0', '2025-02-20'],
  ['RSPO', 2025, 6,  287213.153, 400000, '$1060.0', '2025-03-25'],
  ['RSPO', 2025, 7,  230717.345, 200000, '$985.0',  '2025-05-14'],
  ['RSPO', 2025, 8,  217443.083, 0,      null, null],
  ['RSPO', 2025, 9,  270794.166, 600000, '$1057.5', '2025-08-08'],
  ['RSPO', 2025, 10, 292893.460, null,   null, null],
  ['RSPO', 2025, 11, 228395.530, null,   null, null],
  ['RSPO', 2025, 12, 314876.079, 500000, '$1062.5', null],

  // RSPO 26년 (R374~R381)
  ['RSPO', 2026, 1,  635721.552, 200000, '$1045.0', '2025-11-18'],
  ['RSPO', 2026, 2,  392195.838, 300000, '$1040.0', '2025-11-21'],
  ['RSPO', 2026, 3,  462099.006, 950000, '$1022.5', '2025-12-19, 2026-01-19'],
  ['RSPO', 2026, 4,  335594.461, 950000, '$1062.43 (wavg)', '2025-12-19, 2026-01-19, 2026-02-20'],
  ['RSPO', 2026, 5,  490328.000, 500000, '$1207.5', '2026-03-12'],
  ['RSPO', 2026, 6,  637442.488, 500000, '$1207.5', '2026-03-12'],
  ['RSPO', 2026, 7,  490328.000, null, null, null],
  ['RSPO', 2026, 8,  490328.000, null, null, null],
  ['RSPO', 2026, 9,  490328.000, null, null, null],
  ['RSPO', 2026, 10, 490328.000, null, null, null],
  ['RSPO', 2026, 11, 490328.000, null, null, null],
  ['RSPO', 2026, 12, 490328.000, null, null, null],

  // MANAGED (3-MCPD+GE+RSPO) 26년 (R382~R388) — 1~6월은 0 / 7월부터 통관
  ['MANAGED', 2026, 1,  0, 0, null, null],
  ['MANAGED', 2026, 2,  0, 0, null, null],
  ['MANAGED', 2026, 3,  0, 0, null, null],
  ['MANAGED', 2026, 4,  0, 0, null, null],
  ['MANAGED', 2026, 5,  0, 0, null, null],
  ['MANAGED', 2026, 6,  0, 0, null, null],
  ['MANAGED', 2026, 7,  3478221.827, 8000000, '$1241.8', '2026-04-24'],
  ['MANAGED', 2026, 8,  3478221.827, 6000000, null, null],
  ['MANAGED', 2026, 9,  3478221.827, 6000000, null, null],
  ['MANAGED', 2026, 10, 3478221.827, 4500000, null, null],
  ['MANAGED', 2026, 11, 3478221.827, 3500000, null, null],
  ['MANAGED', 2026, 12, 3478221.827, 3500000, null, null],
];

const PREV_END = {
  // (product, year): 전년 12월 기말재고 — recalcInventory의 시작점
  // 도구 seed-data.ts 동일 가정
  'RBD|2025':  2418776,
  'RSPO|2025': 1382975,
};

console.log(`SCM rows: ${SCM.length}`);
const byCombo = {};
for (const r of SCM) {
  const k = `${r[0]}|${r[1]}`;
  if (!byCombo[k]) byCombo[k] = 0;
  byCombo[k]++;
}
console.log('by product/year:', byCombo);

if (DRY) {
  console.log('\n--- DRY-RUN ---');
  console.log('Preview first 3:');
  for (const r of SCM.slice(0, 3)) console.log(' ', r);
  process.exit(0);
}

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });

try {
  // 1) UPSERT
  console.log('\n1) UPSERT inventory rows...');
  let inserted = 0, updated = 0;
  await sql.begin(async (tx) => {
    for (const [product, year, month, usage, customs, price, date] of SCM) {
      const result = await tx`
        INSERT INTO inventory (product, year, month, expected_usage, customs_volume, contract_price, contract_date, updated_by, updated_at)
        VALUES (${product}, ${year}, ${month}, ${usage}, ${customs}, ${price}, ${date}, 'excel_seed_scm', NOW())
        ON CONFLICT (product, year, month) DO UPDATE SET
          expected_usage = EXCLUDED.expected_usage,
          customs_volume = EXCLUDED.customs_volume,
          contract_price = EXCLUDED.contract_price,
          contract_date  = EXCLUDED.contract_date,
          updated_by     = EXCLUDED.updated_by,
          updated_at     = NOW()
        RETURNING (xmax = 0) AS inserted
      `;
      if (result[0]?.inserted) inserted++; else updated++;
    }
  });
  console.log(`   inserted ${inserted}, updated ${updated}`);

  // 2) recalcInventory — ending_stock / coverage_days 재계산
  console.log('\n2) recalc ending_stock / coverage_days...');
  const combos = [
    { product: 'RBD',     year: 2025, prevEnd: 2418776 },
    { product: 'RBD',     year: 2026, prevEnd: null }, // auto from 2025-12 ending
    { product: 'RSPO',    year: 2025, prevEnd: 1382975 },
    { product: 'RSPO',    year: 2026, prevEnd: null },
    { product: 'MANAGED', year: 2026, prevEnd: 0 },
  ];
  for (const { product, year, prevEnd } of combos) {
    const rows = await sql`
      SELECT id, expected_usage, customs_volume FROM inventory
      WHERE product = ${product} AND year = ${year}
      ORDER BY month
    `;
    let prevStock;
    if (prevEnd !== null) {
      prevStock = prevEnd;
    } else {
      const prev = await sql`
        SELECT ending_stock FROM inventory WHERE product = ${product} AND year = ${year - 1} AND month = 12
      `;
      prevStock = prev[0]?.ending_stock ?? 0;
    }
    const updates = [];
    for (const r of rows) {
      const u = Number(r.expected_usage ?? 0);
      const c = Number(r.customs_volume ?? 0);
      const end = prevStock + c - u;
      const cov = u > 0 ? Math.round((end / u) * 10) / 10 : 0;
      updates.push({ id: r.id, end, cov });
      prevStock = end;
    }
    for (const u of updates) {
      await sql`UPDATE inventory SET ending_stock = ${u.end}, coverage_days = ${u.cov} WHERE id = ${u.id}`;
    }
    console.log(`   ${product} ${year}: ${updates.length} rows recalculated (prev=${typeof prevEnd === 'number' ? prevEnd : 'auto'})`);
  }

  // 3) 검증
  console.log('\n3) 검증 — 핵심 행 ending_stock 비교:');
  const verify = await sql`
    SELECT product, year, month, expected_usage, customs_volume, ending_stock, coverage_days
    FROM inventory
    WHERE (product='RBD' AND year=2025 AND month IN (1,6,12))
       OR (product='RBD' AND year=2026 AND month IN (1,6,9))
       OR (product='RSPO' AND year=2026 AND month IN (1,6,12))
       OR (product='MANAGED' AND year=2026 AND month IN (7,9,12))
    ORDER BY product, year, month
  `;
  for (const r of verify) {
    console.log(`  ${r.product} ${r.year}-${String(r.month).padStart(2,'0')}: usage=${Number(r.expected_usage).toLocaleString()} customs=${Number(r.customs_volume).toLocaleString()} end=${Number(r.ending_stock).toLocaleString()} cov=${r.coverage_days}`);
  }
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
