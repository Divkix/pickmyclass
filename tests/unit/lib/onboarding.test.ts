import { describe, expect, it, vi } from 'vite-plus/test';
import {
  applyFirstWatchGuard,
  completeOnFirstWatch,
  onboardingStatus,
  toOnboardingState,
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
    it('guards only on onboarding_completed_at IS NULL (not skipped_at)', () => {
      // eslint-disable-next-line anti-slop/no-unknown-parameters -- SAFETY: test helper decodes unknown at I/O boundary
      const is = vi.fn(function (this: OnboardingState) {
        return this;
      });
      // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
      const builder = { is } as Parameters<typeof applyFirstWatchGuard>[0];

      applyFirstWatchGuard(builder);

      expect(is).toHaveBeenCalledTimes(1);
      expect(is).toHaveBeenCalledWith('onboarding_completed_at', null);
    });

    it('never guards on onboarding_skipped_at (skipped users still complete)', () => {
      const calls: Array<[string, null]> = [];
      // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
      const builder = {
        is(column: string, value: null) {
          calls.push([column, value]);
          return this;
        },
      } as Parameters<typeof applyFirstWatchGuard>[0];

      applyFirstWatchGuard(builder);

      expect(calls.find(([column]) => column === 'onboarding_skipped_at')).toBeUndefined();
    });

    it('returns the guarded builder so the call is awaitable', () => {
      const sentinel = { is: () => sentinel };
      // SAFETY: test double constructs minimal shape for SDK contract; only accessed fields are asserted
      const builder = sentinel as Parameters<typeof applyFirstWatchGuard>[0];
      expect(applyFirstWatchGuard(builder)).toBe(sentinel);
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
