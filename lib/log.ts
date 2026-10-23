type LogMethods = {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
};

export function log(scope: string) {
  return {
    info: (...args: unknown[]) => console.info(`[${scope}]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${scope}]`, ...args),
    error: (...args: unknown[]) => console.error(`[${scope}]`, ...args),
  } satisfies LogMethods;
}

/** Product events and their fields: opaque ids only, never emails, names or other PII. */
interface ProductEventMap {
  class_watch_created: { user_id: string; term: string; class_nbr: string };
  class_watch_deleted: { user_id: string; watch_id: string };
  onboarding_skipped: { user_id: string };
  account_deleted: { user_id: string };
  user_unsubscribed: { user_id_hash: string; method: "GET" | "POST" };
  user_registered: { user_id: string; clerk_user_id: string; registered_at: string };
}

/**
 * Logs one product event as a single object, so Workers Logs indexes `event`
 * and each field for filtering once it reaches HyperDX.
 */
export function logEvent<E extends keyof ProductEventMap>(
  event: E,
  fields: ProductEventMap[E],
): void {
  console.info({ event, ...fields });
}
