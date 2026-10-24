import {
  ApiError,
  AuthError,
  NotFoundError,
  RateLimitError,
  fetchClassFromASU,
} from "@/lib/asu/api";
import { readSectionCheckState } from "@/lib/db/queries";
import { RATE_LIMIT_RETRY_BASE_S, RATE_LIMIT_RETRY_MAX_S } from "@/lib/config";
import type { Database } from "@/lib/db";
import { isPermanentFailure } from "@/lib/effect/failure";
import { errorFields, log } from "@/lib/log";
import { type SectionRef, sectionFields } from "@/lib/section-ref";
import { type ChangeResult, detectChanges } from "@/lib/queue/change-detector";
import {
  deliverPendingNotifications,
  NotificationLeaseBusy,
  type RecordedSectionCheck,
  recordSectionCheck,
} from "@/lib/queue/pending-notifications";
import { type SectionRetirementOutcome, retireClassSection } from "@/lib/queue/section-retirement";
import type { Env } from "@/lib/types/env";
import type { ClassCheckMessage } from "@/lib/types/queue";

interface ProcessingResult {
  success: boolean;
  classNbr: string;
  changes: ChangeResult;
  emailsSent: number;
  processingTimeMs: number;
  error?: string;
  retirement?: SectionRetirementOutcome;
}

type Disposition = "ack" | "retry";

export type SectionCheckOutcome = {
  disposition: Disposition;
  result: ProcessingResult;
  httpStatus: 200 | 429 | 502 | 500;
  retryable: boolean;
  /** ASU Retry-After, or the wait for an existing notification delivery lease. */
  retryAfterSeconds?: number;
};

export type ProcessSectionDeps = {
  fetchClass: typeof fetchClassFromASU;
};

/**
 * SectionRef plus the queue message's cron cycle stamp (`ClassCheckMessage.cycle`).
 * The worker hands `processSection` the whole message body, so the stamp rides
 * along without a second parameter.
 */
type SectionCheckInput = SectionRef & Pick<ClassCheckMessage, "cycle">;

function emptyChanges(): ChangeResult {
  return {
    seatBecameAvailable: false,
    seatsFilled: false,
    instructorAssigned: false,
    newOpenSeats: 0,
  };
}

function ackOutcome(result: ProcessingResult): SectionCheckOutcome {
  return { disposition: "ack", result, httpStatus: 200, retryable: false };
}

function retryOutcome(result: ProcessingResult, httpStatus: 429 | 502 | 500): SectionCheckOutcome {
  return { disposition: "retry", result, httpStatus, retryable: true };
}

/**
 * A thrown failure that carries `retryable: false` anywhere in its cause chain
 * (a constraint violation, a rejected payload) fails the same way on every
 * delivery, so it is acked; the next Cron Cycle checks the section again.
 */
function thrownOutcome(permanent: boolean, result: ProcessingResult): SectionCheckOutcome {
  return permanent ? ackOutcome(result) : retryOutcome(result, 500);
}

function failedResult(classNbr: string, duration: number, error: string): ProcessingResult {
  return {
    success: false,
    classNbr,
    changes: emptyChanges(),
    emailsSent: 0,
    processingTimeMs: duration,
    error,
  };
}

class SectionStateWriteFailed extends Error {
  constructor(
    message: string,
    cause: unknown,
    public changes: ChangeResult,
    public emailsSent: number,
  ) {
    super(message, { cause });
  }
}

type SectionCheckEnv = Pick<
  Env,
  "ASU_API_BASE_URL" | "ASU_API_TOKEN" | "EMAIL" | "NOTIFICATION_FROM_EMAIL"
>;

