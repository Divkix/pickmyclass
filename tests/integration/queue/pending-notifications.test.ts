import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EMAIL_SEND_TIMEOUT_MS } from "@/lib/config";
import { EmailTimedOut } from "@/lib/email/errors";
import {
  deliverPendingNotifications,
  NotificationDeliveryIncomplete,
} from "@/lib/queue/pending-notifications";
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
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each(["E_RECIPIENT_SUPPRESSED", "E_SENDER_NOT_VERIFIED"])(
    "completes permanent %s failures, including recipients skipped by a fatal error",
    async (code) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const pg = createScriptedPostgres();
      pg.next();
      pg.next([pending]);
      pg.next([pending]);
      pg.next([watcher, { ...watcher, watch_id: "watch-2" }]);
      pg.next([claim, { notification_id: "claim-2", class_watch_id: "watch-2" }]);
      pg.next();
      pg.next();
      const env = environment();
      env.send.mockRejectedValue(Object.assign(new Error("rejected"), { code }));

      expect(await deliverPendingNotifications(pg.db, ref, env)).toBe(0);
      expect(pg.statements.at(-1)?.sql).toMatch(/^delete from "pending_section_notifications"/);
      expect(error).toHaveBeenCalledWith(
        expect.objectContaining({
          msg: "Notification delivery failed",
          intent_id: pending.id,
          watch_id: watcher.watch_id,
          "email.code": code,
          retryable: false,
          "error.message": "rejected",
        }),
      );
      expect(JSON.stringify(error.mock.calls)).not.toContain(watcher.email);
    },
  );

  it("counts only successful sends when the remaining failures are permanent", async () => {
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([pending]);
    pg.next([pending]);
    pg.next([watcher, { ...watcher, watch_id: "watch-2" }]);
    pg.next([claim, { notification_id: "claim-2", class_watch_id: "watch-2" }]);
    pg.next();
    pg.next();
    pg.next();
    const env = environment();
    env.send.mockRejectedValueOnce(
      Object.assign(new Error("rejected"), { code: "E_RECIPIENT_SUPPRESSED" }),
    );

    expect(await deliverPendingNotifications(pg.db, ref, env)).toBe(1);
    expect(env.send).toHaveBeenCalledTimes(2);
  });

  it("keeps mixed permanent and transient failures resumable with a typed retry decision", async () => {
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([pending]);
    pg.next([pending]);
    pg.next([watcher, { ...watcher, watch_id: "watch-2" }]);
    pg.next([claim, { notification_id: "claim-2", class_watch_id: "watch-2" }]);
    pg.next();
    pg.next();
    const env = environment();
    env.send
      .mockRejectedValueOnce(
        Object.assign(new Error("permanent"), { code: "E_RECIPIENT_SUPPRESSED" }),
      )
      .mockRejectedValueOnce(
        Object.assign(new Error("temporary"), { code: "E_INTERNAL_SERVER_ERROR" }),
      );
    const attempt = deliverPendingNotifications(pg.db, ref, env);

    await expect(attempt).rejects.toBeInstanceOf(NotificationDeliveryIncomplete);
    await expect(attempt).rejects.toMatchObject({
      retryable: true,
      cause: { code: "E_INTERNAL_SERVER_ERROR", retryable: true },
    });
    expect(
      pg.statements.some((statement) =>
        statement.sql.startsWith('delete from "pending_section_notifications"'),
      ),
    ).toBe(false);
    expect(pg.statements.at(-1)?.sql).toMatch(/^update "pending_section_notifications"/);
    expect(pg.statements.at(-1)?.params).toContain(null);
  });

  it("keeps an unknown send outcome resumable and releases its lease with a typed retry", async () => {
    vi.useFakeTimers();
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([pending]);
    pg.next([pending]);
    pg.next([watcher]);
    pg.next([claim]);
    pg.next();
    const env = environment();
    env.send.mockImplementationOnce(() => new Promise(() => {}));
    const attempt = deliverPendingNotifications(pg.db, ref, env);

    const rejected = expect(attempt).rejects.toMatchObject({
      retryable: true,
      cause: expect.any(EmailTimedOut),
    });

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    await rejected;
    expect(pg.statements).toHaveLength(6);
    expect(pg.statements.at(-1)?.sql).toMatch(/^update "pending_section_notifications"/);
    expect(pg.statements.at(-1)?.params).toContain(null);
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
