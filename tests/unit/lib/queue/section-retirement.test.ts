/**
 * Unit tests for the NotFound end-of-life lifecycle in
 * `lib/queue/section-retirement.ts` (issue #360).
 *
 * Exercises `retireClassSection` directly through its seams: the
 * `@/lib/db/queries` helpers and the auto-cleanup email sender are mocked,
 * so no database or email traffic is involved and every branch of the
 * outcome/failure ladder is deterministic:
 *
 * tracked strikes -> increment failure -> breaker (strict > ratio,
 * fail-open) -> suppressed (+cap success/failure) -> watcher read failure ->
 * class-info degradation -> delete failure / delete-before-email ordering /
 * unexpected sender throw -> truthful watchesDeleted / emailsAttempted /
 * emailsSucceeded counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE, AUTO_CLEANUP_THRESHOLD } from '@/lib/config';

// Query seams — the only DB surface the retirement module touches.
vi.mock('@/lib/db/queries', () => ({
  readAutoCleanupBreakerCounts: vi.fn(),
  capConsecutiveNotFound: vi.fn(),
  readSectionRemovalClassInfo: vi.fn(),
  getClassWatchers: vi.fn(),
  incrementConsecutiveNotFound: vi.fn(),
  deleteSectionAndWatches: vi.fn(),
}));

// Auto-cleanup sender — truncation to the per-cycle cap lives inside the sender.
vi.mock('@/lib/email/templates/auto-cleanup', () => ({
  sendAutoCleanupRemovalEmails: vi.fn(),
}));

import type { Database } from '@/lib/db';
import {
  capConsecutiveNotFound,
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  readAutoCleanupBreakerCounts,
  readSectionRemovalClassInfo,
  type ClassWatcher,
  type SectionRemovalClassInfo,
} from '@/lib/db/queries';
import { sendAutoCleanupRemovalEmails } from '@/lib/email/templates/auto-cleanup';
import { retireClassSection } from '@/lib/queue/section-retirement';
import type { SectionRef } from '@/lib/section-ref';
import type { SendEmail } from '@/lib/types/env';

const REF: SectionRef = { class_nbr: '42737', term: '2261' };
const FROM_EMAIL = 'notifications@pickmyclass.app';

/** Sentinel Drizzle handle — identity-only; every DB seam below is mocked. */
const db = {} as Database;

const DEFAULT_CLASS_INFO: SectionRemovalClassInfo = {
  subject: 'CSE',
  catalog_nbr: '110',
  title: 'Principles of Programming',
};

function buildWatcher(n: number): ClassWatcher {
  return { user_id: `user-${n}`, email: `user-${n}@example.com`, watch_id: `watch-${n}` };
}

function buildWatchers(count: number): ClassWatcher[] {
  return Array.from({ length: count }, (_, n) => buildWatcher(n));
}

function buildEmailBinding(): SendEmail {
  return { send: vi.fn().mockResolvedValue({ messageId: 'msg_test' }) };
}

/** Per-watch sender results keyed to buildWatcher(n)/buildWatchers order; every row reflects a real transport call. */
function senderResults(successFlags: boolean[]) {
  return successFlags.map((success, n) =>
    success
      ? { success: true, attempted: true, watchId: `watch-${n}` }
      : { success: false, attempted: true, watchId: `watch-${n}`, error: 'send failed' }
  );
}

/** Move the lifecycle just past the increment/threshold gate (3rd strike). */
function setupAtThreshold(): void {
  vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(AUTO_CLEANUP_THRESHOLD);
}

function retire(emailBinding: SendEmail = buildEmailBinding()) {
  return retireClassSection({ db, ref: REF, emailBinding, fromEmail: FROM_EMAIL });
}

