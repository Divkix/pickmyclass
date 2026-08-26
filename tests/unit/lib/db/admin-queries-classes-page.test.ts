import { type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import type { Database } from '@/lib/db';

// getClassesPage takes a request-scoped Drizzle Database handle and issues a
// single db.execute(sql`…get_classes_page(…)`) RPC. The mock resolves that
// execute call and records the built query for assertions.
const dialect = new PgDialect();

/** Normalize a built SQL template to comparable single-spaced text. */
function builtSql(query: SQL): string {
  return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

/** Wire row emitted by the get_classes_page RPC; BIGINT counts arrive raw. */
interface ClassPageWireRow {
  id: string;
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  title: string | null;
  instructor_name: string | null;
  seats_available: number;
  seats_capacity: number;
  non_reserved_seats: number | null;
  location: string | null;
  meeting_times: string | null;
  last_checked_at: string;
  last_changed_at: string;
  watcher_count: number;
  seat_emails: number;
  instructor_emails: number;
  total_count: number;
  /** Absent on pre-aggregate RPC revisions; the reader guards with ?? 0. */
  total_watchers?: number;
  full_classes?: number;
}

/** The narrow Database surface getClassesPage drives: execute() RPCs. */
interface ClassesPageSeamDb {
  execute?(query: SQL): Promise<ClassPageWireRow[]>;
}

/**
 * Narrows a recording double to the request-scoped Database handle.
 */
function asDatabaseHandle(seam: Database | ClassesPageSeamDb): Database {
  // SAFETY: the double implements exactly the execute() seam above, and no
  // other Database member is reachable on this code path.
  return seam as Database;
}

/** Build a mock Database resolving db.execute with these rows. */
function createDb(executeRows: ClassPageWireRow[]) {
  const execute = vi.fn(async (_query: SQL): Promise<ClassPageWireRow[]> => executeRows);
  return { db: asDatabaseHandle({ execute }), execute };
}

// Disable the TTL cache so each test exercises the real fetch path.
vi.mock('@/lib/cache/ttl-cache', () => ({
  TtlCache: class {
    get(_key: string) {
      return undefined;
    }
    set(_key: string, _data: never) {}
    clear() {}
    delete(_key: string) {
      return false;
    }
  },
}));

// Import after mocks are registered
import { getClassesPage } from '@/lib/db/admin-queries';

/** Build a get_classes_page wire row, overriding any column for a case. */
function classPageRow(overrides: Partial<ClassPageWireRow> = {}): ClassPageWireRow {
  return {
    id: 'state-1',
    class_nbr: '12345',
    term: '2267',
    subject: 'CSE',
    catalog_nbr: '240',
    title: 'Intro to Programming',
    instructor_name: 'Dr. X',
    seats_available: 0,
    seats_capacity: 30,
    non_reserved_seats: null,
    location: null,
    meeting_times: null,
    last_checked_at: '2026-08-01T00:00:00Z',
    last_changed_at: '2026-08-01T00:00:00Z',
    watcher_count: 3,
    seat_emails: 2,
    instructor_emails: 1,
    total_count: 2,
    total_watchers: 7,
    full_classes: 1,
    ...overrides,
  };
}

describe('getClassesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls get_classes_page with bound, explicitly cast parameters and returns rows, total, and the global aggregates', async () => {
    const rows = [
      classPageRow({ id: 'state-1' }),
      classPageRow({
        id: 'state-2',
        class_nbr: '67890',
        subject: 'MAT',
        seats_available: 12,
        watcher_count: 4,
        seat_emails: 1,
        instructor_emails: 0,
      }),
    ];
    const { db, execute } = createDb(rows);

    const result = await getClassesPage(db, {
      page: 2,
      pageSize: 25,
      search: 'cse',
      subject: 'CSE',
      seatStatus: 'all',
      instructor: 'all',
      watcherCount: 'all',
      sort: 'watcher_count',
      dir: 'asc',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0][0];
    expect(builtSql(query)).toBe(
      'SELECT * FROM public.get_classes_page( $1::int, $2::int, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text )'
    );
    expect(dialect.sqlToQuery(query).params).toEqual([
      2,
      25,
      'cse',
      'CSE',
      'all',
      'all',
      'all',
      'watcher_count',
      'asc',
    ]);

    expect(result.rows).toHaveLength(2);
    expect(result.total).toBe(2);
    // Global aggregates are read off every row (window-function broadcast),
    // and surfaced page-independently on the result.
    expect(result.totalWatchers).toBe(7);
    expect(result.fullClasses).toBe(1);
    // BIGINT aggregates arrive as strings and normalize to numbers; the
    // consecutive-not-found column is absent from this RPC and defaults to 0.
    expect(result.rows[0]).toMatchObject({
      id: 'state-1',
      watcher_count: 3,
      seat_emails: 2,
      instructor_emails: 1,
      consecutive_not_found_count: 0,
    });
    expect(typeof result.rows[0].watcher_count).toBe('number');
    expect(result.rows[0].last_checked_at).toBe('2026-08-01T00:00:00.000Z');
  });

  it('defaults aggregates to 0 when the RPC returns no rows', async () => {
    const { db } = createDb([]);

    const result = await getClassesPage(db);

    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalWatchers).toBe(0);
    expect(result.fullClasses).toBe(0);
  });

  it('guards against a missing aggregate column (function-version skew) with 0, never NaN', async () => {
    // Old function definition shape: rows carry total_count but no
    // total_watchers / full_classes yet — omit those keys to simulate it.
    const {
      total_watchers: _omittedWatchers,
      full_classes: _omittedFull,
      ...staleRow
    } = classPageRow();
    const { db } = createDb([staleRow]);

    const result = await getClassesPage(db);

    expect(Number.isNaN(result.totalWatchers)).toBe(false);
    expect(Number.isNaN(result.fullClasses)).toBe(false);
    expect(result.totalWatchers).toBe(0);
    expect(result.fullClasses).toBe(0);
  });

  it('unwraps DrizzleQueryError so the original driver message surfaces', async () => {
    // Drizzle rethrows failed statements as "Failed query: …" with the raw
    // postgres-js error parked on .cause; callers must keep seeing the
    // original driver text, not the query echo.
    const drizzleError = Object.assign(
      new Error('Failed query: SELECT * FROM public.get_classes_page($1::int, $2::int)'),
      {
        query: 'SELECT * FROM public.get_classes_page($1::int, $2::int)',
        params: [1, 25],
        cause: new Error('Database connection failed'),
      }
    );
    const execute = vi.fn(async () => {
      throw drizzleError;
    });
    const db = asDatabaseHandle({ execute });

    await expect(getClassesPage(db)).rejects.toThrow(
      'Failed to fetch classes page: Database connection failed'
    );
  });

  it('throws when the RPC fails', async () => {
    const execute = vi.fn(async () => {
      throw new Error('Database connection failed');
    });
    const db = asDatabaseHandle({ execute });

    await expect(getClassesPage(db)).rejects.toThrow(
      'Failed to fetch classes page: Database connection failed'
    );
  });
});
