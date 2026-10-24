import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { deleteClerkUser } = vi.hoisted(() => ({ deleteClerkUser: vi.fn() }));

vi.mock("@/lib/auth/clerk-session", () => ({ deleteClerkUser }));

import { ClerkIdentityDeletionIncomplete } from "@/lib/auth/clerk-errors";
import { purgeExpiredAccounts } from "@/lib/auth/clerk-purge";
import { CLERK_PURGE_BATCH_SIZE } from "@/lib/config";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";

const purgeRow = { accounts_purged: 2, notifications_purged: 5, class_states_purged: 1 };

describe("purgeExpiredAccounts", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("deletes one batch of identities, then purges those accounts", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ clerk_user_id: "user_a" }, { clerk_user_id: "user_b" }]);
    pg.next([purgeRow]);
    deleteClerkUser.mockResolvedValue(undefined);

    expect(await purgeExpiredAccounts(pg.db)).toEqual({
      accountsPurged: 2,
      notificationsPurged: 5,
      classStatesPurged: 1,
      clerkIdentitiesDeleted: 2,
    });
    expect(pg.statements[0].params).toEqual([CLERK_PURGE_BATCH_SIZE]);
    expect(pg.statements[1].sql).toContain("purge_expired_data");
    expect(pg.statements[1].params).toEqual(["user_a", "user_b"]);
  });

  it("purges only the confirmed accounts, then fails so the step retries the rest", async () => {
    const pg = createScriptedPostgres();
    pg.next([
      { clerk_user_id: "user_a" },
      { clerk_user_id: "user_b" },
      { clerk_user_id: "user_c" },
    ]);
    pg.next([purgeRow]);
    deleteClerkUser
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce(undefined);

    const error = await purgeExpiredAccounts(pg.db).catch((thrown: Error) => thrown);

    expect(deleteClerkUser).toHaveBeenCalledTimes(3);
    expect(pg.statements[1].params).toEqual(["user_a", "user_c"]);
    expect(error).toBeInstanceOf(ClerkIdentityDeletionIncomplete);
    expect(error).toMatchObject({ failed: 1, total: 3, retryable: true });
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Failed to delete expired Clerk identity",
        clerk_user_id: "user_b",
      }),
    );
  });

  it("still purges the rest of the expired data when no identity is due", async () => {
    const pg = createScriptedPostgres();
    pg.next([]);
    pg.next([purgeRow]);

    expect(await purgeExpiredAccounts(pg.db)).toMatchObject({ clerkIdentitiesDeleted: 0 });
    expect(pg.statements[1].sql).toContain("ARRAY[]::text[]");
  });
});
