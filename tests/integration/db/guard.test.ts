import { Client, Pool, type PoolClient, type QueryConfig, type QueryResult } from "pg";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { DbQueryFailed, DbQueryTimedOut } from "@/lib/db/errors";
import { guardPool, guardQuery, type PromiseQuery } from "@/lib/db/guard";
import {
  PG_UNIQUE_VIOLATION,
  getPgError,
  isTransientDbFailure,
  isUniqueViolation,
} from "@/lib/db/pg-errors";

const operation = (config: QueryConfig) => `op:${config.text}`;

const result: QueryResult = {
  command: "SELECT",
  rowCount: 1,
  oid: 0,
  fields: [],
  rows: [{ a: 1 }],
};

/** A node-postgres server error: `name` is "error" and the SQLSTATE sits on `code`. */
function serverError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

const caught = async (run: Promise<unknown>) =>
  run.then(
    () => undefined,
    (error: Error) => error,
  );

describe("guardQuery", () => {
  it("passes the result of a statement that finishes in time", async () => {
    const query: PromiseQuery = () => Promise.resolve(result);

    await expect(guardQuery(query, operation, 1_000)({ text: "select 1" })).resolves.toBe(result);
  });

  it("forwards the config and values untouched", async () => {
    const seen: unknown[] = [];

    const query: PromiseQuery = (config, values) => {
      seen.push(config, values);

      return Promise.resolve(result);
    };

    await guardQuery(query, operation, 1_000)({ text: "select $1", name: "stmt" }, [7]);

    expect(seen).toEqual([{ text: "select $1", name: "stmt" }, [7]]);
  });

  it("fails a statement that outlives the timeout with a retryable DbQueryTimedOut", async () => {
    const query: PromiseQuery = () => new Promise<QueryResult>(() => {});
    const error = await caught(guardQuery(query, operation, 20)({ text: "select slow" }));

    expect(error).toBeInstanceOf(DbQueryTimedOut);
    expect(error).toMatchObject({
      operation: "op:select slow",
      timeoutMs: 20,
      retryable: true,
    });
  });

  it("keeps the SQLSTATE and message so existing error helpers still read them", async () => {
    const query: PromiseQuery = () =>
      Promise.reject(serverError(PG_UNIQUE_VIOLATION, "duplicate key value violates unique"));

    const error = await caught(guardQuery(query, operation, 1_000)({ text: "insert" }));

    expect(error).toBeInstanceOf(DbQueryFailed);
    expect(error).toMatchObject({ code: PG_UNIQUE_VIOLATION, retryable: false });
    expect(error?.message).toBe("duplicate key value violates unique");
    expect(getPgError(error)?.code).toBe(PG_UNIQUE_VIOLATION);
    expect(isUniqueViolation(error)).toBe(true);
  });

  it("marks a dropped connection (no SQLSTATE) retryable", async () => {
    const query: PromiseQuery = () => Promise.reject(new Error("Connection terminated"));
    const error = await caught(guardQuery(query, operation, 1_000)({ text: "select 1" }));

    expect(error).toBeInstanceOf(DbQueryFailed);
    expect(error).toMatchObject({ code: undefined, retryable: true });
  });
});

describe("isTransientDbFailure", () => {
  it.each([
    ["connection exception", "08006", true],
    ["failover shutdown", "57P01", true],
    ["serialization failure", "40001", true],
    ["deadlock", "40P01", true],
    ["out of memory", "53200", true],
    ["socket reset", "ECONNRESET", true],
    ["connection refused", "ECONNREFUSED", true],
    ["unique violation", "23505", false],
    ["undefined function", "42883", false],
    ["raised exception", "P0001", false],
  ])("%s (%s)", (_label, code, expected) => {
    expect(isTransientDbFailure(serverError(code, "x"))).toBe(expected);
  });
});

describe("guardPool", () => {
  afterEach(() => vi.restoreAllMocks());

  // A Client that never connected queues its statements forever, which is a hung query.
  const hungClient = () => Object.assign(new Client(), { release: () => {} });

  it("hands a checked-out transaction connection a guarded query", async () => {
    const client = hungClient();
    vi.spyOn(Pool.prototype, "connect").mockImplementation(() => Promise.resolve(client));
    const pool = guardPool(new Pool(), operation, 20);
    const checkedOut = await pool.connect();
    const error = await caught(checkedOut.query({ text: "begin" }));

    expect(error).toBeInstanceOf(DbQueryTimedOut);
  });

  it("restores the connection's own query on release, because the pool reuses it", async () => {
    const client = hungClient();
    const original = client.query;
    const release = vi.fn();
    client.release = release;
    vi.spyOn(Pool.prototype, "connect").mockImplementation(() => Promise.resolve(client));
    const pool = guardPool(new Pool(), operation, 20);
    const checkedOut = await pool.connect();

    expect(checkedOut.query).not.toBe(original);

    checkedOut.release();

    expect(checkedOut.query).toBe(original);
    expect(release).toHaveBeenCalledOnce();
  });

  it("leaves the callback form untouched, which pg-pool's own query() depends on", () => {
    const client = hungClient();
    const release = vi.fn();

    // SAFETY: the stub serves only the callback overload this test calls.
    vi.spyOn(Pool.prototype, "connect").mockImplementation(((
      callback: (error: Error | undefined, client: PoolClient, done: () => void) => void,
    ) => callback(undefined, client, release)) as Pool["connect"]);

    const pool = guardPool(new Pool(), operation, 20);
    const received: Array<PoolClient | undefined> = [];

    pool.connect((_error, connected) => {
      received.push(connected);
    });

    // The raw client, not a guarded copy: guarding it would double-wrap pool.query's statements.
    expect(received).toEqual([client]);
  });

  it("guards pool.query itself", async () => {
    const pool = new Pool();
    // SAFETY: the guarded code only calls the promise form, query(config, values).
    const hang = (() => new Promise(() => {})) as Pool["query"];
    vi.spyOn(pool, "query").mockImplementation(hang);

    const error = await caught(guardPool(pool, operation, 20).query({ text: "select slow" }));

    expect(error).toBeInstanceOf(DbQueryTimedOut);
  });
});
