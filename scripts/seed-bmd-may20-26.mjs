#!/usr/bin/env node
// 사용자가 제공한 BMD 가격 5/20~5/26 (5거래일) fcpo_settlement UPSERT.
// 정책:
//   - 오전+오후 모두 있으면 오후(마감가)를 settlement로 저장
//   - 오후 없으면 오전 사용 + source='manual_bmd_am'으로 구분
//   - exchange_rate = settlement_myr / settlement_usd 자동 계산
//   - ON CONFLICT (date, contract_month) DO UPDATE (재실행 가능)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env.migration.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const eq = t.indexOf('=');
  if (eq < 0) continue;
  if (!(t.slice(0, eq).trim() in process.env)) process.env[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
}

const DRY = process.argv.includes('--dry-run');

// 사용자 제공 5거래일
const RECS = [
  // 5/20 오후 마감
  ['2026-05-20', '2026-06', 1190.00, 4515, 'manual_bmd'],
  ['2026-05-20', '2026-07', 1190.00, 4555, 'manual_bmd'],
  ['2026-05-20', '2026-08', 1190.00, 4583, 'manual_bmd'],
  // 5/21 오후
  ['2026-05-21', '2026-06', 1162.50, 4403, 'manual_bmd'],
  ['2026-05-21', '2026-07', 1162.50, 4434, 'manual_bmd'],
  ['2026-05-21', '2026-08', 1162.50, 4457, 'manual_bmd'],
  // 5/22 오후
  ['2026-05-22', '2026-06', 1162.50, 4428, 'manual_bmd'],
  ['2026-05-22', '2026-07', 1162.50, 4461, 'manual_bmd'],
  ['2026-05-22', '2026-08', 1162.50, 4485, 'manual_bmd'],
  // 5/25 오후
  ['2026-05-25', '2026-06', 1162.50, 4408, 'manual_bmd'],
  ['2026-05-25', '2026-07', 1162.50, 4445, 'manual_bmd'],
  ['2026-05-25', '2026-08', 1162.50, 4472, 'manual_bmd'],
  // 5/26 오전 (오후 없음 — 장중)
  ['2026-05-26', '2026-06', 1167.50, 4429, 'manual_bmd_am'],
  ['2026-05-26', '2026-07', 1167.50, 4462, 'manual_bmd_am'],
  ['2026-05-26', '2026-08', 1167.50, 4494, 'manual_bmd_am'],
];

console.log(`Records: ${RECS.length} (5 trading days × 3 contract months)`);
console.log('preview:');
for (const [d, cm, usd, myr, src] of RECS) {
  console.log(`  ${d} ${cm}  USD ${usd}  MYR ${myr}  ER ${(myr/usd).toFixed(4)}  src=${src}`);
}

if (DRY) { console.log('\n--- DRY-RUN ---'); process.exit(0); }

const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
try {
  let inserted = 0, updated = 0;
  await sql.begin(async (tx) => {
    for (const [d, cm, usd, myr, src] of RECS) {
      const er = myr / usd;
      const result = await tx`
        INSERT INTO fcpo_settlement (date, contract_month, settlement_usd, settlement_myr, exchange_rate, source)
        VALUES (${d}, ${cm}, ${usd}, ${myr}, ${er}, ${src})
        ON CONFLICT (date, contract_month) DO UPDATE SET
          settlement_usd = EXCLUDED.settlement_usd,
          settlement_myr = EXCLUDED.settlement_myr,
          exchange_rate  = EXCLUDED.exchange_rate,
          source         = EXCLUDED.source
        RETURNING (xmax = 0) AS inserted
      `;
      if (result[0]?.inserted) inserted++; else updated++;
    }
  });
  console.log(`\nDone — inserted ${inserted}, updated ${updated}`);

  const [{ total }] = await sql`SELECT COUNT(*)::int AS total FROM fcpo_settlement`;
  const [{ dmax }] = await sql`SELECT MAX(date) AS dmax FROM fcpo_settlement`;
  console.log(`fcpo_settlement total: ${total}, latest date: ${dmax}`);
} finally {
  await sql.end({ timeout: 5 });
}
