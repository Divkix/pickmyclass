import { drizzle } from 'drizzle-orm/postgres-js';
import type postgres from 'postgres';
import { describe, expect, it } from 'vite-plus/test';

import * as schema from '@/lib/db/schema';
import {
  applyFirstWatchGuard,
  completeOnFirstWatch,
  onboardingStatus,
  readOnboardingState,
  skipOnboarding,
  toOnboardingState,
  type OnboardingPayload,
  type OnboardingRow,
  type OnboardingState,
} from '@/lib/onboarding';

const SELECT_ORDER = ['onboarding_completed_at', 'onboarding_skipped_at'] as const;

type FakeRow = Record<(typeof SELECT_ORDER)[number], string | null>;

interface RecordedQuery {
  sql: string;
  params: unknown[];
}

type RowsFor = (query: RecordedQuery) => FakeRow[];

type ScriptedRows = Promise<FakeRow[]> & { values(): PromiseLike<unknown[][]> };

interface PostgresJsSeam {
  unsafe(query: string, params: unknown[]): ScriptedRows;
}

function makeDb(rowsFor: RowsFor) {
  const queries: RecordedQuery[] = [];
  const unsafe = (sql: string, params: unknown[]): ScriptedRows => {
    const query: RecordedQuery = { sql, params };
    queries.push(query);
    const rows = rowsFor(query);
    return Object.assign(Promise.resolve(rows), {
      values: async (): Promise<unknown[][]> =>
        rows.map((row) => SELECT_ORDER.map((column) => row[column])),
    });
  };
  const scriptedClient = { unsafe, options: { parsers: {}, serializers: {} } };
  const client: PostgresJsSeam = scriptedClient;
  const db = drizzle(client as postgres.Sql, { schema });
  return { db, queries };
}

