import { sql } from "drizzle-orm";
import { Pool, type QueryResult } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { getDb, querySummary } from "@/lib/db";
import { withSpan } from "@/lib/telemetry/span";
import { openedSpans } from "@/tests/mocks/cloudflare-workers";

describe("withSpan", () => {
  beforeEach(() => {
    openedSpans.length = 0;
  });

  it("opens a named span with its attributes and returns the result", async () => {
    await expect(withSpan("asu.fetch_class", { term: "2267" }, async () => 7)).resolves.toBe(7);

    expect(openedSpans[0]?.name).toBe("asu.fetch_class");
    expect(openedSpans[0]?.attributes.get("term")).toBe("2267");
  });

  it("tags a throw with error.type and rethrows it unchanged", async () => {
    const failure = new RangeError("boom");

    await expect(withSpan("email.send", {}, () => Promise.reject(failure))).rejects.toBe(failure);
    expect(openedSpans[0]?.attributes.get("error.type")).toBe("RangeError");
  });
});

describe("database query spans", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    openedSpans.length = 0;
  });

  it.each([
    ['select "class_nbr", "term" from "class_states" where "term" = $1', "SELECT class_states"],
    [
      "SELECT public.record_section_observation($1, $2) AS result",
      "SELECT record_section_observation",
    ],
    [
      "SELECT notification_id FROM public.claim_section_notifications($1)",
      "SELECT claim_section_notifications",
    ],
    ['insert into "class_watches" ("user_id") values ($1)', "INSERT class_watches"],
    ['update "class_states" set "seats" = $1', "UPDATE class_states"],
    [
      'select "class_nbr", EXISTS (SELECT 1 FROM public.pending_section_notifications WHERE class_nbr = $1) from "class_states"',
      "SELECT class_states",
    ],
    [
      'select "id", public.section_alerts_ended("start_date", "end_date") from "class_watches"',
      "SELECT class_watches",
    ],
    [
      "WITH expired AS (DELETE FROM public.pending_section_notifications RETURNING id) DELETE FROM public.notifications_sent WHERE delivery_intent_id IN (SELECT id FROM expired)",
      "WITH notifications_sent",
    ],
    ["begin", "BEGIN"],
  ])("names %s as %s", (text, summary) => {
    expect(querySummary(text)).toBe(summary);
  });

  it("wraps each pool query in a span with the row count and no bound values", async () => {
    const rows = [{ expired: 1 }, { expired: 2 }, { expired: 3 }];
    const result: QueryResult = { command: "SELECT", rowCount: 3, oid: 0, fields: [], rows };
    vi.spyOn(Pool.prototype, "query").mockImplementation(() => Promise.resolve(result));

    // SAFETY: getDb reads only connectionString, and the stubbed query never connects.
    const db = getDb({ connectionString: "postgres://localhost/test" } as Hyperdrive);
    await db.execute(sql`SELECT public.expire_stale_notifications(${"student@asu.edu"})`);

    const [span] = openedSpans;
    expect(span?.name).toBe("SELECT expire_stale_notifications");
    expect(Object.fromEntries(span?.attributes ?? [])).toEqual({
      "db.system.name": "postgresql",
      "db.response.returned_rows": 3,
    });
  });

  it("tags a failed query with its SQLSTATE", async () => {
    const failure = Object.assign(new Error("duplicate key value"), {
      code: "23505",
      name: "error",
    });

    vi.spyOn(Pool.prototype, "query").mockImplementation(() => Promise.reject(failure));

    // SAFETY: getDb reads only connectionString, and the stubbed query never connects.
    const db = getDb({ connectionString: "postgres://localhost/test" } as Hyperdrive);
    await expect(db.execute(sql`SELECT 1`)).rejects.toThrow();

    expect(openedSpans[0]?.attributes.get("db.response.status_code")).toBe("23505");
  });
});
