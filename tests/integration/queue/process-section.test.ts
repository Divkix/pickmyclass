import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { ApiError, AuthError, NotFoundError, RateLimitError } from "@/lib/asu/api";
import { processSection } from "@/lib/queue/process-section";
import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { changes, claim, details, environment, ref, state, watcher } from "./fixtures";

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

function recorded(applied: boolean, intentCreated: boolean) {
  return { applied, intent_created: intentCreated };
}

function queuePending(pg: ReturnType<typeof createScriptedPostgres>) {
  pg.next();
  pg.next([pending]);
  pg.next([pending]);
}

describe("processSection", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("resumes notification work after a claim fails following a successful state write", async () => {
    const pg = createScriptedPostgres();
    pg.next([state()]);
    pg.next([recorded(true, true)]);
    queuePending(pg);
    pg.next([watcher]);
    pg.failNext(new Error("claim unavailable"));
    pg.next();
    const env = environment();
    const fetchClass = vi.fn().mockResolvedValue(details);
    expect(await processSection(pg.db, ref, env, { fetchClass })).toMatchObject({
      disposition: "retry",
    });
    pg.next([{ ...state(), has_pending_intent: true }]);
    queuePending(pg);
    pg.next([watcher]);
    pg.next([claim]);
    pg.next();
    pg.next();
    pg.next();
    pg.next([{ ...state(2), last_checked_at: ref.cycle }]);
    expect(await processSection(pg.db, ref, env, { fetchClass })).toMatchObject({
      disposition: "ack",
      result: { emailsSent: 1 },
    });
    expect(env.send).toHaveBeenCalledOnce();
    expect(fetchClass).toHaveBeenCalledOnce();
  });

  it("acks a checked cycle without fetching or writing", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ ...state(), last_checked_at: ref.cycle }]);
    const fetchClass = vi.fn();
    expect(await processSection(pg.db, ref, environment(), { fetchClass })).toMatchObject({
      disposition: "ack",
      result: { emailsSent: 0 },
    });
    expect(fetchClass).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(1);
  });

  it("does not notify on the first observation", async () => {
    const pg = createScriptedPostgres();
    pg.next();
    pg.next([recorded(true, false)]);
    const env = environment();

    const outcome = await processSection(pg.db, ref, env, {
      fetchClass: vi.fn().mockResolvedValue({ ...details, instructor_name: "Professor" }),
    });

    expect(outcome).toMatchObject({
      disposition: "ack",
      result: { changes: { seatBecameAvailable: false, instructorAssigned: false } },
    });
    expect(env.send).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(2);
  });

  it("skips resets and sends when a newer observation rejects the upsert", async () => {
    const pg = createScriptedPostgres();
    pg.next([state(2, "Professor")]);
    pg.next([recorded(false, false)]);
    const env = environment();
    expect(
      await processSection(pg.db, ref, env, {
        fetchClass: vi
          .fn()
          .mockResolvedValue({ ...details, seats_available: 0, non_reserved_seats: 0 }),
      }),
    ).toMatchObject({ disposition: "ack", result: { emailsSent: 0 } });
    expect(pg.statements).toHaveLength(2);
    expect(env.send).not.toHaveBeenCalled();
  });

  it("retries a thrown upsert and preserves detected changes", async () => {
    const pg = createScriptedPostgres();
    pg.next([state()]);
    pg.failNext(new Error("write failed"));
    expect(
      await processSection(pg.db, ref, environment(), {
        fetchClass: vi.fn().mockResolvedValue(details),
      }),
    ).toMatchObject({
      disposition: "retry",
      httpStatus: 500,
      result: {
        changes: { seatBecameAvailable: true },
        error: expect.stringContaining("write failed"),
      },
    });
    expect(pg.statements).toHaveLength(2);
  });

  it.each([
    [new AuthError("invalid token"), "ack", 200, undefined],
    [new RateLimitError("slow down", 123), "retry", 429, 123],
    [new ApiError("upstream", 503), "retry", 502, undefined],
    [new Error("unexpected"), "retry", 500, undefined],
  ])(
    "maps %s to the existing transport outcome",
    async (error, disposition, httpStatus, retryAfterSeconds) => {
      const pg = createScriptedPostgres();
      pg.next([state()]);
      expect(
        await processSection(pg.db, ref, environment(), {
          fetchClass: vi.fn().mockRejectedValue(error),
        }),
      ).toMatchObject({ disposition, httpStatus });
      const pgAgain = createScriptedPostgres();
      pgAgain.next([state()]);

      const outcome = await processSection(pgAgain.db, ref, environment(), {
        fetchClass: vi.fn().mockRejectedValue(error),
      });

      expect(outcome.retryAfterSeconds).toBe(retryAfterSeconds);
      expect(pg.statements).toHaveLength(1);
    },
  );

  it("tracks NotFound through retirement", async () => {
    const pg = createScriptedPostgres();
    pg.next([state()]);
    pg.next([{ new_count: 1 }]);

    const outcome = await processSection(pg.db, ref, environment(), {
      fetchClass: vi.fn().mockRejectedValue(new NotFoundError("gone")),
    });

    expect(outcome).toMatchObject({
      disposition: "ack",
      result: { retirement: { status: "tracked", strikeCount: 1, deleted: false } },
    });
    expect(pg.statements[1].sql).toContain("increment_consecutive_not_found");
  });

  it("resets filled-seat and reverted-instructor claims only after persistence", async () => {
    const pg = createScriptedPostgres();
    pg.next([state(2, "Professor")]);
    pg.next([recorded(true, false)]);
    await processSection(pg.db, ref, environment(), {
      fetchClass: vi
        .fn()
        .mockResolvedValue({ ...details, seats_available: 0, non_reserved_seats: 0 }),
    });
    expect(pg.statements[1].sql).toContain("record_section_observation");
    expect(pg.statements[1].params).toContain(ref.term);
    expect(pg.statements).toHaveLength(2);
  });

  it("retries partial delivery while retaining durable notification intent", async () => {
    const pg = createScriptedPostgres();
    pg.next([state()]);
    pg.next([recorded(true, true)]);
    queuePending(pg);
    pg.next([watcher, { ...watcher, watch_id: "watch-2" }]);
    pg.next([claim, { notification_id: "claim-2", class_watch_id: "watch-2" }]);
    pg.next();
    pg.next();
    const env = environment();
    env.send.mockRejectedValueOnce(new Error("temporary"));
    expect(
      await processSection(pg.db, ref, env, { fetchClass: vi.fn().mockResolvedValue(details) }),
    ).toMatchObject({ disposition: "retry", httpStatus: 500 });
    expect(env.send).toHaveBeenCalledTimes(2);
    expect(pg.statements.at(-2)?.params).toContain("claim-1");
    expect(
      pg.statements.some((s) => s.sql.startsWith('delete from "pending_section_notifications"')),
    ).toBe(false);
  });

  it("checks a section with no pending intent in exactly two queries", async () => {
    const pg = createScriptedPostgres();
    pg.next([state(2)]);
    pg.next([recorded(true, false)]);
    const env = environment();
    expect(
      await processSection(pg.db, ref, env, { fetchClass: vi.fn().mockResolvedValue(details) }),
    ).toMatchObject({ disposition: "ack", result: { success: true, emailsSent: 0 } });
    expect(pg.statements.map((s) => s.sql)).toEqual([
      expect.stringContaining('from "class_states"'),
      expect.stringContaining("record_section_observation"),
    ]);
    expect(pg.statements[0].sql).toContain("pending_section_notifications");
    expect(env.send).not.toHaveBeenCalled();
  });

  it("routes a flagged expired intent through delivery cleanup before checking", async () => {
    const pg = createScriptedPostgres();
    pg.next([{ ...state(2), has_pending_intent: true }]);
    pg.next();
    pg.next();
    pg.next([state(2)]);
    pg.next([recorded(true, false)]);
    const fetchClass = vi.fn().mockResolvedValue(details);
    expect(await processSection(pg.db, ref, environment(), { fetchClass })).toMatchObject({
      disposition: "ack",
      result: { emailsSent: 0 },
    });
    expect(pg.statements[1].sql).toContain("DELETE FROM public.pending_section_notifications");
    expect(pg.statements[1].sql).toContain("expires_at <= now()");
    expect(pg.statements[3].sql).toContain('from "class_states"');
    expect(pg.statements).toHaveLength(5);
    expect(fetchClass).toHaveBeenCalledOnce();
  });

  it("delivers an intent created by this check", async () => {
    const pg = createScriptedPostgres();
    pg.next([state()]);
    pg.next([recorded(true, true)]);
    queuePending(pg);
    pg.next([watcher]);
    pg.next([claim]);
    pg.next();
    pg.next();
    pg.next();
    const env = environment();
    expect(
      await processSection(pg.db, ref, env, { fetchClass: vi.fn().mockResolvedValue(details) }),
    ).toMatchObject({
      disposition: "ack",
      result: { changes: { seatBecameAvailable: true }, emailsSent: 1 },
    });
    expect(env.send).toHaveBeenCalledOnce();
  });
});
