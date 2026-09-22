import { log } from '@/lib/log';
import type { ClassCheckMessage } from '@/lib/types/queue';

/**
 * One queue message exhausted its retries. The section is not abandoned:
 * the next cron cycle enqueues a fresh check. Log and ack. Do not email
 * or query the database — nothing reads those alerts, and a failing ASU
 * response would otherwise fan out into one email per section.
 */
export function handleDLQMessage(message: ClassCheckMessage): void {
  const { class_nbr, term, enqueued_at } = message;

  log('DLQ').error(
    `DLQ_SECTION_FAILED section ${class_nbr} term ${term} enqueued_at ${enqueued_at}`
  );
}
