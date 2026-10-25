import { redirect } from "@tanstack/react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { SessionIdentity } from "@/lib/auth/clerk-session";
import type { Database } from "@/lib/db";
import { createScriptedPostgres } from "@/tests/mocks/scripted-postgres";

const { getDbFromEnv, requirePageAccess } = vi.hoisted(() => ({
  getDbFromEnv: vi.fn<() => Database>(),
  requirePageAccess: vi.fn<(pathname: string, search?: string) => Promise<SessionIdentity>>(),
}));

vi.mock("@/lib/db", () => ({ getDbFromEnv }));

vi.mock("@/lib/auth/page-access", () => ({ requirePageAccess }));

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
    requirePageAccess.mockResolvedValue(identity);
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    clearAuthorizationStateCache();
    vi.restoreAllMocks();
  });

  it("redirects unauthenticated visitors to sign-in before reading authorization", async () => {
    const signInRedirect = redirect({ href: "/sign-in" });
    requirePageAccess.mockRejectedValue(signInRedirect);

    await expect(verifyAdmin("/admin")).rejects.toBe(signInRedirect);
    expect(requirePageAccess).toHaveBeenCalledWith("/admin", undefined);
    expect(pg.statements).toHaveLength(0);
  });

  it("redirects non-admin users to their dashboard", async () => {
    pg.next([{ ...adminProfile, is_admin: false }]);

    await expect(verifyAdmin("/admin")).rejects.toMatchObject(redirect({ href: "/dashboard" }));
    expect(pg.statements).toHaveLength(1);
  });

  it("redirects disabled administrators to sign-in", async () => {
    pg.next([{ ...adminProfile, is_disabled: true }]);

    await expect(verifyAdmin("/admin")).rejects.toMatchObject(redirect({ href: "/sign-in" }));
    expect(pg.statements).toHaveLength(1);
  });

  it("returns the administrator's app identity and email", async () => {
    pg.next([adminProfile]);
    pg.next([{ email: "admin@example.com" }]);

    expect(await verifyAdmin("/admin")).toEqual({
      id: identity.userId,
      clerkUserId: identity.clerkUserId,
      sessionId: identity.sessionId,
      email: "admin@example.com",
    });
    expect(requirePageAccess).toHaveBeenCalledWith("/admin", undefined);
    expect(pg.statements).toHaveLength(2);
    expect(pg.statements[0].params).toContain(identity.userId);
    expect(pg.statements[1].params).toContain(identity.userId);
  });

  it("forwards the admin page's own pathname and search to page access", async () => {
    pg.next([adminProfile]);
    pg.next([{ email: "admin@example.com" }]);

    await verifyAdmin("/admin/users", "?page=2");

    expect(requirePageAccess).toHaveBeenCalledWith("/admin/users", "?page=2");
  });

  it("does not grant admin access from a stale cached profile", async () => {
    pg.next([adminProfile]);
    await readAuthorizationState(pg.db, identity.userId, { cache: true });
    pg.next([{ ...adminProfile, is_admin: false }]);

    await expect(verifyAdmin("/admin")).rejects.toMatchObject(redirect({ href: "/dashboard" }));
    expect(pg.statements).toHaveLength(2);
  });

  it("denies admin access when the profile is missing", async () => {
    pg.next();

    await expect(verifyAdmin("/admin")).rejects.toMatchObject(redirect({ href: "/dashboard" }));
    expect(pg.statements).toHaveLength(1);
  });

  it("denies admin access when authorization cannot be read", async () => {
    pg.failNext(new Error("authorization connection reset"));

    await expect(verifyAdmin("/admin")).rejects.toMatchObject(redirect({ href: "/dashboard" }));
    expect(pg.statements).toHaveLength(1);
  });

  it("preserves the empty email fallback for an administrator without a mirror row", async () => {
    pg.next([adminProfile]);
    pg.next();

    expect(await verifyAdmin("/admin")).toMatchObject({ id: identity.userId, email: "" });
  });

  it("propagates identity failures instead of treating them as sign-in redirects", async () => {
    const failure = new Error("session verification failed");
    requirePageAccess.mockRejectedValue(failure);

    await expect(verifyAdmin("/admin")).rejects.toBe(failure);
    expect(pg.statements).toHaveLength(0);
  });

  it("propagates an email lookup failure instead of returning an administrator", async () => {
    pg.next([adminProfile]);
    pg.failNext(new Error("email connection reset"));

    await expect(verifyAdmin("/admin")).rejects.toThrow();
    expect(pg.statements).toHaveLength(2);
  });
});
