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
import { Pool, type QueryConfig } from "pg";
import { guardPool, type PromiseQuery } from "@/lib/db/guard";
import { errorFields } from "@/lib/log";
import { withSpan } from "@/lib/telemetry/span";
import * as schema from "./schema";

export type Database = NodePgDatabase<typeof schema> & { $client: Pool };

const SQL_OPERATION = /^\s*(\w+)/;

const SQL_PARENS = /\([^()]*\)/g;

const SQL_TABLE = /\b(?:from|into|update)\s+(?:"?public"?\.)?"?(\w+)/i;

const SQL_FUNCTION = /\bpublic\.(\w+)\s*\(/i;

const QUERY_SPAN_ATTRIBUTES = { "db.system.name": "postgresql" } as const;

/** Empties parenthesised groups, innermost first, so subqueries and calls can't name the statement. */
function outerStatement(text: string): string {
  let outer = text;

  for (let depth = 0; depth < 8; depth += 1) {
    const next = outer.replace(SQL_PARENS, "()");

    if (next === outer) break;
    outer = next;
  }

  return outer;
}

/**
 * A low-cardinality span name from the statement's shape, such as
 * `SELECT class_states` or `SELECT record_section_observation`. Bound values
 * live in `values`, so the text never carries them.
 */
export function querySummary(text: string): string {
  const operation = SQL_OPERATION.exec(text)?.[1]?.toUpperCase() ?? "QUERY";
  const outer = outerStatement(text);
  // The outer table, else the SECURITY DEFINER RPC a bare `SELECT public.fn()` calls.
  const name = SQL_TABLE.exec(outer)?.[1] ?? SQL_FUNCTION.exec(outer)?.[1];

  return name ? `${operation} ${name}` : operation;
}

const statementSummary = (config: QueryConfig): string => querySummary(config.text);

/**
 * Hyperdrive's Postgres sockets get no runtime span, so each pool query gets
 * one. Every statement, spanned or not, also runs under the `guardPool`
 * timeout and fails with a typed `DbError`. Transactions run on a checked-out
 * client that is guarded but stays unspanned; the Clerk user-mirror upsert
 * uses them. A failure carries its SQLSTATE,
 * since pg names every server error "error".
 */
function traceQueries(pool: Pool): Pool {
  const query: PromiseQuery = guardPool(pool, statementSummary).query.bind(pool);

  const traced: PromiseQuery = (config, values) =>
    withSpan(querySummary(config.text), QUERY_SPAN_ATTRIBUTES, async (span) => {
      try {
        const result = await query(config, values);
        span.setAttribute("db.response.returned_rows", result.rows.length);

        return result;
      } catch (error) {
        span.setAttributes({ "db.response.status_code": errorFields(error)["error.code"] });
        throw error;
      }
    });

  // SAFETY: Drizzle's node-postgres session only calls the promise form, query(config, values).
  pool.query = traced as Pool["query"];

  return pool;
}

export function getDb(hyperdrive: Hyperdrive): Database {
  const pool = new Pool({
    connectionString: hyperdrive.connectionString,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
  });

  return drizzle({ client: traceQueries(pool), schema });
}

export function getDbFromEnv(): Database {
  return getDb(env.HYPERDRIVE);
}
