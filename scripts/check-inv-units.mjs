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
const sql = postgres(process.env.DATABASE_URL, { prepare: false, ssl: 'require', max: 1 });
try {
  const rows = await sql`
    SELECT product, year, month, expected_usage, customs_volume, ending_stock, coverage_days, contract_price, contract_date
    FROM inventory
    WHERE product IN ('RBD','RSPO','MANAGED') AND year IN (2025, 2026)
    ORDER BY product, year, month
  `;
  console.log(`inventory rows: ${rows.length}`);
  for (const r of rows) {
    console.log(`  ${r.product} ${r.year}-${String(r.month).padStart(2,'0')}: usage=${r.expected_usage} customs=${r.customs_volume} end=${r.ending_stock} cov=${r.coverage_days} price=${r.contract_price?.slice(0,40)} date=${r.contract_date}`);
  }
} finally { await sql.end({ timeout: 5 }); }
