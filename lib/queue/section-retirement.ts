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

export interface SectionRetirementParams {
  db: Database;
  ref: SectionRef;
  emailBinding: SendEmail;
  fromEmail?: string;
}

export type SectionRetirementStatus =
  | 'tracked'
  | 'increment-failed'
  | 'suppressed'
  | 'watcher-read-failed'
  | 'delete-failed'
  | 'retired';

export interface SectionRetirementOutcome {
  status: SectionRetirementStatus;
  strikeCount: number | null;
  suppressed: boolean;
  deleted: boolean;
  watchesDeleted: number;
  emailsAttempted: number;
  emailsSucceeded: number;
}

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

export async function retireClassSection(
  params: SectionRetirementParams
): Promise<SectionRetirementOutcome> {
  const { db, ref, emailBinding, fromEmail } = params;
  const scope = sectionRefKey(ref);

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

  const suppressed = await isAutoCleanupSuppressed(db);
  if (suppressed) {
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

  let emailsAttempted = 0;
  let emailsSucceeded = 0;
  try {
    const results = await sendAutoCleanupRemovalEmails(
      { ref, classInfo, watchers },
      emailBinding,
      fromEmail
    );
    emailsAttempted = results.filter((r) => r.attempted).length;
    emailsSucceeded = results.filter((r) => r.success).length;
  } catch (emailError) {
    log('SectionRetirement').warn(`Auto-cleanup email failed for ${scope}:`, emailError);
  }

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
