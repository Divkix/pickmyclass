import { DatabaseError } from "pg";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { createScriptedPostgres } from "../../unit/lib/db/scripted-postgres";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getSelectableTerms } from "@/lib/asu/terms";
import type { ValidationIssueDetail } from "@/lib/api/validation";
import type { ClassDetails } from "@/lib/types/class";
import type { ClassStateRow, ClassWatchRow } from "@/lib/types/class-watch";

let h = createScriptedPostgres();

const {
  mockGetDbFromEnv,
  mockGetSessionIdentity,
  mockFetchClassFromASU,
  mockCaptureServerEvent,
  AuthError,
  NotFoundError,
} = vi.hoisted(() => {
  class MockNotFoundError extends Error {}

  class MockAuthError extends Error {}

  return {
    mockGetDbFromEnv: vi.fn(),
    mockGetSessionIdentity: vi.fn(),
    mockFetchClassFromASU: vi.fn(),
    mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
    NotFoundError: MockNotFoundError,
    AuthError: MockAuthError,
  };
});

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock("@/lib/db", () => ({
  getDbFromEnv: (...args: unknown[]) => mockGetDbFromEnv(...args),
}));

vi.mock("@/lib/asu/api", () => ({
  fetchClassFromASU: mockFetchClassFromASU,
  NotFoundError,
  AuthError,
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

import { DELETE, GET, POST } from "@/app/api/class-watches/route";

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

const USER_ID = "user-123";

const identity = { userId: USER_ID, clerkUserId: "clerk_123", sessionId: "sess_123" };

const term = getSelectableTerms()[0].code;

const asuDetails: ClassDetails = {
  subject: "CSE",
  catalog_nbr: "240",
  title: "Intro to Programming",
  instructor_name: "John Doe",
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: null,
  location: "COOR 120",
  meeting_times: "MWF 9:00 AM-9:50 AM",
};

const watchRow = {
  id: "watch-1",
  class_nbr: "12345",
  term,
  subject: "CSE",
  catalog_nbr: "240",
  created_at: "2026-06-15T12:00:00Z",
};

const stateRow = {
  class_nbr: "12345",
  term,
  seats_available: 10,
  seats_capacity: 50,
  non_reserved_seats: 3,
  instructor_name: "John Doe",
  title: "Intro to Programming",
};

const completedProfile = {
  onboarding_completed_at: "2026-01-01T00:00:00Z",
  onboarding_skipped_at: null,
};

function driverError(code: string, message: string): Error {
  return Object.assign(new DatabaseError(message, 0, "error"), {
    code,
    detail: "RPC invariant rejected the write",
    constraint: code === "23505" ? "unique_user_class_watch" : undefined,
  });
}

function wrappedDriverError(code: string, message: string): Error {
  return new DrizzleQueryError(
    "SELECT public.create_class_watch_with_limit()",
    [],
    driverError(code, message),
  );
}

interface GetResponse {
  watches?: Array<ClassWatchRow & { class_state: ClassStateRow | null }>;
  maxWatches?: number;
  error?: string;
}

interface MutationResponse {
  success?: boolean;
  watch?: ClassWatchRow;
  error?: string;
  details?: ValidationIssueDetail[];
}

function getRequest(): NextRequest {
  return new NextRequest("http://localhost:3000/api/class-watches");
}

function postRequest(body: Record<string, JsonValue>, sessionId?: string): NextRequest {
  const headers = new Headers({ "Content-Type": "application/json" });

  if (sessionId) headers.set("X-PostHog-Session-Id", sessionId);

  return new NextRequest("http://localhost:3000/api/class-watches", {
    method: "POST",
    body: JSON.stringify(body),
    headers,
  });
}

function deleteRequest(id: string | null): NextRequest {
  const url =
    id === null
      ? "http://localhost:3000/api/class-watches"
      : `http://localhost:3000/api/class-watches?id=${id}`;

  return new NextRequest(url, { method: "DELETE" });
}

async function json<T extends object>(response: Response): Promise<T> {
  // SAFETY: T is the route's documented response contract — each call site names it.
  return (await response.json()) as T;
}

describe("/api/class-watches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    h = createScriptedPostgres();
    mockGetDbFromEnv.mockImplementation(() => h.db);
    mockGetSessionIdentity.mockResolvedValue(identity);
    mockFetchClassFromASU.mockResolvedValue(asuDetails);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("GET /api/class-watches", () => {
    it("returns 401 for unauthenticated requests without touching the database", async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await GET(getRequest());

      expect(response.status).toBe(401);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("returns empty watches, the max, and onboarding state for a user with no watches", async () => {
      h.next([]);
      h.next([completedProfile]);

      const response = await GET(getRequest());
      const data = await json<GetResponse>(response);

      expect(response.status).toBe(200);
      expect(data.watches).toEqual([]);
      expect(data.maxWatches).toBe(10);
      expect(data).toMatchObject({
        onboarding: { onboarding_completed_at: "2026-01-01T00:00:00Z", needs_onboarding: false },
      });
      expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
      expect(h.statements).toHaveLength(2);
    });

    it("joins persisted class states onto each watch by term and class number", async () => {
      h.next([watchRow]);
      h.next([stateRow]);
      h.next([completedProfile]);

      const response = await GET(getRequest());
      const data = await json<GetResponse>(response);

      expect(response.status).toBe(200);
      expect(data.watches).toHaveLength(1);
      expect(data.watches?.[0]?.class_state).toEqual(stateRow);

      const statesQuery = h.statements[1];
      expect(statesQuery.sql).toContain('"class_states"');
      expect(statesQuery.sql).toContain('"class_watches"."class_nbr" = "class_states"."class_nbr"');
      expect(statesQuery.sql).toContain('"class_watches"."term" = "class_states"."term"');
      expect(statesQuery.sql).not.toContain('"class_states"."term" in');
      expect(statesQuery.params).toEqual(["12345", USER_ID]);
    });

    it("maps database failures to a 500 fetch error", async () => {
      h.failNext(new Error("Database error"));

      const response = await GET(getRequest());
      const data = await json<GetResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch class watches");
    });
  });

  describe("POST /api/class-watches", () => {
    it("returns 401 for unauthenticated requests without touching the database", async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await POST(postRequest({ term, class_nbr: "12345" }));

      expect(response.status).toBe(401);
      expect(mockFetchClassFromASU).not.toHaveBeenCalled();
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("rejects invalid payloads before calling ASU or the database", async () => {
      const response = await POST(postRequest({ class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
      expect(mockFetchClassFromASU).not.toHaveBeenCalled();
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("creates the watch atomically, persists state, completes onboarding, and fires analytics", async () => {
      const rpcWatch: ClassWatchRow = {
        id: "watch-new",
        user_id: USER_ID,
        class_nbr: "12345",
        term,
        subject: "CSE",
        catalog_nbr: "240",
        created_at: "2026-06-15T12:00:00Z",
      };

      h.next([rpcWatch]);
      h.next([]);
      h.next([]);

      const response = await POST(
        postRequest({ term, class_nbr: "12345" }, "c56a4180-65aa-42ec-a945-5fd21dec0538"),
      );

      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(201);
      expect(data.watch).toEqual(rpcWatch);
      expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);

      expect(h.statements[0].sql).toContain("create_class_watch_with_limit");
      expect(h.statements[0].params).toEqual([USER_ID, term, "CSE", "240", "12345", 10]);

      expect(
        h.statements.some((statement) => statement.sql.includes('insert into "class_states"')),
      ).toBe(true);
      expect(
        h.statements.some((statement) => statement.sql.includes('update "user_profiles"')),
      ).toBe(true);

      expect(mockCaptureServerEvent).toHaveBeenCalledWith(USER_ID, "class_watch_created", {
        term,
        class_nbr: "12345",
        $session_id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      });
    });

    it("maps an ASU not-found miss to 404 without touching the database", async () => {
      mockFetchClassFromASU.mockRejectedValueOnce(new NotFoundError("missing"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(404);
      expect(data.error).toBe("Class section not found");
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("maps ASU auth failures to a temporary outage", async () => {
      mockFetchClassFromASU.mockRejectedValueOnce(new AuthError("expired token"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(503);
      expect(data.error).toBe("Service temporarily unavailable");
    });

    it("maps unexpected ASU failures to a fetch error", async () => {
      mockFetchClassFromASU.mockRejectedValueOnce(new Error("network down"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch class details");
    });

    it("maps a duplicate-watch unique violation (wrapped driver error) to 409", async () => {
      h.failNext(
        wrappedDriverError(
          "23505",
          'duplicate key value violates unique constraint "class_watches_user_id_class_nbr_term_key"',
        ),
      );

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(409);
      expect(data.error).toBe("You are already watching this class");
    });

    it("maps a duplicate-watch violation even when the error arrives unwrapped", async () => {
      h.failNext(driverError("23505", "duplicate key value violates unique constraint"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));

      expect(response.status).toBe(409);
    });

    it("maps the atomic limit-enforcement RAISE EXCEPTION to 429", async () => {
      h.failNext(wrappedDriverError("P0001", "MAX_WATCHES_EXCEEDED"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(429);
      expect(data.error).toBe(
        "Maximum watches limit reached (10). Delete some watches to add more.",
      );
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it("maps unrelated RPC failures to a 500 creation error", async () => {
      h.failNext(wrappedDriverError("08006", "connection failure"));

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create class watch");
    });

    it("still returns 201 when persisting the class state fails (graceful degradation)", async () => {
      h.next([
        {
          id: "watch-new",
          user_id: USER_ID,
          class_nbr: "12345",
          term,
          subject: "CSE",
          catalog_nbr: "240",
          created_at: "2026-06-15T12:00:00Z",
        },
      ]);
      h.failNext(new Error("upsert blew up"));
      h.next([]);

      const response = await POST(postRequest({ term, class_nbr: "12345" }));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith(USER_ID, "class_watch_created", {
        term,
        class_nbr: "12345",
      });
    });
  });

  describe("DELETE /api/class-watches", () => {
    it("returns 401 for unauthenticated requests without touching the database", async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await DELETE(deleteRequest("d0a2b3c1-0000-4000-8000-000000000001"));

      expect(response.status).toBe(401);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("deletes only the authenticated user’s matching watch and fires analytics", async () => {
      const watchId = "d0a2b3c1-0000-4000-8000-000000000001";
      h.next([]);

      const response = await DELETE(deleteRequest(watchId));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);

      const del = h.statements[0];
      expect(del.sql).toContain('delete from "class_watches"');
      expect(del.params).toEqual([watchId, USER_ID]);

      expect(mockCaptureServerEvent).toHaveBeenCalledWith(USER_ID, "class_watch_deleted", {
        watch_id: watchId,
      });
    });

    it("rejects malformed watch ids with a validation error", async () => {
      const response = await DELETE(deleteRequest("not-a-uuid"));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(400);
      expect(data.error).toBe("Invalid input");
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("maps delete failures to a 500 deletion error", async () => {
      h.failNext(new Error("delete failed"));

      const response = await DELETE(deleteRequest("d0a2b3c1-0000-4000-8000-000000000001"));
      const data = await json<MutationResponse>(response);

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to delete class watch");
    });
  });
});
