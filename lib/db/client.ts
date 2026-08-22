/**
 * Hyperdrive-backed Postgres query seam.
 *
 * Replaces the three Supabase client flavors (`lib/supabase/{client,server,service}.ts`)
 * for all database access. Auth-specific Supabase calls (`supabase.auth.*`) remain in
 * `lib/supabase/{client,server}.ts` until the Clerk auth migration (sibling sub-issue).
 *
 * Architecture:
 * - `pg` (node-postgres) behind a connection string obtained from the Hyperdrive binding.
 * - Per-isolate cached `Pool` (max 5 connections; Hyperdrive transaction-pooling mode).
 * - Parameterized `SELECT * FROM fn($1, ...)` replaces `.rpc()`; raw SQL replaces `.from()`.
 * - `--caching-disabled` Hyperdrive config: query caching has no write invalidation, so
 *   the pipeline's read-modify-write on `class_states` must never serve stale rows.
 *
 * Connection string registration: the worker entry point (worker.ts) calls
 * `setConnectionStringGetter()` with a function that reads `env.PICKMYCLASS_HYPERDRIVE.connectionString`.
 * This avoids importing `cloudflare:workers` at module level, which would break the
 * vinext client-side build (the virtual module only exists in the Workers runtime).
 *
 * Local dev: set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PICKMYCLASS_HYPERDRIVE` env var
 * pointing at a local Postgres instance (e.g. docker).
 *
 * Tests: mock this module via `vi.mock('@/lib/db/client', ...)`.
 */

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/** Connection string provider — registered by the worker entry point. */
let connectionStringGetter: (() => string) | null = null;

/**
 * Register a function that returns the current Hyperdrive connection string.
 * Called once from worker.ts (which has access to `cloudflare:workers` env).
 */
export function setConnectionStringGetter(getter: (() => string) | null): void {
  connectionStringGetter = getter;
  // Reset the cached pool so the next getPool() picks up the new connection string
  if (pool) {
    void pool.end();
    pool = null;
  }
}

/**
 * Get the Postgres connection string from the registered getter or local dev env.
 * Throws if neither is available.
 */
function getConnectionString(): string {
  // Workers runtime: registered getter (set by worker.ts from cloudflare:workers env)
  if (connectionStringGetter) {
    const connStr = connectionStringGetter();
    if (connStr) return connStr;
  }

  // Local dev: wrangler dev bypasses Hyperdrive; use the env var
  const localConnStr =
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PICKMYCLASS_HYPERDRIVE ||
    process.env.DATABASE_URL;
  if (localConnStr) {
    return localConnStr;
  }

  throw new Error(
    'No database connection string available. Call setConnectionStringGetter() from ' +
      'the worker entry point, or set CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PICKMYCLASS_HYPERDRIVE ' +
      'env var for local dev.'
  );
}

/** Cached per-isolate pool. Module scope persists across requests in the same isolate. */
let pool: Pool | null = null;

/**
 * Get the cached pg Pool, creating it on first use.
 *
 * Pool config: max 5 connections (Hyperdrive Paid plan ~100 origin conns, but
 * per-isolate 5 keeps us well under the global limit), prepared statements ON
 * for cacheability.
 */
function getPool(): Pool {
  if (pool) return pool;

  const connectionString = getConnectionString();
  pool = new Pool({
    connectionString,
    max: 5,
  });
  return pool;
}

/**
 * Execute a parameterized SQL query and return typed rows.
 *
 * @example
 * const rows = await query<UserRow>('SELECT id, email FROM users WHERE id = $1', [userId]);
 *
 * @returns Array of typed rows (empty array if no results).
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const p = getPool();
  // SAFETY: pg's query accepts unknown[] for params; the never[] cast satisfies the type checker for the pooled query method
  const result: QueryResult<T> = await p.query<T>(text, params as never[]);
  return result.rows;
}

/**
 * Execute a parameterized SQL query and return the first row or null.
 */
export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * Execute a parameterized SQL query that returns a single scalar value.
 */
export async function queryScalar<T = unknown>(text: string, params?: unknown[]): Promise<T> {
  const row = await queryOne<Record<string, T>>(text, params);
  if (!row) {
    // eslint-disable-next-line anti-slop/no-chained-type-assertions -- SAFETY: no rows → undefined; cast through unknown to satisfy the T return type
    return undefined as unknown as T;
  }
  const values = Object.values(row);
  // SAFETY: scalar query returns a single column; values[0] is the scalar result
  return values[0] as T;
}

/**
 * Execute a statement that does not return rows (INSERT/UPDATE/DELETE).
 *
 * @returns Number of affected rows.
 */
export async function execute(text: string, params?: unknown[]): Promise<number> {
  const p = getPool();
  // SAFETY: pg's query accepts unknown[] for params; the never[] cast satisfies the type checker
  const result = await p.query(text, params as never[]);
  return result.rowCount ?? 0;
}

/**
 * Call a PostgreSQL function (replaces `.rpc()`) and return typed rows.
 *
 * Uses parameterized `SELECT * FROM fn($1, $2, ...)`.
 */
export async function callFunction<T extends QueryResultRow = QueryResultRow>(
  functionName: string,
  params?: unknown[]
): Promise<T[]> {
  const placeholders = params ? params.map((_, i) => `$${i + 1}`).join(', ') : '';
  const text = `SELECT * FROM ${functionName}(${placeholders})`;
  return query<T>(text, params);
}

/**
 * Call a PostgreSQL function that returns a single scalar value.
 */
export async function callFunctionScalar<T = unknown>(
  functionName: string,
  params?: unknown[]
): Promise<T> {
  const placeholders = params ? params.map((_, i) => `$${i + 1}`).join(', ') : '';
  const text = `SELECT ${functionName}(${placeholders}) AS result`;
  return queryScalar<T>(text, params);
}

/**
 * Acquire a dedicated client from the pool for multi-statement sequences.
 * Must be released by the caller (use try/finally).
 */
export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}
