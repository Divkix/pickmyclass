import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EMAIL_SEND_TIMEOUT_MS } from "@/lib/config";
import { sendAutoCleanupRemovalEmails } from "@/lib/email/templates/auto-cleanup";
import { retireClassSection } from "@/lib/queue/section-retirement";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { details, environment, ref, watcher } from "./fixtures";

describe("Section Check retirement", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("retires the SectionRef on the third NotFound and notifies its watchers", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ new_count: 3 }]);
    pg.next([{ value: 100 }]);
    pg.next([{ value: 1 }]);
    pg.next([{ ...watcher, created_at: "2026-10-15T00:00:00.000Z" }]);
    pg.next([{ subject: details.subject, catalog_nbr: details.catalog_nbr, title: details.title }]);
    pg.next([{ id: watcher.watch_id }]);
    pg.next([{ id: "state-1" }]);
    const env = environment();
    expect(await retireClassSection({ db: pg.db, ref, emailBinding: env.EMAIL })).toMatchObject({
      status: "retired",
      strikeCount: 3,
      deleted: true,
      watchesDeleted: 1,
      emailsSucceeded: 1,
    });
    expect(pg.transactionCount).toBe(1);
    expect(pg.statements[5].params).toEqual([ref.class_nbr, ref.term]);
    expect(pg.statements[6].params).toEqual([ref.class_nbr, ref.term]);
    expect(env.send).toHaveBeenCalledOnce();
  });

  it("caps strikes and retains the section when the cleanup breaker trips", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ new_count: 3 }]);
    pg.next([{ value: 10 }]);
    pg.next([{ value: 3 }]);
    pg.next();
    const env = environment();
    expect(await retireClassSection({ db: pg.db, ref, emailBinding: env.EMAIL })).toMatchObject({
      status: "suppressed",
      suppressed: true,
      deleted: false,
      emailsAttempted: 0,
    });
    expect(pg.statements[3].params).toEqual([2, ref.class_nbr, ref.term, 2]);
    expect(pg.transactionCount).toBe(0);
    expect(env.send).not.toHaveBeenCalled();
  });

  it("logs an unreadable class name and still retires the section", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const pg = createScriptedPostgres();
    pg.next([{ new_count: 3 }]);
    pg.next([{ value: 100 }]);
    pg.next([{ value: 1 }]);
    pg.next([{ ...watcher, created_at: "2026-10-15T00:00:00.000Z" }]);
    pg.failNext(new Error("connection reset"));
    pg.next([{ id: watcher.watch_id }]);
    pg.next([{ id: "state-1" }]);
    const env = environment();

    expect(await retireClassSection({ db: pg.db, ref, emailBinding: env.EMAIL })).toMatchObject({
      status: "retired",
      watchesDeleted: 1,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Auto-cleanup could not read the class name" }),
    );
  });
});

describe("sendAutoCleanupRemovalEmails", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("counts a timed-out removal email as attempted but not sent, and keeps sending", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const env = environment();
    env.send.mockImplementationOnce(() => new Promise(() => {}));
    const second = { ...watcher, user_id: "user-2", watch_id: "watch-2" };

    const pending = sendAutoCleanupRemovalEmails(
      { ref, classInfo: details, watchers: [watcher, second] },
      env.EMAIL,
    );

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);

    expect(await pending).toEqual([
      {
        success: false,
        watchId: watcher.watch_id,
        error: expect.stringContaining("TIMEOUT"),
        attempted: true,
      },
      { success: true, watchId: second.watch_id, attempted: true },
    ]);
    expect(env.send).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Auto-cleanup email send failed", "email.code": "TIMEOUT" }),
    );
  });
});
