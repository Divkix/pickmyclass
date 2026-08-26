import { drizzle } from 'drizzle-orm/postgres-js';

import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

// ─── Scripted postgres-js transport (unit-test seam) ────────────────────────

/** Wire-scale cell values a PostgreSQL row can hand back through the driver. */
type CellValue = null | boolean | number | bigint | string | Date | readonly CellValue[];

/** Driver row keyed by column name, exactly as postgres-js materializes it. */
interface DriverRow {
  [column: string]: CellValue;
}

/** One executed statement: rendered SQL text plus its bound parameters. */
interface CapturedStatement {
  sql: string;
  params: CellValue[];
}

/**
 * Awaitable statement result mirroring the postgres-js PendingQuery surface
 * drizzle consumes: plain `await` for execute paths, `.values()` for the
 * array-mode mapping drizzle applies to mapped selects/returning clauses.
 */
interface PendingRows extends Promise<DriverRow[]> {
  values(): Promise<CellValue[][]>;
}

/** The option-bag members drizzle's construct() mutates on connect. */
interface DriverOptions {
  parsers: Record<number, (raw: string) => CellValue>;
  serializers: Record<number, (value: CellValue) => string>;
}

/** The postgres-js client surface drizzle drives: unsafe(), begin(), options. */
interface ScriptedTransport {
  options: DriverOptions;
  unsafe(query: string, params: readonly CellValue[]): PendingRows;
  begin<T>(callback: (tx: ScriptedTransport) => T | Promise<T>): Promise<Awaited<T>>;
}

/**
 * Client seam handed to drizzle(): either the production postgres driver or
 * the scripted double. The union is what lets the boundary below narrow to
 * the real client type with a single documented assertion.
 */
type PostgresClient = Database['$client'] | ScriptedTransport;

/**
 * Presents a client seam as the postgres-js instance drizzle consumes.
 */
function asPostgresClient(client: PostgresClient): Database['$client'] {
  // SAFETY: the scripted transport implements every postgres-js member
  // drizzle drives at runtime — construct() mutates options.parsers/
  // serializers, sessions await unsafe(query, params), and transactions run
  // through begin(cb); every other Sql member is unreachable behind this
  // boundary, and the union parameter keeps the cast to a single step.
  return client as Database['$client'];
}

/**
 * Drizzle over a scripted postgres-js transport: real query builders render
 * every statement, the fake client records the exact SQL/params and answers
 * them FIFO from the scripted outcomes. `values()` mirrors the postgres-js
 * PendingQuery surface that drizzle's array-mode (select/returning) mapping
 * consumes.
 */
export function createScriptedPostgres() {
  const statements: CapturedStatement[] = [];
  // FIFO of per-statement outcomes: row sets and driver errors in call order.
  const outcomes: Array<DriverRow[] | Error> = [];
  let transactionCount = 0;

  const pendingRows = (rows: DriverRow[]): PendingRows =>
    Object.assign(Promise.resolve(rows), {
      values: (): Promise<CellValue[][]> => Promise.resolve(rows.map((row) => Object.values(row))),
    });

  const respond = (): PendingRows => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) {
      // Lazy rejection mirroring postgres-js PendingQuery: drizzle awaits
      // either the raw promise (execute path) or its .values() result (array
      // mode), never both — mark the base rejection handled so the unconsumed
      // side cannot surface as an unhandled rejection.
      const rejected: PendingRows = Object.assign(Promise.reject(outcome), {
        values: (): Promise<never> => Promise.reject(outcome),
      });
      rejected.catch(() => {});
      return rejected;
    }
    return pendingRows(outcome ?? []);
  };

  const transport: ScriptedTransport = {
    options: { parsers: {}, serializers: {} },
    unsafe(query: string, params: readonly CellValue[]): PendingRows {
      statements.push({ sql: query, params: [...params] });
      return respond();
    },
    begin<T>(callback: (tx: ScriptedTransport) => T | Promise<T>): Promise<Awaited<T>> {
      transactionCount += 1;
      // The transaction reuses the same scripted transport, matching how
      // postgres.js hands the pooled client back to its own begin() callback.
      return Promise.resolve(callback(transport));
    },
  };

  const db: Database = drizzle(asPostgresClient(transport), { schema });

  return {
    db,
    statements,
    get transactionCount(): number {
      return transactionCount;
    },
    /** Script the row set answered by the next executed statement. */
    next(rows: DriverRow[] = []) {
      outcomes.push(rows);
    },
    /** Make the next executed statement reject with this driver-shaped error. */
    failNext(error: Error) {
      outcomes.push(error);
    },
  };
}
