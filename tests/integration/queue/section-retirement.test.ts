import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE,
  EMAIL_BATCH_DELAY_MS,
  EMAIL_SEND_TIMEOUT_MS,
} from "@/lib/config";
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
    vi.restoreAllMocks();
  });

  it("retires the SectionRef on the third NotFound and notifies its watchers", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ new_count: 3 }]);
    pg.next([{ value: 100 }]);
    pg.next([{ value: 1 }]);
    pg.next([
      {
        retired: true,
        watches_deleted: 1,
        class_info: details,
        watchers: [watcher],
      },
    ]);
    const env = environment();
    expect(await retireClassSection({ db: pg.db, ref, emailBinding: env.EMAIL })).toMatchObject({
      status: "retired",
      strikeCount: 3,
      deleted: true,
      watchesDeleted: 1,
      emailsSucceeded: 1,
    });
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

  it("keeps watches and sends nothing when a successful observation reset the counter", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const pg = createScriptedPostgres();
    pg.next([{ new_count: 3 }]);
    pg.next([{ value: 100 }]);
    pg.next([{ value: 1 }]);
    pg.next([{ retired: false, watches_deleted: 0, class_info: null, watchers: [] }]);
    const env = environment();

    expect(await retireClassSection({ db: pg.db, ref, emailBinding: env.EMAIL })).toMatchObject({
      status: "not-retired",
      deleted: false,
      watchesDeleted: 0,
      emailsAttempted: 0,
    });
    expect(env.send).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Auto-cleanup skipped after counter changed or state disappeared",
      }),
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

  it("bounds even all-timeout removal batches and logs recipients beyond the cap", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env = environment();
    env.send.mockImplementation(() => new Promise(() => {}));

    const watchers = Array.from({ length: AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE + 2 }, (_, i) => ({
      ...watcher,
      user_id: `user-${i}`,
      watch_id: `watch-${i}`,
    }));

    const started = Date.now();
    const pending = sendAutoCleanupRemovalEmails({ ref, watchers }, env.EMAIL);

    await vi.runAllTimersAsync();

    const results = await pending;
    expect(results).toHaveLength(AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE);
    expect(results.every((result) => result.attempted && !result.success)).toBe(true);
    expect(env.send).toHaveBeenCalledTimes(AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE);
    expect(Date.now() - started).toBe(
      AUTO_CLEANUP_MAX_EMAILS_PER_CYCLE * EMAIL_SEND_TIMEOUT_MS + 2 * EMAIL_BATCH_DELAY_MS,
    );
    expect(Date.now() - started).toBeLessThan(15 * 60 * 1000);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        msg: "Auto-cleanup watchers exceed the email cap, truncating",
        removed_without_email: 2,
      }),
    );
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