export async function processSection(
  db: Database,
  ref: SectionCheckInput,
  env: SectionCheckEnv,
  overrides: Partial<ProcessSectionDeps> = {},
): Promise<SectionCheckOutcome> {
  const fetchClass = overrides.fetchClass ?? fetchClassFromASU;
  const startTime = Date.now();
  const { class_nbr: classNbr, cycle } = ref;
  const failure = (message: string) => failedResult(classNbr, Date.now() - startTime, message);

  try {
    let oldState = await readSectionCheckState(db, ref);
    let emailsSent = 0;

    // Resume pending intent before the cycle guard. Expired intents are flagged
    // too, and delivery clears them. Re-read so the guard sees post-delivery state.
    if (oldState?.has_pending_intent) {
      emailsSent = await deliverPendingNotifications(db, ref, env);
      oldState = await readSectionCheckState(db, ref);
    }

    if (cycle && oldState?.last_checked_at && oldState.last_checked_at >= cycle) {
      log("ProcessSection").info("Skipping section already checked this cycle", {
        ...sectionFields(ref),
        cycle,
        last_checked_at: oldState.last_checked_at,
      });

      return ackOutcome({
        success: true,
        classNbr,
        changes: emptyChanges(),
        emailsSent,
        processingTimeMs: Date.now() - startTime,
      });
    }

    const newData = await fetchClass(ref, env, { useCache: false, source: "section_check" });
    const observedAt = new Date();
    const changes = detectChanges(oldState, newData);

    // A NotFound placeholder is no prior observation either; record_section_observation
    // applies the same rule to alerts, so these flags match what was emailed.
    if (!oldState?.observed) {
      changes.seatBecameAvailable = false;
      changes.instructorAssigned = false;
    }

    let recorded: RecordedSectionCheck;

    try {
      recorded = await recordSectionCheck(db, ref, newData, observedAt);
    } catch (error) {
      throw new SectionStateWriteFailed(
        errorFields(error)["error.message"],
        error,
        changes,
        emailsSent,
      );
    }

    if (!recorded.applied) {
      log("ProcessSection").info(
        "Skipping section, a newer observation or pending notification is already stored",
        { ...sectionFields(ref), cycle },
      );

      return ackOutcome({
        success: true,
        classNbr,
        changes: emptyChanges(),
        emailsSent,
        processingTimeMs: Date.now() - startTime,
      });
    }

    if (recorded.intentCreated) emailsSent += await deliverPendingNotifications(db, ref, env);

    return ackOutcome({
      success: true,
      classNbr,
      changes,
      emailsSent,
      processingTimeMs: Date.now() - startTime,
    });
  } catch (error) {
    const fields = errorFields(error);
    const message = fields["error.message"];
    log("ProcessSection").error("Section Check failed", {
      ...sectionFields(ref),
      cycle,
      ...fields,
    });

    if (error instanceof SectionStateWriteFailed)
      return thrownOutcome(isPermanentFailure(error), {
        ...failure(message),
        changes: error.changes,
        emailsSent: error.emailsSent,
      });

    if (error instanceof NotFoundError) {
      let retirement: SectionRetirementOutcome;

      try {
        retirement = await retireClassSection({
          db,
          ref,
          emailBinding: env.EMAIL,
          fromEmail: env.NOTIFICATION_FROM_EMAIL,
        });
      } catch (retireError) {
        const retireFields = errorFields(retireError);
        log("ProcessSection").error("Section retirement failed", {
          ...sectionFields(ref),
          ...retireFields,
        });

        return thrownOutcome(
          retireError instanceof Error && isPermanentFailure(retireError),
          failure(retireFields["error.message"]),
        );
      }

      if (retirement.deleted)
        return ackOutcome({
          success: true,
          classNbr,
          changes: emptyChanges(),
          emailsSent: retirement.emailsSucceeded,
          processingTimeMs: Date.now() - startTime,
          error: "Auto-cleanup: class removed after 3 NotFounds",
          retirement,
        });

      return ackOutcome({ ...failure(message), retirement });
    }

    if (error instanceof AuthError) return ackOutcome(failure(message));

    if (error instanceof RateLimitError)
      return {
        ...retryOutcome(failure(message), 429),
        retryAfterSeconds: error.retryAfterSeconds,
      };

    if (error instanceof ApiError)
      return error.retryable ? retryOutcome(failure(message), 502) : ackOutcome(failure(message));

    if (error instanceof NotificationLeaseBusy)
      return { ...retryOutcome(failure(message), 500), retryAfterSeconds: error.retryAfterSeconds };

    return thrownOutcome(error instanceof Error && isPermanentFailure(error), failure(message));
  }
}

/**
 * Queue redelivery delay for a retry outcome. Rate-limited checks back off
 * exponentially per delivery attempt (honouring a longer `Retry-After`), capped
 * so the retry still lands before the section's next cycle. Other retries use
 * the consumer's configured `retry_delay` (undefined), except busy notification
 * intents, which wait for the current owner's lease to expire.
 */
export function retryDelaySeconds(
  outcome: SectionCheckOutcome,
  attempts: number,
): number | undefined {
  if (outcome.httpStatus !== 429) return outcome.retryAfterSeconds;

  const backoff = RATE_LIMIT_RETRY_BASE_S * 2 ** Math.max(0, attempts - 1);

  return Math.min(RATE_LIMIT_RETRY_MAX_S, Math.max(backoff, outcome.retryAfterSeconds ?? 0));
}
