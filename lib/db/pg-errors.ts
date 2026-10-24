/**
 * Postgres driver error shape helpers.
 *
 * node-postgres stamps the server's 5-character SQLSTATE on the thrown error's
 * `code` property (e.g. "23505" for unique_violation). Parse the shape once
 * here instead of scattering `(error as { code?: string })` casts across
 * routes and queue consumers.
 *
 * Every helper accepts the raw caught value (`unknown`) and narrows it, so
 * callers never cast before calling. Drizzle's statement-failure wrappers are
 * unwrapped first: a failed statement arrives as `DrizzleQueryError`
 * ("Failed query: …") with the raw node-postgres error — carrying the SQLSTATE
 * the mapping below keys on — parked on `.cause`.
 *
 * @module lib/db/pg-errors
 */
import { z } from "zod";

const pgErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});

export type PgError = z.infer<typeof pgErrorSchema>;

// Caught JavaScript values are arbitrary by contract; every export narrows them here.

const errorMessageSchema = z.object({
  message: z.string(),
});

export const PG_UNIQUE_VIOLATION = "23505";

export const PG_RAISE_EXCEPTION = "P0001";

export const PG_UNDEFINED_FUNCTION = "42883";

interface StatementFailure {
  query: unknown;
  params: unknown;
  cause: unknown;
}

const statementFailureSchema = z
  .object({
    query: z.string(),
    params: z.array(z.unknown()),
    cause: z.unknown(),
  })
  .refine((value) => value.cause !== undefined);

function isStatementFailure(value: unknown): value is StatementFailure {
  return statementFailureSchema.safeParse(value).success;
}

interface CaughtDriverView {
  leaf: unknown;
  pgError: PgError | null;
  message: string;
}

function viewCaughtDriver(cause: unknown): CaughtDriverView {
  let current: unknown = cause;

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

export function getPgError(cause: unknown): PgError | null {
  return viewCaughtDriver(cause).pgError;
}

export function driverErrorMessage(cause: unknown): string {
  return viewCaughtDriver(cause).message;
}

export function isUniqueViolation(cause: unknown): boolean {
  const { leaf, pgError } = viewCaughtDriver(cause);

  if (pgError?.code === PG_UNIQUE_VIOLATION) return true;
  const parsedMessage = errorMessageSchema.safeParse(leaf);

  return parsedMessage.success && parsedMessage.data.message.includes("duplicate key value");
}

export function isRaisedException(cause: unknown): boolean {
  return viewCaughtDriver(cause).pgError?.code === PG_RAISE_EXCEPTION;
}

export function isUndefinedFunction(cause: unknown): boolean {
  return viewCaughtDriver(cause).pgError?.code === PG_UNDEFINED_FUNCTION;
}

// Connection exceptions (08), operator intervention such as a failover (57P01-57P03),
// serialization failures and deadlocks (40001, 40P01), exhausted resources (53),
// a cancelled statement (57014), a lock that was not available (55P03) and a
// read-only transaction after a failover (25006).
const TRANSIENT_SQLSTATE = /^(08|53|57P0[1-3]|40001$|40P01$|57014$|55P03$|25006$)/;

const SQLSTATE = /^[0-9A-Z]{5}$/;

/**
 * Whether another attempt can succeed. A statement the server answered with a
 * constraint, syntax or application error (23xxx, 42xxx, P0001) never can. A
 * `code` that is not a SQLSTATE is a Node socket error (ECONNRESET,
 * ECONNREFUSED, ETIMEDOUT): the connection failed, so it is worth another
 * attempt, as is an error with no code at all.
 */
export function isTransientDbFailure(cause: unknown): boolean {
  const code = viewCaughtDriver(cause).pgError?.code;

  return code === undefined || !SQLSTATE.test(code) || TRANSIENT_SQLSTATE.test(code);
}
