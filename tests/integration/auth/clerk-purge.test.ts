import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { deleteClerkUser } = vi.hoisted(() => ({ deleteClerkUser: vi.fn() }));

vi.mock("@/lib/auth/clerk-session", () => ({ deleteClerkUser }));

import { ClerkIdentityDeletionIncomplete } from "@/lib/auth/clerk-errors";
import { deleteExpiredClerkIdentities } from "@/lib/auth/clerk-purge";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";

describe("deleteExpiredClerkIdentities", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("deletes the Clerk identity of every expired account", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ clerk_user_id: "user_a" }, { clerk_user_id: "user_b" }]);
    deleteClerkUser.mockResolvedValue(undefined);

    expect(await deleteExpiredClerkIdentities(pg.db)).toBe(2);
    expect(deleteClerkUser.mock.calls).toEqual([["user_a"], ["user_b"]]);
  });

  it("attempts every account, then fails so the purge keeps the rows it still needs", async () => {
    const pg = createScriptedPostgres();
    pg.next([
      { clerk_user_id: "user_a" },
      { clerk_user_id: "user_b" },
      { clerk_user_id: "user_c" },
    ]);
    deleteClerkUser
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce(undefined);

    const error = await deleteExpiredClerkIdentities(pg.db).catch((thrown: Error) => thrown);

    expect(deleteClerkUser).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(ClerkIdentityDeletionIncomplete);
    expect(error).toMatchObject({ failed: 1, total: 3, retryable: true });
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Failed to delete expired Clerk identity",
        clerk_user_id: "user_b",
      }),
    );
  });
});
