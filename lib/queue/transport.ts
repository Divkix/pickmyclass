/**
 * The only place that calls the Queue producer binding: an explicit timeout and
 * typed failures around `sendBatch`.
 *
 * @module lib/queue/transport
 */
import { Effect } from "effect";
import { QUEUE_SEND_TIMEOUT_MS } from "@/lib/config";
import { QueueSendFailed, QueueSendTimedOut } from "@/lib/queue/errors";
import { externalCall } from "@/lib/effect/external-call";
import type { Env } from "@/lib/types/env";
import type { ClassCheckMessage } from "@/lib/types/queue";

export function sendQueueBatch(
  queue: Pick<Env["PICKMYCLASS_QUEUE"], "sendBatch">,
  messages: Array<MessageSendRequest<ClassCheckMessage>>,
  timeoutMs = QUEUE_SEND_TIMEOUT_MS,
): Promise<void> {
  return Effect.runPromise(
    externalCall(
      async () => {
        await queue.sendBatch(messages);
      },
      timeoutMs,
      (error) => new QueueSendFailed({ message: error.message, retryable: true, cause: error }),
      () =>
        new QueueSendTimedOut({
          message: `Queue sendBatch timed out after ${timeoutMs}ms`,
          timeoutMs,
          retryable: true,
        }),
    ),
  );
}
