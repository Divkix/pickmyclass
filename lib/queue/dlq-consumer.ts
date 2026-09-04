import { ALERTS_FROM_EMAIL, NOTIFICATION_FROM_EMAIL } from '@/lib/config';
import type { Database } from '@/lib/db';
import { getClassWatchers } from '@/lib/db/queries';
import { log } from '@/lib/log';
import type { ClassCheckMessage } from '@/lib/types/queue';

interface HandleDLQMessageOptions {
  fromEmail?: string;
}

export async function handleDLQMessage(
  db: Database,
  message: ClassCheckMessage,
  emailBinding: SendEmail,
  options: HandleDLQMessageOptions = {}
): Promise<void> {
  const { class_nbr, term, enqueued_at } = message;
  const timestamp = new Date().toISOString();
  const fromEmail = options.fromEmail || NOTIFICATION_FROM_EMAIL;

  log('DLQ').error(
    `Section ${class_nbr} (term ${term}) permanently failed. Enqueued at: ${enqueued_at}. Processed at: ${timestamp}`
  );

  let watcherCount = 0;
  try {
    const watchers = await getClassWatchers(db, { class_nbr, term });
    watcherCount = watchers.length;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    log('DLQ').error(`Failed to fetch watchers for section ${class_nbr}: ${errMsg}`);
  }

  log('DLQ').info(`Section ${class_nbr}: ${watcherCount} watchers affected`);

  try {
    await emailBinding.send({
      to: ALERTS_FROM_EMAIL,
      from: fromEmail,
      subject: `[DLQ Alert] Section ${class_nbr} permanently failed`,
      html: `
        <h2>Dead Letter Queue Alert</h2>
        <table style="border-collapse:collapse;">
          <tr><td><strong>Section:</strong></td><td>${class_nbr}</td></tr>
          <tr><td><strong>Term:</strong></td><td>${term}</td></tr>
          <tr><td><strong>Enqueued At:</strong></td><td>${enqueued_at}</td></tr>
          <tr><td><strong>Failed At:</strong></td><td>${timestamp}</td></tr>
          <tr><td><strong>Watchers Affected:</strong></td><td>${watcherCount}</td></tr>
        </table>
        <p>This section exhausted all 3 retries and was moved to the dead letter queue.
        It will be retried on the next cron cycle.</p>
      `,
      text: [
        'Dead Letter Queue Alert',
        '',
        `Section: ${class_nbr}`,
        `Term: ${term}`,
        `Enqueued At: ${enqueued_at}`,
        `Failed At: ${timestamp}`,
        `Watchers Affected: ${watcherCount}`,
        '',
        'This section exhausted all 3 retries and was moved to the dead letter queue.',
        'It will be retried on the next cron cycle.',
      ].join('\n'),
    });

    log('DLQ').info(`Alert email sent for section ${class_nbr}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    log('DLQ').error(`Sending alert email failed for section ${class_nbr}: ${errMsg}`);
  }
}
