import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const {
  createClerkClient,
  authenticateRequest,
  getSessionList,
  revokeSessionCall,
  getUser,
  deleteUser,
} = vi.hoisted(() => ({
  createClerkClient: vi.fn(),
  authenticateRequest: vi.fn(),
  getSessionList: vi.fn(),
  revokeSessionCall: vi.fn(),
  getUser: vi.fn(),
  deleteUser: vi.fn(),
}));

vi.mock("@clerk/backend", () => ({ createClerkClient }));

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
} from "@/lib/auth/clerk-session";
import { CLERK_REQUEST_TIMEOUT_MS } from "@/lib/config";

async function caught(promise: Promise<unknown>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: Error) => error,
  );
}

describe("clerk-session", () => {
  beforeEach(() => {
    createClerkClient.mockImplementation(() => ({
      authenticateRequest,
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
    getSessionList.mockResolvedValue({ data: [{ id: "s1" }, { id: "s2" }, { id: "s3" }] });
    revokeSessionCall
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({});

    const error = await caught(revokeAllUserSessions("user_1"));

    expect(revokeSessionCall).toHaveBeenCalledTimes(3);
    expect(error).toBeInstanceOf(SessionRevocationIncomplete);
    expect(error).toMatchObject({ failed: 1, total: 3 });
  });

  it("resolves when every session is revoked", async () => {
    getSessionList.mockResolvedValue({ data: [{ id: "s1" }] });
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

  it("treats a failed verification as signed out and logs it", async () => {
    authenticateRequest.mockRejectedValue(new Error("jwks unreachable"));

    expect(await getSessionIdentity(new Request("https://pickmyclass.test/"))).toBeNull();
    expect(console.error).toHaveBeenCalledWith(
      expect.objectContaining({ msg: "Clerk session verification failed" }),
    );
  });
});
