/** Email-alert preferences use the signed-in identity and atomically update unsubscribe state. */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import type { MockInstance } from "vite-plus/test";
import type * as LogModule from "@/lib/log";
import { callRouteHandler } from "@/tests/helpers/route-handler";
import { createScriptedPostgres } from "@/tests/mocks/scripted-postgres";

let pg = createScriptedPostgres();

const { mockRequireUser, mockLogEvent } = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@/lib/auth/require-user", () => {
  class UnauthorizedError extends Error {
    constructor(message = "Unauthorized") {
      super(message);
      this.name = "UnauthorizedError";
    }
  }

  return { requireUser: mockRequireUser, UnauthorizedError };
});

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof LogModule>()),
  logEvent: mockLogEvent,
}));

vi.mock("@/lib/db", () => ({ getDbFromEnv: () => pg.db }));

import { Route } from "@/app/routes/api/user/notifications";
import { UnauthorizedError } from "@/lib/auth/require-user";

const endpoint = "https://pickmyclass.app/api/user/notifications";

const preference = {
  notifications_enabled: true,
  email_bounced: false,
  spam_complained: false,
};

function patchRequest(body: { notifications_enabled?: unknown }): Request {
  return new Request(endpoint, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/user/notifications", () => {
  let errorSpy: MockInstance<typeof console.error>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    pg = createScriptedPostgres();
    mockRequireUser.mockResolvedValue({
      user: { userId: "user-123", clerkUserId: "clerk-456", sessionId: null },
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("reads the current preference and delivery blocks for the signed-in user", async () => {
    const stored = { ...preference, notifications_enabled: false, spam_complained: true };
    pg.next([stored]);

    const response = await callRouteHandler(Route, "GET", new Request(endpoint));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...stored, success: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(pg.statements).toHaveLength(1);
    expect(pg.statements[0].params).toEqual(["user-123", 1]);
    expect(pg.statements[0].sql).toContain('where "user_profiles"."user_id" = $1');
  });

  it("enables alerts and clears unsubscribed_at without removing a delivery block", async () => {
    const stored = { ...preference, email_bounced: true };
    pg.next([stored]);

    const response = await callRouteHandler(
      Route,
      "PATCH",
      patchRequest({ notifications_enabled: true }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...stored, success: true });
    expect(pg.statements).toHaveLength(1);
    const statement = pg.statements[0];
    expect(statement.sql).toContain('update "user_profiles"');
    expect(statement.sql).toContain('"notifications_enabled" = $1, "unsubscribed_at" = $2');
    expect(statement.sql).toContain('where "user_profiles"."user_id" = $3');
    expect(statement.sql).not.toContain('"email_bounced" =');
    expect(statement.sql).not.toContain('"spam_complained" =');
    expect(statement.params).toEqual([true, null, "user-123"]);
    expect(mockLogEvent).toHaveBeenCalledWith("user_resubscribed", {
      user_id_hash: createHash("sha256").update("user-123").digest("hex"),
      method: "settings",
    });
  });

  it("disables alerts and records the unsubscribe time in the same update", async () => {
    const stored = { ...preference, notifications_enabled: false };
    pg.next([stored]);

    const response = await callRouteHandler(
      Route,
      "PATCH",
      patchRequest({ notifications_enabled: false }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ...stored, success: true });
    expect(pg.statements).toHaveLength(1);
    const statement = pg.statements[0];
    expect(statement.sql).toContain('"notifications_enabled" = $1, "unsubscribed_at" = now()');
    expect(statement.sql).toContain('where "user_profiles"."user_id" = $2');
    expect(statement.params).toEqual([false, "user-123"]);
    expect(mockLogEvent).toHaveBeenCalledWith("user_unsubscribed", {
      user_id_hash: createHash("sha256").update("user-123").digest("hex"),
      method: "settings",
    });
  });

  it.each(["GET", "PATCH"] as const)(
    "rejects unauthenticated %s requests without touching any rows",
    async (method) => {
      mockRequireUser.mockRejectedValueOnce(new UnauthorizedError());

      const request =
        method === "PATCH" ? patchRequest({ notifications_enabled: true }) : new Request(endpoint);

      const response = await callRouteHandler(Route, method, request);

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ success: false, error: "Unauthorized" });
      expect(pg.statements).toHaveLength(0);
      expect(mockLogEvent).not.toHaveBeenCalled();
    },
  );

  it.each([
    {},
    { notifications_enabled: "true" },
    { notifications_enabled: true, user_id: "other" },
  ])("rejects invalid or client-selected identity input: %j", async (body) => {
    const response = await callRouteHandler(Route, "PATCH", patchRequest(body));

    expect(response.status).toBe(400);
    expect(pg.statements).toHaveLength(0);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("does not report a successful update for a missing profile", async () => {
    pg.next([]);

    const response = await callRouteHandler(
      Route,
      "PATCH",
      patchRequest({ notifications_enabled: true }),
    );

    expect(response.status).toBe(404);
    expect(mockLogEvent).not.toHaveBeenCalled();
  });

  it("returns a plain error and no product event when the update fails", async () => {
    pg.failNext(new Error("Database unavailable"));

    const response = await callRouteHandler(
      Route,
      "PATCH",
      patchRequest({ notifications_enabled: true }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Failed to update email alert preference",
    });
    expect(mockLogEvent).not.toHaveBeenCalled();
  });
});
