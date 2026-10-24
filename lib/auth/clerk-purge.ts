/**
 * Deletes the Clerk identity of every account the retention purge is about to
 * remove. The privacy policy promises disabled accounts are "permanently
 * deleted" after 30 days; the `users` row alone is not the account, because
 * Clerk keeps the email, name and credentials.
 *
 * Runs before `purgeExpiredData`: the purge drops the row that maps an account
 * to its Clerk id, so a failure here must stop the purge and leave the row for
 * the next run to retry.
 *
 * @module lib/auth/clerk-purge
 */
import { ClerkIdentityDeletionIncomplete } from "@/lib/auth/clerk-errors";
import { deleteClerkUser } from "@/lib/auth/clerk-session";
import type { Database } from "@/lib/db";
import { listExpiredClerkIdentities } from "@/lib/db/queries";
import { errorFields, log } from "@/lib/log";

/** Attempts every account, then reports the ones that kept their identity. */
export async function deleteExpiredClerkIdentities(db: Database): Promise<number> {
  const clerkUserIds = await listExpiredClerkIdentities(db);

  const results = await Promise.allSettled(clerkUserIds.map((id) => deleteClerkUser(id)));

  let failed = 0;

  for (const [index, result] of results.entries()) {
    if (result.status === "fulfilled") continue;
    failed += 1;
    log("ClerkPurge").error("Failed to delete expired Clerk identity", {
      clerk_user_id: clerkUserIds[index],
      ...errorFields(result.reason),
    });
  }

  if (failed > 0) {
    throw new ClerkIdentityDeletionIncomplete({
      message: `Deleted ${results.length - failed} of ${results.length} expired Clerk identities`,
      failed,
      total: results.length,
      retryable: true,
    });
  }

  return results.length;
}
