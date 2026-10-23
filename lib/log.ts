/** Primitives only, so every field indexes as its own queryable key in Workers Logs. */
export type LogValue = string | number | boolean | null | undefined;

/** Fields on one log line: opaque ids, counts and durations, never emails, names or tokens. */
export type LogFields = Readonly<Record<string, LogValue>>;

type LogLevel = "info" | "warn" | "error";

// A type alias, not an interface, so it stays assignable to `LogFields`.
export type ErrorFields = {
  "error.message": string;
  "error.name": string;
  "error.code"?: string;
  stack?: string;
};

/**
 * Logs one object per line (`{ level, scope, msg, ...fields }`), so Workers
 * Logs indexes every key for HyperDX instead of one opaque message string.
 * The reserved keys are written last so a field can't overwrite them.
 */
function write(level: LogLevel, scope: string, msg: string, fields?: LogFields): void {
  console[level]({ ...fields, level, scope, msg });
}

export function log(scope: string) {
  return {
    info: (msg: string, fields?: LogFields) => write("info", scope, msg, fields),
    warn: (msg: string, fields?: LogFields) => write("warn", scope, msg, fields),
    error: (msg: string, fields?: LogFields) => write("error", scope, msg, fields),
  };
}

const MAX_MESSAGE_LENGTH = 1000;

// Anchored at a token start and bounded (RFC 5321 lengths) so a megabyte of
// junk scans in linear time. Backslash ends a token, so redacting inside a
// JSON string never eats the escape before a quote.
const EMAIL_PATTERN =
  /(?<![^\s@"'<>()\\])[^\s@"'<>()\\]{1,64}@[^\s@"'<>()\\]{1,255}\.[^\s@"'<>()\\]+/g;

// V8 (`    at fn (url:1:2)`) and Firefox/Safari (`fn@url:1:2`) stack frames.
const STACK_FRAME = /^\s*at |@\S*:\d+:\d+$/;

export function redactEmails(text: string): string {
  return text.replace(EMAIL_PATTERN, "[email]");
}

/** Provider and driver messages can echo a recipient or a row value back. */
function scrub(text: string): string {
  return redactEmails(text.slice(0, MAX_MESSAGE_LENGTH));
}

// `instanceof` rather than `typeof`, which the anti-slop lint bans.
function isText(cause: unknown): cause is string {
  return Object(cause) instanceof String;
}

function nonErrorMessage(cause: unknown): string {
  if (isText(cause)) return cause;

  try {
    return JSON.stringify(cause) ?? String(cause);
  } catch {
    return String(cause);
  }
}

interface DriverError {
  message: string;
  code?: string;
}

/**
 * Drizzle wraps a failed statement as `Failed query: <sql> params: <values>`
 * with the driver error on `.cause`. Same unwrap as `lib/db/pg-errors.ts`,
 * inlined to keep zod out of the client bundle.
 */
function driverError(cause: unknown): DriverError {
  let current = cause;

  for (let depth = 0; depth < 5; depth += 1) {
    if (!(current instanceof Object && "query" in current && "params" in current)) break;

    if (!("cause" in current) || current.cause === undefined) break;
    current = current.cause;
  }

  if (!(current instanceof Object)) return { message: nonErrorMessage(current) };

  return {
    message:
      "message" in current && isText(current.message) ? current.message : nonErrorMessage(current),
    code: "code" in current && isText(current.code) ? current.code : undefined,
  };
}

/** The error's own `name`, or `NonError` for a thrown value with no message. */
export function errorName(cause: unknown): string {
  if (!(cause instanceof Object && "message" in cause)) return "NonError";

  return "name" in cause && isText(cause.name) ? cause.name : "Error";
}

/**
 * Log fields for a caught value, tolerating non-Error throws. A Drizzle
 * statement failure is reduced to the driver's message and SQLSTATE, and the
 * stack keeps only its frames under a rebuilt header, so bound SQL params never
 * reach telemetry. Email addresses are redacted and messages are capped.
 */
export function errorFields(cause: unknown): ErrorFields {
  if (!(cause instanceof Object && "message" in cause))
    return { "error.message": scrub(nonErrorMessage(cause)), "error.name": "NonError" };

  const name = errorName(cause);
  const driver = driverError(cause);
  const message = scrub(driver.message);
  const fields: ErrorFields = { "error.message": message, "error.name": name };

  if (driver.code) fields["error.code"] = driver.code;
  const stack = "stack" in cause && isText(cause.stack) ? cause.stack : "";
  const frames = stack.split("\n").filter((line) => STACK_FRAME.test(line));

  if (frames.length > 0) fields.stack = [`${name}: ${message}`, ...frames].join("\n");

  return fields;
}

/** Which caller spent an ASU request, so UI and probe traffic can be told apart from Section Checks. */
export type AsuRequestSource = "section_check" | "health" | "ui";

/**
 * Product and pipeline events and their fields: opaque ids, counts and
 * durations only, never emails, names or other PII. The pipeline events are
 * the app's metrics; HyperDX charts their numeric fields.
 */
interface ProductEventMap {
  class_watch_created: { user_id: string; term: string; class_nbr: string };
  class_watch_deleted: { user_id: string; watch_id: string };
  onboarding_skipped: { user_id: string };
  account_deleted: { user_id: string };
  user_unsubscribed: { user_id_hash: string; method: "GET" | "POST" };
  user_registered: { user_id: string; clerk_user_id: string; registered_at: string };
  /** One per SectionCheckWorkflow run, once its batches are enqueued. */
  section_check_cycle_enqueued: {
    cycle: string;
    workflow_instance_id: string;
    stagger_group: string;
    sections: number;
    batches: number;
    failed_batches: number;
    /** Scheduled fire time to the last enqueue. */
    enqueue_lag_ms: number;
  };
  /** One per queue delivery. Max `cycle_elapsed_ms` per cycle is the Cron Cycle's duration. */
  section_check_completed: {
    class_nbr: string;
    term: string;
    cycle?: string;
    workflow_instance_id?: string;
    result: "ok" | "failed" | "threw";
    disposition: "ack" | "retry";
    attempts: number;
    duration_ms: number;
    cycle_elapsed_ms?: number;
    emails_sent: number;
    seat_opened: boolean;
    instructor_assigned: boolean;
    /** A retry on the last allowed attempt, which Queues moves to the DLQ. */
    dead_lettered: boolean;
  };
  queue_batch_processed: {
    queue: string;
    messages: number;
    successful: number;
    failed: number;
    duration_ms: number;
  };
  /** One per ASU network fetch (cache hits are not requests). */
  asu_request: {
    class_nbr: string;
    term: string;
    source: AsuRequestSource;
    /** `ok`, or the error class: `NotFoundError`, `RateLimitError`, `AuthError`, `ApiError`. */
    outcome: string;
    http_status?: number;
    duration_ms: number;
  };
  email_batch_sent: { sent: number; failed: number; skipped: number; duration_ms: number };
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
