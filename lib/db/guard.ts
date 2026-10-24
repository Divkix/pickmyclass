/**
 * Puts every statement a request sends under an explicit timeout with typed
 * failures. Applied once, in `getDb`, to the pool and to the clients it hands
 * out for transactions, so no query helper opts in or out.
 *
 * Client-side only: the abandoned statement keeps running until the server
 * finishes it or the invocation ends. Hyperdrive's handling of a
 * `statement_timeout` startup parameter is undocumented, so none is sent.
 *
 * @module lib/db/guard
 */
import { Effect } from "effect";
import type { Pool, PoolClient, QueryConfig, QueryResult } from "pg";
import { DB_QUERY_TIMEOUT_MS } from "@/lib/config";
import { DbQueryFailed, DbQueryTimedOut } from "@/lib/db/errors";
import { getPgError, isTransientDbFailure } from "@/lib/db/pg-errors";
import { externalCall } from "@/lib/effect/external-call";

export type PromiseQuery = (
  config: QueryConfig,
  values?: QueryConfig["values"],
) => Promise<QueryResult>;

/** `operation` is the low-cardinality statement summary, never bound values. */
export function guardQuery(
  query: PromiseQuery,
  operation: (config: QueryConfig) => string,
  timeoutMs = DB_QUERY_TIMEOUT_MS,
): PromiseQuery {
  return (config, values) => {
    const name = operation(config);

    return Effect.runPromise(
      externalCall(
        () => query(config, values),
        timeoutMs,
        (error) =>
          new DbQueryFailed({
            message: error.message,
            operation: name,
            code: getPgError(error)?.code,
            retryable: isTransientDbFailure(error),
            cause: error,
          }),
        () =>
          new DbQueryTimedOut({
            message: `Database statement timed out after ${timeoutMs}ms: ${name}`,
            operation: name,
            timeoutMs,
            retryable: true,
          }),
      ),
    );
  };
}

/**
 * Guards `client.query` for one checkout. The pool reuses the connection, and
 * `pool.query` calls it with `query(text, values, callback)`, so the original
 * must be back in place when the connection is released.
 *
 * A timed-out statement keeps running on the connection (and may hold its
 * transaction open), so that checkout releases with an error: pg-pool then
 * destroys the connection instead of handing it to the next borrower.
 */
function guardClient(
  client: PoolClient,
  operation: (config: QueryConfig) => string,
  timeoutMs: number,
): PoolClient {
  const release = client.release.bind(client);
  // SAFETY: Drizzle's node-postgres session only calls the promise form, query(config, values).
  const query: PromiseQuery = client.query.bind(client) as PromiseQuery;
  const guarded = guardQuery(query, operation, timeoutMs);
  let timedOut: DbQueryTimedOut | undefined;

  const tracked: PromiseQuery = (config, values) =>
    guarded(config, values).catch((error: Error) => {
      if (error instanceof DbQueryTimedOut) timedOut = error;
      throw error;
    });

  // SAFETY: the guarded function has the same promise-form signature it replaces.
  client.query = tracked as PoolClient["query"];
  client.release = (error) => {
    // `query` is a prototype method: dropping the own property restores it.
    Reflect.deleteProperty(client, "query");
    client.release = release;
    release(error || timedOut);
  };

  return client;
}

type ConnectCallback = Parameters<Pool["connect"]>[0];

/**
 * Guards the pool's own queries and the connections it checks out for
 * transactions. `pg-pool` runs `pool.query` through `this.connect(callback)`, so
 * the callback form must reach the original untouched: only the promise form,
 * which Drizzle calls to open a transaction, hands back a guarded client.
 */
export function guardPool(
  pool: Pool,
  operation: (config: QueryConfig) => string,
  timeoutMs = DB_QUERY_TIMEOUT_MS,
): Pool {
  // SAFETY: pg-pool's connect() returns Promise<PoolClient> when called without a callback.
  const connectClient = pool.connect.bind(pool) as () => Promise<PoolClient>;
  // SAFETY: with a callback argument pg-pool's connect() returns void.
  const connectWithCallback = pool.connect.bind(pool) as (callback: ConnectCallback) => void;
  // SAFETY: Drizzle's node-postgres session only calls the promise form, query(config, values).
  const query: PromiseQuery = pool.query.bind(pool) as PromiseQuery;

  // SAFETY: the guarded function has the same promise-form signature it replaces.
  pool.query = guardQuery(query, operation, timeoutMs) as Pool["query"];

  // SAFETY: the replacement serves both overloads: the callback form forwards, the promise form guards.
  pool.connect = ((callback?: ConnectCallback) =>
    callback
      ? connectWithCallback(callback)
      : connectClient().then((client) =>
          guardClient(client, operation, timeoutMs),
        )) as Pool["connect"];

  return pool;
}