describe('lib/onboarding', () => {
  describe('onboardingStatus', () => {
    it('is pending when both timestamps are null', () => {
      expect(onboardingStatus({ onboarding_completed_at: null, onboarding_skipped_at: null })).toBe(
        'pending'
      );
    });

    it('is skipped when only skipped_at is set', () => {
      expect(
        onboardingStatus({ onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11' })
      ).toBe('skipped');
    });

    it('is completed when only completed_at is set', () => {
      expect(
        onboardingStatus({ onboarding_completed_at: '2026-07-10', onboarding_skipped_at: null })
      ).toBe('completed');
    });

    it('treats completed as taking precedence over skipped (completed_at wins)', () => {
      expect(
        onboardingStatus({
          onboarding_completed_at: '2026-07-12',
          onboarding_skipped_at: '2026-07-11',
        })
      ).toBe('completed');
    });

    it('treats a missing profile row as completed (fail closed on the modal)', () => {
      expect(onboardingStatus(null)).toBe('completed');
    });
  });

  describe('toOnboardingState', () => {
    it('exposes needs_onboarding=true only for pending users', () => {
      expect(
        toOnboardingState({ onboarding_completed_at: null, onboarding_skipped_at: null })
          .needs_onboarding
      ).toBe(true);
    });

    it('exposes needs_onboarding=false for skipped users', () => {
      expect(
        toOnboardingState({ onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11' })
          .needs_onboarding
      ).toBe(false);
    });

    it('exposes needs_onboarding=false for completed users', () => {
      expect(
        toOnboardingState({ onboarding_completed_at: '2026-07-10', onboarding_skipped_at: null })
          .needs_onboarding
      ).toBe(false);
    });

    it('defaults to not-needed when the profile row is missing', () => {
      expect(toOnboardingState(null).needs_onboarding).toBe(false);
    });
  });

  describe('completeOnFirstWatch', () => {
    const now = '2026-07-12T00:00:00Z';

    it('transitions pending -> completed', () => {
      const current: OnboardingState = {
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: true,
      };
      expect(completeOnFirstWatch(current, now)).toEqual({
        onboarding_completed_at: now,
        onboarding_skipped_at: null,
        needs_onboarding: false,
      });
    });

    it('transitions skipped -> completed and preserves skipped_at', () => {
      const current: OnboardingState = {
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-11T12:00:00Z',
        needs_onboarding: false,
      };
      expect(completeOnFirstWatch(current, now)).toEqual({
        onboarding_completed_at: now,
        onboarding_skipped_at: '2026-07-11T12:00:00Z',
        needs_onboarding: false,
      });
    });

    it('is a no-op for an already-completed user', () => {
      const current: OnboardingState = {
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: '2026-07-09T00:00:00Z',
        needs_onboarding: false,
      };
      expect(completeOnFirstWatch(current, now)).toEqual(current);
    });
  });

  describe('applyFirstWatchGuard', () => {
    it('updates user_profiles guarded on onboarding_completed_at IS NULL', async () => {
      const { db, queries } = makeDb(() => []);

      await applyFirstWatchGuard(db, 'user-1');

      expect(queries).toHaveLength(1);
      const { sql, params } = queries[0];
      expect(sql).toContain('update "user_profiles"');
      expect(sql).toContain('"onboarding_completed_at" = $1');
      expect(sql).toContain('"user_profiles"."user_id" = $2');
      expect(sql).toContain('"onboarding_completed_at" is null');
      expect(params[1]).toBe('user-1');
    });

    it('never guards on onboarding_skipped_at (skipped users still complete)', async () => {
      const { db, queries } = makeDb(() => []);

      await applyFirstWatchGuard(db, 'user-1');

      const { sql } = queries[0];
      expect(sql).not.toContain('onboarding_skipped_at');
    });

    it('sets onboarding_completed_at to a current timestamp', async () => {
      const { db, queries } = makeDb(() => []);

      const before = new Date().getTime();
      await applyFirstWatchGuard(db, 'user-1');
      const after = new Date().getTime();

      const timestamp = new Date(queries[0].params[0] as string).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('readOnboardingState', () => {
    const userId = 'user-1';

    it('projects a pending row as needing onboarding', async () => {
      const { db } = makeDb(() => [{ onboarding_completed_at: null, onboarding_skipped_at: null }]);

      await expect(readOnboardingState(db, userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: true,
      } satisfies OnboardingPayload);
    });

    it('projects a skipped row with needs_onboarding=false', async () => {
      const { db } = makeDb(() => [
        { onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11T00:00:00Z' },
      ]);

      await expect(readOnboardingState(db, userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-11T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('projects a completed row with needs_onboarding=false', async () => {
      const { db } = makeDb(() => [
        { onboarding_completed_at: '2026-07-10T00:00:00Z', onboarding_skipped_at: null },
      ]);

      await expect(readOnboardingState(db, userId)).resolves.toEqual({
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: null,
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('defaults to not-needed when the profile row is missing (no rows)', async () => {
      const { db } = makeDb(() => []);

      await expect(readOnboardingState(db, userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('issues the sole two-column SELECT scoped to the user id', async () => {
      const { db, queries } = makeDb(() => [
        { onboarding_completed_at: null, onboarding_skipped_at: null },
      ]);

      await readOnboardingState(db, userId);

      expect(queries).toHaveLength(1);
      const { sql, params } = queries[0];
      expect(sql).toContain('from "user_profiles"');
      expect(sql).toContain('"onboarding_completed_at"');
      expect(sql).toContain('"onboarding_skipped_at"');
      expect(params[0]).toBe(userId);
    });
  });

  describe('skipOnboarding', () => {
    const userId = 'user-1';

    it('transitions pending -> skipped via the skip RPC projection', async () => {
      const { db } = makeDb(() => [
        { onboarding_completed_at: null, onboarding_skipped_at: '2026-07-12T00:00:00Z' },
      ]);

      await expect(skipOnboarding(db, userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-12T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('preserves completed + skipped timestamps from the RPC row', async () => {
      const { db } = makeDb(() => [
        {
          onboarding_completed_at: '2026-07-10T00:00:00Z',
          onboarding_skipped_at: '2026-07-09T00:00:00Z',
        },
      ]);

      await expect(skipOnboarding(db, userId)).resolves.toEqual({
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: '2026-07-09T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('returns null when the RPC yields no rows', async () => {
      const { db } = makeDb(() => []);

      await expect(skipOnboarding(db, userId)).resolves.toBeNull();
    });

    it('calls skip_onboarding with the user id as its sole bound argument', async () => {
      const { db, queries } = makeDb(() => [
        { onboarding_completed_at: null, onboarding_skipped_at: null },
      ]);

      await skipOnboarding(db, userId);

      expect(queries).toHaveLength(1);
      expect(queries[0].sql).toContain('skip_onboarding($1::text)');
      expect(queries[0].params).toEqual([userId]);
    });
  });

  describe('transition matrix (regression for issue #307)', () => {
    const now = '2026-07-12T00:00:00Z';
    const rows = {
      pending: { onboarding_completed_at: null, onboarding_skipped_at: null },
      skipped: { onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11T00:00:00Z' },
      completed: { onboarding_completed_at: '2026-07-10T00:00:00Z', onboarding_skipped_at: null },
    } satisfies Record<string, OnboardingRow>;

    it('skip: pending -> skipped (needs_onboarding false)', () => {
      const after = toOnboardingState({
        ...rows.skipped,
      });
      expect(onboardingStatus(rows.pending)).toBe('pending');
      expect(onboardingStatus(after)).toBe('skipped');
      expect(after.needs_onboarding).toBe(false);
    });

    it('first watch: pending -> completed', () => {
      const before = toOnboardingState(rows.pending);
      const after = completeOnFirstWatch(before, now);
      expect(onboardingStatus(after)).toBe('completed');
    });

    it('first watch: skipped -> completed (the #307 fix)', () => {
      const before = toOnboardingState(rows.skipped);
      const after = completeOnFirstWatch(before, now);
      expect(onboardingStatus(after)).toBe('completed');
      expect(after.onboarding_skipped_at).toBe('2026-07-11T00:00:00Z');
    });

    it('first watch: completed is terminal', () => {
      const before = toOnboardingState(rows.completed);
      const after = completeOnFirstWatch(before, now);
      expect(onboardingStatus(after)).toBe('completed');
      expect(after.onboarding_completed_at).toBe('2026-07-10T00:00:00Z');
    });
  });
});
