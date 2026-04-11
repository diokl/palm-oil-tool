import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL || '';

type Sql = ReturnType<typeof postgres>;

let sqlClient: Sql | null = null;

function getClient(): Sql {
  if (!sqlClient) {
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is not set');
    }
    sqlClient = postgres(DATABASE_URL, {
      // Transaction pooler (port 6543) does not support prepared statements.
      // Disabling prepare makes the driver send each query as a simple query.
      prepare: false,
      ssl: 'require',
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return sqlClient;
}

// Convert SQLite-style `?` positional placeholders to PostgreSQL `$1, $2, ...`.
// Note: this naive regex does NOT handle `?` inside string literals. The current
// codebase does not use such patterns, so this is safe.
function convertPlaceholders(query: string): string {
  let i = 0;
  return query.replace(/\?/g, () => `$${++i}`);
}

// Schema is managed out-of-band via Supabase SQL Editor (see schema.sql).
// Keeping this as a no-op prevents DDL execution on every serverless cold start,
// which previously drained the write quota on Turso.
async function ensureSchema() {
  return;
}

// Store the last INSERT id captured via RETURNING. This is best-effort and
// scoped to the current process instance — callers should not rely on it across
// concurrent requests. The old Turso implementation had the same limitation.
let lastInsertId: number = 0;

export async function getDb(): Promise<Sql> {
  await ensureSchema();
  return getClient();
}

// Helper: run SQL with params (INSERT/UPDATE/DELETE)
export async function dbRun(sql: string, params: any[] = []): Promise<void> {
  await ensureSchema();
  const client = getClient();
  const pgQuery = convertPlaceholders(sql);

  // For plain INSERT statements (without explicit RETURNING or ON CONFLICT
  // DO NOTHING), append `RETURNING id` to capture the generated id for
  // dbLastId(). INSERT ... ON CONFLICT DO NOTHING can return zero rows, so we
  // guard against that.
  const trimmed = pgQuery.trim();
  const isInsert = /^INSERT\s+/i.test(trimmed);
  const hasReturning = /\sRETURNING\s/i.test(trimmed);
  const isIgnoreInsert = /ON\s+CONFLICT[^;]*DO\s+NOTHING/i.test(trimmed);

  if (isInsert && !hasReturning) {
    const withReturning = trimmed.replace(/;?\s*$/, '') + ' RETURNING id';
    try {
      const result = await client.unsafe(withReturning, params);
      if (result.length > 0 && (result[0] as any).id !== undefined && (result[0] as any).id !== null) {
        lastInsertId = Number((result[0] as any).id);
      }
      return;
    } catch (err: any) {
      // Some tables may not have an `id` column, or RETURNING may fail for
      // other reasons. Fall back to a plain execute.
      if (!isIgnoreInsert) {
        console.warn('RETURNING id failed, falling back to plain execute:', err.message);
      }
      await client.unsafe(pgQuery, params);
      return;
    }
  }

  await client.unsafe(pgQuery, params);
}

// Helper: get single row
export async function dbGet(sql: string, params: any[] = []): Promise<any | undefined> {
  await ensureSchema();
  const client = getClient();
  const pgQuery = convertPlaceholders(sql);
  const result = await client.unsafe(pgQuery, params);
  return result.length > 0 ? (result[0] as any) : undefined;
}

// Helper: get all rows
export async function dbAll(sql: string, params: any[] = []): Promise<any[]> {
  await ensureSchema();
  const client = getClient();
  const pgQuery = convertPlaceholders(sql);
  const result = await client.unsafe(pgQuery, params);
  return Array.from(result) as any[];
}

// Helper: execute multiple statements (split by semicolon)
export async function dbExec(sql: string): Promise<void> {
  await ensureSchema();
  const client = getClient();
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const stmt of statements) {
    await client.unsafe(stmt);
  }
}

// Helper: return the most recently inserted id captured by dbRun via RETURNING.
// This mirrors the old SQLite last_insert_rowid() API but is best-effort only.
export async function dbLastId(): Promise<number> {
  return lastInsertId;
}

// Helper: batch run inside a single transaction. All statements succeed or
// none do.
export async function dbBatchRun(operations: { sql: string; params: any[] }[]): Promise<void> {
  await ensureSchema();
  const client = getClient();
  await client.begin(async (tx) => {
    for (const op of operations) {
      const pgQuery = convertPlaceholders(op.sql);
      await tx.unsafe(pgQuery, op.params);
    }
  });
}
