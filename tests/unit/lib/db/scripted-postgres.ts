import { drizzle } from 'drizzle-orm/postgres-js';

import type { Database } from '@/lib/db';
import * as schema from '@/lib/db/schema';

type CellValue = null | boolean | number | bigint | string | Date | readonly CellValue[];

interface DriverRow {
  [column: string]: CellValue;
}

interface CapturedStatement {
  sql: string;
  params: CellValue[];
}

interface PendingRows extends Promise<DriverRow[]> {
  values(): Promise<CellValue[][]>;
}

interface DriverOptions {
  parsers: Record<number, (raw: string) => CellValue>;
  serializers: Record<number, (value: CellValue) => string>;
}

interface ScriptedTransport {
  options: DriverOptions;
  unsafe(query: string, params: readonly CellValue[]): PendingRows;
  begin<T>(callback: (tx: ScriptedTransport) => T | Promise<T>): Promise<Awaited<T>>;
}

type PostgresClient = Database['$client'] | ScriptedTransport;

function asPostgresClient(client: PostgresClient): Database['$client'] {
  return client as Database['$client'];
}

export function createScriptedPostgres() {
  const statements: CapturedStatement[] = [];
  const outcomes: Array<DriverRow[] | Error> = [];
  let transactionCount = 0;

  const pendingRows = (rows: DriverRow[]): PendingRows =>
    Object.assign(Promise.resolve(rows), {
      values: (): Promise<CellValue[][]> => Promise.resolve(rows.map((row) => Object.values(row))),
    });

  const respond = (): PendingRows => {
    const outcome = outcomes.shift();
    if (outcome instanceof Error) {
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
    next(rows: DriverRow[] = []) {
      outcomes.push(rows);
    },
    failNext(error: Error) {
      outcomes.push(error);
    },
  };
}
