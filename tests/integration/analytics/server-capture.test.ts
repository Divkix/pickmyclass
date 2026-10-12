import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { mockCaptureImmediate } = vi.hoisted(() => ({
  mockCaptureImmediate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("posthog-node", () => ({
  PostHog: class {
    captureImmediate = mockCaptureImmediate;

    shutdown = vi.fn().mockResolvedValue(undefined);
  },
}));

import { captureServerEvent } from "@/lib/analytics/server";

const UUID_V8 = /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("captureServerEvent", () => {
  beforeEach(() => {
    mockCaptureImmediate.mockClear();
  });

  it("lets PostHog assign uuid and timestamp when no dedupe key is given", () => {
    captureServerEvent("user_app", "user_logged_out", {});

    expect(mockCaptureImmediate).toHaveBeenCalledWith({
      distinctId: "user_app",
      event: "user_logged_out",
      properties: {},
      uuid: undefined,
      timestamp: undefined,
    });
  });

  it("sends the same uuid and source timestamp for every retry of one dedupe key", () => {
    const timestamp = new Date(1_754_000_000_000);

    captureServerEvent("user_app", "user_registered", {}, { key: "user_registered:a", timestamp });
    captureServerEvent("user_app", "user_registered", {}, { key: "user_registered:a", timestamp });
    captureServerEvent("user_app", "user_registered", {}, { key: "user_registered:b", timestamp });

    const [first, retry, other] = mockCaptureImmediate.mock.calls.map(([message]) => message);

    expect(first.uuid).toMatch(UUID_V8);
    expect(first.timestamp).toBe(timestamp);
    expect(retry.uuid).toBe(first.uuid);
    expect(other.uuid).not.toBe(first.uuid);
  });
});
