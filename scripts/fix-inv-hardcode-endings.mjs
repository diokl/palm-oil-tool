// 엑셀 R342/R367의 25-01~25-06 hardcode ending_stock + RSPO 26-01 hardcode 233,335 반영.
// 그 후 25-07부터는 새 prev로 자동 재계산.

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

// 엑셀에 hardcode된 ending_stock (자동 계산 대신 ERP/실재고 데이터)
const HARDCODE = [
  ['RBD',  2025, 1, 2348469],
  ['RBD',  2025, 2, 2115787],
  ['RBD',  2025, 3, 2859145],
  ['RBD',  2025, 4, 4307404],
  ['RBD',  2025, 5, 5477620],
  ['RBD',  2025, 6, 7689105],
  ['RSPO', 2025, 1, 1079382],
  ['RSPO', 2025, 2, 1246362],
  ['RSPO', 2025, 3, 1337380],
  ['RSPO', 2025, 4, 1056110],
  ['RSPO', 2025, 5, 924260],
  ['RSPO', 2025, 6, 1066520],
  ['RSPO', 2026, 1, 233335],  // RSPO 26-01 별도 hardcode (엑셀 R377 CC377)
];

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
try {
  // 1) hardcode 값 직접 UPDATE
  console.log('1) hardcode ending_stock UPDATE...');
  for (const [p, y, m, end] of HARDCODE) {
    const u = await sql`SELECT expected_usage FROM inventory WHERE product=${p} AND year=${y} AND month=${m}`;
    const usage = Number(u[0]?.expected_usage ?? 0);
    const cov = usage > 0 ? Math.round((end / usage) * 10) / 10 : 0;
    await sql`UPDATE inventory SET ending_stock=${end}, coverage_days=${cov} WHERE product=${p} AND year=${y} AND month=${m}`;
    console.log(`  ${p} ${y}-${String(m).padStart(2,'0')}: end=${end.toLocaleString()} cov=${cov}`);
  }

  // 2) 25-07~25-12 (RBD, RSPO) 25-06 hardcode 기준으로 자동 재계산
  for (const product of ['RBD', 'RSPO']) {
    const startEnd = HARDCODE.find(h => h[0] === product && h[1] === 2025 && h[2] === 6)[3];
    let prev = startEnd;
    const rows = await sql`SELECT id, month, expected_usage, customs_volume FROM inventory WHERE product=${product} AND year=2025 AND month >= 7 ORDER BY month`;
    for (const r of rows) {
      const u = Number(r.expected_usage ?? 0);
      const c = Number(r.customs_volume ?? 0);
      const e = prev + c - u;
      const cov = u > 0 ? Math.round((e / u) * 10) / 10 : 0;
      await sql`UPDATE inventory SET ending_stock=${e}, coverage_days=${cov} WHERE id=${r.id}`;
      prev = e;
    }
    console.log(`2) ${product} 2025-07~12 자동 재계산 (시작 prev=${startEnd.toLocaleString()})`);
  }

  // 3) 26년 RBD, RSPO 재계산 (시작점: 25-12 ending)
  for (const product of ['RBD', 'RSPO']) {
    const prev25 = await sql`SELECT ending_stock FROM inventory WHERE product=${product} AND year=2025 AND month=12`;
    let prev = Number(prev25[0]?.ending_stock ?? 0);

    // RSPO 26-01만 hardcode 적용 (그 외 모든 RSPO 26-XX는 자동 재계산)
    if (product === 'RSPO') {
      prev = 233335;  // RSPO 26-01 hardcode 결과
      // 26-02부터 시작
      const rows = await sql`SELECT id, month, expected_usage, customs_volume FROM inventory WHERE product='RSPO' AND year=2026 AND month >= 2 ORDER BY month`;
      for (const r of rows) {
        const u = Number(r.expected_usage ?? 0);
        const c = Number(r.customs_volume ?? 0);
        const e = prev + c - u;
        const cov = u > 0 ? Math.round((e / u) * 10) / 10 : 0;
        await sql`UPDATE inventory SET ending_stock=${e}, coverage_days=${cov} WHERE id=${r.id}`;
        prev = e;
      }
      console.log(`3) RSPO 2026-02~12 자동 재계산 (RSPO 26-01 hardcode 233,335)`);
    } else {
      // RBD 26년 전체 재계산
      const rows = await sql`SELECT id, month, expected_usage, customs_volume FROM inventory WHERE product='RBD' AND year=2026 ORDER BY month`;
      for (const r of rows) {
        const u = Number(r.expected_usage ?? 0);
        const c = Number(r.customs_volume ?? 0);
        const e = prev + c - u;
        const cov = u > 0 ? Math.round((e / u) * 10) / 10 : 0;
        await sql`UPDATE inventory SET ending_stock=${e}, coverage_days=${cov} WHERE id=${r.id}`;
        prev = e;
      }
      console.log(`3) RBD 2026-01~12 자동 재계산 (prev=25-12 end=${Number(prev25[0]?.ending_stock).toLocaleString()})`);
    }
  }

  // 4) 검증 — 엑셀과 비교
  console.log('\n4) 엑셀 vs 도구 ending_stock 비교:');
  const EXPECTED = [
    ['RBD',  2025, 12, 9786091],
    ['RBD',  2026, 1,  10001954],
    ['RBD',  2026, 6,  7625552],
    ['RBD',  2026, 12, -9303918],
    ['RSPO', 2025, 12, 811400],
    ['RSPO', 2026, 1,  233335],   // hardcode
    ['RSPO', 2026, 6,  1115675],
    ['RSPO', 2026, 12, -1826293],
    ['MANAGED', 2026, 7, 4521778],
    ['MANAGED', 2026, 12, 10630669],
  ];
  for (const [p, y, m, expected] of EXPECTED) {
    const r = await sql`SELECT ending_stock FROM inventory WHERE product=${p} AND year=${y} AND month=${m}`;
    const tool = Math.round(Number(r[0]?.ending_stock ?? 0));
    const match = Math.abs(tool - expected) < 100;
    console.log(`  ${p} ${y}-${String(m).padStart(2,'0')}: 도구=${tool.toLocaleString()} 엑셀=${expected.toLocaleString()} ${match ? '✓' : `✗ 차이=${(tool-expected).toLocaleString()}`}`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
