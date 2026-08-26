import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';

// The admin helpers receive a request-scoped Drizzle `Database` handle. The
// mock reproduces the surface they exercise:
//   getTotalEmailsSent / getAdminCount   → select(count()).from(table)[.where()]
//   getUserWatches                       → select().from().leftJoin().where().orderBy()
//   getTotalUsers / getTotalClassesWatched / getUsersPage / getClassesPage
//                                        → db.execute(sql`…`)

const dialect = new PgDialect();

/** Normalize a built SQL template to comparable single-spaced text. */
function builtSql(query: SQL): string {
  return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

/** Cell values a dashboard wire row can carry, including nested join rows. */
type DashboardCell = string | number | boolean | null | DashboardCell[] | DashboardRow;

/** Driver row keyed by column name; nested objects model joined relations. */
interface DashboardRow {
  [column: string]: DashboardCell;
}

/** Awaitable select chain recording the builder calls the helpers make. */
interface RecordingChain extends Promise<DashboardRow[]> {
  from(table: PgTable): RecordingChain;
  leftJoin(table: PgTable, on: SQL): RecordingChain;
  where(condition: SQL): RecordingChain;
  orderBy(condition: SQL): RecordingChain;
}

/**
 * The narrow Database surface these helpers drive: execute() RPCs and the
 * select builder chain.
 */
interface AdminSeamDb {
  execute?(query: SQL): Promise<DashboardRow[]>;
  select?(): RecordingChain;
}

/**
 * Narrows a recording double to the request-scoped Database handle the
 * dashboard helpers accept.
 */
function asDatabaseHandle(seam: Database | AdminSeamDb): Database {
  // SAFETY: each double implements exactly one seam above — execute() or the
  // select/from/leftJoin/where/orderBy builder chain — and no other Database
  // member is reachable on these code paths.
  return seam as Database;
}

interface MockDbOptions {
  /** Rows returned for builder selects, keyed by table name. */
  selectRows?: Record<string, DashboardRow[]>;
  /** Resolved rows for db.execute, first entry whose regex matches the SQL wins. */
  executeRows?: Array<{ match: RegExp; rows: DashboardRow[] }>;
}

/**
 * Build a mock Database. Returns the Database-shaped handle plus the raw
 * mocks so tests can assert on calls.
 */
function createDb({ selectRows = {}, executeRows = [] }: MockDbOptions = {}) {
  const execute = vi.fn(async (query: SQL): Promise<DashboardRow[]> => {
    const text = builtSql(query);
    const hit = executeRows.find((candidate) => candidate.match.test(text));
    if (!hit) throw new Error(`Unexpected admin-queries SQL: ${text}`);
    return hit.rows;
  });

  /** Table names handed to `.from(...)`, in call order. */
  const selectedTables: string[] = [];

  const select = vi.fn((): RecordingChain => {
    // Rows resolve at await time so .from() can still pick the table's set.
    let pendingRows: DashboardRow[] = [];
    const chain: RecordingChain = Object.assign(
      Promise.resolve().then(() => pendingRows),
      {
        from: (table: PgTable): RecordingChain => {
          const name = getTableName(table);
          selectedTables.push(name);
          pendingRows = selectRows[name] ?? [];
          return chain;
        },
        leftJoin: (): RecordingChain => chain,
        where: (): RecordingChain => chain,
        orderBy: (): RecordingChain => chain,
      }
    );
    return chain;
  });

  return { db: asDatabaseHandle({ select, execute }), execute, select, selectedTables };
}

// Disable the TTL cache so each test exercises the real fetch path rather than
// hitting a module-level cache populated by a previous test.
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

import {
  getAdminCount,
  getClassesPage,
  getTotalClassesWatched,
  getTotalEmailsSent,
  getTotalUsers,
  getUserWatches,
  getUsersPage,
} from '@/lib/db/admin-queries';

describe('admin dashboard query helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('collects dashboard counts, user page rows, and user watch details', async () => {
    const joinedWatches = [
      {
        watch: {
          id: 'watch-a',
          user_id: 'user-2',
          class_nbr: '12345',
          term: '2261',
          subject: 'CSE',
          catalog_nbr: '240',
          created_at: '2026-05-02 12:00:00+00',
        },
        class_state: {
          id: 'state-1',
          class_nbr: '12345',
          term: '2261',
          subject: 'CSE',
          catalog_nbr: '240',
          title: 'Intro to Programming',
          instructor_name: 'Prof One',
          seats_available: 2,
          seats_capacity: 40,
          non_reserved_seats: null,
          location: 'Tempe',
          meeting_times: 'MWF',
          last_checked_at: '2026-05-01T00:00:00Z',
          last_changed_at: '2026-05-01T00:00:00Z',
          consecutive_not_found_count: 0,
        },
      },
      {
        watch: {
          id: 'watch-b',
          user_id: 'user-2',
          class_nbr: '67890',
          term: '2261',
          subject: 'MAT',
          catalog_nbr: '265',
          created_at: '2026-05-03T09:30:00Z',
        },
        class_state: null,
      },
    ];

    const { db, execute, selectedTables } = createDb({
      selectRows: {
        notifications_sent: [{ value: 9 }],
        user_profiles: [{ value: 1 }],
        class_watches: joinedWatches,
      },
      executeRows: [
        { match: /count_all_users/, rows: [{ count: '7' }] },
        { match: /count_distinct_classes_watched/, rows: [{ count: '5' }] },
      ],
    });

    await expect(getTotalEmailsSent(db)).resolves.toBe(9);

    // getTotalUsers uses the count_all_users RPC.
    await expect(getTotalUsers(db)).resolves.toBe(7);
    expect(builtSql(execute.mock.calls[0][0])).toContain('public.count_all_users()');

    await expect(getAdminCount(db)).resolves.toBe(1);

    // getTotalClassesWatched uses the count_distinct_classes_watched RPC.
    await expect(getTotalClassesWatched(db)).resolves.toBe(5);
    const countTexts = execute.mock.calls.map((call) => builtSql(call[0]));
    expect(countTexts.some((text) => text.includes('count_distinct_classes_watched'))).toBe(true);

    // Builder counts never read class_watches; getUserWatches below is the
    // only class_watches reader in this test.
    expect(selectedTables.filter((name) => name === 'class_watches')).toHaveLength(0);

    const userWatches = await getUserWatches(db, 'user-2');
    expect(userWatches).toHaveLength(2);
    expect(userWatches[0]).toMatchObject({
      id: 'watch-a',
      class_state: { class_nbr: '12345', term: '2261', consecutive_not_found_count: 0 },
    });
    // Timestamps crossing the boundary are normalized to the ISO strings the
    // previous pg/JSON boundary exposed, whichever wire shape arrived.
    expect(userWatches[0].created_at).toBe('2026-05-02T12:00:00.000Z');
    expect(userWatches[0].class_state?.last_checked_at).toBe('2026-05-01T00:00:00.000Z');
    expect(userWatches[1].created_at).toBe('2026-05-03T09:30:00.000Z');
    expect(userWatches[1].class_state).toBeNull();
  });

  it('returns an empty user watch list from the single joined query when the user has no watches', async () => {
    const { db, execute, select } = createDb({
      selectRows: { class_watches: [] },
    });

    await expect(getUserWatches(db, 'user-without-watches')).resolves.toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  // ── Paginated RPC wrappers ────────────────────────────────────────────────

  it('getUsersPage binds get_users_page parameters positionally with explicit casts', async () => {
    const { db, execute } = createDb({
      executeRows: [
        {
          match: /get_users_page/,
          rows: [
            {
              id: 'user-1',
              email: 'one@example.com',
              created_at: '2026-05-01T00:00:00Z',
              last_sign_in_at: null,
              email_confirmed_at: '2026-05-01T00:00:00Z',
              watch_count: '2',
              is_admin: false,
              seat_emails: '1',
              instructor_emails: '0',
              notification_status: 'active',
              total_count: '42',
            },
          ],
        },
      ],
    });

    const result = await getUsersPage(db, {
      page: 2,
      pageSize: 10,
      search: 'one',
      role: 'user',
      verified: 'verified',
      watchCount: '1-5',
      sort: 'email',
      dir: 'asc',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0][0];
    expect(builtSql(query)).toBe(
      'SELECT * FROM public.get_users_page( $1::int, $2::int, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text )'
    );
    expect(dialect.sqlToQuery(query).params).toEqual([
      2,
      10,
      'one',
      'user',
      'verified',
      '1-5',
      'email',
      'asc',
    ]);

    expect(result.total).toBe(42);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      email: 'one@example.com',
      watch_count: 2,
      seat_emails: 1,
      instructor_emails: 0,
    });
    // BIGINT counts arrive as strings and are normalized to numbers.
    expect(typeof result.rows[0].watch_count).toBe('number');
    expect(result.rows[0].created_at).toBe('2026-05-01T00:00:00.000Z');
    expect(result.rows[0].last_sign_in_at).toBeNull();
  });

  it('getUsersPage returns empty page when the RPC returns no rows', async () => {
    const { db } = createDb({ executeRows: [{ match: /get_users_page/, rows: [] }] });

    const result = await getUsersPage(db);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getClassesPage binds get_classes_page parameters positionally with explicit casts', async () => {
    const { db, execute } = createDb({
      executeRows: [
        {
          match: /get_classes_page/,
          rows: [
            {
              id: 'state-1',
              class_nbr: '12345',
              term: '2261',
              subject: 'CSE',
              catalog_nbr: '240',
              title: 'Intro',
              instructor_name: 'Dr. X',
              seats_available: 5,
              seats_capacity: 30,
              non_reserved_seats: null,
              location: null,
              meeting_times: null,
              last_checked_at: '2026-05-01 08:00:00+00',
              last_changed_at: '2026-05-01 08:00:00+00',
              watcher_count: '7',
              seat_emails: '3',
              instructor_emails: '1',
              total_count: '99',
              total_watchers: '120',
              full_classes: '4',
            },
          ],
        },
      ],
    });

    const result = await getClassesPage(db, {
      page: 3,
      pageSize: 50,
      search: 'cse',
      subject: 'CSE',
      seatStatus: 'limited',
      instructor: 'named',
      watcherCount: '6-10',
      sort: 'seats_available',
      dir: 'asc',
    });

    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0][0];
    expect(builtSql(query)).toBe(
      'SELECT * FROM public.get_classes_page( $1::int, $2::int, $3::text, $4::text, $5::text, $6::text, $7::text, $8::text, $9::text )'
    );
    expect(dialect.sqlToQuery(query).params).toEqual([
      3,
      50,
      'cse',
      'CSE',
      'limited',
      'named',
      '6-10',
      'seats_available',
      'asc',
    ]);

    expect(result.total).toBe(99);
    expect(result.totalWatchers).toBe(120);
    expect(result.fullClasses).toBe(4);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      class_nbr: '12345',
      watcher_count: 7,
      seat_emails: 3,
      instructor_emails: 1,
    });
    expect(result.rows[0].last_checked_at).toBe('2026-05-01T08:00:00.000Z');
  });

  it('getClassesPage returns empty page when the RPC returns no rows', async () => {
    const { db } = createDb({ executeRows: [{ match: /get_classes_page/, rows: [] }] });

    const result = await getClassesPage(db);
    expect(result.rows).toEqual([]);
    expect(result.total).toBe(0);
    expect(result.totalWatchers).toBe(0);
    expect(result.fullClasses).toBe(0);
  });

  it('getTotalClassesWatched uses count_distinct_classes_watched RPC (no table scan)', async () => {
    const { db, execute, select } = createDb({
      executeRows: [{ match: /count_distinct_classes_watched/, rows: [{ count: '17' }] }],
    });

    const count = await getTotalClassesWatched(db);
    expect(count).toBe(17);
    expect(builtSql(execute.mock.calls[0][0])).toBe(
      'SELECT public.count_distinct_classes_watched()::text AS count'
    );
    // Must NOT scan class_watches via a builder select.
    expect(select).not.toHaveBeenCalled();
  });

  it('getTotalUsers uses count_all_users RPC (no auth walk)', async () => {
    const { db, execute, select } = createDb({
      executeRows: [{ match: /count_all_users/, rows: [{ count: '500' }] }],
    });

    const count = await getTotalUsers(db);
    expect(count).toBe(500);
    expect(builtSql(execute.mock.calls[0][0])).toBe(
      'SELECT public.count_all_users()::text AS count'
    );
    expect(select).not.toHaveBeenCalled();
  });
});
