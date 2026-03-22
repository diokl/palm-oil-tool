// Use require() for sql.js to avoid ESM/CJS issues in Next.js webpack
const initSqlJs = require('sql.js');
import type { Database as SqlJsDatabase } from 'sql.js';
import fs from 'fs';
import path from 'path';

// Vercel serverless: filesystem is read-only except /tmp
const isVercel = process.env.VERCEL === '1';
const SOURCE_DB_PATH = path.join(process.cwd(), 'data', 'palm-oil-manager.db');
const DB_PATH = isVercel
  ? path.join('/tmp', 'palm-oil-manager.db')
  : SOURCE_DB_PATH;

let db: SqlJsDatabase | null = null;
let initPromise: Promise<SqlJsDatabase> | null = null;

async function initDb(): Promise<SqlJsDatabase> {
  // Provide explicit WASM path for production builds
  const wasmPath = path.join(process.cwd(), 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');
  const wasmBinary = fs.readFileSync(wasmPath);
  const SQL = await initSqlJs({ wasmBinary });

  // On Vercel: copy bundled DB to /tmp on cold start
  if (isVercel && !fs.existsSync(DB_PATH) && fs.existsSync(SOURCE_DB_PATH)) {
    fs.copyFileSync(SOURCE_DB_PATH, DB_PATH);
  }

  let database: SqlJsDatabase;
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    database = new SQL.Database(buffer);
  } else {
    // Ensure data directory exists
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    database = new SQL.Database();
  }

  // Initialize pragmas
  database.run('PRAGMA journal_mode = WAL');
  database.run('PRAGMA foreign_keys = ON');

  // Initialize schema
  initializeDbSchema(database);

  saveDb(database);
  return database;
}

function initializeDbSchema(database: SqlJsDatabase) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS fcpo_settlement (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      contract_month TEXT NOT NULL,
      settlement_myr REAL,
      settlement_usd REAL,
      exchange_rate REAL,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, contract_month)
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL CHECK(product IN ('RBD', 'RSPO')),
      year INTEGER NOT NULL,
      month INTEGER NOT NULL CHECK(month BETWEEN 1 AND 12),
      expected_usage REAL,
      customs_volume REAL,
      ending_stock REAL,
      coverage_days REAL,
      contract_price TEXT,
      contract_date TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      updated_by TEXT,
      UNIQUE(product, year, month)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      shipment_month TEXT NOT NULL,
      contract_date TEXT,
      contract_price REAL,
      quantity_mt REAL,
      supplier TEXT,
      market_price REAL,
      price_diff REAL,
      prebuy_effect_krw REAL,
      evaluation TEXT CHECK(evaluation IN ('성공', '실패', NULL)),
      product TEXT DEFAULT 'RBD',
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      sentiment TEXT CHECK(sentiment IN ('강세', '약세', '보합')),
      impact TEXT CHECK(impact IN ('High', 'Medium', 'Low')),
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT
    );

    CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_type TEXT DEFAULT 'market',
      input_data TEXT,
      result TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product TEXT NOT NULL,
      alert_level TEXT NOT NULL CHECK(alert_level IN ('critical', 'warning', 'normal')),
      depletion_month TEXT,
      required_volume REAL,
      recommended_shipment TEXT,
      current_price REAL,
      box_range_zone TEXT,
      message TEXT,
      action_taken TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS edit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      edited_by TEXT,
      edited_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_fcpo_date ON fcpo_settlement(date);
    CREATE INDEX IF NOT EXISTS idx_fcpo_month ON fcpo_settlement(contract_month);
    CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product, year, month);
    CREATE INDEX IF NOT EXISTS idx_news_date ON news(date DESC);
    CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active, created_at DESC);
  `);
}

function saveDb(database: SqlJsDatabase) {
  const data = database.export();
  const buffer = Buffer.from(data);
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DB_PATH, buffer);
}

export async function getDb(): Promise<SqlJsDatabase> {
  if (db) return db;
  if (!initPromise) {
    initPromise = initDb().then(database => {
      db = database;
      return database;
    });
  }
  return initPromise;
}

// Helper: run SQL with params (INSERT/UPDATE/DELETE)
export async function dbRun(sql: string, params: any[] = []) {
  const database = await getDb();
  database.run(sql, params);
  saveDb(database);
}

// Helper: get single row
export async function dbGet(sql: string, params: any[] = []): Promise<any | undefined> {
  const database = await getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    stmt.free();
    const row: any = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });
    return row;
  }
  stmt.free();
  return undefined;
}

// Helper: get all rows
export async function dbAll(sql: string, params: any[] = []): Promise<any[]> {
  const database = await getDb();
  const stmt = database.prepare(sql);
  stmt.bind(params);
  const rows: any[] = [];
  while (stmt.step()) {
    const columns = stmt.getColumnNames();
    const values = stmt.get();
    const row: any = {};
    columns.forEach((col, i) => {
      row[col] = values[i];
    });
    rows.push(row);
  }
  stmt.free();
  return rows;
}

// Helper: execute multiple statements
export async function dbExec(sql: string) {
  const database = await getDb();
  database.exec(sql);
  saveDb(database);
}

// Helper: get last insert rowid
export async function dbLastId(): Promise<number> {
  const row = await dbGet('SELECT last_insert_rowid() as id');
  return row?.id ?? 0;
}

// Helper: batch run without saving between each (save once at end)
export async function dbBatchRun(operations: { sql: string; params: any[] }[]) {
  const database = await getDb();
  for (const op of operations) {
    database.run(op.sql, op.params);
  }
  saveDb(database);
}
