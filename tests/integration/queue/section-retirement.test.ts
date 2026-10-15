import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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
});
