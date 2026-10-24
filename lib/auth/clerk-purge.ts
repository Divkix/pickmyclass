/**
 * The retention purge for expired accounts. The privacy policy promises
 * disabled accounts are "permanently deleted" after 30 days; the `users` row
 * alone is not the account, because Clerk keeps the email, name and
 * credentials.
 *
 * The purge drops the row that maps an account to its Clerk id, so it only
 * takes the accounts whose identity Clerk confirmed gone. Identities go in
 * batches of `CLERK_PURGE_BATCH_SIZE` (each delete is a subrequest); the rest
 * keep their rows for the next run.
 *
 * @module lib/auth/clerk-purge
 */
import { ClerkIdentityDeletionIncomplete } from "@/lib/auth/clerk-errors";
import { deleteClerkUser } from "@/lib/auth/clerk-session";
import { CLERK_PURGE_BATCH_SIZE } from "@/lib/config";
import type { Database } from "@/lib/db";
import { type PurgedData, listExpiredClerkIdentities, purgeExpiredData } from "@/lib/db/queries";
import { errorFields, log } from "@/lib/log";

export type RetentionPurge = PurgedData & { clerkIdentitiesDeleted: number };

/**
 * Deletes one batch of Clerk identities, purges the confirmed accounts and the
 * other expired data, then fails if any identity survived so the step retries it.
 */
export async function purgeExpiredAccounts(db: Database): Promise<RetentionPurge> {
  const clerkUserIds = await listExpiredClerkIdentities(db, CLERK_PURGE_BATCH_SIZE);

  const outcomes = await Promise.all(
    clerkUserIds.map((id) =>
      deleteClerkUser(id).then(
        () => id,
        (error: Error) => {
          log("ClerkPurge").error("Failed to delete expired Clerk identity", {
            clerk_user_id: id,
            ...errorFields(error),
          });

          return null;
        },
      ),
    ),
  );

  const deleted = outcomes.flatMap((id) => (id === null ? [] : [id]));
  const purged = await purgeExpiredData(db, deleted);
  const failed = clerkUserIds.length - deleted.length;

  if (failed > 0) {
    throw new ClerkIdentityDeletionIncomplete({
      message: `Deleted ${deleted.length} of ${clerkUserIds.length} expired Clerk identities`,
      failed,
      total: clerkUserIds.length,
      retryable: true,
    });
  }

  return { ...purged, clerkIdentitiesDeleted: deleted.length };
}
