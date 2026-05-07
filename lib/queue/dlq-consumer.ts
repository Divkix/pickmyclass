/**
 * Dead Letter Queue Consumer
 *
 * Handles messages that exhausted all retries in the main queue.
 * Provides visibility via structured logging and admin alert emails.
 */

import { getServiceClient } from '@/lib/supabase/service';
import type { ClassCheckMessage } from '@/lib/types/queue';

/**
 * Handle a dead letter queue message
 *
 * 1. Logs structured error for observability
 * 2. Looks up affected watchers
 * 3. Sends admin alert email via Cloudflare Email Service
 *
 * This function must never throw — DLQ messages should always be acked.
 */
export async function handleDLQMessage(
  message: ClassCheckMessage,
  emailBinding: SendEmail
): Promise<void> {
  const { class_nbr, term, enqueued_at } = message;
  const timestamp = new Date().toISOString();

  // 1. Structured error log
  console.error(
    '[DLQ]',
    `Section ${class_nbr} (term ${term}) permanently failed. Enqueued at: ${enqueued_at}. Processed at: ${timestamp}`
  );

  // 2. Look up affected watchers
  let watcherCount = 0;
  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc('get_class_watchers', {
      section_number: class_nbr,
    });

    if (error) {
      console.error('[DLQ]', `Failed to fetch watchers for section ${class_nbr}: ${error.message}`);
    } else {
      watcherCount = data?.length ?? 0;
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[DLQ]', `Failed to fetch watchers for section ${class_nbr}: ${errMsg}`);
  }

  console.log('[DLQ]', `Section ${class_nbr}: ${watcherCount} watchers affected`);

  // 3. Send admin alert email
  try {
    await emailBinding.send({
      to: 'alerts@pickmyclass.app',
      from: 'notifications@pickmyclass.app',
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
    });

    console.log('[DLQ]', `Alert email sent for section ${class_nbr}`);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[DLQ]', `Sending alert email failed for section ${class_nbr}: ${errMsg}`);
  }
}
