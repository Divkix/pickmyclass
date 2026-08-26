/**
 * Section retirement — the end-of-life lifecycle for a Class Section that has
 * gone NotFound too many times ("auto-cleanup").
 *
 * One deep entry point, `retireClassSection`, owns everything that happens after
 * `processSection` classifies an ASU API failure as NotFound:
 *
 *   1. Record the strike (atomic RPC increment).
 *   2. Below the strike threshold -> track only.
 *   3. At the threshold -> consult the circuit breaker (strict ratio > threshold
 *      suppresses mass deletion; a breaker read error fails open).
 *   4. Suppressed -> cap the stored counter at threshold-1 so the tripped breaker
 *      does not immediately re-trigger, and stop.
 *   5. Otherwise fetch watchers and class info in parallel (a class-info failure
 *      degrades to null; a watcher failure aborts — fail-open), hard-delete the
 *      section and its watches BEFORE emailing anyone, then fan out removal
 *      emails.
 *
 * This module deliberately knows nothing about ack/retry dispositions: it reports
 * what happened (`SectionRetirementOutcome`) and the caller decides what the
 * transport should do. All NotFound paths still end up acknowledged upstream —
 * even every failure status here maps to an ack, never a retry.
 *
 * Frozen trade-offs preserved from the original inline implementation:
 * - Deletion-before-email: watchers lose their watch row before the removal mail
 *   is composed, so a crash can skip a goodbye email but can never re-delete or
 *   double-delete on retry.
 * - The sender alone enforces AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE; this module
 *   passes every watcher through untouched and reports the resulting gap.
 */

import type { Database } from '@/lib/db';
import {
  AUTO_CLEANUP_BREAKER_RATIO,
  AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
  AUTO_CLEANUP_THRESHOLD,
} from '@/lib/config';
import {
  type ClassWatcher,
  capConsecutiveNotFound,
  deleteSectionAndWatches,
  getClassWatchers,
  incrementConsecutiveNotFound,
  readAutoCleanupBreakerCounts,
  readSectionRemovalClassInfo,
  type SectionRemovalClassInfo,
} from '@/lib/db/queries';
import { sendAutoCleanupRemovalEmails } from '@/lib/email/templates/auto-cleanup';
import { log } from '@/lib/log';
import { type SectionRef, sectionRefKey } from '@/lib/section-ref';

/** Parameters for retiring a section after a NotFound classification. */
export interface SectionRetirementParams {
  /** Request-scoped Drizzle handle created once by the queue/HTTP entry point. */
  db: Database;
  /** Full SectionRef ({ class_nbr, term }) — every query is keyed by both fields. */
  ref: SectionRef;
  /** Cloudflare EMAIL binding used for removal notifications. */
  emailBinding: SendEmail;
  /** Override for the From address; falls back to the configured default. */
  fromEmail?: string;
}

/** Terminal states of the retirement ladder, in the order they can occur. */
export type SectionRetirementStatus =
  | 'tracked'
  | 'increment-failed'
  | 'suppressed'
  | 'watcher-read-failed'
  | 'delete-failed'
  | 'retired';

/** Truthful report of everything retireClassSection did (or failed to do). */
export interface SectionRetirementOutcome {
  /** Which rung of the ladder the section ended on. */
  status: SectionRetirementStatus;
  /**
   * Strike count recorded by this invocation's atomic increment. Null only when
   * the increment itself failed; otherwise always the observed post-increment
   * value, even on later failure statuses.
   */
  strikeCount: number | null;
  /** True only when the circuit breaker tripped and deletion was withheld. */
  suppressed: boolean;
  /** True only when the section and its watches were hard-deleted. */
  deleted: boolean;
  /** Watch rows removed by the deletion; 0 unless deleted. */
  watchesDeleted: number;
  /** Emails the sender reported attempting (result length, post-cap). */
  emailsAttempted: number;
  /** Emails the sender reported as successful. */
  emailsSucceeded: number;
}

/**
 * Circuit-breaker policy for auto-cleanup: suppress mass deletion when too large
 * a share of tracked sections is flagged. Strictly greater-than the configured
 * ratio (exactly-at-threshold does NOT trip). Any error reading the counts fails
 * open (returns false) so a monitoring outage can never wedge cleanup forever.
 */
async function isAutoCleanupSuppressed(db: Database): Promise<boolean> {
  try {
    const { total, flagged } = await readAutoCleanupBreakerCounts(db);

    if (total === 0) return false;

    const ratio = flagged / total;
    log('SectionRetirement').info(
      `Breaker check total=${total} flagged=${flagged} ratio=${ratio.toFixed(3)} threshold=${AUTO_CLEANUP_BREAKER_RATIO}`
    );
    if (ratio > AUTO_CLEANUP_BREAKER_RATIO) {
      log('SectionRetirement').warn('Auto-cleanup suppressed — breaker tripped');
      return true;
    }
    return false;
  } catch (e) {
    log('SectionRetirement').warn('Auto-cleanup breaker check threw, failing open:', e);
    return false;
  }
}

