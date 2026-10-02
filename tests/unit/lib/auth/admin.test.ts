import {
  createScriptedPostgres,
  type CellValue,
  type CapturedStatement,
} from "../db/scripted-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { verifyAdmin } from "@/lib/auth/admin";
import type { Database } from "@/lib/db";

interface AdminMirrorRow {
  [column: string]: CellValue;
  email: string;
}

const { mockGetSessionIdentityFromHeaders, mockReadAuthorizationState, mockRedirect, mockHeaders } =
  vi.hoisted(() => ({
    mockGetSessionIdentityFromHeaders: vi.fn(),
    mockReadAuthorizationState: vi.fn(),
    mockRedirect: vi.fn((path: string) => {
      throw new Error(`redirect:${path}`);
    }),
    mockHeaders: vi.fn(),
  }));

vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
}));

vi.mock("next/headers", () => ({
  headers: mockHeaders,
}));

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentityFromHeaders: mockGetSessionIdentityFromHeaders,
}));

vi.mock("@/lib/auth/authorization-state", () => ({
  readAuthorizationState: mockReadAuthorizationState,
}));

const identity = { userId: "user-123", clerkUserId: "clerk_123", sessionId: "sess_123" };

interface AdminDbDouble {
  db: Database;
  statements: CapturedStatement[];
  next(rows?: AdminMirrorRow[]): void;
}

describe("verifyAdmin", () => {
  let double: AdminDbDouble;

  beforeEach(() => {
    vi.clearAllMocks();
    double = createScriptedPostgres();
    mockHeaders.mockResolvedValue(new Headers());
    mockGetSessionIdentityFromHeaders.mockResolvedValue(identity);
    mockReadAuthorizationState.mockResolvedValue({
      is_admin: true,
      is_disabled: false,
      has_consent: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns the authenticated user when their profile is marked admin", async () => {
    double.next([{ email: "admin@example.com" }]);

    const result = await verifyAdmin(double.db);

    expect(result.email).toBe("admin@example.com");
    expect(result.clerkUserId).toBe("clerk_123");
    expect(result.sessionId).toBe("sess_123");
    expect(mockRedirect).not.toHaveBeenCalled();

    expect(mockReadAuthorizationState).toHaveBeenCalledWith(double.db, "user-123", {
      cache: false,
    });

    expect(double.statements).toHaveLength(1);
    const [statement] = double.statements;
    expect(statement.sql.replace(/\s+/g, " ").trim()).toBe(
      'select "email" from "users" where "users"."id" = $1 limit $2',
    );
    expect(statement.params).toEqual(["user-123", 1]);
  });

  it("redirects unauthenticated users to sign-in without touching the database", async () => {
    mockGetSessionIdentityFromHeaders.mockResolvedValueOnce(null);

    await expect(verifyAdmin(double.db)).rejects.toThrow("redirect:/sign-in");
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in");
    expect(mockReadAuthorizationState).not.toHaveBeenCalled();
    expect(double.statements).toHaveLength(0);
  });

  it("redirects disabled admins to sign-in via the fail-closed state", async () => {
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: true,
      has_consent: false,
    });

    await expect(verifyAdmin(double.db)).rejects.toThrow("redirect:/sign-in");
    expect(mockRedirect).toHaveBeenCalledWith("/sign-in");
    expect(double.statements).toHaveLength(0);
  });

  it("redirects authenticated non-admin users to the dashboard", async () => {
    mockReadAuthorizationState.mockResolvedValueOnce({
      is_admin: false,
      is_disabled: false,
      has_consent: true,
    });

    await expect(verifyAdmin(double.db)).rejects.toThrow("redirect:/dashboard");
    expect(mockRedirect).toHaveBeenCalledWith("/dashboard");
    expect(double.statements).toHaveLength(0);
  });

  it("falls back to an empty display email when the mirror row is missing", async () => {
    double.next([]);

    const result = await verifyAdmin(double.db);

    expect(result.email).toBe("");
    expect(mockRedirect).not.toHaveBeenCalled();
  });
});
