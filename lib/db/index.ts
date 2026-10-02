/**
 * Drizzle over node-postgres behind Cloudflare Hyperdrive.
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
import { env } from "cloudflare:workers";
import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

export function getDb(hyperdrive: Hyperdrive): Database {
  return drizzle({
    client: new Pool({
      connectionString: hyperdrive.connectionString,
      max: 5,
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 20_000,
    }),
    schema,
  });
}

export function getDbFromEnv(): Database {
  return getDb(env.HYPERDRIVE);
}