/**
 * Run the full NotFound retirement ladder for one section.
 *
 * Never throws: every failure mode is translated into a truthful
 * SectionRetirementOutcome so the caller can ack unconditionally. Idempotent in
 * effect — once retired, later NotFound cycles simply re-increment into an
 * empty section state.
 */
export async function retireClassSection(
  params: SectionRetirementParams
): Promise<SectionRetirementOutcome> {
  const { db, ref, emailBinding, fromEmail } = params;
  const scope = sectionRefKey(ref);

  // Step 1: Record the strike atomically (RPC prevents lost increments between workers).
  let strikeCount: number;
  try {
    strikeCount = await incrementConsecutiveNotFound(db, ref);
  } catch (incrementError) {
    log('SectionRetirement').error(`Auto-cleanup increment failed for ${scope}:`, incrementError);
    return {
      status: 'increment-failed',
      strikeCount: null,
      suppressed: false,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    };
  }
  log('SectionRetirement').warn(`Auto-cleanup increment ${scope} count=${strikeCount}`);

  // Below threshold: track only, no further action this cycle.
  if (strikeCount < AUTO_CLEANUP_THRESHOLD) {
    return {
      status: 'tracked',
      strikeCount,
      suppressed: false,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    };
  }

  // Step 2: At threshold — circuit breaker decides whether mass deletion may proceed.
  const suppressed = await isAutoCleanupSuppressed(db);
  if (suppressed) {
    // Cap the counter at threshold-1 so the tripped breaker doesn't immediately
    // re-trigger on the next NotFound; guard avoids no-op WAL writes. A cap
    // failure is logged but does not change the verdict — suppression stands.
    try {
      await capConsecutiveNotFound(db, ref, AUTO_CLEANUP_THRESHOLD - 1);
    } catch (capError) {
      log('SectionRetirement').warn(
        `Failed to cap consecutive_not_found_count for ${scope}:`,
        capError
      );
    }
    return {
      status: 'suppressed',
      strikeCount,
      suppressed: true,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    };
  }

  // Step 3: Fetch watchers (required) and class info (best-effort) in parallel.
  // A watcher rejection aborts the retirement before any deletion (fail-open:
  // the section survives to retry next cycle). A class-info rejection degrades
  // to null so emails go out with generic subject lines instead of blocking.
  let watchers: ClassWatcher[];
  let classInfo: SectionRemovalClassInfo | null;
  try {
    [watchers, classInfo] = await Promise.all([
      getClassWatchers(db, ref),
      readSectionRemovalClassInfo(db, ref).catch((): SectionRemovalClassInfo | null => null),
    ]);
  } catch (watcherError) {
    log('SectionRetirement').warn(
      `Auto-cleanup: failed to fetch watchers for ${scope}:`,
      watcherError
    );
    return {
      status: 'watcher-read-failed',
      strikeCount,
      suppressed: false,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    };
  }

  // Step 4: Delete BEFORE emailing — a watcher must never receive a "removed"
  // notice for a watch row that could survive a partial failure afterwards.
  let watchesDeleted = 0;
  try {
    const delResult = await deleteSectionAndWatches(db, ref);
    watchesDeleted = delResult.watchesDeleted;
  } catch (deleteError) {
    log('SectionRetirement').error(`Auto-cleanup delete failed for ${scope}:`, deleteError);
    return {
      status: 'delete-failed',
      strikeCount,
      suppressed: false,
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
      emailsSucceeded: 0,
    };
  }

  // Step 5: Fan out removal emails to every watcher — the sender alone applies
  // the AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE truncation. An unexpected throw here
  // must NOT undo the deletion (step 4 is committed and irrevocable by design):
  // the retirement stands, the notification gap is logged.
  let emailsAttempted = 0;
  let emailsSucceeded = 0;
  try {
    const results = await sendAutoCleanupRemovalEmails(
      { ref, classInfo, watchers },
      emailBinding,
      fromEmail
    );
    // Synthetic skipped-remainder rows after fatal provider codes were never
    // sent: only rows with attempted=true reflect real transport activity.
    emailsAttempted = results.filter((r) => r.attempted).length;
    emailsSucceeded = results.filter((r) => r.success).length;
  } catch (emailError) {
    log('SectionRetirement').warn(`Auto-cleanup email failed for ${scope}:`, emailError);
  }

  // Truthful closing log: rows removed vs emails attempted/succeeded, including
  // the cap-driven gap (watchers who were deleted out without receiving mail).
  log('SectionRetirement').info(
    `Auto-cleanup retired ${scope}: watchesDeleted=${watchesDeleted} emailsAttempted=${emailsAttempted} emailsSucceeded=${emailsSucceeded}` +
      ` (cap ${AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE}; ${Math.max(0, watchesDeleted - emailsAttempted)} removed without email — accepted trade-off vs paging)`
  );

  return {
    status: 'retired',
    strikeCount,
    suppressed: false,
    deleted: true,
    watchesDeleted,
    emailsAttempted,
    emailsSucceeded,
  };
}
