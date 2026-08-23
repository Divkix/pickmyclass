import { describe, expect, it, vi } from 'vite-plus/test';

vi.mock('@/lib/db/client', () => ({
  execute: vi.fn().mockResolvedValue(1),
  queryOne: vi.fn(),
  query: vi.fn(),
  queryScalar: vi.fn(),
  callFunction: vi.fn(),
  callFunctionScalar: vi.fn(),
  getClient: vi.fn(),
}));

import { callFunction, execute, queryOne } from '@/lib/db/client';
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
      // A skipped user who then creates a watch keeps skipped_at but is completed.
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
      // The server leaves skipped_at untouched; the projection must match.
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
    it('executes UPDATE with onboarding_completed_at IS NULL guard', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockClear();
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await applyFirstWatchGuard('user-1');

      expect(execute).toHaveBeenCalledTimes(1);
      const [sql, params] =
        // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
        (execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sql).toContain('onboarding_completed_at IS NULL');
      expect(sql).toContain('WHERE user_id = $2');
      expect(params[1]).toBe('user-1');
    });

    it('never guards on onboarding_skipped_at (skipped users still complete)', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockClear();
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      await applyFirstWatchGuard('user-1');

      const [sql] =
        // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
        (execute as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sql).not.toContain('onboarding_skipped_at');
    });

    it('sets onboarding_completed_at to a current timestamp', async () => {
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockClear();
      // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
      (execute as ReturnType<typeof vi.fn>).mockResolvedValue(1);

      const before = new Date().getTime();
      await applyFirstWatchGuard('user-1');
      const after = new Date().getTime();

      const params =
        // eslint-disable-next-line anti-slop/no-known-value-widening -- SAFETY: test double narrows vi.fn mock type
        (execute as ReturnType<typeof vi.fn>).mock.calls[0][1] as unknown[];
      // SAFETY: params[0] is the ISO timestamp string passed to the UPDATE query
      const timestamp = new Date(params[0] as string).getTime();
      expect(timestamp).toBeGreaterThanOrEqual(before);
      expect(timestamp).toBeLessThanOrEqual(after);
    });
  });
  describe('readOnboardingState', () => {
    const userId = 'user-1';
    const queryOneMock = vi.mocked(queryOne);

    function stubRow(row: OnboardingRow | null): void {
      queryOneMock.mockClear();
      queryOneMock.mockResolvedValue(row);
    }

    it('projects a pending row as needing onboarding', async () => {
      stubRow({ onboarding_completed_at: null, onboarding_skipped_at: null });

      await expect(readOnboardingState(userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: true,
      } satisfies OnboardingPayload);
    });

    it('projects a skipped row with needs_onboarding=false', async () => {
      stubRow({ onboarding_completed_at: null, onboarding_skipped_at: '2026-07-11T00:00:00Z' });

      await expect(readOnboardingState(userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-11T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('projects a completed row with needs_onboarding=false', async () => {
      stubRow({ onboarding_completed_at: '2026-07-10T00:00:00Z', onboarding_skipped_at: null });

      await expect(readOnboardingState(userId)).resolves.toEqual({
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: null,
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('defaults to not-needed when the profile row is missing (null)', async () => {
      stubRow(null);

      await expect(readOnboardingState(userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('issues the sole two-column SELECT scoped to the user id', async () => {
      stubRow(null);

      await readOnboardingState(userId);

      expect(queryOneMock).toHaveBeenCalledTimes(1);
      const [sql, params] = queryOneMock.mock.calls[0];
      expect(sql).toContain('user_profiles');
      expect(sql).toContain('onboarding_completed_at');
      expect(sql).toContain('onboarding_skipped_at');
      expect(params).toEqual([userId]);
    });
  });

  describe('skipOnboarding', () => {
    const userId = 'user-1';

    const callFunctionMock = vi.mocked(callFunction);

    function stubRows(rows: OnboardingRow[]): void {
      callFunctionMock.mockClear();
      callFunctionMock.mockResolvedValue(rows);
    }

    it('transitions pending -> skipped via the skip RPC projection', async () => {
      stubRows([{ onboarding_completed_at: null, onboarding_skipped_at: '2026-07-12T00:00:00Z' }]);

      await expect(skipOnboarding(userId)).resolves.toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: '2026-07-12T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('preserves completed + skipped timestamps from the RPC row', async () => {
      // A user who skipped earlier and later completed keeps both timestamps.
      stubRows([
        {
          onboarding_completed_at: '2026-07-10T00:00:00Z',
          onboarding_skipped_at: '2026-07-09T00:00:00Z',
        },
      ]);

      await expect(skipOnboarding(userId)).resolves.toEqual({
        onboarding_completed_at: '2026-07-10T00:00:00Z',
        onboarding_skipped_at: '2026-07-09T00:00:00Z',
        needs_onboarding: false,
      } satisfies OnboardingPayload);
    });

    it('returns null when the RPC yields no rows', async () => {
      stubRows([]);

      await expect(skipOnboarding(userId)).resolves.toBeNull();
    });

    it('calls skip_onboarding with the user id as its sole argument', async () => {
      stubRows([{ onboarding_completed_at: null, onboarding_skipped_at: null }]);

      await skipOnboarding(userId);

      expect(callFunctionMock).toHaveBeenCalledTimes(1);
      expect(callFunctionMock).toHaveBeenCalledWith('skip_onboarding', [userId]);
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
      // The skip RPC sets skipped_at; projection reflects it.
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
      // skipped_at is preserved, not wiped to null.
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
