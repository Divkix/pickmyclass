import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { getSelectableTerms } from "@/lib/asu/terms";
import type { OnboardingPayload } from "@/lib/onboarding";
import type { ClassDetails } from "@/lib/types/class";
import type { ClassStateRow, ClassWatchRow } from "@/lib/types/class-watch";

let h = createScriptedPostgres();

const {
  mockGetSessionIdentity,
  mockFetchClassFromASU,
  mockCaptureServerEvent,
  AuthError,
  NotFoundError,
} = vi.hoisted(() => {
  class MockAuthError extends Error {}

  class MockNotFoundError extends Error {}

  return {
    mockGetSessionIdentity: vi.fn(),
    mockFetchClassFromASU: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
    AuthError: MockAuthError,
    NotFoundError: MockNotFoundError,
  };
});

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock("@/lib/db", () => ({
  getDbFromEnv: () => h.db,
}));

vi.mock("@/lib/asu/api", () => ({
  fetchClassFromASU: mockFetchClassFromASU,
  AuthError,
  NotFoundError,
}));

vi.mock("@/lib/analytics/server", () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    ASU_API_BASE_URL: "https://mock-asu-api.example.com",
    ASU_API_TOKEN: "mock-token",
  },
}));

import { GET, POST } from "@/app/api/class-watches/route";

const USER_ID = "user-123";

const identity = {
  userId: USER_ID,
  clerkUserId: "user_test_clerk_123",
  sessionId: "sess_test_123",
};

const term = getSelectableTerms()[0].code;

const classDetails: ClassDetails = {
  subject: "CSE",
  catalog_nbr: "240",
  title: "Introduction to Programming",
  instructor_name: "Jane Doe",
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: "COOR 120",
  meeting_times: "MWF 9:00-9:50 AM",
};

const createdWatch: ClassWatchRow = {
  id: "watch-1",
  user_id: USER_ID,
  class_nbr: "12345",
  term,
  subject: "CSE",
  catalog_nbr: "240",
  created_at: "2026-01-02T00:00:00Z",
};

const watchedWithoutState = {
  id: "watch-2",
  class_nbr: "54321",
  term,
  subject: "MAT",
  catalog_nbr: "270",
  created_at: "2026-01-03T00:00:00Z",
};

// Full class_states row in the route's GET select order: the scripted driver
// returns Object.values(row) in array mode, so mapping is positional. A missing
// key leaves a column undefined, and the timestamp columns call
// value.toISOString() on non-string values, which threw and produced a 500.
const matchingClassState: ClassStateRow = {
  id: "state-1",
  class_nbr: "12345",
  term,
  subject: "CSE",
  catalog_nbr: "240",
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  instructor_name: "Jane Doe",
  title: "Introduction to Programming",
  location: "COOR 120",
  meeting_times: "MWF 9:00-9:50 AM",
  last_checked_at: "2026-01-02T00:00:00Z",
  last_changed_at: "2026-01-02T00:00:00Z",
  consecutive_not_found_count: 0,
};

interface GetBody {
  success?: boolean;
  watches?: Array<ClassWatchRow & { class_state: ClassStateRow | null }>;
  maxWatches?: number;
  onboarding?: OnboardingPayload;
}

interface PostBody {
  success?: boolean;
  watch?: ClassWatchRow;
}

function getRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/class-watches");
}

function postRequest(body: { term: string; class_nbr: string }): NextRequest {
  return new NextRequest("http://localhost:3000/api/class-watches", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function json<T>(response: Response): Promise<T> {
  // SAFETY: T is the route's documented response contract — each call site names it.
  return (await response.json()) as T;
}

describe("/api/class-watches onboarding wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h = createScriptedPostgres();
    mockGetSessionIdentity.mockResolvedValue(identity);
    mockFetchClassFromASU.mockResolvedValue(classDetails);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("POST /api/class-watches", () => {
    it("creates the watch, upserts state, and marks onboarding complete via the first-watch guard", async () => {
      h.next([createdWatch]);
      h.next([]);
      h.next([]);

      const response = await POST(postRequest({ term, class_nbr: "12345" }));

      expect(response.status).toBe(201);
      const body = await json<PostBody>(response);
      expect(body.success).toBe(true);
      expect(body.watch).toEqual(createdWatch);

      const rpc = h.statements[0];
      expect(rpc.sql).toContain("create_class_watch_with_limit");
      expect(rpc.params).toEqual([USER_ID, term, "CSE", "240", "12345", 10]);

      const upsert = h.statements.find((statement) =>
        statement.sql.includes('insert into "class_states"'),
      );

      expect(upsert?.sql).toContain("on conflict");

      const guard = h.statements.find((statement) =>
        statement.sql.includes('update "user_profiles"'),
      );

      expect(guard?.sql).toContain("onboarding_completed_at");
      expect(guard?.params).toContain(USER_ID);

      expect(mockCaptureServerEvent).toHaveBeenCalledWith(
        USER_ID,
        "class_watch_created",
        expect.objectContaining({ term, class_nbr: "12345" }),
      );
    });

    it("still returns 201 when the first-watch guard rejects (non-fatal)", async () => {
      h.next([createdWatch]);
      h.next([]);
      h.failNext(new Error("guard update failed"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));

      expect(response.status).toBe(201);
      const body = await json<PostBody>(response);
      expect(body.success).toBe(true);
      expect(body.watch).toEqual(createdWatch);

      expect(mockCaptureServerEvent).toHaveBeenCalledWith(USER_ID, "class_watch_created", {
        term,
        class_nbr: "12345",
      });
    });
  });

  describe("GET /api/class-watches", () => {
    it("returns 200 with the full watches list and the onboarding fallback when the auxiliary read fails", async () => {
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      h = createScriptedPostgres((statement) => {
        if (statement.sql.includes('from "class_states"')) return [matchingClassState];

        if (statement.sql.includes('"user_profiles"')) {
          throw new Error("onboarding profile read failed");
        }

        return [
          {
            id: createdWatch.id,
            class_nbr: createdWatch.class_nbr,
            term: createdWatch.term,
            subject: createdWatch.subject,
            catalog_nbr: createdWatch.catalog_nbr,
            created_at: createdWatch.created_at,
          },
          watchedWithoutState,
        ];
      });

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      const body = await json<GetBody>(response);
      expect(body.success).toBe(true);

      expect(body.watches).toHaveLength(2);
      expect(body.watches?.[0]).toMatchObject({
        id: "watch-1",
        class_state: expect.objectContaining({ class_nbr: "12345", term }),
      });
      expect(body.watches?.[1]?.class_state).toBeNull();
      expect(z.number().safeParse(body.maxWatches).success).toBe(true);

      expect(errorSpy).toHaveBeenCalled();
      expect(body.onboarding).toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: false,
      });
    });

    it("projects the real pending state into the response when the read succeeds", async () => {
      h = createScriptedPostgres((statement) =>
        statement.sql.includes('"user_profiles"')
          ? [{ onboarding_completed_at: null, onboarding_skipped_at: null }]
          : [],
      );

      const response = await GET(getRequest());

      expect(response.status).toBe(200);
      const body = await json<GetBody>(response);
      expect(body.onboarding).toEqual({
        onboarding_completed_at: null,
        onboarding_skipped_at: null,
        needs_onboarding: true,
      });
    });
  });
});
