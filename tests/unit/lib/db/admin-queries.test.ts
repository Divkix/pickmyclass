import { Column, is, SQL, type SQLChunk } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import type { Database } from '@/lib/db';

const dialect = new PgDialect();

function builtSql(query: SQL): string {
  return dialect.sqlToQuery(query).sql.replace(/\s+/g, ' ').trim();
}

interface RecentActivityWireRow {
  activity_type: string;
  activity_at: string;
  user_email: string;
  class_nbr: string | null;
  subject: string | null;
  catalog_nbr: string | null;
  notification_type: string | null;
}

interface WatchWireRow {
  id: string;
  user_id: string;
  class_nbr: string;
  term: string;
  subject: string;
  catalog_nbr: string;
  created_at: string;
}

interface ClassStateWireRow {
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
  consecutive_not_found_count: number;
}

interface JoinedWatchRow {
  watch: WatchWireRow;
  class_state: ClassStateWireRow | null;
}

interface RecordingChain<Row> extends Promise<Row[]> {
  from(table: PgTable): RecordingChain<Row>;
  leftJoin(table: PgTable, on: SQL): RecordingChain<Row>;
  where(condition: SQL): RecordingChain<Row>;
  orderBy(condition: SQL): RecordingChain<Row>;
}

interface RecordedBuilderCalls {
  from: PgTable[];
  leftJoin: Array<[PgTable, SQL]>;
  where: SQL[];
  orderBy: SQL[];
}

interface AdminSeamDb {
  execute?(query: SQL): Promise<RecentActivityWireRow[]>;
  select?(): RecordingChain<JoinedWatchRow>;
}

function asDatabaseHandle(seam: Database | AdminSeamDb): Database {
  return seam as Database;
}

interface MockDbOptions {
  rows?: RecentActivityWireRow[];
  error?: Error;
}

function createDb({ rows = [], error }: MockDbOptions = {}) {
  const execute = vi.fn(async (_query: SQL): Promise<RecentActivityWireRow[]> => {
    if (error !== undefined) throw error;
    return rows;
  });
  return { db: asDatabaseHandle({ execute }), execute };
}

function createJoinDb(joinedRows: JoinedWatchRow[]) {
  const calls: RecordedBuilderCalls = { from: [], leftJoin: [], where: [], orderBy: [] };

  const select = vi.fn((): RecordingChain<JoinedWatchRow> => {
    const chain: RecordingChain<JoinedWatchRow> = Object.assign(Promise.resolve(joinedRows), {
      from: (table: PgTable): RecordingChain<JoinedWatchRow> => {
        calls.from.push(table);
        return chain;
      },
      leftJoin: (table: PgTable, on: SQL): RecordingChain<JoinedWatchRow> => {
        calls.leftJoin.push([table, on]);
        return chain;
      },
      where: (condition: SQL): RecordingChain<JoinedWatchRow> => {
        calls.where.push(condition);
        return chain;
      },
      orderBy: (condition: SQL): RecordingChain<JoinedWatchRow> => {
        calls.orderBy.push(condition);
        return chain;
      },
    });
    return chain;
  });

  return { db: asDatabaseHandle({ select }), calls, select };
}

function columnsIn(chunk: SQLChunk | Column, acc: Column[] = []): Column[] {
  if (is(chunk, Column)) {
    acc.push(chunk);
    return acc;
  }
  if (Array.isArray(chunk)) {
    for (const child of chunk) columnsIn(child, acc);
    return acc;
  }
  if (chunk instanceof SQL) {
    for (const child of chunk.queryChunks) columnsIn(child, acc);
  }
  return acc;
}

import { getRecentActivity, getUserWatches } from '@/lib/db/admin-queries';
import { classStates, classWatches } from '@/lib/db/schema';

