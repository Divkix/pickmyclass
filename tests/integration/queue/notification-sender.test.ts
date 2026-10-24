import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EMAIL_SEND_TIMEOUT_MS } from "@/lib/config";
import { sendSectionNotifications } from "@/lib/queue/notification-sender";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { changes, claim, details, environment, ref, watcher } from "./fixtures";

describe("sendSectionNotifications", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rolls back acquired claims when template preparation throws", async () => {
    const pg = createScriptedPostgres();
    pg.next([watcher]);
    pg.next([claim]);
    pg.next();
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "");
    const env = environment();

    await expect(
      sendSectionNotifications({
        db: pg.db,
        ref,
        classInfo: { ...details, ...ref },
        changes,
        emailBinding: env.EMAIL,
      }),
    ).rejects.toThrow();
    expect(env.send).not.toHaveBeenCalled();
    expect(pg.statements.at(-1)?.params).toContain("claim-1");
  });

  it("sends only the watch IDs returned by the claim", async () => {
    const pg = createScriptedPostgres();
    pg.next([watcher, { ...watcher, watch_id: "unclaimed" }]);
    pg.next([claim]);
    const env = environment();
    expect(
      await sendSectionNotifications({
        db: pg.db,
        ref,
        classInfo: { ...details, ...ref },
        changes,
        emailBinding: env.EMAIL,
      }),
    ).toEqual([
      { success: true, watchId: watcher.watch_id, type: "seat_available", error: undefined },
    ]);
    expect(env.send).toHaveBeenCalledOnce();
  });

  it("rolls back the sibling claim if either claim fails", async () => {
    const pg = createScriptedPostgres();
    pg.next([watcher]);
    pg.next([claim]);
    pg.failNext(new Error("claim failed"));
    pg.next();
    const env = environment();
    await expect(
      sendSectionNotifications({
        db: pg.db,
        ref,
        classInfo: { ...details, ...ref },
        changes: { ...changes, instructorAssigned: true },
        emailBinding: env.EMAIL,
      }),
    ).rejects.toThrow("claim failed");
    expect(pg.statements.at(-1)?.params).toContain("claim-1");
    expect(env.send).not.toHaveBeenCalled();
  });

  it("rolls back only failed claim row IDs, retaining delivered claims", async () => {
    const pg = createScriptedPostgres();
    pg.next([watcher]);
    pg.next([claim]);
    pg.next([{ notification_id: "instructor-claim", class_watch_id: watcher.watch_id }]);
    pg.next();
    const env = environment();
    env.send.mockRejectedValueOnce(new Error("temporary"));

    const results = await sendSectionNotifications({
      db: pg.db,
      ref,
      classInfo: { ...details, ...ref },
      changes: { ...changes, instructorAssigned: true },
      emailBinding: env.EMAIL,
    });

    expect(results.map((r) => r.success)).toEqual([false, true]);
    expect(pg.statements.at(-1)?.params).toContain("claim-1");
    expect(pg.statements.at(-1)?.params).not.toContain("instructor-claim");
  });

  it("keeps the claim in flight when the send times out, since the provider may still deliver", async () => {
    vi.useFakeTimers();
    const pg = createScriptedPostgres();
    pg.next([watcher]);
    pg.next([claim]);
    pg.next();
    const env = environment();
    env.send.mockImplementationOnce(() => new Promise(() => {}));

    const pending = sendSectionNotifications({
      db: pg.db,
      ref,
      classInfo: { ...details, ...ref },
      changes,
      emailBinding: env.EMAIL,
    });

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    const results = await pending;
    vi.useRealTimers();

    expect(results).toEqual([
      {
        success: false,
        watchId: watcher.watch_id,
        type: "seat_available",
        error: expect.stringContaining("TIMEOUT"),
      },
    ]);
    // Nothing after the claim: a rollback would have deleted the row a retry must find.
    expect(pg.statements.flatMap((statement) => statement.params)).not.toContain("claim-1");
  });

  describe("under a delivery lease", () => {
    const delivery = { id: "intent-1", leaseId: "lease-1" };
    const second = { ...watcher, watch_id: "watch-2", email: "second@test.com" };
    const secondClaim = { notification_id: "claim-2", class_watch_id: "watch-2" };

    it("confirms each delivery before the next send, so a crash only risks the email in flight", async () => {
      const pg = createScriptedPostgres();
      pg.next([watcher, second]);
      pg.next([claim, secondClaim]);
      pg.next();
      pg.next();
      const env = environment();
      const statementsAtSend: number[] = [];

      env.send.mockImplementation(() => {
        statementsAtSend.push(pg.statements.length);

        return Promise.resolve({ messageId: "message-1" });
      });

      await sendSectionNotifications({
        db: pg.db,
        ref,
        classInfo: { ...details, ...ref },
        changes,
        emailBinding: env.EMAIL,
        delivery,
      });

      // Two statements before the first send (watchers, claim); one confirm sits between the sends.
      expect(statementsAtSend).toEqual([2, 3]);
      expect(pg.statements[2].sql).toMatch(/^update "notifications_sent"/);
      expect(pg.statements[2].params).toContain("claim-1");
      expect(pg.statements[3].params).toContain("claim-2");
    });

    it("stops the batch when a confirmation fails, keeping the sent claim and releasing the unsent one", async () => {
      const pg = createScriptedPostgres();
      pg.next([watcher, second]);
      pg.next([claim, secondClaim]);
      pg.failNext(new Error("connection reset"));
      pg.next();
      const env = environment();

      await expect(
        sendSectionNotifications({
          db: pg.db,
          ref,
          classInfo: { ...details, ...ref },
          changes,
          emailBinding: env.EMAIL,
          delivery,
        }),
      ).rejects.toThrow(/Failed query: update "notifications_sent"/);
      expect(env.send).toHaveBeenCalledTimes(1);
      // The rollback deletes the unsent claim only; the sent one stays for the retry to resume.
      expect(pg.statements.at(-1)?.params).toContain("claim-2");
      expect(pg.statements.at(-1)?.params).not.toContain("claim-1");
    });
  });
});
