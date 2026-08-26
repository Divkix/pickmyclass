/**
 * Drizzle over Postgres.js behind Cloudflare Hyperdrive.
 *
 * **Server-only module** — it imports `cloudflare:workers`, which never
 * resolves in a browser bundle, so a stray client import fails at build time.
 *
 * Each request/page/queue/scheduled entry point creates ONE handle here and
 * passes it to lower helpers; lower layers never read a connection string
 * themselves. Never cache the returned database or `$client` across requests:
 * Workers reclaim invocation-scoped sockets, so a cached client fails
 * immediately on a later invocation. Hyperdrive owns the reusable origin pool.
 *
 * @module lib/db/index
 */
import { env } from 'cloudflare:workers';
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

/**
 * Drizzle Postgres instance typed with the canonical schema.
 * The `$client` property exposes the raw postgres-js Sql instance for direct
 * SQL (e.g. SECURITY DEFINER RPCs and conditional inserts keyed on PostgreSQL
 * SQLSTATE codes).
 */
export type Database = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

/**
 * Postgres-JS options tuned for Hyperdrive (see Cloudflare + Drizzle docs).
 * - prepare: false — Hyperdrive does not support prepared statements at the
 *   protocol edge, so postgres-js must inline parameters.
 * - fetch_types: false — skips round-tripping type catalog OIDs; Drizzle maps
 *   types from its own schema definitions instead.
 * - Small pooled-connection cap: each Worker isolate gets its own pool, and
 *   PlanetScale/PG maxes out quickly if isolates open large pools.
 */
const POSTGRES_OPTIONS = {
  prepare: false,
  fetch_types: false,
  max: 5,
  idle_timeout: 20,
  connect_timeout: 10,
} as const;

/**
 * Returns a new Drizzle Postgres database instance for the current invocation.
 *
 * **This is the canonical accessor** — do not construct `postgres()` /
 * `drizzle()` directly. Multi-statement atomicity uses
 * `db.transaction(async (tx) => ...)`.
 *
 * @param hyperdrive - The HYPERDRIVE binding from the Workers environment.
 * @returns A typed Drizzle database instance over the PG schema.
 */
export function getDb(hyperdrive: Hyperdrive): Database {
  const client = postgres(hyperdrive.connectionString, POSTGRES_OPTIONS);
  // SAFETY: drizzle(client, { schema }) returns PostgresJsDatabase whose runtime
  // $client is the postgres-js Sql instance; the Database type adds that explicitly.
  return drizzle(client, { schema }) as Database;
}

/** Returns a request-scoped Drizzle handle from the Workers environment. */
export function getDbFromEnv(): Database {
  return getDb(env.HYPERDRIVE);
}
