import { drizzle } from "drizzle-orm/node-postgres";
import type { QueryConfig } from "pg";

import type { Database } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export type CellValue =
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | readonly CellValue[]
  | { [key: string]: CellValue };

export interface DriverRow {
  [column: string]: CellValue;
}

export interface CapturedStatement {
  sql: string;
  params: CellValue[];
}

export function createScriptedPostgres(rowsFor?: (statement: CapturedStatement) => DriverRow[]) {
  const statements: CapturedStatement[] = [];
  const outcomes: Array<DriverRow[] | Error> = [];
  let transactionCount = 0;

  const transport = {
    async query(query: QueryConfig<CellValue[]> & { rowMode?: string }, values?: CellValue[]) {
      const text = query.text;

      if (/^(begin|commit|rollback)\b/i.test(text)) {
        if (/^begin\b/i.test(text)) transactionCount += 1;

        return { rows: [], rowCount: 0, command: text, oid: 0, fields: [] };
      }

      const statement = { sql: text, params: values ?? query.values ?? [] };
      statements.push(statement);
      const outcome = rowsFor ? rowsFor(statement) : outcomes.shift();

      if (outcome instanceof Error) throw outcome;
      const rows = outcome ?? [];

      return {
        rows: query.rowMode === "array" ? rows.map((row) => Object.values(row)) : rows,
        rowCount: rows.length,
        command: "",
        oid: 0,
        fields: [],
      };
    },
    async connect() {
      return transport;
    },
    release() {},
  };

  function asPgClient(client: Database["$client"] | typeof transport): Database["$client"] {
    // SAFETY: the transport implements the query/connect/release surface exercised by Drizzle.
    return client as Database["$client"];
  }

  const db: Database = drizzle(asPgClient(transport), { schema });

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
