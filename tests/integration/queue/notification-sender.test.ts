import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { it as effectIt } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import {
  sendSectionNotifications,
  sendSectionNotificationsEffect,
} from "@/lib/queue/notification-sender";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { changes, claim, details, environment, ref, watcher } from "./fixtures";

describe("sendSectionNotifications", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  effectIt.effect("rolls back acquired claims when template preparation defects", () =>
    Effect.gen(function* () {
      const pg = createScriptedPostgres();
      pg.next([watcher]);
      pg.next([claim]);
      pg.next();
      vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "");
      const env = environment();

      const exit = yield* sendSectionNotificationsEffect({
        db: pg.db,
        ref,
        classInfo: { ...details, ...ref },
        changes,
        emailBinding: env.EMAIL,
      }).pipe(Effect.exit);

      expect(exit._tag).toBe("Failure");
      expect(env.send).not.toHaveBeenCalled();
      expect(pg.statements.at(-1)?.params).toContain("claim-1");
    }),
  );

  effectIt.effect(
    "on interruption retains delivered and ambiguous claims and releases unattempted work",
    () =>
      Effect.gen(function* () {
        const pg = createScriptedPostgres();
        pg.next([
          watcher,
          { ...watcher, watch_id: "watch-2" },
          { ...watcher, watch_id: "watch-3" },
        ]);
        pg.next([
          claim,
          { notification_id: "claim-2", class_watch_id: "watch-2" },
          { notification_id: "claim-3", class_watch_id: "watch-3" },
        ]);
        pg.next();
        const env = environment();
        const started = Promise.withResolvers<void>();
        const pending = Promise.withResolvers<{ messageId: string }>();
        env.send.mockResolvedValueOnce({ messageId: "confirmed" }).mockImplementationOnce(() => {
          started.resolve();

          return pending.promise;
        });

        const fiber = yield* sendSectionNotificationsEffect({
          db: pg.db,
          ref,
          classInfo: { ...details, ...ref },
          changes,
          emailBinding: env.EMAIL,
        }).pipe(Effect.forkChild);

        yield* Effect.promise(() => started.promise);
        yield* Fiber.interrupt(fiber);
        pending.resolve({ messageId: "possibly-delivered" });
        expect(env.send).toHaveBeenCalledTimes(2);
        expect(pg.statements.at(-1)?.params).toContain("claim-3");
        expect(pg.statements.at(-1)?.params).not.toContain("claim-1");
        expect(pg.statements.at(-1)?.params).not.toContain("claim-2");
      }),
  );

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
});
