import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { deliverPendingNotifications } from "@/lib/queue/pending-notifications";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { changes, claim, details, environment, ref, watcher } from "./fixtures";

const pending = {
  id: "intent-1",
  class_nbr: ref.class_nbr,
  term: ref.term,
  class_info: { ...details, ...ref },
  changes: { ...changes },
  expires_at: "2026-10-15T15:00:00.000Z",
  lease_id: null,
  leased_until: null,
};

describe("deliverPendingNotifications", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps the intent for a retry when a failed claim cannot be rolled back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([pending]);
    pg.next([pending]);
    pg.next([watcher]);
    pg.next([claim]);
    pg.failNext(new Error("connection reset"));
    pg.next();
    const env = environment();
    env.send.mockRejectedValueOnce(new Error("temporary"));

    // The unconfirmed claim stays on the intent, so the retry resumes it instead of treating the watcher as notified.
    await expect(deliverPendingNotifications(pg.db, ref, env)).rejects.toThrow(
      "Notification delivery incomplete",
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Failed to roll back notification records" }),
    );
    expect(
      pg.statements.some((s) => s.sql.startsWith('delete from "pending_section_notifications"')),
    ).toBe(false);
    expect(pg.statements.at(-1)?.sql).toMatch(/^update "pending_section_notifications"/);
  });
});
