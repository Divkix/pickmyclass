/**
 * Postgres driver error shape helpers.
 *
 * postgres-js stamps the server's 5-character SQLSTATE on the thrown error's
 * `code` property (e.g. "23505" for unique_violation). Parse the shape once
 * here instead of scattering `(error as { code?: string })` casts across
 * routes and queue consumers.
 *
 * Every helper accepts the raw caught value (`unknown`) and narrows it, so
 * callers never cast before calling. Drizzle's statement-failure wrappers are
 * unwrapped first: a failed statement arrives as `DrizzleQueryError`
 * ("Failed query: …") with the raw postgres-js error — carrying the SQLSTATE
 * the mapping below keys on — parked on `.cause`.
 *
 * @module lib/db/pg-errors
 */
import { z } from 'zod';

/** Driver-error shape: SQLSTATE on `code`, optional human-readable message. */
const pgErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});

/** Narrowed Postgres error surface returned by {@link getPgError}. */
export type PgError = z.infer<typeof pgErrorSchema>;

// Caught JavaScript values are arbitrary by contract; every export narrows them here.
// oxlint-disable anti-slop/no-unknown-parameters

/** Message-only shape used by the duplicate-key fallback. */
const errorMessageSchema = z.object({
  message: z.string(),
});

/** SQLSTATE for unique constraint violations (duplicate key). */
export const PG_UNIQUE_VIOLATION = '23505';

/** SQLSTATE for RAISE EXCEPTION raised inside PL/pgSQL (RPC invariants). */
export const PG_RAISE_EXCEPTION = 'P0001';

/** SQLSTATE for calling an undefined function (e.g. missing RPC after a migration gap). */
export const PG_UNDEFINED_FUNCTION = '42883';

/**
 * Statement-failure wrapper shape drizzle throws for every rejected query
 * (`DrizzleQueryError`): the SQL text rides on `query`, bound values on
 * `params`, and the raw driver error parks on `cause`.
 */
interface StatementFailure {
  query: unknown;
  params: unknown;
  cause: unknown;
}

/** True when the caught value is one of drizzle's statement-failure wrappers. */
function isStatementFailure(value: unknown): value is StatementFailure {
  return (
    typeof value === 'object' &&
    value !== null &&
    'query' in value &&
    'params' in value &&
    'cause' in value &&
    value.cause !== undefined
  );
}

/**
 * One resolved view of a caught statement failure: the deepest cause beneath
 * up to five nested statement-failure wrappers (the value itself when there
 * are none), viewed as a Postgres error surface and as a best-effort human
 * message.
 */
interface CaughtDriverView {
  /** Deepest non-wrapper cause — what the narrowings below key on. */
  leaf: unknown;
  /** Postgres surface when the leaf carries SQLSTATE, else null. */
  pgError: PgError | null;
  /** `Error.message` when the leaf is an Error, else its string coercion. */
  message: string;
}

function viewCaughtDriver(error: unknown): CaughtDriverView {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && isStatementFailure(current); depth += 1) {
    current = current.cause;
  }
  const parsed = pgErrorSchema.safeParse(current);
  return {
    leaf: current,
    pgError: parsed.success ? parsed.data : null,
    message: current instanceof Error ? current.message : String(current),
  };
}

/**
 * Returns the narrowed Postgres error surface behind a caught value, or null
 * for unrelated values. Looks through drizzle statement-failure wrappers, so
 * callers pass whatever the `catch` bound.
 */
export function getPgError(error: unknown): PgError | null {
  return viewCaughtDriver(error).pgError;
}

/**
 * Human-readable message of the deepest driver error beneath drizzle's
 * statement-failure wrappers: `Error.message` when the leaf is an Error,
 * else its string coercion.
 */
export function driverErrorMessage(error: unknown): string {
  return viewCaughtDriver(error).message;
}

/**
 * True when a caught value is a Postgres unique-constraint violation:
 * either the driver surfaced SQLSTATE 23505 on `code`, or (fallback for
 * drivers/intermediaries that drop `code`) the classic duplicate-key message.
 */
export function isUniqueViolation(error: unknown): boolean {
  const { leaf, pgError } = viewCaughtDriver(error);
  if (pgError?.code === PG_UNIQUE_VIOLATION) return true;
  // Fallback for drivers/intermediaries that drop `code`.
  const parsedMessage = errorMessageSchema.safeParse(leaf);
  return parsedMessage.success && parsedMessage.data.message.includes('duplicate key value');
}

/**
 * True when a caught value is a PL/pgSQL RAISE EXCEPTION (SQLSTATE P0001) —
 * how the SECURITY DEFINER RPCs signal product-invariant failures such as
 * watch limits and "Section not found".
 */
export function isRaisedException(error: unknown): boolean {
  return viewCaughtDriver(error).pgError?.code === PG_RAISE_EXCEPTION;
}

/**
 * True when a caught value is PostgreSQL SQLSTATE 42883 (undefined function),
 * i.e. an RPC that does not exist against the connected database.
 */
export function isUndefinedFunction(error: unknown): boolean {
  return viewCaughtDriver(error).pgError?.code === PG_UNDEFINED_FUNCTION;
}
// oxlint-enable anti-slop/no-unknown-parameters
