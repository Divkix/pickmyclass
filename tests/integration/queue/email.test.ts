import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE, EMAIL_SEND_TIMEOUT_MS } from "@/lib/config";
import { sendBatchEmailsOptimized, type OutboundEmail } from "@/lib/email/send";
import { details, environment, ref } from "./fixtures";

function emails(count: number): OutboundEmail[] {
  return Array.from({ length: count }, (_, i) => ({
    to: `student${i}@test.com`,
    userId: `user-${i}`,
    classInfo: { ...details, ...ref },
    type: "seat_available",
  }));
}

describe("sendBatchEmailsOptimized", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it.each([
    "E_RATE_LIMIT_EXCEEDED",
    "E_DAILY_LIMIT_EXCEEDED",
    "E_SENDER_NOT_VERIFIED",
    "E_SENDER_DOMAIN_NOT_AVAILABLE",
    "E_ACCOUNT_SUSPENDED",
  ])("stops sending after fatal %s and marks remaining emails skipped", async (code) => {
    const env = environment();
    env.send.mockRejectedValueOnce(Object.assign(new Error("fatal"), { code }));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const results = await sendBatchEmailsOptimized(emails(3), env.EMAIL);
    expect(env.send).toHaveBeenCalledOnce();
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "email_batch_sent", sent: 0, failed: 1, skipped: 2 }),
    );
    const retryable = code === "E_RATE_LIMIT_EXCEEDED" || code === "E_DAILY_LIMIT_EXCEEDED";
    expect(results).toMatchObject([
      { success: false, error: `${code}: fatal`, code, retryable },
      { success: false, error: `Skipped after ${code}`, code, retryable },
      { success: false, error: `Skipped after ${code}`, code, retryable },
    ]);
  });

  it("continues after a nonfatal failure", async () => {
    const env = environment();
    env.send.mockRejectedValueOnce(new Error("temporary"));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    expect((await sendBatchEmailsOptimized(emails(2), env.EMAIL)).map((r) => r.success)).toEqual([
      false,
      true,
    ]);
    expect(env.send).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "email_batch_sent", sent: 1, failed: 1, skipped: 0 }),
    );
  });

  it("pauses between batches, without a trailing delay", async () => {
    vi.useFakeTimers();
    const env = environment();
    const result = sendBatchEmailsOptimized(emails(EMAIL_BATCH_SIZE + 1), env.EMAIL);
    await vi.advanceTimersByTimeAsync(0);
    expect(env.send).toHaveBeenCalledTimes(EMAIL_BATCH_SIZE);
    await vi.advanceTimersByTimeAsync(EMAIL_BATCH_DELAY_MS - 1);
    expect(env.send).toHaveBeenCalledTimes(EMAIL_BATCH_SIZE);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toHaveLength(EMAIL_BATCH_SIZE + 1);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("sendBatchEmailsOptimized timeouts", () => {
  beforeEach(() => {
    vi.stubEnv("UNSUBSCRIBE_SIGNING_SECRET", "test-signing-secret");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("marks a timed-out send as unknown and keeps sending the rest", async () => {
    vi.useFakeTimers();
    const env = environment();
    env.send.mockImplementationOnce(() => new Promise(() => {}));
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const pending = sendBatchEmailsOptimized(emails(2), env.EMAIL);

    await vi.advanceTimersByTimeAsync(EMAIL_SEND_TIMEOUT_MS);
    const results = await pending;

    expect(results[0]).toMatchObject({
      success: false,
      error: expect.stringContaining("TIMEOUT"),
      code: "TIMEOUT",
      retryable: true,
      outcomeUnknown: true,
    });
    expect(results[1]?.success).toBe(true);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "email_batch_sent",
        sent: 1,
        failed: 0,
        unknown_outcome: 1,
      }),
    );
  });
});
