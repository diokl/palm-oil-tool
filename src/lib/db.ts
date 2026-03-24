import { createClient, type Client, type InArgs } from '@libsql/client';

const TURSO_URL = process.env.TURSO_DATABASE_URL || '';
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || '';

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    if (!TURSO_URL) {
      throw new Error('TURSO_DATABASE_URL environment variable is not set');
    }
    client = createClient({
      url: TURSO_URL,
      authToken: TURSO_TOKEN,
    });
  }
  return client;
}

async function initializeDbSchema() {
  const db = getClient();

  const statements = [
    `CREATE TABLE IF NOT EXISTS fcpo_settlement (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      contract_month TEXT NOT NULL,
      settlement_myr REAL,
      settlement_usd REAL,
      exchange_rate REAL,
      source TEXT DEFAULT 'manual',
      created_at TEXT DEFAULT (datetime('now')),
      UNIQUE(date, contract_month)
    )`,
    `CREATE TABLE IF NOT EXISTS inventory (
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
    )`,
    `CREATE TABLE IF NOT EXISTS purchases (
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
    )`,
    `CREATE TABLE IF NOT EXISTS news (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT NOT NULL,
      content TEXT NOT NULL,
      sentiment TEXT CHECK(sentiment IN ('강세', '약세', '보합')),
      impact TEXT CHECK(impact IN ('High', 'Medium', 'Low')),
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS analyses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      analysis_type TEXT DEFAULT 'market',
      input_data TEXT,
      result TEXT,
      model TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE TABLE IF NOT EXISTS alerts (
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
    )`,
    `CREATE TABLE IF NOT EXISTS edit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id INTEGER,
      field_name TEXT,
      old_value TEXT,
      new_value TEXT,
      edited_by TEXT,
      edited_at TEXT DEFAULT (datetime('now'))
    )`,
    `CREATE INDEX IF NOT EXISTS idx_fcpo_date ON fcpo_settlement(date)`,
    `CREATE INDEX IF NOT EXISTS idx_fcpo_month ON fcpo_settlement(contract_month)`,
    `CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory(product, year, month)`,
    `CREATE INDEX IF NOT EXISTS idx_news_date ON news(date DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_active ON alerts(is_active, created_at DESC)`,
  ];

  await db.batch(statements.map(sql => ({ sql, args: [] })));
}

let schemaInitialized = false;
let schemaPromise: Promise<void> | null = null;

async function ensureSchema() {
  if (schemaInitialized) return;
  if (!schemaPromise) {
    schemaPromise = initializeDbSchema().then(() => {
      schemaInitialized = true;
    }).catch((err) => {
      // If writes are blocked (e.g. Turso free tier limit), tables likely already exist
      console.warn('Schema init skipped (tables may already exist):', err.message);
      schemaInitialized = true;
      schemaPromise = null;
    });
  }
  return schemaPromise;
}

// Keep getDb for backward compatibility (returns the client)
export async function getDb(): Promise<Client> {
  await ensureSchema();
  return getClient();
}

// Helper: run SQL with params (INSERT/UPDATE/DELETE)
export async function dbRun(sql: string, params: any[] = []) {
  await ensureSchema();
  const db = getClient();
  await db.execute({ sql, args: params as InArgs });
}

// Helper: get single row
export async function dbGet(sql: string, params: any[] = []): Promise<any | undefined> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql, args: params as InArgs });
  if (result.rows.length === 0) return undefined;
  // Convert Row to plain object
  const row = result.rows[0];
  const obj: any = {};
  for (const col of result.columns) {
    obj[col] = row[col];
  }
  return obj;
}

// Helper: get all rows
export async function dbAll(sql: string, params: any[] = []): Promise<any[]> {
  await ensureSchema();
  const db = getClient();
  const result = await db.execute({ sql, args: params as InArgs });
  return result.rows.map(row => {
    const obj: any = {};
    for (const col of result.columns) {
      obj[col] = row[col];
    }
    return obj;
  });
}

// Helper: execute multiple statements (split by semicolon)
export async function dbExec(sql: string) {
  await ensureSchema();
  const db = getClient();
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  if (statements.length === 1) {
    await db.execute(statements[0]);
  } else {
    await db.batch(statements.map(s => ({ sql: s, args: [] })));
  }
}

// Helper: get last insert rowid
export async function dbLastId(): Promise<number> {
  const row = await dbGet('SELECT last_insert_rowid() as id');
  return row?.id ?? 0;
}

// Helper: batch run without saving between each
export async function dbBatchRun(operations: { sql: string; params: any[] }[]) {
  await ensureSchema();
  const db = getClient();
  await db.batch(operations.map(op => ({ sql: op.sql, args: op.params as InArgs })));
}
