#!/usr/bin/env node
// Seed news table from RAW!B9:I52 of the 6월 선적 검토 엑셀.
// Each row of the daily price table becomes one news entry:
//   date         ← B column (3/16(월) → 2026-03-16)
//   content      ← I column (주요이슈 — keep marker prefix intact)
//   sentiment    ← from marker (▲/▲▲ → 강세, ▼/▼▼ → 약세, ● → 보합)
//   impact       ← double marker (▲▲/▼▼) → High, single (▲/▼) → Medium, ● → Low
//   created_by   ← 'excel_seed_RAW_B9_I52'  (so it can be bulk-deleted later)
//
// Existing rows with the same (date, created_by) are SKIPPED — re-running is idempotent.
//
// Usage:
//   node scripts/seed-news-from-excel.mjs --dry-run   # show what would be inserted
//   node scripts/seed-news-from-excel.mjs             # actually insert

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import XLSX from 'xlsx';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── load DATABASE_URL ──
const envPath = path.join(projectRoot, '.env.migration.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq < 0) continue;
    const k = t.slice(0, eq).trim();
    const v = t.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in .env.migration.local');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');
const SOURCE_TAG = 'excel_seed_RAW_B9_I52';
const EXCEL_PATH = process.argv.find(a => a.endsWith('.xlsx')) ||
  path.resolve('C:/Users/PC/OneDrive/Desktop/업무/팜유 26년 6월 선적 관리팜유 구매검토_V.1.0.xlsx');

if (!fs.existsSync(EXCEL_PATH)) {
  console.error(`ERROR: Excel file not found: ${EXCEL_PATH}`);
  process.exit(1);
}

// ── parse marker → sentiment / impact ──
// RAW!I열 첫 글자가 ▲/▲▲/▼/▼▼/● 인 패턴.
function parseMarker(text) {
  if (!text) return { sentiment: '보합', impact: 'Low' };
  const trimmed = String(text).trim();
  if (trimmed.startsWith('▲▲')) return { sentiment: '강세', impact: 'High' };
  if (trimmed.startsWith('▼▼')) return { sentiment: '약세', impact: 'High' };
  if (trimmed.startsWith('▲'))  return { sentiment: '강세', impact: 'Medium' };
  if (trimmed.startsWith('▼'))  return { sentiment: '약세', impact: 'Medium' };
  if (trimmed.startsWith('●'))  return { sentiment: '보합', impact: 'Low' };
  return { sentiment: '보합', impact: 'Low' };
}

// '3/16(월)' → 2026-03-16. 컨텍스트(6월 선적 검토)상 모두 2026년이라 가정.
function parseDate(label) {
  const m = String(label).match(/^(\d{1,2})\/(\d{1,2})/);
  if (!m) return null;
  const mo = String(parseInt(m[1], 10)).padStart(2, '0');
  const d = String(parseInt(m[2], 10)).padStart(2, '0');
  return `2026-${mo}-${d}`;
}

// ── extract RAW!B9:I52 ──
console.log(`Reading ${EXCEL_PATH}`);
const wb = XLSX.readFile(EXCEL_PATH);
const ws = wb.Sheets['RAW'];
if (!ws) {
  console.error('ERROR: RAW sheet not found');
  process.exit(1);
}

// Use cell-by-cell access; rows 9..52, col B (date) and col I (issue)
const rows = [];
for (let r = 9; r <= 52; r++) {
  const dateCell = ws[`B${r}`];
  const issueCell = ws[`I${r}`];
  if (!dateCell || !issueCell) continue;
  const dateLabel = dateCell.v;
  const content = String(issueCell.v ?? '').trim();
  if (!content) continue;
  const date = parseDate(dateLabel);
  if (!date) {
    console.warn(`  ⚠ skipping unparseable date at B${r}: ${dateLabel}`);
    continue;
  }
  const { sentiment, impact } = parseMarker(content);
  rows.push({ row: r, date, content, sentiment, impact });
}

console.log(`\nExtracted ${rows.length} news rows (RAW!B9:I52).\n`);
console.log('Preview (first 5):');
for (const r of rows.slice(0, 5)) {
  console.log(`  B${r.row} ${r.date} [${r.sentiment}/${r.impact}] ${r.content.slice(0, 80).replace(/\n/g, ' ')}...`);
}
console.log('');

// Tally by sentiment for sanity-check
const tally = rows.reduce((acc, r) => { acc[r.sentiment] = (acc[r.sentiment] || 0) + 1; return acc; }, {});
const impactTally = rows.reduce((acc, r) => { acc[r.impact] = (acc[r.impact] || 0) + 1; return acc; }, {});
console.log(`Sentiment distribution: ${JSON.stringify(tally)}`);
console.log(`Impact distribution:    ${JSON.stringify(impactTally)}\n`);

if (DRY_RUN) {
  console.log('--- DRY-RUN: not inserting. Re-run without --dry-run to apply. ---');
  process.exit(0);
}

// ── INSERT into news ──
const sql = postgres(DATABASE_URL, {
  prepare: false, ssl: 'require', max: 2, idle_timeout: 5, connect_timeout: 10,
});

try {
  // Idempotency: skip rows that already exist under the same source tag and date.
  // Some news rows could legitimately have the same date (e.g. user added their own
  // news that day), so we key the dedup on (date, created_by, content prefix) — if
  // a row was previously inserted by this seed for that date with the same first 30
  // chars, treat as duplicate.
  let inserted = 0, skipped = 0;

  await sql.begin(async (tx) => {
    for (const r of rows) {
      const existing = await tx`
        SELECT 1 FROM news
        WHERE date = ${r.date}
          AND created_by = ${SOURCE_TAG}
          AND substring(content, 1, 30) = ${r.content.slice(0, 30)}
        LIMIT 1
      `;
      if (existing.length > 0) {
        skipped++;
        continue;
      }
      await tx`
        INSERT INTO news (date, content, full_content, sentiment, impact, created_by)
        VALUES (${r.date}, ${r.content}, ${r.content}, ${r.sentiment}, ${r.impact}, ${SOURCE_TAG})
      `;
      inserted++;
    }
  });

  console.log('────────────────────────────────────────');
  console.log(`Inserted : ${inserted}`);
  console.log(`Skipped  : ${skipped} (already present under tag '${SOURCE_TAG}')`);
  console.log('────────────────────────────────────────');

  // Verify
  const totalForTag = await sql`SELECT COUNT(*)::int AS c FROM news WHERE created_by = ${SOURCE_TAG}`;
  console.log(`Total rows under tag '${SOURCE_TAG}': ${totalForTag[0].c}`);
} catch (err) {
  console.error('\n✗ Seed FAILED:', err.message);
  if (err.code) console.error(`  PG code: ${err.code}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
