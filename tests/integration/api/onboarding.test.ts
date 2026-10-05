import { createScriptedPostgres } from "../../mocks/scripted-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

let h = createScriptedPostgres();

const { mockGetDbFromEnv, mockGetSessionIdentity, mockCaptureServerEvent } = vi.hoisted(() => ({
  mockGetDbFromEnv: vi.fn(),
  mockGetSessionIdentity: vi.fn(),
  mockCaptureServerEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentity: mockGetSessionIdentity,
}));

vi.mock("@/lib/db", () => ({
  getDbFromEnv: (...args: unknown[]) => mockGetDbFromEnv(...args),
}));

vi.mock("@/lib/analytics/server", () => ({
  captureServerEvent: mockCaptureServerEvent,
}));

import { GET, POST } from "@/app/api/user/onboarding/route";

const identity = { userId: "user-123", clerkUserId: "clerk_123", sessionId: "sess_123" };

function get(url: string): Request {
  return new Request(url);
}

function post(url: string, sessionId?: string): Request {
  const requestOptions: RequestInit = { method: "POST" };

  if (sessionId) {
    requestOptions.headers = { "X-PostHog-Session-Id": sessionId };
  }

  return new Request(url, requestOptions);
}

const onboardingBody = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
  onboarding_completed_at: z.string().nullable().optional(),
  onboarding_skipped_at: z.string().nullable().optional(),
  needs_onboarding: z.boolean().optional(),
});

async function json(response: Response) {
  return onboardingBody.parse(await response.json());
}

describe("/api/user/onboarding", () => {
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

  describe("GET", () => {
    it("reports a pending state for a new user with no onboarding timestamps", async () => {
      h.next([{ onboarding_completed_at: null, onboarding_skipped_at: null }]);

      const response = await GET(get("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(true);

      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain("user_profiles");
      expect(h.statements[0].params).toEqual(["user-123", 1]);
      expect(mockGetDbFromEnv).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it("falls back to not-needed when the profile row is missing", async () => {
      h.next([]);

      const response = await GET(get("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBeNull();
      expect(data.needs_onboarding).toBe(false);
    });

    it("rejects unauthenticated requests without touching the database", async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await GET(get("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
      expect(h.statements).toHaveLength(0);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
    });

    it("returns 500 when the profile read fails", async () => {
      h.failNext(new Error("read failed"));

      const response = await GET(get("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Failed to load onboarding state");
    });
  });

  describe("POST (skip)", () => {
    it("skips onboarding via the RPC and captures exactly one analytics event", async () => {
      h.next([{ onboarding_completed_at: null, onboarding_skipped_at: "2026-07-11T12:00:00Z" }]);

      const response = await POST(
        post("https://pickmyclass.app/api/user/onboarding", "c56a4180-65aa-42ec-a945-5fd21dec0538"),
      );

      const data = await json(response);

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.onboarding_completed_at).toBeNull();
      expect(data.onboarding_skipped_at).toBe("2026-07-11T12:00:00Z");
      expect(data.needs_onboarding).toBe(false);

      expect(h.statements).toHaveLength(1);
      expect(h.statements[0].sql).toContain("skip_onboarding");
      expect(h.statements[0].params).toEqual(["user-123"]);

      expect(mockCaptureServerEvent).toHaveBeenCalledTimes(1);
      expect(mockCaptureServerEvent).toHaveBeenCalledWith("user-123", "onboarding_skipped", {
        $session_id: "c56a4180-65aa-42ec-a945-5fd21dec0538",
      });
    });

    it("returns 500 when the skip RPC produces no rows and fires no analytics", async () => {
      h.next([]);

      const response = await POST(post("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Failed to skip onboarding");
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it("returns 500 when the skip RPC fails and fires no analytics", async () => {
      h.failNext(new Error("rpc failed"));

      const response = await POST(post("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Failed to skip onboarding");
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });

    it("rejects unauthenticated requests without touching the database or analytics", async () => {
      mockGetSessionIdentity.mockResolvedValueOnce(null);

      const response = await POST(post("https://pickmyclass.app/api/user/onboarding"));
      const data = await json(response);

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.error).toBe("Unauthorized");
      expect(h.statements).toHaveLength(0);
      expect(mockGetDbFromEnv).not.toHaveBeenCalled();
      expect(mockCaptureServerEvent).not.toHaveBeenCalled();
    });
  });
});