describe('retireClassSection', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});

    // Reset all mocks to clear call history from previous tests,
    // then re-apply default implementations
    vi.resetAllMocks();

    // Defaults: strike 1, healthy breaker, benign downstream no-ops — each
    // test overrides only the seam under scrutiny.
    vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);
    vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total: 10, flagged: 1 });
    vi.mocked(capConsecutiveNotFound).mockResolvedValue(undefined);
    vi.mocked(readSectionRemovalClassInfo).mockResolvedValue(DEFAULT_CLASS_INFO);
    vi.mocked(getClassWatchers).mockResolvedValue([]);
    vi.mocked(deleteSectionAndWatches).mockResolvedValue({ watchesDeleted: 0, stateDeleted: true });
    vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('strike tracking', () => {
    it('tracks strike 1 and stops before any downstream work', async () => {
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(1);

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'tracked',
        strikeCount: 1,
        suppressed: false,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });

      // Below threshold: none of the end-of-life machinery may run.
      expect(readAutoCleanupBreakerCounts).not.toHaveBeenCalled();
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
      expect(readSectionRemovalClassInfo).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });

    it('tracks strike 2 below the threshold', async () => {
      vi.mocked(incrementConsecutiveNotFound).mockResolvedValue(2);

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'tracked',
        strikeCount: 2,
        suppressed: false,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });

    it('stops immediately when the strike increment fails', async () => {
      vi.mocked(incrementConsecutiveNotFound).mockRejectedValue(new Error('rpc unavailable'));

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'increment-failed',
        strikeCount: null,
        suppressed: false,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });

      // Lifecycle halts right at the increment: not even the breaker runs.
      expect(readAutoCleanupBreakerCounts).not.toHaveBeenCalled();
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });
  });

  describe('breaker gate', () => {
    it('suppresses deletion when the flagged ratio is strictly above 0.2', async () => {
      setupAtThreshold();
      vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total: 10, flagged: 3 });

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'suppressed',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: true,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });

      // Suppression caps the counter just below the threshold...
      expect(capConsecutiveNotFound).toHaveBeenCalledWith(db, REF, AUTO_CLEANUP_THRESHOLD - 1);

      // ...and short-circuits everything downstream of the breaker.
      expect(readSectionRemovalClassInfo).not.toHaveBeenCalled();
      expect(getClassWatchers).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });

    it('proceeds when the flagged ratio is exactly 0.2 (strict > boundary)', async () => {
      setupAtThreshold();
      // 2/10 === 0.2 — must NOT trip the breaker; retirement continues.
      vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total: 10, flagged: 2 });
      const watchers = buildWatchers(1);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true]));

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'retired',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: false,
        deleted: true,
      });
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
    });

    it('fails open when the breaker counts cannot be read', async () => {
      setupAtThreshold();
      vi.mocked(readAutoCleanupBreakerCounts).mockRejectedValue(new Error('count query blew up'));
      const watchers = buildWatchers(1);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true]));

      const outcome = await retire();

      // Fail open: an unreadable breaker must not block a legitimate retirement.
      expect(outcome.status).toBe('retired');
      expect(outcome.suppressed).toBe(false);
      expect(outcome.deleted).toBe(true);
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
    });
  });

  describe('suppressed cap write', () => {
    it('reports suppressed even when the cap write fails', async () => {
      setupAtThreshold();
      vi.mocked(readAutoCleanupBreakerCounts).mockResolvedValue({ total: 10, flagged: 3 });
      vi.mocked(capConsecutiveNotFound).mockRejectedValue(new Error('cap update failed'));

      const outcome = await retire();

      // Cap failure is logged and swallowed: suppression stands either way.
      expect(outcome).toMatchObject({
        status: 'suppressed',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: true,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
      expect(capConsecutiveNotFound).toHaveBeenCalledTimes(1);
    });
  });

  describe('watcher and class-info reads', () => {
    it('aborts deletion when the watcher read fails', async () => {
      setupAtThreshold();
      vi.mocked(getClassWatchers).mockRejectedValue(new Error('watcher read failed'));

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'watcher-read-failed',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: false,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });

      // Watcher failure aborts the whole tail: no cap, no delete, no email.
      expect(capConsecutiveNotFound).not.toHaveBeenCalled();
      expect(deleteSectionAndWatches).not.toHaveBeenCalled();
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });

    it('degrades class-info failure to null and still deletes and emails', async () => {
      setupAtThreshold();
      vi.mocked(readSectionRemovalClassInfo).mockRejectedValue(new Error('class info failed'));
      const watchers = buildWatchers(1);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 5,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true]));
      const emailBinding = buildEmailBinding();

      const outcome = await retire(emailBinding);

      expect(outcome).toMatchObject({
        status: 'retired',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: false,
        deleted: true,
        watchesDeleted: 5,
        emailsAttempted: 1,
        emailsSucceeded: 1,
      });

      // Sender still runs, with classInfo degraded to null and bindings forwarded.
      const [params, sentBinding, sentFrom] = vi.mocked(sendAutoCleanupRemovalEmails).mock.calls[0];
      expect(params.ref).toEqual(REF);
      expect(params.classInfo).toBeNull();
      expect(params.watchers).toEqual(watchers);
      expect(sentBinding).toBe(emailBinding);
      expect(sentFrom).toBe(FROM_EMAIL);
    });
  });

  describe('delete-before-email and sender failures', () => {
    it('sends nothing when deletion fails', async () => {
      setupAtThreshold();
      const watchers = buildWatchers(2);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockRejectedValue(new Error('delete failed'));

      const outcome = await retire();

      expect(outcome).toMatchObject({
        status: 'delete-failed',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: false,
        deleted: false,
        watchesDeleted: 0,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
      // Watches still exist — emailing them would be wrong.
      expect(sendAutoCleanupRemovalEmails).not.toHaveBeenCalled();
    });

    it('deletes watches before sending removal emails', async () => {
      setupAtThreshold();
      const watchers = buildWatchers(2);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 2,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true, true]));

      const outcome = await retire();

      expect(outcome.status).toBe('retired');
      expect(outcome.deleted).toBe(true);

      // Invocation order is the guarantee: watches are gone before any email.
      const deleteOrder = vi.mocked(deleteSectionAndWatches).mock.invocationCallOrder[0];
      const sendOrder = vi.mocked(sendAutoCleanupRemovalEmails).mock.invocationCallOrder[0];
      expect(deleteOrder).toBeLessThan(sendOrder);
    });

    it('keeps the section deleted when the sender throws unexpectedly', async () => {
      setupAtThreshold();
      const watchers = buildWatchers(1);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 7,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockRejectedValue(new Error('smtp exploded'));

      const outcome = await retire();

      // Deletion already happened; an email crash must not undo or retry it.
      expect(outcome).toMatchObject({
        status: 'retired',
        strikeCount: AUTO_CLEANUP_THRESHOLD,
        suppressed: false,
        deleted: true,
        watchesDeleted: 7,
        emailsAttempted: 0,
        emailsSucceeded: 0,
      });
    });
  });

  describe('truthful counts and SectionRef propagation', () => {
    it('reports partial sender failures truthfully', async () => {
      setupAtThreshold();
      const watchers = buildWatchers(3);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 3,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true, false, true]));

      const outcome = await retire();

      expect(outcome.status).toBe('retired');
      expect(outcome.watchesDeleted).toBe(3);
      expect(outcome.emailsAttempted).toBe(3);
      expect(outcome.emailsSucceeded).toBe(2);
    });

    it('counts only real sends when the sender aborts fatally and skips the remainder', async () => {
      setupAtThreshold();
      const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
      const watchers = buildWatchers(3);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 3,
        stateDeleted: true,
      });
      // Fatal provider shape (mirrors the real sender): watcher-0's transport
      // call went out and failed; the fatal code aborted the loop, so every
      // remaining watcher gets a synthetic skip row that was never attempted.
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue([
        {
          success: false,
          attempted: true,
          watchId: 'watch-0',
          error: 'E_RATE_LIMIT_EXCEEDED: rate limit exceeded',
        },
        ...watchers.slice(1).map((w) => ({
          success: false,
          attempted: false,
          watchId: w.watch_id,
          error: 'Skipped: E_RATE_LIMIT_EXCEEDED limit reached',
        })),
      ]);

      const outcome = await retire();

      // Retirement stands: deletion is committed regardless of email fate.
      expect(outcome.status).toBe('retired');
      expect(outcome.deleted).toBe(true);
      expect(outcome.watchesDeleted).toBe(3);
      // One real (failed) attempt; the two synthetic skips must not inflate
      // either count — length-based counting would have claimed 3 attempts.
      expect(outcome.emailsAttempted).toBe(1);
      expect(outcome.emailsSucceeded).toBe(0);
      // Truthful gap: 3 removed − 1 real attempt = 2 watchers never emailed.
      expect(outcome.watchesDeleted - outcome.emailsAttempted).toBe(2);
      const closingLog = infoSpy.mock.calls
        .map((args) => args.join(' '))
        .find((line) => line.includes('removed without email'));
      expect(closingLog).toBeDefined();
      expect(closingLog).toContain('emailsAttempted=1');
      expect(closingLog).toMatch(/2 removed without email/);
    });

    it('passes every watcher untruncated and reports only what the sender attempted', async () => {
      setupAtThreshold();
      // Far beyond the 500-cap: retirement must hand over ALL watchers —
      // only the sender truncates.
      const watcherCount = AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE + 37;
      const watchers = buildWatchers(watcherCount);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: watcherCount,
        stateDeleted: true,
      });
      // Mimic the real sender: truncate to the cap, alternate success/failure.
      vi.mocked(sendAutoCleanupRemovalEmails).mockImplementation(async (params) =>
        params.watchers
          .slice(0, AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE)
          .map((w, n) => ({ success: n % 2 === 0, attempted: true, watchId: w.watch_id }))
      );

      const outcome = await retire();

      const sentWatchers = vi.mocked(sendAutoCleanupRemovalEmails).mock.calls[0][0].watchers;
      expect(sentWatchers).toHaveLength(watcherCount);
      expect(sentWatchers.at(-1)).toEqual(buildWatcher(watcherCount - 1));

      expect(outcome.status).toBe('retired');
      expect(outcome.watchesDeleted).toBe(watcherCount);
      // Counts reflect the sender's truncated attempt, not the watch count.
      expect(outcome.emailsAttempted).toBe(AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE);
      expect(outcome.emailsSucceeded).toBe(AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE / 2);
    });

    it('passes the full SectionRef to every ref-taking seam', async () => {
      setupAtThreshold();
      const watchers = buildWatchers(1);
      vi.mocked(getClassWatchers).mockResolvedValue(watchers);
      vi.mocked(deleteSectionAndWatches).mockResolvedValue({
        watchesDeleted: 1,
        stateDeleted: true,
      });
      vi.mocked(sendAutoCleanupRemovalEmails).mockResolvedValue(senderResults([true]));

      const outcome = await retire();

      expect(outcome.status).toBe('retired');

      // Every seam keys on BOTH class_nbr and term — dropping either would
      // mis-key across terms.
      const expectedRef: SectionRef = { class_nbr: '42737', term: '2261' };
      expect(incrementConsecutiveNotFound).toHaveBeenCalledWith(db, expectedRef);
      expect(readSectionRemovalClassInfo).toHaveBeenCalledWith(db, expectedRef);
      expect(getClassWatchers).toHaveBeenCalledWith(db, expectedRef);
      expect(deleteSectionAndWatches).toHaveBeenCalledWith(db, expectedRef);
      expect(vi.mocked(sendAutoCleanupRemovalEmails).mock.calls[0][0].ref).toEqual(expectedRef);
    });
  });
});
