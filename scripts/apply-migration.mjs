#!/usr/bin/env node
// One-shot migration runner for Supabase.
// Usage:
//   node scripts/apply-migration.mjs [--dry-run]
//
// Applies:
//   1. sql/add_managed_product.sql      → inventory/purchases CHECK 확장 + MANAGED inventory 12개월 seed
//   2. sql/add_inflection_points.sql    → inflection_points 테이블 신설
//
// Reads DATABASE_URL from .env.migration.local.
// Each file runs in its own transaction; failure rolls back that file only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ── load .env.migration.local manually ──
const envPath = path.join(projectRoot, '.env.migration.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const k = trimmed.slice(0, eq).trim();
    const v = trimmed.slice(eq + 1).trim();
    if (!(k in process.env)) process.env[k] = v;
  }
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set');
  process.exit(1);
}

const DRY_RUN = process.argv.includes('--dry-run');

const sql = postgres(DATABASE_URL, {
  prepare: false,
  ssl: 'require',
  max: 2,
  idle_timeout: 5,
  connect_timeout: 10,
});

const MIGRATIONS = [
  'sql/add_managed_product.sql',
  'sql/add_inflection_points.sql',
];

function maskUrl(url) {
  return url.replace(/:([^@/]+)@/, ':***@');
}

console.log('────────────────────────────────────────────────────────');
console.log(`Target DB : ${maskUrl(DATABASE_URL)}`);
console.log(`Mode      : ${DRY_RUN ? 'DRY-RUN (rollback after applying)' : 'APPLY (commit)'}`);
console.log('────────────────────────────────────────────────────────\n');

// ── pre-state inspection ──
async function showSchemaState(label) {
  console.log(`[${label}] schema state:`);

  const invCheck = await sql`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'inventory' AND c.contype = 'c'
  `;
  console.log(`  inventory CHECKs:`);
  for (const r of invCheck) console.log(`    ${r.def}`);

  const purCheck = await sql`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'purchases' AND c.contype = 'c'
  `;
  console.log(`  purchases CHECKs:`);
  for (const r of purCheck) console.log(`    ${r.def}`);

  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('inflection_points', 'inventory', 'purchases')
    ORDER BY table_name
  `;
  console.log(`  relevant tables present: ${tables.map(t => t.table_name).join(', ')}`);

  const managedRows = await sql`
    SELECT COUNT(*)::int AS cnt FROM inventory WHERE product = 'MANAGED'
  `.catch(() => [{ cnt: 'n/a (CHECK rejects)' }]);
  console.log(`  inventory MANAGED rows: ${managedRows[0].cnt}`);

  const infCount = await sql`
    SELECT COUNT(*)::int AS cnt
    FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'inflection_points'
  `;
  console.log(`  inflection_points exists: ${infCount[0].cnt > 0 ? 'YES' : 'NO'}`);
  console.log('');
}

async function applyFile(relPath) {
  const fullPath = path.join(projectRoot, relPath);
  const content = fs.readFileSync(fullPath, 'utf8');
  console.log(`▶ Applying ${relPath} (${content.length} bytes)...`);

  await sql.begin(async (tx) => {
    await tx.unsafe(content);
    if (DRY_RUN) {
      throw new Error('__DRY_RUN_ROLLBACK__');
    }
  }).catch((err) => {
    if (DRY_RUN && err.message === '__DRY_RUN_ROLLBACK__') {
      console.log(`  ✓ Dry-run OK — rolled back`);
      return;
    }
    throw err;
  });

  if (!DRY_RUN) console.log(`  ✓ Committed`);
  console.log('');
}

try {
  await showSchemaState('BEFORE');
  for (const file of MIGRATIONS) {
    await applyFile(file);
  }
  await showSchemaState('AFTER');
  console.log('────────────────────────────────────────────────────────');
  console.log(DRY_RUN ? 'DRY-RUN complete (no changes persisted)' : 'Migration applied successfully');
  console.log('────────────────────────────────────────────────────────');
} catch (err) {
  console.error('\n✗ Migration FAILED:', err.message);
  if (err.code) console.error(`  PG error code: ${err.code}`);
  if (err.detail) console.error(`  detail: ${err.detail}`);
  if (err.hint) console.error(`  hint: ${err.hint}`);
  process.exit(1);
} finally {
  await sql.end({ timeout: 5 });
}
