import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("cloudflare:workers", () => ({
  env: { UNSUBSCRIBE_SIGNING_SECRET: "test-unsubscribe-signing-secret" },
}));

import { generateUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/email/unsubscribe-token";

const userId = "6f1c2a3e-1111-4444-8888-123456789abc";
const dayMs = 24 * 60 * 60 * 1000;

describe("unsubscribe tokens", () => {
  beforeEach(() => {
    // The Worker exposes bindings to Node-compatible process.env, which this module reads.
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", env.UNSUBSCRIBE_SIGNING_SECRET);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-24T00:00:00.000Z"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("verifies a generated token as the original user", () => {
    expect(verifyUnsubscribeToken(generateUnsubscribeToken(userId))).toBe(userId);
  });

  it("rejects a tampered payload even when the original signature is retained", () => {
    const decoded = Buffer.from(generateUnsubscribeToken(userId), "base64url").toString("utf8");

    const tampered = Buffer.from(decoded.replace(userId, "user_someone_else")).toString(
      "base64url",
    );

    expect(verifyUnsubscribeToken(tampered)).toBeNull();
  });

  it("rejects a tampered signature with an otherwise unchanged payload", () => {
    const decoded = Buffer.from(generateUnsubscribeToken(userId), "base64url").toString("utf8");
    const changedSignature = decoded.slice(0, -1) + (decoded.endsWith("0") ? "1" : "0");

    expect(verifyUnsubscribeToken(Buffer.from(changedSignature).toString("base64url"))).toBeNull();
  });

  it("expires a default token after 90 days", () => {
    const token = generateUnsubscribeToken(userId);
    vi.advanceTimersByTime(90 * dayMs - 1);
    expect(verifyUnsubscribeToken(token)).toBe(userId);

    vi.advanceTimersByTime(2);
    expect(verifyUnsubscribeToken(token)).toBeNull();
  });

  it("allows the same token to be reused throughout its validity window", () => {
    const token = generateUnsubscribeToken(userId);
    expect(verifyUnsubscribeToken(token)).toBe(userId);
    expect(verifyUnsubscribeToken(token)).toBe(userId);

    vi.advanceTimersByTime(45 * dayMs);
    expect(verifyUnsubscribeToken(token)).toBe(userId);
    expect(verifyUnsubscribeToken(token)).toBe(userId);
  });
});
