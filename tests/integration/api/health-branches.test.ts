import { callRouteHandler } from "@/tests/helpers/route-handler";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { z } from "zod";
import { withJsonApiError } from "@/lib/worker/api-errors";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | JsonValue[]
  | { [key: string]: JsonValue };

type HealthRouteOptions = {
  envOverrides?: Record<string, JsonValue>;
  dbThrows?: boolean;
  dbResult?: { error: { message: string } | null } | null;
  asuError?: Error;
};

const baseEnv = {
  ASU_API_BASE_URL: "https://classes.example.test",
  ASU_API_TOKEN: "test-token",
  CRON_SECRET: "test-cron-secret",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  SUPABASE_SEND_EMAIL_HOOK_SECRET: "whsec_test",
  EMAIL: { send: vi.fn() },
  NOTIFICATION_FROM_EMAIL: "notifications@pickmyclass.app",
};

async function loadHealthRoute(options: HealthRouteOptions = {}) {
  vi.resetModules();

  const env = { ...baseEnv, ...options.envOverrides };

  vi.doMock("cloudflare:workers", () => ({ env }));

  class MockNotFoundError extends Error {}

  const fetchClassFromASU = vi.fn();

  if (options.asuError) {
    fetchClassFromASU.mockRejectedValue(options.asuError);
  } else {
    fetchClassFromASU.mockRejectedValue(new MockNotFoundError("not found but reachable"));
  }

  vi.doMock("@/lib/asu/api", () => ({
    fetchClassFromASU,
    NotFoundError: MockNotFoundError,
  }));

  const dbProbe = vi.fn(async () => {
    if (options.dbThrows) {
      throw new Error("service unavailable");
    }

    if (options.dbResult?.error) {
      throw new Error(options.dbResult.error.message);
    }

    return [{ id: "probe-row" }];
  });

  const getDbFromEnv = vi.fn(() => ({
    select: () => ({ from: () => ({ limit: dbProbe }) }),
  }));

  vi.doMock("@/lib/db", () => ({ getDbFromEnv }));

  // Import after per-test mocks so module initialization uses this test's bindings.
  const mod = await import("@/app/routes/api/monitoring/health");

  return {
    Route: mod.Route,
    fetchClassFromASU,
    getDbFromEnv,
    dbProbe,
  };
}

function request(auth = "Bearer test-cron-secret") {
  return new Request("https://pickmyclass.app/api/monitoring/health", {
    headers: auth ? { authorization: auth } : {},
  });
}

const healthCheck = z.object({
  status: z.string().optional(),
  error: z.string().optional(),
  configured: z.boolean().optional(),
  missing_vars: z.array(z.string()).optional(),
  missing: z.array(z.string()).optional(),
});

const healthResponse = z.object({
  status: z.string(),
  checks: z.record(z.string(), healthCheck),
});

const livenessResponse = z.object({ status: z.string() });

describe("GET /api/monitoring/health branch coverage", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    vi.doUnmock("cloudflare:workers");
    vi.doUnmock("@/lib/asu/api");
    vi.doUnmock("@/lib/db");
  });

  it("keeps the JSON 405 response for unsupported methods", async () => {
    const { Route, getDbFromEnv, fetchClassFromASU } = await loadHealthRoute();

    const request = new Request("https://pickmyclass.app/api/monitoring/health", {
      method: "POST",
    });

    const result = await callRouteHandler(Route, "ANY", request);
    const response = withJsonApiError(result, new URL(request.url).pathname, request.method);

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "POST is not allowed on /api/monitoring/health",
      details: {
        code: "method_not_allowed",
        status: 405,
        resolution: "Public endpoints are documented at https://pickmyclass.app/openapi.json",
      },
    });
    expect(getDbFromEnv).not.toHaveBeenCalled();
    expect(fetchClassFromASU).not.toHaveBeenCalled();
  });

  it("returns a cheap liveness probe without auth", async () => {
    const { Route, getDbFromEnv, dbProbe } = await loadHealthRoute();

    const response = await callRouteHandler(Route, "GET", request(""));
    const data = livenessResponse.parse(await response.json());

    expect(response.status).toBe(200);
    expect(data.status).toBe("ok");
    expect(getDbFromEnv).not.toHaveBeenCalled();
    expect(dbProbe).not.toHaveBeenCalled();
  });

  it("uses Worker bindings for healthy detailed checks", async () => {
    vi.stubEnv("CRON_SECRET", "stale-process-secret");
    const { Route } = await loadHealthRoute();

    const response = await callRouteHandler(Route, "GET", request());

    const data = healthResponse.parse(await response.json());

    expect(response.status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.checks.database.status).toBe("healthy");
    expect(data.checks.asu_api.status).toBe("healthy");
    expect(data.checks.configuration.status).toBe("healthy");
    expect(data.checks.email).toEqual({ status: "healthy", configured: true });
    expect(data.checks.cron_lock).toBeUndefined();
  });

  it("reports degraded checks when database and ASU checks fail", async () => {
    const { Route } = await loadHealthRoute({
      dbResult: { error: { message: "database rejected query" } },
      asuError: new Error("ASU unavailable"),
    });

    const response = await callRouteHandler(Route, "GET", request());

    const data = healthResponse.parse(await response.json());

    expect(response.status).toBe(503);
    expect(data.status).toBe("degraded");
    expect(data.checks.database).toMatchObject({
      status: "unhealthy",
      error: "database rejected query",
    });
    expect(data.checks.asu_api).toMatchObject({ status: "unhealthy", error: "ASU unavailable" });
  });

  it("reports unhealthy checks for service exceptions and missing config", async () => {
    // Process env must not hide missing Worker bindings.
    vi.stubEnv("ASU_API_BASE_URL", baseEnv.ASU_API_BASE_URL);
    vi.stubEnv("ASU_API_TOKEN", baseEnv.ASU_API_TOKEN);
    vi.stubEnv("NOTIFICATION_FROM_EMAIL", baseEnv.NOTIFICATION_FROM_EMAIL);

    const { Route } = await loadHealthRoute({
      dbThrows: true,
      envOverrides: {
        SUPABASE_SERVICE_ROLE_KEY: undefined,
        ASU_API_BASE_URL: undefined,
        ASU_API_TOKEN: undefined,
        SUPABASE_SEND_EMAIL_HOOK_SECRET: undefined,
        EMAIL: undefined,
        NOTIFICATION_FROM_EMAIL: undefined,
      },
    });

    const response = await callRouteHandler(Route, "GET", request());

    const data = healthResponse.parse(await response.json());

    expect(response.status).toBe(500);
    expect(data.status).toBe("unhealthy");
    expect(data.checks.database).toMatchObject({
      status: "unhealthy",
      error: "service unavailable",
    });
    expect(data.checks.configuration.missing_vars).toEqual(
      expect.arrayContaining(["ASU_API_BASE_URL", "ASU_API_TOKEN"]),
    );
    expect(data.checks.email.missing).toEqual(
      expect.arrayContaining(["EMAIL binding", "NOTIFICATION_FROM_EMAIL"]),
    );
  });
});
