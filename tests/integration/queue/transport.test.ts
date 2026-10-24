import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { QueueSendFailed, QueueSendTimedOut } from "@/lib/queue/errors";
import { sendQueueBatch } from "@/lib/queue/transport";

const messages = [
  { body: { class_nbr: "12345", term: "2267", enqueued_at: "2026-10-24T00:00:00.000Z" } },
];

async function caught(promise: Promise<void>): Promise<Error | undefined> {
  return promise.then(
    () => undefined,
    (error: Error) => error,
  );
}

describe("sendQueueBatch", () => {
  afterEach(() => vi.useRealTimers());

  it("sends the batch", async () => {
    const sendBatch = vi.fn().mockResolvedValue({ metadata: {} });

    await sendQueueBatch({ sendBatch }, messages);

    expect(sendBatch).toHaveBeenCalledWith(messages);
  });

  it("fails with QueueSendFailed, marked retryable", async () => {
    const sendBatch = vi.fn().mockRejectedValue(new Error("queue unavailable"));
    const error = await caught(sendQueueBatch({ sendBatch }, messages));

    expect(error).toBeInstanceOf(QueueSendFailed);
    expect(error).toMatchObject({ message: "queue unavailable", retryable: true });
  });

  it("fails with QueueSendTimedOut when the producer never answers", async () => {
    vi.useFakeTimers();
    const sendBatch = vi.fn(() => new Promise<QueueSendBatchResponse>(() => {}));
    const pending = caught(sendQueueBatch({ sendBatch }, messages, 40));

    await vi.advanceTimersByTimeAsync(40);
    const error = await pending;

    expect(error).toBeInstanceOf(QueueSendTimedOut);
    expect(error).toMatchObject({ timeoutMs: 40, retryable: true });
  });
});
