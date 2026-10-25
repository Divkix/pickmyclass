import type { AuthObject } from "@clerk/backend";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { createClerkClient, auth, getSessionList, revokeSessionCall, getUser, deleteUser } =
  vi.hoisted(() => ({
    createClerkClient: vi.fn(),
    auth: vi.fn(),
    getSessionList: vi.fn(),
    revokeSessionCall: vi.fn(),
    getUser: vi.fn(),
    deleteUser: vi.fn(),
  }));

vi.mock("@clerk/backend", () => ({ createClerkClient }));

vi.mock("@clerk/tanstack-react-start/server", () => ({ auth }));

vi.mock("cloudflare:workers", () => ({
  env: { CLERK_SECRET_KEY: "sk_test_x", NEXT_PUBLIC_SITE_URL: "https://pickmyclass.test" },
}));

import {
  ClerkCallFailed,
  ClerkCallTimedOut,
  SessionRevocationIncomplete,
} from "@/lib/auth/clerk-errors";
import {
  deleteClerkUser,
  getClerkUser,
  getSessionIdentity,
  revokeAllUserSessions,
  revokeSession,
  toSessionIdentity,
} from "@/lib/auth/clerk-session";
import { CLERK_REQUEST_TIMEOUT_MS, CLERK_SESSION_REVOKE_LIMIT } from "@/lib/config";

async function caught(promise: Promise<unknown>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: Error) => error,
  );
}

describe("clerk-session", () => {
  beforeEach(() => {
    createClerkClient.mockImplementation(() => ({
      sessions: { getSessionList, revokeSession: revokeSessionCall },
      users: { getUser, deleteUser },
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  it("builds a Clerk client per call instead of reusing one across requests", async () => {
    revokeSessionCall.mockResolvedValue({});

    await revokeSession("sess_1");
    await revokeSession("sess_2");

    expect(createClerkClient).toHaveBeenCalledTimes(2);
  });

  it("times out a Clerk call that never answers", async () => {
    vi.useFakeTimers();
    getUser.mockReturnValue(new Promise(() => {}));
    const pending = caught(getClerkUser("user_1"));

    await vi.advanceTimersByTimeAsync(CLERK_REQUEST_TIMEOUT_MS);
    const error = await pending;

    expect(error).toBeInstanceOf(ClerkCallTimedOut);
    expect(error).toMatchObject({ operation: "users.getUser", retryable: true });
  });

  it("marks a network failure retryable", async () => {
    getUser.mockRejectedValueOnce(new Error("socket hang up"));

    expect(await caught(getClerkUser("user_1"))).toMatchObject({
      retryable: true,
      operation: "users.getUser",
    });
  });

  it("maps a Backend API status to the retry decision", async () => {
    const { ClerkAPIResponseError } =
      await vi.importActual<typeof import("@clerk/backend/errors")>("@clerk/backend/errors");

    const apiError = (status: number) =>
      new ClerkAPIResponseError("clerk said no", { data: [], status });

    getUser.mockRejectedValueOnce(apiError(404)).mockRejectedValueOnce(apiError(503));

    const notFound = await caught(getClerkUser("user_1"));
    const unavailable = await caught(getClerkUser("user_1"));

    expect(notFound).toBeInstanceOf(ClerkCallFailed);
    expect(notFound).toMatchObject({ status: 404, retryable: false });
    expect(unavailable).toMatchObject({ status: 503, retryable: true });
  });

  it("revokes every session and reports the ones that stayed active", async () => {
    getSessionList
      .mockResolvedValueOnce({ data: [{ id: "s1" }, { id: "s2" }, { id: "s3" }], totalCount: 3 })
      .mockResolvedValueOnce({ data: [{ id: "s2" }], totalCount: 1 });
    revokeSessionCall
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({});

    const error = await caught(revokeAllUserSessions("user_1"));

    expect(revokeSessionCall).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SessionRevocationIncomplete);
    expect(error).toMatchObject({ failed: 1, total: 3 });
  });

  it("reports sessions past the revoke limit instead of dropping them", async () => {
    const page = Array.from({ length: CLERK_SESSION_REVOKE_LIMIT }, (_, i) => ({ id: `s${i}` }));
    const total = CLERK_SESSION_REVOKE_LIMIT + 2;

    getSessionList
      .mockResolvedValueOnce({ data: page, totalCount: total })
      .mockResolvedValueOnce({ data: [{ id: "s_late" }], totalCount: 2 });
    revokeSessionCall.mockResolvedValue({});

    const error = await caught(revokeAllUserSessions("user_1"));

    expect(getSessionList).toHaveBeenNthCalledWith(1, {
      userId: "user_1",
      status: "active",
      limit: CLERK_SESSION_REVOKE_LIMIT,
    });
    expect(revokeSessionCall).toHaveBeenCalledTimes(CLERK_SESSION_REVOKE_LIMIT);
    expect(error).toBeInstanceOf(SessionRevocationIncomplete);
    expect(error).toMatchObject({ failed: 2, total });
  });

  it("resolves once no session is left active", async () => {
    getSessionList
      .mockResolvedValueOnce({ data: [{ id: "s1" }], totalCount: 1 })
      .mockResolvedValueOnce({ data: [], totalCount: 0 });
    revokeSessionCall.mockResolvedValue({});

    await expect(revokeAllUserSessions("user_1")).resolves.toBeUndefined();
  });

  it("deletes a Clerk identity, counts an already-deleted one as done, and reports other failures", async () => {
    const { ClerkAPIResponseError } =
      await vi.importActual<typeof import("@clerk/backend/errors")>("@clerk/backend/errors");

    const apiError = (status: number) =>
      new ClerkAPIResponseError("clerk said no", { data: [], status });

    deleteUser
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(apiError(404))
      .mockRejectedValueOnce(apiError(503));

    await expect(deleteClerkUser("user_1")).resolves.toBeUndefined();
    await expect(deleteClerkUser("user_2")).resolves.toBeUndefined();
    expect(await caught(deleteClerkUser("user_3"))).toMatchObject({
      operation: "users.deleteUser",
      status: 503,
      retryable: true,
    });
    expect(deleteUser).toHaveBeenNthCalledWith(1, "user_1");
  });

  it("identifies a session by its ext_id claim, falling back to the Clerk user id", async () => {
    auth
      .mockResolvedValueOnce({
        tokenType: "session_token",
        userId: "user_clerk",
        sessionId: "sess_1",
        sessionClaims: { ext_id: "legacy-uuid" },
      })
      .mockResolvedValueOnce({
        tokenType: "session_token",
        userId: "user_clerk",
        sessionId: "sess_2",
        sessionClaims: {},
      })
      .mockResolvedValueOnce({
        tokenType: "session_token",
        userId: null,
        sessionId: null,
        sessionClaims: null,
      });

    expect(await getSessionIdentity()).toEqual({
      userId: "legacy-uuid",
      clerkUserId: "user_clerk",
      sessionId: "sess_1",
    });
    expect(await getSessionIdentity()).toEqual({
      userId: "user_clerk",
      clerkUserId: "user_clerk",
      sessionId: "sess_2",
    });
    expect(await getSessionIdentity()).toBeNull();
  });

  it("never signs in a machine token, even one owned by a user", () => {
    // SAFETY: the fields toSessionIdentity reads from an API-key AuthObject.
    const apiKey = {
      tokenType: "api_key",
      userId: "user_clerk",
      isAuthenticated: true,
    } as AuthObject;

    expect(toSessionIdentity(apiKey)).toBeNull();
  });
});
