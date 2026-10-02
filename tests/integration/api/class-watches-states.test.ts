import { createScriptedPostgres } from "../../unit/lib/db/scripted-postgres";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { ClassStateRow } from "@/lib/types/class-watch";

let h = createScriptedPostgres();

const { mockGetDbFromEnv, mockGetSessionIdentity } = vi.hoisted(() => ({
  mockGetDbFromEnv: vi.fn(),
  mockGetSessionIdentity: vi.fn(),
}));

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock("@/lib/db", () => ({
  getDbFromEnv: (...args: unknown[]) => mockGetDbFromEnv(...args),
}));

import { GET } from "@/app/api/class-watches/states/route";

const USER_ID = "user-123";

const identity = { userId: USER_ID, clerkUserId: "clerk_123", sessionId: "sess_123" };

const stateRow: ClassStateRow = {
  id: "state-1",
  class_nbr: "12345",
  term: "2261",
  subject: "CSE",
  catalog_nbr: "110",
  title: "Intro to Programming",
  instructor_name: "Dr. Smith",
  seats_available: 7,
  seats_capacity: 30,
  non_reserved_seats: 5,
  location: "TBD",
  meeting_times: "MWF 10:00-11:00",
  last_checked_at: "2026-08-01T00:00:00Z",
  last_changed_at: "2026-08-01T00:00:00Z",
  consecutive_not_found_count: 0,
};

interface StatesResponse {
  success?: boolean;
  classStates?: ClassStateRow[];
  error?: string;
}

function getRequest(classNumbers?: string): NextRequest {
  const url =
    classNumbers === undefined
      ? "http://localhost:3000/api/class-watches/states"
      : `http://localhost:3000/api/class-watches/states?classNumbers=${encodeURIComponent(classNumbers)}`;

  return new NextRequest(url);
}

async function json<T extends object>(response: Response): Promise<T> {
  // SAFETY: T is the route's documented response contract — each call site names it.
  return (await response.json()) as T;
}

describe("GET /api/class-watches/states", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h = createScriptedPostgres();
    mockGetDbFromEnv.mockImplementation(() => h.db);
    mockGetSessionIdentity.mockResolvedValue(identity);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 for unauthenticated requests without touching the database", async () => {
    mockGetSessionIdentity.mockResolvedValueOnce(null);

    const response = await GET(getRequest("12345"));

    expect(response.status).toBe(401);
    expect(mockGetDbFromEnv).not.toHaveBeenCalled();
  });

  it("returns no states and skips the query when classNumbers is empty", async () => {
    const response = await GET(getRequest());
    const data = await json<StatesResponse>(response);

    expect(response.status).toBe(200);
    expect(data.classStates).toEqual([]);
    expect(h.statements).toHaveLength(0);
  });

  it("scopes states to the caller watch pairs, never to the bare class number", async () => {
    h.next([stateRow]);

    const response = await GET(getRequest("12345"));
    const data = await json<StatesResponse>(response);

    expect(response.status).toBe(200);
    expect(data.classStates).toEqual([stateRow]);

    expect(h.statements).toHaveLength(1);
    const statesQuery = h.statements[0];
    expect(statesQuery.sql).toContain("exists");
    expect(statesQuery.sql).toContain('"class_watches"."user_id" = $2');
    expect(statesQuery.sql).toContain('"class_watches"."class_nbr" = "class_states"."class_nbr"');
    expect(statesQuery.sql).toContain('"class_watches"."term" = "class_states"."term"');
    expect(statesQuery.sql).not.toContain('"class_watches"."term" in');
    expect(statesQuery.params).toEqual(["12345", USER_ID]);
  });

  it("maps database failures to a 500 fetch error", async () => {
    h.failNext(new Error("Database error"));

    const response = await GET(getRequest("12345"));
    const data = await json<StatesResponse>(response);

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch class states");
  });
});