describe('getRecentActivity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return discriminated union items for all activity types', async () => {
    const mockData = [
      {
        activity_type: 'user_registration',
        activity_at: '2026-05-19 10:00:00+00',
        user_email: 'alice@example.com',
        class_nbr: null,
        subject: null,
        catalog_nbr: null,
        notification_type: null,
      },
      {
        activity_type: 'new_watch',
        activity_at: '2026-05-19T09:30:00Z',
        user_email: 'bob@example.com',
        class_nbr: '12431',
        subject: 'CSE',
        catalog_nbr: '240',
        notification_type: null,
      },
      {
        activity_type: 'email_sent',
        activity_at: '2026-05-19 09:00:00+00',
        user_email: 'charlie@example.com',
        class_nbr: '12431',
        subject: 'CSE',
        catalog_nbr: '240',
        notification_type: 'seat_available',
      },
    ];
    const { db, execute } = createDb({ rows: mockData });

    const result = await getRecentActivity(db, 10);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(builtSql(execute.mock.calls[0][0])).toBe(
      'SELECT * FROM public.get_recent_activity($1::int)'
    );
    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).params).toEqual([10]);

    expect(result).toHaveLength(3);

    expect(result[0]).toEqual({
      type: 'user_registration',
      activityAt: '2026-05-19T10:00:00.000Z',
      userEmail: 'alice@example.com',
      classNbr: null,
      subject: null,
      catalogNbr: null,
      notificationType: null,
    });

    expect(result[1]).toEqual({
      type: 'new_watch',
      activityAt: '2026-05-19T09:30:00.000Z',
      userEmail: 'bob@example.com',
      classNbr: '12431',
      subject: 'CSE',
      catalogNbr: '240',
      notificationType: null,
    });

    expect(result[2]).toEqual({
      type: 'email_sent',
      activityAt: '2026-05-19T09:00:00.000Z',
      userEmail: 'charlie@example.com',
      classNbr: '12431',
      subject: 'CSE',
      catalogNbr: '240',
      notificationType: 'seat_available',
    });
  });

  it('should use default limit of 50 when none provided', async () => {
    const { db, execute } = createDb({ rows: [] });

    await getRecentActivity(db);

    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).params).toEqual([50]);
  });

  it('should clamp the limit into the 1..500 range', async () => {
    const { db, execute } = createDb({ rows: [] });

    await getRecentActivity(db, 1000);

    expect(dialect.sqlToQuery(execute.mock.calls[0][0]).params).toEqual([500]);
  });

  it('should reject invalid limits before touching the database', async () => {
    const { db, execute } = createDb({ rows: [] });

    await expect(getRecentActivity(db, 0)).rejects.toThrow(TypeError);
    await expect(getRecentActivity(db, -5)).rejects.toThrow(
      'Invalid limit: must be a finite positive integer'
    );
    await expect(getRecentActivity(db, Number.NaN)).rejects.toThrow(TypeError);
    expect(execute).not.toHaveBeenCalled();
  });

  it('should return empty array when no activity exists', async () => {
    const { db } = createDb({ rows: [] });

    const result = await getRecentActivity(db, 15);

    expect(result).toEqual([]);
  });

  it('should degrade to an empty activity feed when the recent activity RPC is not deployed', async () => {
    const missingRpcError = Object.assign(
      new Error('function get_recent_activity(integer) does not exist'),
      { code: '42883' }
    );
    const { db, execute } = createDb({ error: missingRpcError });

    const result = await getRecentActivity(db, 42);
    const cachedResult = await getRecentActivity(db, 42);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
    expect(cachedResult).toEqual([]);
  });

  it('should still fail open on 42883 when Drizzle wraps the driver error', async () => {
    const cause = Object.assign(new Error('function get_recent_activity(integer) does not exist'), {
      code: '42883',
    });
    const wrapped = Object.assign(
      new Error('Failed query: SELECT * FROM public.get_recent_activity($1::int)'),
      {
        query: 'SELECT * FROM public.get_recent_activity($1::int)',
        params: [43],
        cause,
      }
    );
    const { db, execute } = createDb({ error: wrapped });

    const result = await getRecentActivity(db, 43);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toEqual([]);
  });

  it('should not fail open for other Postgres errors (fail-open is exclusive to SQLSTATE 42883)', async () => {
    const raiseError = Object.assign(new Error('product invariant raised'), { code: 'P0001' });
    const { db } = createDb({ error: raiseError });

    await expect(getRecentActivity(db, 21)).rejects.toThrow(
      'Failed to fetch recent activity: product invariant raised'
    );
  });

  it('should throw error when the query fails', async () => {
    const { db } = createDb({ error: new Error('Database connection failed') });

    await expect(getRecentActivity(db, 20)).rejects.toThrow(
      'Failed to fetch recent activity: Database connection failed'
    );
  });
});

