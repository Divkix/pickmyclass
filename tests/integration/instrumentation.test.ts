import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { onRequestError } from "@/instrumentation";

const routeContext = {
  routerKind: "App Router",
  routePath: "/api/unsubscribe",
  routeType: "middleware",
} as const;

describe("onRequestError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs the stack, method and path without the query string", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = Object.assign(new Error("boom"), { digest: "123" });

    onRequestError(error, { path: "/api/unsubscribe?token=secret", method: "GET" }, routeContext);

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [scope, summary, detail] = errorSpy.mock.calls[0];
    expect(scope).toBe("[RequestError]");
    expect(summary).toBe("GET /api/unsubscribe (middleware /api/unsubscribe) digest=123:");
    expect(detail).toContain("Error: boom");
    expect(detail).toContain("instrumentation.test.ts");
    expect(JSON.stringify(errorSpy.mock.calls)).not.toContain("secret");
  });

  it("logs a non-Error throw instead of crashing", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // vinext forwards raw thrown values from route handlers: an Error-shaped plain object here.
    const thrown = { name: "Thrown", message: "nope", toString: () => "thrown: nope" };

    onRequestError(thrown, { path: "/api/x", method: "POST" }, routeContext);

    expect(errorSpy.mock.calls[0][2]).toBe("thrown: nope");
  });
});
