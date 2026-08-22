/**
 * Hyperdrive-backed Postgres query seam.
 *
 * Replaces the three Supabase client flavors (`lib/supabase/{client,server,service}.ts`)
 * for all database access. Auth-specific Supabase calls (`supabase.auth.*`) remain in
 * `lib/supabase/{client,server}.ts` until the Clerk auth migration (sibling sub-issue).
 *
 * Architecture:
 * - `pg` (node-postgres) behind `env.HYPERDRIVE.connectionString` (Cloudflare Hyperdrive).
 * - Per-isolate cached `Pool` (max 5 connections; Hyperdrive transaction-pooling mode).
 * - Parameterized `SELECT * FROM fn($1, ...)` replaces `.rpc()`; raw SQL replaces `.from()`.
 * - `--caching-disabled` Hyperdrive config: query caching has no write invalidation, so
 *   the pipeline's read-modify-write on `class_states` must never serve stale rows.
 *
 * Local dev: set `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE` env var
 * pointing at a local Postgres instance (e.g. docker). `wrangler dev` bypasses
 * Hyperdrive and uses this env var directly.
 *
 * Tests: `cloudflare:workers` is mocked in `vitest.config.ts`; individual tests override
 * `env` via `vi.mock` to inject a mock Hyperdrive binding.
 */

import { env } from 'cloudflare:workers';
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * Hyperdrive binding shape — provides a connectionString that points at the
 * local Hyperdrive proxy inside the Workers runtime.
 */
interface HyperdriveBinding {
  connectionString: string;
}

/**
 * Get the Postgres connection string from the Hyperdrive binding or local dev env.
 * Throws if neither is available.
 */
function getConnectionString(): string {
  // Workers runtime: Hyperdrive binding
  // eslint-disable-next-line anti-slop/no-known-value-widening, anti-slop/no-chained-type-assertions -- SAFETY: cloudflare:workers env is opaque at compile time; widen through unknown to access bindings
  const envRecord = env as unknown as Record<string, unknown>;
  // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: Hyperdrive binding is defined in wrangler.jsonc
  const hyperdrive = envRecord.PICKMYCLASS_HYPERDRIVE as HyperdriveBinding | undefined;
  if (hyperdrive?.connectionString) {
    return hyperdrive.connectionString;
  }

  // Local dev: wrangler dev bypasses Hyperdrive; use the env var
  const localConnStr =
    process.env.CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PICKMYCLASS_HYPERDRIVE ||
    process.env.DATABASE_URL;
  if (localConnStr) {
    return localConnStr;
  }

  throw new Error(
    'No database connection string available. Set PICKMYCLASS_HYPERDRIVE binding in wrangler.jsonc ' +
      'or CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_PICKMYCLASS_HYPERDRIVE env var for local dev.'
  );
}

/** Cached per-isolate pool. Module scope persists across requests in the same isolate. */
let pool: Pool | null = null;

/**
 * Get the cached pg Pool, creating it on first use.
 *
 * Pool config: max 5 connections (Hyperdrive Paid plan ~100 origin conns, but
 * per-isolate 5 keeps us well under the global limit), prepared statements ON
 * for cacheability, `fetch_types: false` equivalent via pg defaults.
 */
export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = getConnectionString();
  pool = new Pool({
    connectionString,
    max: 5,
    // Keep prepared statements ON for Hyperdrive cacheability.
    // pg uses named prepared statements by default which work with PgBouncer's
    // transaction mode when max_prepared_statements is configured.
  });
  return pool;
}

/** Reset the cached pool. Exposed for test isolation. */
export function _resetPool(): void {
  if (pool) {
    void pool.end();
    pool = null;
  }
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
 *
 * @example
 * const profile = await queryOne<UserProfileRow>(
 *   'SELECT * FROM user_profiles WHERE user_id = $1',
 *   [userId]
 * );
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
 *
 * @example
 * const count = await queryScalar<number>('SELECT COUNT(*) FROM class_watches');
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
 *
 * @example
 * const watchers = await callFunction<ClassWatcherRpcRow>(
 *   'get_class_watchers',
 *   [ref.class_nbr, ref.term]
 * );
 */
export async function callFunction<T extends QueryResultRow = QueryResultRow>(
  functionName: string,
  params?: unknown[]
): Promise<T[]> {
  // Build parameterized placeholders: $1, $2, ...
  const placeholders = params ? params.map((_, i) => `$${i + 1}`).join(', ') : '';
  const text = `SELECT * FROM ${functionName}(${placeholders})`;
  return query<T>(text, params);
}

/**
 * Call a PostgreSQL function that returns a single scalar value.
 *
 * @example
 * const count = await callFunctionScalar<number>('count_all_users');
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
 *
 * @example
 * const client = await getClient();
 * try {
 *   await client.query('BEGIN');
 *   await client.query('INSERT ...', [...]);
 *   await client.query('COMMIT');
 * } finally {
 *   client.release();
 * }
 */
export async function getClient(): Promise<PoolClient> {
  const p = getPool();
  return p.connect();
}
