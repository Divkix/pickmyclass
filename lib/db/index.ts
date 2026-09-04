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

export function getDb(hyperdrive: Hyperdrive): Database {
  const client = postgres(hyperdrive.connectionString, POSTGRES_OPTIONS);
  // SAFETY: drizzle(client, { schema }) returns PostgresJsDatabase whose $client is the postgres-js Sql instance
  return drizzle(client, { schema }) as Database;
}

export function getDbFromEnv(): Database {
  return getDb(env.HYPERDRIVE);
}
