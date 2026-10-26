import { callRouteHandler } from "@/tests/helpers/route-handler";
import { createHash } from "node:crypto";
import { createScriptedPostgres } from "@/tests/mocks/scripted-postgres";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

import { Route } from "@/app/routes/api/unsubscribe";

let pg = createScriptedPostgres();

const { mockVerifyUnsubscribeToken, mockLogEvent } = vi.hoisted(() => ({
  mockVerifyUnsubscribeToken: vi.fn(),
  mockLogEvent: vi.fn(),
}));

vi.mock("@/lib/email/unsubscribe-token", () => ({
  verifyUnsubscribeToken: mockVerifyUnsubscribeToken,
}));

vi.mock("@/lib/log", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/log")>()),
  logEvent: mockLogEvent,
}));

vi.mock("@/lib/db", () => ({
  getDbFromEnv: () => pg.db,
}));

function request(url: string, method = "GET"): Request {
  return new Request(url, { method });
}

const unsubscribeBody = z.object({
  success: z.boolean().optional(),
  error: z.string().optional(),
});

async function json(response: Response) {
  return unsubscribeBody.parse(await response.json());
}

describe("/api/unsubscribe", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    pg = createScriptedPostgres();
    mockVerifyUnsubscribeToken.mockReturnValue("user-123");
  });

  afterEach(() => {
    errorSpy.mockRestore();
    logSpy.mockRestore();
  });

  it("rejects missing GET tokens with an HTML error page", async () => {
    const response = await callRouteHandler(
      Route,
      "GET",
      request("https://pickmyclass.app/api/unsubscribe"),
    );

    const body = await response.text();

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(body).toContain("Invalid Unsubscribe Link");
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(0);
  });

  it("rejects invalid GET tokens before touching the database", async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await callRouteHandler(
      Route,
      "GET",
      request("https://pickmyclass.app/api/unsubscribe?token=bad"),
    );

    const body = await response.text();

    expect(response.status).toBe(400);
    expect(body).toContain("Invalid or Expired Token");
    expect(pg.statements).toHaveLength(0);
  });

  it("renders a confirmation form for valid GET requests without mutating state", async () => {
    const response = await callRouteHandler(
      Route,
      "GET",
      request("https://pickmyclass.app/api/unsubscribe?token=good"),
    );

    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("Confirm Unsubscribe");
    expect(pg.statements).toHaveLength(0);
  });

  it("validates one-click POST requests", async () => {
    const response = await callRouteHandler(
      Route,
      "POST",
      request("https://pickmyclass.app/api/unsubscribe", "POST"),
    );

    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid input");
    expect(mockVerifyUnsubscribeToken).not.toHaveBeenCalled();
    expect(pg.statements).toHaveLength(0);
  });

  it("rejects invalid one-click POST tokens", async () => {
    mockVerifyUnsubscribeToken.mockReturnValue(null);

    const response = await callRouteHandler(
      Route,
      "POST",
      request("https://pickmyclass.app/api/unsubscribe?token=bad", "POST"),
    );

    const data = await json(response);

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid or expired token");
    expect(pg.statements).toHaveLength(0);
  });

  it("unsubscribes valid one-click POST requests via a single profile update", async () => {
    const response = await callRouteHandler(
      Route,
      "POST",
      request("https://pickmyclass.app/api/unsubscribe?token=good", "POST"),
    );

    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);

    expect(pg.statements).toHaveLength(1);
    const statement = pg.statements[0];
    expect(statement.sql).toContain('"user_profiles"');
    expect(statement.params).toEqual(expect.arrayContaining(["user-123"]));
    expect(statement.params).toContain(false);

    expect(mockLogEvent).toHaveBeenCalledWith("user_unsubscribed", {
      user_id_hash: createHash("sha256").update("user-123").digest("hex"),
      method: "POST",
    });
  });

  // Browser form submissions get a result page; one-click clients keep the JSON tests above.
  it.each([
    { token: null, status: 400, message: "Invalid Unsubscribe Link" },
    { token: "bad", status: 400, message: "Invalid or Expired Token" },
    { token: "good", status: 200, message: "You have been unsubscribed" },
    { token: "good", status: 500, message: "Internal server error" },
  ])("returns HTML for browser POSTs with status $status", async ({ token, status, message }) => {
    if (token === "bad") mockVerifyUnsubscribeToken.mockReturnValue(null);

    if (status === 500) pg.failNext(new Error("database down"));

    const url = new URL("https://pickmyclass.app/api/unsubscribe");

    if (token) url.searchParams.set("token", token);

    const response = await callRouteHandler(
      Route,
      "POST",
      new Request(url, {
        method: "POST",
        headers: { Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
      }),
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain(message);
    expect(pg.statements).toHaveLength(status === 400 ? 0 : 1);
  });

  it("logs no event when one-click POST persistence fails", async () => {
    pg.failNext(new Error("database down"));

    const response = await callRouteHandler(
      Route,
      "POST",
      request("https://pickmyclass.app/api/unsubscribe?token=good", "POST"),
    );

    const data = await json(response);

    expect(response.status).toBe(500);
    expect(data).toEqual({ success: false, error: "Internal server error" });
    expect(mockLogEvent).not.toHaveBeenCalled();
  });
});
