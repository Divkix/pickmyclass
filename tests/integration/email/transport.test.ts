import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { EmailSendFailed, EmailTimedOut, isRetryableEmailCode } from "@/lib/email/errors";
import { sendEmailMessage } from "@/lib/email/transport";

const message: EmailMessageBuilder = {
  to: "student@test.com",
  from: "sender@test.com",
  subject: "Seat",
  text: "hi",
};

function binding(send: SendEmail["send"]): SendEmail {
  // SAFETY: the transport only calls send().
  return { send } as SendEmail;
}

async function caught(promise: Promise<EmailSendResult>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: Error) => error,
  );
}

describe("sendEmailMessage", () => {
  afterEach(() => vi.useRealTimers());

  it("returns the provider's result", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "message-1" });

    expect(await sendEmailMessage(binding(send), message)).toEqual({ messageId: "message-1" });
    expect(send).toHaveBeenCalledWith(message);
  });

  it("carries the provider code and a retry decision on a rejection", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("slow down"), { code: "E_RATE_LIMIT_EXCEEDED" }));

    const error = await caught(sendEmailMessage(binding(send), message));

    expect(error).toBeInstanceOf(EmailSendFailed);
    expect(error).toMatchObject({
      code: "E_RATE_LIMIT_EXCEEDED",
      message: "slow down",
      retryable: true,
    });
  });

  it("gives up on a permanent payload error", async () => {
    const send = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error("bad"), { code: "E_VALIDATION_ERROR" }));

    expect(await caught(sendEmailMessage(binding(send), message))).toMatchObject({
      code: "E_VALIDATION_ERROR",
      retryable: false,
    });
  });

  it("does not trust a thrown value that has no usable shape", async () => {
    const send = vi.fn().mockRejectedValue({ code: 500 });
    const error = await caught(sendEmailMessage(binding(send), message));

    expect(error).toBeInstanceOf(EmailSendFailed);
    expect(error).toMatchObject({ code: "UNKNOWN", retryable: true });
  });

  it("fails with EmailTimedOut when the provider never answers", async () => {
    vi.useFakeTimers();
    const send = vi.fn(() => new Promise<EmailSendResult>(() => {}));
    const pending = caught(sendEmailMessage(binding(send), message, 50));

    await vi.advanceTimersByTimeAsync(50);
    const error = await pending;

    expect(error).toBeInstanceOf(EmailTimedOut);
    expect(error).toMatchObject({ timeoutMs: 50 });
  });
});

describe("isRetryableEmailCode", () => {
  it.each([
    ["E_RATE_LIMIT_EXCEEDED", true],
    ["E_INTERNAL_SERVER_ERROR", true],
    ["UNKNOWN", true],
    ["E_SENDER_NOT_VERIFIED", false],
    ["E_RECIPIENT_SUPPRESSED", false],
    ["E_DELIVERY_FAILED", false],
  ])("%s -> %s", (code, expected) => {
    expect(isRetryableEmailCode(code)).toBe(expected);
  });
});