describe('getUserWatches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('joins watches to their SectionRef-scoped state ordered by newest watch', async () => {
    const joinedRows = [
      {
        watch: {
          id: 'w-spring',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2261',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-10 00:00:00+00',
        },
        class_state: {
          id: 'state-spring',
          class_nbr: '12345',
          term: '2261',
          subject: 'CSE',
          catalog_nbr: '110',
          title: null,
          instructor_name: null,
          seats_available: 5,
          seats_capacity: 40,
          non_reserved_seats: null,
          location: null,
          meeting_times: null,
          last_checked_at: '2026-01-11 00:00:00+00',
          last_changed_at: '2026-01-11 00:00:00+00',
          consecutive_not_found_count: 0,
        },
      },
      {
        watch: {
          id: 'w-fall',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2267',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-11 00:00:00+00',
        },
        class_state: {
          id: 'state-fall',
          class_nbr: '12345',
          term: '2267',
          subject: 'CSE',
          catalog_nbr: '110',
          title: null,
          instructor_name: null,
          seats_available: 0,
          seats_capacity: 40,
          non_reserved_seats: null,
          location: null,
          meeting_times: null,
          last_checked_at: '2026-01-12 00:00:00+00',
          last_changed_at: '2026-01-12 00:00:00+00',
          consecutive_not_found_count: 2,
        },
      },
    ];
    const { db, calls, select } = createJoinDb(joinedRows);

    const result = await getUserWatches(db, 'u1');

    expect(select).toHaveBeenCalledTimes(1);
    expect(calls.from[0]).toBe(classWatches);
    expect(calls.leftJoin).toHaveLength(1);
    const [joinedTable, onCondition] = calls.leftJoin[0];
    expect(joinedTable).toBe(classStates);
    const onColumns = columnsIn(onCondition);
    expect(onColumns).toContain(classWatches.class_nbr);
    expect(onColumns).toContain(classStates.class_nbr);
    expect(onColumns).toContain(classWatches.term);
    expect(onColumns).toContain(classStates.term);
    expect(columnsIn(calls.where[0])).toContain(classWatches.user_id);
    expect(columnsIn(calls.orderBy[0])).toContain(classWatches.created_at);

    expect(result).toHaveLength(2);
    const spring = result.find((w) => w.id === 'w-spring');
    const fall = result.find((w) => w.id === 'w-fall');
    expect(spring?.class_state?.term).toBe('2261');
    expect(spring?.class_state?.seats_available).toBe(5);
    expect(fall?.class_state?.term).toBe('2267');
    expect(fall?.class_state?.seats_available).toBe(0);
    expect(fall?.class_state?.consecutive_not_found_count).toBe(2);
    expect(spring).toMatchObject({
      user_id: 'u1',
      class_nbr: '12345',
      subject: 'CSE',
      catalog_nbr: '110',
      created_at: '2026-01-10T00:00:00.000Z',
    });
    expect(spring?.class_state?.last_checked_at).toBe('2026-01-11T00:00:00.000Z');
  });

  it('returns null class_state for a watch whose term has no matching state row', async () => {
    const { db } = createJoinDb([
      {
        watch: {
          id: 'w-fall',
          user_id: 'u1',
          class_nbr: '12345',
          term: '2267',
          subject: 'CSE',
          catalog_nbr: '110',
          created_at: '2026-01-11 00:00:00+00',
        },
        class_state: null,
      },
    ]);

    const result = await getUserWatches(db, 'u1');

    expect(result).toHaveLength(1);
    expect(result[0].class_state).toBeNull();
    expect(result[0].created_at).toBe('2026-01-11T00:00:00.000Z');
  });

  it('returns an empty list without extra queries when the user has no watches', async () => {
    const { db, select } = createJoinDb([]);

    await expect(getUserWatches(db, 'u2')).resolves.toEqual([]);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it('wraps failures with the stable user-watches error message', async () => {
    const select = vi.fn(() => {
      throw new Error('Database connection failed');
    });
    const db = asDatabaseHandle({ select });

    await expect(getUserWatches(db, 'u3')).rejects.toThrow(
      'Failed to fetch user watches: Database connection failed'
    );
  });
});
