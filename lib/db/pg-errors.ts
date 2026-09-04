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

const pgErrorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
});

export type PgError = z.infer<typeof pgErrorSchema>;

// Caught JavaScript values are arbitrary by contract; every export narrows them here.
// oxlint-disable anti-slop/no-unknown-parameters

const errorMessageSchema = z.object({
  message: z.string(),
});

export const PG_UNIQUE_VIOLATION = '23505';

export const PG_RAISE_EXCEPTION = 'P0001';

export const PG_UNDEFINED_FUNCTION = '42883';

interface StatementFailure {
  query: unknown;
  params: unknown;
  cause: unknown;
}

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

interface CaughtDriverView {
  leaf: unknown;
  pgError: PgError | null;
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

export function getPgError(error: unknown): PgError | null {
  return viewCaughtDriver(error).pgError;
}

export function driverErrorMessage(error: unknown): string {
  return viewCaughtDriver(error).message;
}

export function isUniqueViolation(error: unknown): boolean {
  const { leaf, pgError } = viewCaughtDriver(error);
  if (pgError?.code === PG_UNIQUE_VIOLATION) return true;
  const parsedMessage = errorMessageSchema.safeParse(leaf);
  return parsedMessage.success && parsedMessage.data.message.includes('duplicate key value');
}

export function isRaisedException(error: unknown): boolean {
  return viewCaughtDriver(error).pgError?.code === PG_RAISE_EXCEPTION;
}

export function isUndefinedFunction(error: unknown): boolean {
  return viewCaughtDriver(error).pgError?.code === PG_UNDEFINED_FUNCTION;
}
// oxlint-enable anti-slop/no-unknown-parameters
