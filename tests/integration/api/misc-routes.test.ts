import { callRouteHandler } from "@/tests/helpers/route-handler";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";

const { mockGetSessionIdentity, mockRevokeSession } = vi.hoisted(() => ({
  mockGetSessionIdentity: vi.fn(),
  mockRevokeSession: vi.fn(),
}));

vi.mock("@/lib/auth/clerk-session", () => ({
  getSessionIdentity: mockGetSessionIdentity,
  revokeSession: mockRevokeSession,
}));

import { Route as SignoutRoute } from "@/app/routes/api/auth/signout";
import { Route as UniversityRoute } from "@/app/routes/go/$uni";

function get(url: string): Request {
  return new Request(url);
}

const miscBody = z.object({ success: z.boolean().optional(), error: z.string().optional() });

async function json(response: Response) {
  return miscBody.parse(await response.json());
}

describe("misc API routes", () => {
  let errorSpy: { mockRestore: () => void };

  beforeEach(() => {
    vi.clearAllMocks();
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockRevokeSession.mockResolvedValue(undefined);
    mockGetSessionIdentity.mockResolvedValue({
      userId: "user-1",
      clerkUserId: "clerk_1",
      sessionId: "sess_1",
    });
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("signs users out by revoking the Clerk session and clearing cookies", async () => {
    const req = new Request("https://pickmyclass.app/api/auth/signout", {
      method: "POST",
    });

    const response = await callRouteHandler(SignoutRoute, "POST", req);
    const data = await json(response);

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(mockRevokeSession).toHaveBeenCalledWith("sess_1");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__session=");
    expect(response.headers.getSetCookie()).toEqual([
      "__session=; Path=/; Max-Age=0",
      "__client_uat=; Path=/; Max-Age=0",
      "__refresh=; Path=/; Max-Age=0",
      "__clerk_db_jwt=; Path=/; Max-Age=0",
      "__clerk_handshake=; Path=/; Max-Age=0",
      "__clerk_redirect_count=; Path=/; Max-Age=0",
    ]);
  });

  it("still returns 200 when session revocation fails", async () => {
    mockRevokeSession.mockRejectedValue(new Error("clerk unreachable"));

    const req = new Request("https://pickmyclass.app/api/auth/signout", {
      method: "POST",
    });

    const response = await callRouteHandler(SignoutRoute, "POST", req);

    expect(response.status).toBe(200);
  });

  it("redirects ASU short links after sanitizing parameters", async () => {
    const response = await callRouteHandler(
      UniversityRoute,
      "GET",
      get("https://pickmyclass.app/go/asu?classNbr=12x345&term=2261abc"),
      { uni: "asu" },
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://catalog.apps.asu.edu/catalog/classes/classlist?keywords=12345&term=2261",
    );
  });

  it("rejects unsupported or incomplete university short links", async () => {
    const missingParams = await callRouteHandler(
      UniversityRoute,
      "GET",
      get("https://pickmyclass.app/go/asu"),
      {
        uni: "asu",
      },
    );

    const unsupported = await callRouteHandler(
      UniversityRoute,
      "GET",
      get("https://pickmyclass.app/go/uofa?classNbr=12345&term=2261"),
      { uni: "uofa" },
    );

    expect(missingParams.status).toBe(400);
    expect((await json(missingParams)).error).toBe("Missing required parameters");
    expect(unsupported.status).toBe(404);
    expect((await json(unsupported)).error).toBe("University not supported");
  });
});
