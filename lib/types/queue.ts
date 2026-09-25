export interface ClassCheckMessage {
  class_nbr: string;
  term: string;
  enqueued_at: string;
  /**
   * Cron cycle stamp (`<scheduledTime ISO>:<stagger group>`) set by `SectionCheckWorkflow`.
   * A message redelivered after this section was already checked during the
   * same cycle is a no-op, so duplicates do not re-fetch ASU or re-notify.
   */
  cycle?: string;
}
