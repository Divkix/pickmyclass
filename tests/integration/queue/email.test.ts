import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { EMAIL_BATCH_DELAY_MS, EMAIL_BATCH_SIZE } from "@/lib/config";
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
  });

  it.each(["E_RATE_LIMIT_EXCEEDED", "E_DAILY_LIMIT_EXCEEDED", "E_SENDER_NOT_VERIFIED"])(
    "stops sending after fatal %s and marks remaining emails skipped",
    async (code) => {
      const env = environment();
      env.send.mockRejectedValueOnce(Object.assign(new Error("fatal"), { code }));
      const results = await sendBatchEmailsOptimized(emails(3), env.EMAIL);
      expect(env.send).toHaveBeenCalledOnce();
      expect(results).toEqual([
        { success: false, error: `${code}: fatal` },
        { success: false, error: `Skipped: ${code} limit reached` },
        { success: false, error: `Skipped: ${code} limit reached` },
      ]);
    },
  );

  it("continues after a nonfatal failure", async () => {
    const env = environment();
    env.send.mockRejectedValueOnce(new Error("temporary"));
    expect((await sendBatchEmailsOptimized(emails(2), env.EMAIL)).map((r) => r.success)).toEqual([
      false,
      true,
    ]);
    expect(env.send).toHaveBeenCalledTimes(2);
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
