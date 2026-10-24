import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { SessionIdentity } from "@/lib/auth/clerk-session";
import type { Database } from "@/lib/db";
import { createScriptedPostgres } from "@/tests/mocks/scripted-postgres";

const { getDbFromEnv, getSessionIdentityFromHeaders, redirect } = vi.hoisted(() => ({
  getDbFromEnv: vi.fn<() => Database>(),
  getSessionIdentityFromHeaders: vi.fn<(headers: Headers) => Promise<SessionIdentity | null>>(),
  redirect: vi.fn<(path: string) => never>(),
}));

vi.mock("@/lib/db", () => ({ getDbFromEnv }));

vi.mock("@/lib/auth/clerk-session", () => ({ getSessionIdentityFromHeaders }));

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("next/navigation", () => ({ redirect }));

import { verifyAdmin } from "@/lib/auth/admin";
import {
  clearAuthorizationStateCache,
  readAuthorizationState,
} from "@/lib/auth/authorization-state";

const identity: SessionIdentity = {
  userId: "app_user_1",
  clerkUserId: "user_clerk_1",
  sessionId: "sess_1",
};

const adminProfile = {
  is_admin: true,
  is_disabled: false,
  age_verified_at: "2026-10-01T00:00:00.000Z",
  agreed_to_terms_at: "2026-10-01T00:00:00.000Z",
};

describe("verifyAdmin", () => {
  let pg = createScriptedPostgres();

  beforeEach(() => {
    vi.resetAllMocks();
    clearAuthorizationStateCache();
    pg = createScriptedPostgres();
    getDbFromEnv.mockReturnValue(pg.db);
    getSessionIdentityFromHeaders.mockResolvedValue(identity);
    redirect.mockImplementation((path) => {
      throw new Error(`NEXT_REDIRECT:${path}`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    clearAuthorizationStateCache();
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated visitors to sign-in before reading authorization", async () => {
    getSessionIdentityFromHeaders.mockResolvedValue(null);

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
    expect(pg.statements).toHaveLength(0);
  });

  it("redirects non-admin users to their dashboard", async () => {
    pg.next([{ ...adminProfile, is_admin: false }]);

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
    expect(pg.statements).toHaveLength(1);
  });

  it("redirects disabled administrators to sign-in", async () => {
    pg.next([{ ...adminProfile, is_disabled: true }]);

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/sign-in");
    expect(redirect).toHaveBeenCalledWith("/sign-in");
    expect(pg.statements).toHaveLength(1);
  });

  it("returns the administrator's app identity and email", async () => {
    pg.next([adminProfile]);
    pg.next([{ email: "admin@example.com" }]);

    expect(await verifyAdmin()).toEqual({
      id: identity.userId,
      clerkUserId: identity.clerkUserId,
      sessionId: identity.sessionId,
      email: "admin@example.com",
    });
    expect(redirect).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(2);
    expect(pg.statements[0].params).toContain(identity.userId);
    expect(pg.statements[1].params).toContain(identity.userId);
  });

  it("does not grant admin access from a stale cached profile", async () => {
    pg.next([adminProfile]);
    await readAuthorizationState(pg.db, identity.userId, { cache: true });
    pg.next([{ ...adminProfile, is_admin: false }]);

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(pg.statements).toHaveLength(2);
  });

  it("denies admin access when the profile is missing", async () => {
    pg.next();

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(pg.statements).toHaveLength(1);
  });

  it("denies admin access when authorization cannot be read", async () => {
    pg.failNext(new Error("authorization connection reset"));

    await expect(verifyAdmin()).rejects.toThrow("NEXT_REDIRECT:/dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
    expect(pg.statements).toHaveLength(1);
  });

  it("preserves the empty email fallback for an administrator without a mirror row", async () => {
    pg.next([adminProfile]);
    pg.next();

    expect(await verifyAdmin()).toMatchObject({ id: identity.userId, email: "" });
    expect(redirect).not.toHaveBeenCalled();
  });

  it("propagates identity failures instead of treating them as sign-in redirects", async () => {
    const failure = new Error("session verification failed");
    getSessionIdentityFromHeaders.mockRejectedValue(failure);

    await expect(verifyAdmin()).rejects.toBe(failure);
    expect(redirect).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(0);
  });

  it("propagates an email lookup failure instead of returning an administrator", async () => {
    pg.next([adminProfile]);
    pg.failNext(new Error("email connection reset"));

    await expect(verifyAdmin()).rejects.toThrow();
    expect(redirect).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(2);
  });
});
